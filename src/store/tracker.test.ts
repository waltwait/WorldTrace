import { beforeEach, describe, expect, test } from 'vitest';
import { getBit } from '../fog/bitmap';
import { locationToBit } from '../fog/tiles';
import type { Fix } from '../gatekeeper/gatekeeper';
import type { SqlDriver } from './driver';
import { migrate } from './schema';
import { createNodeDriver } from './testing/nodeDriver';
import { createTracker } from './tracker';

const BASE_TIME = Date.UTC(2026, 7, 2, 9, 0, 0);
const ORIGIN = { lat: 25.033, lon: 121.5654 };
const CLEAN_DEVICE = { mockAppEnabled: false };

let driver: SqlDriver;

beforeEach(async () => {
  driver = createNodeDriver(':memory:');
  await migrate(driver);
});

function fix(seconds: number, eastMeters = 0, overrides: Partial<Fix> = {}): Fix {
  return {
    lat: ORIGIN.lat,
    lon: ORIGIN.lon + eastMeters / (111320 * Math.cos((ORIGIN.lat * Math.PI) / 180)),
    accuracy: 8,
    timestamp: BASE_TIME + seconds * 1000,
    mocked: false,
    ...overrides,
  };
}

function at(eastMeters: number) {
  return {
    lat: ORIGIN.lat,
    lon: ORIGIN.lon + eastMeters / (111320 * Math.cos((ORIGIN.lat * Math.PI) / 180)),
  };
}

/** Read the persisted fog straight from the database. */
async function fogClearedAt(point: { lat: number; lon: number }): Promise<boolean> {
  const bit = locationToBit(point.lat, point.lon);
  const row = await driver.get<{ bitmap: Uint8Array }>(
    'SELECT bitmap FROM fog_tiles WHERE z = 16 AND x = ? AND y = ?',
    [bit.x, bit.y],
  );
  return row ? getBit(row.bitmap, bit.bx, bit.by) : false;
}

async function countOf(table: string): Promise<number> {
  const row = await driver.get<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`);
  return row?.count ?? 0;
}

describe('recording an accepted fix', () => {
  test('stores the point', async () => {
    const tracker = createTracker({ driver });

    await tracker.record(fix(0), CLEAN_DEVICE);

    const row = await driver.get<{ lat: number; accuracy: number }>('SELECT * FROM points');
    expect(row?.lat).toBeCloseTo(ORIGIN.lat, 6);
    expect(row?.accuracy).toBe(8);
  });

  test('opens a segment and reports its id', async () => {
    const tracker = createTracker({ driver });

    const result = await tracker.record(fix(0), CLEAN_DEVICE);

    expect(result).toMatchObject({ accepted: true });
    expect(await countOf('segments')).toBe(1);
    if (result.accepted) expect(result.segmentId).toBeGreaterThan(0);
  });

  test('clears the fog where the fix landed', async () => {
    const tracker = createTracker({ driver });

    await tracker.record(fix(0), CLEAN_DEVICE);

    expect(await fogClearedAt(ORIGIN)).toBe(true);
  });

  test('reports how much new ground it uncovered', async () => {
    const tracker = createTracker({ driver });

    const result = await tracker.record(fix(0), CLEAN_DEVICE);

    if (!result.accepted) throw new Error('expected the fix to be accepted');
    expect(result.newlyExploredCells).toBeGreaterThan(0);
  });

  test('uncovers nothing new when standing still', async () => {
    const tracker = createTracker({ driver });
    await tracker.record(fix(0), CLEAN_DEVICE);

    const result = await tracker.record(fix(10), CLEAN_DEVICE);

    if (!result.accepted) throw new Error('expected the fix to be accepted');
    expect(result.newlyExploredCells).toBe(0);
  });
});

describe('recording a rejected fix', () => {
  test('stores a rejection carrying the reason', async () => {
    const tracker = createTracker({ driver });

    await tracker.record(fix(0, 0, { mocked: true }), CLEAN_DEVICE);

    const row = await driver.get<{ reason: string; accuracy: number }>(
      'SELECT * FROM rejections',
    );
    expect(row?.reason).toBe('MOCK_PROVIDER');
    expect(row?.accuracy).toBe(8);
  });

  test('stores no point and opens no segment', async () => {
    const tracker = createTracker({ driver });

    await tracker.record(fix(0, 0, { mocked: true }), CLEAN_DEVICE);

    expect(await countOf('points')).toBe(0);
    expect(await countOf('segments')).toBe(0);
  });

  test('leaves the fog untouched', async () => {
    const tracker = createTracker({ driver });

    await tracker.record(fix(0, 0, { mocked: true }), CLEAN_DEVICE);

    expect(await countOf('fog_tiles')).toBe(0);
    expect(await fogClearedAt(ORIGIN)).toBe(false);
  });

  test('does not let a rejected fix break the following real one', async () => {
    const tracker = createTracker({ driver });
    await tracker.record(fix(0), CLEAN_DEVICE);

    await tracker.record(fix(10, 500_000), CLEAN_DEVICE); // teleport, rejected
    const result = await tracker.record(fix(20, 20), CLEAN_DEVICE);

    expect(result).toMatchObject({ accepted: true });
    expect(await fogClearedAt(at(20))).toBe(true);
  });
});

describe('joining consecutive fixes', () => {
  test('clears the corridor walked between them', async () => {
    const tracker = createTracker({ driver });

    await tracker.record(fix(0), CLEAN_DEVICE);
    await tracker.record(fix(60, 100), CLEAN_DEVICE);

    expect(await fogClearedAt(at(50))).toBe(true);
  });

  test('joins a cycling gap the platform failed to report', async () => {
    // Straight from a real ride: six minutes of silence covering 1,445 m, which
    // is 14 km/h — an ordinary bicycle. The old fixed 500 m limit refused it and
    // left a hole across half the outing.
    const tracker = createTracker({ driver });

    await tracker.record(fix(0), CLEAN_DEVICE);
    await tracker.record(fix(361, 1445), CLEAN_DEVICE);

    expect(await fogClearedAt(at(700))).toBe(true);
  });

  test('joins a drive', async () => {
    // 25 km in twelve minutes: 125 km/h.
    const tracker = createTracker({ driver });

    await tracker.record(fix(0), CLEAN_DEVICE);
    await tracker.record(fix(12 * 60, 25_000), CLEAN_DEVICE);

    expect(await fogClearedAt(at(12_000))).toBe(true);
  });

  test('joins a plane that kept reporting', async () => {
    // 15 km in a minute is 900 km/h — an airliner with a working GPS.
    const tracker = createTracker({ driver });

    await tracker.record(fix(0), CLEAN_DEVICE);
    await tracker.record(fix(60, 15_000), CLEAN_DEVICE);

    expect(await fogClearedAt(at(7_000))).toBe(true);
  });

  test('paints nothing for a jump no vehicle could have made', async () => {
    // 400 km in a minute. The gatekeeper refuses it as a teleport before the
    // tracker ever sees it, so there is no point and no fog — the speed guard
    // for painting lives there, not here.
    const tracker = createTracker({ driver });

    await tracker.record(fix(0), CLEAN_DEVICE);
    const verdict = await tracker.record(fix(60, 400_000), CLEAN_DEVICE);

    expect(verdict).toEqual({ accepted: false, reason: 'TELEPORT' });
    expect(await fogClearedAt(at(200_000))).toBe(false);
  });

  test('refuses to guess across a long silence, however short the distance', async () => {
    // An hour unaccounted for. Where you were in between is unknown even if you
    // ended up nearby, and the route is not ours to invent.
    const tracker = createTracker({ driver });

    await tracker.record(fix(0), CLEAN_DEVICE);
    await tracker.record(fix(60 * 60, 400), CLEAN_DEVICE);

    expect(await fogClearedAt(ORIGIN)).toBe(true);
    expect(await fogClearedAt(at(400))).toBe(true);
    expect(await fogClearedAt(at(200))).toBe(false);
  });

  test('refuses a single leg long enough to swamp the fog store', async () => {
    // 600 km in 29 minutes: fast, but under the teleport threshold, so the fix
    // itself is genuine and kept. Painting the line would mean loading and
    // rewriting a thousand tiles inside the background task, so the corridor is
    // where the line is drawn — not the point.
    const tracker = createTracker({ driver });

    await tracker.record(fix(0), CLEAN_DEVICE);
    const verdict = await tracker.record(fix(29 * 60, 600_000), CLEAN_DEVICE);

    expect(verdict).toMatchObject({ accepted: true });
    expect(await fogClearedAt(at(300_000))).toBe(false);
  });
});

describe('segments', () => {
  test('keeps nearby fixes in one segment', async () => {
    const tracker = createTracker({ driver });

    await tracker.record(fix(0), CLEAN_DEVICE);
    await tracker.record(fix(30, 40), CLEAN_DEVICE);

    expect(await countOf('segments')).toBe(1);
    const points = await driver.all<{ segment_id: number }>('SELECT segment_id FROM points');
    expect(new Set(points.map((p) => p.segment_id)).size).toBe(1);
  });

  test('keeps a drive through a tunnel in one segment', async () => {
    // Twenty minutes without a fix used to split the outing in two, which is
    // how a night of Android power management turned one record into fourteen.
    const tracker = createTracker({ driver });
    await tracker.record(fix(0), CLEAN_DEVICE);

    await tracker.record(fix(20 * 60, 20_000), CLEAN_DEVICE);

    expect(await countOf('segments')).toBe(1);
  });

  test('opens a new segment after a long silence and closes the old one', async () => {
    const tracker = createTracker({ driver });
    await tracker.record(fix(0), CLEAN_DEVICE);

    await tracker.record(fix(60 * 60, 300_000), CLEAN_DEVICE);

    expect(await countOf('segments')).toBe(2);
    const first = await driver.get<{ ended_at: number | null }>(
      'SELECT ended_at FROM segments ORDER BY id LIMIT 1',
    );
    expect(first?.ended_at).toBe(BASE_TIME);
  });

  test('never joins fixes across a segment boundary', async () => {
    const tracker = createTracker({ driver });
    await tracker.record(fix(0), CLEAN_DEVICE);

    await tracker.record(fix(90 * 60, 1000), CLEAN_DEVICE);

    expect(await fogClearedAt(at(500))).toBe(false);
  });

  test('closes the open segment when recording stops', async () => {
    const tracker = createTracker({ driver });
    await tracker.record(fix(0), CLEAN_DEVICE);

    await tracker.record(fix(60, 50), CLEAN_DEVICE);
    await tracker.stop();

    const row = await driver.get<{ ended_at: number }>('SELECT ended_at FROM segments');
    expect(row?.ended_at).toBe(BASE_TIME + 60_000);
  });
});

describe('persistence across restarts', () => {
  test('paints on top of fog already in the database', async () => {
    const first = createTracker({ driver });
    await first.record(fix(0), CLEAN_DEVICE);
    await first.stop();

    const second = createTracker({ driver });
    const result = await second.record(fix(3600, 0), CLEAN_DEVICE);

    if (!result.accepted) throw new Error('expected the fix to be accepted');
    expect(result.newlyExploredCells).toBe(0);
    expect(await countOf('fog_tiles')).toBe(1);
  });
});

/**
 * The OS tears the background JS context down between location batches, so a
 * brand new tracker is the normal case, not the exception. If a fresh tracker
 * assumed it was starting a new journey, every single fix would become its own
 * one-point segment — no corridors painted, no distance counted, and the speed
 * checks never running because there is nothing to compare against.
 */
describe('recovering after the process was torn down', () => {
  test('continues the open segment instead of starting another', async () => {
    const before = createTracker({ driver });
    await before.record(fix(0), CLEAN_DEVICE);

    const after = createTracker({ driver });
    const result = await after.record(fix(10, 15), CLEAN_DEVICE);

    expect(await countOf('segments')).toBe(1);
    if (!result.accepted) throw new Error('expected the fix to be accepted');
    expect(result.segmentId).toBe(1);
  });

  test('paints the corridor walked across the restart', async () => {
    const before = createTracker({ driver });
    await before.record(fix(0), CLEAN_DEVICE);

    const after = createTracker({ driver });
    await after.record(fix(60, 100), CLEAN_DEVICE);

    expect(await fogClearedAt(at(50))).toBe(true);
  });

  test('applies the movement checks across the restart', async () => {
    const before = createTracker({ driver });
    await before.record(fix(0), CLEAN_DEVICE);

    const after = createTracker({ driver });
    const result = await after.record(fix(10, 100_000), CLEAN_DEVICE);

    expect(result).toEqual({ accepted: false, reason: 'TELEPORT' });
  });

  test('opens a new segment when the phone was off for a long time', async () => {
    const before = createTracker({ driver });
    await before.record(fix(0), CLEAN_DEVICE);

    const after = createTracker({ driver });
    await after.record(fix(90 * 60, 1000), CLEAN_DEVICE);

    expect(await countOf('segments')).toBe(2);
  });

  test('does not resume a segment that was deliberately closed', async () => {
    const before = createTracker({ driver });
    await before.record(fix(0), CLEAN_DEVICE);
    await before.stop();

    const after = createTracker({ driver });
    await after.record(fix(10, 15), CLEAN_DEVICE);

    expect(await countOf('segments')).toBe(2);
  });

  test('starts cleanly when there is nothing to recover', async () => {
    const tracker = createTracker({ driver });

    const result = await tracker.record(fix(0), CLEAN_DEVICE);

    expect(result).toMatchObject({ accepted: true });
    expect(await countOf('segments')).toBe(1);
  });
});

describe('two batches of fixes arriving at once', () => {
  /**
   * The OS can invoke the background task again before the previous run has
   * finished, and both runs share one tracker and one database connection.
   * Every `await` inside record() is a point where the other run can slip in.
   */
  function interleavingDriver(inner: SqlDriver, injected: () => Promise<void>): SqlDriver {
    let armed = true;

    return {
      ...inner,
      async run(sql, params) {
        const result = await inner.run(sql, params);

        // Fire once, right after a segment is opened — the exact window where
        // a second batch would land its own write.
        if (armed && sql.includes('INSERT INTO segments')) {
          armed = false;
          await injected();
        }

        return result;
      },
    };
  }

  test('attaches the point to the segment it just opened, not to whatever wrote last', async () => {
    // A foreign insert between opening the segment and reading its id used to
    // hand back the other row's id, which pointed at no segment at all.
    //
    // Seeded first so the two tables' row ids cannot coincide — with both at 1
    // the bug hides, which is why it survived to a phone.
    for (let i = 0; i < 5; i++) {
      await driver.run('INSERT INTO rejections (ts, reason, accuracy) VALUES (?, ?, ?)', [
        BASE_TIME,
        'MOCK_PROVIDER',
        5,
      ]);
    }

    const racing = interleavingDriver(driver, async () => {
      await driver.run('INSERT INTO rejections (ts, reason, accuracy) VALUES (?, ?, ?)', [
        BASE_TIME,
        'LOW_ACCURACY',
        99,
      ]);
    });

    const tracker = createTracker({ driver: racing });
    const result = await tracker.record(fix(0), CLEAN_DEVICE);

    expect(result).toMatchObject({ accepted: true });

    const point = await driver.get<{ segment_id: number }>('SELECT segment_id FROM points');
    const segment = await driver.get<{ id: number }>('SELECT id FROM segments');
    expect(point?.segment_id).toBe(segment?.id);
  });

  test('records both fixes when two arrive concurrently', async () => {
    const tracker = createTracker({ driver });

    await Promise.all([
      tracker.record(fix(0), CLEAN_DEVICE),
      tracker.record(fix(30, 40), CLEAN_DEVICE),
    ]);

    expect(await countOf('points')).toBe(2);
  });

  test('keeps concurrent fixes in one segment rather than one segment each', async () => {
    // Both are moments apart in the same walk. Racing to open a segment would
    // split the walk in two and lose the corridor between them.
    const tracker = createTracker({ driver });

    await Promise.all([
      tracker.record(fix(0), CLEAN_DEVICE),
      tracker.record(fix(30, 40), CLEAN_DEVICE),
    ]);

    expect(await countOf('segments')).toBe(1);
  });
});
