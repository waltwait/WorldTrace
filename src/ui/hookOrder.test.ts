import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';
import { findHookViolations } from './testing/hookOrder';

describe('findHookViolations', () => {
  test('a hook after an early return is reported', () => {
    const src = `
      function Sheet({ flight }) {
        const [a] = useState(0);
        if (!flight) return null;
        const onPress = useCallback(() => {}, []);
        return null;
      }`;
    expect(findHookViolations('x.tsx', src)).toEqual([
      { hook: 'useCallback', line: 5, reason: 'after-early-return' },
    ]);
  });

  test('a hook under an if, a ternary or a short-circuit is reported', () => {
    const src = `
      function C({ on }) {
        if (on) { useEffect(() => {}); }
        const v = on ? useMemo(() => 1, []) : 0;
        on && useRef(null);
        return null;
      }`;
    expect(findHookViolations('x.tsx', src).map((v) => [v.hook, v.reason])).toEqual([
      ['useEffect', 'conditional'],
      ['useMemo', 'conditional'],
      ['useRef', 'conditional'],
    ]);
  });

  test('a return inside a nested callback is not an early return', () => {
    const src = `
      function C({ flight }) {
        useEffect(() => { if (!flight) return; }, [flight]);
        const go = useCallback(() => { return 1; }, []);
        if (!flight) return null;
        return <Inner flight={flight} />;
      }`;
    expect(findHookViolations('x.tsx', src)).toEqual([]);
  });

  test('a hook used as the condition itself is unconditional', () => {
    const src = `
      function C() {
        if (useReducedMotion()) return null;
        return null;
      }`;
    expect(findHookViolations('x.tsx', src)).toEqual([]);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

test('every component and hook in the app calls its hooks in a fixed order', () => {
  const root = join(__dirname, '..', '..');
  const files = [join(root, 'App.tsx'), ...sourceFiles(join(root, 'src'))];
  const found = files.flatMap((file) =>
    findHookViolations(file, readFileSync(file, 'utf8')).map(
      (v) => `${relative(root, file)}:${v.line} ${v.hook} (${v.reason})`,
    ),
  );
  expect(found).toEqual([]);
});
