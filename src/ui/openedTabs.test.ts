import { describe, expect, test } from 'vitest';
import { openTab } from './openedTabs';

describe('openTab', () => {
  test('adds a tab that was not open', () => {
    expect([...openTab(new Set([0]), 2)].sort()).toEqual([0, 2]);
  });

  test('hands back the very same set for a tab already open, so nothing re-renders', () => {
    const opened = new Set([0, 2]);

    expect(openTab(opened, 2)).toBe(opened);
  });

  test('leaves the set it was given alone', () => {
    const opened = new Set([0]);
    openTab(opened, 3);

    expect([...opened]).toEqual([0]);
  });

  test('never closes anything: a tab once opened stays', () => {
    let opened: ReadonlySet<number> = new Set([0]);
    for (const tab of [1, 2, 3, 1, 0, 2]) opened = openTab(opened, tab);

    expect([...opened].sort()).toEqual([0, 1, 2, 3]);
  });
});
