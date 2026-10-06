#!/bin/sh
# Only synthetic placeholders; never network, Docker daemon, or real data.
tool=${0##*/}
event() { printf '%s\n' "$1" >>"$TEST_TRACE"; }
case "$tool" in
 stat) printf '%s\n' "${TEST_MODE:-600}"; exit 0;;
 timeout)
  [ "${TEST_TIMEOUT_FAIL:-0}" = 0 ] || exit 124
  exec "$REAL_TIMEOUT" "$@";;
 sha256sum)
  [ "${TEST_HASH_FAIL:-0}" = 0 ] || { printf 'TEST_SECRET_PLACEHOLDER\n' >&2; exit 1; }
  exec "$REAL_SHA256SUM" "$@";;
 mv)
  case "${TEST_MV_FAIL:-none}:$2" in
   dump:*.dump|members:*.members.csv|manifest:*.manifest) exit 1;;
  esac
  exec "$REAL_MV" "$@";;
 df) printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\nfixture 9999999 1 %s 1%% /\n' "${TEST_FREE_KB:-9999998}"; exit 0;;
 docker)
  if [ "${1:-}" = rm ]; then printf 'CLEANUP\n' >>"$TEST_CLEANUP_TRACE"; exit 0; fi
  event DOCKER_RUN
  work=''
  while [ "$#" -gt 0 ]; do
   if [ "$1" = --mount ]; then
    shift
    case "$1" in type=bind,src=*,dst=/work) work=${1#type=bind,src=}; work=${work%,dst=/work};; esac
   fi
   shift
  done
  [ -n "$work" ] || exit 1
  case "$PGSSLMODE:$PGPORT:$PGUSER" in require:5432:postgres.*) ;; *) exit 1;; esac
  cd "$work" || exit 1
  # Replace only the container filesystem root in this private test worker.
  sed "s|/work|$work|g" worker.sh >test-worker.sh || exit 1
  sh test-worker.sh
  exit $?;;
 pg_dump)
  [ "${1:-}" != --version ] || { printf 'pg_dump (PostgreSQL) 17.0\n'; exit 0; }
  event PG_DUMP
  if [ "${TEST_DUMP_FAIL:-0}" = 1 ]; then printf 'TEST_SECRET_PLACEHOLDER\n' >&2; exit 1; fi
  printf 'SYNTHETIC_ARCHIVE\n' >archive.dump
  exit $?;;
 pg_restore)
  if [ "${1:-}" = -l ]; then
   event ARCHIVE_LIST
   [ "${TEST_LIST_FAIL:-0}" = 0 ] || { printf 'TEST_SECRET_PLACEHOLDER\n' >&2; exit 1; }
   printf '1; 2615 2200 SCHEMA - public postgres\n2; 1259 1 TABLE public customer_leads postgres\n'
   exit 0
  fi
  file=''; section=''
  for arg do
   case "$arg" in --file=*) file=${arg#--file=};; --section=*) section=${arg#--section=};; --clean) exit 1;; esac
  done
  if [ "$file" = archive-data.sql ]; then
   event ARCHIVE_DATA
   [ "${TEST_DATA_FAIL:-0}" = 0 ] || exit 1
   {
    printf 'COPY "public"."customer_leads" ("id") FROM stdin;\n'
    count=0
    while [ "$count" -lt "${TEST_DUMP_ROWS:-2}" ]; do printf 'ROW_PLACEHOLDER\n'; count=$((count+1)); done
    printf '\\.\n'
    printf "SELECT pg_catalog.setval('\"public\".\"fixture_id_seq\"', 2, true);\n"
   } >"$file"
   exit $?
  fi
  event "RESTORE_$section"
  [ "${TEST_RESTORE_FAIL:-none}" != "$section" ] || { printf 'TEST_SECRET_PLACEHOLDER\n' >&2; exit 1; }
  [ -z "$file" ] || printf '%s\n' '-- fixture post-data' >"$file"
  exit 0;;
 psql)
  file=''
  while [ "$#" -gt 0 ]; do
   if [ "$1" = -f ]; then shift; file=$1; fi
   shift
  done
  event "PSQL_$file"
  case "$file" in
   holder.sql)
    printf '0001-0002-1\n' >snapshot
    while :; do sleep 1; done;;
   metadata.sql)
    [ "${TEST_METADATA_FAIL:-0}" = 0 ] || { printf 'TEST_SECRET_PLACEHOLDER\n' >&2; exit 1; }
    printf 'server_version\t17.0\n'
    printf 'table\tcustomer_leads\t%s\ttrue\tfalse\n' "${TEST_SOURCE_ROWS:-2}"
    printf 'table\tgenie_projects\t1\ttrue\tfalse\n'
    printf 'table\tapp_admins\t1\ttrue\tfalse\n'
    printf 'table\tflows\t1\ttrue\tfalse\n'
    for rpc in genie_save_project genie_delete_project genie_restore_project genie_undo_contact_result; do
     printf 'rpc\tpublic.%s(text)\tt\tt\tf\tf\tf\n' "$rpc"
    done
    printf 'user_id,display_name,active,email\nOLD_UUID_PLACEHOLDER,DISPLAY_PLACEHOLDER,true,EMAIL_PLACEHOLDER\n' >members.csv
    exit $?;;
   verify-restore.sql)
    [ "${TEST_VERIFY_FAIL:-0}" = 0 ] || { printf 'TEST_SECRET_PLACEHOLDER\n' >&2; exit 1; }
    printf 'BACKUP_RESTORE_OK\n'; exit 0;;
   prepare.sql|remap.sql|post-wrapper.sql)
    [ "${TEST_SQL_FAIL:-none}" != "$file" ] || { printf 'TEST_SECRET_PLACEHOLDER\n' >&2; exit 1; }
    exit 0;;
   *) exit 1;;
  esac;;
 curl)
  event PING
  cat >/dev/null || exit 1
  [ "${TEST_CURL_FAIL:-0}" = 0 ]; exit $?;;
 *) exit 1;;
esac
