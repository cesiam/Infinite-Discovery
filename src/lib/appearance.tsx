import { createContext, useContext, useState, type ReactNode } from "react";

export const BACKGROUNDS = [
  { id: "gradient", label: "Gradient" },
  { id: "floating", label: "Floating campus" },
  { id: "dome", label: "Dorms & Dome" },
  { id: "blueprint", label: "Blueprint" },
] as const;
export const LAYOUTS = [
  { id: "rail", label: "Rail" },
  { id: "columns", label: "Columns" },
  { id: "framed", label: "Framed" },
  { id: "glass", label: "Curved glass" },
] as const;
export const WORDMARKS = [
  { id: "vertical", label: "Vertical" },
  { id: "horizontal", label: "Horizontal" },
] as const;
export type BackgroundId = (typeof BACKGROUNDS)[number]["id"];
export type LayoutId = (typeof LAYOUTS)[number]["id"];
export type WordmarkId = (typeof WORDMARKS)[number]["id"];

interface Appearance {
  background: BackgroundId;
  layout: LayoutId;
  wordmark: WordmarkId;
  setBackground: (b: BackgroundId) => void;
  setLayout: (l: LayoutId) => void;
  setWordmark: (w: WordmarkId) => void;
}
const Ctx = createContext<Appearance | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [background, setBackground] = useState<BackgroundId>("dome");
  const [layout, setLayout] = useState<LayoutId>("framed");
  const [wordmark, setWordmark] = useState<WordmarkId>("horizontal");
  return (
    <Ctx.Provider value={{ background, layout, wordmark, setBackground, setLayout, setWordmark }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAppearance() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppearance outside provider");
  return v;
}
