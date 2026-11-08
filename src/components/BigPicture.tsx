import { ArrowRightToLine, Check, Layers, Plus, TriangleAlert } from "lucide-react";
import { planKey, type Season } from "@/lib/api";
import { termCode } from "@/lib/blocks";
import type { Issue } from "@/lib/issues";
import { PLAN_START_YEAR, seasonYear, usePlan } from "@/lib/plan";

/** Bars are scaled to a full term. */
const FULL_TERM = 60;

const scrollToTerm = (key: string) =>
  document.getElementById(`term-${key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });

/** The top of the planner: units over time, the next term, and what needs a look. */
export function BigPicture({
  now,
  issues,
  onAddTo,
}: {
  now: { year: number; season: Season };
  issues: Issue[];
  onAddTo: (key: string) => void;
}) {
  const { plan, courses } = usePlan();
  const units = (ids: string[] = []) =>
    ids.reduce((s, id) => s + (courses[id]?.unitsTotal ?? 0), 0);
  const terms = Array.from({ length: plan.years }, (_, i) => i + 1).flatMap((year) =>
    (["Fall", "Spring"] as Season[]).map((season) => {
      const key = planKey(year, season);
      return { key, year, season, units: units(plan.slots[key]) };
    }),
  );
  const nowIndex = (now.year - 1) * 2 + (now.season === "Fall" ? 0 : 1);
  const planned = terms.filter((t) => t.units > 0);
  const creditUnits = units(plan.credit);
  const total = units(Object.values(plan.slots).flat()) + creditUnits;
  const average = planned.length
    ? Math.round(planned.reduce((s, t) => s + t.units, 0) / planned.length)
    : 0;
  // the next fall or spring: in IAP that's the coming spring, otherwise the term after this one
  const nextIndex = now.season === "IAP" ? nowIndex : nowIndex + 1;
  const next = terms[Math.min(Math.max(nextIndex, 0), terms.length - 1)];
  const nextName = next ? `${next.season} ${seasonYear(next.year, next.season)}` : "";
  const nextIds = next ? (plan.slots[next.key] ?? []) : [];

  return (
    <section className="card-glass plan-card big-picture" aria-labelledby="big-picture-title">
      <div className="big-head">
        <div>
          <p className="label-mono">The big picture</p>
          <h2 id="big-picture-title" className="big-title">
            Time at MIT<span>.</span>
          </h2>
        </div>
        <p className="big-sum">
          {plan.years} years starting fall {PLAN_START_YEAR}. {planned.length} of {terms.length}{" "}
          fall and spring terms have classes so far.
        </p>
      </div>

      <div className="big-cards">
        <div className="stat stat-total">
          <p className="stat-label">
            <Layers />
            Total planned
          </p>
          <p className="stat-num">
            {total}
            <span>units</span>
          </p>
          <ol className="bars" aria-label="Units in each fall and spring term">
            {terms.map((t, i) => (
              <li
                key={t.key}
                className={
                  i === nowIndex && (now.season === "Fall" || now.season === "Spring")
                    ? "bar-now"
                    : ""
                }
                title={`${t.season} ${seasonYear(t.year, t.season)}: ${t.units} units`}
              >
                <span className="bar-track">
                  <span
                    className="bar-fill"
                    style={{ height: `${Math.min(t.units / FULL_TERM, 1) * 100}%` }}
                  />
                </span>
                <span className="bar-label">
                  {termCode(t.season, seasonYear(t.year, t.season))}
                </span>
              </li>
            ))}
          </ol>
          <p className="stat-note">
            Fall and spring terms, scaled to {FULL_TERM} units. Average {average} per planned term
            {creditUnits > 0 && `, plus ${creditUnits} units of prior credit`}.
          </p>
        </div>

        <div className="stat stat-next">
          <p className="stat-label">
            <ArrowRightToLine />
            Up next
          </p>
          <p className="stat-num">
            {units(nextIds)}
            <span>units</span>
          </p>
          <p className="stat-term">{nextName}</p>
          {nextIds.length > 0 && (
            <ul className="next-chips">
              {nextIds.map((id) => (
                <li key={id}>{id}</li>
              ))}
            </ul>
          )}
          {next && (
            <button
              type="button"
              className="next-add"
              onClick={() => {
                onAddTo(next.key);
                scrollToTerm(next.key);
              }}
            >
              <Plus />
              Add to {nextName}
            </button>
          )}
        </div>

        <div className="stat stat-alert">
          <p className="stat-label">
            {issues.length ? <TriangleAlert /> : <Check />}
            {issues.length ? "Needs attention" : "All clear"}
          </p>
          <p className="stat-num">
            {issues.length}
            <span>issue{issues.length === 1 ? "" : "s"}</span>
          </p>
          {issues.length ? (
            <ul className="issues">
              {issues.slice(0, 4).map((i) => (
                <li key={`${i.courseId}-${i.message}`}>
                  <button type="button" onClick={() => scrollToTerm(i.key)}>
                    <b>{i.courseId}</b>
                    {i.message}
                  </button>
                </li>
              ))}
              {issues.length > 4 && <li className="issues-more">+{issues.length - 4} more</li>}
            </ul>
          ) : (
            <p className="stat-note">Seasons and prerequisite order look right.</p>
          )}
        </div>
      </div>
    </section>
  );
}
