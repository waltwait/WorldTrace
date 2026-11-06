import { describe, expect, test, vi } from 'vitest';
import {
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

    test('reads airport codes only as whole words', () => {
      // SEAT is not Seattle, and TAIPEI holds no airport code.
      const [leg] = parseItineraryTextOffline('BR198 SEAT 24A TAIPEI TPE NRT');
      expect([leg.depIata, leg.arrIata]).toEqual(['TPE', 'NRT']);
    });

    test('leaves the route empty when the text names no airport, rather than assuming TPE→PVG', () => {
      const [leg] = parseItineraryTextOffline('BR198 2026-12-31');
      expect([leg.depIata, leg.arrIata]).toEqual(['', '']);
    });

    test('names no airline it was not told', () => {
      const [leg] = parseItineraryTextOffline('BR198 TPE NRT');
      expect(leg.airlineName).toBe('');
    });

    test('takes a booking code only where the text labels one', () => {
      expect(parseItineraryTextOffline('Flight BR198 TPE NRT')[0].pnr).toBeNull();
      expect(parseItineraryTextOffline('BR198 TPE NRT PNR: 8YK2MP')[0].pnr).toBe('8YK2MP');
    });

    test('takes a seat only where the text labels one', () => {
      expect(parseItineraryTextOffline('BR198 TPE NRT 第 2 航廈 1A 門')[0].seat).toBeNull();
      expect(parseItineraryTextOffline('BR198 TPE NRT Seat 10K')[0].seat).toBe('10K');
    });

    test('gives only the date and times the text contains', () => {
      const none = parseItineraryTextOffline('BR198 TPE NRT')[0];
      expect([none.depScheduledIso, none.arrScheduledIso]).toEqual(['', '']);

      const dateOnly = parseItineraryTextOffline('BR198 TPE NRT 2026/12/1')[0];
      expect([dateOnly.depScheduledIso, dateOnly.arrScheduledIso]).toEqual(['2026-12-01', '']);

      const both = parseItineraryTextOffline('BR198 2026-12-01 07:30 TPE → 11:45 NRT')[0];
      expect([both.depScheduledIso, both.arrScheduledIso]).toEqual([
        '2026-12-01T07:30',
        '2026-12-01T11:45',
      ]);
    });

    test('gives a cabin only when the text names one', () => {
      expect(parseItineraryTextOffline('BR198 TPE NRT')[0].cabinClass).toBeNull();
      expect(parseItineraryTextOffline('BR198 TPE NRT 商務艙')[0].cabinClass).toBe('Business');
      expect(parseItineraryTextOffline('BR198 TPE NRT Premium Economy')[0].cabinClass).toBe(
        'Premium Economy',
      );
    });
  });
});
