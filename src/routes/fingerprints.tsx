import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { usePlan } from "@/lib/plan";
import { CoursePicker } from "@/components/CoursePicker";
import { FingerprintSection } from "@/components/course/FingerprintSection";

export const Route = createFileRoute("/fingerprints")({
  head: () => ({
    meta: [
      { title: "Fingerprints — Infinite Discovery" },
      {
        name: "description",
        content:
          "The questions you should be able to answer after each MIT course, written by students and professors.",
      },
      { property: "og:title", content: "Course fingerprints — Infinite Discovery" },
      { property: "og:description", content: "What you'll be able to answer after each course." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FingerprintsPage,
});

function FingerprintsPage() {
  const { plan, courses: planCourses } = usePlan();
  const planIds = useMemo(() => [...new Set(Object.values(plan.slots).flat())], [plan.slots]);
  const [other, setOther] = useState("");
  const courses = other && !planIds.includes(other) ? [other, ...planIds] : planIds;

  return (
    <main className="mx-auto max-w-7xl">
      <p className="label-mono">What you&apos;ll be able to answer</p>
      <h1 className="mt-3 font-display font-black text-foreground">
        Course <span className="text-primary">fingerprints.</span>
      </h1>
      <p className="mt-2 text-sm font-semibold text-muted-foreground">
        For every course in your plan: the questions you should be able to answer after taking it.
        Anyone signed in can edit them, and every edit is kept in the history.
      </p>
      <div className="mt-6 max-w-md">
        <CoursePicker label="Look up another course" value={other} onChange={setOther} />
      </div>

      <div className="mt-6 space-y-6">
        {courses.length === 0 && (
          <p className="rounded-lg border border-border bg-card/60 p-10 text-center font-semibold text-muted-foreground">
            Your plan is empty. Add courses to it, or look one up above.
          </p>
        )}
        {courses.map((id) => (
          <FingerprintSection
            key={id}
            courseId={id}
            eyebrow={id === other ? "Looked up" : "In your plan"}
            title={`${id} ${planCourses[id]?.title ?? ""}`.trim()}
          />
        ))}
      </div>
    </main>
  );
}
