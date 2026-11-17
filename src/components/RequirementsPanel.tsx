import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Check,
  CircleDashed,
  CircleHelp,
  ExternalLink,
  GripVertical,
  PanelRight,
  PanelTop,
  Plus,
  X,
} from "lucide-react";
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
import { DRAG_TYPE, PANEL_DRAG_TYPE } from "@/lib/dnd";
import { setRequirementsDock, type Dock } from "@/lib/dock";
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

type Spotlight = { label: string; ids: string[] };

/** Requirements grouped the way the degree charts group them ("Science core", "HASS"). */
function sections(p: ProgramProgress) {
  const groups: [string, RequirementProgress[]][] = [];
  for (const r of p.requirements) {
    const last = groups[groups.length - 1];
    if (last && last[0] === r.section) last[1].push(r);
    else groups.push([r.section, [r]]);
  }
  return groups;
}

/**
 * Progress toward the student's programs, from MIT's official requirements. Each program is
 * a card; hovering a row or a card spotlights its classes in the plan, clicking keeps the
 * spotlight on. A program's full checklist opens below the cards.
 */
/** Moves the requirements between the plan and the side panel: drag it across, or click. */
function useMoveRequirements() {
  const navigate = useNavigate();
  return (to: Dock) => {
    setRequirementsDock(to);
    if (to === "side") void navigate({ to: "/requirements" });
    else void navigate({ to: "/", search: { plan: 1 } });
  };
}

function DockHandle({ dock }: { dock: Dock }) {
  const move = useMoveRequirements();
  const to: Dock = dock === "plan" ? "side" : "plan";
  const label = to === "side" ? "Move to the side panel" : "Move back above the plan";
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(PANEL_DRAG_TYPE, to);
        e.dataTransfer.effectAllowed = "move";
        document.body.classList.add("dragging-panel");
      }}
      onDragEnd={() => document.body.classList.remove("dragging-panel")}
      onClick={() => move(to)}
      className="dock-handle"
      title={`${label} (drag or click)`}
    >
      <GripVertical />
      {to === "side" ? <PanelRight /> : <PanelTop />}
      <span>{to === "side" ? "Move to side" : "Move above plan"}</span>
    </button>
  );
}

export function RequirementsPanel({ dock }: { dock: Dock }) {
  const { plan, addProgram, removeProgram, setHighlight } = usePlan();
  const courses = useMemo(
    () => [...new Set([...Object.values(plan.slots).flat(), ...plan.credit])].sort(),
    [plan.slots, plan.credit],
  );
  const [progress, setProgress] = useState<ProgramProgress[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [pinned, setPinned] = useState<Spotlight | null>(null);

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

  // leaving the tab takes its spotlight off the plan
  useEffect(() => () => setHighlight(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  // hovering shows a spotlight for a moment; clicking pins it until clicked again
  const spot = {
    hover: (s: Spotlight | null) => setHighlight(s ? s.ids : (pinned?.ids ?? null)),
    toggle: (s: Spotlight) => {
      const same = pinned?.label === s.label;
      setPinned(same ? null : s);
      setHighlight(same ? null : s.ids);
    },
    pinned: pinned?.label ?? null,
  };
  const selected = progress?.find((p) => p.id === open) ?? null;

  return (
    <section aria-label="Degree requirements">
      <div className="plan-card-head">
        {dock === "plan" && <p className="label-mono">Requirements</p>}
        <p className="plan-card-hint mr-auto">
          Hover or select a row to spotlight the classes that count toward it.
        </p>
        <DockHandle dock={dock} />
      </div>
      {error && <p className="mb-2 text-xs font-bold text-destructive">{error}</p>}

      <Masonry
        items={[
          ...(progress ?? []).map((p) => ({
            key: p.id,
            rows: sections(p).length,
            node:
              p.kind === "gir" ? (
                <GirCard
                  program={p}
                  spot={spot}
                  open={open === p.id}
                  onOpen={() => setOpen(open === p.id ? null : p.id)}
                />
              ) : (
                <ProgramCard
                  program={p}
                  spot={spot}
                  open={open === p.id}
                  onOpen={() => setOpen(open === p.id ? null : p.id)}
                  onRemove={() => {
                    if (open === p.id) setOpen(null);
                    removeProgram(p.id);
                  }}
                />
              ),
          })),
          {
            key: "add",
            rows: 1,
            node: (
              <button
                type="button"
                onClick={() => setAdding((a) => !a)}
                aria-expanded={adding}
                className="req-add"
              >
                <Plus />
                Add major, minor or concentration
              </button>
            ),
          },
        ]}
      />
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

const COLUMN_MIN = 250; // px: as many columns as fit at least this wide
const GAP = 12;

/**
 * The cards packed like a masonry wall: each goes into whichever column is shortest so far,
 * so a short card (the GIRs) gets another one stacked under it instead of leaving a gap.
 * Heights are estimated from each card's number of requirement rows.
 */
function Masonry({ items }: { items: { key: string; rows: number; node: ReactNode }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setCount(Math.max(1, Math.floor((el.clientWidth + GAP) / (COLUMN_MIN + GAP))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const columns: (typeof items)[] = Array.from({ length: count }, () => []);
  const heights = new Array<number>(count).fill(0);
  for (const item of items) {
    const i = heights.indexOf(Math.min(...heights));
    columns[i]!.push(item);
    heights[i]! += 110 + item.rows * 50 + GAP; // card head + a row per section
  }
  return (
    <div
      ref={ref}
      className="req-cards"
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      {columns.map((col, i) => (
        <div key={i} className="req-col">
          {col.map((item) => (
            <div key={item.key}>{item.node}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

type SpotProps = {
  hover: (s: Spotlight | null) => void;
  toggle: (s: Spotlight) => void;
  pinned: string | null;
};

function Ring({ percent, label }: { percent: number; label: string }) {
  const r = 19;
  const c = 2 * Math.PI * r;
  return (
    <svg
      className="req-ring"
      width="50"
      height="50"
      viewBox="0 0 50 50"
      role="progressbar"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <circle className="req-ring-bg" cx="25" cy="25" r={r} strokeWidth="5" />
      <circle
        cx="25"
        cy="25"
        r={r}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${(percent / 100) * c} ${c}`}
        transform="rotate(-90 25 25)"
        className="transition-[stroke-dasharray] duration-500"
      />
      <text x="25" y="30" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor">
        {percent}
      </text>
    </svg>
  );
}

function CardHead({
  program: p,
  open,
  onOpen,
}: {
  program: ProgramProgress;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="req-head"
      onClick={onOpen}
      aria-expanded={open}
      title={`${p.name}: show the full checklist`}
    >
      <Ring percent={p.percent} label={`${p.name}: ${p.percent}%`} />
      <span className="min-w-0">
        <span className="req-kind">
          {KIND_LABELS[p.kind]}
          {p.kind === "major" && p.code && ` · Course ${p.code}`}
        </span>
        <span className="req-name">{shortName(p)}</span>
        <span className="req-meta">
          {p.met} of {p.checked} requirements met
          {p.manual > 0 && ` · ${p.manual} to check`}
        </span>
      </span>
    </button>
  );
}

/** A bar per section of the degree chart ("Science core", "Data-centric"), one segment per
 * requirement; hover or click a row to spotlight the classes that count toward it. */
function SectionRows({ program: p, spot }: { program: ProgramProgress; spot: SpotProps }) {
  return (
    <ul className="req-rows">
      {sections(p).map(([section, reqs], i) => {
        const done = reqs.filter((r) => r.status === "done").length;
        const s = { label: `${p.id}:${section}:${i}`, ids: reqs.flatMap((r) => r.credited) };
        return (
          <li key={`${section}-${i}`}>
            <button
              type="button"
              className={`req-row ${spot.pinned === s.label ? "req-row-on" : ""}`}
              onMouseEnter={() => spot.hover(s)}
              onMouseLeave={() => spot.hover(null)}
              onClick={() => spot.toggle(s)}
              aria-pressed={spot.pinned === s.label}
              title={reqs.map((r) => `${r.label}: ${r.status}`).join("\n")}
            >
              <span className="req-row-label">
                {section || "Other"}
                <span>
                  {done}/{reqs.length}
                </span>
              </span>
              <span className="segs">
                {reqs.map((r, j) => (
                  <span key={j} className="seg">
                    <span
                      style={{
                        width: `${(r.status === "done" ? 1 : (r.fraction ?? 0)) * 100}%`,
                      }}
                    />
                  </span>
                ))}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The GIRs: a bar per section of the chart. */
function GirCard({
  program: p,
  spot,
  open,
  onOpen,
}: {
  program: ProgramProgress;
  spot: SpotProps;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <div className={`req-card req-gir ${open ? "req-open" : ""}`}>
      <CardHead program={p} open={open} onOpen={onOpen} />
      <SectionRows program={p} spot={spot} />
    </div>
  );
}

/** A major, minor or concentration: its requirement sections, like the GIRs. */
function ProgramCard({
  program: p,
  spot,
  open,
  onOpen,
  onRemove,
}: {
  program: ProgramProgress;
  spot: SpotProps;
  open: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  return (
    <div className={`req-card ${open ? "req-open" : ""}`}>
      <div className="flex items-start gap-2">
        <CardHead program={p} open={open} onOpen={onOpen} />
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${p.name}`}
          className="ml-auto rounded-md p-1 text-muted-foreground hover:text-destructive"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <SectionRows program={p} spot={spot} />
    </div>
  );
}

function ProgramDetail({ program: p, onClose }: { program: ProgramProgress; onClose: () => void }) {
  const grouped = useMemo(() => sections(p), [p]);
  const left = p.requirements.filter((r) => r.status === "todo" || r.status === "partial").length;

  return (
    <div className="req-detail">
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
        cart, + plan / − plan to place or take back, hover to spotlight
      </p>
      <div className="mt-2 max-h-[28rem] overflow-y-auto pr-1">
        {grouped.map(([section, reqs], i) => (
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
  const { plan, has, addToCart, removeFromCart, addNext, remove, removeCredit, setHighlight } =
    usePlan();
  const planned = has(id);
  const credit = plan.credit.includes(id);
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
      {planned ? (
        <button
          type="button"
          onClick={() => (credit ? removeCredit(id) : remove(id))}
          className="border-l border-current/20 px-1 opacity-70 hover:opacity-100"
          title={credit ? `Remove ${id} from prior credit` : `Take ${id} back out of your plan`}
          aria-label={`Remove ${id} from your plan`}
        >
          − plan
        </button>
      ) : (
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
    <div className="req-detail">
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
