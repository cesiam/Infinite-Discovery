import { useEffect, useRef, useState } from "react";
import { CalendarPlus, Check, X } from "lucide-react";
import { planKey } from "@/lib/api";
import { PLAN_TERMS, seasonYear, usePlan } from "@/lib/plan";
import { Button } from "@/components/ui/button";

/** Put a class straight into a term of the plan (no cart): pick a term from a small grid,
 * or take the next open one. If it's already planned, the same grid moves it. */
export function AddToPlanButton({
  courseId,
  size = "sm",
}: {
  courseId: string;
  size?: "sm" | "icon";
}) {
  const { plan, add, addNext, remove } = usePlan();
  const [open, setOpen] = useState(false);
  const [placed, setPlaced] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const currentKey = Object.entries(plan.slots).find(([, ids]) => ids.includes(courseId))?.[0];
  const [y, season] = currentKey?.split("-") ?? [];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) =>
      ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div ref={ref} className="relative inline-block" onClick={stop}>
      <Button
        variant={currentKey ? "outline" : "default"}
        size={size}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={
          currentKey
            ? `${courseId} is in Year ${y} ${season}; move it`
            : `Add ${courseId} to your plan`
        }
        title={currentKey ? `In your plan: Year ${y} ${season}` : "Add to a term in your plan"}
      >
        {currentKey ? <Check /> : <CalendarPlus />}
        {size === "sm" && (currentKey ? `Year ${y} ${season}` : "Add to plan")}
      </Button>
      {open && (
        <div
          className="absolute right-0 top-full z-40 mt-1 w-72 rounded-lg border border-border bg-card p-3 text-left shadow-lg"
          role="dialog"
          aria-label={`Choose a term for ${courseId}`}
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="label-mono">{currentKey ? "Move to" : "Add to"} a term</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close">
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
          {!currentKey && (
            <Button
              size="sm"
              variant="outline"
              className="mb-2 w-full"
              onClick={() => {
                setPlaced(addNext(courseId));
                setOpen(false);
              }}
            >
              Next open term
            </Button>
          )}
          <div className="grid grid-cols-[auto_repeat(4,1fr)] gap-1 text-[10px] font-bold">
            <span />
            {PLAN_TERMS.map((t) => (
              <span key={t} className="text-center uppercase text-muted-foreground">
                {t}
              </span>
            ))}
            {Array.from({ length: plan.years }, (_, i) => i + 1).map((year) => (
              <Row key={year} year={year}>
                {PLAN_TERMS.map((t) => {
                  const key = planKey(year, t);
                  const here = key === currentKey;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={here}
                      onClick={() => {
                        add(courseId, key);
                        setPlaced(`Year ${year} ${t}`);
                        setOpen(false);
                      }}
                      title={`Year ${year} ${t} ${seasonYear(year, t)} · ${(plan.slots[key] ?? []).length} classes`}
                      className={`rounded border px-1 py-1.5 ${here ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary hover:text-primary"}`}
                    >
                      {here ? "here" : (plan.slots[key] ?? []).length || "+"}
                    </button>
                  );
                })}
              </Row>
            ))}
          </div>
          {currentKey && (
            <button
              type="button"
              className="mt-2 text-[11px] font-bold text-muted-foreground hover:text-destructive"
              onClick={() => {
                remove(courseId);
                setPlaced("");
                setOpen(false);
              }}
            >
              Remove from plan
            </button>
          )}
        </div>
      )}
      {placed && !open && size === "sm" && (
        <span className="sr-only" role="status">
          Added to {placed}
        </span>
      )}
    </div>
  );
}

function Row({ year, children }: { year: number; children: React.ReactNode }) {
  return (
    <>
      <span className="self-center pr-1 text-muted-foreground">Y{year}</span>
      {children}
    </>
  );
}
