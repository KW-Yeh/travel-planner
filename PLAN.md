# 旅程規劃 PWA — 實作計劃

> 狀態：**待核准**。核准前不寫應用程式碼、不安裝套件、不建立 lock 檔。
> 依據：`IMPLEMENTATION_BRIEF.md`、Design artifact（Spec 11 節 + 7 個畫面 + 便利貼）。日期：2026-11-16。

## 0. 前提與需要你決定的事

核准這份計劃即代表同意以下事項（不同意的請標出來）：

1. **初始化 git**：目前資料夾不是 git repo。我會 `git init`，在 `main` 上只 commit `IMPLEMENTATION_BRIEF.md` 與 `PLAN.md`，之後所有實作都在 `feat/travel-planner-mvp` 分支上，每個階段 commit 一次。沒有 remote，不會 push。
2. **第 1 節列出的相依套件**與隨之產生的 `package-lock.json`。
3. **第 9 節的預設值**（失敗鎖定門檻、附件上限、路線快取時效等）。

## 1. 技術選型

| 層 | 選擇 | 理由 |
|---|---|---|
| 前端 | Vite + React 19 + TypeScript | brief 建議的組合；生態成熟，Cloudflare 官方 Vite plugin 直接支援 |
| 開發整合 | `@cloudflare/vite-plugin` | 一個 dev server 同時跑 SPA 與 Worker（含 D1／R2 本機模擬），`wrangler dev` 仍可用於驗收 build 結果 |
| 部署 | 單一 Worker + Static Assets（`assets.not_found_handling = "single-page-application"`，`run_worker_first = ["/api/*"]`） | brief 已決定：一個 Worker 同時提供 PWA 與 API |
| API router | Hono | 輕量（約 14 KB）、為 Workers 設計、型別化的 middleware 與 `c.env` binding |
| 輸入驗證 | Zod | push 進來的資料與路線查詢參數都要在 Worker 端驗證；schema 同時產出前後端共用的 TS 型別 |
| 前端路由 | React Router（library mode） | 只需幾個畫面加底部分頁，不需要 data loader，library mode 就夠 |
| 本機資料庫 | Dexie 4 + `dexie-react-hooks` | `useLiveQuery` 讓畫面直接訂閱 IndexedDB、跨分頁自動更新，省掉自寫 reactive store；本機優先架構最核心的一塊 |
| 樣式 | CSS Modules + CSS custom properties（Vite 內建） | 設計稿是固定 token（色碼、圓角、玻璃參數），不需要 Tailwind 或 CSS-in-JS 套件 |
| PWA | `vite-plugin-pwa`（`injectManifest` 模式） | 產生 manifest 與 precache 清單；用 injectManifest 才能自己寫 API 與附件的離線策略 |
| Google Maps 載入 | `@googlemaps/js-api-loader` | 官方 loader，按需載入 `maps`、`places`、`marker`、`geometry` libraries |
| 密碼雜湊 | WebCrypto PBKDF2-SHA256（100,000 次） | Workers 原生、無相依；Workers 的 PBKDF2 上限是 100,000 次，Argon2／bcrypt 需要 WASM，單一帳號不值得 |
| 測試 | Vitest；Worker 端用 `@cloudflare/vitest-pool-workers`；前端資料層用 `fake-indexeddb` | Worker 測試跑在真的 workerd 裡，D1 migration 會實際套用；時間邏輯是純函式，直接單元測試 |
| E2E／視覺 | Playwright（各階段結束時的冒煙測試） | 實際跑 `wrangler dev` 點過登入、新增地點、離線等流程 |
| Lint | ESLint flat config + `typescript-eslint`（strict）+ `eslint-plugin-react-hooks` | 標準組合；`tsc --noEmit` 另外做 typecheck |
| 工具 | `wrangler` 4.x（devDependency，鎖版本） | D1 migration、secrets、本機執行 |

不採用：Next.js／Remix（不需要 SSR）、Cloudflare Access（brief 已排除）、Workbox 的 runtime 模組以外的 SW 框架。

## 2. 專案結構

```
travel-planner/
├─ wrangler.jsonc            # Worker、assets、D1、R2 binding
├─ migrations/               # D1 SQL migrations（0001_init.sql …）
├─ shared/                   # 前後端共用：Zod schema、型別、時間計算
│  ├─ schema.ts
│  └─ timeline.ts            # 純函式，第 4 階段的單元測試對象
├─ worker/                   # Hono app
│  ├─ index.ts
│  ├─ auth/                  # 登入、session、限流
│  ├─ sync/                  # push / pull
│  ├─ routes/                # Google Routes 代理 + D1 快取
│  └─ attachments/           # R2
├─ src/                      # React PWA
│  ├─ db/                    # Dexie schema、outbox、sync engine
│  ├─ screens/               # Login, Trips, Timeline, Map, StopEditor, Leg, Bookings
│  ├─ components/            # GlassCard, TabBar, DayPicker, SyncBadge …
│  ├─ maps/                  # loader、autocomplete、deep link builder
│  ├─ styles/                # tokens.css、glass.css、motion.css
│  └─ sw.ts                  # service worker
├─ scripts/auth-hash.ts  # 由你自己在本機執行，產生密碼雜湊
├─ .dev.vars.example         # 只有欄位名稱，實際值你自己填
└─ test/                     # worker 整合測試、e2e
```

## 3. D1 Schema

時間慣例：`updated_at` 與 `*_at` 為 UTC epoch 毫秒（INTEGER）。行程內的日期與時刻是「旅程當地時間」的字串（`YYYY-MM-DD`、`HH:MM`），時區存在 Trip 上；只有呼叫 Routes API 時才換算成 UTC。

### 同步資料表（每張都有 `id`、`user_id`、`updated_at`、`deleted`、`version`）

- `id`：客戶端產生的 UUIDv7（離線也能建立，且大致依時間排序）
- `version`：伺服器在寫入時指派的遞增序號，pull 的游標用它，不用 `updated_at`（理由見第 5 節）

```sql
CREATE TABLE trips (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  start_date TEXT, end_date TEXT,          -- 可為 NULL（草稿「日期未定」）
  party_size INTEGER NOT NULL DEFAULT 1,
  time_zone TEXT NOT NULL,                 -- IANA，例如 Asia/Tokyo
  updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL
);

CREATE TABLE days (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  date TEXT NOT NULL,                      -- YYYY-MM-DD
  depart_time TEXT NOT NULL DEFAULT '09:00', -- 從第一站出發的時間
  updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL
);

CREATE TABLE stops (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  day_id TEXT,                             -- NULL = 尚未排入某天（草稿旅程的「想去的地點」）
  position TEXT NOT NULL,                  -- fractional index，改順序只動被拖的那一筆
  place_id TEXT,                           -- NULL = 自訂項目
  name TEXT NOT NULL,
  address TEXT,
  lat REAL, lng REAL,
  place_fetched_at INTEGER,                -- 座標取得時間，用來定期更新（見第 9 節 Google 條款）
  kind TEXT NOT NULL CHECK (kind IN ('sight','food','lodging','transport','other')),
  arrival_mode TEXT NOT NULL DEFAULT 'auto' CHECK (arrival_mode IN ('auto','fixed')),
  fixed_time TEXT,                         -- arrival_mode='fixed' 時必填
  stay_minutes INTEGER NOT NULL,
  note TEXT,
  updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL
);

CREATE TABLE legs (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  from_stop_id TEXT NOT NULL, to_stop_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('transit','drive','walk','bicycle')),
  minutes INTEGER,                         -- NULL = 尚未取得
  steps TEXT,                              -- JSON
  polyline TEXT,                           -- encoded polyline
  source TEXT NOT NULL CHECK (source IN ('google','manual')),
  fetched_at INTEGER,
  query_depart_at INTEGER,                 -- 查詢時帶的出發時刻，判斷是否需要重查
  updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL
);
CREATE UNIQUE INDEX legs_pair ON legs(user_id, from_stop_id, to_stop_id) WHERE deleted = 0;

CREATE TABLE reservations (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  trip_id TEXT NOT NULL, stop_id TEXT NOT NULL,
  time TEXT,                               -- HH:MM，當日當地時間；NULL =「班次時間未填」
  party_size INTEGER,
  code TEXT, url TEXT,
  status TEXT NOT NULL CHECK (status IN ('confirmed','pending','payment_due')),
  updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL
);

CREATE TABLE attachments (                 -- R2 物件的索引
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,                    -- users/{user_id}/attachments/{id}
  filename TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL,
  uploaded INTEGER NOT NULL DEFAULT 0,     -- 1 = R2 已收到檔案
  updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL
);

-- 每張同步表都有：
CREATE INDEX <table>_pull ON <table>(user_id, version);
```

### 伺服器端專用表（不同步）

```sql
CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
CREATE TABLE sync_counter (user_id TEXT PRIMARY KEY, value INTEGER NOT NULL);  -- version 來源

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                     -- 隨機 32 bytes 的 SHA-256；cookie 裡是原值 + HMAC
  user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  user_agent TEXT
);

CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY,                    -- 'ip:<ip>' 或 'global'
  failures INTEGER NOT NULL, window_start INTEGER NOT NULL, locked_until INTEGER
);

CREATE TABLE route_cache (
  key TEXT PRIMARY KEY,                    -- SHA-256(origin|dest|mode|depart_bucket)
  user_id TEXT NOT NULL,
  response TEXT NOT NULL,                  -- 已正規化的 JSON（minutes、steps、polyline）
  fetched_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
```

外鍵不在 SQL 層強制：同步的寫入順序不保證父先子後（離線建立的旅程與地點可能分批上傳），參照完整性由客戶端與 pull 的軟刪除處理。

## 4. API 路由

全部在 `/api` 底下，除了 `POST /api/auth/login` 以外都要有效 session，否則回 `401`。所有變更類請求要求 `Content-Type: application/json`（附件上傳除外）並檢查 `Origin` 與自身網域相同，搭配 `SameSite=Lax` 防 CSRF。

| Method | Path | 說明 |
|---|---|---|
| POST | `/api/auth/login` | `{username, password}` → `204` + `Set-Cookie`；錯誤 `401`；鎖定中 `429 {retryAfterSec}` |
| POST | `/api/auth/logout` | 刪除 D1 session、清 cookie |
| GET | `/api/auth/me` | `{userId, username}`；客戶端開機時確認 session |
| GET | `/api/config` | `{mapsBrowserKey, mapId}`（瀏覽器端 Maps JS 金鑰，以 HTTP referrer 限制網域） |
| POST | `/api/sync/push` | 上傳佇列，見第 5 節 |
| GET | `/api/sync/pull?since=<version>&limit=500` | 拉回變更，見第 5 節 |
| PUT | `/api/attachments/:id` | 原始檔案 body（≤10 MB），寫入 R2，把 `uploaded` 設為 1 |
| GET | `/api/attachments/:id` | 從 R2 串流回傳；確認 `user_id` 相符 |
| POST | `/api/routes/compare` | `{origin, destination, departAt}` → 四種模式的結果（各自可能是 `ok`／`no_route`／`out_of_range`／`error`），每種先查 D1 快取 |

Session cookie：`__Host-tp_session=<token>.<hmac>`，`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`（30 天，從登入算起，不延長）。Worker 驗 HMAC（`SESSION_SECRET`）後再查 D1 確認未過期、未登出。

## 5. 同步協定

### 客戶端（Dexie）

- 每種實體一個 store，欄位與 D1 相同（不含 `version`）。
- `outbox` store：`{table, id}` 為主鍵，同一筆在上傳前多次修改只留最後一次（整列覆寫）。
- `meta` store：`cursor`（最後一次 pull 的 version）、`userId`、`lastSyncAt`。
- 寫入流程：一個 Dexie transaction 內同時寫實體與 outbox，`updated_at = max(Date.now(), 該列舊值 + 1)`，畫面經 `useLiveQuery` 立即更新。
- 觸發同步：寫入後 debounce 1 秒、`online` 事件、App 回到前景、前景時每 60 秒一次。同時只跑一個同步。

### Push：`POST /api/sync/push`

```jsonc
// request
{ "changes": [ { "table": "stops", "row": { "id": "…", "updated_at": 1795000000000, "deleted": 0, … } } ] }
// response
{ "applied": ["id…"], "stale": [ { "table": "stops", "row": { …伺服器上較新的那一列… } } ] }
```

伺服器對每筆：

1. Zod 驗證；`user_id` 一律以 session 為準，忽略客戶端送來的值。
2. 把 `updated_at` 夾在 `≤ 伺服器現在 + 5 分鐘`，避免時鐘超前的裝置永遠贏。
3. **較新者為準**：D1 沒有這筆，或 `incoming.updated_at > existing.updated_at`（相同時比 `id` 字典序，結果固定）→ 寫入並指派新的 `version`；否則放進 `stale` 回傳。
4. 整批用 `D1.batch()` 在同一個 transaction 裡遞增 `sync_counter` 並寫入。單次上限 200 筆，客戶端分批送。

客戶端收到後：`applied` 從 outbox 移除（只有在 outbox 那筆沒有被再次修改時）；`stale` 覆寫本機那列並移出 outbox。

### Pull：`GET /api/sync/pull?since=N`

回傳所有同步表中 `user_id = 我 AND version > N` 的列（含 `deleted = 1`），依 `version` 排序，`{changes, cursor, more}`。客戶端套用規則：本機有這筆的 outbox 待上傳且本機 `updated_at` 較新 → 跳過（下次 push 會解決）；否則覆寫。`more = true` 就繼續拉。

順序：**先 push 再 pull**，這樣自己剛推上去的列在 pull 時會因為 `updated_at` 相同而直接略過。

**為什麼游標用伺服器 `version` 而不用 `updated_at`**：裝置 A 離線三天後才上傳，它的 `updated_at` 是三天前的時間；若裝置 B 用「`updated_at` > 上次同步時間」來拉，會永遠漏掉這些變更。`version` 是伺服器收到的順序，不受裝置時鐘與離線時長影響。

### 其他規則

- 刪除一律是軟刪除（`deleted = 1`）；刪除 Trip 時客戶端同時把底下的 Day／Stop／Leg／Reservation 標為刪除。
- 新裝置登入：`cursor = 0` 拉全部。
- 登出：若 outbox 不是空的，先提示「有 N 筆變更尚未上傳，登出會遺失」；確認後呼叫 logout API，`db.delete()` 清掉整個 IndexedDB 與附件快取。
- Session 過期（線上時拿到 401）：保留本機資料與 outbox，導到登入畫面；登入後若 `userId` 相同就接著同步，不同則先清空。
- 同步狀態指示（Trips 底部）：`已同步到雲端`／`同步中…`／`離線（N 筆待上傳）`／`同步失敗，稍後重試`。

## 6. 時間計算規則（`shared/timeline.ts`）

輸入一天的 Day、依 `position` 排序的 Stops、Legs、Reservations；輸出每站的 `arrival`、`departure`（距當日 00:00 的分鐘數，可超過 1440 顯示「+1」）與衝突清單。純函式、不碰 IO。

1. 第一站：`arrival = day.depart_time`。住宿類（設計稿的「起點 · 出發」）`departure = day.depart_time`；其他類型 `departure = arrival + stay_minutes`。
2. 其他站：`arrival = 前一站 departure + leg.minutes`；`departure = arrival + stay_minutes`。
3. `arrival_mode = 'fixed'`：
   - 推算抵達 ≤ 固定時間 → 抵達 = 固定時間，中間顯示「等待 N 分」；
   - 推算抵達 > 固定時間 → 仍以固定時間為準（不被推擠），標示衝突 `fixed_unreachable`（晚 N 分）。
4. 交通段 `minutes` 未知 → 後續站的時間標示為「未定」，不產生假數字，也不判衝突。
5. 有訂位且 `time` 不為 NULL：`arrival > reservation.time` → 衝突 `late_for_reservation`（晚 N 分）。建議依序：
   - 往前找最近一個停留 ≥ 30 分的 auto 站，建議縮短 `ceil(N/15)*15` 分（設計稿「清水寺停留縮短為 1.5 小時」）；
   - 前一段若有快取的其他模式能補回 N 分，建議改用該模式。
6. **哪些交通段需要重查**（「只重查受影響的段」）：
   - (from, to) 配對是新的 → 查；配對沒變的段沿用原值（`legs_pair` 唯一索引，排回原順序可重用）；
   - `source = 'manual'` → 永不自動重查；
   - 只有 `transit` 會隨出發時刻改變：配對沒變但出發時刻與 `query_depart_at` 差超過 30 分鐘 → 重查；開車（不含路況）、步行、自行車與時刻無關，不因時間變動重查；
   - 新建立的段預設 `transit`；離線時先建立 `minutes = NULL` 的段，連線後補查。

單元測試涵蓋：順延、固定時間等待與衝突、訂位晚到與建議、跨午夜、未知交通、重排後的重查集合、DST 時區的 departAt 換算。

## 7. Google Maps 整合

| 功能 | 做法 | 計費項目 |
|---|---|---|
| 搜尋地點 | 瀏覽器端 Maps JS `places` library 的 `AutocompleteSuggestion`，帶 session token | Autocomplete Requests（有 session token 時結束於 Place Details） |
| 帶入座標與地址 | `Place.fetchFields({fields: ['location','formattedAddress']})`，同一個 session token | Place Details Essentials |
| 地點名稱 | 用 autocomplete 建議裡的 `mainText`，使用者可改 | 不另外計費（`displayName` 可能屬於 Pro 欄位，**實作時查官方欄位表確認**） |
| 貼上 Google Maps 分享連結 | 解析網址中的 place_id 或座標；短網址（`maps.app.goo.gl`）需 Worker 跟隨 redirect 取得長網址 | 無 |
| 地圖 | Maps JS + `AdvancedMarkerElement`（編號圖釘）+ `Polyline`（實線＝大眾運輸／開車，虛線＝步行） | Dynamic Maps；Advanced Marker 需要 Map ID（開發時可用 `DEMO_MAP_ID`） |
| 路線 | Worker 代理 `routes.googleapis.com/directions/v2:computeRoutes`，四種模式並行，`X-Goog-FieldMask` 只取 `routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.steps…`；不設 `routingPreference: TRAFFIC_AWARE*` | Compute Routes Essentials（大眾運輸的層級官方未寫明，Spec 第 8 節已列為待確認） |
| 導航 | `https://www.google.com/maps/dir/?api=1&origin=…&origin_place_id=…&destination=…&destination_place_id=…&travelmode=…`，一次一段 | 免費 |

- **快取鍵**：`origin`（有 place_id 用 place_id，否則座標取 5 位小數）+ `destination` + `mode` + 出發時刻分桶（transit 以 30 分鐘分桶；其他模式不分桶）。
- **大眾運輸 100 天限制**：`departAt` 在 100 天後或已過去 → Worker 不呼叫 Google，直接回 `out_of_range`，畫面顯示「出發日 100 天內才能查詢，請先手動輸入」。
- **手動輸入**：交通方式畫面的「手動輸入交通時間」在完全沒有 Google 回應（離線、未設金鑰、查無路線、out_of_range）時都可用，存為 `source = 'manual'`。
- **金鑰**：兩把。`GOOGLE_ROUTES_KEY` 只在 Worker（secret，限 Routes API）；`GOOGLE_MAPS_BROWSER_KEY` 給瀏覽器（限 Maps JS + Places、限 HTTP referrer），本質上會出現在前端，但仍不 commit，由 `/api/config` 提供。
- **未設金鑰時**：App 照常可用，搜尋改為只能建立自訂項目，地圖分頁顯示清單，交通全手動。這也是本機開發與測試的預設狀態。

## 8. PWA、離線與視覺

- **Manifest**：`name: 旅程規劃`、`display: standalone`、`theme_color: #1D4ED8`、`background_color: #EEF2F7`、192／512／maskable 圖示（以設計稿的地圖 icon 製作）。
- **Service worker**：App shell precache（injectManifest）；`/api/*` 一律 network-only（資料走 IndexedDB，不讓 SW 快取 API 回應造成雙重真相）；附件 `GET /api/attachments/:id` 用 cache-first 存在 Cache Storage，離線可看；Google Maps 腳本不快取（條款與版本問題），離線時地圖分頁改顯示清單與最後一次算好的時間並標示「離線」。
- **離線啟動**：`/api/auth/me` 失敗且本機有 `meta.userId` → 直接進旅程列表用本機資料；沒有 → 顯示登入畫面並提示需要連線。
- **安裝提示**：攔 `beforeinstallprompt` 顯示設計稿的深色卡片；iOS Safari（無此事件、非 standalone）顯示「分享 → 加入主畫面」步驟；「稍後再說」記在 localStorage，7 天內不再顯示。
- **玻璃材質**：`rgba(255,255,255,.6)` + `backdrop-filter: blur(20px) saturate(1.7)` + 上緣 1px 白色內陰影 + 柔和陰影；`@supports not (backdrop-filter: blur(1px))` 時退回 92% 不透明白。背景為藍／橘／綠三個 radial-gradient 光暈。主要按鈕、選取中的 Day 與分頁維持實色。
- **動態**：照 Spec 第 11 節，緩動 `cubic-bezier(.2,.8,.2,1)`；進場 14px／500ms／錯開 50ms；按壓 96%／150ms；面板與分頁列滑入 550ms；衝突卡外框擴散 3 次；時間順延時受影響的時間 200ms 淡換；拖曳排序卡片浮起。`prefers-reduced-motion: reduce` 時全部關閉。
- **無障礙**：文字對比 ≥ 4.5:1（設計稿的 `#4A5560` on 玻璃已加深一階）；點擊區 ≥ 44px；拖曳排序另提供「上移／下移」按鈕給鍵盤與螢幕閱讀器。
- 基準寬度 390px；桌機以置中 480px 欄寬呈現，不另做版面。

## 9. 預設值（可在核准時改）

| 項目 | 預設 | 理由 |
|---|---|---|
| 登入失敗鎖定 | 同一 IP 連續 5 次失敗 → 鎖 15 分，再犯加倍，上限 24 小時；全域 24 小時內 50 次失敗 → 鎖帳號 1 小時 | 只有一組帳號，只用 IP 擋不住換 IP 的暴力破解；全域上限防這個，但也代表攻擊者可以讓你暫時登不進去——離線模式與既有 session 不受影響 |
| 附件上限 | 單檔 10 MB；圖片在客戶端縮到長邊 2048px、JPEG 0.85；PDF 不壓縮 | 回答 Spec 第 8 節的待確認事項；R2 免費額度 10 GB，夠用很久 |
| 路線快取時效 | 30 天 | Google Maps Platform 條款對座標等內容的暫存上限一般是 30 天，**實作時查最新 Service Specific Terms 確認 Routes 的規定** |
| 地點座標更新 | `place_fetched_at` 超過 30 天且連線時，用 place_id 重新取 Place Details Essentials | Spec 第 5 節「只長期保存 place_id，其餘定期更新」；離線可讀與條款之間的折衷 |
| 衝突策略 | 較新的修改為準（逐筆整列，非逐欄位） | brief 已決定；代價是兩台裝置離線時改同一站的不同欄位，較舊那次整筆被蓋掉。逐欄位合併可在之後改，不影響 schema |

## 10. 密鑰與設定

| 名稱 | 種類 | 用途 |
|---|---|---|
| `AUTH_USERNAME` | secret | 固定帳號 |
| `AUTH_PASSWORD_HASH` | secret | `pbkdf2-sha256$100000$<salt b64>$<hash b64>`，由 `npm run auth:hash`（從 stdin 讀密碼、不回顯）在你的終端機產生 |
| `SESSION_SECRET` | secret | cookie HMAC，`openssl rand -base64 32` 產生 |
| `GOOGLE_ROUTES_KEY` | secret | Worker 呼叫 Routes API |
| `GOOGLE_MAPS_BROWSER_KEY` | var | 瀏覽器端 Maps JS／Places |
| `GOOGLE_MAP_ID` | var | Advanced Markers |

本機放在 git 忽略的 `.dev.vars`，只 commit `.dev.vars.example`（空值）。我不會請你把任何值貼進對話，也不會讀取 `.dev.vars`。部署時由你自己執行 `wrangler secret put`。

## 11. 分階段實作與驗收

每個階段結束時都跑：`npm run typecheck`、`npm run lint`、`npm test`，並以 `npm run build && npx wrangler dev`（本機 D1／R2 模擬）實際開啟驗證，完成後在 `feat/travel-planner-mvp` 上 commit。標「未驗證」的項目需要你的 Google 金鑰或 Cloudflare 帳號，我不會假造結果。

### 階段 1：專案骨架
- Vite + React + TS、Cloudflare Vite plugin、Hono Worker、`wrangler.jsonc`（assets、`DB` D1 binding、`ATTACHMENTS` R2 binding）
- `migrations/0001_init.sql`（第 3 節全部資料表）
- ESLint、`tsc`、Vitest（含 workers pool）、Playwright 設定；`.gitignore`、`.dev.vars.example`、`scripts/auth-hash.ts`
- **驗收**：`wrangler d1 migrations apply DB --local` 成功；`wrangler dev` 下 `/` 回傳 React 頁、`/api/health` 回 `200`；Worker 測試能在套用 migration 的 D1 上查到所有資料表

### 階段 2：登入
- 登入、登出、`me`；session cookie；HMAC + D1 session；失敗限流；auth middleware；登入畫面（設計稿 7）
- **驗收（測試）**：正確密碼 → 204 + cookie 屬性正確；錯誤 → 401；第 6 次 → 429 + `retryAfterSec`；過期／竄改的 cookie → 401；未登入打任何 `/api/*` → 401；登出後舊 cookie 失效
- **驗收（手動）**：`wrangler dev` 下以 `.dev.vars` 的測試帳號登入、重整後仍保持登入；鎖定時畫面顯示剩餘等待時間

### 階段 3：本機優先資料層
- Dexie schema、outbox、sync engine、push／pull 端點、較新者為準、同步狀態指示
- **驗收（測試）**：伺服器端——新舊 `updated_at` 的套用與 stale 回傳、未來時間夾限、`user_id` 覆寫、version 遞增與分頁 pull；客戶端（fake-indexeddb + 模擬 fetch）——離線寫入進 outbox、恢復後推送、同筆多次修改只送一次、stale 覆寫、pull 不蓋掉未上傳的本機修改
- **驗收（手動）**：兩個瀏覽器分頁／profile 各自登入，一邊改另一邊在 60 秒內出現；DevTools 切離線 → 改資料 → 狀態顯示「離線（N 筆待上傳）」→ 恢復後歸零

### 階段 4：旅程列表與當日時間軸
- 旅程列表（設計稿 1，分「即將出發／規劃中／已結束」）、建立旅程（名稱 + 日期區間，自動建立 Day）、時間軸（設計稿 2）、Day 切換、拖曳與上移／下移排序、停留時間調整、出發時間調整、衝突卡與建議按鈕
- **驗收（測試）**：第 6 節列出的 `timeline.ts` 單元測試全過
- **驗收（手動）**：建立 3 天旅程、加入手動交通時間的地點，改停留後後面時間順延並淡換；設定訂位時間製造晚到，出現紅色衝突與建議，按建議後衝突消失

### 階段 5：新增／編輯地點與訂位
- 地點編輯（設計稿 4：類型與預設停留、日期、排在、抵達方式、停留、訂位區塊、備註）、自訂無座標項目、訂位與票券頁（設計稿 6：依日期分組、複製代號、狀態、跳到時間軸）、附件上傳 R2（離線時先存 IndexedDB，連線後上傳）
- 這個階段地點搜尋先只支援自訂項目，Google 搜尋在階段 6 接上
- **驗收（測試）**：附件端點——上傳／下載、超過 10 MB 拒絕、別的 `user_id` 讀不到；客戶端附件佇列
- **驗收（手動）**：本機 R2 模擬下上傳截圖與 PDF、重整後可開；離線時附加檔案，恢復連線後自動上傳

### 階段 6：Google 整合
- Places Autocomplete + Place Details Essentials、分享連結解析、Routes 代理 + D1 快取、交通方式畫面（設計稿 5：四模式比較、步驟、手動覆寫）、地圖畫面（設計稿 3：編號圖釘、折線、面板互相聚焦、Day／全部切換）、深連結
- **驗收（測試）**：以模擬的 Google 回應測 Routes 代理——欄位遮罩、回應正規化、快取命中不再呼叫、transit 分桶、100 天外回 `out_of_range`、Google 錯誤時回 `error` 而不是 500；deep link builder 的 URL 編碼；分享連結解析
- **驗收（手動，無金鑰）**：未設金鑰時 App 正常、交通全手動、地圖分頁顯示清單
- **未驗證（需要你的金鑰）**：真實的地點搜尋、真實路線結果、日本大眾運輸涵蓋率、實際計費層級、地圖與圖釘的真實渲染

### 階段 7：PWA 與完工
- Manifest、service worker、離線行為、安裝提示（含 iOS 說明）、玻璃樣式與全部動態、reduced-motion
- **驗收**：Playwright——離線狀態下重開 App 可讀可改、地圖分頁顯示離線清單、reduced-motion 下無動畫；Chrome DevTools 的 installability 檢查通過；375／390／768 寬度無水平捲動；對比度抽查
- **未驗證**：實機 iOS Safari 加入主畫面、實際部署到 Cloudflare（未經你同意不部署、不建立雲端資源）

## 12. 已知風險

- **Places 欄位計費**：`displayName` 是否在 Essentials 內需確認，計劃已改用 autocomplete 的文字避開。
- **Routes 大眾運輸計費層級與日本涵蓋率**：Spec 已列待確認，手動輸入是兜底，不依賴它。
- **Google 條款對快取的限制**：快取時效與地點資料定期更新已照 30 天設計，實作 Routes 快取前會再查條款原文。
- **`__Host-` cookie 在 http://localhost**：Chrome 視 localhost 為安全來源可正常運作；Safari 本機測試可能需要 `wrangler dev --local-protocol https`。
- **單帳號鎖定可被濫用**：見第 9 節，接受這個代價換取防暴力破解。
