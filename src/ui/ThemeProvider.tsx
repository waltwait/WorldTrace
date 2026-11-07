/**
 * The theme the app is drawn in, for any component to read.
 *
 * Kept in its own file beside the database rather than in it: a restore replaces
 * the database, and it should not change how the app looks.
 */

import { File, Paths } from 'expo-file-system';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_THEME,
  parseThemeId,
  serializeThemeId,
  THEMES,
  type Theme,
  type ThemeId,
} from './themes';

const ThemeContext = createContext<{ theme: Theme; choose: (id: ThemeId) => void }>({
  theme: THEMES[DEFAULT_THEME],
  choose: () => {},
});

const themeFile = () => new File(Paths.document, 'theme.json');

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<ThemeId>(DEFAULT_THEME);

  useEffect(() => {
    void (async () => {
      try {
        const file = themeFile();
        if (file.exists) setId(parseThemeId(await file.text()));
      } catch {
        // An unreadable file is the same as no file: the default.
      }
    })();
  }, []);

  const choose = useCallback((next: ThemeId) => {
    setId(next);
    try {
      const file = themeFile();
      if (!file.exists) file.create();
      file.write(serializeThemeId(next));
    } catch {
      // Not being able to remember a colour must not get in the way of using it.
    }
  }, []);

  const value = useMemo(() => ({ theme: THEMES[id], choose }), [id, choose]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext).theme;
}

export function useThemeChooser(): (id: ThemeId) => void {
  return useContext(ThemeContext).choose;
}

/** Styles for the current theme. `make` lives at module level, so they build once a theme. */
export function useStyles<T>(make: (theme: Theme) => T): T {
  const theme = useTheme();
  return useMemo(() => make(theme), [theme, make]);
}
