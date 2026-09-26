# Genie-Local 專案規則

參考 genie.dotbrand.design 重製的潛在客戶／提案流程工作台。純前端（`index.html`、`app.js`、`styles.css`），免建置、無外部套件，資料存在瀏覽器 localStorage。

## 分工（開發協作 SOP：`D:\Desktop\ai-agent\000_Agent\skills\claude-plans-codex-builds\SKILL.md`）
- **Claude（總指揮）**：方向、規格、分派、裁決、驗收複查、git 提交。
- **Codex（實作）**：依 `docs/` 裡的規格撰寫程式碼，完成後回報修改內容、偏離規格處與沒把握的驗收項目。
- **Grok（反方＋資料蒐集）**：唯讀。網路資料蒐集、對規格與程式碼持反方意見；不修改任何檔案，意見交給 Claude 裁決。
- **使用者**：決策與授權。

## Codex 實作規則
- 只改規格指定的檔案；不要動 `.backups/`、`assets/`、`docs/`（規格由 Claude 維護）。
- 不要執行 `git commit`、`git push` 或改寫歷史，提交由 Claude 在驗收後進行。
- 延續現有程式風格（IIFE、`$`、`esc()`、區塊註解）；所有使用者資料輸出都要經過 `esc()`。
- 改完用 `node --check app.js` 檢查語法。
- **瀏覽器測試只能用 Playwright 官方執行器**（已全域安裝 `@playwright/test` 1.63 與其 Chromium，2026-09-27 煙霧測試未觸發防毒）：
  - 測試檔放在專案 `tests/`，用 `npx playwright test` 執行；使用 Playwright 內建的 Chromium，預設 headless。
  - **禁止**：自己用 `child_process` 啟動 Chrome／Edge、開 `--remote-debugging-port`、直接寫 CDP／Puppeteer 腳本、在 TEMP 放測試腳本。這些會被這台電腦的趨勢科技 Apex One 判定為竊取 cookie 的惡意程式並封鎖（2026-09-27 發生過）。
  - 需要網頁伺服器時，使用 Playwright 設定檔的 `webServer`（`python -m http.server 4173 --bind 127.0.0.1`），不要另外手動開。
  - 最終驗收仍由 Claude 負責；自動化測試結果要附在回報裡。

## 範圍提醒
- 資料庫（Messenger 需求表單機器人的 Supabase）與提案匯出是未來方向，除非規格要求，不要實作。
- Supabase 金鑰等秘密絕不可放進前端或提交。
