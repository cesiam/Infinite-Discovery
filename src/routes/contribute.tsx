import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MessageSquareQuote, Wand2 } from "lucide-react";
import {
  addFingerprint,
  getFingerprints,
  type Fingerprint,
  createPost,
  POST_TYPES,
  similarPosts,
  type Post,
  type PostType,
} from "@/lib/api";
import { useUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { CoursePicker } from "@/components/CoursePicker";

export const Route = createFileRoute("/contribute")({
  head: () => ({
    meta: [
      { title: "Contribute — Infinite Discovery" },
      {
        name: "description",
        content: "Share a reflection on an MIT course or suggest a question for its fingerprint.",
      },
      { property: "og:title", content: "Contribute to Infinite Discovery" },
      {
        property: "og:description",
        content: "Help other MIT students by sharing what a course really taught you.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Contribute,
});

function Contribute() {
  const user = useUser();
  return (
    <main className="mx-auto max-w-7xl">
      <div className="glass rounded-3xl p-6 sm:p-8">
        <p className="label-mono">Contribute</p>
        <h1 className="mt-2 font-display text-4xl font-black tracking-tight text-foreground sm:text-5xl">
          Help the next student <span className="text-primary">choose well.</span>
        </h1>
        <p className="mt-3 max-w-2xl font-semibold text-muted-foreground">
          Posts appear under an anonymous pseudonym unique to each course. Not even professors can
          see who wrote what.
          {!user && " Sign in (top right) to contribute."}
        </p>
      </div>
      <div className="mt-6 grid gap-6 @4xl:grid-cols-2">
        <ReflectionForm disabled={!user} />
        <SuggestForm disabled={!user} />
      </div>
    </main>
  );
}

function FormCard({
  icon: Icon,
  title,
  sub,
  children,
  onSubmit,
}: {
  icon: typeof Wand2;
  title: string;
  sub: string;
  children: React.ReactNode;
  onSubmit: () => Promise<void>;
}) {
  return (
    <form
      className="glass space-y-5 rounded-3xl p-6 sm:p-8"
      onSubmit={async (e) => {
        e.preventDefault();
        await onSubmit();
      }}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h2 className="font-display text-2xl font-black text-foreground">{title}</h2>
          <p className="text-sm font-semibold text-muted-foreground">{sub}</p>
        </div>
      </div>
      {children}
    </form>
  );
}

function Result({ course, text }: { course: string; text: string }) {
  if (!text) return null;
  return (
    <span className="text-sm font-bold text-primary">
      {text}{" "}
      <Link to="/courses/$courseId" params={{ courseId: course }} className="underline">
        See {course}
      </Link>
    </span>
  );
}

function ReflectionForm({ disabled }: { disabled: boolean }) {
  const [course, setCourse] = useState("");
  const [type, setType] = useState<PostType>("Taught me");
  const [body, setBody] = useState("");
  const [similar, setSimilar] = useState<Post[]>([]);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!course || body.trim().length < 12) {
      setSimilar([]);
      return;
    }
    let live = true;
    const t = setTimeout(
      () =>
        similarPosts(course, body)
          .then((s) => {
            if (live) setSimilar(s.map((x) => x.post));
          })
          .catch(() => undefined),
      450,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [course, body]);

  return (
    <FormCard
      icon={MessageSquareQuote}
      title="Write a reflection"
      sub="What did this course actually teach you?"
      onSubmit={async () => {
        setError("");
        if (!course) {
          setError("Pick a course from the list.");
          return;
        }
        try {
          const { moderation } = await createPost(course, body.trim(), type);
          setBody("");
          setSimilar([]);
          setDone(
            moderation.action === "hold" ? "Held for a moderator to review." : "Posted. Thank you!",
          );
        } catch (err) {
          setError(err instanceof Error ? err.message : "Couldn't post.");
        }
      }}
    >
      <CoursePicker
        value={course}
        onChange={(v) => {
          setCourse(v);
          setDone("");
        }}
      />
      <div className="space-y-1.5">
        <span className="label-mono">Type</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Post type">
          {POST_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              onClick={() => setType(t)}
              className={`chip-option ${type === t ? "chip-option-active" : ""}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <label className="block space-y-1.5">
        <span className="label-mono">Your reflection</span>
        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setDone("");
          }}
          rows={6}
          required
          minLength={20}
          className="field"
          placeholder="This course helped me understand … because …"
        />
      </label>
      {similar.length > 0 && (
        <div className="rounded-xl border border-dashed border-primary/40 p-3">
          <p className="label-mono">Similar posts already there</p>
          <ul className="mt-2 space-y-1.5">
            {similar.map((p) => (
              <li key={p.id} className="text-sm font-semibold text-foreground">
                {p.body}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="text-sm font-bold text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={disabled}>
          Post reflection
        </Button>
        <Result course={course} text={done} />
      </div>
    </FormCard>
  );
}

function SuggestForm({ disabled }: { disabled: boolean }) {
  const [course, setCourse] = useState("");
  const [text, setText] = useState("");
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  return (
    <FormCard
      icon={Wand2}
      title="Add a fingerprint question"
      sub="A class objective: something you can answer once you've mastered the course. Check the existing ones first."
      onSubmit={async () => {
        setError("");
        if (!course) {
          setError("Pick a course from the list.");
          return;
        }
        try {
          const m = await addFingerprint(course, text.trim());
          setText("");
          setDone(m.action === "hold" ? "Sent for review." : "Added.");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Couldn't add that.");
        }
      }}
    >
      <CoursePicker
        value={course}
        onChange={(v) => {
          setCourse(v);
          setDone("");
        }}
      />
      {course && <ExistingFingerprints courseId={course} key={`${course}-${done}`} />}
      <label className="block space-y-1.5">
        <span className="label-mono">Your question</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          required
          minLength={10}
          className="field"
          placeholder="e.g. How can a POMDP be used to make decisions when the agent cannot observe the full state?"
        />
      </label>
      {error && <p className="text-sm font-bold text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="glass" disabled={disabled}>
          Add question
        </Button>
        <Result course={course} text={done} />
      </div>
    </FormCard>
  );
}

/** What's already there, so contributors improve or extend it instead of repeating it. */
function ExistingFingerprints({ courseId }: { courseId: string }) {
  const [items, setItems] = useState<Fingerprint[] | null>(null);
  useEffect(() => {
    getFingerprints(courseId)
      .then(setItems)
      .catch(() => setItems([]));
  }, [courseId]);
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <p className="label-mono">Existing fingerprints for {courseId}</p>
      {items === null ? (
        <p className="mt-2 text-sm font-semibold text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="mt-2 text-sm font-semibold text-muted-foreground">
          None yet. Yours will be the first.
        </p>
      ) : (
        <ol className="mt-2 space-y-1.5">
          {items.map((f, i) => (
            <li key={f.id} className="flex gap-2 text-sm">
              <span className="font-mono text-xs font-bold text-primary">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="font-semibold text-foreground">
                {f.question}
                <span className="ml-1.5 text-[11px] font-bold text-muted-foreground">
                  {f.lastEditor?.label}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2 text-[11px] font-semibold text-muted-foreground">
        To improve one of these, edit it on the{" "}
        <Link to="/courses/$courseId" params={{ courseId }} className="text-primary underline">
          course page
        </Link>{" "}
        so its history is kept.
      </p>
    </div>
  );
}
