import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Search, ShoppingCart } from "lucide-react";
import {
  apiUnreachable,
  DEPARTMENTS,
  getRequiredCourses,
  listPrograms,
  type ProgramSummary,
  exploreCourses,
  searchCourses,
  SEASONS,
  type Season,
  type SearchFilters,
  type SearchResult,
} from "@/lib/api";
import { useTypingPlaceholder } from "@/components/TypingSearch";
import { SourceBadge } from "@/components/SourceBadge";
import { DRAG_TYPE } from "@/lib/dnd";
import { AddToPlanButton } from "@/components/AddToPlanButton";
import { Button } from "@/components/ui/button";
import { seasonYear, usePlan } from "@/lib/plan";
import { girTags } from "@/lib/blocks";

export const Route = createFileRoute("/")({
  // plan=1 opens the planner beside search; without it, "/" is the opening screen.
  // q starts the search with that text (from the opening screen's search box).
  validateSearch: (search: Record<string, unknown>): { plan?: 1; q?: string } => ({
    ...(search["plan"] ? { plan: 1 as const } : {}),
    ...(typeof search["q"] === "string" ? { q: search["q"] } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Infinite Discovery — Search MIT courses by what they teach" },
      {
        name: "description",
        content:
          "Find MIT undergraduate courses by what they actually teach and what past students experienced.",
      },
      { property: "og:title", content: "Infinite Discovery" },
      {
        property: "og:description",
        content: "Search MIT courses by learning outcomes and student reflections.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SearchPage,
});

function SearchPage() {
  const placeholder = useTypingPlaceholder();
  const { q } = Route.useSearch();
  const [query, setQuery] = useState(q ?? "");
  useEffect(() => setQuery(q ?? ""), [q]);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [countsFor, setCountsFor] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    const t = setTimeout(
      () => {
        // Before anyone types, show the courses students are discussing.
        (query.trim() ? searchCourses(query, filters) : exploreCourses())
          .then((r) => {
            if (live) {
              setResults(r);
              setError("");
            }
          })
          .catch(() => {
            if (live) setError(apiUnreachable());
          });
      },
      query.trim() ? 250 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, filters]);

  const set = (k: keyof SearchFilters, v: string) =>
    setFilters((f) => ({ ...f, [k]: v || undefined }));
  // "Counts for" is checked here, against the GIR tags on each result's units line
  const shown = results?.filter((r) => !countsFor || girTags(r.course.units).includes(countsFor));

  return (
    <main className="find">
      <p className="label-mono">A little curiosity goes a long way</p>
      <h1 className="find-title">
        What do you
        <br />
        want to <span>learn?</span>
      </h1>
      <div className="find-search">
        <Search aria-hidden />
        <input
          id="course-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          aria-label="What do you want to learn?"
        />
      </div>
      <div className="find-filters">
        <label>
          <span className="label-mono">Department</span>
          <select className="field" onChange={(e) => set("department", e.target.value)}>
            <option value="">All</option>
            {DEPARTMENTS.map((d) => (
              <option key={d.code} value={d.code}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label-mono">Counts for</span>
          <select
            className="field"
            value={countsFor}
            onChange={(e) => setCountsFor(e.target.value)}
          >
            <option value="">Anything</option>
            {GIR_TAGS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="label-mono">Term</span>
          <select className="field" onChange={(e) => set("term", e.target.value)}>
            <option value="">Any</option>
            {SEASONS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>

      <Bundles query={query} />
      <p className="find-count">
        {shown
          ? `${shown.length} class${shown.length === 1 ? "" : "es"}${query.trim() ? "" : " students are discussing"}`
          : "Loading…"}
      </p>
      {error && <p className="find-empty text-destructive">{error}</p>}
      {!error && shown?.length === 0 && (
        <p className="find-empty">No classes match. Try other words or fewer filters.</p>
      )}
      <ul className="find-list">
        {!error &&
          shown?.map((r) => (
            <li key={r.course.id}>
              <FindCard result={r} showSnippet={!!query.trim()} />
            </li>
          ))}
      </ul>
      <p className="find-note">
        From the MIT Subject Listing. Check units, prerequisites and requirement tags there before
        relying on them.
      </p>
    </main>
  );
}

const GIR_TAGS = [
  "Calc I",
  "Calc II",
  "Phys I",
  "Phys II",
  "Chem",
  "Bio",
  "REST",
  "Lab",
  "HASS-A",
  "HASS-H",
  "HASS-S",
  "CI-H",
];

/** A class in the results: where it stands in your plan, and buttons to cart or place it. */
function FindCard({ result: r, showSnippet }: { result: SearchResult; showSnippet: boolean }) {
  const { plan, addToCart, removeFromCart } = usePlan();
  const c = r.course;
  const key = Object.entries(plan.slots).find(([, ids]) => ids.includes(c.id))?.[0];
  const credit = plan.credit.includes(c.id);
  const inCart = plan.cart.includes(c.id);
  const [y, season] = (key?.split("-") ?? []) as [string, Season];
  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <Link
      to="/courses/$courseId"
      params={{ courseId: c.id }}
      draggable
      onDragStart={(e) => e.dataTransfer.setData(DRAG_TYPE, c.id)}
      className="find-card"
    >
      <div className="find-card-top">
        <span className="find-num">{c.number}</span>
        {c.unitsTotal != null && <span className="find-units">{c.unitsTotal} units</span>}
        <span className="find-status">
          {credit ? (
            <span className="find-done">
              <Check /> Prior credit
            </span>
          ) : key ? (
            <span className="find-done">
              <Check /> {season} {seasonYear(Number(y), season)}
            </span>
          ) : (
            <>
              <button
                type="button"
                className={`find-cart ${inCart ? "find-cart-on" : ""}`}
                onClick={(e) => {
                  stop(e);
                  if (inCart) removeFromCart(c.id);
                  else addToCart([c.id]);
                }}
                aria-pressed={inCart}
                aria-label={inCart ? `Remove ${c.id} from cart` : `Add ${c.id} to cart`}
              >
                <ShoppingCart />
                {inCart ? "In cart" : "Cart"}
              </button>
              <AddToPlanButton courseId={c.id} label="Place" className="find-place" />
            </>
          )}
        </span>
      </div>
      <h3 className="find-name">{c.title}</h3>
      {showSnippet && r.snippet && <p className="find-snippet">{r.snippet}</p>}
      <div className="find-tags">
        {girTags(c.units).map((t) => (
          <span key={t} className="find-tag find-tag-gir">
            {t}
          </span>
        ))}
        {c.terms.length > 0 && <span className="find-tag">{c.terms.join(" · ")}</span>}
        {showSnippet && r.matched.map((m) => <SourceBadge key={m} source={m} />)}
      </div>
    </Link>
  );
}

/** Programs matching the search ("12", "GIR", "Economics minor"): add one as a bundle with
 * its own progress bar, and its required classes go to the cart. */
function Bundles({ query }: { query: string }) {
  const { plan, addProgram, addToCart } = usePlan();
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [added, setAdded] = useState("");

  useEffect(() => {
    const q = query.trim().replace(/^course\s+/i, "");
    if (q.length < 2) return setPrograms([]);
    let live = true;
    const t = setTimeout(async () => {
      const gir = /^(gir|general institute)/i.test(q);
      const found = gir ? await listPrograms("gir") : await listPrograms(undefined, q);
      if (live) setPrograms(found.slice(0, 4));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  if (!programs.length) return null;
  return (
    <div className="mb-5">
      <h2 className="text-base font-extrabold text-foreground">Requirement bundles</h2>
      <p className="text-xs font-semibold text-muted-foreground">
        Add a program to track it with its own progress bar. Its required classes go to your cart.
      </p>
      <ul className="mt-2 space-y-2">
        {programs.map((p) => {
          const tracked = plan.programs.includes(p.id);
          return (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/60 px-3 py-2"
            >
              <span className="min-w-0">
                <span className="mr-2 rounded bg-dust px-1.5 py-0.5 text-[10px] font-bold uppercase">
                  {p.kind === "gir" ? "Institute" : p.kind}
                </span>
                <span className="text-sm font-bold text-foreground">{p.name}</span>
              </span>
              <Button
                size="sm"
                variant={tracked ? "outline" : "default"}
                disabled={tracked && added !== p.id}
                onClick={async () => {
                  addProgram(p.id);
                  addToCart(await getRequiredCourses(p.id));
                  setAdded(p.id);
                }}
              >
                {added === p.id ? "Added · classes in cart" : tracked ? "Tracking" : "Add bundle"}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
