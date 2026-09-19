import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";

import { applyPalette, THEME_STORAGE_KEY, createPalette, loadThemePreference, normalizeColor, resolveBackground, type ThemeMode, type ThemePalette, type ThemePreference } from "./palette.js";

interface ThemeContextValue {
  palette: ThemePalette;
  mode: ThemeMode;
  setMode: (mode: Exclude<ThemeMode, "custom">) => void;
  setBackground: (color: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState(loadThemePreference);
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const background = resolveBackground(preference, systemDark);
  const palette = useMemo(() => createPalette(background), [background]);

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const updatePreference = useCallback((next: ThemePreference) => {
    setPreference(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Keep the chosen color usable even when browser storage is unavailable.
    }
  }, []);
  const setBackground = useCallback((value: string) => {
    const color = normalizeColor(value);
    if (color) updatePreference({ mode: "custom", color });
  }, [updatePreference]);
  const setMode = useCallback((mode: Exclude<ThemeMode, "custom">) => {
    updatePreference({ ...preference, mode });
  }, [preference, updatePreference]);
  useLayoutEffect(() => applyPalette(palette), [palette]);
  const value = useMemo(() => ({ palette, mode: preference.mode, setMode, setBackground }), [palette, preference.mode, setMode, setBackground]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("ThemeProvider is missing");
  return context;
}
