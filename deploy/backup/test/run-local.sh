#!/bin/sh
# Run with Git Bash: sh deploy/backup/test/run-local.sh
set -u
umask 077
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P) || exit 1
source_dir=$(dirname "$here") || exit 1
root=$(mktemp -d "${TMPDIR:-/tmp}/genie-backup-test.XXXXXXXX") || exit 1
cleanup() { rc=$?; trap - 0; rm -rf -- "$root"; exit "$rc"; }
trap cleanup 0
trap 'exit 1' HUP INT TERM
bin="$root/bin"; dir="$root/backups"; scripts="$root/scripts"
mkdir "$bin" "$dir" "$scripts" || exit 1
REAL_TIMEOUT=$(command -v timeout); REAL_SHA256SUM=$(command -v sha256sum); REAL_MV=$(command -v mv)
export REAL_TIMEOUT REAL_SHA256SUM REAL_MV
for tool in docker pg_dump pg_restore psql curl stat df timeout sha256sum mv; do
 cp "$here/stub-tool.sh" "$bin/$tool" || exit 1
 chmod +x "$bin/$tool" || exit 1
done
for script in backup.sh restore-drill.sh; do
 sh -n "$source_dir/$script" || exit 1
 # Only fixed host storage path changes; test never writes to the real /var tree.
 sed "s|/var/lib/genie-backup|$dir|g" "$source_dir/$script" >"$scripts/$script" || exit 1
done
cp "$source_dir/verify-restore.sql" "$scripts/verify-restore.sql" || exit 1
sh -n "$here/stub-tool.sh" || exit 1
sh -n "$here/run-local.sh" || exit 1
if command -v shellcheck >/dev/null 2>&1; then
 shellcheck "$source_dir/backup.sh" "$source_dir/restore-drill.sh" "$here/run-local.sh" "$here/stub-tool.sh" || exit 1
else
 printf 'SKIP shellcheck: not installed\n'
fi
PATH="$bin:$PATH"; export PATH
TEST_TRACE="$root/trace"; export TEST_TRACE
TEST_CLEANUP_TRACE="$root/cleanup-trace"; export TEST_CLEANUP_TRACE
cat >"$root/backup.env" <<EOF
PROJECT_REF='source-placeholder'
PGHOST='fixture.pooler.supabase.com'
PG_MAJOR=17
PASSFILE='$root/pgpass'
TIMEOUT_SECONDS=60
HEALTHCHECK_URL='https://hc-ping.com/PING_PLACEHOLDER'
EOF
printf 'fixture.pooler.supabase.com:5432:postgres:postgres.source-placeholder:PASSWORD_PLACEHOLDER\n' >"$root/pgpass"
old=genie-20000101T000000Z
seed() {
 rm -f "$dir"/genie-* "$dir"/latest.manifest "$dir"/notes.txt "$dir"/other.dump
 printf 'OLD_DUMP_PLACEHOLDER\n' >"$dir/$old.dump"
 printf 'OLD_MANIFEST_PLACEHOLDER\n' >"$dir/$old.manifest"
 printf 'OLD_MEMBERS_PLACEHOLDER\n' >"$dir/$old.members.csv"
 touch -t 200001010000 "$dir/$old.dump" "$dir/$old.manifest" "$dir/$old.members.csv"
 printf 'KEEP\n' >"$dir/genie-not-a-date.manifest"
 printf 'KEEP\n' >"$dir/other.dump"
 printf 'KEEP\n' >"$dir/notes.txt"
 : >"$TEST_TRACE"
}
passed=0
ok() { passed=$((passed+1)); printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1" >&2; exit 1; }
no_secret() {
 if grep -q 'TEST_SECRET_PLACEHOLDER\|PASSWORD_PLACEHOLDER\|PING_PLACEHOLDER\|EMAIL_PLACEHOLDER\|OLD_UUID_PLACEHOLDER' "$root/log"; then bad 'log confidentiality'; fi
}
failed_backup() {
 label=$1; seed
 if sh "$scripts/backup.sh" "$root/backup.env" >"$root/log" 2>&1; then bad "$label accepted"; fi
 [ -f "$dir/$old.dump" ] && [ -f "$dir/$old.manifest" ] && [ -f "$dir/$old.members.csv" ] || bad "$label deleted old backup"
 count=$(find "$dir" -maxdepth 1 -name 'genie-*.dump' -type f | wc -l)
 [ "$count" -eq 1 ] || bad "$label published a dump"
 [ ! -e "$dir/latest.manifest" ] || bad "$label published latest"
 if grep -q '^PING$' "$TEST_TRACE"; then bad "$label pinged"; fi
 no_secret; ok "$label"
}
TEST_DUMP_FAIL=1; export TEST_DUMP_FAIL; failed_backup 'pg_dump error: no publication, deletion or ping'; unset TEST_DUMP_FAIL
TEST_LIST_FAIL=1; export TEST_LIST_FAIL; failed_backup 'unreadable archive'; unset TEST_LIST_FAIL
TEST_DATA_FAIL=1; export TEST_DATA_FAIL; failed_backup 'archive data extraction error'; unset TEST_DATA_FAIL
TEST_METADATA_FAIL=1; export TEST_METADATA_FAIL; failed_backup 'metadata failure with secret diagnostics'; unset TEST_METADATA_FAIL
TEST_SOURCE_ROWS=0; TEST_DUMP_ROWS=0; export TEST_SOURCE_ROWS TEST_DUMP_ROWS
failed_backup 'empty customer_leads'; unset TEST_SOURCE_ROWS TEST_DUMP_ROWS
TEST_DUMP_ROWS=0; export TEST_DUMP_ROWS; failed_backup 'source nonempty but dump empty'; unset TEST_DUMP_ROWS
TEST_DUMP_ROWS=1; export TEST_DUMP_ROWS; failed_backup 'COPY row mismatch'; unset TEST_DUMP_ROWS
TEST_FREE_KB=1; export TEST_FREE_KB; failed_backup 'disk threshold'; unset TEST_FREE_KB
TEST_MODE=644; export TEST_MODE; failed_backup 'private config must be 0600'; unset TEST_MODE
TEST_TIMEOUT_FAIL=1; export TEST_TIMEOUT_FAIL; failed_backup 'timeout: no publication, deletion or ping'; unset TEST_TIMEOUT_FAIL
grep -qx CLEANUP "$TEST_CLEANUP_TRACE" || bad 'timeout container cleanup'
TEST_HASH_FAIL=1; export TEST_HASH_FAIL; failed_backup 'checksum tool failure'; unset TEST_HASH_FAIL
for phase in dump members manifest; do
 TEST_MV_FAIL=$phase; export TEST_MV_FAIL
 failed_backup "$phase publication failure rolls back partial set"
done
unset TEST_MV_FAIL
seed
mkdir "$dir/.backup-lock" || exit 1
if sh "$scripts/backup.sh" "$root/backup.env" >"$root/log" 2>&1; then bad 'overlap'; fi
rmdir "$dir/.backup-lock" || exit 1
[ ! -s "$TEST_TRACE" ] || bad 'overlap started container'
ok 'overlapping backup rejected'
seed
sh "$scripts/backup.sh" "$root/backup.env" >"$root/log" 2>&1 || bad 'success path'
no_secret
grep -qx BACKUP_OK "$root/log" || bad 'success marker'
[ ! -e "$dir/$old.dump" ] && [ ! -e "$dir/$old.manifest" ] && [ ! -e "$dir/$old.members.csv" ] || bad 'retention old set'
[ -e "$dir/genie-not-a-date.manifest" ] && [ -e "$dir/other.dump" ] && [ -e "$dir/notes.txt" ] || bad 'retention unrelated file'
grep -qx PING "$TEST_TRACE" || bad 'success ping'
ok 'success, strict retention, latest surviving set and secret-free log'
name=$(awk -F '\t' '$1=="dump_file" {print $2}' "$dir/latest.manifest")
dump="$dir/$name"
hash=$(sha256sum "$dump"); hash=${hash%% *}
grep -q "$hash" "$dir/latest.manifest" || bad 'manifest checksum'
grep -q '^sequence' "$dir/latest.manifest" || bad 'sequence archive metadata'
ok 'manifest hash, row counts, RPCs and archived sequence'
cat >"$root/restore.env" <<EOF
PROJECT_REF='test-placeholder'
TEST_PROJECT_REF='test-placeholder'
PGHOST='fixture.pooler.supabase.com'
TEST_POOLER_HOST='fixture.pooler.supabase.com'
PG_MAJOR=17
PASSFILE='$root/restore-pgpass'
UUID_MAP_FILE='$root/uuid-map.csv'
TIMEOUT_SECONDS=60
EOF
printf 'fixture.pooler.supabase.com:5432:postgres:postgres.test-placeholder:PASSWORD_PLACEHOLDER\n' >"$root/restore-pgpass"
printf 'old_id,new_id\nOLD_UUID_PLACEHOLDER,NEW_UUID_PLACEHOLDER\n' >"$root/uuid-map.csv"
sed 's/test-placeholder/llqwzrgzekalwdnetvyb/g' "$root/restore.env" >"$root/production.env"
: >"$TEST_TRACE"
if sh "$scripts/restore-drill.sh" "$root/production.env" "$dump" >"$root/log" 2>&1; then bad 'production ref'; fi
[ ! -s "$TEST_TRACE" ] || bad 'production reached docker'
no_secret; ok 'production ref rejected before any container'
sed "s/PROJECT_REF='test-placeholder'/PROJECT_REF='unregistered-placeholder'/" "$root/restore.env" >"$root/unregistered.env"
# Sed also replaces TEST_PROJECT_REF; deliberately restore the registered allowlist.
printf "TEST_PROJECT_REF='test-placeholder'\n" >>"$root/unregistered.env"
if sh "$scripts/restore-drill.sh" "$root/unregistered.env" "$dump" >"$root/log" 2>&1; then bad 'unregistered ref'; fi
[ ! -s "$TEST_TRACE" ] || bad 'unregistered reached docker'
ok 'unregistered target rejected'
sh "$scripts/restore-drill.sh" "$root/restore.env" "$dump" >"$root/log" 2>&1 || bad 'restore success'
no_secret
grep -qx BACKUP_RESTORE_OK "$root/log" || bad 'restore marker'
cat >"$root/order" <<EOF
DOCKER_RUN
ARCHIVE_LIST
PSQL_prepare.sql
RESTORE_pre-data
RESTORE_data
PSQL_remap.sql
RESTORE_
RESTORE_post-data
PSQL_post-wrapper.sql
PSQL_verify-restore.sql
EOF
cmp "$root/order" "$TEST_TRACE" >/dev/null || bad 'restore order'
ok 'restore pre-data/data/remap/post-data/disable/verify order'
for phase in pre-data data post-data; do
 : >"$TEST_TRACE"; TEST_RESTORE_FAIL=$phase; export TEST_RESTORE_FAIL
 if sh "$scripts/restore-drill.sh" "$root/restore.env" "$dump" >"$root/log" 2>&1; then bad "restore $phase failure"; fi
 if grep -qx BACKUP_RESTORE_OK "$root/log"; then bad 'false restore success'; fi
 no_secret; ok "restore $phase error stops, confidential log"
done
unset TEST_RESTORE_FAIL
for phase in prepare.sql remap.sql post-wrapper.sql; do
 : >"$TEST_TRACE"; TEST_SQL_FAIL=$phase; export TEST_SQL_FAIL
 if sh "$scripts/restore-drill.sh" "$root/restore.env" "$dump" >"$root/log" 2>&1; then bad "SQL $phase failure"; fi
 no_secret; ok "SQL $phase error stops"
done
unset TEST_SQL_FAIL
TEST_VERIFY_FAIL=1; export TEST_VERIFY_FAIL
if sh "$scripts/restore-drill.sh" "$root/restore.env" "$dump" >"$root/log" 2>&1; then bad 'verification failure'; fi
no_secret; ok 'verification failure cannot emit restore success'; unset TEST_VERIFY_FAIL
printf 'CORRUPT_PLACEHOLDER\n' >>"$dump"
: >"$TEST_TRACE"
if sh "$scripts/restore-drill.sh" "$root/restore.env" "$dump" >"$root/log" 2>&1; then bad 'corrupt checksum'; fi
[ ! -s "$TEST_TRACE" ] || bad 'corrupt reached docker'
ok 'checksum corruption rejected before target connection'
printf 'LOCAL_TESTS_OK: %s cases (SQL is mocked; real Supabase still requires drill)\n' "$passed"
