# worldTrace — 設計文件

- 日期：2026-08-02
- 狀態：待審閱

## 1. 目標

一款記錄真實移動軌跡並據以擦除地圖迷霧的行動 App，概念源自《世界迷霧》(Fog of World)。

與《世界迷霧》的關鍵差異：**嚴格只接受真實定位**。偵測到模擬定位或物理上不可能的移動時，該筆定位不寫入軌跡、不擦除迷霧。《世界迷霧》公開支援匯入 GPX/KML 軌跡，「真實抵達」靠使用者自律；worldTrace 靠技術強制。

本輪目標是可用的 MVP：自己能天天帶出門使用。不做帳號系統、不做雲端同步、不上架。架構上不把這些路堵死。

## 2. 技術選型

| 項目 | 選擇 | 理由 |
|---|---|---|
| 框架 | React Native + Expo (dev build) | 背景定位與權限的生態文件最齊 |
| 定位 | `expo-location` + `expo-task-manager` | 背景任務跨平台；Android 回傳 `mocked` 旗標 |
| 地圖 | `@maplibre/maplibre-react-native` | 開源無金鑰、支援自訂 raster source |
| 底圖 | OpenStreetMap 圖磚 | 無授權費。正式使用需自架或改付費來源 |
| 儲存 | `expo-sqlite` | 本機單機儲存，磚格位圖存 BLOB |
| 語言 | TypeScript | — |

已評估並排除：Flutter（`maplibre_gl` 綁定維護較弱）、transistorsoft `background-geolocation`（Android 需付費授權，MVP 階段成本不合）。

## 3. 架構

```
ui/                     畫面層
  └─ 只讀
stats/ timeline/ achievements/    衍生讀取層
  └─ 只讀
store/                  SQLite 持久層（唯一寫入點）
  ├─ fog/               磚格點陣引擎（純函式）
  └─ gatekeeper/        真實性驗證（純函式）
       └─ capture/      背景定位任務（唯一碰平台 API 的地方）
```

### 模組契約

**`capture/`** — 唯一使用 `expo-location` 與 `TaskManager` 的模組。收到 raw 定位即向下傳遞，不做任何判斷。必須可抽換成餵預錄 GPX 的假實作，讓整條管線在模擬器上可測。

**`gatekeeper/`** — 純函式 `verify(candidate, lastAccepted, deviceFlags) → Accepted | Rejected(reason)`。零 I/O、零平台 API。專案測試密度最高處。

**`fog/`** — 純運算：經緯度 → 磚格座標 → 位元索引；圓刷塗抹；線段插值；popcount。

**`store/`** — 唯一寫入 SQLite 的模組。上層功能一律只讀。

**上層四功能** — 彼此無依賴，各自只與 `store` 溝通。任一功能未完成不影響其他功能運作。

## 4. 定位驗證閘

### 規則（依序評估，任一觸發即拒絕）

| 規則 | 判定條件 | 平台 |
|---|---|---|
| `MOCK_PROVIDER` | `location.mocked === true` | Android |
| `MOCK_APP_ENABLED` | 開發者選項已設定模擬位置應用程式 | Android |
| `LOW_ACCURACY` | `accuracy > 100` 公尺 | 兩者 |
| `TIME_ANOMALY` | timestamp 早於或等於上一個已接受點 | 兩者 |
| `TELEPORT` | 與上一點的隱含速度 > 350 m/s | 兩者 |
| `IMPOSSIBLE_ACCEL` | 速度變化率 > 10 m/s² 且持續超過 3 個取樣 | 兩者 |

`MOCK_APP_ENABLED` 觸發時暫停記錄並在 UI 顯示持續橫幅，直到使用者移除該設定。

### 平台限制（明確記載）

iOS 不提供模擬定位旗標。該平台的保證來自作業系統本身——未越獄裝置無法對第三方 App 注入假定位——因此 iOS 側僅依賴 `LOW_ACCURACY` 至 `IMPOSSIBLE_ACCEL` 的物理檢查。

**不實作越獄／root 偵測。** 誤判率高、可被繞過，且誤判代價（正常使用者被永久阻擋記錄）大於收益。

### 拒絕的處理

被拒絕的定位不寫入 `points`、不擦除迷霧。但寫入一筆 `rejections` 紀錄：時間戳、原因、精度。**不記錄座標**。

設定頁顯示近期拒絕摘要（例如「今日 14 筆定位被拒絕，原因：模擬定位供應者」）。此機制不繞過嚴格模式，目的是讓規則誤判時使用者能察覺，否則規則調錯將完全無從診斷。

### 長中斷處理

距上一個已接受點超過 10 分鐘時不評估 `TELEPORT`（無法判定）。改為結束當前 segment、開啟新 segment，兩段之間不做軌跡插值。

## 5. 迷霧資料模型

### 磚格方案

- Web Mercator XYZ 座標，固定 z = 16
- 每磚一張 128 × 128 位圖，2048 bytes
- 解析度：赤道每 bit 約 4.8 公尺；北緯 25 度約 4.3 公尺
- 僅儲存曾探索過的磚格

### 寫入

- 筆刷：預設半徑 30 公尺（約 7 bit），設定可調範圍 20–60 公尺
- 相鄰兩個已接受點之間做線段插值，沿線塗圓刷
- 插值上限：間隔超過 5 分鐘或 500 公尺則不插值，僅塗抹兩端點
- 跨磚邊界需分割處理

### 探索度

所有磚格位圖的 popcount 總和 × 每 bit 面積。結果快取於 `meta`。

## 6. 渲染管線

迷霧為覆蓋整個視野的暗色圖層，已探索的 bit 設為透明。

1. 磚格位圖編碼為 PNG，寫入 `expo-file-system` 目錄
2. MapLibre `RasterSource` 以 `file://.../{z}/{x}/{y}.png` template 讀取
3. 低 zoom 檢視需預生成 z10 / z12 / z14 降採樣聚合磚

### 已知風險（最高優先）

MapLibre RN 是否支援 `file://` 的 tile URL template、以及磚格更新後如何強制圖層重載，尚未驗證。**實作計畫第一步必須是驗證此點的 spike。**

備案：
- (a) 執行本機 HTTP tile server
- (b) 退回 `ImageSource`，以單張圖覆蓋當前視野

## 7. 資料庫 Schema

```sql
segments(id, started_at, ended_at)
points(id, segment_id, ts, lat, lon, accuracy, altitude, speed, heading)
fog_tiles(z, x, y, bitmap BLOB, updated_at, PRIMARY KEY(z, x, y))
rejections(id, ts, reason, accuracy)
achievements(id, unlocked_at)
meta(key, value)
```

`meta` 存放 schema 版本、使用者設定、統計快取。

## 8. MVP 功能

### 核心

背景持續記錄 → 驗證 → 擦除迷霧 → 地圖即時呈現。

### 資料匯出與備份還原

- 匯出 GPX（軌跡）
- 匯出完整 SQLite 快照（zip）
- 由快照還原
- 透過系統分享面板

無雲端同步的情況下，此為唯一的資料保全手段。

### 探索度統計

累積公里數、已探索面積、走過的國家與城市數、全球探索百分比。資料來源為 `fog_tiles` popcount 與 `points` 距離累加。

### 時間軸與每日回放

依 `segments` 分組，可選擇日期或期間檢視當時路線與新開範圍。

### 成就與等級

純衍生計算，讀取 `store` 即時算出；`achievements` 表僅記錄解鎖時間戳。規則變更後重算即可，不會產生資料不一致。

## 9. 錯誤處理

| 情境 | 處理 |
|---|---|
| 定位權限被拒 | 專屬引導頁說明用途與設定路徑 |
| 僅授予「使用期間」權限 | 引導升級為「一律允許」，說明背景記錄的必要性 |
| Android 省電機制 | 引導使用者將 App 加入電池最佳化白名單 |
| 背景任務被系統終止 | 收尾當前 segment；重啟後開新 segment，不插值 |
| SQLite 寫入失敗 | 定位點先進記憶體 ring buffer，指數退避重試 |
| 磁碟空間不足 | 停止記錄並警告，優先保全既有資料 |

## 10. 測試策略

測試主力集中於兩個純函式模組——兩者皆不需實機、地圖或外出驗證。

**`gatekeeper`** — 合成軌跡的表格測試：正常步行、開車、民航機、瞬移、模擬定位旗標、時間倒退、精度飄移、長時間中斷後恢復。

**`fog`** — 已知座標驗證 bit 落點、跨磚邊界分割、插值上限行為、popcount 正確性。

**整合測試** — 以假的 `capture` 實作餵入預錄 GPX，跑完整條管線並驗證最終磚格狀態。

**實機測試** — 僅用於驗證背景存活、耗電、權限流程。

## 11. 實作順序

1. **Spike：驗證 MapLibre 自訂磚格渲染**（最高風險，先解）
2. 專案骨架、SQLite schema、`store` 層
3. `fog` 磚格引擎（純函式，含完整測試）
4. `gatekeeper` 驗證閘（純函式，含完整測試）
5. `capture` 背景定位 + 假資料來源
6. 地圖畫面與迷霧圖層串接 → **此時核心已可用**
7. 資料匯出與備份還原
8. 探索度統計
9. 時間軸與回放
10. 成就與等級

每個階段結束時皆為可運作狀態。

## 12. 非目標（Future Work）

- 帳號系統與雲端同步
- 社群功能、軌跡分享
- GPX / KML 匯入（與嚴格真實性原則衝突，若日後加入須明確標記為外部來源資料）
- Wi-Fi / 基地台 / 氣壓計等多重訊號交叉驗證
- 上架與付費模式
- 離線底圖打包
