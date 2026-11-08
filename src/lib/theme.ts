import { useEffect, useState } from "react";

const KEY = "id-theme";

/** Light or dark: the saved choice, else the system's. Sets the `dark` class on <html>. */
export function useDarkMode(): [boolean, () => void] {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      // storage blocked: follow the system
    }
    setDark(saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  const toggle = () =>
    setDark((d) => {
      try {
        localStorage.setItem(KEY, d ? "light" : "dark");
      } catch {
        // not remembered across visits
      }
      return !d;
    });
  return [dark, toggle];
}
