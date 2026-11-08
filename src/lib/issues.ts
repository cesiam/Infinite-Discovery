// Problems worth a look in a plan: a class placed in a season it isn't offered, or a
// prerequisite planned for the same term or later. The catalog may hold only some seasons'
// schedules (say, just the coming fall), so a season is only judged once some class is
// listed in it.
import { SEASONS, type CourseSummary, type Plan, type Season } from "./api";

export interface Issue {
  courseId: string;
  /** the slot the class sits in ("2-Fall") */
  key: string;
  message: string;
}

const order = (key: string) => {
  const [y, season] = key.split("-") as [string, Season];
  return (Number(y) - 1) * SEASONS.length + SEASONS.indexOf(season);
};

/** `termName` turns a slot key into words, e.g. "Fall 2027". */
export function planIssues(
  plan: Plan,
  courses: Record<string, CourseSummary>,
  termName: (key: string) => string,
): Issue[] {
  const where = new Map<string, string>();
  for (const [key, ids] of Object.entries(plan.slots)) for (const id of ids) where.set(id, key);
  const scheduled = new Set(Object.values(courses).flatMap((c) => c.terms));
  const issues: Issue[] = [];
  const keys = Object.keys(plan.slots).sort((a, b) => order(a) - order(b));
  for (const key of keys) {
    const season = key.split("-")[1] as Season;
    for (const id of plan.slots[key] ?? []) {
      const info = courses[id];
      if (!info) continue;
      if (scheduled.has(season) && info.terms.length && !info.terms.includes(season))
        issues.push({
          courseId: id,
          key,
          message: `Usually offered in ${info.terms.join(" and ")}`,
        });
      for (const pre of info.requires) {
        const preKey = where.get(pre);
        if (preKey && order(preKey) >= order(key))
          issues.push({
            courseId: id,
            key,
            message: `Take ${pre} before this (it's in ${termName(preKey)})`,
          });
      }
    }
  }
  return issues;
}
