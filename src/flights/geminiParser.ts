/**
 * Gemini 3.5 Flash-Lite multimodal ticket/boarding-pass parser and offline fallback.
 */

import { findAirport } from './airports';

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
 * Offline parser for pasted itinerary text, used when there is no Gemini key.
 *
 * It returns only what the text actually contains and leaves the rest empty
 * for the form to ask about. It used to fill the gaps: TPE→PVG when it found
 * no airport, 「中華航空」 for any flight out of Taiwan, 2026-12-31 09:00–11:30
 * for any flight without a date, and the first six-letter word as the booking
 * code ("FLIGHT", "TAIPEI"). Each of those became a saved flight and a stamp in
 * the passport.
 */
export function parseItineraryTextOffline(text: string): GeminiExtractedLeg[] {
  if (!text || text.trim().length === 0) return [];

  // Flight number, e.g. CI501, BR 198, JX800
  const flightMatch = text.match(/\b([A-Z0-9]{2})\s*([0-9]{3,4})\b/i);
  if (!flightMatch) return [];

  const airlineCode = flightMatch[1].toUpperCase();
  const flightNumber = `${airlineCode}${flightMatch[2]}`;

  // Whole-word codes the airport table knows, in the order the text gives
  // them. Whole words: "SEAT" is not Seattle.
  const iatas = (text.match(/\b[A-Z]{3}\b/g) ?? []).filter((w) => Boolean(findAirport(w)));
  const depIata = iatas[0] ?? '';
  const arrIata = iatas[1] ?? '';

  const dateMatch = text.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  const date = dateMatch
    ? `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`
    : '';

  // Times as written, local to their airports: the first is the departure,
  // the second the arrival. Only meaningful with a date.
  const times = [...text.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)].map(
    (m) => `${m[1].padStart(2, '0')}:${m[2]}`,
  );
  const at = (time: string | undefined) => (date && time ? `${date}T${time}` : date);
  const depScheduledIso = at(times[0]);
  const arrScheduledIso = times[1] ? at(times[1]) : '';

  const seatMatch = text.match(/(?:座位|座號|seat)\s*[:：]?\s*([0-9]{1,2}[A-K])\b/i);
  const seat = seatMatch ? seatMatch[1].toUpperCase() : null;

  const pnrMatch = text.match(
    /(?:pnr|訂位代號|訂位代碼|電腦代號|booking\s*(?:ref(?:erence)?|code)|confirmation(?:\s*(?:no\.?|number|code))?)\s*[:：#]?\s*([A-Z0-9]{6})\b/i,
  );
  const pnr = pnrMatch ? pnrMatch[1].toUpperCase() : null;

  return [
    {
      airlineCode,
      airlineName: '',
      flightNumber,
      depIata,
      arrIata,
      depScheduledIso,
      arrScheduledIso,
      seat,
      pnr,
      cabinClass: cabinFromText(text),
    },
  ];
}

function cabinFromText(text: string): string | null {
  // Premium economy first: it also says "economy".
  if (/premium\s*economy|豪華經濟艙|特選經濟艙/i.test(text)) return 'Premium Economy';
  if (/business|商務艙/i.test(text)) return 'Business';
  if (/first\s*class|頭等艙/i.test(text)) return 'First';
  if (/economy|經濟艙/i.test(text)) return 'Economy';
  return null;
}
