"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { ThemeMode } from "@/lib/db-types";
import { themeStorageKey } from "@/lib/theme";

type ThemeContextValue = {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;

  const resolved =
    mode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : mode === "dunkel";

  document.documentElement.classList.toggle("dark", resolved);
  document.documentElement.dataset.themeMode = mode;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>("system");

  useEffect(() => {
    const stored = window.localStorage.getItem(themeStorageKey) as ThemeMode | null;
    const initialMode =
      stored === "hell" || stored === "dunkel" || stored === "system" ? stored : "system";

    setThemeModeState(initialMode);
    applyTheme(initialMode);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if ((window.localStorage.getItem(themeStorageKey) as ThemeMode | null) === "system") {
        applyTheme("system");
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeMode,
      setThemeMode(mode) {
        setThemeModeState(mode);
        window.localStorage.setItem(themeStorageKey, mode);
        applyTheme(mode);
      }
    }),
    [themeMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme muss innerhalb des ThemeProvider verwendet werden.");
  }
  return context;
}

export function getThemeStorageKey() {
  return themeStorageKey;
}
