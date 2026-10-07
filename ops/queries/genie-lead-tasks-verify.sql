-- v9.0：先執行 ops/genie-lead-tasks.sql，再以同一資料庫擁有者執行整份。
-- 不讀 email／憑證，不動正式名單。測試名單只在子交易內建立並全部回滾。
-- 前置：一位啟用成員＋auth.users 中一位尚未加入 app_admins 的測試帳號。
-- 不修改既有成員；只將非成員暫時加入為停用成員，最後回滾。
-- 全通過才 NOTICE LEAD_TASKS_OK；任何失敗即 LEAD_TASKS_FAIL，執行 ROLLBACK。
-- 即使只選 DO 執行，內層刻意 EXCEPTION 也會撤回全部測試資料與角色切換。
-- 此檔測順序競爭者，不冒稱雙連線併發。正式 REST/RPC 授權仍需 Claude 實測。
--
-- C01（隔離測試庫，兩條連線，不使用正式名單）：建立測試名單並按 site_visit，
-- 記錄 open task id/version。A、B 都 BEGIN；SET LOCAL ROLE authenticated 並
-- set_config JWT 為啟用測試成員。A complete(scheduled, 指定日期)，先不 COMMIT；
-- B complete 同 id/version，應等待。A COMMIT 後 B 回 inactive（done）或 conflict，
-- 只一筆 done、只一筆 previous_task_id 對應下一步。B COMMIT，擁有者清測試名單。
-- C02：重建測試名單。A complete 後持交易；B undo，等待 A COMMIT 後 B 收回，
-- done 保留、後繼 cancelled、run undone、無 open。再反過來 A undo 持交易，
-- B complete 等 A COMMIT 後回 inactive，無後繼；兩種順序均不得 deadlock。
-- C03：範本種子可重跑；在隔離庫修改 v1 標籤後重跑建置檔，不得覆写既存 v1。
begin;
do $verify$
declare
  owner_name text := current_user;
  test_member_id uuid;
  outsider_id uuid;
  test_lead_id uuid := pg_catalog.gen_random_uuid();
  inserted_id uuid := pg_catalog.gen_random_uuid();
  missing_id uuid := pg_catalog.gen_random_uuid();
  task public.lead_tasks%rowtype;
  next_task public.lead_tasks%rowtype;
  task_snapshot jsonb;
  result jsonb;
  test_run_id uuid;
  n bigint;
  table_name text;
  column_name text;
  privilege_name text;
  role_name text;
  role_index integer;
  actor_id uuid;
  signature text;
  cell text := 'preflight';
  outcome text;
  case_no integer;
  due_time timestamptz := pg_catalog.clock_timestamp() + interval '48 hours';
  saved_kind text;
  saved_offset interval;
begin
  begin
    select a.user_id into test_member_id from public.app_admins as a where a.active is true order by a.user_id limit 1;
    select u.id into outsider_id from auth.users as u
      where not exists (select 1 from public.app_admins as a where a.user_id = u.id) order by u.id limit 1;
    if test_member_id is null or outsider_id is null then
      raise exception 'need active member and an auth test user absent from app_admins';
    end if;
    foreach table_name in array array['lead_playbooks', 'lead_playbook_steps', 'lead_playbook_transitions',
        'lead_playbook_runs', 'lead_tasks', 'lead_task_assignees', 'lead_task_errors'] loop
      cell := 'ACL/RLS ' || table_name;
      if not exists (select 1 from pg_catalog.pg_class as c
        where c.oid = pg_catalog.to_regclass('public.' || table_name) and c.relrowsecurity and not c.relforcerowsecurity
          and c.relowner = (select oid from pg_catalog.pg_roles where rolname = owner_name)) then
        raise exception 'expected same table owner and RLS without FORCE';
      end if;
      if exists (select 1 from pg_catalog.pg_class as c,
        lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) as acl
        where c.oid = pg_catalog.to_regclass('public.' || table_name) and acl.grantee = 0)
        or exists (select 1 from pg_catalog.pg_attribute as a, lateral pg_catalog.aclexplode(a.attacl) as acl
          where a.attrelid = pg_catalog.to_regclass('public.' || table_name) and acl.grantee = 0) then
        raise exception 'PUBLIC table/column grant remains';
      end if;
      foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
        foreach privilege_name in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
          if pg_catalog.has_table_privilege(role_name, 'public.' || table_name, privilege_name) then
            raise exception 'unexpected % table %', role_name, privilege_name;
          end if;
        end loop;
        for column_name in select a.attname from pg_catalog.pg_attribute as a
          where a.attrelid = pg_catalog.to_regclass('public.' || table_name) and a.attnum > 0 and not a.attisdropped loop
          foreach privilege_name in array array['INSERT', 'UPDATE', 'REFERENCES'] loop
            if pg_catalog.has_column_privilege(role_name, 'public.' || table_name, column_name, privilege_name) then
              raise exception 'unexpected % column %', role_name, privilege_name;
            end if;
          end loop;
          if pg_catalog.has_column_privilege(role_name, 'public.' || table_name, column_name, 'SELECT')
            is distinct from (role_name = 'authenticated') then raise exception 'unexpected SELECT grant'; end if;
        end loop;
      end loop;
    end loop;
    foreach signature in array array['public.genie_start_lead_tasks()', 'public.genie_complete_task(uuid,integer,text,text,timestamp with time zone)'] loop
      cell := 'function security ' || signature;
      if not exists (select 1 from pg_catalog.pg_proc as p where p.oid = signature::pg_catalog.regprocedure
        and p.prosecdef and p.proconfig @> array['search_path=""']::text[]
        and p.proowner = (select oid from pg_catalog.pg_roles where rolname = owner_name))
        or exists (select 1 from pg_catalog.pg_proc as p,
          lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) as acl
          where p.oid = signature::pg_catalog.regprocedure and acl.grantee = 0) then
        raise exception 'definer/search_path/owner/PUBLIC';
      end if;
      foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
        if pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
          is distinct from (role_name = 'authenticated' and signature like '%genie_complete_task%') then
          raise exception 'unexpected EXECUTE for %', role_name;
        end if;
      end loop;
    end loop;
    cell := 'AFTER UPDATE OF / WHEN / existing BEFORE';
    if not exists (select 1 from pg_catalog.pg_trigger as t
      where t.tgrelid = 'public.customer_leads'::pg_catalog.regclass and t.tgname = 'genie_lead_tasks_contact_result'
        and t.tgtype = 17 and t.tgenabled = 'O' and t.tgqual is not null
        and t.tgfoid = 'public.genie_start_lead_tasks()'::pg_catalog.regprocedure
        and t.tgattr::text = (select attnum::text from pg_catalog.pg_attribute
          where attrelid = t.tgrelid and attname = 'contact_result'))
      or not exists (select 1 from pg_catalog.pg_trigger
        where tgrelid = 'public.customer_leads'::pg_catalog.regclass and tgname = 'genie_contact_timestamps' and tgenabled = 'O') then
      raise exception 'trigger definition differs';
    end if;
    raise notice 'PASS ACL / RLS / functions / trigger';

    -- 無真實資料：UUID 執行時隨機產生，不寫入 repo；通知狀態 sent 避免通知搶單。
    cell := 'INSERT does not create run';
    insert into public.customer_leads (id, source, messenger_user_id, status, answers, customer_name, notification_status, completed_at)
      values (test_lead_id, 'facebook', 'verify-task-' || test_lead_id::text, 'complete', '{}'::jsonb, '流程驗收測試', 'sent', pg_catalog.clock_timestamp());
    insert into public.customer_leads (id, source, messenger_user_id, status, answers, customer_name, notification_status, completed_at, contact_result, contact_result_at)
      values (inserted_id, 'facebook', 'verify-task-' || inserted_id::text, 'complete', '{}'::jsonb, 'INSERT 驗收測試', 'sent', pg_catalog.clock_timestamp(), 'site_visit', pg_catalog.clock_timestamp());
    if exists (select 1 from public.lead_playbook_runs where lead_id in (test_lead_id, inserted_id)) then
      raise exception 'INSERT created run';
    end if;
    perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', test_member_id, 'role', 'authenticated')::text, true);
    perform pg_catalog.set_config('request.jwt.claim.sub', test_member_id::text, true);
    update public.customer_leads set contact_result = 'site_visit' where id = test_lead_id;
    select * into task from public.lead_tasks as t where t.lead_id = test_lead_id and t.status = 'open';
    if not found then raise exception 'no initial task'; end if;
    if task.due_at is distinct from (select contact_result_at + interval '24 hours' from public.customer_leads where id = test_lead_id)
      or not exists (select 1 from public.lead_task_assignees where task_id = task.id and member_id = test_member_id) then
      raise exception 'initial deadline/assignee';
    end if;
    -- 所有新表的 SELECT 以同一組匿名／非成員／停用／啟用矩陣驗證。
    for role_index in 1..4 loop
      execute 'reset role'; execute pg_catalog.format('set local role %I', owner_name);
      if role_index = 3 then insert into public.app_admins (user_id, display_name, active) values (outsider_id, '驗收停用成員', false); end if;
      actor_id := case when role_index = 1 then null when role_index = 4 then test_member_id else outsider_id end;
      perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', actor_id, 'role', case when role_index = 1 then 'anon' else 'authenticated' end)::text, true);
      perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(actor_id::text, ''), true);
      execute case when role_index = 1 then 'set local role anon' else 'set local role authenticated' end;
      foreach table_name in array array['lead_playbooks', 'lead_playbook_steps', 'lead_playbook_transitions',
          'lead_playbook_runs', 'lead_tasks', 'lead_task_assignees', 'lead_task_errors'] loop
        cell := 'read/write role ' || role_index || ' ' || table_name;
        begin
          execute pg_catalog.format('select count(*) from public.%I', table_name) into n;
          if role_index = 1 or (role_index in (2, 3) and n <> 0) or (role_index = 4 and n = 0 and table_name <> 'lead_task_errors') then
            raise exception 'unexpected read visibility';
          end if;
        exception when insufficient_privilege then if role_index <> 1 then raise; end if;
        end;
        begin
          execute pg_catalog.format('insert into public.%I default values', table_name);
          raise exception 'direct INSERT allowed';
        exception when insufficient_privilege then null; end;
        begin
          execute pg_catalog.format('delete from public.%I where false', table_name);
          raise exception 'direct DELETE allowed';
        exception when insufficient_privilege then null; end;
        begin
          execute pg_catalog.format('update public.%I set %I = %I where false', table_name,
            case when table_name in ('lead_playbooks', 'lead_playbook_steps', 'lead_playbook_transitions') then 'version'
              when table_name = 'lead_task_assignees' then 'assigned_at' else 'id' end,
            case when table_name in ('lead_playbooks', 'lead_playbook_steps', 'lead_playbook_transitions') then 'version'
              when table_name = 'lead_task_assignees' then 'assigned_at' else 'id' end);
          raise exception 'direct UPDATE allowed';
        exception when insufficient_privilege then null; end;
      end loop;
      begin
        execute 'select public.genie_start_lead_tasks()'; raise exception 'trigger function callable';
      exception when insufficient_privilege then null; end;
      if role_index = 4 then
        result := public.genie_complete_task(task.id, task.version, 'scheduled');
        if result ->> 'status' is distinct from 'invalid' then raise exception 'member RPC not callable'; end if;
      end if;
      if role_index < 4 then
        begin
          execute 'select public.genie_complete_task($1, 1, ''cancelled'')' into result using task.id;
          raise exception 'nonmember RPC allowed';
        exception when insufficient_privilege then null; end;
      end if;
    end loop;
    execute 'reset role'; execute pg_catalog.format('set local role %I', owner_name);
    raise notice 'PASS anon / nonmember / disabled / member matrix';

    cell := 'same result / general columns do not create';
    update public.customer_leads set contact_result = 'site_visit' where id = test_lead_id;
    update public.customer_leads set customer_name = '更新姓名測試', phone = '0900000000', notification_status = 'sent' where id = test_lead_id;
    if (select count(*) from public.lead_playbook_runs as r where r.lead_id = test_lead_id) <> 1 then raise exception 'duplicate run'; end if;
    cell := 'undo / reapply gives run 2';
    select public.genie_undo_contact_result(test_lead_id, contact_result, contact_result_at) into outcome from public.customer_leads where id = test_lead_id;
    if outcome <> 'undone' or not exists (select 1 from public.lead_tasks where id = task.id and status = 'cancelled' and cancel_reason = 'undone') then raise exception 'undo failed'; end if;
    update public.customer_leads set contact_result = 'site_visit' where id = test_lead_id;
    if not exists (select 1 from public.lead_playbook_runs as r where r.lead_id = test_lead_id and run_no = 2 and status = 'active') then raise exception 'not run 2'; end if;
    cell := 'A -> B / no template cancels open';
    update public.customer_leads set contact_result = 'contacted' where id = test_lead_id;
    if (select count(*) from public.lead_tasks as t where t.lead_id = test_lead_id and t.status = 'open' and step_key = 'interest') <> 1
      or not exists (select 1 from public.lead_tasks as t where t.lead_id = test_lead_id and t.cancel_reason = 'result_changed') then raise exception 'switch failed'; end if;
    update public.customer_leads set contact_result = 'not_interested' where id = test_lead_id;
    update public.customer_leads set contact_result = 'unreachable' where id = test_lead_id;
    if exists (select 1 from public.lead_tasks as t where t.lead_id = test_lead_id and t.status = 'open') then raise exception 'no-template residual task'; end if;
    raise notice 'PASS events / undo / round numbering / cancellation';

    -- 每個 case 先換無範本結果，再開新輪，涵蓋全部終止與接續分支。
    for case_no in 1..5 loop
      cell := 'branch ' || case_no;
      update public.customer_leads set contact_result = 'unreachable' where id = test_lead_id;
      update public.customer_leads set contact_result = case when case_no <= 3 then 'site_visit' else 'contacted' end where id = test_lead_id;
      select * into task from public.lead_tasks as t where t.lead_id = test_lead_id and t.status = 'open';
      test_run_id := task.run_id;
      if case_no in (2, 3) then
        task_snapshot := pg_catalog.to_jsonb(task);
        result := public.genie_complete_task(task.id, task.version, 'scheduled');
        if result ->> 'status' is distinct from 'invalid' or (select pg_catalog.to_jsonb(t) from public.lead_tasks as t where id = task.id) is distinct from task_snapshot
          or (select count(*) from public.lead_tasks where run_id = task.run_id) <> 1 then raise exception 'missing input mutated data'; end if;
        result := public.genie_complete_task(task.id, task.version, 'scheduled', '測試備註', due_time);
        select * into next_task from public.lead_tasks where id = (result ->> 'next_task_id')::uuid;
        if result ->> 'status' is distinct from 'completed' or next_task.due_at is distinct from due_time or next_task.previous_task_id <> task.id
          or not exists (select 1 from public.lead_task_assignees where task_id = next_task.id and member_id = test_member_id) then raise exception 'input/assignee copy'; end if;
        task := next_task;
        result := public.genie_complete_task(task.id, task.version, case when case_no = 2 then 'missed' else 'measured' end);
        if result ->> 'status' is distinct from 'completed' then raise exception 'measure branch'; end if;
        if case_no = 3 then
          select * into next_task from public.lead_tasks where id = (result ->> 'next_task_id')::uuid;
          if next_task.due_at is distinct from (select completed_at + interval '72 hours' from public.lead_tasks where id = task.id) then raise exception 'quote offset'; end if;
          result := public.genie_complete_task(next_task.id, next_task.version, 'quoted');
        end if;
      elsif case_no = 4 then
        result := public.genie_complete_task(task.id, task.version, 'interested', null, due_time);
        select * into next_task from public.lead_tasks where id = (result ->> 'next_task_id')::uuid;
        if next_task.due_at is distinct from (select completed_at + interval '168 hours' from public.lead_tasks where id = task.id) then raise exception 'follow-up offset / ignored input'; end if;
        result := public.genie_complete_task(next_task.id, next_task.version, 'followed');
      else
        result := public.genie_complete_task(task.id, task.version, case when case_no = 1 then 'cancelled' else 'not_interested' end);
      end if;
      if result ->> 'status' is distinct from 'completed' or result ->> 'next_task_id' is not null
        or not exists (select 1 from public.lead_playbook_runs where id = test_run_id and status = 'finished' and ended_at is not null)
        or exists (select 1 from public.lead_tasks as t where t.run_id = test_run_id and t.status = 'open') then raise exception 'branch did not finish'; end if;
    end loop;
    raise notice 'PASS all sample outcomes / input / offset / assignee copy';

    cell := 'invalid / optimistic locking / not found';
    update public.customer_leads set contact_result = 'site_visit' where id = test_lead_id;
    select * into task from public.lead_tasks as t where t.lead_id = test_lead_id and t.status = 'open';
    task_snapshot := pg_catalog.to_jsonb(task);
    cell := 'CHECK rejects incomplete done / cancelled / dirty open';
    begin
      update public.lead_tasks set status = 'done', outcome = 'cancelled', completed_at = pg_catalog.clock_timestamp(), completed_by = null where id = task.id;
      raise exception 'done without completer accepted';
    exception when check_violation then null; end;
    begin
      update public.lead_tasks set status = 'cancelled', cancelled_at = pg_catalog.clock_timestamp(), cancel_reason = null where id = task.id;
      raise exception 'cancelled without reason accepted';
    exception when check_violation then null; end;
    begin
      update public.lead_tasks set outcome = 'cancelled' where id = task.id;
      raise exception 'open with outcome accepted';
    exception when check_violation then null; end;
    cell := 'invalid / optimistic locking / not found';
    result := public.genie_complete_task(task.id, task.version + 1, 'cancelled');
    if result ->> 'status' is distinct from 'conflict' then raise exception 'stale version not rejected'; end if;
    result := public.genie_complete_task(task.id, task.version, 'unknown');
    if result ->> 'status' is distinct from 'invalid' then raise exception 'unknown outcome'; end if;
    result := public.genie_complete_task(task.id, task.version, 'cancelled', pg_catalog.repeat('界', 501));
    if result ->> 'status' is distinct from 'invalid' then raise exception 'long note'; end if;
    if (select pg_catalog.to_jsonb(t) from public.lead_tasks as t where id = task.id) is distinct from task_snapshot then raise exception 'rejected RPC changed row'; end if;
    result := public.genie_complete_task(missing_id, 1, 'cancelled');
    if result is distinct from '{"status":"not_found","version":null,"next_task_id":null}'::jsonb then raise exception 'missing id response'; end if;

    cell := 'trigger EXCEPTION subtransaction restores old run but stores contact result';
    -- 將下一個範本起始步驟暫時改 input，CHECK/FK 仍合法，但觸發器必須報錯。
    select due_kind, due_offset into saved_kind, saved_offset from public.lead_playbook_steps
      where playbook_key = 'contacted' and version = 1 and step_key = 'interest';
    update public.lead_playbook_steps set due_kind = 'input', due_offset = null
      where playbook_key = 'contacted' and version = 1 and step_key = 'interest';
    update public.customer_leads set contact_result = 'contacted' where id = test_lead_id;
    if (select contact_result from public.customer_leads where id = test_lead_id) <> 'contacted'
      or (select count(*) from public.lead_task_errors as e where e.lead_id = test_lead_id and e.contact_result = 'contacted' and e.sqlstate = '22023') <> 1
      or (select pg_catalog.to_jsonb(t) from public.lead_tasks as t where id = task.id) is distinct from task_snapshot
      or not exists (select 1 from public.lead_playbook_runs where id = task.run_id and status = 'active') then
      raise exception 'subtransaction did not roll back all workflow changes / log error';
    end if;
    result := public.genie_complete_task(task.id, task.version, 'cancelled');
    if result ->> 'status' is distinct from 'inactive' then raise exception 'result mismatch not rejected'; end if;
    update public.lead_playbook_steps set due_kind = saved_kind, due_offset = saved_offset
      where playbook_key = 'contacted' and version = 1 and step_key = 'interest';
    update public.customer_leads set contact_result = 'unreachable' where id = test_lead_id;
    result := public.genie_complete_task(task.id, task.version, 'cancelled');
    if result ->> 'status' is distinct from 'inactive' then raise exception 'cancelled task not inactive'; end if;
    raise notice 'PASS errors / atomicity / mismatch inactive / optimistic version';

    cell := 'email path without auth.uid has no assignee';
    perform pg_catalog.set_config('request.jwt.claims', '{}', true);
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    update public.customer_leads set contact_result = 'site_visit' where id = test_lead_id;
    select * into task from public.lead_tasks as t where t.lead_id = test_lead_id and t.status = 'open';
    if not found or exists (select 1 from public.lead_task_assignees where task_id = task.id) then raise exception 'email path assignee'; end if;
    cell := 'delete cascades privacy data';
    delete from public.customer_leads where id in (test_lead_id, inserted_id);
    if exists (select 1 from public.lead_playbook_runs as r where r.lead_id in (test_lead_id, inserted_id))
      or exists (select 1 from public.lead_tasks as t where t.lead_id in (test_lead_id, inserted_id))
      or exists (select 1 from public.lead_task_errors as e where e.lead_id in (test_lead_id, inserted_id))
      or exists (select 1 from public.lead_task_assignees as a left join public.lead_tasks as t on t.id = a.task_id where t.id is null) then raise exception 'cascade incomplete'; end if;
    raise notice 'PASS email path / deletion cascade';
    -- 起始 FK 是 deferred；DO 單獨執行也要在成功訊號前檢查所有延遲限制。
    set constraints all immediate;
    raise exception 'LEAD_TASKS_OK';
  exception when others then
    if sqlerrm = 'LEAD_TASKS_OK' then
      raise notice 'LEAD_TASKS_OK: all matrix checks passed; test changes rolled back';
      raise notice 'PENDING C01/C02/C03: live two-connection concurrency, rerun seed, REST/RPC permissions';
    else
      raise exception 'LEAD_TASKS_FAIL: % (SQLSTATE %, %)', cell, sqlstate, sqlerrm;
    end if;
  end;
end;
$verify$;
rollback;
