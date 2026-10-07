#!/bin/sh
# v8.3: restore only an explicitly registered, empty test project.
umask 077
set -u
fail() { printf '%s\n' "RESTORE_FAILED: $1" >&2; exit 1; }
private_file() {
    [ -f "$1" ] && [ ! -L "$1" ] || fail 'private file missing'
    mode=$(stat -c '%a' "$1") || fail 'file permission check'
    [ "$mode" = 600 ] || fail 'private file must be 0600'
}
config=${1:-/etc/genie-backup/restore.env}
private_file "$config"
unset PGPASSWORD PGSERVICE PGSERVICEFILE PGHOSTADDR PGOPTIONS PGSSLMODE
. "$config" >/dev/null 2>&1 || fail 'configuration'
unset PGPASSWORD PGSERVICE PGSERVICEFILE PGHOSTADDR PGOPTIONS
: "${PROJECT_REF:?}" "${TEST_PROJECT_REF:?}" "${PGHOST:?}" "${TEST_POOLER_HOST:?}" "${PG_MAJOR:?}"
# Shared pooler hosts can serve production AND test: check the ref and username too.
production=llqwzrgzekalwdnetvyb
[ "$PROJECT_REF" != "$production" ] && [ "$TEST_PROJECT_REF" != "$production" ] || fail 'production ref forbidden'
[ "$PROJECT_REF" = "$TEST_PROJECT_REF" ] && [ "$PGHOST" = "$TEST_POOLER_HOST" ] || fail 'target not registered'
case "$PROJECT_REF" in ''|*[!a-z0-9-]*) fail 'project ref';; esac
case "$PGHOST" in *.pooler.supabase.com) ;; *) fail 'session pooler host';; esac
case "$PGHOST" in *[!a-zA-Z0-9.-]*) fail 'session pooler host characters';; esac
PGUSER="postgres.$PROJECT_REF"; PGPORT=5432; PGDATABASE=postgres
PGSSLMODE=require; PGCONNECT_TIMEOUT=15; PGPASSFILE=/run/secrets/pgpass
passfile=${PASSFILE:-/etc/genie-backup/restore-pgpass}
mapping=${UUID_MAP_FILE:-/etc/genie-backup/uuid-map.csv}
private_file "$passfile"; private_file "$mapping"
awk -F: -v h="$PGHOST" -v u="$PGUSER" '
 /^[[:space:]]*#/ || /^[[:space:]]*$/ {next}
 {n++; if ($1!=h || $2!="5432" || $3!="postgres" || $4!=u || NF<5) bad=1}
 END {exit (n!=1 || bad)}' "$passfile" || fail 'passfile target'
archive=${2:-}; [ -n "$archive" ] || fail 'dump path required'
directory=$(dirname "$archive") || fail 'dump directory'
directory=$(cd "$directory" && pwd -P) || fail 'dump directory'
name=${archive##*/}
case "$name" in genie-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z.dump) ;; *) fail 'dump filename';; esac
base=${name%.dump}; archive="$directory/$name"
manifest="$directory/$base.manifest"; members="$directory/$base.members.csv"
private_file "$archive"; private_file "$manifest"; private_file "$members"
seconds=${TIMEOUT_SECONDS:-3600}
for number in "$seconds" "$PG_MAJOR"; do
    case "$number" in ''|*[!0-9]*) fail 'numeric configuration';; esac
done
[ "$seconds" -ge 60 ] && [ "$PG_MAJOR" -ge 14 ] || fail 'version or timeout'
for command in docker timeout awk sha256sum mktemp; do
    command -v "$command" >/dev/null 2>&1 || fail 'required executable missing'
done
work=$(mktemp -d /var/lib/genie-backup/.restore.XXXXXXXX) || fail 'private temporary directory'
container="genie-restore-${work##*/}-$$"
locked=0
cleanup() {
    rc=$?; trap - 0
    docker rm -f "$container" >/dev/null 2>&1 || :
    rm -rf -- "$work" >/dev/null 2>&1 || :
    if [ "$locked" = 1 ]; then rmdir "$lock" >/dev/null 2>&1 || :; fi
    exit "$rc"
}
trap cleanup 0
trap 'exit 1' HUP INT TERM
# A separate lock serializes all restore attempts on this VPS.
lock=/var/lib/genie-backup/.restore-lock
mkdir "$lock" 2>/dev/null || fail 'restore already running (or stale lock)'
locked=1
cp "$archive" "$work/archive.dump" || fail 'copy archive'
cp "$mapping" "$work/uuid-map.csv" || fail 'copy UUID mapping'
cp "$manifest" "$work/manifest" || fail 'copy manifest'
hash=$(sha256sum "$work/archive.dump" 2>/dev/null) || fail 'checksum'; hash=${hash%% *}
members_hash=$(sha256sum "$members" 2>/dev/null) || fail 'members checksum'; members_hash=${members_hash%% *}
awk -F '\t' -v b="$base" -v h="$hash" -v m="$members_hash" '
 $1=="format" {format++; if ($2!="genie-backup-v1") bad=1}
 $1=="dump_file" {file++; if ($2!=b".dump") bad=1}
 $1=="dump_sha256" {hash++; if ($2!=h) bad=1}
 $1=="members_file" {members++; if ($2!=b".members.csv") bad=1}
 $1=="members_sha256" {mh++; if ($2!=m) bad=1}
 END {exit (bad || format!=1 || file!=1 || hash!=1 || members!=1 || mh!=1)}' "$work/manifest" || fail 'manifest integrity'
for kind in table fk rpc sequence; do
    awk -F '\t' -v k="$kind" '$1==k {sub(/^[^\t]*\t/, ""); print}' "$work/manifest" \
        >"$work/$kind.tsv" || fail 'manifest metadata'
done
[ -s "$work/table.tsv" ] && [ -s "$work/rpc.tsv" ] || fail 'manifest metadata missing'
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P) || fail 'script directory'
cp "$script_dir/verify-restore.sql" "$work/verify-restore.sql" || fail 'verification SQL'
cat >"$work/prepare.sql" <<'SQL'
\set ON_ERROR_STOP on
DO $guard$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m','f'))
 THEN RAISE EXCEPTION 'target public is not empty'; END IF;
 IF to_regprocedure('supabase_functions.http_request()') IS NULL
 THEN RAISE EXCEPTION 'enable Database Webhooks support first'; END IF;
END $guard$;
SQL
[ "$?" -eq 0 ] || fail 'prepare SQL'
cat >"$work/remap.sql" <<'SQL'
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE uuid_map (old_id uuid PRIMARY KEY, new_id uuid UNIQUE);
\copy uuid_map FROM '/work/uuid-map.csv' WITH (FORMAT csv, HEADER true)
DO $check$ BEGIN
 -- At this stage no user triggers should exist. Do not use replica mode to hide FK errors.
 IF EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal)
 THEN RAISE EXCEPTION 'unexpected trigger before remap'; END IF;
 IF EXISTS (SELECT 1 FROM uuid_map m LEFT JOIN auth.users u ON u.id=m.new_id
            WHERE m.new_id IS NOT NULL AND u.id IS NULL)
 THEN RAISE EXCEPTION 'mapped test account missing'; END IF;
 IF EXISTS (SELECT 1 FROM public.app_admins a LEFT JOIN uuid_map m ON m.old_id=a.user_id
            WHERE m.new_id IS NULL)
 THEN RAISE EXCEPTION 'every admin requires a new account mapping'; END IF;
 IF EXISTS (SELECT 1 FROM public.flows f LEFT JOIN uuid_map m ON m.old_id=f.published_by
            WHERE f.published_by IS NOT NULL AND m.old_id IS NULL)
 THEN RAISE EXCEPTION 'publisher mapping missing'; END IF;
 IF EXISTS (SELECT 1 FROM uuid_map WHERE new_id IS NULL) AND EXISTS (
 SELECT 1 FROM pg_attribute WHERE attrelid='public.flows'::regclass
 AND attname='published_by' AND attnotnull)
 THEN RAISE EXCEPTION 'publisher cannot be NULL'; END IF;
 -- Avoid swaps/collisions with existing old IDs, even without the PK (post-data).
 IF EXISTS (SELECT 1 FROM uuid_map m JOIN uuid_map other ON other.old_id=m.new_id
            WHERE m.old_id<>m.new_id)
 THEN RAISE EXCEPTION 'overlapping old/new IDs require a fresh test project'; END IF;
END $check$;
UPDATE public.app_admins a SET user_id=m.new_id FROM uuid_map m WHERE a.user_id=m.old_id;
UPDATE public.flows f SET published_by=m.new_id FROM uuid_map m WHERE f.published_by=m.old_id;
-- Existing audit UUIDs are historical values; no auth FK is known for updated_by.
COMMIT;
SQL
[ "$?" -eq 0 ] || fail 'mapping SQL'
cat >"$work/post-wrapper.sql" <<'SQL'
\set ON_ERROR_STOP on
BEGIN;
\i /work/post.sql
-- New Supabase projects auto-grant EXECUTE/table privileges to anon, authenticated and
-- service_role through platform default privileges; pg_dump only replays the source's
-- grants. Reset those roles on every public object, then replay the archived ACLs exactly.
DO $reset$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', r.f);
 END LOOP;
 FOR r IN SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f','S') LOOP
 EXECUTE format('REVOKE ALL ON %s public.%I FROM PUBLIC, anon, authenticated, service_role',
  CASE WHEN r.relkind='S' THEN 'SEQUENCE' ELSE 'TABLE' END, r.relname);
 END LOOP;
END $reset$;
\i /work/acl.sql
-- Disable all public USER triggers within the same transaction as their creation.
-- Constraint triggers stay enabled. No table mutation occurs after post-data.
DO $disable$ DECLARE r record; BEGIN
 FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p') LOOP
 EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER',r.relname);
 END LOOP;
END $disable$;
COMMIT;
SQL
[ "$?" -eq 0 ] || fail 'post-data SQL'
cat >"$work/worker.sh" <<'WORKER'
#!/bin/sh
set -u
cd /work || exit 1
# Record the stage and only the primary ERROR line (terse; no SQL text, rows or secrets).
step() {
    printf '%s\n' "$1" >stage; shift
    "$@" >/dev/null 2>err && return 0
    grep -m1 'ERROR' err | sed 's/^.*ERROR: */ERROR: /' | cut -c1-160 >error
    exit 1
}
printf '%s\n' 'toc' >stage; pg_restore -l archive.dump >toc 2>err || exit 1
# New Supabase already owns public and its platform default privileges.
# Skip the CREATE SCHEMA item and DEFAULT ACL items (postgres cannot alter
# supabase_admin's defaults; the new project already has its own).
awk '!/ SCHEMA - public / && !/ DEFAULT ACL /' toc >restore.list || exit 1
step 'prepare (target must be empty, webhooks enabled)' psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=terse -f prepare.sql
step 'pre-data' pg_restore --exit-on-error --no-owner --section=pre-data --use-list=restore.list --dbname=postgres archive.dump
step 'data' pg_restore --exit-on-error --no-owner --section=data --use-list=restore.list --dbname=postgres archive.dump
step 'uuid remap' psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=terse -f remap.sql
awk '$4=="ACL" && !/ SCHEMA - public /' toc >acl.list || exit 1
step 'acl extract' pg_restore --exit-on-error --no-owner --use-list=acl.list --file=acl.sql archive.dump
step 'post-data extract' pg_restore --exit-on-error --no-owner --section=post-data --use-list=restore.list --file=post.sql archive.dump
step 'post-data apply' psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=terse -f post-wrapper.sql
printf '%s\n' 'verification' >stage
psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=terse -f verify-restore.sql >verify.out 2>err || {
    grep -m1 'ERROR' err | sed 's/^.*ERROR: */ERROR: /' | cut -c1-160 >error; exit 1; }
grep -qx 'BACKUP_RESTORE_OK' verify.out || exit 1
WORKER
[ "$?" -eq 0 ] || fail 'worker preparation'
export PGHOST PGUSER PGPORT PGDATABASE PGSSLMODE PGCONNECT_TIMEOUT PGPASSFILE
timeout --signal=TERM --kill-after=20 "$seconds" docker run --rm --name "$container" \
    --user 0:0 --read-only --cap-drop ALL --security-opt no-new-privileges \
    --tmpfs /tmp:rw,noexec,nosuid,size=64m \
    --mount "type=bind,src=$work,dst=/work" \
    --mount "type=bind,src=$passfile,dst=/run/secrets/pgpass,readonly" \
    --env PGHOST --env PGUSER --env PGPORT --env PGDATABASE --env PGSSLMODE \
    --env PGCONNECT_TIMEOUT --env PGPASSFILE \
    --entrypoint /bin/sh "postgres:$PG_MAJOR-alpine" /work/worker.sh \
    >/dev/null 2>&1 || {
        stage=$(cat "$work/stage" 2>/dev/null || printf 'container start')
        reason=$(cat "$work/error" 2>/dev/null || :)
        fail "$stage: ${reason:-no error text} (test project may be partial; clear its public schema or recreate it)"
    }
printf '%s\n' 'BACKUP_RESTORE_OK' 'REST_LOGIN_CHECK_REQUIRED: read leads and projects as a test member'
