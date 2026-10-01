-- Genie-Local v8 Step A；以資料庫擁有者在 Supabase SQL Editor 執行整份檔案。
-- 前置條件：public.app_admins(user_id, display_name, active, created_at)、auth.uid()
-- 已存在；anon/authenticated 角色已存在；authenticated 可讀自己的 app_admins
-- user_id/active（含既有 RLS 自讀 policy）。函式擁有者須能讀 app_admins 並繞過
-- genie_projects RLS。本檔只管理 genie_projects 及下列四個函式，不改其他表或
-- public schema 預設權限；重跑須使用同一資料庫擁有者及相同表結構。
-- 順序：1. 本檔（可重跑） 2. ops/queries/genie-projects-verify.sql
-- 3. Claude 以 publishable key 實測 REST/RPC 與雙連線併發，再開始 Step B。
-- 成功：本檔 COMMIT；驗收檔最後刻意報 GENIE_PROJECTS_OK 並回滾測試資料。
-- RPC 均回傳 jsonb {status, version}；not_found 的 version 是 JSON null。
-- save：saved/unchanged/conflict/not_found；delete：deleted/unchanged/conflict/
-- not_found；restore：restored/unchanged/conflict/not_found。conflict 只回目前
-- version，不回 data；非啟用成員先報 42501；非法 expected_version 報 22023。
-- 回滾：本檔失敗時整個交易回滾；已 COMMIT 後，先備份雲端專案、確認可刪資料，
-- 再由擁有者「手動」執行以下 SQL（會刪除全部雲端專案，並非無損回滾）：
-- begin;
-- drop function if exists public.genie_save_project(text, jsonb, integer);
-- drop function if exists public.genie_delete_project(text, integer);
-- drop function if exists public.genie_restore_project(text, integer);
-- drop trigger if exists genie_projects_audit on public.genie_projects;
-- drop function if exists public.genie_set_project_audit();
-- drop table if exists public.genie_projects;
-- notify pgrst, 'reload schema';
-- commit;

begin;

create table if not exists public.genie_projects (
  id text primary key,
  data jsonb not null,
  version integer not null,
  deleted_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  updated_by uuid,
  constraint genie_projects_version_positive check (version > 0),
  constraint genie_projects_data_object check (pg_catalog.jsonb_typeof(data) = 'object'),
  -- CHECK 的 NULL 會通過，因此缺鍵必須以 IS TRUE 明確拒絕。
  constraint genie_projects_data_id check ((data ->> 'id' = id) is true),
  constraint genie_projects_data_name check ((pg_catalog.jsonb_typeof(data -> 'name') = 'string') is true),
  constraint genie_projects_data_date check ((pg_catalog.jsonb_typeof(data -> 'date') = 'string') is true),
  constraint genie_projects_data_size check (pg_catalog.octet_length(data::text) < 1000000)
);

create or replace function public.genie_set_project_audit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  changed_at timestamptz;
begin
  if tg_op = 'INSERT' then
    changed_at := pg_catalog.clock_timestamp();
    new.version := 1;
    new.created_at := changed_at;
    new.updated_at := changed_at;
    new.updated_by := auth.uid();
  else
    new.id := old.id;
    new.created_at := old.created_at;
    new.version := old.version;
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
    if new.data is distinct from old.data or new.deleted_at is distinct from old.deleted_at then
      new.version := old.version + 1;
      new.updated_at := pg_catalog.clock_timestamp();
      new.updated_by := auth.uid();
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists genie_projects_audit on public.genie_projects;
create trigger genie_projects_audit
  before insert or update on public.genie_projects
  for each row execute function public.genie_set_project_audit();
revoke all on function public.genie_set_project_audit() from public, anon, authenticated, service_role;

-- 不變更 schema 的 default privileges；明確清除本表的表層與所有欄位 ACL。
revoke all on table public.genie_projects from public, anon, authenticated;
do $revoke_columns$
declare
  columns_sql text;
begin
  select pg_catalog.string_agg(pg_catalog.format('%I', a.attname), ', ' order by a.attnum)
    into columns_sql
    from pg_catalog.pg_attribute as a
   where a.attrelid = 'public.genie_projects'::pg_catalog.regclass
     and a.attnum > 0 and not a.attisdropped;
  execute pg_catalog.format(
    'revoke select (%1$s), insert (%1$s), update (%1$s), references (%1$s) '
    || 'on table public.genie_projects from public, anon, authenticated', columns_sql
  );
end;
$revoke_columns$;
grant select (id, data, version, deleted_at, updated_at)
  on table public.genie_projects to authenticated;
-- service_role（VPS 機器人）不使用本表；只留唯讀以便日後備份，不可清空、刪除或繞過版本寫入。
revoke all on table public.genie_projects from service_role;
grant select on table public.genie_projects to service_role;

alter table public.genie_projects enable row level security;
drop policy if exists genie_projects_member_select on public.genie_projects;
create policy genie_projects_member_select on public.genie_projects
  for select to authenticated
  using (exists (
    select 1 from public.app_admins as a
     where a.user_id = (select auth.uid()) and a.active is true
  ));

create or replace function public.genie_save_project(
  p_id text, p_data jsonb, p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  project public.genie_projects%rowtype;
  saved_version integer;
begin
  if not exists (select 1 from public.app_admins as a
                  where a.user_id = auth.uid() and a.active is true) then
    raise exception 'active membership required' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'expected_version must be zero or positive' using errcode = '22023';
  end if;

  if p_expected_version = 0 then
    -- 唯一鍵仲裁同 id 新增；撞 id 絕不 UPDATE。另一交易未提交時會等待。
    insert into public.genie_projects (id, data) values (p_id, p_data)
      on conflict (id) do nothing returning version into saved_version;
    if found then
      return pg_catalog.jsonb_build_object('status', 'saved', 'version', saved_version);
    end if;
    select * into project from public.genie_projects where id = p_id for update;
    if not found then
      return pg_catalog.jsonb_build_object('status', 'not_found', 'version', null);
    end if;
    return pg_catalog.jsonb_build_object('status', 'conflict', 'version', project.version);
  end if;

  select * into project from public.genie_projects where id = p_id for update;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_found', 'version', null);
  end if;
  if project.version <> p_expected_version or project.deleted_at is not null then
    return pg_catalog.jsonb_build_object('status', 'conflict', 'version', project.version);
  end if;
  if project.data is not distinct from p_data then
    return pg_catalog.jsonb_build_object('status', 'unchanged', 'version', project.version);
  end if;
  update public.genie_projects set data = p_data where id = p_id
    returning version into saved_version;
  return pg_catalog.jsonb_build_object('status', 'saved', 'version', saved_version);
end;
$function$;

create or replace function public.genie_delete_project(p_id text, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  project public.genie_projects%rowtype;
  saved_version integer;
begin
  if not exists (select 1 from public.app_admins as a
                  where a.user_id = auth.uid() and a.active is true) then
    raise exception 'active membership required' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version <= 0 then
    raise exception 'expected_version must be positive' using errcode = '22023';
  end if;
  select * into project from public.genie_projects where id = p_id for update;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_found', 'version', null);
  end if;
  if project.version <> p_expected_version then
    return pg_catalog.jsonb_build_object('status', 'conflict', 'version', project.version);
  end if;
  if project.deleted_at is not null then
    return pg_catalog.jsonb_build_object('status', 'unchanged', 'version', project.version);
  end if;
  update public.genie_projects set deleted_at = pg_catalog.clock_timestamp() where id = p_id
    returning version into saved_version;
  return pg_catalog.jsonb_build_object('status', 'deleted', 'version', saved_version);
end;
$function$;

create or replace function public.genie_restore_project(p_id text, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  project public.genie_projects%rowtype;
  saved_version integer;
begin
  if not exists (select 1 from public.app_admins as a
                  where a.user_id = auth.uid() and a.active is true) then
    raise exception 'active membership required' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version <= 0 then
    raise exception 'expected_version must be positive' using errcode = '22023';
  end if;
  select * into project from public.genie_projects where id = p_id for update;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_found', 'version', null);
  end if;
  if project.version <> p_expected_version then
    return pg_catalog.jsonb_build_object('status', 'conflict', 'version', project.version);
  end if;
  if project.deleted_at is null then
    return pg_catalog.jsonb_build_object('status', 'unchanged', 'version', project.version);
  end if;
  update public.genie_projects set deleted_at = null where id = p_id
    returning version into saved_version;
  return pg_catalog.jsonb_build_object('status', 'restored', 'version', saved_version);
end;
$function$;

revoke all on function public.genie_save_project(text, jsonb, integer),
  public.genie_delete_project(text, integer), public.genie_restore_project(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.genie_save_project(text, jsonb, integer),
  public.genie_delete_project(text, integer), public.genie_restore_project(text, integer)
  to authenticated;

notify pgrst, 'reload schema';
commit;
