-- Run only in the isolated test project; restore-drill.sh prepares /work metadata.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
BEGIN;
SET search_path = '';
CREATE TEMP TABLE expected_tables (name text PRIMARY KEY, rows bigint NOT NULL CHECK(rows>=0), rls boolean NOT NULL, force_rls boolean NOT NULL);
CREATE TEMP TABLE expected_fks (tbl text, name text, definition text, PRIMARY KEY(tbl,name));
CREATE TEMP TABLE expected_rpcs (signature text PRIMARY KEY, definer boolean, authenticated_exec boolean, anon_exec boolean, public_exec boolean, service_exec boolean);
CREATE TEMP TABLE expected_sequences (name text PRIMARY KEY, value bigint, called boolean);
\copy pg_temp.expected_tables FROM '/work/table.tsv'
\copy pg_temp.expected_fks FROM '/work/fk.tsv'
\copy pg_temp.expected_rpcs FROM '/work/rpc.tsv'
\copy pg_temp.expected_sequences FROM '/work/sequence.tsv'
DO $verify$
DECLARE r record; actual bigint; c record; proc oid; pub boolean;
 last_val bigint; was_called boolean; next_val numeric; extreme numeric;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_temp.expected_tables WHERE name='customer_leads' AND rows>0)
 OR NOT EXISTS (SELECT 1 FROM pg_temp.expected_tables WHERE name='genie_projects')
 THEN RAISE EXCEPTION 'required table metadata missing'; END IF;
 IF (SELECT count(*) FROM pg_temp.expected_tables) <> (
 SELECT count(*) FROM pg_catalog.pg_class x JOIN pg_catalog.pg_namespace n ON n.oid=x.relnamespace
 WHERE n.nspname='public' AND x.relkind IN ('r','p'))
 THEN RAISE EXCEPTION 'table inventory mismatch'; END IF;
 FOR r IN SELECT * FROM pg_temp.expected_tables LOOP
  SELECT x.relrowsecurity, x.relforcerowsecurity INTO c FROM pg_catalog.pg_class x
  JOIN pg_catalog.pg_namespace n ON n.oid=x.relnamespace WHERE n.nspname='public' AND x.relname=r.name AND x.relkind IN ('r','p');
  IF NOT FOUND OR c.relrowsecurity<>r.rls OR c.relforcerowsecurity<>r.force_rls
  THEN RAISE EXCEPTION 'RLS mismatch'; END IF;
  IF r.name IN ('customer_leads','genie_projects','app_admins') AND NOT c.relrowsecurity
  THEN RAISE EXCEPTION 'required RLS disabled'; END IF;
  EXECUTE pg_catalog.format('SELECT count(*) FROM public.%I',r.name) INTO actual;
  IF actual<>r.rows THEN RAISE EXCEPTION 'row count mismatch'; END IF;
 END LOOP;
 -- All overloads must match the archived ACL, and the four named RPCs must be protected.
 IF (SELECT count(DISTINCT split_part(signature,'(',1)) FROM pg_temp.expected_rpcs)<>4
 THEN RAISE EXCEPTION 'four RPCs required'; END IF;
 FOR r IN SELECT * FROM pg_temp.expected_rpcs LOOP
  proc := pg_catalog.to_regprocedure(r.signature);
  IF proc IS NULL THEN RAISE EXCEPTION 'RPC missing'; END IF;
  SELECT x.prosecdef INTO pub FROM pg_catalog.pg_proc x WHERE x.oid=proc;
  IF pub IS DISTINCT FROM r.definer OR NOT pub
  OR NOT r.authenticated_exec OR r.anon_exec OR r.public_exec
  OR pg_catalog.has_function_privilege('authenticated',proc,'EXECUTE') IS DISTINCT FROM r.authenticated_exec
  OR pg_catalog.has_function_privilege('anon',proc,'EXECUTE') IS DISTINCT FROM r.anon_exec
  OR pg_catalog.has_function_privilege('service_role',proc,'EXECUTE') IS DISTINCT FROM r.service_exec
  THEN RAISE EXCEPTION 'RPC privilege mismatch'; END IF;
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_proc x,
   LATERAL pg_catalog.aclexplode(COALESCE(x.proacl,pg_catalog.acldefault('f',x.proowner))) a
   WHERE x.oid=proc AND a.grantee=0 AND a.privilege_type='EXECUTE') INTO pub;
  IF pub IS DISTINCT FROM r.public_exec THEN RAISE EXCEPTION 'PUBLIC RPC privilege mismatch'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_temp.expected_fks)<>(
 SELECT count(*) FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class x ON x.oid=k.conrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=x.relnamespace WHERE n.nspname='public' AND k.contype='f')
 THEN RAISE EXCEPTION 'foreign key inventory mismatch'; END IF;
 FOR r IN SELECT * FROM pg_temp.expected_fks LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
   WHERE k.conrelid=pg_catalog.to_regclass(pg_catalog.format('public.%I',r.tbl))
   AND k.conname=r.name AND k.contype='f' AND k.convalidated
   AND pg_catalog.pg_get_constraintdef(k.oid)=r.definition)
  THEN RAISE EXCEPTION 'foreign key mismatch or unvalidated'; END IF;
 END LOOP;
 IF EXISTS (SELECT 1 FROM public.app_admins a LEFT JOIN auth.users u ON u.id=a.user_id WHERE u.id IS NULL)
 OR EXISTS (SELECT 1 FROM public.flows f LEFT JOIN auth.users u ON u.id=f.published_by
 WHERE f.published_by IS NOT NULL AND u.id IS NULL)
 THEN RAISE EXCEPTION 'auth reference missing'; END IF;
 IF (SELECT count(*) FROM pg_temp.expected_sequences)<>(
 SELECT count(*) FROM pg_catalog.pg_class x JOIN pg_catalog.pg_namespace n ON n.oid=x.relnamespace
 WHERE n.nspname='public' AND x.relkind='S')
 THEN RAISE EXCEPTION 'sequence inventory mismatch'; END IF;
 FOR r IN SELECT * FROM pg_temp.expected_sequences LOOP
  EXECUTE pg_catalog.format('SELECT last_value,is_called FROM public.%I',r.name) INTO last_val,was_called;
  IF last_val<>r.value OR was_called<>r.called THEN RAISE EXCEPTION 'sequence value mismatch'; END IF;
  SELECT s.seqincrement,s.seqmin,s.seqmax,s.seqcycle,
   t.relname AS tbl,a.attname AS col INTO c FROM pg_catalog.pg_sequence s
   LEFT JOIN pg_catalog.pg_depend d ON d.objid=s.seqrelid AND d.deptype IN ('a','i')
   LEFT JOIN pg_catalog.pg_class t ON t.oid=d.refobjid
   LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid
   WHERE s.seqrelid=pg_catalog.to_regclass(pg_catalog.format('public.%I',r.name));
  next_val := last_val::numeric + CASE WHEN was_called THEN c.seqincrement ELSE 0 END;
  IF next_val<c.seqmin OR next_val>c.seqmax OR c.seqcycle THEN RAISE EXCEPTION 'sequence exhausted or cycling'; END IF;
  IF c.tbl IS NOT NULL THEN
   EXECUTE pg_catalog.format('SELECT %s(%I) FROM public.%I',
    CASE WHEN c.seqincrement>0 THEN 'max' ELSE 'min' END,c.col,c.tbl) INTO extreme;
   IF (c.seqincrement>0 AND next_val<=extreme) OR (c.seqincrement<0 AND next_val>=extreme)
   THEN RAISE EXCEPTION 'sequence would collide'; END IF;
  END IF;
 END LOOP;
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class x ON x.oid=t.tgrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=x.relnamespace
 WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgenabled<>'D')
 THEN RAISE EXCEPTION 'test notification/audit trigger still enabled'; END IF;
END $verify$;
ROLLBACK;
SELECT 'BACKUP_RESTORE_OK';
