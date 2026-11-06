# WorldTrace 航班追蹤與飛行護照系統開發規格書 (Flighty / byAir Style)

本開發文件針對 [waltwait/WorldTrace](https://github.com/waltwait/WorldTrace) 專案架構量身設計，旨在不破壞現有「真實物理 GPS 迷霧探索」核心原則的前提下，完整導入 **Flighty / byAir 風格的航班追蹤、Google AI Studio (`gemini-3.5-flash-lite`) 機票檔案自動解析、大圓航線地圖疊加，以及個人飛行護照（Profile）統計系統**。所有功能皆為 App 原生內建功能，不設任何 Pro 付費牆或商業推銷橫幅。

## 1. 核心架構原則與對接規範

根據專案現有的 [`CLAUDE.md`](https://github.com/waltwait/WorldTrace/blob/main/CLAUDE.md) 與程式碼結構，本功能的實作嚴格遵守以下四項架構規範：

| 架構原則 | 現有 WorldTrace 規範 | 航班追蹤模組對接設計 |
| :--- | :--- | :--- |
| **真實 GPS 鐵則** | `points` 與 `fog_tiles` 僅接受經由 `src/gatekeeper/` 驗證的真實物理 GPS 座標，拒絕模擬位置與外部軌跡匯入。 | 航班資料獨立儲存於 SQLite 的 `flights` 與 `flight_docs` 表，**絕不寫入** `points` 或 `fog_tiles`，確保地面探索面積與迷霧磚格 100% 源自真實地面移動。 |
| **Ports & Adapters** | 資料庫透過 [`src/store/driver.ts`](https://github.com/waltwait/WorldTrace/blob/main/src/store/driver.ts) 的 `SqlDriver` 介面抽象化；雲端透過 `DriveTransport` 抽象化。 | 新增的 `src/store/flights.ts` 完全使用 `SqlDriver` 介面；外部航空 API 與 Gemini AI 解析亦透過獨立 Port 介面封裝，支援在 [`vitest`](https://vitest.dev/) 中以 `node:sqlite` 執行毫秒級單元測試。 |
| **效能與導覽留存** | [`App.tsx`](https://github.com/waltwait/WorldTrace/blob/main/App.tsx) 使用 `pagesSlide` 與 `openedTabs` 進行水平滑動與延遲掛載，避免 [`@maplibre/maplibre-react-native`](https://github.com/maplibre/maplibre-react-native) 重複銷毀重建。 | 頂層導覽列改為 3 個英文主分頁 `['Trips', 'Map', 'Profile']`（`Trips` 為最左側預設首頁、`Map` 居中、`Profile` 置右並整合飛行護照、探索統計、造訪機場看板、時間軸與備份），全部接入 `openedTabs` 機制；航線弧線則作為獨立 `<GeoJSONSource id="flight-arcs">` 圖層疊加於 MapLibre 實例上。 |
| **雲端備份整合** | [`src/cloud/`](https://github.com/waltwait/WorldTrace/tree/main/src/cloud) 定期將本地 SQLite 資料庫快照備份至 Google Drive。 | 升級 [`src/store/schema.ts`](https://github.com/waltwait/WorldTrace/blob/main/src/store/schema.ts) 至 `SCHEMA_VERSION = 3`，所有航班紀錄與統計會自動隨現有 Google Drive 備份機制同步與還原。 |

## 2. 專案目錄與新增/修改檔案清單

以下為建議在 [`src/`](https://github.com/waltwait/WorldTrace/tree/main/src) 中新增與修改的檔案結構：

```text
WorldTrace/
├── App.tsx                             # [修改] 頂層導覽列改為 ['Trips', 'Map', 'Profile']，Trips 置左當首頁，Profile 整合探索/時間軸/備份
├── package.json                        # [修改] 新增 expo-document-picker 與 expo-image-picker
└── src/
    ├── flights/                        # [新增目錄] 航班核心領域邏輯 (純函式與 Port 介面)
    │   ├── types.ts                    # 航班、機場、AI 解析結果與狀態列舉型別定義
    │   ├── airports.ts                 # 離線 IATA 機場索引 (經緯度、城市、國旗、IANA 時區) 與時差計算
    │   ├── airports.test.ts            # 時區差異與機場查詢單元測試
    │   ├── greatCircle.ts              # Haversine 飛行里程計算與球面大圓航線 GeoJSON 生成器
    │   ├── greatCircle.test.ts         # 航線座標插值與跨換日線單元測試
    │   ├── geminiParser.ts             # 串接 gemini-3.5-flash-lite 結構化解析 PDF / 登機證圖片
    │   ├── geminiParser.test.ts        # AI JSON Schema 解析與錯誤處理測試
    │   ├── flightStatusApi.ts          # 航空狀態追蹤 Port 與 AeroDataBox / FlightAware Adapter
    │   ├── flightStats.ts              # 計算個人飛行護照統計 (總趟數、時數、里程、國家數、印章)
    │   └── flightStats.test.ts         # 統計聚合邏輯單元測試
    ├── store/
    │   ├── schema.ts                   # [修改] SCHEMA_VERSION 升至 3，新增 flights 與 flight_docs 資料表
    │   ├── flights.ts                  # [新增] 封裝航班 CRUD、Active/Finished 篩選與狀態更新 SQL
    │   └── flights.test.ts             # 基於 nodeDriver (node:sqlite) 的資料庫整合測試
    └── ui/
        ├── theme.ts                    # [修改] 擴充 Flighty / byAir 純黑底、深灰卡片與 #facc15 機場指示牌黃色 Token
        ├── MapScreen.tsx               # [修改] 新增 flight-arcs 大圓航線圖層與圖層顯示開關 (迷霧 / 航線 / 雙層)
        ├── FlightsScreen.tsx           # [新增] Trips 旅途首頁 (Active/Finished 切換、倒數天數、快捷列、+ FAB)
        ├── FlightDetailSheet.tsx       # [新增] 航班詳情頁 (航線地圖、黃色登機門/轉盤牌、PNR 複製放大、時區卡)
        ├── AddFlightSheet.tsx          # [新增] 新增航班彈窗 (AI 機票檔案上傳預覽 + 手動輸入表單)
        └── ProfileScreen.tsx           # [新增] Flighty Profile 頁 (藍紫漸層飛行護照卡 + 探索/機場看板 + 時間軸 + 備份三合一)
```

## 3. 環境依賴與設定 (`package.json` & `.env`)

### 3.1 安裝 Expo 檔案與圖片選取套件

專案目前已內建 [`expo-file-system`](https://docs.expo.dev/versions/latest/sdk/filesystem/)（`~57.0.1`）與 [`expo-sqlite`](https://docs.expo.dev/versions/latest/sdk/sqlite/)（`~57.0.1`）。請使用 Expo CLI 安裝相容於 Expo SDK 57 的檔案與相簿選取器：

```bash
npx expo install expo-document-picker expo-image-picker
```

* [`expo-document-picker`](https://docs.expo.dev/versions/latest/sdk/document-picker/)：用於選取航空公司寄發的電子機票 PDF 行程單。
* [`expo-image-picker`](https://docs.expo.dev/versions/latest/sdk/imagepicker/)：用於選取手機相簿中的登機證截圖或紙本登機證照片。

### 3.2 環境變數設定 (`.env.example`)

在 `.env` 中新增 Google AI Studio API Key 與航班追蹤 API Key（亦可於 App 內設定頁提供輸入框儲存於 SQLite `meta` 表）：

```ini
# Google AI Studio API Key (用於 gemini-3.5-flash-lite 機票解析)
EXPO_PUBLIC_GEMINI_API_KEY=your_ai_studio_api_key_here

# 航班即時狀態 API Key (AeroDataBox RapidAPI Key 或 FlightAware AeroAPI Key)
EXPO_PUBLIC_FLIGHT_API_KEY=your_flight_api_key_here
```

## 4. 資料庫 Schema 升級規格 (`SCHEMA_VERSION = 3`)

### 4.1 修改 `src/store/schema.ts`

將 [`src/store/schema.ts`](https://github.com/waltwait/WorldTrace/blob/main/src/store/schema.ts) 中的 `SCHEMA_VERSION` 從 `2` 升級為 `3`，並加入 `flights` 與 `flight_docs` 兩張資料表：

```typescript
// src/store/schema.ts
export const SCHEMA_VERSION = 3;

export const MIGRATION_V3_SQL = `
CREATE TABLE IF NOT EXISTS flights (
  id TEXT PRIMARY KEY,
  flight_number TEXT NOT NULL,          -- 航班號碼，例如 "CI501"
  airline_code TEXT NOT NULL,           -- 航司二字碼，例如 "CI"
  airline_name TEXT NOT NULL,           -- 航司名稱，例如 "China Airlines"
  alliance TEXT,                        -- 航空聯盟，例如 "SkyTeam" | "Star Alliance" | "oneworld"
  dep_iata TEXT NOT NULL,               -- 起飛機場 IATA，例如 "TPE"
  arr_iata TEXT NOT NULL,               -- 抵達機場 IATA，例如 "PVG"
  dep_scheduled_utc INTEGER NOT NULL,   -- 表定起飛時間 (Unix epoch ms)
  dep_estimated_utc INTEGER,            -- 預計/實際起飛時間 (Unix epoch ms)
  arr_scheduled_utc INTEGER NOT NULL,   -- 表定抵達時間 (Unix epoch ms)
  arr_estimated_utc INTEGER,            -- 預計/實際抵達時間 (Unix epoch ms)
  dep_tz TEXT NOT NULL,                 -- 起飛地 IANA 時區，例如 "Asia/Taipei"
  arr_tz TEXT NOT NULL,                 -- 抵達地 IANA 時區，例如 "Asia/Shanghai"
  dep_terminal TEXT,                    -- 起飛航廈，例如 "2"
  arr_terminal TEXT,                    -- 抵達航廈，例如 "1"
  dep_gate TEXT,                        -- 起飛登機門，例如 "D6"
  arr_gate TEXT,                        -- 抵達登機門，例如 "18"
  baggage_belt TEXT,                    -- 行李轉盤，例如 "7"
  status TEXT NOT NULL DEFAULT 'SCHEDULED', -- SCHEDULED | BOARDING | IN_AIR | LANDED | DELAYED | CANCELLED
  distance_miles REAL NOT NULL,         -- 大圓飛行英里數，例如 420.0
  duration_minutes INTEGER NOT NULL,    -- 航程分鐘數，例如 125
  seat TEXT,                            -- 座位號碼，例如 "24A"
  cabin_class TEXT,                     -- 艙等：Economy | Premium Economy | Business | First
  pnr TEXT,                             -- 訂位代號 (Booking Reference)，例如 "7X9K2M"
  notes TEXT,                           -- 個人備註
  notifications_enabled INTEGER NOT NULL DEFAULT 0, -- 0 或 1
  is_finished INTEGER NOT NULL DEFAULT 0,           -- 0 (Active) 或 1 (Finished)
  last_synced_at INTEGER,               -- 最後一次向航空 API 更新狀態的時間戳
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_flights_dep_time ON flights(dep_scheduled_utc DESC);
CREATE INDEX IF NOT EXISTS idx_flights_finished ON flights(is_finished, dep_scheduled_utc ASC);

CREATE TABLE IF NOT EXISTS flight_docs (
  id TEXT PRIMARY KEY,
  flight_id TEXT NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  local_uri TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_flight_docs_flight_id ON flight_docs(flight_id);
`;
```

### 4.2 新增 `src/store/flights.ts` 資料存取層

使用現有的 `SqlDriver` 介面實作航班 CRUD，確保與 `expoDriver.ts` 及 `testing/nodeDriver.ts` 完全相容：

```typescript
// src/store/flights.ts
import type { SqlDriver } from './driver';
import type { FlightRecord, FlightDocRecord } from '../flights/types';

export async function insertFlight(db: SqlDriver, flight: FlightRecord): Promise<void> {
  await db.run(
    `INSERT OR REPLACE INTO flights (
      id, flight_number, airline_code, airline_name, alliance,
      dep_iata, arr_iata, dep_scheduled_utc, dep_estimated_utc,
      arr_scheduled_utc, arr_estimated_utc, dep_tz, arr_tz,
      dep_terminal, arr_terminal, dep_gate, arr_gate, baggage_belt,
      status, distance_miles, duration_minutes, seat, cabin_class,
      pnr, notes, notifications_enabled, is_finished, last_synced_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      flight.id, flight.flightNumber, flight.airlineCode, flight.airlineName, flight.alliance ?? null,
      flight.depIata, flight.arrIata, flight.depScheduledUtc, flight.depEstimatedUtc ?? null,
      flight.arrScheduledUtc, flight.arrEstimatedUtc ?? null, flight.depTz, flight.arrTz,
      flight.depTerminal ?? null, flight.arrTerminal ?? null, flight.depGate ?? null,
      flight.arrGate ?? null, flight.baggageBelt ?? null, flight.status,
      flight.distanceMiles, flight.durationMinutes, flight.seat ?? null,
      flight.cabinClass ?? null, flight.pnr ?? null, flight.notes ?? null,
      flight.notificationsEnabled ? 1 : 0, flight.isFinished ? 1 : 0,
      flight.lastSyncedAt ?? null, flight.createdAt,
    ]
  );
}

export async function listFlightsByFilter(
  db: SqlDriver,
  filter: 'active' | 'finished'
): Promise<FlightRecord[]> {
  const isFinishedVal = filter === 'finished' ? 1 : 0;
  const order = filter === 'active' ? 'ASC' : 'DESC';
  const rows = await db.all<any>(
    `SELECT * FROM flights WHERE is_finished = ? ORDER BY dep_scheduled_utc ${order}`,
    [isFinishedVal]
  );
  return rows.map(mapRowToFlight);
}

export async function updateFlightFields(
  db: SqlDriver,
  flightId: string,
  patch: Partial<Pick<FlightRecord, 'depGate' | 'arrGate' | 'baggageBelt' | 'seat' | 'notes' | 'status' | 'isFinished' | 'notificationsEnabled'>>
): Promise<void> {
  const sets: string[] = [];
  const params: any[] = [];

  if (patch.depGate !== undefined) { sets.push('dep_gate = ?'); params.push(patch.depGate); }
  if (patch.arrGate !== undefined) { sets.push('arr_gate = ?'); params.push(patch.arrGate); }
  if (patch.baggageBelt !== undefined) { sets.push('baggage_belt = ?'); params.push(patch.baggageBelt); }
  if (patch.seat !== undefined) { sets.push('seat = ?'); params.push(patch.seat); }
  if (patch.notes !== undefined) { sets.push('notes = ?'); params.push(patch.notes); }
  if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
  if (patch.isFinished !== undefined) { sets.push('is_finished = ?'); params.push(patch.isFinished ? 1 : 0); }
  if (patch.notificationsEnabled !== undefined) { sets.push('notifications_enabled = ?'); params.push(patch.notificationsEnabled ? 1 : 0); }

  if (sets.length === 0) return;
  params.push(flightId);
  await db.run(`UPDATE flights SET ${sets.join(', ')} WHERE id = ?`, params);
}

function mapRowToFlight(row: any): FlightRecord {
  return {
    id: row.id,
    flightNumber: row.flight_number,
    airlineCode: row.airline_code,
    airlineName: row.airline_name,
    alliance: row.alliance ?? undefined,
    depIata: row.dep_iata,
    arrIata: row.arr_iata,
    depScheduledUtc: row.dep_scheduled_utc,
    depEstimatedUtc: row.dep_estimated_utc ?? undefined,
    arrScheduledUtc: row.arr_scheduled_utc,
    arrEstimatedUtc: row.arr_estimated_utc ?? undefined,
    depTz: row.dep_tz,
    arrTz: row.arr_tz,
    depTerminal: row.dep_terminal ?? undefined,
    arrTerminal: row.arr_terminal ?? undefined,
    depGate: row.dep_gate ?? undefined,
    arrGate: row.arr_gate ?? undefined,
    baggageBelt: row.baggage_belt ?? undefined,
    status: row.status,
    distanceMiles: row.distance_miles,
    durationMinutes: row.duration_minutes,
    seat: row.seat ?? undefined,
    cabinClass: row.cabin_class ?? undefined,
    pnr: row.pnr ?? undefined,
    notes: row.notes ?? undefined,
    notificationsEnabled: Boolean(row.notifications_enabled),
    isFinished: Boolean(row.is_finished),
    lastSyncedAt: row.last_synced_at ?? undefined,
    createdAt: row.created_at,
  };
}
```

## 5. 核心領域模組實作規格 (`src/flights/`)

### 5.1 離線機場索引與抵達時區對比 (`src/flights/airports.ts`)

可由開源的 [OurAirports 資料集 (`airports.csv`)](https://github.com/davidmegginson/ourairports-data) 篩選全球具有 IATA 代碼的商業機場轉為靜態字典，支援離線查詢經緯度、國旗 Emoji 與「On Arrival」時區變化卡片：

```typescript
// src/flights/airports.ts
export interface AirportInfo {
  iata: string;
  name: string;
  city: string;
  countryCode: string; // ISO 3166-1 alpha-2，例如 "TW", "CN", "JP"
  flag: string;        // 例如 "🇹🇼"
  lat: number;
  lon: number;
  tz: string;          // IANA 時區，例如 "Asia/Taipei"
  utcOffsetHours: number;
}

export const AIRPORTS_DB: Record<string, AirportInfo> = {
  TPE: { iata: 'TPE', name: 'Taiwan Taoyuan International', city: 'Taipei', countryCode: 'TW', flag: '🇹🇼', lat: 25.0777, lon: 121.2328, tz: 'Asia/Taipei', utcOffsetHours: 8 },
  TSA: { iata: 'TSA', name: 'Taipei Songshan', city: 'Taipei', countryCode: 'TW', flag: '🇹🇼', lat: 25.0694, lon: 121.5525, tz: 'Asia/Taipei', utcOffsetHours: 8 },
  KHH: { iata: 'KHH', name: 'Kaohsiung International', city: 'Kaohsiung', countryCode: 'TW', flag: '🇹🇼', lat: 22.5771, lon: 120.3500, tz: 'Asia/Taipei', utcOffsetHours: 8 },
  PVG: { iata: 'PVG', name: 'Shanghai Pudong International', city: 'Shanghai', countryCode: 'CN', flag: '🇨🇳', lat: 31.1434, lon: 121.8052, tz: 'Asia/Shanghai', utcOffsetHours: 8 },
  NRT: { iata: 'NRT', name: 'Narita International', city: 'Tokyo', countryCode: 'JP', flag: '🇯🇵', lat: 35.7647, lon: 140.3864, tz: 'Asia/Tokyo', utcOffsetHours: 9 },
  HKG: { iata: 'HKG', name: 'Hong Kong International', city: 'Hong Kong', countryCode: 'HK', flag: '🇭🇰', lat: 22.3080, lon: 113.9185, tz: 'Asia/Hong_Kong', utcOffsetHours: 8 },
  SIN: { iata: 'SIN', name: 'Singapore Changi', city: 'Singapore', countryCode: 'SG', flag: '🇸🇬', lat: 1.3502, lon: 103.9940, tz: 'Asia/Singapore', utcOffsetHours: 8 },
};

export interface ArrivalTimezoneSummary {
  headline: string;     // 例如 "No timezone change" 或 "Timezone change (+1h ahead)"
  description: string;  // 例如 "Taipei and Shanghai are in the same timezone"
  utcBadge: string;     // 例如 "UTC+8"
}

export function getArrivalTimezoneSummary(depIata: string, arrIata: string): ArrivalTimezoneSummary {
  const dep = AIRPORTS_DB[depIata];
  const arr = AIRPORTS_DB[arrIata];
  if (!dep || !arr) {
    return { headline: 'Timezone info', description: `${depIata} → ${arrIata}`, utcBadge: 'UTC' };
  }
  const diff = arr.utcOffsetHours - dep.utcOffsetHours;
  const sign = arr.utcOffsetHours >= 0 ? `+${arr.utcOffsetHours}` : `${arr.utcOffsetHours}`;
  if (diff === 0) {
    return {
      headline: 'No timezone change',
      description: `${dep.city} and ${arr.city} are in the same timezone`,
      utcBadge: `UTC${sign}`,
    };
  }
  const absDiff = Math.abs(diff);
  const dirText = diff > 0 ? 'ahead of' : 'behind';
  return {
    headline: `Timezone change (${diff > 0 ? `+${diff}h` : `${diff}h`})`,
    description: `${arr.city} is ${absDiff} hour${absDiff > 1 ? 's' : ''} ${dirText} ${dep.city}`,
    utcBadge: `UTC${sign}`,
  };
}
```

### 5.2 大圓航線 GeoJSON 生成與里程計算 (`src/flights/greatCircle.ts`)

利用球面線性插值（Slerp）計算兩座機場間的大圓弧線（Great Circle），直接輸出符合 [`@maplibre/maplibre-react-native`](https://github.com/maplibre/maplibre-react-native) 規範的 GeoJSON `Feature<LineString>`：

```typescript
// src/flights/greatCircle.ts
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const EARTH_RADIUS_MILES = 3958.8;

export function calculateFlightMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(a)));
}

export function buildGreatCircleArc(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  segments = 64
): [number, number][] {
  const phi1 = lat1 * DEG_TO_RAD;
  const lam1 = lon1 * DEG_TO_RAD;
  const phi2 = lat2 * DEG_TO_RAD;
  const lam2 = lon2 * DEG_TO_RAD;

  const d = 2 * Math.asin(
    Math.sqrt(
      Math.sin((phi1 - phi2) / 2) ** 2 +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin((lam1 - lam2) / 2) ** 2
    )
  );

  if (d < 1e-6) return [[lon1, lat1], [lon2, lat2]];

  const coords: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(phi1) * Math.cos(lam1) + B * Math.cos(phi2) * Math.cos(lam2);
    const y = A * Math.cos(phi1) * Math.sin(lam1) + B * Math.cos(phi2) * Math.sin(lam2);
    const z = A * Math.sin(phi1) + B * Math.sin(phi2);
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * RAD_TO_DEG;
    const lon = Math.atan2(y, x) * RAD_TO_DEG;
    coords.push([lon, lat]);
  }
  return coords;
}
```

### 5.3 Gemini 3.5 Flash-Lite 機票檔案自動解析 (`src/flights/geminiParser.ts`)

串接 [Google AI Studio 的 `gemini-3.5-flash-lite` 模型](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)，利用原生多模態輸入（支援 PDF 與圖片）與 [Structured Outputs (`responseSchema`)](https://ai.google.dev/gemini-api/docs/generate-content/structured-output) 擷取結構化機票資訊：

```typescript
// src/flights/geminiParser.ts
import * as FileSystem from 'expo-file-system';

export interface GeminiExtractedLeg {
  airlineCode: string;
  airlineName: string;
  alliance?: string;
  flightNumber: string;
  depIata: string;
  arrIata: string;
  depScheduledIso: string;
  arrScheduledIso: string;
  depTerminal?: string;
  arrTerminal?: string;
  depGate?: string;
  seat?: string;
  pnr?: string;
  cabinClass?: string;
}

export async function parseTicketFileWithGemini(
  fileUri: string,
  mimeType: string,
  apiKey: string
): Promise<GeminiExtractedLeg[]> {
  const base64Data = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mimeType, data: base64Data } },
            {
              text: '請從這份電子機票、行程單或登機證中擷取所有航段資料。機場請統一使用大寫 3 碼 IATA 代碼，起降時間請包含當地時區輸出為標準 ISO 8601 字串。',
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              airlineCode: { type: 'STRING' },
              airlineName: { type: 'STRING' },
              alliance: { type: 'STRING', nullable: true },
              flightNumber: { type: 'STRING' },
              depIata: { type: 'STRING' },
              arrIata: { type: 'STRING' },
              depScheduledIso: { type: 'STRING' },
              arrScheduledIso: { type: 'STRING' },
              depTerminal: { type: 'STRING', nullable: true },
              arrTerminal: { type: 'STRING', nullable: true },
              depGate: { type: 'STRING', nullable: true },
              seat: { type: 'STRING', nullable: true },
              pnr: { type: 'STRING', nullable: true },
              cabinClass: { type: 'STRING', nullable: true },
            },
            required: [
              'airlineCode',
              'airlineName',
              'flightNumber',
              'depIata',
              'arrIata',
              'depScheduledIso',
              'arrScheduledIso',
            ],
          },
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini 3.5 Flash-Lite 解析失敗 (${response.status})`);
  }

  const data = await response.json();
  const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawJson) {
    throw new Error('模型未回傳有效的機票結構化資料');
  }
  return JSON.parse(rawJson) as GeminiExtractedLeg[];
}
```

### 5.4 即時航班狀態追蹤 Port 與智慧輪詢策略 (`src/flights/flightStatusApi.ts`)

為了兼顧省電與即時性，定義 `FlightStatusProvider` Port 介面，可對接 [AeroDataBox API](https://aerodatabox.com/) 或 [FlightAware AeroAPI](https://www.flightaware.com/commercial/aeroapi/)：

* **起飛前 > 48 小時**：僅在使用者下拉重新整理或每 24 小時開啟 App 時檢查一次時刻表變動。
* **起飛前 24 ~ 48 小時（網路報到期）**：每 4 小時自動更新航廈（Terminal）與預排登機門。
* **起飛前 6 小時至降落後 1 小時**：每 15 分鐘拉取最新登機門（Gate）、準點/延誤狀態（On time / Delayed）與行李轉盤（Baggage Belt）。

### 5.5 個人飛行護照統計計算 (`src/flights/flightStats.ts`)

純函式聚合所有航班紀錄，供 Profile 頁面渲染 `FLIGHTS`、`HOURS`、`MI`、`COUNTRIES` 與數位國家印章：

```typescript
// src/flights/flightStats.ts
import type { FlightRecord } from './types';
import { AIRPORTS_DB } from './airports';

export interface PassportStatsSummary {
  totalFlights: number;
  totalHours: number;
  totalMiles: number;
  visitedCountriesCount: number;
  visitedCountryCodes: string[];
  topAirportIata?: string;
}

export function computePassportStats(flights: FlightRecord[]): PassportStatsSummary {
  let totalMinutes = 0;
  let totalMiles = 0;
  const countries = new Set<string>();
  const airportCounts: Record<string, number> = {};

  for (const f of flights) {
    totalMinutes += f.durationMinutes;
    totalMiles += f.distanceMiles;

    const depInfo = AIRPORTS_DB[f.depIata];
    const arrInfo = AIRPORTS_DB[f.arrIata];
    if (depInfo) countries.add(depInfo.countryCode);
    if (arrInfo) countries.add(arrInfo.countryCode);

    airportCounts[f.depIata] = (airportCounts[f.depIata] ?? 0) + 1;
    airportCounts[f.arrIata] = (airportCounts[f.arrIata] ?? 0) + 1;
  }

  const topAirportIata = Object.entries(airportCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

  return {
    totalFlights: flights.length,
    totalHours: Number((totalMinutes / 60).toFixed(1)),
    totalMiles: Math.round(totalMiles),
    visitedCountriesCount: countries.size,
    visitedCountryCodes: Array.from(countries),
    topAirportIata,
  };
}
```

## 6. UI/UX 設計系統與 React Native 元件實作規格 (`src/ui/`)

### 6.1 升級 `src/ui/theme.ts` 色彩與圓角 Token

在保留 [`src/ui/theme.ts`](https://github.com/waltwait/WorldTrace/blob/main/src/ui/theme.ts) 現有鍵名的基礎上，升級為 Flighty / byAir 的 OLED 純黑與機場指示牌黃色視覺系統：

```typescript
// src/ui/theme.ts
export const theme = {
  // 核心背景與卡片層級 (Flighty OLED 黑曜石風格)
  background: '#000000',
  surface: 'rgba(22, 22, 24, 0.94)',
  surfaceSolid: '#161618',
  surfaceElevated: '#1f1f23',
  border: 'rgba(255, 255, 255, 0.08)',

  // 文字階層
  text: '#f4f6ff',
  textMuted: '#a1a1aa',
  textFaint: '#71717a',

  // 品牌與狀態色彩
  accent: '#6366f1',          // Active 膠囊、FAB 與底部導覽高亮藍紫
  accentSoft: '#252849',      // 底部導覽選中膠囊底色與 SCHEDULED 標籤底色
  live: '#22c55e',            // 航班準點綠 (08:45 AM / On time)
  warn: '#f59e0b',            // 延誤提醒橘黃
  danger: '#ef4444',          // 取消或異常紅

  // 標誌性機場指示牌徽章 (Airport Signage Yellow)
  airportSignBg: '#facc15',
  airportSignText: '#09090b',

  // Profile 飛行護照漸層色陣列 (搭配 expo-linear-gradient 或 SVG)
  passportGradient: ['#2b2768', '#3d3899', '#4845b8'] as const,

  // 地圖迷霧與航線色彩
  fog: '#070b16',
  fogOpacity: 0.86,
  trackLine: '#4ade80',       // 地面真實 GPS 軌跡線
  flightArcOuter: '#172554',  // 空中大圓航線外框陰影
  flightArcInner: '#3b82f6',  // 空中大圓航線主色
  docsBadgePurple: '#a855f7', // Travel Docs 數量紫色圓章

  // 成就獎牌色 (保留現有定義)
  bronze: '#c9814f',
  silver: '#bcc6da',
  gold: '#e8c25a',
  tierLocked: 'rgba(255, 255, 255, 0.13)',
};

export const radius = {
  sheet: 32,
  panel: 24,
  card: 20,
  sign: 7,
  pill: 999,
};
```

### 6.2 四大核心 UI 元件設計規格

#### 1. `src/ui/FlightsScreen.tsx`（Tab 0 首頁：`Trips` 旅途列表）
* **頂部標題與操作列**：左側 `28pt` 粗體 `Trips`，右側配置「排序切換」與「手動新增」圖示按鈕。
* **Active / Finished 雙膠囊切換**：套用現有的 [`PressScale.tsx`](https://github.com/waltwait/WorldTrace/blob/main/src/ui/PressScale.tsx)，選中態為 `#6366f1` 實心藍紫膠囊並顯示即時數量（如 `Active 1`）。
* **航班卡片（Flight Card）**：
  * 卡片頂部：左側顯示航空公司圖示與航班號（如 `🌸 CI501`），右側顯示狀態標籤（`SCHEDULED` / `BOARDING` / `DELAYED`）。
  * 卡片中段：左欄顯示起飛 IATA（`28pt` 粗體 `TPE`）、城市名（`Taipei`）與 `#22c55e` 準點綠時間（`08:45 AM`）；中央顯示起飛圖示與大字體倒數（如 `56d`，套用 [`RollingNumber.tsx`](https://github.com/waltwait/WorldTrace/blob/main/src/ui/RollingNumber.tsx)）；右欄顯示抵達資訊（`PVG` / `Shanghai` / `10:50 AM`）。
  * 卡片下方懸浮快捷膠囊：提供「通知開關（🔔/🔕）」、「原生分享（[`expo-sharing`](https://docs.expo.dev/versions/latest/sdk/sharing/)）」與「更多操作（`•••` 切換完成狀態或刪除）」。
* **右下角懸浮按鈕（FAB）**：`56x56` 圓角矩形（`radius: 20`）藍紫 `+` 按鈕，點擊開啟 `AddFlightSheet`。

#### 2. `src/ui/FlightDetailSheet.tsx`（航班追蹤詳情抽屜）
* **上半部互動航線圖**：渲染起降機場間的 Great Circle 弧線與深藍底白字的 `TPE` / `PVG` 機場標籤；左上角疊加 `CI501`、`Taipei → Shanghai` 與日期；右上角提供「🌫️ 疊加地面迷霧」、「展開全螢幕地圖」與「分享」按鈕。
* **下半部黑曜石圓角抽屜（`borderTopLeftRadius: 32`）**：
  * **倒數狀態卡**：獨立顯示 `Scheduled` 與 `in 56d`（或 `Boarding Now`）。
  * **起降時間與黃色機場指示牌卡**：
    * 顯示國旗與 IATA 代碼（`🇹🇼 TPE`、`🇨🇳 PVG`）及 `28pt` 等寬綠色起降時間。
    * **黃色機場指示牌徽章（`#facc15` 底、`#09090b` 黑字）**：以 `↗ D6` 呈現起飛登機門、`↘ 18` 呈現抵達登機門、`🧳 7` 呈現行李轉盤（尚未公佈時顯示 `—`，點擊可直接手動編輯更新）。
    * 中央分隔線顯示航程與里程（`2h 5m · 420 mi`）。
  * **Details 資訊組**：
    * 航空公司與聯盟列（`China Airlines · SkyTeam`）。
    * **訂位代號（PNR）列**：右側內建「全螢幕放大檢視（方便報到時出示給地勤）」與「一鍵複製訂位代號」按鈕。
    * **座位（Seat）** 與 **個人備註（Notes）**：點擊即可於彈窗內編輯並即時寫回 SQLite。
    * **Travel Docs 列**：右側顯示 `#a855f7` 紫色圓形數量徽章（如 `1`），點擊可直接預覽上傳的電子機票 PDF 或登機證圖片。
  * **On Arrival 抵達時區卡**：自動呼叫 `getArrivalTimezoneSummary(depIata, arrIata)`，顯示如 `No timezone change · Taipei and Shanghai are in the same timezone [UTC+8]`。

#### 3. `src/ui/ProfileScreen.tsx`（Tab 2：`Profile` 個人護照與探索/時間軸/備份整合中心）
* **移除所有 Pro 付費橫幅**：完全不顯示任何商業推銷卡片，維持乾淨俐落的個人成就空間。
* **上半部藍紫漸層護照卡（Flight Passport）**：
  * 顯示使用者頭像與自訂暱稱。
  * 藍紫漸層卡片內以大字體展示四大指標：`FLIGHTS`（總趟數）、`HOURS`（總飛行時數）、`MI`（總飛行英里）、`COUNTRIES`（造訪國家數）。
  * 卡片底部配置 `Flight stats ›`（展開最常搭乘航空、主場機場、最遠航段明細）與右側白色「護照印章按鈕」（展開已解鎖的國家數位印章）。
* **下半部三合一分段切換（`Explore` / `Timeline` / `Backup`）**：
  * **Explore（探索與機場看板）**：呈現造訪機場黃牌看板（`#facc15` IATA 徽章與趟數）＋ 原有的地面迷霧探索面積、里程碑進度條、國家／城市排行與成就徽章。
  * **Timeline（時間軸）**：整合原有的單日地面 GPS 軌跡回顧（點擊單日自動切換至 `Tab 1 Map` 並高亮當日路線）。
  * **Backup（備份與匯出）**：整合原有的 Google 雲端硬碟備份／還原、重畫歷史迷霧與 GPX／完整備份匯出。

### 6.3 在 `src/ui/MapScreen.tsx` 疊加航線圖層

在 [`src/ui/MapScreen.tsx`](https://github.com/waltwait/WorldTrace/blob/main/src/ui/MapScreen.tsx) 的 `<MapView>` 內，於現有的 `fog` 與 `day-track` 圖層上方加入 `flight-arcs` 圖層：

```tsx
// src/ui/MapScreen.tsx 內部圖層擴充片段
{flightArcsGeoJson && showFlightsLayer && (
  <GeoJSONSource id="flight-arcs" data={flightArcsGeoJson} maxzoom={18}>
    <Layer
      id="flight-arcs-casing"
      type="line"
      layout={{ 'line-cap': 'round', 'line-join': 'round' }}
      paint={{
        'line-color': theme.flightArcOuter,
        'line-width': 6,
        'line-opacity': 0.65,
      }}
    />
    <Layer
      id="flight-arcs-main"
      type="line"
      layout={{ 'line-cap': 'round', 'line-join': 'round' }}
      paint={{
        'line-color': theme.flightArcInner,
        'line-width': 3.5,
        'line-opacity': 0.95,
      }}
    />
  </GeoJSONSource>
)}
```

## 7. 分階段開發與測試驗收計畫 (Implementation Checklist)

1. **階段一：資料表升級與核心純函式（Day 1）**
   * 更新 `src/store/schema.ts` 至 `SCHEMA_VERSION = 3`，實作 `src/store/flights.ts`。
   * 實作 `src/flights/airports.ts`、`src/flights/greatCircle.ts` 與 `src/flights/flightStats.ts`。
   * 執行 `npm test`（Vitest + `node:sqlite`），確保資料庫新增、篩選、時差計算與大圓距離單元測試 100% 通過。
2. **階段二：Gemini 3.5 Flash-Lite 機票解析與新增彈窗（Day 2）**
   * 安裝 `expo-document-picker` 與 `expo-image-picker`。
   * 實作 `src/flights/geminiParser.ts` 與 `src/ui/AddFlightSheet.tsx`，完成「選取機票檔案 → Gemini 結構化解析預覽 → 儲存至 `flights` 與 `flight_docs`」閉環。
3. **階段三：Flighty 風格 UI 與雙層地圖整合（Day 3–4）**
   * 更新 `src/ui/theme.ts`。
   * 實作 `src/ui/FlightsScreen.tsx`、`src/ui/FlightDetailSheet.tsx`（含 `#facc15` 機場黃牌與 PNR 放大複製），並將 `src/ui/StatsScreen.tsx` 升級為整合飛行護照與地面探索的純淨版 Profile（不含 Pro 橫幅）。
   * 在 `src/ui/MapScreen.tsx` 加入 `flight-arcs` 圖層與「雙層 / 僅迷霧 / 僅航線」切換開關。
4. **階段四：航班即時狀態同步與本地通知（Day 5）**
   * 實作 `src/flights/flightStatusApi.ts` 分級輪詢機制，當登機門或準點狀態變更時自動更新 SQLite 並觸發通知。
