// How a class looks as a block in the planner: its color, its GIR tags, and the short
// codes for terms (F26, IAP27, S27, U27).
import type { Season } from "./api";

export type Tone = "red" | "mint" | "sky" | "wisteria" | "vanilla";

const SCIENCE = new Set(["3", "5", "7", "8", "9", "10", "12", "20", "22"]);
const HASS = new Set([
  "4",
  "11",
  "14",
  "15",
  "17",
  "21",
  "21A",
  "21G",
  "21H",
  "21L",
  "21M",
  "21T",
  "21W",
  "24",
  "CMS",
  "STS",
  "WGS",
]);

/** EECS red, math mint, science sky, humanities wisteria, everything else vanilla. */
export function tone(courseId: string): Tone {
  const dept = courseId.split(".")[0] ?? "";
  if (dept === "6") return "red";
  if (dept === "18") return "mint";
  if (SCIENCE.has(dept)) return "sky";
  if (HASS.has(dept) || dept.startsWith("21")) return "wisteria";
  return "vanilla";
}

const TAGS: [RegExp, string][] = [
  [/\bCALC I\b(?! I)/, "Calc I"],
  [/\bCALC II\b/, "Calc II"],
  [/\bPHYSICS I\b(?! I)/, "Phys I"],
  [/\bPHYSICS II\b/, "Phys II"],
  [/\bCHEMISTRY\b/, "Chem"],
  [/\bBIOLOGY\b/, "Bio"],
  [/\bREST\b/, "REST"],
  [/\bInstitute LAB\b/, "Lab"],
  [/\bPartial Lab\b/, "Lab/2"],
  [/\bHASS-([AHSE])\b/, "HASS-$1"],
  [/\bCI-HW?\b/, "CI-H"],
];

/** GIR tags from the catalog's units line ("5-0-7 REST", "3-0-9 HASS-A; CI-H"). */
export function girTags(units: string): string[] {
  const out: string[] = [];
  for (const [re, label] of TAGS) {
    const m = units.match(re);
    if (m) out.push(label.replace("$1", m[1] ?? ""));
  }
  return out;
}

export const SEASON_CODE: Record<Season, string> = {
  Fall: "F",
  IAP: "IAP",
  Spring: "S",
  Summer: "U",
};
/** "F26", "IAP27", "S27", "U27" from a calendar year. */
export const termCode = (season: Season, calendarYear: number) =>
  `${SEASON_CODE[season]}${String(calendarYear).slice(2)}`;

/** The season a date falls in: Sep–Dec Fall, Jan IAP, Feb–May Spring, Jun–Aug Summer. */
export function seasonOf(date: Date): { season: Season; calendarYear: number } {
  const m = date.getMonth();
  const season: Season = m >= 8 ? "Fall" : m === 0 ? "IAP" : m <= 4 ? "Spring" : "Summer";
  return { season, calendarYear: date.getFullYear() };
}
