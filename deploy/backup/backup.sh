#!/bin/sh
# v8.3: one-shot container, private snapshot, fail-closed publication.
umask 077
set -u
fail() { printf '%s\n' "BACKUP_FAILED: $1" >&2; exit 1; }
private_file() {
    [ -f "$1" ] && [ ! -L "$1" ] || fail 'private file missing'
    mode=$(stat -c '%a' "$1") || fail 'file permission check'
    [ "$mode" = 600 ] || fail 'private file must be 0600'
}
config=${1:-/etc/genie-backup/backup.env}
private_file "$config"
# Trusted administrator-owned POSIX assignments, never shell tracing.
unset PGPASSWORD PGSERVICE PGSERVICEFILE PGHOSTADDR PGOPTIONS PGSSLMODE
. "$config" >/dev/null 2>&1 || fail 'configuration'
unset PGPASSWORD PGSERVICE PGSERVICEFILE PGHOSTADDR PGOPTIONS
: "${PROJECT_REF:?}" "${PGHOST:?}" "${PG_MAJOR:?}" "${HEALTHCHECK_URL:?}"
PGUSER="postgres.$PROJECT_REF"; PGPORT=5432; PGDATABASE=postgres
PGSSLMODE=require; PGCONNECT_TIMEOUT=15; PGPASSFILE=/run/secrets/pgpass
passfile=${PASSFILE:-/etc/genie-backup/pgpass}
dir=${BACKUP_DIR:-/var/lib/genie-backup}
seconds=${TIMEOUT_SECONDS:-1800}; minimum=${MIN_FREE_KB:-1048576}
for number in "$PG_MAJOR" "$seconds" "$minimum"; do
    case "$number" in ''|*[!0-9]*) fail 'numeric configuration';; esac
done
[ "$seconds" -ge 60 ] && [ "$PG_MAJOR" -ge 14 ] || fail 'version or timeout'
case "$PROJECT_REF" in ''|*[!a-z0-9-]*) fail 'project ref';; esac
case "$PGHOST" in *.pooler.supabase.com) ;; *) fail 'session pooler host';; esac
case "$PGHOST" in *[!a-zA-Z0-9.-]*) fail 'session pooler host characters';; esac
private_file "$passfile"
# Passfile must have one exact entry; password stays in that file.
awk -F: -v h="$PGHOST" -v u="$PGUSER" '
  /^[[:space:]]*#/ || /^[[:space:]]*$/ {next}
  {n++; if ($1!=h || $2!="5432" || $3!="postgres" || $4!=u || NF<5) bad=1}
  END {exit (n!=1 || bad)}' "$passfile" || fail 'passfile target'
case "$dir" in /var/lib/genie-backup) ;; *) fail 'backup directory must be /var/lib/genie-backup';; esac
for command in docker timeout df awk sha256sum date find curl mktemp; do
    command -v "$command" >/dev/null 2>&1 || fail 'required executable missing'
done
# Validate the ping configuration before any publication or retention work.
case "$HEALTHCHECK_URL" in *'"'*|*'\'*|*"$(printf '\r')"*|*"
"*) fail 'healthcheck URL format';; esac
case "$HEALTHCHECK_URL" in https://hc-ping.com/*) ;; *) fail 'healthcheck URL host';; esac
[ ! -L "$dir" ] || fail 'backup directory symlink'
mkdir -p "$dir" || fail 'backup directory'
chmod 700 "$dir" || fail 'directory permissions'
lock="$dir/.backup-lock"
mkdir "$lock" 2>/dev/null || fail 'backup already running (or stale lock)'
work=''; container=''; dump_published=0; members_published=0; committed=0
cleanup() {
    rc=$?
    trap - 0
    if [ -n "$container" ]; then docker rm -f "$container" >/dev/null 2>&1 || :; fi
    if [ "$committed" = 0 ]; then
        if [ "$dump_published" = 1 ]; then rm -f -- "$dir/$base.dump" >/dev/null 2>&1 || :; fi
        if [ "$members_published" = 1 ]; then rm -f -- "$dir/$base.members.csv" >/dev/null 2>&1 || :; fi
    fi
    if [ -n "$work" ]; then rm -rf -- "$work" >/dev/null 2>&1 || :; fi
    rmdir "$lock" >/dev/null 2>&1 || :
    exit "$rc"
}
trap cleanup 0
trap 'exit 1' HUP INT TERM
work=$(mktemp -d "$dir/.pending.XXXXXXXX") || fail 'temporary directory'
df -Pk "$dir" >"$work/disk" 2>/dev/null || fail 'disk inspection'
free=$(awk 'NR==2 {print $4}' "$work/disk") || fail 'disk output'
case "$free" in ''|*[!0-9]*) fail 'disk output';; esac
[ "$free" -ge "$minimum" ] || fail 'insufficient disk space'
stamp=$(date -u '+%Y%m%dT%H%M%SZ') || fail 'timestamp'
base="genie-$stamp"
[ ! -e "$dir/$base.dump" ] && [ ! -L "$dir/$base.dump" ] \
    && [ ! -e "$dir/$base.manifest" ] && [ ! -L "$dir/$base.manifest" ] \
    && [ ! -e "$dir/$base.members.csv" ] && [ ! -L "$dir/$base.members.csv" ] || fail 'timestamp collision'
container="genie-backup-$stamp-$$"
export PGHOST PGUSER PGPORT PGDATABASE PGSSLMODE PGCONNECT_TIMEOUT PGPASSFILE
export TIMEOUT_SECONDS="$seconds"
cat >"$work/worker.sh" <<'WORKER'
#!/bin/sh
umask 077
set -u
cd /work || exit 1
holder=''
finish() { if [ -n "$holder" ]; then kill "$holder" 2>/dev/null || :; wait "$holder" 2>/dev/null || :; fi; }
trap finish 0
trap 'exit 1' HUP INT TERM
cat >holder.sql <<SQL
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
\copy (SELECT pg_export_snapshot()) TO '/work/snapshot'
SELECT pg_sleep($TIMEOUT_SECONDS);
ROLLBACK;
SQL
[ "$?" -eq 0 ] || exit 1
psql -X -q -v ON_ERROR_STOP=1 -f holder.sql >holder.out 2>holder.err &
holder=$!
attempt=0
while [ ! -s snapshot ]; do
    kill -0 "$holder" 2>/dev/null || exit 1
    attempt=$((attempt + 1)); [ "$attempt" -le 30 ] || exit 1
    sleep 1 || exit 1
done
snapshot=$(cat snapshot) || exit 1
case "$snapshot" in ''|*[!0-9A-Fa-f-]*) exit 1;; esac
pg_dump -Fc --schema=public --strict-names --quote-all-identifiers \
    --snapshot="$snapshot" --file=archive.dump || exit 1
kill -0 "$holder" 2>/dev/null || exit 1
pg_restore -l archive.dump >toc || exit 1
pg_restore --data-only --file=archive-data.sql archive.dump || exit 1
# Read the actual COPY payload, not just the source count. COPY text escapes newlines.
awk '
 /^COPY "public"\."customer_leads" .* FROM stdin;$/ {inside=1; seen=1; next}
 inside && $0=="\\." {inside=0; next}
 inside {n++}
 END {if (!seen || inside) exit 1; print n+0}' archive-data.sql >leads-count || exit 1
cat >metadata.sql <<SQL
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET TRANSACTION SNAPSHOT '$snapshot';
SET search_path = '';
SELECT 'server_version', current_setting('server_version');
-- Restrict identifiers so TSV/psql imports cannot be ambiguous.
DO \$check\$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p','S') AND c.relname !~ '^[a-z_][a-z0-9_]*$')
 THEN RAISE EXCEPTION 'unsupported identifier'; END IF;
END \$check\$;
SELECT pg_catalog.format('SELECT %L, %L, count(*), %L, %L FROM public.%I;',
 'table', c.relname, c.relrowsecurity::text, c.relforcerowsecurity::text, c.relname)
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname
\gexec
SELECT 'fk', c.relname, k.conname, pg_catalog.pg_get_constraintdef(k.oid)
 FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND k.contype='f' ORDER BY c.relname, k.conname;
SELECT 'rpc', p.oid::pg_catalog.regprocedure::text, p.prosecdef,
 pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'),
 pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE'),
 EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
         WHERE a.grantee=0 AND a.privilege_type='EXECUTE'),
 pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN
 ('genie_save_project','genie_delete_project','genie_restore_project','genie_undo_contact_result')
 ORDER BY p.proname, p.oid::pg_catalog.regprocedure::text;
\copy (SELECT ids.user_id, a.display_name, a.active, u.email FROM (SELECT user_id FROM public.app_admins UNION SELECT published_by FROM public.flows WHERE published_by IS NOT NULL) ids LEFT JOIN public.app_admins a ON a.user_id=ids.user_id LEFT JOIN auth.users u ON u.id=ids.user_id ORDER BY ids.user_id) TO '/work/members.csv' WITH (FORMAT csv, HEADER true)
COMMIT;
SQL
[ "$?" -eq 0 ] || exit 1
psql -X -q -A -t -F "$(printf '\t')" -v ON_ERROR_STOP=1 -f metadata.sql >metadata || exit 1
kill -0 "$holder" 2>/dev/null || exit 1
expected=$(awk -F '\t' '$1=="table" && $2=="customer_leads" {print $3}' metadata) || exit 1
actual=$(cat leads-count) || exit 1
case "$expected" in ''|*[!0-9]*) exit 1;; esac
[ "$expected" -gt 0 ] && [ "$expected" = "$actual" ] || exit 1
# Sequence values are not MVCC. Read the archived setval, never a later live value.
awk '/^SELECT pg_catalog.setval\(/ {
 s=$0; if (s !~ /^SELECT pg_catalog.setval\('\''"public"\."[a-z_][a-z0-9_]*"'\'', -?[0-9]+, (true|false)\);$/) exit 1;
 sub(/^SELECT pg_catalog.setval\('\''"public"\."/, "", s);
 sub(/"'\'', /, "\t", s); sub(/, /, "\t", s); sub(/\);$/, "", s);
 print "sequence\t" s
}' archive-data.sql >>metadata || exit 1
pg_dump --version >tool-version || exit 1
WORKER
[ "$?" -eq 0 ] || fail 'worker preparation'
# All diagnostics are suppressed: PostgreSQL errors can contain rows or credentials.
timeout --signal=TERM --kill-after=20 "$seconds" docker run --rm --name "$container" \
    --user 0:0 --read-only --cap-drop ALL --security-opt no-new-privileges \
    --tmpfs /tmp:rw,noexec,nosuid,size=64m \
    --mount "type=bind,src=$work,dst=/work" \
    --mount "type=bind,src=$passfile,dst=/run/secrets/pgpass,readonly" \
    --env PGHOST --env PGUSER --env PGPORT --env PGDATABASE --env PGSSLMODE \
    --env PGCONNECT_TIMEOUT --env PGPASSFILE --env TIMEOUT_SECONDS \
    --entrypoint /bin/sh "postgres:$PG_MAJOR-alpine" /work/worker.sh \
    >/dev/null 2>&1 || fail 'snapshot, dump, metadata or archive validation'
hash=$(sha256sum "$work/archive.dump" 2>/dev/null) || fail 'dump checksum'
hash=${hash%% *}
members_hash=$(sha256sum "$work/members.csv" 2>/dev/null) || fail 'members checksum'
members_hash=${members_hash%% *}
bytes=$(wc -c <"$work/archive.dump") || fail 'dump size'
# Some wc builds pad with spaces; arithmetic expansion strips them.
bytes=$((bytes + 0)) || fail 'dump size'
tool=$(cat "$work/tool-version") || fail 'tool version'
{
    printf 'format\tgenie-backup-v1\ntimestamp\t%s\ntool_version\t%s\n' "$stamp" "$tool" || fail 'manifest header'
    printf 'dump_file\t%s.dump\ndump_bytes\t%s\ndump_sha256\t%s\n' "$base" "$bytes" "$hash" || fail 'manifest dump metadata'
    printf 'members_file\t%s.members.csv\nmembers_sha256\t%s\n' "$base" "$members_hash" || fail 'manifest members metadata'
    cat "$work/metadata"
} >"$work/manifest" || fail 'manifest writing'
chmod 600 "$work/archive.dump" "$work/members.csv" "$work/manifest" || fail 'file permissions'
# Manifest is the commit marker: readers ignore a dump without its manifest.
mv "$work/archive.dump" "$dir/$base.dump" || fail 'dump publication'
dump_published=1
mv "$work/members.csv" "$dir/$base.members.csv" || fail 'members publication'
members_published=1
mv "$work/manifest" "$dir/$base.manifest" || fail 'manifest publication'
committed=1
# Point latest at the new set before retention, so pullers never see a deleted set.
cp "$dir/$base.manifest" "$work/latest" || fail 'latest marker'
mv "$work/latest" "$dir/latest.manifest" || fail 'latest publication'
# Age from mtime; strict filenames; never delete this successful set or foreign files.
find "$dir" -maxdepth 1 -type f -name 'genie-*.manifest' -mtime +13 >"$work/old" || fail 'retention scan'
while IFS= read -r old; do
    name=${old##*/}
    printf '%s\n' "$name" >"$work/name" || fail 'retention name'
    awk '/^genie-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z\.manifest$/ {ok=1} END {exit !ok}' "$work/name" || continue
    [ "$name" != "$base.manifest" ] || continue
    stem=${name%.manifest}
    [ ! -L "$dir/$stem.dump" ] && [ ! -L "$dir/$stem.members.csv" ] || fail 'retention symlink'
    rm -f -- "$dir/$stem.dump" "$dir/$stem.members.csv" "$old" || fail 'retention removal'
done <"$work/old"
# curl config over stdin: secret URL never enters argv or process listings.
curl --silent --fail --connect-timeout 10 --max-time 30 --output /dev/null --config - \
    >/dev/null 2>&1 <<CURL || fail 'healthcheck ping'
url = "$HEALTHCHECK_URL"
CURL
printf '%s\n' 'BACKUP_OK'
