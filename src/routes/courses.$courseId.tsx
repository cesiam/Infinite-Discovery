import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { getCourse } from "@/lib/api";
import { AddToCartButton } from "@/components/Cart";
import { AddToPlanButton } from "@/components/AddToPlanButton";
import { Discussion } from "@/components/course/Discussion";
import { FingerprintSection } from "@/components/course/FingerprintSection";
import { Heading } from "@/components/course/Heading";
import { PrereqPanel } from "@/components/course/PrereqPanel";

export const Route = createFileRoute("/courses/$courseId")({
  loader: async ({ params }) => {
    const course = await getCourse(params.courseId);
    if (!course) throw notFound();
    return { course };
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.course.number} ${loaderData.course.title} — Infinite Discovery` },
          { name: "description", content: loaderData.course.description.slice(0, 155) },
          {
            property: "og:title",
            content: `${loaderData.course.number} ${loaderData.course.title}`,
          },
          { property: "og:description", content: loaderData.course.description.slice(0, 155) },
          { property: "og:type", content: "website" },
          { name: "twitter:card", content: "summary_large_image" },
        ]
      : [{ title: "Course unavailable" }, { name: "robots", content: "noindex" }],
  }),
  component: CoursePage,
});

function CoursePage() {
  const { course } = Route.useLoaderData();
  const chips = [
    `Course ${course.department}`,
    course.unitsTotal ? `${course.unitsTotal} units` : course.units,
    course.terms.length ? course.terms.join(" · ") : "Not offered this year",
  ].filter(Boolean);

  return (
    <main className="mx-auto max-w-7xl">
      <Link
        to="/"
        search={{ plan: 1 }}
        className="inline-flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to search
      </Link>

      <header className="glass mt-4 rounded-3xl p-6 sm:p-8">
        <span className="font-mono text-base font-bold text-primary">{course.number}</span>
        <h1 className="mt-1 font-display text-4xl font-black leading-none tracking-tight text-foreground sm:text-5xl">
          {course.title}
        </h1>
        <div className="mt-4 flex flex-wrap gap-2">
          {chips.map((t) => (
            <span
              key={t}
              className="rounded-full bg-card/70 px-3 py-1 text-xs font-bold text-foreground"
            >
              {t}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <AddToPlanButton courseId={course.id} />
          <AddToCartButton courseId={course.id} />
        </div>
      </header>

      <div className="mt-6 grid items-start gap-6 @4xl:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-6">
          <section className="glass space-y-4 rounded-3xl p-6 sm:p-8">
            <Heading n="01 · Official, read-only" title="Catalog Description" />
            <p className="border-l-4 border-khaki pl-4 text-[15px] leading-relaxed text-foreground">
              {course.description}
            </p>
            {Object.keys(course.instructors).length > 0 && (
              <p className="text-xs font-bold text-muted-foreground">
                Instructors: {Object.values(course.instructors).join(" · ")}
              </p>
            )}
          </section>

          <FingerprintSection courseId={course.id} />
          <Discussion courseId={course.id} />
        </div>

        <PrereqPanel course={course} />
      </div>
    </main>
  );
}
