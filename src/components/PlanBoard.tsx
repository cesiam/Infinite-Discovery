import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { X, CalendarDays, ChevronDown, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_PLAN_YEARS, planKey } from "@/lib/api";
import { PLAN_TERMS, seasonYear, usePlan } from "@/lib/plan";
import { CartList } from "./Cart";
import { PlanSwitcher } from "./PlanSwitcher";
import { RequirementsPanel } from "./RequirementsPanel";
import { YearSchedule } from "./YearSchedule";

import { DRAG_TYPE } from "@/lib/dnd";

export { DRAG_TYPE };

export function PlanBoard() {
  const { plan, courses, add, remove, addYear, removeYear, highlight } = usePlan();
  const [over, setOver] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState<number | null>(null);
  const units = (id: string) => courses[id]?.unitsTotal ?? 0;
  const total = Object.values(plan.slots)
    .flat()
    .reduce((s, id) => s + units(id), 0);
  const years = Array.from({ length: plan.years }, (_, i) => i + 1);

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
    <section className="plan-content flex flex-col p-5 sm:p-7">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <p className="label-mono">The big picture</p>
          <h2 className="mt-2 font-display text-3xl font-black text-foreground">
            Time at MIT<span className="text-primary">.</span>
          </h2>
        </div>
        <CalendarDays className="mt-7 h-6 w-6 text-primary" />
      </div>
      <PlanSwitcher />
      <div className="plan-summary mt-6 flex items-center justify-between border-y border-border py-4">
        <p className="text-xs font-semibold text-muted-foreground">TOTAL PLANNED</p>
        <p className="text-sm font-bold text-muted-foreground">
          <span className="mr-1 text-2xl font-black text-foreground">{total}</span> units
        </p>
      </div>
      <RequirementsPanel />
      <section className="mt-6" aria-label="Class cart">
        <p className="label-mono mb-2">Class cart · drag onto a term</p>
        <CartList />
      </section>

      <div className="mt-6 flex flex-1 flex-col gap-5">
        {years.map((year) => {
          const yearIds = PLAN_TERMS.flatMap((t) => plan.slots[planKey(year, t)] ?? []);
          const yearUnits = yearIds.reduce((s, id) => s + units(id), 0);
          const isOpen = expanded.has(year);
          return (
            <div key={year} className="plan-bar">
              <div className="flex items-center justify-between gap-2 px-1">
                <button
                  type="button"
                  onClick={() => toggle(year)}
                  aria-expanded={isOpen}
                  aria-controls={`year-${year}-schedule`}
                  className="flex items-center gap-2 rounded-md text-left text-sm font-extrabold text-foreground hover:text-primary"
                >
                  <span className="year-number">{String(year).padStart(2, "0")}</span>Year {year}
                  <span className="text-xs font-semibold text-muted-foreground">
                    {seasonYear(year, "Fall")}–{String(seasonYear(year, "Spring")).slice(2)}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">
                    {yearUnits} units
                  </span>
                  {plan.years > 1 && (
                    <Button
                      variant={confirming === year ? "destructive" : "ghost"}
                      size="sm"
                      className="h-7 px-2"
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
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PLAN_TERMS.map((term) => {
                  const key = planKey(year, term);
                  const ids = plan.slots[key] ?? [];
                  return (
                    <div
                      key={key}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setOver(key);
                      }}
                      onDragLeave={() => setOver((o) => (o === key ? null : o))}
                      onDrop={(e) => {
                        e.preventDefault();
                        const id = e.dataTransfer.getData(DRAG_TYPE);
                        if (id) add(id, key);
                        setOver(null);
                      }}
                      className={`plan-slot ${over === key ? "plan-slot-over" : ""}`}
                    >
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {term}
                      </span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {ids.length === 0 && (
                          <Plus
                            aria-hidden
                            className="mx-auto mt-3 h-4 w-4 text-muted-foreground/40"
                          />
                        )}
                        {ids.map((id) => (
                          <span
                            key={id}
                            draggable
                            onDragStart={(e) => e.dataTransfer.setData(DRAG_TYPE, id)}
                            className={`plan-chip transition-opacity ${
                              highlight
                                ? highlight.has(id)
                                  ? "ring-2 ring-primary ring-offset-1"
                                  : "opacity-25"
                                : ""
                            }`}
                          >
                            <Link to="/courses/$courseId" params={{ courseId: id }}>
                              {id}
                            </Link>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-4 w-4 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground [&_svg]:size-3"
                              onClick={() => remove(id)}
                              aria-label={`Remove ${id}`}
                            >
                              <X />
                            </Button>
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              {isOpen && <YearSchedule id={`year-${year}-schedule`} year={year} />}
            </div>
          );
        })}

        <Button
          variant="outline"
          onClick={addYear}
          disabled={plan.years >= MAX_PLAN_YEARS}
          className="border-dashed"
        >
          <Plus />
          {plan.years >= MAX_PLAN_YEARS ? `${MAX_PLAN_YEARS} years is the limit` : "Add a year"}
        </Button>
      </div>
    </section>
  );
}
