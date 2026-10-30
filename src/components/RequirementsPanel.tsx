import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Check, CircleDashed, CircleHelp, ExternalLink, Plus, X } from "lucide-react";
import {
  ApiError,
  apiUnreachable,
  getProgress,
  listPrograms,
  type ProgramKind,
  type ProgramProgress,
  type ProgramSummary,
  type RequirementProgress,
} from "@/lib/api";
import { DRAG_TYPE } from "@/lib/dnd";
import { usePlan } from "@/lib/plan";
import { Button } from "@/components/ui/button";

const KIND_LABELS: Record<ProgramKind, string> = {
  gir: "Institute",
  major: "Major",
  minor: "Minor",
  concentration: "Concentration",
};

/** "Computer Science and Engineering (Course 6-3)" -> "6-3"; "Minor in Economics" -> "Economics". */
function shortName(p: ProgramProgress) {
  if (p.kind === "gir") return "GIRs";
  if (p.kind === "major" && p.code) return p.code;
  return p.name.replace(/^Minor in /, "").replace(/^HASS Concentration: /, "");
}

const creditedCourses = (p: ProgramProgress) => p.requirements.flatMap((r) => r.credited);

/**
 * Progress toward the student's programs, from MIT's official requirements. Programs are
 * compact tiles so many can sit side by side; one program's checklist opens below them.
 * Hovering a tile or a course tag spotlights those courses in the plan.
 */
export function RequirementsPanel() {
  const { plan, addProgram, removeProgram, setHighlight } = usePlan();
  const courses = useMemo(
    () => [...new Set(Object.values(plan.slots).flat())].sort(),
    [plan.slots],
  );
  const [progress, setProgress] = useState<ProgramProgress[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      getProgress(plan.programs, courses)
        .then((p) => {
          if (live) {
            setProgress(p.programs);
            setWarnings(p.warnings);
            setError("");
          }
        })
        .catch((e) => live && setError(e instanceof ApiError ? e.message : apiUnreachable()));
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [plan.programs, courses]);

  const selected = progress?.find((p) => p.id === open) ?? null;

  return (
    <section className="mt-6" aria-label="Degree requirements">
      <div className="flex items-baseline justify-between gap-3">
        <p className="label-mono">Requirements</p>
        <span className="text-[11px] font-semibold text-muted-foreground">
          From MIT&apos;s official degree charts · hover to spotlight
        </span>
      </div>
      {error && <p className="mt-2 text-xs font-bold text-destructive">{error}</p>}

      <div
        className="mt-3 grid gap-2"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(9.5rem, 1fr))" }}
      >
        {progress?.map((p) => (
          <ProgramTile
            key={p.id}
            program={p}
            open={open === p.id}
            onSelect={() => setOpen(open === p.id ? null : p.id)}
            onRemove={() => {
              if (open === p.id) setOpen(null);
              removeProgram(p.id);
            }}
            onHover={(on) => setHighlight(on ? creditedCourses(p) : null)}
          />
        ))}
        <button
          type="button"
          onClick={() => setAdding((a) => !a)}
          aria-expanded={adding}
          className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-foreground/20 text-xs font-bold text-muted-foreground hover:border-primary hover:text-primary"
        >
          <Plus className="h-4 w-4" />
          Add major, minor
          <br />
          or concentration
        </button>
      </div>
      {warnings.map((w) => (
        <p key={w} className="mt-2 text-xs font-bold text-destructive">
          {w}
        </p>
      ))}
      {adding && (
        <AddProgram
          selected={plan.programs}
          onAdd={(id) => {
            addProgram(id);
            setOpen(id);
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      )}
      {selected && <ProgramDetail program={selected} onClose={() => setOpen(null)} />}
    </section>
  );
}

function Ring({ percent }: { percent: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 40 40"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <circle cx="20" cy="20" r={r} fill="none" stroke="var(--dust)" strokeWidth="5" />
      <circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${(percent / 100) * c} ${c}`}
        transform="rotate(-90 20 20)"
        className="transition-[stroke-dasharray] duration-500"
      />
      <text
        x="20"
        y="24"
        textAnchor="middle"
        fontSize="10"
        fontWeight="900"
        fill="var(--foreground)"
      >
        {percent}
      </text>
    </svg>
  );
}

function ProgramTile({
  program: p,
  open,
  onSelect,
  onRemove,
  onHover,
}: {
  program: ProgramProgress;
  open: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onHover: (on: boolean) => void;
}) {
  return (
    <div
      className={`group relative rounded-lg border bg-card/80 p-2.5 transition-colors ${open ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/60"}`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
        title={p.name}
      >
        <Ring percent={p.percent} />
        <span className="min-w-0">
          <span className="block text-[9px] font-bold uppercase text-muted-foreground">
            {KIND_LABELS[p.kind]}
          </span>
          <span className="block truncate text-sm font-extrabold leading-tight text-foreground">
            {shortName(p)}
          </span>
          <span className="block text-[10px] font-semibold text-muted-foreground">
            {p.met}/{p.checked} met{p.manual > 0 && ` · ${p.manual} ?`}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${p.name}`}
        className="absolute right-1 top-1 rounded p-0.5 text-muted-foreground opacity-0 hover:text-destructive focus:opacity-100 group-hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
      {p.overlap.length > 0 && (
        <span
          className="absolute bottom-1 right-1.5 text-[9px] font-bold text-primary"
          title={p.overlapNote}
        >
          overlap
        </span>
      )}
    </div>
  );
}

function ProgramDetail({ program: p, onClose }: { program: ProgramProgress; onClose: () => void }) {
  const sections = useMemo(() => {
    const groups: [string, RequirementProgress[]][] = [];
    for (const r of p.requirements) {
      const last = groups[groups.length - 1];
      if (last && last[0] === r.section) last[1].push(r);
      else groups.push([r.section, [r]]);
    }
    return groups;
  }, [p.requirements]);
  const left = p.requirements.filter((r) => r.status === "todo" || r.status === "partial").length;

  return (
    <div className="mt-3 rounded-lg border border-primary/50 bg-card/90 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase text-muted-foreground">
            {KIND_LABELS[p.kind]}
          </p>
          <p className="text-sm font-extrabold text-foreground">{p.name}</p>
          <p className="text-[11px] font-semibold text-muted-foreground">
            {p.percent}% · {p.met} of {p.checked} met · {left} to go
            {p.manual > 0 && ` · ${p.manual} to check yourself`}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
          aria-label="Close details"
        >
          <X />
        </Button>
      </div>
      {p.overlap.length > 0 && (
        <p className="mt-2 rounded-md bg-dust/60 px-2 py-1 text-[11px] font-semibold text-foreground">
          <span className="font-mono text-primary">{p.overlap.join(", ")}</span> — {p.overlapNote}
        </p>
      )}
      {p.notes && <p className="mt-2 text-[11px] font-semibold text-muted-foreground">{p.notes}</p>}
      <p className="mt-2 text-[10px] font-semibold text-muted-foreground">
        Tags: <span className="rounded bg-primary px-1 text-primary-foreground">planned</span>{" "}
        <span className="rounded border border-primary px-1 text-primary">in cart</span>{" "}
        <span className="rounded bg-dust px-1">option</span> · drag onto a term, click to add to
        cart, hover to spotlight
      </p>
      <div className="mt-2 max-h-[28rem] overflow-y-auto pr-1">
        {sections.map(([section, reqs], i) => (
          <div key={`${section}-${i}`} className="mb-3">
            {section && <p className="label-mono mb-1">{section}</p>}
            <ul className="space-y-1.5">
              {reqs.map((r, j) => (
                <RequirementLine key={j} req={r} />
              ))}
            </ul>
          </div>
        ))}
      </div>
      <a
        href={p.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
      >
        Official requirements <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

function RequirementLine({ req: r }: { req: RequirementProgress }) {
  const icon =
    r.status === "done" ? (
      <Check className="h-3.5 w-3.5 text-primary" />
    ) : r.status === "manual" ? (
      <CircleHelp className="h-3.5 w-3.5 text-muted-foreground" />
    ) : (
      <CircleDashed
        className={`h-3.5 w-3.5 ${r.status === "partial" ? "text-primary" : "text-muted-foreground/60"}`}
      />
    );
  // done: the courses that counted; otherwise the choices (credited ones first)
  const tags =
    r.status === "done"
      ? r.credited
      : [...new Set([...r.credited, ...r.options.slice(0, 10).flat()])];
  return (
    <li className="flex gap-2 text-xs">
      <span className="mt-0.5 shrink-0" title={r.status}>
        {icon}
      </span>
      <span className="min-w-0">
        <span
          className={
            r.status === "done"
              ? "font-semibold text-muted-foreground"
              : "font-semibold text-foreground"
          }
        >
          {r.label}
        </span>
        {r.status === "partial" && r.fraction !== null && (
          <span className="ml-1 font-bold text-primary">{Math.round(r.fraction * 100)}%</span>
        )}
        {r.status === "manual" && (
          <span className="ml-1 text-muted-foreground">(check yourself)</span>
        )}
        {tags.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1">
            {tags.map((id) => (
              <CourseTag key={id} id={id.replace("[J]", "")} />
            ))}
          </span>
        )}
      </span>
    </li>
  );
}

/** A course in a requirement: shows whether it's planned or in the cart; drag it onto a
 * term, click to add it to the cart, hover to spotlight it in the plan. */
function CourseTag({ id }: { id: string }) {
  const { plan, has, addToCart, removeFromCart, addNext, setHighlight } = usePlan();
  const planned = has(id);
  const inCart = plan.cart.includes(id);
  return (
    <span
      draggable
      onDragStart={(e) => e.dataTransfer.setData(DRAG_TYPE, id)}
      onMouseEnter={() => setHighlight([id])}
      onMouseLeave={() => setHighlight(null)}
      className={`inline-flex cursor-grab items-center overflow-hidden rounded font-mono text-[10px] font-bold ${
        planned
          ? "bg-primary text-primary-foreground"
          : inCart
            ? "border border-primary text-primary"
            : "bg-dust/80 text-foreground"
      }`}
    >
      <button
        type="button"
        className="px-1 py-0.5 hover:underline disabled:cursor-default"
        disabled={planned}
        onClick={() => (inCart ? removeFromCart(id) : addToCart([id]))}
        title={
          planned
            ? `${id} is in your plan`
            : inCart
              ? `Remove ${id} from cart`
              : `Add ${id} to cart`
        }
      >
        {id}
      </button>
      {!planned && (
        <button
          type="button"
          onClick={() => addNext(id)}
          className="border-l border-current/20 px-1 opacity-70 hover:opacity-100"
          title={`Put ${id} straight into the next open term (no cart)`}
          aria-label={`Add ${id} to your plan`}
        >
          + plan
        </button>
      )}
      <Link
        to="/courses/$courseId"
        params={{ courseId: id }}
        className="border-l border-current/20 px-0.5 opacity-70 hover:opacity-100"
        aria-label={`Open ${id}`}
      >
        ↗
      </Link>
    </span>
  );
}

function AddProgram({
  selected,
  onAdd,
  onClose,
}: {
  selected: string[];
  onAdd: (id: string) => void;
  onClose: () => void;
}) {
  const minors = selected.filter((id) => id.startsWith("minor:")).length;
  const [kind, setKind] = useState<ProgramKind>("major");
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<ProgramSummary[]>([]);

  useEffect(() => {
    let live = true;
    const t = setTimeout(
      () =>
        listPrograms(kind, q)
          .then((p) => live && setOptions(p))
          .catch(() => undefined),
      150,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [kind, q]);

  return (
    <div className="mt-3 rounded-lg border border-border bg-card/80 p-3">
      <div className="flex items-center gap-2">
        <div className="flex gap-1" role="radiogroup" aria-label="Program type">
          {(["major", "minor", "concentration"] as ProgramKind[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={`chip-option ${kind === k ? "chip-option-active" : ""}`}
            >
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-7 w-7"
          onClick={onClose}
          aria-label="Close"
        >
          <X />
        </Button>
      </div>
      <input
        className="field mt-2"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
        placeholder={kind === "major" ? "6-3, Economics, Biology…" : "Search by name"}
        aria-label="Search programs"
      />
      <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
        {options.map((o) => {
          const added = selected.includes(o.id);
          const blocked = o.kind === "minor" && minors >= 2 && !added;
          return (
            <button
              key={o.id}
              type="button"
              disabled={added || blocked}
              title={blocked ? "MIT allows at most two minors" : o.name}
              onClick={() => onAdd(o.id)}
              className="rounded-md border border-border bg-card px-2 py-1 text-xs font-semibold text-foreground hover:border-primary disabled:opacity-50"
            >
              {o.kind === "major" && o.code ? `${o.code} · ` : ""}
              {o.name
                .replace(/^Minor in /, "")
                .replace(/^HASS Concentration: /, "")
                .replace(/ \(Course [^)]*\)$/, "")}
              {added && " ✓"}
            </button>
          );
        })}
        {options.length === 0 && (
          <span className="text-xs font-semibold text-muted-foreground">No matches.</span>
        )}
      </div>
    </div>
  );
}
