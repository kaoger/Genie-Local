-- Genie-Local v8 Step A：以資料庫擁有者在 Supabase SQL Editor 執行整個 DO。
-- 前置條件：先執行 ops/genie-projects.sql；至少一位啟用 app_admins 成員，
-- 及一位 auth.users 中尚未加入 app_admins 的測試帳號。自動只讀取 UUID，
-- 不讀 email、不輸出 UUID、不改 auth.users 或既有成員；無需填入真實身分。
-- 使用暫時非成員 → 停用成員 → 第二位啟用成員，全部在此 DO 交易內回滾。
-- 每格 PASS NOTICE；失敗即 GENIE_PROJECTS_FAIL: <格子>，含預期/實際值或
-- SQLSTATE。全過「刻意」raise exception GENIE_PROJECTS_OK，紅色錯誤是預期。
-- 即使只選取 DO 執行、或中途失敗，外層 exception 重拋會回滾所有測試資料。
-- 若在自行 BEGIN 的交易內執行，看到最終 exception 後再手動 ROLLBACK。
-- 回滾 SQL（註解，非自動執行）：ROLLBACK;
-- 本檔不持久建立物件；不需 DROP。撤回正式建置的 DROP SQL 在建置檔檔頭。
--
-- 矩陣標記：M01 SELECT（含已刪）、M02 直接 INSERT/UPDATE/DELETE、
-- M03 save 新增/正確更新、M04 save 舊版本、M05 delete/restore 正確/舊版本、
-- M06 改 id/version/稽核欄位；每項均檢查 anon/非成員/停用/啟用四種身分。
-- A01 ACL/EXECUTE/RLS/trigger、A02 稽核與 unchanged、A03 第二成員共享、
-- A04 JSON/參數拒絕、A05 not_found/禁止 save 復活、A06 相同 id/版本的競爭者。
-- A06 是同一交易的依序呼叫及鎖/唯一鍵結構檢查，不能冒稱雙連線併發實測。
-- GENIE_PROJECTS_OK 僅表示本檔 SQL 矩陣全過；另輸出 PENDING C01/C02。
-- C01/C02 必須由 Claude 在隔離測試庫另開兩條連線測「同 id 併發新增」及
-- 「同版本併發更新」（兩份不同的變更內容）：第一條持鎖未提交，第二條應等待；第一條 COMMIT 後
-- 第二條得到 conflict、只增加一次 version。再由管理者移除測試列。
-- 此測試需跨連線 COMMIT，不能納入這支以 exception 全回滾的單一 DO。
-- publishable key 的 REST/RPC anon 拒絕也須另實打；本檔只模擬角色與 JWT。

do $verify$
declare
  owner_name text := current_user;
  member_id uuid;
  outsider_id uuid;
  project_id text := 'genie-verify-' || pg_catalog.gen_random_uuid()::text;
  deleted_id text := 'genie-verify-deleted-' || pg_catalog.gen_random_uuid()::text;
  new_id text := 'genie-verify-new-' || pg_catalog.gen_random_uuid()::text;
  missing_id text := 'genie-verify-missing-' || pg_catalog.gen_random_uuid()::text;
  invalid_id text := 'genie-verify-invalid-' || pg_catalog.gen_random_uuid()::text;
  cell text := 'preflight';
  role_label text;
  role_index integer;
  role_name text;
  actor_id uuid;
  case_label text;
  case_sql text;
  column_name text;
  privilege_name text;
  function_signature text;
  expected_select boolean;
  n bigint;
  result jsonb;
  expected_result jsonb;
  base_data jsonb;
  changed_data jsonb;
  new_data jsonb;
  invalid_data jsonb;
  snapshot public.genie_projects%rowtype;
  next_snapshot public.genie_projects%rowtype;
begin
  -- 只讀既有身分；缺少測試帳號就明確失敗，絕不改現有成員的 active。
  select a.user_id into member_id from public.app_admins as a
   where a.active is true order by a.user_id limit 1;
  select u.id into outsider_id from auth.users as u
   where not exists (select 1 from public.app_admins as a where a.user_id = u.id)
   order by u.id limit 1;
  if member_id is null or outsider_id is null then
    raise exception 'GENIE_PROJECTS_FAIL: preflight (need an active member and an auth test user absent from app_admins)';
  end if;
  if not exists (select 1 from pg_catalog.pg_class as c
                  where c.oid = 'public.genie_projects'::pg_catalog.regclass
                    and c.relowner = (select r.oid from pg_catalog.pg_roles as r where r.rolname = owner_name)
                    and c.relrowsecurity and not c.relforcerowsecurity) then
    raise exception 'GENIE_PROJECTS_FAIL: A01 table owner / RLS (run as table owner; RLS enabled without FORCE)';
  end if;
  raise notice 'PASS preflight: identities available; table owner and RLS checked';

  -- 有效權限檢查包含繼承；不能只看 ACL 裡是否出現 authenticated。
  for role_name in select v.name from (values ('anon'), ('authenticated')) as v(name)
  loop
    for privilege_name in select v.name from
      (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as v(name)
    loop
      cell := 'A01 ' || role_name || ' table ' || privilege_name;
      if pg_catalog.has_table_privilege(role_name, 'public.genie_projects', privilege_name) then
        raise exception 'GENIE_PROJECTS_FAIL: % (unexpected table privilege)', cell;
      end if;
      raise notice 'PASS %: no table grant', cell;
    end loop;
    for column_name in select a.attname from pg_catalog.pg_attribute as a
      where a.attrelid = 'public.genie_projects'::pg_catalog.regclass and a.attnum > 0 and not a.attisdropped
    loop
      expected_select := role_name = 'authenticated'
        and column_name in ('id', 'data', 'version', 'deleted_at', 'updated_at');
      cell := 'A01 ' || role_name || ' SELECT column ' || column_name;
      if pg_catalog.has_column_privilege(role_name, 'public.genie_projects', column_name, 'SELECT')
         is distinct from expected_select then
        raise exception 'GENIE_PROJECTS_FAIL: % (expected %)', cell, expected_select;
      end if;
      raise notice 'PASS %: %', cell, expected_select;
      for privilege_name in select v.name from (values ('INSERT'), ('UPDATE'), ('REFERENCES')) as v(name)
      loop
        cell := 'A01 ' || role_name || ' column ' || column_name || ' ' || privilege_name;
        if pg_catalog.has_column_privilege(role_name, 'public.genie_projects', column_name, privilege_name) then
          raise exception 'GENIE_PROJECTS_FAIL: % (unexpected column grant)', cell;
        end if;
        raise notice 'PASS %: denied', cell;
      end loop;
    end loop;
  end loop;
  cell := 'A01 PUBLIC table/column ACL';
  if exists (select 1 from pg_catalog.pg_class as c,
               lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) as acl
              where c.oid = 'public.genie_projects'::pg_catalog.regclass and acl.grantee = 0)
     or exists (select 1 from pg_catalog.pg_attribute as a,
                  lateral pg_catalog.aclexplode(a.attacl) as acl
                 where a.attrelid = 'public.genie_projects'::pg_catalog.regclass and acl.grantee = 0) then
    raise exception 'GENIE_PROJECTS_FAIL: %', cell;
  end if;
  raise notice 'PASS %: no grants', cell;

  for function_signature in select v.signature from (values
    ('public.genie_save_project(text,jsonb,integer)'),
    ('public.genie_delete_project(text,integer)'),
    ('public.genie_restore_project(text,integer)')
  ) as v(signature)
  loop
    cell := 'A01 RPC configuration ' || function_signature;
    if not exists (select 1 from pg_catalog.pg_proc as p
                    where p.oid = function_signature::pg_catalog.regprocedure
                      and p.prosecdef and p.proconfig @> array['search_path=""']::text[]
                      and p.proowner = (select c.relowner from pg_catalog.pg_class as c
                                        where c.oid = 'public.genie_projects'::pg_catalog.regclass)
                      and p.prorettype = 'jsonb'::pg_catalog.regtype)
       or pg_catalog.has_function_privilege('anon', function_signature, 'EXECUTE')
       or not pg_catalog.has_function_privilege('authenticated', function_signature, 'EXECUTE')
       or exists (select 1 from pg_catalog.pg_proc as p,
                    lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) as acl
                   where p.oid = function_signature::pg_catalog.regprocedure and acl.grantee = 0) then
      raise exception 'GENIE_PROJECTS_FAIL: % (definer/search_path/owner/return type/EXECUTE)', cell;
    end if;
    raise notice 'PASS %: secure configuration and EXECUTE grants', cell;
  end loop;
  cell := 'A01 trigger configuration/EXECUTE';
  if not exists (select 1 from pg_catalog.pg_trigger as t join pg_catalog.pg_proc as p on p.oid = t.tgfoid
                  where t.tgrelid = 'public.genie_projects'::pg_catalog.regclass
                    and t.tgname = 'genie_projects_audit' and t.tgenabled = 'O' and t.tgtype = 23
                    and p.oid = 'public.genie_set_project_audit()'::pg_catalog.regprocedure
                    and not p.prosecdef and p.proconfig @> array['search_path=""']::text[])
     or pg_catalog.has_function_privilege('anon', 'public.genie_set_project_audit()', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'public.genie_set_project_audit()', 'EXECUTE') then
    raise exception 'GENIE_PROJECTS_FAIL: %', cell;
  end if;
  raise notice 'PASS %: BEFORE ROW INSERT/UPDATE, invoker, no browser EXECUTE', cell;
  cell := 'A01 SELECT policy only';
  select count(*) into n from pg_catalog.pg_policy as p
    where p.polrelid = 'public.genie_projects'::pg_catalog.regclass;
  if n <> 1 or not exists (select 1 from pg_catalog.pg_policy as p
      where p.polrelid = 'public.genie_projects'::pg_catalog.regclass
        and p.polname = 'genie_projects_member_select' and p.polcmd = 'r'
        and p.polroles = array[(select oid from pg_catalog.pg_roles where rolname = 'authenticated')]) then
    raise exception 'GENIE_PROJECTS_FAIL: % (unexpected policy set)', cell;
  end if;
  raise notice 'PASS %', cell;

  base_data := pg_catalog.jsonb_build_object('id', project_id, 'name', '權限測試', 'date', '2026-10-01');
  changed_data := base_data || '{"name":"更新測試"}'::jsonb;
  new_data := pg_catalog.jsonb_build_object('id', new_id, 'name', '新增測試', 'date', '2026-10-01');
  perform pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  perform pg_catalog.set_config('request.jwt.claim.sub', member_id::text, true);
  cell := 'A02 owner INSERT audit overrides';
  insert into public.genie_projects (id, data, version, created_at, updated_at, updated_by)
    values (project_id, base_data, 99, '2000-01-01'::timestamptz, '2000-01-01'::timestamptz, outsider_id)
    returning * into snapshot;
  if snapshot.version <> 1 or snapshot.created_at is distinct from snapshot.updated_at
     or snapshot.created_at <= '2000-01-01'::timestamptz
     or snapshot.updated_by is distinct from member_id then
    raise exception 'GENIE_PROJECTS_FAIL: %', cell;
  end if;
  raise notice 'PASS %: version=1, server timestamps, auth.uid', cell;
  insert into public.genie_projects (id, data, deleted_at) values (
    deleted_id, pg_catalog.jsonb_build_object('id', deleted_id, 'name', '已刪測試', 'date', '2026-10-01'),
    pg_catalog.clock_timestamp()
  );

  for role_index in 1..4 loop
    execute 'reset role';
    execute pg_catalog.format('set local role %I', owner_name);
    if role_index = 1 then
      role_label := 'anon'; actor_id := null; role_name := 'anon';
    elsif role_index = 2 then
      role_label := '非成員'; actor_id := outsider_id; role_name := 'authenticated';
    elsif role_index = 3 then
      role_label := '停用成員'; actor_id := outsider_id; role_name := 'authenticated';
      cell := 'fixture temporary disabled member';
      insert into public.app_admins (user_id, display_name, active)
        values (outsider_id, '權限測試停用成員', false);
    else
      role_label := '啟用成員'; actor_id := member_id; role_name := 'authenticated';
    end if;
    execute pg_catalog.format('set local role %I', role_name);
    perform pg_catalog.set_config('request.jwt.claims',
      pg_catalog.json_build_object('sub', actor_id, 'role', role_name)::text, true);
    perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(actor_id::text, ''), true);
    cell := role_label || ' role/JWT';
    if current_user is distinct from role_name or auth.uid() is distinct from actor_id then
      raise exception 'GENIE_PROJECTS_FAIL: %', cell;
    end if;
    raise notice 'PASS %', cell;

    cell := 'M01 ' || role_label || ' SELECT including tombstone';
    if role_index = 1 then
      begin
        execute 'select count(*) from public.genie_projects where id in ($1, $2)'
          into n using project_id, deleted_id;
        raise exception 'GENIE_PROJECTS_FAIL: % (expected 42501)', cell;
      exception when insufficient_privilege then raise notice 'PASS %: 42501', cell;
      end;
    else
      execute 'select count(*) from public.genie_projects where id in ($1, $2)'
        into n using project_id, deleted_id;
      if n <> (case when role_index = 4 then 2 else 0 end) then
        raise exception 'GENIE_PROJECTS_FAIL: % (unexpected count %)', cell, n;
      end if;
      if role_index = 4 then
        execute 'select count(*) from public.genie_projects where id = $1 and deleted_at is not null'
          into n using deleted_id;
        if n <> 1 then raise exception 'GENIE_PROJECTS_FAIL: % (tombstone hidden)', cell; end if;
      end if;
      raise notice 'PASS %: expected visible rows', cell;
    end if;

    for case_label, case_sql in select v.label, v.stmt from (values
      ('M02 INSERT', 'insert into public.genie_projects (id, data) values ($1, $2)'),
      ('M02 UPDATE data', 'update public.genie_projects set data = $2 where id = $1'),
      ('M02 DELETE', 'delete from public.genie_projects where id = $1'),
      ('M06 UPDATE id', 'update public.genie_projects set id = id || ''-changed'' where id = $1'),
      ('M06 UPDATE version', 'update public.genie_projects set version = version + 99 where id = $1'),
      ('M06 UPDATE created_at', 'update public.genie_projects set created_at = pg_catalog.clock_timestamp() where id = $1'),
      ('M06 UPDATE updated_at', 'update public.genie_projects set updated_at = pg_catalog.clock_timestamp() where id = $1'),
      ('M06 UPDATE updated_by', 'update public.genie_projects set updated_by = null where id = $1'),
      ('M06 UPDATE deleted_at', 'update public.genie_projects set deleted_at = pg_catalog.clock_timestamp() where id = $1'),
      ('A01 SELECT created_at', 'select created_at from public.genie_projects where id = $1'),
      ('A01 SELECT updated_by', 'select updated_by from public.genie_projects where id = $1'),
      ('A01 SELECT *', 'select * from public.genie_projects where id = $1'),
      ('A01 TRUNCATE', 'truncate table public.genie_projects'),
      ('A01 CREATE TRIGGER', 'create trigger genie_verify_forbidden before update on public.genie_projects for each row execute function public.genie_set_project_audit()')
    ) as v(label, stmt)
    loop
      cell := case_label || ' ' || role_label;
      begin
        execute case_sql using project_id, base_data;
        raise exception 'GENIE_PROJECTS_FAIL: % (expected 42501)', cell;
      exception when insufficient_privilege then raise notice 'PASS %: 42501', cell;
      end;
    end loop;

    if role_index < 4 then
      for case_label, case_sql in select v.label, v.stmt from (values
        ('M03 save insert', 'select public.genie_save_project($1, $2, 0)'),
        ('M03 save current', 'select public.genie_save_project($1, $2, 1)'),
        ('M04 save stale', 'select public.genie_save_project($1, $2, 99)'),
        ('M05 delete current', 'select public.genie_delete_project($1, 1)'),
        ('M05 delete stale', 'select public.genie_delete_project($1, 99)'),
        ('M05 restore current', 'select public.genie_restore_project($1, 1)'),
        ('M05 restore stale', 'select public.genie_restore_project($1, 99)'),
        ('A05 save missing', 'select public.genie_save_project($3, $2, 1)'),
        ('A05 delete missing', 'select public.genie_delete_project($3, 1)'),
        ('A05 restore missing', 'select public.genie_restore_project($3, 1)'),
        ('A04 save invalid args', 'select public.genie_save_project($1, null, -1)')
      ) as v(label, stmt)
      loop
        cell := case_label || ' ' || role_label;
        begin
          execute case_sql into result using project_id, changed_data, missing_id;
          raise exception 'GENIE_PROJECTS_FAIL: % (expected 42501)', cell;
        exception when insufficient_privilege then raise notice 'PASS %: 42501; no row data returned', cell;
        end;
      end loop;
    end if;
  end loop;

  -- 此時角色是第一位 authenticated 啟用成員；RPC 結果採完整 JSON 比對。
  for case_label, case_sql, expected_result in select v.label, v.stmt, v.expected from (values
    ('M03 啟用成員 save insert', 'select public.genie_save_project($1, $2, 0)', '{"status":"saved","version":1}'::jsonb),
    ('A06 same-id contender', 'select public.genie_save_project($1, $2, 0)', '{"status":"conflict","version":1}'::jsonb)
  ) as v(label, stmt, expected)
  loop
    cell := case_label;
    execute case_sql into result using new_id,
      case when case_label = 'A06 same-id contender'
        then new_data || '{"name":"競爭者不得覆寫"}'::jsonb else new_data end;
    if result is distinct from expected_result then
      raise exception 'GENIE_PROJECTS_FAIL: % (expected %, got %)', cell, expected_result, result;
    end if;
    raise notice 'PASS %: %', cell, result;
  end loop;
  cell := 'A06 same-id contender leaves winner intact';
  execute 'select count(*) from public.genie_projects where id = $1 and data = $2 and version = 1'
    into n using new_id, new_data;
  if n <> 1 then raise exception 'GENIE_PROJECTS_FAIL: %', cell; end if;
  raise notice 'PASS %', cell;
  cell := 'M03 啟用成員 save current update';
  execute 'select public.genie_save_project($1, $2, 1)' into result using project_id, changed_data;
  if result is distinct from '{"status":"saved","version":2}'::jsonb then
    raise exception 'GENIE_PROJECTS_FAIL: % (got %)', cell, result;
  end if;
  raise notice 'PASS %: %', cell, result;

  execute 'reset role';
  execute pg_catalog.format('set local role %I', owner_name);
  cell := 'A02 audit immediately after save update';
  select * into next_snapshot from public.genie_projects where id = project_id;
  if next_snapshot.version <> 2 or next_snapshot.created_at is distinct from snapshot.created_at
     or next_snapshot.updated_at < snapshot.updated_at
     or next_snapshot.updated_by is distinct from member_id then
    raise exception 'GENIE_PROJECTS_FAIL: %', cell;
  end if;
  snapshot := next_snapshot;
  raise notice 'PASS %', cell;
  execute 'set local role authenticated';

  -- 每個衝突/unchanged 呼叫後核对列內容與 deleted_at；後面以 owner 查全部稽核欄。
  for case_label, case_sql, expected_result in select v.label, v.stmt, v.expected from (values
    ('M04 啟用成員 save stale / A06 same-version contender', 'select public.genie_save_project($1, $2, 1)', '{"status":"conflict","version":2}'::jsonb),
    ('A02 save unchanged', 'select public.genie_save_project($1, $3, 2)', '{"status":"unchanged","version":2}'::jsonb),
    ('M05 啟用成員 delete stale', 'select public.genie_delete_project($1, 1)', '{"status":"conflict","version":2}'::jsonb),
    ('M05 啟用成員 restore stale', 'select public.genie_restore_project($1, 1)', '{"status":"conflict","version":2}'::jsonb),
    ('A02 restore unchanged', 'select public.genie_restore_project($1, 2)', '{"status":"unchanged","version":2}'::jsonb)
  ) as v(label, stmt, expected)
  loop
    cell := case_label;
    execute case_sql into result using project_id, base_data, changed_data;
    if result is distinct from expected_result then
      raise exception 'GENIE_PROJECTS_FAIL: % (expected %, got %)', cell, expected_result, result;
    end if;
    execute 'select count(*) from public.genie_projects where id = $1 and data = $2 and version = 2 and deleted_at is null'
      into n using project_id, changed_data;
    if n <> 1 then raise exception 'GENIE_PROJECTS_FAIL: % (row changed)', cell; end if;
    raise notice 'PASS %: %, row unchanged', cell, result;
  end loop;

  execute 'reset role';
  execute pg_catalog.format('set local role %I', owner_name);
  cell := 'A02 audit after update/unchanged/conflict';
  select * into next_snapshot from public.genie_projects where id = project_id;
  if next_snapshot is distinct from snapshot then
    raise exception 'GENIE_PROJECTS_FAIL: %', cell;
  end if;
  snapshot := next_snapshot;
  -- 無資料變動時，擁有者也不能透過 trigger 改 id/version/稽核欄位。
  update public.genie_projects set id = id || '-forged', version = 999,
    created_at = '2000-01-01', updated_at = '2000-01-01', updated_by = outsider_id
    where id = project_id returning * into next_snapshot;
  if next_snapshot is distinct from snapshot then
    raise exception 'GENIE_PROJECTS_FAIL: A02 trigger preserves immutable/audit fields on no-op';
  end if;
  raise notice 'PASS %; trigger no-op preserved full row', cell;
  execute 'set local role authenticated';

  for case_label, case_sql, expected_result in select v.label, v.stmt, v.expected from (values
    ('M05 啟用成員 delete current', 'select public.genie_delete_project($1, 2)', '{"status":"deleted","version":3}'::jsonb),
    ('M05 delete old version after delete', 'select public.genie_delete_project($1, 2)', '{"status":"conflict","version":3}'::jsonb),
    ('A02 delete unchanged', 'select public.genie_delete_project($1, 3)', '{"status":"unchanged","version":3}'::jsonb),
    ('A05 save cannot revive tombstone', 'select public.genie_save_project($1, $2, 3)', '{"status":"conflict","version":3}'::jsonb),
    ('A05 save insert cannot replace tombstone', 'select public.genie_save_project($1, $2, 0)', '{"status":"conflict","version":3}'::jsonb),
    ('M05 restore stale on tombstone', 'select public.genie_restore_project($1, 2)', '{"status":"conflict","version":3}'::jsonb)
  ) as v(label, stmt, expected)
  loop
    cell := case_label;
    execute case_sql into result using project_id, changed_data;
    if result is distinct from expected_result then
      raise exception 'GENIE_PROJECTS_FAIL: % (expected %, got %)', cell, expected_result, result;
    end if;
    execute 'select count(*) from public.genie_projects where id = $1 and data = $2 and version = 3 and deleted_at is not null'
      into n using project_id, changed_data;
    if n <> 1 then raise exception 'GENIE_PROJECTS_FAIL: % (tombstone changed/hidden)', cell; end if;
    if case_label = 'M05 啟用成員 delete current' then
      execute 'reset role';
      execute pg_catalog.format('set local role %I', owner_name);
      cell := 'A02 audit immediately after delete';
      select * into next_snapshot from public.genie_projects where id = project_id;
      if next_snapshot.version <> 3 or next_snapshot.data is distinct from snapshot.data
         or next_snapshot.created_at is distinct from snapshot.created_at
         or next_snapshot.updated_at < snapshot.updated_at or next_snapshot.deleted_at is null
         or next_snapshot.updated_by is distinct from member_id then
        raise exception 'GENIE_PROJECTS_FAIL: %', cell;
      end if;
      snapshot := next_snapshot;
      execute 'set local role authenticated';
      cell := case_label;
    end if;
    raise notice 'PASS %: %; tombstone visible', cell, result;
  end loop;
  execute 'reset role';
  execute pg_catalog.format('set local role %I', owner_name);
  cell := 'A02 delete audit';
  select * into next_snapshot from public.genie_projects where id = project_id;
  if next_snapshot is distinct from snapshot then
    raise exception 'GENIE_PROJECTS_FAIL: %', cell;
  end if;
  snapshot := next_snapshot;
  raise notice 'PASS %: server deletion time and audit', cell;
  execute 'set local role authenticated';
  cell := 'M05 啟用成員 restore current';
  execute 'select public.genie_restore_project($1, 3)' into result using project_id;
  if result is distinct from '{"status":"restored","version":4}'::jsonb then
    raise exception 'GENIE_PROJECTS_FAIL: % (got %)', cell, result;
  end if;
  raise notice 'PASS %: %', cell, result;
  for case_label, case_sql in select v.label, v.stmt from (values
    ('A05 save missing', 'select public.genie_save_project($1, $2, 1)'),
    ('A05 delete missing', 'select public.genie_delete_project($1, 1)'),
    ('A05 restore missing', 'select public.genie_restore_project($1, 1)')
  ) as v(label, stmt)
  loop
    cell := case_label;
    execute case_sql into result using missing_id, changed_data;
    if result is distinct from '{"status":"not_found","version":null}'::jsonb then
      raise exception 'GENIE_PROJECTS_FAIL: % (got %)', cell, result;
    end if;
    raise notice 'PASS %: %', cell, result;
  end loop;

  for case_label, invalid_data in select v.label, v.payload from (values
    ('object required', '[]'::jsonb),
    ('missing id', '{"name":"測試","date":"2026-10-01"}'::jsonb),
    ('id mismatch', pg_catalog.jsonb_build_object('id', invalid_id || '-wrong', 'name', '測試', 'date', '2026-10-01')),
    ('missing name', pg_catalog.jsonb_build_object('id', invalid_id, 'date', '2026-10-01')),
    ('missing date', pg_catalog.jsonb_build_object('id', invalid_id, 'name', '測試')),
    ('null name', pg_catalog.jsonb_build_object('id', invalid_id, 'name', null, 'date', '2026-10-01')),
    ('numeric name', pg_catalog.jsonb_build_object('id', invalid_id, 'name', 123, 'date', '2026-10-01')),
    ('numeric date', pg_catalog.jsonb_build_object('id', invalid_id, 'name', '測試', 'date', 123)),
    ('exact 1000000-byte boundary', pg_catalog.jsonb_build_object('id', invalid_id, 'name', '測試', 'date', '2026-10-01', 'padding',
      pg_catalog.repeat('x', 1000000 - pg_catalog.octet_length(
        pg_catalog.jsonb_build_object('id', invalid_id, 'name', '測試', 'date', '2026-10-01', 'padding', '')::text)))),
    ('oversize JSON', pg_catalog.jsonb_build_object('id', invalid_id, 'name', '測試', 'date', '2026-10-01', 'padding', pg_catalog.repeat('x', 1000000))),
    ('oversize UTF8 bytes', pg_catalog.jsonb_build_object('id', invalid_id, 'name', '測試', 'date', '2026-10-01', 'padding', pg_catalog.repeat('界', 340000)))
  ) as v(label, payload)
  loop
    cell := 'A04 JSON ' || case_label;
    begin
      execute 'select public.genie_save_project($1, $2, 0)' into result using invalid_id, invalid_data;
      raise exception 'GENIE_PROJECTS_FAIL: % (expected 23514)', cell;
    exception when check_violation then raise notice 'PASS %: 23514', cell;
    end;
  end loop;
  for case_label, case_sql in select v.label, v.stmt from (values
    ('save null version', 'select public.genie_save_project($1, $2, null)'),
    ('save negative version', 'select public.genie_save_project($1, $2, -1)'),
    ('delete zero version', 'select public.genie_delete_project($1, 0)'),
    ('delete null version', 'select public.genie_delete_project($1, null)'),
    ('restore negative version', 'select public.genie_restore_project($1, -1)'),
    ('restore null version', 'select public.genie_restore_project($1, null)')
  ) as v(label, stmt)
  loop
    cell := 'A04 parameter ' || case_label;
    begin
      execute case_sql into result using project_id, changed_data;
      raise exception 'GENIE_PROJECTS_FAIL: % (expected 22023)', cell;
    exception when invalid_parameter_value then raise notice 'PASS %: 22023', cell;
    end;
  end loop;
  cell := 'A04 null data';
  begin
    execute 'select public.genie_save_project($1, null, 0)' into result using invalid_id;
    raise exception 'GENIE_PROJECTS_FAIL: % (expected 23502)', cell;
  exception when not_null_violation then raise notice 'PASS %: 23502', cell;
  end;
  cell := 'A04 invalid update rejected atomically';
  begin
    execute 'select public.genie_save_project($1, $2, 4)' into result using project_id, changed_data - 'name';
    raise exception 'GENIE_PROJECTS_FAIL: % (expected 23514)', cell;
  exception when check_violation then raise notice 'PASS %: 23514', cell;
  end;

  -- 擁有者確認失敗操作沒留下列；將原本的暫時停用成員改成第二啟用成員。
  execute 'reset role';
  execute pg_catalog.format('set local role %I', owner_name);
  cell := 'A02 restore audit / A04 failed writes unchanged';
  select * into next_snapshot from public.genie_projects where id = project_id;
  if next_snapshot.version <> 4 or next_snapshot.deleted_at is not null
     or next_snapshot.data is distinct from snapshot.data
     or next_snapshot.created_at is distinct from snapshot.created_at
     or next_snapshot.updated_at < snapshot.updated_at
     or next_snapshot.updated_by is distinct from member_id
     or exists (select 1 from public.genie_projects where id in (invalid_id, missing_id)) then
    raise exception 'GENIE_PROJECTS_FAIL: %', cell;
  end if;
  snapshot := next_snapshot;
  raise notice 'PASS %', cell;
  update public.app_admins set active = true where user_id = outsider_id;
  perform pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', outsider_id, 'role', 'authenticated')::text, true);
  perform pg_catalog.set_config('request.jwt.claim.sub', outsider_id::text, true);
  execute 'set local role authenticated';
  cell := 'A03 second member reads first member project/tombstone';
  execute 'select count(*) from public.genie_projects where id in ($1, $2)'
    into n using project_id, deleted_id;
  if n <> 2 then raise exception 'GENIE_PROJECTS_FAIL: % (got % rows)', cell, n; end if;
  raise notice 'PASS %: 2 rows', cell;
  cell := 'A03 second member writes first member project';
  execute 'select public.genie_save_project($1, $2, 4)' into result
    using project_id, changed_data || '{"name":"第二成員更新"}'::jsonb;
  if result is distinct from '{"status":"saved","version":5}'::jsonb then
    raise exception 'GENIE_PROJECTS_FAIL: % (got %)', cell, result;
  end if;
  raise notice 'PASS %: %', cell, result;
  execute 'reset role';
  execute pg_catalog.format('set local role %I', owner_name);
  cell := 'A03 second member audit';
  select * into next_snapshot from public.genie_projects where id = project_id;
  if next_snapshot.version <> 5 or next_snapshot.updated_by is distinct from outsider_id
     or next_snapshot.created_at is distinct from snapshot.created_at
     or next_snapshot.updated_at < snapshot.updated_at then
    raise exception 'GENIE_PROJECTS_FAIL: %', cell;
  end if;
  raise notice 'PASS %: updated_by changed to second member', cell;

  -- 同一交易中停用後，既有 JWT 不變仍須立即禁止 RPC/SELECT。
  cell := 'A03 membership recheck after deactivation';
  update public.app_admins set active = false where user_id = outsider_id;
  execute 'set local role authenticated';
  execute 'select count(*) from public.genie_projects where id = $1' into n using project_id;
  if n <> 0 then raise exception 'GENIE_PROJECTS_FAIL: % (SELECT visible)', cell; end if;
  for case_sql in select v.stmt from (values
    ('select public.genie_save_project($1, $2, 5)'),
    ('select public.genie_delete_project($1, 5)'),
    ('select public.genie_restore_project($1, 5)')
  ) as v(stmt)
  loop
    cell := 'A03 membership recheck ' || case_sql;
    begin
      execute case_sql into result using project_id, changed_data;
      raise exception 'GENIE_PROJECTS_FAIL: % (expected 42501)', cell;
    exception when insufficient_privilege then raise notice 'PASS %: 42501', cell;
    end;
  end loop;

  execute 'reset role';
  execute pg_catalog.format('set local role %I', owner_name);
  cell := 'A06 concurrency structure: primary key and row locks';
  if not exists (select 1 from pg_catalog.pg_constraint as c
                  where c.conrelid = 'public.genie_projects'::pg_catalog.regclass and c.contype = 'p'
                    and c.conkey = array[(select a.attnum from pg_catalog.pg_attribute as a
                      where a.attrelid = c.conrelid and a.attname = 'id')]::smallint[])
     or exists (select 1 from pg_catalog.pg_proc as p
                  where p.oid in ('public.genie_save_project(text,jsonb,integer)'::pg_catalog.regprocedure,
                                  'public.genie_delete_project(text,integer)'::pg_catalog.regprocedure,
                                  'public.genie_restore_project(text,integer)'::pg_catalog.regprocedure)
                    and pg_catalog.lower(p.prosrc) not like '%for update%') then
    raise exception 'GENIE_PROJECTS_FAIL: %', cell;
  end if;
  raise notice 'PASS %: structure only; sequential contenders checked in A06', cell;
  raise notice 'PENDING C01/C02: actual two-connection concurrent INSERT/UPDATE; not executed by this rollback-only DO';
  raise notice 'PENDING REST/RPC: live publishable-key anon requests';
  raise exception 'GENIE_PROJECTS_OK: all SQL matrix checks passed (rolled back); live concurrency/REST checks remain separate';
exception when others then
  if sqlerrm like 'GENIE_PROJECTS_OK:%' or sqlerrm like 'GENIE_PROJECTS_FAIL:%' then
    raise;
  end if;
  raise exception 'GENIE_PROJECTS_FAIL: % (SQLSTATE %, %)', cell, sqlstate, sqlerrm;
end;
$verify$;
