import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowUpRight, Search, SlidersHorizontal } from "lucide-react";
import {
  apiUnreachable,
  DEPARTMENTS,
  getRequiredCourses,
  listPrograms,
  type ProgramSummary,
  exploreCourses,
  searchCourses,
  SEASONS,
  type SearchFilters,
  type SearchResult,
} from "@/lib/api";
import { useTypingPlaceholder } from "@/components/TypingSearch";
import { SourceBadge } from "@/components/SourceBadge";
import { DRAG_TYPE } from "@/lib/dnd";
import { AddToCartButton } from "@/components/Cart";
import { AddToPlanButton } from "@/components/AddToPlanButton";
import { Button } from "@/components/ui/button";
import { usePlan } from "@/lib/plan";

export const Route = createFileRoute("/")({
  // plan=1 opens the planner beside search; without it, "/" is the opening screen.
  validateSearch: (search: Record<string, unknown>): { plan?: 1 } =>
    search["plan"] ? { plan: 1 } : {},
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
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilters>({});
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
    setFilters((f) => ({ ...f, [k]: v ? (k === "units" ? Number(v) : v) : undefined }));

  const searchPanel = (
    <section className="search-section">
      <p className="label-mono">A little curiosity goes a long way</p>
      <h1 className="mt-3 font-display font-black text-foreground">
        What do you want to <span className="text-primary">learn?</span>
      </h1>
      <div className="relative mt-7">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-primary" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="field !rounded-lg !py-4 !pl-12 !text-sm"
          aria-label="What do you want to learn?"
        />
      </div>
      <p className="mt-6 flex items-center gap-2 text-xs font-bold text-muted-foreground">
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Refine your search
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 @xl:grid-cols-3">
        <label className="space-y-1.5">
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
        <label className="space-y-1.5">
          <span className="label-mono">Units</span>
          <select className="field" onChange={(e) => set("units", e.target.value)}>
            <option value="">Any</option>
            {[3, 6, 9, 12, 15].map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="label-mono">Term</span>
          <select className="field" onChange={(e) => set("term", e.target.value)}>
            <option value="">Any</option>
            {SEASONS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );

  const resultsList = (
    <section className="mt-7 border-t border-border pt-5">
      <Bundles query={query} />
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-base font-extrabold text-foreground">
          {query.trim() ? "Search results" : "Explore courses students are discussing"}
        </h2>
        {results && (
          <p className="text-sm font-bold text-muted-foreground">
            {results.length} course{results.length === 1 ? "" : "s"}
          </p>
        )}
      </div>
      <div className="divide-y divide-border rounded-lg border border-border bg-card/60">
        {error && <p className="p-10 text-center font-bold text-destructive">{error}</p>}
        {!error && results?.length === 0 && (
          <p className="p-10 text-center font-bold text-muted-foreground">
            No courses match. Try other words or fewer filters.
          </p>
        )}
        {!error &&
          results?.map(({ course, matched, snippet }) => (
            <Link
              key={course.id}
              to="/courses/$courseId"
              params={{ courseId: course.id }}
              draggable
              onDragStart={(e) => e.dataTransfer.setData(DRAG_TYPE, course.id)}
              className="group block p-4 transition-colors hover:bg-accent/40 sm:p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs font-bold text-primary">
                      {course.number}
                    </span>
                    <span className="text-[11px] font-semibold text-muted-foreground">
                      {[course.unitsTotal && `${course.unitsTotal} units`, course.terms.join(" / ")]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  <h3 className="mt-1 font-display text-base font-extrabold leading-tight text-foreground">
                    {course.title}
                  </h3>
                </div>
                <span className="flex shrink-0 items-center gap-2">
                  <AddToPlanButton courseId={course.id} size="icon" />
                  <AddToCartButton courseId={course.id} size="icon" />
                  <ArrowUpRight className="h-5 w-5 text-muted-foreground transition group-hover:text-primary" />
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{snippet}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {matched.map((m) => (
                  <SourceBadge key={m} source={m} />
                ))}
              </div>
            </Link>
          ))}
      </div>
    </section>
  );

  return (
    <main className="mx-auto max-w-7xl">
      {searchPanel}
      {resultsList}
    </main>
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
