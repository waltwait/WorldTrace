import { describe, expect, test } from 'vitest';
import { linkHost, linkLabel, linksOfTrip, readLink } from './tripLinks';
import type { FlightLinkRecord, FlightRecord } from './types';

describe('readLink', () => {
  test('takes a web address as it is', () => {
    expect(readLink('https://www.example.com/plan', '')).toEqual({
      ok: true,
      url: 'https://www.example.com/plan',
      title: null,
    });
  });

  test('trims what was pasted around it', () => {
    expect(readLink('  http://example.com/a  ', '')).toMatchObject({ url: 'http://example.com/a' });
  });

  test('gives an address without a scheme https', () => {
    expect(readLink('example.com/trip?id=7', '')).toMatchObject({ url: 'https://example.com/trip?id=7' });
    expect(readLink('maps.example.co.jp', '')).toMatchObject({ url: 'https://maps.example.co.jp' });
  });

  test('keeps the name it was given, trimmed', () => {
    expect(readLink('https://example.com', '  京都住宿 ')).toMatchObject({ title: '京都住宿' });
  });

  // Opened with a tap: anything but the web could start an app or run a script.
  test.each(['javascript:alert(1)', 'intent://scan/#Intent;scheme=zxing;end', 'file:///sdcard/a.pdf', 'mailto:a@example.com'])(
    'refuses %s',
    (input) => {
      expect(readLink(input, '')).toEqual({ ok: false, error: '只能加網頁連結' });
    },
  );

  test.each(['', '   ', 'not a link', 'https://', 'example'])('refuses %j as no address', (input) => {
    expect(readLink(input, '')).toEqual({ ok: false, error: '網址不對' });
  });
});

describe('linkHost', () => {
  test('is the site, without www', () => {
    expect(linkHost('https://www.Example.com/plan?x=1')).toBe('example.com');
  });

  test('is the host a login in front of it would hide', () => {
    expect(linkHost('https://trusted.example@other.example/x')).toBe('other.example');
  });

  test('leaves the port out', () => {
    expect(linkHost('http://example.com:8080/a')).toBe('example.com');
  });
});

const link = (id: string, flightId: string, createdAt: number, title: string | null = null): FlightLinkRecord => ({
  id,
  flightId,
  url: `https://example.com/${id}`,
  title,
  createdAt,
});

test('linkLabel is its name, or else its site', () => {
  expect(linkLabel(link('a', 'f', 0, '行程表'))).toBe('行程表');
  expect(linkLabel(link('a', 'f', 0))).toBe('example.com');
});

test('linksOfTrip are those on any of its flights, oldest first', () => {
  const trip = { flights: [{ id: 'f1' }, { id: 'f2' }] as FlightRecord[] };
  const links = [link('c', 'f2', 3), link('x', 'other', 1), link('a', 'f1', 2)];

  expect(linksOfTrip(links, trip).map((l) => l.id)).toEqual(['a', 'c']);
});
