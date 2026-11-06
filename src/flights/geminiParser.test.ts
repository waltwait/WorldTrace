import { describe, expect, test, vi } from 'vitest';
import {
  legToFlightRecord,
  parseItineraryTextOffline,
  parseTicketWithGemini,
  type GeminiExtractedLeg,
} from './geminiParser';

describe('geminiParser', () => {
  const sampleLeg: GeminiExtractedLeg = {
    airlineCode: 'CI',
    airlineName: 'China Airlines',
    alliance: 'SkyTeam',
    flightNumber: 'CI501',
    depIata: 'TPE',
    arrIata: 'PVG',
    depScheduledIso: '2026-12-31T08:45:00+08:00',
    arrScheduledIso: '2026-12-31T10:50:00+08:00',
    depTerminal: '2',
    arrTerminal: '1',
    depGate: 'D6',
    seat: '24A',
    pnr: '7X9K2M',
    cabinClass: 'Economy',
  };

  describe('legToFlightRecord', () => {
    test('converts extracted leg into full FlightRecord with calculated distance and timezone', () => {
      const flight = legToFlightRecord(sampleLeg);

      expect(flight.flightNumber).toBe('CI501');
      expect(flight.depIata).toBe('TPE');
      expect(flight.arrIata).toBe('PVG');
      expect(flight.depTz).toBe('Asia/Taipei');
      expect(flight.arrTz).toBe('Asia/Shanghai');
      expect(flight.distanceMiles).toBeGreaterThan(400);
      expect(flight.durationMinutes).toBe(125);
      expect(flight.seat).toBe('24A');
      expect(flight.pnr).toBe('7X9K2M');
      expect(flight.isFinished).toBe(false);
      expect(flight.notificationsEnabled).toBe(true);
    });
  });

  describe('parseTicketWithGemini', () => {
    test('calls gemini-3.5-flash-lite endpoint and parses structured output', async () => {
      const mockFetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify([sampleLeg]),
                  },
                ],
              },
            },
          ],
        }),
      })) as unknown as typeof fetch;

      const legs = await parseTicketWithGemini(
        { text: 'E-ticket: CI501 TPE to PVG on 2026-12-31 seat 24A PNR 7X9K2M' },
        'test-gemini-key',
        mockFetch,
      );

      expect(mockFetch).toHaveBeenCalled();
      expect(legs).toHaveLength(1);
      expect(legs[0].flightNumber).toBe('CI501');
      expect(legs[0].depIata).toBe('TPE');
      expect(legs[0].arrIata).toBe('PVG');
    });

    test('throws descriptive error on API failure', async () => {
      const mockFetch = vi.fn(async () => ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: { message: 'Invalid API Key' } }),
      })) as unknown as typeof fetch;

      await expect(
        parseTicketWithGemini({ text: 'Some text' }, 'bad-key', mockFetch),
      ).rejects.toThrow('Gemini 3.5 Flash-Lite 解析失敗 (401)');
    });
  });

  describe('parseItineraryTextOffline', () => {
    test('extracts flight number and IATA route from plain text pattern', () => {
      const text = '搭乘 中華航空 CI501 台北 (TPE) 到 上海 (PVG) 2026-12-31 座位 24A 訂位代號 7X9K2M';
      const legs = parseItineraryTextOffline(text);

      expect(legs).toHaveLength(1);
      expect(legs[0].flightNumber).toBe('CI501');
      expect(legs[0].depIata).toBe('TPE');
      expect(legs[0].arrIata).toBe('PVG');
      expect(legs[0].seat).toBe('24A');
      expect(legs[0].pnr).toBe('7X9K2M');
    });

    test('returns empty array when no flight pattern is found', () => {
      expect(parseItineraryTextOffline('今天天氣很好去散步')).toEqual([]);
    });
  });
});
