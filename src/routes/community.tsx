import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowUpRight, MessageCircle, Sparkles } from "lucide-react";
import { getCommunity, type PostType } from "@/lib/api";
import { Button } from "@/components/ui/button";

const communityQuery = queryOptions({ queryKey: ["community"], queryFn: getCommunity });
export const Route = createFileRoute("/community")({
  loader: ({ context }) => context.queryClient.ensureQueryData(communityQuery),
  head: () => ({
    meta: [
      { title: "Community — Infinite Discovery" },
      {
        name: "description",
        content:
          "Explore MIT courses through curious questions, student perspectives and new connections.",
      },
      { property: "og:title", content: "MIT course community — Infinite Discovery" },
      {
        property: "og:description",
        content: "Find your next course through trending questions and student curiosity.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CommunityPage,
});

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function CommunityPage() {
  const { data } = useSuspenseQuery(communityQuery);
  const [tab, setTab] = useState<"questions" | "courses">("questions");
  return (
    <main>
      <p className="label-mono">The campus conversation · questions students asked</p>
      <h1 className="mt-3 font-black">
        Curiosity is <span className="text-primary">contagious.</span>
      </h1>
      <div className="mt-6 flex gap-2" role="tablist" aria-label="Community views">
        <Button
          role="tab"
          aria-selected={tab === "questions"}
          variant={tab === "questions" ? "default" : "outline"}
          onClick={() => setTab("questions")}
        >
          <MessageCircle />
          Trending questions
        </Button>
        <Button
          role="tab"
          aria-selected={tab === "courses"}
          variant={tab === "courses" ? "default" : "outline"}
          onClick={() => setTab("courses")}
        >
          <Sparkles />
          Courses
        </Button>
      </div>

      {tab === "questions" ? (
        <div className="mt-6 space-y-3">
          {data.questions.length === 0 && (
            <p className="community-item text-sm font-semibold text-muted-foreground">
              No questions yet. Ask one on any course page.
            </p>
          )}
          {data.questions.map((q) => (
            <article key={q.post.id} className="community-item">
              <p className="label-mono text-primary">
                {q.courseId} · {q.courseTitle}
              </p>
              {/* opens the course's discussion at this question: replies, voting, replying */}
              <Link
                to="/courses/$courseId"
                params={{ courseId: q.courseId }}
                hash={`post-${q.post.id}`}
                className="question-toggle mt-2 hover:text-primary"
              >
                {q.post.body}
                <ArrowUpRight className="h-5 w-5 shrink-0" />
              </Link>
              <p className="mt-3 flex items-center gap-2 text-xs font-bold text-muted-foreground">
                <MessageCircle className="h-3 w-3" />
                {plural(q.repliesCount, "reply")} · {plural(q.post.score, "vote")} · {q.post.author}{" "}
                · <span className="text-primary">Open the discussion to reply and vote</span>
              </p>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {data.courses.map((c) => (
            <Link
              key={c.id}
              to="/courses/$courseId"
              params={{ courseId: c.id }}
              className="community-item block"
            >
              <div className="flex justify-between gap-3">
                <span className="font-mono text-xs font-bold text-primary">{c.number}</span>
                <ArrowUpRight className="h-4 w-4" />
              </div>
              <h2 className="mt-2 text-lg font-extrabold">{c.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{c.description.slice(0, 130)}…</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {(Object.entries(c.postCounts) as [PostType, number][]).map(([type, n]) => (
                  <span key={type} className="course-interest-label">
                    {n} × {type}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}

      <section className="mt-7 border-t border-border pt-5">
        <p className="label-mono">A question for you</p>
        <h2 className="mt-2 text-lg font-extrabold">
          What would you love to make, understand, or change?
        </h2>
        <Link
          to="/"
          search={{ plan: 1 }}
          className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-primary"
        >
          Find your next course
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </section>
    </main>
  );
}
