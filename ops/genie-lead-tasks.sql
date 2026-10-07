-- Genie-Local v9.0；由資料庫擁有者執行，可重跑（不覆寫已存在的範本版本）。
-- 前置：customer_leads、app_admins、auth.uid()、genie_set_contact_timestamps
-- 與 genie_undo_contact_result 已存在；沿用現有 BEFORE，不處理 INSERT。
-- 本檔不執行 HTTP、不改名單通知狀態、不補建舊名單。SQL 由 Claude 授權後執行。
-- 回滾：停用 genie_lead_tasks_contact_result 觸發器並隱藏前端區塊；保留資料表。
-- 子交易／固定鎖順序的官方依據（仍須在部署庫實測）：
-- https://www.postgresql.org/docs/current/plpgsql-control-structures.html#PLPGSQL-ERROR-TRAPPING
-- https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-DEADLOCKS
-- https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker
begin;

create table if not exists public.lead_playbooks (
  playbook_key text not null,
  version integer not null check (version > 0),
  start_result text not null check (start_result in ('site_visit', 'contacted', 'not_interested', 'unreachable')),
  start_step_key text not null,
  title text not null,
  active boolean not null default false,
  primary key (playbook_key, version)
);
create unique index if not exists lead_playbooks_active_result
  on public.lead_playbooks (start_result) where active;

create table if not exists public.lead_playbook_steps (
  playbook_key text not null,
  version integer not null,
  step_key text not null,
  label text not null,
  due_kind text not null check (due_kind in ('offset', 'input')),
  due_offset interval,
  sort integer not null,
  primary key (playbook_key, version, step_key),
  foreign key (playbook_key, version) references public.lead_playbooks (playbook_key, version),
  check ((due_kind = 'offset' and due_offset is not null and due_offset >= interval '0')
      or (due_kind = 'input' and due_offset is null))
);
-- 起始步驟與範本互相參照；同交易種子完成後才檢查此 FK。
do $start_fk$
begin
  if not exists (select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.lead_playbooks'::pg_catalog.regclass and conname = 'lead_playbooks_start_step_fk') then
    alter table public.lead_playbooks add constraint lead_playbooks_start_step_fk
      foreign key (playbook_key, version, start_step_key)
      references public.lead_playbook_steps (playbook_key, version, step_key)
      deferrable initially deferred;
  end if;
end;
$start_fk$;

create table if not exists public.lead_playbook_transitions (
  playbook_key text not null,
  version integer not null,
  step_key text not null,
  outcome_key text not null,
  outcome_label text not null,
  next_step_key text,
  sort integer not null,
  primary key (playbook_key, version, step_key, outcome_key),
  foreign key (playbook_key, version, step_key)
    references public.lead_playbook_steps (playbook_key, version, step_key),
  foreign key (playbook_key, version, next_step_key)
    references public.lead_playbook_steps (playbook_key, version, step_key)
);

create table if not exists public.lead_playbook_runs (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  lead_id uuid not null references public.customer_leads (id) on delete cascade,
  run_no integer not null check (run_no > 0),
  playbook_key text not null,
  version integer not null,
  source_result text not null check (source_result in ('site_visit', 'contacted', 'not_interested', 'unreachable')),
  status text not null default 'active' check (status in ('active', 'superseded', 'undone', 'finished')),
  started_at timestamptz not null,
  ended_at timestamptz,
  unique (lead_id, run_no),
  unique (id, lead_id),
  foreign key (playbook_key, version) references public.lead_playbooks (playbook_key, version),
  check ((status = 'active' and ended_at is null) or (status <> 'active' and ended_at is not null))
);
create unique index if not exists lead_playbook_runs_one_active
  on public.lead_playbook_runs (lead_id) where status = 'active';

create table if not exists public.lead_tasks (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  run_id uuid not null,
  lead_id uuid not null references public.customer_leads (id) on delete cascade,
  step_key text not null,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  due_at timestamptz not null,
  outcome text,
  note text check (note is null or pg_catalog.char_length(note) <= 500),
  previous_task_id uuid unique references public.lead_tasks (id) on delete cascade,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  completed_at timestamptz,
  completed_by uuid,
  cancelled_at timestamptz,
  cancel_reason text,
  version integer not null default 1 check (version > 0),
  unique (run_id, step_key),
  foreign key (run_id, lead_id) references public.lead_playbook_runs (id, lead_id) on delete cascade,
  -- completed_by 保留完成當時的身分；成員離開不清除歷史稽核值。
  -- 所有可空欄位均明寫 IS NULL/IS NOT NULL，避免 CHECK NULL 漏洞。
  check ((status = 'open' and outcome is null and note is null and completed_at is null
      and completed_by is null and cancelled_at is null and cancel_reason is null)
    or (status = 'done' and outcome is not null and completed_at is not null and completed_by is not null
      and cancelled_at is null and cancel_reason is null)
    or (status = 'cancelled' and outcome is null and note is null and completed_at is null
      and completed_by is null and cancelled_at is not null and cancel_reason is not null
      and cancel_reason in ('result_changed', 'undone')))
);
create unique index if not exists lead_tasks_one_open
  on public.lead_tasks (run_id) where status = 'open';
create index if not exists lead_tasks_open_lead on public.lead_tasks (lead_id) where status = 'open';

create table if not exists public.lead_task_assignees (
  task_id uuid not null references public.lead_tasks (id) on delete cascade,
  member_id uuid not null references public.app_admins (user_id) on delete cascade,
  assigned_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (task_id, member_id)
);
create table if not exists public.lead_task_errors (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  lead_id uuid not null references public.customer_leads (id) on delete cascade,
  contact_result text,
  sqlstate text not null,
  message text not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);
create index if not exists lead_task_errors_lead_time on public.lead_task_errors (lead_id, created_at desc);

/* ================= ACL 與 RLS（含舊欄位授權） ================= */
do $permissions$
declare
  table_name text;
  columns_sql text;
begin
  foreach table_name in array array['lead_playbooks', 'lead_playbook_steps', 'lead_playbook_transitions',
      'lead_playbook_runs', 'lead_tasks', 'lead_task_assignees', 'lead_task_errors'] loop
    execute pg_catalog.format('revoke all on table public.%I from public, anon, authenticated, service_role', table_name);
    select pg_catalog.string_agg(pg_catalog.format('%I', a.attname), ', ' order by a.attnum)
      into columns_sql from pg_catalog.pg_attribute as a
      where a.attrelid = pg_catalog.to_regclass('public.' || table_name) and a.attnum > 0 and not a.attisdropped;
    execute pg_catalog.format('revoke select (%1$s), insert (%1$s), update (%1$s), references (%1$s) '
      || 'on table public.%2$I from public, anon, authenticated, service_role', columns_sql, table_name);
    execute pg_catalog.format('grant select on table public.%I to authenticated', table_name);
    execute pg_catalog.format('alter table public.%I enable row level security', table_name);
    execute pg_catalog.format('drop policy if exists lead_tasks_member_select on public.%I', table_name);
    execute pg_catalog.format('create policy lead_tasks_member_select on public.%I for select to authenticated '
      || 'using (exists (select 1 from public.app_admins as a where a.user_id = (select auth.uid()) and a.active is true))', table_name);
  end loop;
end;
$permissions$;

/* ================= 聯絡結果事件（子交易失敗不影響名單） ================= */
create or replace function public.genie_start_lead_tasks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  playbook public.lead_playbooks%rowtype;
  first_step public.lead_playbook_steps%rowtype;
  old_run_id uuid;
  new_run_id uuid;
  new_task_id uuid;
  next_run_no integer;
  changed_at timestamptz := pg_catalog.clock_timestamp();
  error_state text;
  error_message text;
begin
  -- UPDATE 已鎖名單列；依序取得 run、task 鎖，與 complete RPC 相同。
  begin
    select r.id into old_run_id from public.lead_playbook_runs as r
      where r.lead_id = new.id and r.status = 'active' for update;
    if found then
      update public.lead_playbook_runs set status = case when new.contact_result is null then 'undone' else 'superseded' end,
        ended_at = changed_at where id = old_run_id;
      update public.lead_tasks set status = 'cancelled', cancelled_at = changed_at,
        cancel_reason = case when new.contact_result is null then 'undone' else 'result_changed' end,
        version = version + 1 where run_id = old_run_id and status = 'open';
    end if;
    if new.contact_result is null then return new; end if;
    select * into playbook from public.lead_playbooks
      where start_result = new.contact_result and active is true;
    if not found then return new; end if;
    select * into first_step from public.lead_playbook_steps
      where playbook_key = playbook.playbook_key and version = playbook.version and step_key = playbook.start_step_key;
    if not found or first_step.due_kind <> 'offset' or new.contact_result_at is null then
      raise exception 'playbook start requires an offset step and contact timestamp' using errcode = '22023';
    end if;
    select coalesce(pg_catalog.max(run_no), 0) + 1 into next_run_no
      from public.lead_playbook_runs where lead_id = new.id;
    insert into public.lead_playbook_runs (lead_id, run_no, playbook_key, version, source_result, started_at)
      values (new.id, next_run_no, playbook.playbook_key, playbook.version, new.contact_result, new.contact_result_at)
      returning id into new_run_id;
    insert into public.lead_tasks (run_id, lead_id, step_key, due_at)
      values (new_run_id, new.id, first_step.step_key, new.contact_result_at + first_step.due_offset)
      returning id into new_task_id;
    insert into public.lead_task_assignees (task_id, member_id)
      select new_task_id, a.user_id from public.app_admins as a where a.user_id = auth.uid() and a.active is true;
  exception when others then
    -- 此 BEGIN 內的取消、建輪次、待辦、負責人全部回滾；外層 UPDATE 保留。
    get stacked diagnostics error_state = returned_sqlstate, error_message = message_text;
    begin
      insert into public.lead_task_errors (lead_id, contact_result, sqlstate, message)
        values (new.id, new.contact_result, error_state, error_message);
    exception when others then
      -- 錯誤紀錄本身故障仍不得阻擋聯絡結果；只輸出固定警告，不洩漏名單。
      raise warning 'lead task error logging failed';
    end;
  end;
  return new;
end;
$function$;
revoke all on function public.genie_start_lead_tasks() from public, anon, authenticated, service_role;
drop trigger if exists genie_lead_tasks_contact_result on public.customer_leads;
create trigger genie_lead_tasks_contact_result
  after update of contact_result on public.customer_leads
  for each row when (old.contact_result is distinct from new.contact_result)
  execute function public.genie_start_lead_tasks();

/* ================= 完成待辦（名單 → 輪次 → 待辦） ================= */
create or replace function public.genie_complete_task(
  p_id uuid, p_expected_version integer, p_outcome text,
  p_note text default null, p_next_due_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  task_lead_id uuid;
  task_run_id uuid;
  lead public.customer_leads%rowtype;
  run public.lead_playbook_runs%rowtype;
  task public.lead_tasks%rowtype;
  transition public.lead_playbook_transitions%rowtype;
  next_step public.lead_playbook_steps%rowtype;
  completed_time timestamptz;
  next_due timestamptz;
  next_id uuid;
  saved_version integer;
begin
  if not exists (select 1 from public.app_admins as a where a.user_id = auth.uid() and a.active is true) then
    raise exception 'active membership required' using errcode = '42501';
  end if;
  -- 無鎖定位後，不依賴這次讀取的狀態；取得所有鎖後重新驗證。
  select lead_id, run_id into task_lead_id, task_run_id from public.lead_tasks where id = p_id;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_found', 'version', null, 'next_task_id', null); end if;
  select * into lead from public.customer_leads where id = task_lead_id for update;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_found', 'version', null, 'next_task_id', null); end if;
  select * into run from public.lead_playbook_runs where id = task_run_id and lead_id = lead.id for update;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_found', 'version', null, 'next_task_id', null); end if;
  select * into task from public.lead_tasks where id = p_id and run_id = run.id and lead_id = lead.id for update;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_found', 'version', null, 'next_task_id', null); end if;
  -- 失效優先，避免觸發器失敗而保留下來的舊 active run 被續走。
  if run.status <> 'active' or task.status <> 'open' or lead.contact_result is distinct from run.source_result then
    return pg_catalog.jsonb_build_object('status', 'inactive', 'version', task.version, 'next_task_id', null);
  end if;
  if p_expected_version is null or p_expected_version <= 0 then
    return pg_catalog.jsonb_build_object('status', 'invalid', 'version', task.version, 'next_task_id', null);
  end if;
  if task.version <> p_expected_version then
    return pg_catalog.jsonb_build_object('status', 'conflict', 'version', task.version, 'next_task_id', null);
  end if;
  if p_note is not null and pg_catalog.char_length(p_note) > 500 then
    return pg_catalog.jsonb_build_object('status', 'invalid', 'version', task.version, 'next_task_id', null);
  end if;
  select * into transition from public.lead_playbook_transitions
    where playbook_key = run.playbook_key and version = run.version and step_key = task.step_key and outcome_key = p_outcome;
  if not found then return pg_catalog.jsonb_build_object('status', 'invalid', 'version', task.version, 'next_task_id', null); end if;
  if transition.next_step_key is not null then
    select * into next_step from public.lead_playbook_steps
      where playbook_key = run.playbook_key and version = run.version and step_key = transition.next_step_key;
    if not found or (next_step.due_kind = 'input' and p_next_due_at is null)
       or exists (select 1 from public.lead_tasks where run_id = run.id and step_key = transition.next_step_key) then
      -- v9 不支援迴圈，不能回到本輪已建立的步驟。
      return pg_catalog.jsonb_build_object('status', 'invalid', 'version', task.version, 'next_task_id', null);
    end if;
  end if;
  completed_time := pg_catalog.clock_timestamp();
  update public.lead_tasks set status = 'done', outcome = p_outcome, note = p_note,
    completed_at = completed_time, completed_by = auth.uid(), version = version + 1
    where id = task.id returning version into saved_version;
  if transition.next_step_key is null then
    update public.lead_playbook_runs set status = 'finished', ended_at = completed_time where id = run.id;
  else
    next_due := case when next_step.due_kind = 'input' then p_next_due_at else completed_time + next_step.due_offset end;
    insert into public.lead_tasks (run_id, lead_id, step_key, due_at, previous_task_id, created_at)
      values (run.id, lead.id, next_step.step_key, next_due, task.id, completed_time) returning id into next_id;
    insert into public.lead_task_assignees (task_id, member_id, assigned_at)
      select next_id, member_id, completed_time from public.lead_task_assignees where task_id = task.id;
  end if;
  return pg_catalog.jsonb_build_object('status', 'completed', 'version', saved_version, 'next_task_id', next_id);
end;
$function$;
revoke all on function public.genie_complete_task(uuid, integer, text, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.genie_complete_task(uuid, integer, text, text, timestamptz) to authenticated;

/* ================= 範例流程 v1（存在的版本整份保留） ================= */
do $seed$
begin
  if not exists (select 1 from public.lead_playbooks where playbook_key = 'site_visit' and version = 1) then
    insert into public.lead_playbooks values ('site_visit', 1, 'site_visit', 'confirm_visit', '約丈量（範例流程）', true);
    insert into public.lead_playbook_steps values
      ('site_visit', 1, 'confirm_visit', '確認丈量時間', 'offset', interval '24 hours', 1),
      ('site_visit', 1, 'measure', '到場丈量', 'input', null, 2),
      ('site_visit', 1, 'quote', '整理資料並報價', 'offset', interval '72 hours', 3);
    insert into public.lead_playbook_transitions values
      ('site_visit', 1, 'confirm_visit', 'scheduled', '已約好時間', 'measure', 1),
      ('site_visit', 1, 'confirm_visit', 'cancelled', '客人取消', null, 2),
      ('site_visit', 1, 'measure', 'measured', '已丈量', 'quote', 1),
      ('site_visit', 1, 'measure', 'missed', '沒丈量到', null, 2),
      ('site_visit', 1, 'quote', 'quoted', '已報價', null, 1);
  end if;
  if not exists (select 1 from public.lead_playbooks where playbook_key = 'contacted' and version = 1) then
    insert into public.lead_playbooks values ('contacted', 1, 'contacted', 'interest', '已聯絡（範例流程）', true);
    insert into public.lead_playbook_steps values
      ('contacted', 1, 'interest', '追蹤意願', 'offset', interval '72 hours', 1),
      ('contacted', 1, 'follow_up', '再次追蹤', 'offset', interval '168 hours', 2);
    insert into public.lead_playbook_transitions values
      ('contacted', 1, 'interest', 'interested', '有興趣', 'follow_up', 1),
      ('contacted', 1, 'interest', 'not_interested', '沒興趣', null, 2),
      ('contacted', 1, 'follow_up', 'followed', '已追蹤', null, 1);
  end if;
end;
$seed$;
notify pgrst, 'reload schema';
commit;
