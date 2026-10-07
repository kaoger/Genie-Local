# v8.3 資料備份與還原演練

先完成下方 **16 個設定／演練步驟**：VPS 5 步（30–45 分鐘）、Healthchecks 2 步（5 分鐘）、Windows 4 步（15–20 分鐘）、隔離還原 5 步（30–60 分鐘）。合計 **80–130 分鐘**，另等下一次 cron／每週排程確認。請由使用者操作 VPS／Supabase；本次交付不會連正式庫。

備份：每天台北 03:00，VPS 保留 14 天；Windows 每週拉取、保留最近 8 組。每日復原點目標 24 小時，只有電腦副本可用時約 7 天。復原耗時須以第一次演練實測。

| 檔案 | 用途 |
| --- | --- |
| `backup.sh` | 一次性官方 PostgreSQL 容器，快照匯出、驗證、發布、清理、成功 ping |
| `restore-drill.sh` | 只准預先登記的測試專案；三段還原、UUID 轉換、停用 trigger、驗收 |
| `verify-restore.sql` | 全表筆數、RLS、四支 RPC 權限、外鍵、sequence、trigger 狀態 |
| `pull-backup.ps1` | Windows 內建 OpenSSH，拉完整一組並核對 SHA-256 |
| `test/run-local.sh`、`test/run-powershell.ps1` | Git Bash／Windows 替身驗收；不連 VPS／Supabase |

## VPS：5 步，30–45 分鐘

1. **查版本與依賴（5–10 分鐘）。** 在正式 Supabase SQL Editor 執行以下唯讀查詢。只保存版本、extension／schema 名稱及物件名稱，勿複製函式本體、trigger 參數或任何密文。`PG_MAJOR` 設成伺服器主版本或更高（例如 `<SERVER_MAJOR>`）；還原工具也不得低於 dump 工具主版本。

   ```sql
   show server_version;
   select e.extname, e.extversion, n.nspname as schema
   from pg_extension e join pg_namespace n on n.oid=e.extnamespace
   order by e.extname;
   select c.relname as table_name, t.tgname, n.nspname as function_schema, p.proname
   from pg_trigger t join pg_class c on c.oid=t.tgrelid
   join pg_namespace tn on tn.oid=c.relnamespace
   join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace
   where tn.nspname='public' and not t.tgisinternal;
   ```

   從 Dashboard 的 **Connect → Session pooler** 分別取得 host、ref、資料庫密碼。固定埠 **5432**、帳號 **`postgres.<SOURCE_PROJECT_REF>`**、DB `postgres`、SSL `require`；不要使用 6543。host 可能跨專案共用，不能只靠 host 判斷正式／測試。腳本要求 `*.pooler.supabase.com`，若後台提供不同格式，先停下核對，勿移除防護硬跑。[官方連線文件](https://supabase.com/docs/guides/database/connecting-to-postgres)、[官方 PSQL 文件](https://supabase.com/docs/guides/database/psql)

2. **建立私人目錄並安裝腳本（5 分鐘）。** 用 root 建立以下路徑；備份固定寫入 `/var/lib/genie-backup`，不可搬進 repo 或 `/docker/hermes-agent-llsk/data`。腳本另安裝到 `/usr/local/lib/genie-backup`，讓主機 cron 不依賴 Hermes 掛載。

   ```sh
   install -d -m 0700 /etc/genie-backup /var/lib/genie-backup /usr/local/lib/genie-backup
   install -m 0700 deploy/backup/backup.sh deploy/backup/restore-drill.sh /usr/local/lib/genie-backup/
   install -m 0600 deploy/backup/verify-restore.sql /usr/local/lib/genie-backup/
   install -m 0600 /dev/null /etc/genie-backup/backup.env
   install -m 0600 /dev/null /etc/genie-backup/pgpass
   ```

   以上空檔建立指令只用於首次設定；已有設定檔時只編輯，勿覆寫。Docker、GNU coreutils（`timeout`、`sha256sum`）、curl 須已安裝。用 `docker pull postgres:<PG_MAJOR>-alpine` 預先抓映像。容器 root 只為讀 0600 密碼檔／寫 0700 私人掛載，唯讀 root filesystem、drop capabilities，不掛 Docker socket、不開埠、不加入 Hermes 網路。

3. **在私人檔案填設定（10 分鐘）。** 用編輯器填 `/etc/genie-backup/backup.env`；它是受信任、root 擁有的 POSIX shell 設定檔，不能接受他人提供的程式。不要 `set -x`、不要印出檔案、不要把秘密貼到聊天、shell history、repo、命令列或環境變數 `PGPASSWORD`。

   ```sh
   PROJECT_REF='<SOURCE_PROJECT_REF>'
   PGHOST='<SESSION_POOLER_HOST>'
   PG_MAJOR='<SERVER_MAJOR_OR_NEWER>'
   PASSFILE='/etc/genie-backup/pgpass'
   MIN_FREE_KB=1048576
   TIMEOUT_SECONDS=1800
   HEALTHCHECK_URL='<HEALTHCHECK_PING_URL>'
   ```

   `pgpass` 只放一筆精確目標，格式如下（實值只在 VPS 填）：

   ```text
   <SESSION_POOLER_HOST>:5432:postgres:postgres.<SOURCE_PROJECT_REF>:<DATABASE_PASSWORD>
   ```

   不用 `*` 萬用字元。密碼內 `:`、`\` 須依 [PostgreSQL passfile 規則](https://www.postgresql.org/docs/current/libpq-pgpass.html) 跳脫。兩檔 `chown root:root`／`chmod 0600`，目錄 0700。密碼只經 `PGPASSFILE` 唯讀掛載；curl 網址經 stdin config，不進 argv。最低空間預設 1 GiB，仍應依資料量提高（dump、解出的 SQL、Docker image 及系統剩餘空間都要算）。

4. **手動跑與核對（5–10 分鐘）。** 執行 `/usr/local/lib/genie-backup/backup.sh`，成功只印 `BACKUP_OK`。用 `ls -l /var/lib/genie-backup` 確認一組 `genie-<UTC_TIMESTAMP>.dump`、`.manifest`、`.members.csv`、`latest.manifest`，檔案 0600、目錄 0700。Healthchecks 必須顯示收到 ping。dump 與成員表都是敏感資料；manifest 沒客戶內容但仍私人保存。

   腳本持有唯讀 REPEATABLE READ 快照；dump、表筆數、成員表與 FK／RPC metadata 共用它。並解開 archive 的 `customer_leads` COPY 列數，必須等於快照筆數且大於零；空表直接失敗。sequence 非 MVCC，manifest 取 archive 的 `setval`，不拿稍後的線上值。manifest 是成功組的標記；latest 在新組發布後、清理舊組之前更新，拉取端永遠指向存在的一組；半組／暫存檔不應被拉取。

   所有資料庫及 Docker 原始錯誤均不進 log，避免錯誤帶出資料列或 webhook secret；失敗訊息只顯示階段。磁碟／dump／archive／metadata／hash／發布失敗不 ping、不進保留清理，未完成發布會撤回本次半組；清理只刪 14 天前、嚴格 timestamp 格式的一組，保留剛成功的一組。任一步失敗均非零退出。清理或 ping 失敗時完整新備份仍保留；清理先於 ping，因此 ping 失敗可能已完成保留清理，Healthchecks 會按缺少心跳告警。

5. **設主機 cron（5 分鐘）。** root crontab 使用絕對路徑；log 留主機私人位置。範例（先確認 cron 實作支援 `CRON_TZ`）：

   ```cron
   CRON_TZ=Asia/Taipei
   0 3 * * * /usr/local/lib/genie-backup/backup.sh >> /var/log/genie-backup.log 2>&1
   ```

   先 `install -m 0600 /dev/null /var/log/genie-backup.log`（只首次），再安排 logrotate 保留 30 天且 `create 0600 root root`。有些 Debian cron 忽略 `CRON_TZ`：若主機 UTC，改用 `0 19 * * *`（UTC 19:00＝翌日台北 03:00）；不要改 VPS 全域時區。翌日確認新 UTC timestamp 及心跳。逾時會移除本次命名容器；lock 防重疊。主機斷電可能留下 `.backup-lock`／`.restore-lock`，確認沒有同名容器及腳本行程後才手動移除 lock，不要直接清空備份目錄。若使用 compose 做其他檢查，只用 `docker compose config -q`。

## Healthchecks：2 步，5 分鐘

1. 自行註冊免費 Healthchecks.io、建立 daily check：**週期 1 天、寬限 2 小時**，開啟 email 通知。將 ping 位址只放上述私人 `backup.env`（支援官方 `hc-ping.com` HTTPS 網址）。
2. 手動備份後確認心跳；正式啟用前做一次逾期／通知測試。腳本只送無 payload 的成功 ping，沒有 `/start`／`/fail`，約 26 小時無成功心跳才告警。設定 email、ping 網址不寫入本 repo。

## Windows：4 步，15–20 分鐘

1. **選私人目的地並建 SSH key（5 分鐘）。** 啟用 BitLocker／Windows 裝置加密，目的地例如 `D:\Backups\sanhe-crm`，不要選 repo、雲端公開分享資料夾或 Hermes 掛載。限制本機 NTFS ACL 只允許本人／管理員。啟用 Windows 選用功能的 OpenSSH Client，執行內建 `ssh-keygen -t ed25519 -f <PRIVATE_KEY_PATH>` 建立專用金鑰；工作排程需無互動登入，可用 ssh-agent 或妥善限制 ACL 的專用無 passphrase key。私鑰不要提交。

2. **限制 VPS key 只能讀備份（5–10 分鐘）。** 腳本刻意使用 OpenSSH `scp -O`（legacy scp），讓 root 的**這一把專用 key**可以由 forced command 精確限制檔案，不變更其他管理 key。VPS `/usr/local/sbin/genie-backup-read` 放以下 root 擁有、0700 的 wrapper；`authorized_keys` 這把 key 加 `restrict,command="/usr/local/sbin/genie-backup-read"`。公鑰本文用 `<BACKUP_PUBLIC_KEY>`，不將真正 key 寫到 repo。

   ```sh
   #!/bin/sh
   umask 077
   # No eval, no extra options, no arbitrary command/path. Legacy scp read mode only.
   request=${SSH_ORIGINAL_COMMAND:-}
   prefix='scp -f /var/lib/genie-backup/'
   case "$request" in "$prefix"*) name=${request#"$prefix"};; *) exit 1;; esac
   case "$name" in *[!a-zA-Z0-9.-]*) exit 1;; esac
   case "$name" in latest.manifest) ;;
     *) expr "$name" : 'genie-[0-9]\{8\}T[0-9]\{6\}Z\.\(dump\|manifest\|members\.csv\)$' >/dev/null || exit 1;;
   esac
   target="/var/lib/genie-backup/$name"
   [ -f "$target" ] && [ ! -L "$target" ] || exit 1
   exec /usr/bin/scp -f -- "$target"
   ```

   forced command 的檔案及父目錄不得讓一般帳號寫入。`restrict` 禁用 PTY、port forwarding、agent/X11 forwarding、user rc。這把 key 不能開 shell、寫檔或讀其他路徑；scp 仍以 root 讀 0600 檔，沒有放寬備份檔權限。使用已更新 OpenSSH，禁止拿這把 key 作一般管理。驗收：合法下載成功；`ssh` 執行其他指令、scp 上傳、讀取目錄外檔案都應失敗。wrapper 是設定範例，須在 VPS 實測才能確認限制生效。[OpenSSH authorized_keys](https://man.openbsd.org/sshd.8#AUTHORIZED_KEYS_FILE_FORMAT)

3. **首次驗主機指紋並手動拉（3–5 分鐘）。** 從 VPS 控制台獨立取得 SSH host key 指紋，再在 Windows 首次連線確認，寫入執行排程帳號的 known_hosts。restricted key 不提供一般 shell；首次連線可能在記錄指紋後被拒絕，屬正常。腳本使用 StrictHostKeyChecking=yes，不自動信任新主機。

   ```powershell
   powershell.exe -NoProfile -File "<LOCAL_SCRIPT_PATH>\pull-backup.ps1" `
     -SshTarget "root@<VPS_HOST>" -IdentityFile "<PRIVATE_KEY_PATH>" `
     -Destination "D:\Backups\sanhe-crm"
   ```

   先拉 `latest.manifest`，再拉固定 timestamp 的三檔；兩份 manifest 必須 byte-identical，dump 大小及 dump／members SHA-256 全吻合才發布。本機保留最新 8 個完整且符合格式的集合，失敗不先刪舊檔。重跑相同 timestamp 會核對既有檔，不覆蓋不同內容。`PULL_BACKUP_OK` 才算完成。

4. **每週排程（2 分鐘）。** 工作排程器用本人 Windows 帳號，動作為 `powershell.exe`；參數同上，script/key 路徑填絕對路徑。觸發器每週一次，勾「錯過排程後儘速執行」、「喚醒電腦」，有需要時取消「僅限 AC 電源」，執行逾時設 30 分鐘、不啟動第二個實例。電腦須開機且能上網；關機不能備份。手動 Run 一次檢查 Last Run Result＝0 與新檔。NTFS file lock 另防手動／排程重疊。

## 隔離還原演練：5 步，30–60 分鐘

1. **另建免費測試專案並登記（5–10 分鐘）。** 不可用正式專案。準備空 `public`，不先建 app 表或 webhook trigger。依盤點安裝必要 extension（例如 `pgcrypto`、`pg_net`，實際以正式清單為準，維持原 schema；Supabase 託管 extension 不還原本體），啟用 Database Webhooks 支援讓 `supabase_functions.http_request()` 存在。備份只含 `public`，不會建立 `auth`、`net`、`extensions`、`realtime`、`supabase_functions`，這些由新 Supabase 平台初始化。勿建立會指向正式服務的測試通知；正式 webhook 定義／參數可能已在 dump 中。

   新增私人 `/etc/genie-backup/restore.env`、`restore-pgpass`（root、0600）。`TEST_PROJECT_REF`／`TEST_POOLER_HOST` 是**事先登記的固定 allowlist pair**，不要隨腳本參數改成正式目標。

   ```sh
   TEST_PROJECT_REF='<REGISTERED_TEST_PROJECT_REF>'
   TEST_POOLER_HOST='<REGISTERED_TEST_SESSION_POOLER_HOST>'
   PROJECT_REF='<REGISTERED_TEST_PROJECT_REF>'
   PGHOST='<REGISTERED_TEST_SESSION_POOLER_HOST>'
   PG_MAJOR='<DUMP_TOOL_MAJOR_OR_NEWER>'
   PASSFILE='/etc/genie-backup/restore-pgpass'
   UUID_MAP_FILE='/etc/genie-backup/uuid-map.csv'
   TIMEOUT_SECONDS=3600
   ```

   pgpass 格式與備份相同，改用測試專案密碼與 ref；只允許一筆精確 entry。腳本拒絕正式 ref `llqwzrgzekalwdnetvyb`，並檢查 ref、host、pooler username／passfile 目標、空 public，沒有 `--clean`。pooler host 可能相同，ref／username 才是必要防線；不能據此宣稱能抵抗惡意修改 root 設定的人。

2. **建立測試成員與 UUID 對照（10–15 分鐘）。** 私下查看所選 timestamp 的 `.members.csv`（含 user_id、display_name、active、email，另含 flows 的歷史 published_by）；不要貼出內容。到測試 Auth 建立對應的測試帳號，不寄邀請到原成員信箱；確認測試 email／密碼能登入。將原 user_id 與新 Auth id 寫到 `/etc/genie-backup/uuid-map.csv`，0600：

   ```csv
   old_id,new_id
   <OLD_ADMIN_UUID>,<NEW_TEST_AUTH_UUID>
   <OLD_PUBLISHER_UUID>,<NEW_TEST_AUTH_UUID_OR_EMPTY>
   ```

   同一個 old_id 只寫一次；每個新 UUID 一對一。每位 app_admin 必須有存在於測試 auth.users 的新 id；只出現在 flows 的歷史使用者可選建測試帳號，或在 published_by 可 NULL 時留空 new_id。缺對照、重複 id、無帳號、NULL admin、不可 NULL publisher、交叉交換 UUID 均退出，不猜測配對。不需要輸入舊密碼。

   [Auth 官方原始碼](https://github.com/supabase/auth/blob/master/internal/api/admin.go) 的 AdminUserParams／adminUserCreate 支援 `id`，可作保留原 UUID 的替代方向，但 [JS createUser 文件](https://supabase.com/docs/reference/javascript/auth-admin-createuser) 的公開範例未涵蓋此路徑，託管版本也未線上測過。本版不呼叫 Admin API／不需要其 key，預設一定用明確 CSV 轉換；若日後實測原 UUID 建帳號成功，mapping 可 old_id=new_id。不要直接 INSERT auth.users（會漏 identities／Auth 流程）。

3. **分段還原（5–10 分鐘）。** 執行以下占位命令；source 只是一個私人檔案，target 由 restore.env 決定。

   ```sh
   /usr/local/lib/genie-backup/restore-drill.sh /etc/genie-backup/restore.env \
     /var/lib/genie-backup/genie-<UTC_TIMESTAMP>.dump
   ```

   順序：hash → pre-data → data → UUID remap → post-data。還原清單排除 `SCHEMA - public` 與 `DEFAULT ACL` 項目（平台管理的預設權限，postgres 無權修改，新專案自帶；2026-10-07 演練實測）。新專案會經由平台預設權限自動把函式／表權限給 anon、authenticated、service_role，pg_dump 只重播來源的 GRANT；因此 post-data 之後會先對 public 所有物件收回這三個角色與 PUBLIC 的權限，再原樣重套備份裡的 ACL（2026-10-07 演練抓到 RPC 權限多給 anon）。data／UUID remap 時尚無 public 使用者 trigger，不使用 replica 模式隱藏外鍵錯誤。post-data 與停用全部 public 使用者 trigger 在同一個交易內完成，外鍵 constraint trigger 保持啟用。原 webhook secret 可能存在 archive，演練不刪其定義，但**所有 public USER trigger 保持 DISABLED**，包含 audit/version trigger，避免通知與資料改寫。演練限讀取；不要在這個 trigger 停用狀態測專案寫入。Dashboard 的「支援已啟用」不代表通知 trigger 有啟用；SQL `tgenabled='D'` 才是驗收條件。[Webhook 底層是 PostgreSQL trigger](https://supabase.com/docs/guides/database/webhooks)、[停用 trigger 語法](https://www.postgresql.org/docs/current/sql-altertable.html)

   出錯只顯示階段，測試 public 可能留下部分還原。不要盲目重跑／加 `--clean`；從 Dashboard 刪除這個測試專案並新建、重新登記 ref 和帳號後再試。不要將這段流程用在已有資料的正式專案。

4. **驗 SQL 與成員 REST 讀取（5–15 分鐘）。** 只有全表筆數／RLS 與 manifest 一致、必要表 RLS 啟用、四支 RPC 安全 definer 且 authenticated 可執行、anon／PUBLIC 不可執行、service_role ACL 一致、所有外鍵存在且已驗證、auth 對應存在、sequence 值與下次可用值正常、USER trigger 已停用，才印 `BACKUP_RESTORE_OK`。四支是 `genie_save_project`、`genie_delete_project`、`genie_restore_project`、`genie_undo_contact_result`。

   SQL 成功仍不代表 Auth／Data API 登入正常。用測試 email／密碼取得該測試專案的 access token（只放私人工具／環境，不進聊天），以測試 publishable key 作 `apikey`、**access token** 作 `Authorization: Bearer <TEST_USER_ACCESS_TOKEN>`，GET 測試專案 `/rest/v1/customer_leads?select=id&limit=1` 和 `/rest/v1/genie_projects?select=id,data,version&limit=1`。不要把 publishable key 當 Bearer。確認名單與專案可讀；若 genie_projects 原本空表，應得到正常 200 空陣列，非權限錯誤。測試停用成員、非成員／anon 不應讀到受保護資料；不要查詢客戶內容後貼到聊天。若新專案 Data API 未開放 public 或缺 GRANT，檢查設定與備份 ACL，不可暫時把 RLS 關掉。只有此步也通過才叫「演練完成」。

5. **記錄結果並清測試專案（2 分鐘）。** 私人紀錄寫 timestamp、SQL 成功、REST 成功、耗時、依賴清單、無通知；不用記真實 UUID／email／secret。確認後由使用者在 Dashboard 刪除測試專案，並清除 VPS 私人 restore 憑證與 mapping（先確認路徑及用途）。備份檔仍保留。若要保留測試專案，所有通知／audit trigger 保持停用。

## 真的出事：還原新正式專案 SOP（另一次授權）

這裡的目標仍是「新、空、事先登記」的專案，先隔離驗收再切換，不能直接在舊正式庫跑。演練腳本永久拒絕原正式 ref。

1. 選最後已驗證的 dump＋manifest＋members（VPS 或電腦），核對 SHA-256；從電腦拷回 VPS 的檔案先放進 `/var/lib/genie-backup/` 並 `chmod 600`（腳本拒絕非 0600 與 symlink）；建新 Supabase、盤點平台依賴、重建 extension／Webhooks 支援與 Auth 設定（登入提供者、site URL、redirect URLs、SMTP 等不在 public dump）。重建家人帳號，填私人 UUID mapping。
2. 依上方三段流程還原 public；`app_admins.user_id`／`flows.published_by` 在外鍵前一起轉換。驗 `BACKUP_RESTORE_OK`＋成員 REST。還原資料保留舊版本與稽核欄位；`genie_projects.updated_by` 沒有已知 auth FK，保留歷史 UUID，勿任意全庫替換 UUID。其他跨 schema FK／依賴若新增，需先擴充 mapping 與演練，不能略過 pg_restore 錯誤。
3. **重建通知服務後才恢復 trigger。** 以機器人 repo 的已驗證部署版本部署 Edge Function、填新 secrets、重建 Database Webhook 的新 URL／新 secret，移除 archive 的舊正式 webhook trigger（不用讀出舊參數）。全部保持停用，先用隔離目的地驗一次；對已確認正常的非通知 trigger（如 `genie_projects_audit`）逐個 `ALTER TABLE public.<TABLE> ENABLE TRIGGER <VERIFIED_TRIGGER>`，不能 `ENABLE TRIGGER ALL`。通知 trigger 最後才啟用。正式恢復步驟由 Claude／使用者複查，不由本腳本自動開啟。
4. 更新 Genie `config.js` 的新 Supabase URL／publishable key（另次前端部署，不在本任務範圍）、機器人私人環境的 Supabase URL／secret key、Edge URL 與 Webhook 相關設定。若機器人 invite／聯絡結果 token 依賴舊 secret，保留或輪替的策略需在切換前驗證，避免既有連結失效。用 `docker compose config -q` 檢查，不把 env 印出。
5. 驗登入、名單、專案讀寫、版本衝突、復原聯絡結果、RLS／非成員拒絕、單次通知、機器人表單、舊連結與備份心跳；再更新 backup.env／pgpass 為新正式目標、重新做一次備份／演練。停用舊流程，避免雙重通知。保留私人復原紀錄與已部署 commit；RTO 以這次實測填寫。

### Edge Function 與 secret 名稱盤點（只有名稱，沒有值）

目前 repo／2026-09-27 部署紀錄能支持下表；**無權查線上清單，初次 VPS 設定仍須在 Dashboard 複核**。兩個 repo 都沒有可依賴的完整線上 baseline／現況檔。

| Edge Function | 來源與狀態 | 必要設定名稱 |
| --- | --- | --- |
| `notify-lead` | 機器人 repo `supabase/functions/notify-lead/index.ts`；記錄曾部署，legacy Verify JWT OFF，依 webhook secret 驗請求；需核對當前部署 commit | 平台提供 `SUPABASE_URL`、`SUPABASE_SECRET_KEYS`（`.default`）；自設 `RESEND_API_KEY`、`NOTIFICATION_EMAIL`、`EMAIL_FROM`、`WEBHOOK_SECRET`、`OUTCOME_BASE_URL` |
| `messenger-webhook` | 舊文件記錄保留、當時無呼叫；是否仍在線上／使用、secret 清單未驗證 | 在 Dashboard 私下盤點名稱與用途，不猜測、不抄值 |

`notify-lead` 的舊文件提到 `SUPABASE_SERVICE_ROLE_KEY`，目前程式改用 `SUPABASE_SECRET_KEYS.default`；不要照舊文件新增已失效 key。Edge secrets、SMTP、機器人 env、Auth 與 Webhook URL／secret 都不在這份 public-only 備份；由使用者另外安全保存／在新專案重建。

## 本機驗收與限制

在 Git Bash 於 repo 根目錄執行：

```sh
sh deploy/backup/test/run-local.sh
```

Windows PowerShell 的拉取／保留驗收（傳輸為替身）：

```powershell
powershell.exe -NoProfile -File deploy\backup\test\run-powershell.ps1
```

測試用 PATH 前置假 docker／pg_dump／pg_restore／psql／curl。為避免寫 VPS 的固定絕對路徑，測試只在**私人測試副本**替換 `/var/lib/genie-backup` 與容器 `/work`，其他邏輯照原 worker 執行；Git Bash 的 Windows 檔案權限由 stat 替身回報 0600，**不算 Linux 權限驗證**。PowerShell 測試只在私人副本替換 SCP 執行檔為傳輸替身，正式腳本仍限定 Windows 內建 OpenSSH。測試不需要 Docker daemon、PG 套件、網路或任何正式資料。測試替身能驗流程與失敗邊界，無法證明 SQL 在託管 Supabase 可執行；真實版本／GRANT／Webhook 相依／sequence／Auth／SSH 限制／cron 均須由使用者按上面步驟驗收。

保守限制：`customer_leads` 空表一律失敗；public 資料表／sequence 名稱須符合小寫英數與底線（首字母或底線），以免 TSV／archive 解析含歧義。若未來新增特殊名稱，先擴充解析與測試再部署；不會靜默漏備該表。演練會保留全部使用者 trigger 停用，正式恢復時才逐個重新啟用。

本版不加密、不備 auth/token/hash、不含 Storage 檔、Edge 原始碼／secret、平台託管 schema；先保護 VPS 私人目錄、Windows 磁碟與 SSH key。範例尖括號都要換成私人實值，只在 repo 以外設定。
