# 旅程規劃

離線優先的旅程規劃 PWA。單一 Cloudflare Worker 同時提供前端與 `/api`，資料存在 D1，附件存在 R2。

## 本機開發

```bash
npm install
cp .dev.vars.example .dev.vars   # 自己填值，這個檔案不會進 git
npm run auth:hash                # 輸入密碼，輸出貼到 .dev.vars 的 AUTH_PASSWORD_HASH
npm run db:migrate:local
npm run dev
```

檢查：`npx tsc -b`、`npx eslint .`、`npx vitest run`、`npx playwright test`。

## Google Maps 金鑰

| 名稱 | 放哪裡 | 要啟用的 API | 限制 |
|---|---|---|---|
| `GOOGLE_ROUTES_KEY` | Worker secret（只在伺服器端使用） | Routes API | API 限制：只開 Routes API。不要設 HTTP referrer 限制（呼叫來自 Worker） |
| `GOOGLE_MAPS_BROWSER_KEY` | Worker secret（由 `/api/config` 在登入後交給瀏覽器） | Maps JavaScript API、Places API (New) | HTTP referrer：你的網域（例如 `https://travel-planner.<subdomain>.workers.dev/*`）與 `http://localhost:*/*` |
| `GOOGLE_MAP_ID` | Worker secret | — | 在 Google Cloud 的 Map Management 建立的 JavaScript 向量地圖 ID（Advanced Markers 需要） |

沒有設定金鑰時 App 仍可用：交通時間改為手動輸入、地圖分頁顯示清單。

本機放在 `.dev.vars`；正式環境用 `npx wrangler secret put <名稱>` 設定。

**快取政策**：Google 條款未允許快取 Routes 回應，所以 `ROUTE_CACHE_TTL_HOURS` 預設 `0`（D1 路線快取關閉）。地點座標最多保存 30 天，App 會在 25 天後自動用 place_id 重新取得。

## 部署

```bash
npx wrangler login
npx wrangler d1 create travel-planner        # 把印出的 database_id 填進 wrangler.jsonc
npx wrangler r2 bucket create travel-planner-attachments
npm run db:migrate:remote
npx wrangler secret put AUTH_USERNAME
npx wrangler secret put AUTH_PASSWORD_HASH   # npm run auth:hash 的輸出
npx wrangler secret put SESSION_SECRET       # openssl rand -base64 32
npx wrangler secret put GOOGLE_ROUTES_KEY
npx wrangler secret put GOOGLE_MAPS_BROWSER_KEY
npx wrangler secret put GOOGLE_MAP_ID
npm run deploy
```
