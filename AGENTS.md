# Genie-Local 專案規則

參考 genie.dotbrand.design 重製的潛在客戶／提案流程工作台。純前端（`index.html`、`app.js`、`styles.css`），免建置、無外部套件，資料存在瀏覽器 localStorage。

## 分工（開發協作 SOP：`D:\Desktop\ai-agent\000_Agent\skills\claude-plans-codex-builds\SKILL.md`）
- **Claude**：方向、規格、驗收複查、git 提交。
- **Codex**：依 `docs/` 裡的規格撰寫程式碼，完成後回報修改內容、偏離規格處與沒把握的驗收項目。
- **使用者**：決策與授權。

## Codex 實作規則
- 只改規格指定的檔案；不要動 `.backups/`、`assets/`、`docs/`（規格由 Claude 維護）。
- 不要執行 `git commit`、`git push` 或改寫歷史，提交由 Claude 在驗收後進行。
- 延續現有程式風格（IIFE、`$`、`esc()`、區塊註解）；所有使用者資料輸出都要經過 `esc()`。
- 改完用 `node --check app.js` 檢查語法。

## 範圍提醒
- 資料庫（Messenger 需求表單機器人的 Supabase）與提案匯出是未來方向，除非規格要求，不要實作。
- Supabase 金鑰等秘密絕不可放進前端或提交。
