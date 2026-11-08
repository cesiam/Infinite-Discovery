import { useMemo, useState, type DragEvent, type ReactNode } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_PLAN_YEARS, planKey, type Season } from "@/lib/api";
import { termCode } from "@/lib/blocks";
import { DRAG_TYPE } from "@/lib/dnd";
import { PLAN_TERMS, planTermOf, seasonYear, usePlan } from "@/lib/plan";
import { planIssues, type Issue } from "@/lib/issues";
import { BigPicture } from "./BigPicture";
import { CourseBlock } from "./CourseBlock";
import { PlanSwitcher } from "./PlanSwitcher";
import { QuickAdd } from "./QuickAdd";
import { RequirementsPanel } from "./RequirementsPanel";
import { YearSchedule } from "./YearSchedule";

export { DRAG_TYPE };

/** A full term, for the load bar under each column. */
const FULL_TERM = 60;
const CREDIT = "credit";

/** Somewhere a class can be dropped: a term, the cart or prior credit. */
function useDrop(onDrop: (id: string) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    handlers: {
      onDragOver: (e: DragEvent) => {
        e.preventDefault();
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData(DRAG_TYPE);
        if (id) onDrop(id);
      },
    },
  };
}

function Tray({
  onDrop,
  empty,
  children,
}: {
  onDrop: (id: string) => void;
  empty: ReactNode;
  children: ReactNode[];
}) {
  const { over, handlers } = useDrop(onDrop);
  return (
    <div {...handlers} className={`tray ${over ? "tray-over" : ""}`}>
      {children.length ? children : <p className="tray-empty">{empty}</p>}
    </div>
  );
}

function TermColumn({
  year,
  season,
  isNow,
  adding,
  setAdding,
  issues,
}: {
  year: number;
  season: Season;
  isNow: boolean;
  issues: Issue[];
  adding: boolean;
  setAdding: (key: string | null) => void;
}) {
  const { plan, courses, add, remove } = usePlan();
  const key = planKey(year, season);
  const ids = plan.slots[key] ?? [];
  const units = ids.reduce((s, id) => s + (courses[id]?.unitsTotal ?? 0), 0);
  const { over, handlers } = useDrop((id) => add(id, key));
  const short = season === "IAP" || season === "Summer";
  return (
    <div
      id={`term-${key}`}
      {...handlers}
      className={`term ${isNow ? "term-now" : ""} ${short && !ids.length ? "term-empty" : ""} ${over ? "term-over" : ""}`}
    >
      <div className="term-head">
        <span>{season}</span>
        {isNow && <span className="now-tag">Now</span>}
        <span className="ml-auto">{units}u</span>
      </div>
      <div className="term-blocks">
        {ids.map((id) => (
          <CourseBlock
            key={id}
            id={id}
            onRemove={() => remove(id)}
            warning={issues
              .filter((i) => i.courseId === id)
              .map((i) => i.message)
              .join(". ")}
          />
        ))}
      </div>
      {ids.length > 0 && (
        <div className="term-load" title={`${units} of ${FULL_TERM} units`}>
          <span style={{ width: `${Math.min(units / FULL_TERM, 1) * 100}%` }} />
        </div>
      )}
      {adding ? (
        <QuickAdd
          label={`Add a class to ${season} ${seasonYear(year, season)}`}
          onPick={(id) => add(id, key)}
          onClose={() => setAdding(null)}
        />
      ) : (
        <button
          type="button"
          className="term-add"
          onClick={() => setAdding(key)}
          aria-label={`Add a class to ${season} ${seasonYear(year, season)}`}
        >
          <Plus />
          {short && "Add"}
        </button>
      )}
    </div>
  );
}

export function PlanBoard() {
  const { plan, courses, addYear, removeYear, addToCart, removeFromCart, remove } = usePlan();
  const { addCredit, removeCredit } = usePlan();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState<number | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const units = (id: string) => courses[id]?.unitsTotal ?? 0;
  const years = Array.from({ length: plan.years }, (_, i) => i + 1);
  const now = planTermOf(new Date());
  const nowKey = planKey(now.year, now.season);
  const creditUnits = plan.credit.reduce((s, id) => s + units(id), 0);
  const issues = useMemo(
    () =>
      planIssues(plan, courses, (key) => {
        const [y, season] = key.split("-") as [string, Season];
        return `${season} ${seasonYear(Number(y), season)}`;
      }),
    [plan, courses],
  );

  const toggle = (year: number) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });

  const onRemoveYear = (year: number, courseCount: number) => {
    if (courseCount > 0 && confirming !== year) {
      setConfirming(year);
      return;
    }
    removeYear(year);
    setConfirming(null);
    // later years moved up one, so their open/closed state moves with them
    setExpanded(
      (s) => new Set([...s].filter((y) => y !== year).map((y) => (y > year ? y - 1 : y))),
    );
  };

  return (
    <>
      <PlanSwitcher />
      <BigPicture now={now} issues={issues} onAddTo={setAdding} />
      <section className="card-glass plan-card" aria-label="Degree requirements">
        <RequirementsPanel />
      </section>

      <section className="card-glass plan-card" aria-label="Terms">
        <div className="plan-card-head">
          <p className="label-mono">Class cart · drag onto a term</p>
          <p className="plan-card-hint">Or open any class to pick its term from a list.</p>
        </div>
        <Tray
          onDrop={(id) => {
            remove(id);
            removeCredit(id);
            addToCart([id]);
          }}
          empty="Empty. Add classes from search, a course page, or the graph."
        >
          {plan.cart.map((id) => (
            <CourseBlock key={id} id={id} chip onRemove={() => removeFromCart(id)} />
          ))}
        </Tray>

        <div className="plan-card-head mt-6">
          <p className="label-mono">Timeline</p>
          <p className="plan-card-hint">
            Now: {now.season} {seasonYear(now.year, now.season)}
          </p>
        </div>
        <ol className="timeline">
          {years.flatMap((year) =>
            PLAN_TERMS.map((season) => {
              const key = planKey(year, season);
              const sum = (plan.slots[key] ?? []).reduce((s, id) => s + units(id), 0);
              const isNow = key === nowKey;
              return (
                <li key={key}>
                  <button
                    type="button"
                    className={`tick ${isNow ? "tick-now" : ""} ${sum ? "" : "tick-empty"}`}
                    onClick={() =>
                      document
                        .getElementById(`year-${year}`)
                        ?.scrollIntoView({ behavior: "smooth", block: "start" })
                    }
                    title={`${season} ${seasonYear(year, season)}: ${sum} units`}
                  >
                    <span className="tick-season">{isNow ? "Now" : season}</span>
                    <b>{termCode(season, seasonYear(year, season))}</b>
                    <span className="tick-units">{sum}u</span>
                  </button>
                </li>
              );
            }),
          )}
        </ol>

        <div className="credit-head">
          <span className="year-badge">AP</span>
          <h3>Prior credit</h3>
          <span className="credit-sub">AP, ASE and transfer</span>
          <span className="ml-auto font-semibold">{creditUnits} units</span>
        </div>
        <Tray
          onDrop={addCredit}
          empty={
            adding === CREDIT ? null : (
              <>
                Drag a class here for credit you already have, or{" "}
                <button type="button" className="underline" onClick={() => setAdding(CREDIT)}>
                  add one
                </button>
                .
              </>
            )
          }
        >
          {plan.credit.map((id) => (
            <CourseBlock key={id} id={id} chip onRemove={() => removeCredit(id)} />
          ))}
        </Tray>
        {adding === CREDIT && (
          <div className="mt-2 max-w-xs">
            <QuickAdd label="Add prior credit" onPick={addCredit} onClose={() => setAdding(null)} />
          </div>
        )}

        {years.map((year) => {
          const yearIds = PLAN_TERMS.flatMap((t) => plan.slots[planKey(year, t)] ?? []);
          const yearUnits = yearIds.reduce((s, id) => s + units(id), 0);
          const isOpen = expanded.has(year);
          return (
            <div key={year} id={`year-${year}`} className="year">
              <div className="year-head">
                <button
                  type="button"
                  onClick={() => toggle(year)}
                  aria-expanded={isOpen}
                  aria-controls={`year-${year}-schedule`}
                  className="year-toggle"
                  title="Show the predicted weekly schedule"
                >
                  <span className="year-badge">{String(year).padStart(2, "0")}</span>
                  <h3>Year {year}</h3>
                  <span className="year-span">
                    {seasonYear(year, "Fall")}–{String(seasonYear(year, "Spring")).slice(2)}
                  </span>
                  <ChevronDown className={`h-4 w-4 transition ${isOpen ? "rotate-180" : ""}`} />
                </button>
                <span className="ml-auto font-semibold">{yearUnits} units</span>
                {plan.years > 1 && (
                  <Button
                    variant={confirming === year ? "destructive" : "ghost"}
                    size="sm"
                    className="h-8 px-2"
                    onClick={() => onRemoveYear(year, yearIds.length)}
                    onBlur={() => setConfirming(null)}
                    aria-label={
                      confirming === year
                        ? `Confirm removing year ${year} and its ${yearIds.length} courses`
                        : `Remove year ${year}`
                    }
                  >
                    <Trash2 />
                    {confirming === year && `Remove ${yearIds.length} courses?`}
                  </Button>
                )}
              </div>
              <div className="year-grid">
                {PLAN_TERMS.map((season) => (
                  <TermColumn
                    key={season}
                    year={year}
                    season={season}
                    isNow={planKey(year, season) === nowKey}
                    adding={adding === planKey(year, season)}
                    setAdding={setAdding}
                    issues={issues.filter((i) => i.key === planKey(year, season))}
                  />
                ))}
              </div>
              {isOpen && <YearSchedule id={`year-${year}-schedule`} year={year} />}
            </div>
          );
        })}

        <button
          type="button"
          onClick={addYear}
          disabled={plan.years >= MAX_PLAN_YEARS}
          className="add-year"
        >
          <Plus />
          {plan.years >= MAX_PLAN_YEARS ? `${MAX_PLAN_YEARS} years is the limit` : "Add a year"}
        </button>
      </section>
    </>
  );
}
