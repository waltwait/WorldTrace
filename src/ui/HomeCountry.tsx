/** The country flights leave from, for the passport and the settings page to share. */

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
import { parseHomeCountry, serializeHomeCountry } from '../settings/homeCountry';

const HomeCountryContext = createContext<{
  home: string | null;
  choose: (code: string | null) => void;
}>({ home: null, choose: () => {} });

const homeFile = () => new File(Paths.document, 'home-country.json');

export function HomeCountryProvider({ children }: { children: ReactNode }) {
  const [home, setHome] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const file = homeFile();
        if (file.exists) setHome(parseHomeCountry(await file.text()));
      } catch {
        // An unreadable file is the same as no file: nothing chosen.
      }
    })();
  }, []);

  const choose = useCallback((code: string | null) => {
    setHome(code);
    try {
      const file = homeFile();
      if (!file.exists) file.create();
      file.write(serializeHomeCountry(code));
    } catch {
      // Not being able to remember it must not get in the way of choosing it.
    }
  }, []);

  const value = useMemo(() => ({ home, choose }), [home, choose]);
  return <HomeCountryContext.Provider value={value}>{children}</HomeCountryContext.Provider>;
}

export function useHomeCountry() {
  return useContext(HomeCountryContext);
}
