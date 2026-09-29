# Genie-Local 部署

靜態網站由獨立的 `genie-web` 容器提供，經現有 Traefik 的 `websecure` 入口與 Let's Encrypt 對外服務。網站原始碼以唯讀方式掛載；Compose 專案名稱固定為 `genie-local`。以下指令都在 VPS 執行，不會操作機器人服務。

## 首次部署

1. 將 `app.sameheart-design.com` 的 DNS 指向 VPS，確認 Docker、Traefik 與外部網路 `hermes-agent-llsk_default` 已運作。
2. 部署前查看機器人狀態，確認 `STATUS` 包含 `(healthy)`：

   ```sh
   docker ps --filter 'name=sanhe-bot' --format 'table {{.Names}}\t{{.Status}}'
   ```

3. 複製公開 repo，並從 repo 根目錄啟動網站：

   ```sh
   cd /docker/hermes-agent-llsk/data/projects
   git clone https://github.com/kaoger/Genie-Local.git genie-local
   cd genie-local
   docker compose -f deploy/compose.genie.yaml config --quiet
   docker compose -f deploy/compose.genie.yaml run --rm --no-deps genie-web nginx -t
   docker compose -f deploy/compose.genie.yaml up -d
   ```

   若 repo 已存在，從 `cd /docker/hermes-agent-llsk/data/projects/genie-local` 開始即可。

4. 部署後再次執行第 2 步的 `docker ps`，確認機器人仍為 `(healthy)`，並執行下列檢查。

## 檢查網站

```sh
docker ps --filter 'name=genie-local' --format 'table {{.Names}}\t{{.Status}}'
curl -I https://app.sameheart-design.com
curl -o /dev/null -w '%{http_code}\n' https://app.sameheart-design.com/.git/config
curl -o /dev/null -w '%{http_code}\n' https://app.sameheart-design.com/tests/
curl -o /dev/null -w '%{http_code}\n' https://app.sameheart-design.com/docs/
```

首頁應為 200，且回應含 CSP、Referrer-Policy、X-Content-Type-Options、Permissions-Policy、Strict-Transport-Security 與 `Cache-Control: no-cache`。三個封鎖路徑都應為 404。容器的 `STATUS` 應包含 `(healthy)`。若要查容器日誌：`docker compose -f deploy/compose.genie.yaml logs --tail=100 genie-web`。

## 更新

從 repo 根目錄執行 `git pull --ff-only`。靜態檔透過唯讀掛載立即更新，HTML、JS、CSS 會重新驗證快取。若修改了 `deploy/nginx.conf` 或 Compose 設定，另執行 `docker compose -f deploy/compose.genie.yaml up -d --force-recreate genie-web` 讓設定生效。更新後重跑上方網站與機器人狀態檢查。

## 停止與移除

在 repo 根目錄執行：

```sh
docker compose -f deploy/compose.genie.yaml down
```

這只會關閉 `genie-local` Compose 專案的容器；外部 Traefik 網路及機器人容器不會被移除。再用部署前的 `docker ps --filter 'name=sanhe-bot'` 指令確認機器人仍為 `(healthy)`。
