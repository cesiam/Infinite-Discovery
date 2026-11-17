import { useSyncExternalStore } from "react";

/** Where the requirements live: above the plan (the default) or in the side panel. */
export type Dock = "plan" | "side";

const KEY = "id-requirements-dock";
const listeners = new Set<() => void>();

function read(): Dock {
  try {
    return localStorage.getItem(KEY) === "side" ? "side" : "plan";
  } catch {
    return "plan";
  }
}

export function setRequirementsDock(dock: Dock) {
  try {
    localStorage.setItem(KEY, dock);
  } catch {
    // not remembered across visits
  }
  listeners.forEach((l) => l());
}

export function useRequirementsDock(): Dock {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => "plan",
  );
}
