# CNMM 儀器預約系統

公開網站：[mind-instruments.github.io](https://mind-instruments.github.io/)

本儲存庫只包含網站前端。帳號、預約與耗材資料保存在 CNMM 專用的 Supabase 後臺；GitHub Pages 不儲存正式資料或服務金鑰。

- [操作指南](https://mind-instruments.github.io/guide/)
- [隱私與 Google 資料使用](https://mind-instruments.github.io/privacy.html)

網站由 `public-site-cnmm/web` 產生；修改原始網站後，使用 `node tools/build-github-pages.mjs` 更新此儲存庫的靜態檔案。
