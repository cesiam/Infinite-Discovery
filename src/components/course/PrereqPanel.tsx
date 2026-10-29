import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  getCourseGraph,
  suggestSoftPrereq,
  type CourseDetail,
  type CourseGraph,
  type Prereq,
} from "@/lib/api";
import { useUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { CoursePicker } from "@/components/CoursePicker";

const CourseLink = ({ id, title }: { id: string; title?: string | undefined }) => (
  <Link
    to="/courses/$courseId"
    params={{ courseId: id }}
    className="block rounded-lg px-2 py-1 hover:bg-card"
  >
    <span className="font-mono text-xs font-bold text-primary">{id}</span>
    {title && <span className="ml-1.5 text-xs font-semibold text-foreground">{title}</span>}
  </Link>
);

/** Prerequisites (hard from the catalog, soft from students) and where this course leads. */
export function PrereqPanel({ course }: { course: CourseDetail }) {
  const user = useUser();
  const [prereqs, setPrereqs] = useState<Prereq[]>(course.prereqs);
  const [graph, setGraph] = useState<CourseGraph | null>(null);
  const [suggestion, setSuggestion] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setPrereqs(course.prereqs);
  }, [course]);
  useEffect(() => {
    getCourseGraph(course.id)
      .then(setGraph)
      .catch(() => setGraph(null));
  }, [course.id]);

  const titles = Object.fromEntries((graph?.nodes ?? []).map((n) => [n.id, n.title]));
  const unlocks = [
    ...new Set((graph?.edges ?? []).filter((e) => e.source === course.id).map((e) => e.target)),
  ].sort();

  return (
    <aside className="space-y-6 @4xl:sticky @4xl:top-6">
      <section className="glass rounded-3xl p-6">
        <p className="label-mono">Before you enroll</p>
        <h3 className="mt-1 font-display text-xl font-black text-foreground">Prerequisites</h3>
        {course.prereqText && !/^none\.?$/i.test(course.prereqText.trim()) && (
          <p className="mt-2 text-xs font-semibold text-muted-foreground">
            Catalog: {course.prereqText.replace(/<[^>]+>/g, "")}
          </p>
        )}
        {prereqs.length === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">No subject prerequisites.</p>
        )}
        <ul className="mt-4 space-y-2">
          {prereqs.map((p) => (
            <li key={`${p.code}-${p.kind}`} className="rounded-xl bg-card/60 p-2">
              <div className="flex items-center justify-between gap-2">
                <CourseLink id={p.code} title={p.title} />
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${p.kind === "hard" ? "bg-primary text-primary-foreground" : "bg-dust text-foreground"}`}
                >
                  {p.kind}
                </span>
              </div>
              {p.kind === "soft" && p.support !== null && (
                <p className="px-2 text-[11px] font-semibold text-muted-foreground">
                  Suggested by {p.support} {p.support === 1 ? "person" : "people"}
                </p>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs font-semibold text-muted-foreground">
          <b className="text-primary">Hard</b> = required by the catalog.{" "}
          <b className="text-foreground">Soft</b> = students say it helps.
        </p>

        {user && user.role !== "admin" && (
          <form
            className="mt-4 space-y-2 border-t border-border pt-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!suggestion) {
                setMessage("Pick a course from the list.");
                return;
              }
              try {
                setPrereqs(await suggestSoftPrereq(course.id, suggestion, note));
                setMessage("Thanks, added.");
                setNote("");
              } catch (err) {
                setMessage(err instanceof Error ? err.message : "Couldn't add that.");
              }
            }}
          >
            <CoursePicker
              label="Suggest a soft prereq"
              value={suggestion}
              onChange={setSuggestion}
            />
            <input
              className="field"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why it helps (optional)"
              aria-label="Why it helps"
            />
            <Button type="submit" size="sm" variant="glass">
              Suggest
            </Button>
            {message && <p className="text-xs font-bold text-primary">{message}</p>}
          </form>
        )}
      </section>

      <section className="glass rounded-3xl p-6">
        <p className="label-mono">Prerequisite map</p>
        <h3 className="mt-1 font-display text-xl font-black text-foreground">Where it leads</h3>
        {graph === null ? (
          <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
        ) : unlocks.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No catalog course lists {course.number} as a prerequisite.
          </p>
        ) : (
          <>
            <p className="mt-2 text-xs font-semibold text-muted-foreground">
              {unlocks.length} {unlocks.length === 1 ? "course lists" : "courses list"}{" "}
              {course.number} as a prerequisite:
            </p>
            <div className="mt-2 max-h-72 overflow-y-auto">
              {unlocks.map((id) => (
                <CourseLink key={id} id={id} title={titles[id]} />
              ))}
            </div>
          </>
        )}
      </section>
    </aside>
  );
}
