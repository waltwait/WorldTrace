/**
 * Gemini 3.5 Flash-Lite multimodal ticket/boarding-pass parser and offline fallback.
 */

import { findAirport } from './airports';
import { calculateFlightMiles } from './greatCircle';
import type { CabinClass, FlightRecord } from './types';

export interface GeminiExtractedLeg {
  airlineCode: string;
  airlineName: string;
  alliance?: string | null;
  flightNumber: string;
  depIata: string;
  arrIata: string;
  depScheduledIso: string;
  arrScheduledIso: string;
  depTerminal?: string | null;
  arrTerminal?: string | null;
  depGate?: string | null;
  seat?: string | null;
  pnr?: string | null;
  cabinClass?: string | null;
}

export function legToFlightRecord(leg: GeminiExtractedLeg): FlightRecord {
  const depUpper = leg.depIata.trim().toUpperCase();
  const arrUpper = leg.arrIata.trim().toUpperCase();

  const depAirport = findAirport(depUpper);
  const arrAirport = findAirport(arrUpper);

  const depTz = depAirport?.tz ?? 'Asia/Taipei';
  const arrTz = arrAirport?.tz ?? 'Asia/Shanghai';

  let depScheduledUtc = Date.parse(leg.depScheduledIso);
  let arrScheduledUtc = Date.parse(leg.arrScheduledIso);

  if (Number.isNaN(depScheduledUtc)) {
    depScheduledUtc = Date.now() + 24 * 3600 * 1000;
  }
  if (Number.isNaN(arrScheduledUtc) || arrScheduledUtc <= depScheduledUtc) {
    arrScheduledUtc = depScheduledUtc + 2 * 3600 * 1000;
  }

  const durationMinutes = Math.max(1, Math.round((arrScheduledUtc - depScheduledUtc) / 60000));

  let distanceMiles = 500;
  if (depAirport && arrAirport) {
    distanceMiles = calculateFlightMiles(
      { lat: depAirport.lat, lon: depAirport.lon },
      { lat: arrAirport.lat, lon: arrAirport.lon },
    );
  }

  const cleanNum = leg.flightNumber.trim().toUpperCase();
  const airlineCode = leg.airlineCode.trim().toUpperCase() || cleanNum.slice(0, 2);

  return {
    id: `fl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    flightNumber: cleanNum,
    airlineCode,
    airlineName: leg.airlineName.trim() || airlineCode,
    alliance: (leg.alliance as FlightRecord['alliance']) ?? null,
    depIata: depUpper,
    arrIata: arrUpper,
    depScheduledUtc,
    depEstimatedUtc: null,
    arrScheduledUtc,
    arrEstimatedUtc: null,
    depTz,
    arrTz,
    depTerminal: leg.depTerminal ?? null,
    arrTerminal: leg.arrTerminal ?? null,
    depGate: leg.depGate ?? null,
    arrGate: null,
    baggageBelt: null,
    status: 'SCHEDULED',
    distanceMiles,
    durationMinutes,
    seat: leg.seat ?? null,
    cabinClass: (leg.cabinClass as CabinClass) ?? 'Economy',
    pnr: leg.pnr ?? null,
    notes: null,
    notificationsEnabled: true,
    isFinished: false,
    lastSyncedAt: Date.now(),
    createdAt: Date.now(),
  };
}

export interface ParseTicketInput {
  base64Data?: string;
  mimeType?: string;
  text?: string;
}

/**
 * Calls Gemini 3.5 Flash-Lite with structured output responseSchema to extract flight legs.
 */
export async function parseTicketWithGemini(
  input: ParseTicketInput,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<GeminiExtractedLeg[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`;

  const parts: Array<Record<string, unknown>> = [];

  if (input.base64Data && input.mimeType) {
    parts.push({
      inline_data: {
        mime_type: input.mimeType,
        data: input.base64Data,
      },
    });
  }

  const promptText = input.text
    ? `請從以下機票、行程單、登機證文字或圖片中擷取所有航段資料：\n${input.text}`
    : '請從這份電子機票、行程單或登機證檔案中擷取所有航段資料。機場請統一使用大寫 3 碼 IATA 代碼，起降時間請輸出為標準 ISO 8601 字串（包含當地時區偏移量）。';

  parts.push({ text: promptText });

  const response = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
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

  try {
    return JSON.parse(rawJson) as GeminiExtractedLeg[];
  } catch {
    throw new Error('無法解析模型回傳之 JSON 資料');
  }
}

/**
 * Offline regex-based itinerary parser for quick plain-text paste.
 */
export function parseItineraryTextOffline(text: string): GeminiExtractedLeg[] {
  if (!text || text.trim().length === 0) return [];

  // Match flight number (e.g. CI501, BR198, JX800, DL123)
  const flightMatch = text.match(/\b([A-Z0-9]{2})\s*([0-9]{3,4})\b/i);
  if (!flightMatch) return [];

  const airlineCode = flightMatch[1].toUpperCase();
  const flightNumber = `${airlineCode}${flightMatch[2]}`;

  // Find 3-letter IATAs that exist in our database
  const words = text.match(/[A-Z]{3}/g) ?? [];
  const validIatas = words.filter((w) => Boolean(findAirport(w)));

  let depIata = 'TPE';
  let arrIata = 'PVG';

  if (validIatas.length >= 2) {
    depIata = validIatas[0];
    arrIata = validIatas[1];
  } else if (validIatas.length === 1) {
    if (validIatas[0] !== 'TPE') {
      arrIata = validIatas[0];
    }
  }

  // Find date e.g. 2026-12-31 or 2026/12/31
  const dateMatch = text.match(/\b(\d{4}[-/]\d{1,2}[-/]\d{1,2})\b/);
  const dateStr = dateMatch ? dateMatch[1].replace(/\//g, '-') : '2026-12-31';

  // Find seat e.g. 24A, 10K
  const seatMatch = text.match(/(?:座位|seat)\s*([0-9]{1,2}[A-K])\b/i) ?? text.match(/\b([0-9]{1,2}[A-K])\b/i);
  const seat = seatMatch ? seatMatch[1].toUpperCase() : null;

  // Find PNR e.g. 7X9K2M (6 alphanumeric)
  const pnrMatch = text.match(/(?:pnr|訂位代號)\s*([A-Z0-9]{6})\b/i) ?? text.match(/\b([A-Z0-9]{6})\b/i);
  const pnr = pnrMatch ? pnrMatch[1].toUpperCase() : null;

  const depAirport = findAirport(depIata);
  const arrAirport = findAirport(arrIata);

  return [
    {
      airlineCode,
      airlineName: depAirport?.countryCode === 'TW' ? '中華航空' : airlineCode,
      flightNumber,
      depIata,
      arrIata,
      depScheduledIso: `${dateStr}T09:00:00+08:00`,
      arrScheduledIso: `${dateStr}T11:30:00+08:00`,
      seat,
      pnr,
      cabinClass: 'Economy',
    },
  ];
}
