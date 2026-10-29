import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, CornerDownRight } from "lucide-react";
import {
  createPost,
  getPosts,
  POST_TYPES,
  similarPosts,
  vote,
  type Post,
  type PostType,
} from "@/lib/api";
import { useUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Heading } from "./Heading";

const TYPE_STYLES: Record<PostType, string> = {
  "Taught me": "bg-primary text-primary-foreground",
  "Wish I knew": "bg-cyan text-accent-foreground",
  Question: "bg-dust text-foreground",
};

const MODERATION_NOTES = {
  publish: "",
  flag: "Posted. It's also been sent to a moderator to look at.",
  hold: "Held for review: a moderator will publish it. Only you can see it until then.",
};

/** Student reflections and questions. Everyone shows as a per-course pseudonym. */
export function Discussion({ courseId }: { courseId: string }) {
  const user = useUser();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [sort, setSort] = useState<"top" | "new">("top");
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      getPosts(courseId, sort)
        .then(setPosts)
        .catch(() => setPosts([])),
    [courseId, sort],
  );
  useEffect(() => {
    void load();
  }, [load, user]);

  // Arriving from Community at #post-<id>: bring that thread into view and highlight it.
  const [linked, setLinked] = useState<number | null>(null);
  useEffect(() => {
    const m = /^#post-(\d+)$/.exec(window.location.hash);
    if (!m || !posts) return;
    const id = Number(m[1]);
    setLinked(id);
    requestAnimationFrame(() =>
      document
        .getElementById(`post-${id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
    const t = setTimeout(() => setLinked(null), 4000);
    return () => clearTimeout(t);
  }, [posts]);

  return (
    <section className="glass space-y-4 rounded-3xl p-6 sm:p-8">
      <Heading n="03 · From past students" title="Student Reflections">
        <div
          className="flex gap-1 rounded-xl bg-card/60 p-1 text-xs font-bold"
          role="group"
          aria-label="Sort"
        >
          {(["top", "new"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              aria-pressed={sort === s}
              className={`rounded-lg px-3 py-1 capitalize ${sort === s ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </Heading>
      <p className="text-sm font-semibold text-muted-foreground">
        Anonymous to everyone, professors included. You keep one pseudonym per course.
      </p>

      {user ? (
        <Composer courseId={courseId} onPosted={() => void load()} />
      ) : (
        <p className="text-xs font-bold text-muted-foreground">Sign in to post, reply or vote.</p>
      )}
      {error && <p className="text-xs font-bold text-destructive">{error}</p>}

      {posts === null ? (
        <p className="text-sm font-semibold text-muted-foreground">Loading…</p>
      ) : posts.length === 0 ? (
        <p className="text-sm font-semibold text-muted-foreground">
          No reflections yet. Be the first.
        </p>
      ) : (
        posts.map((p) => (
          <PostCard
            key={p.id}
            courseId={courseId}
            post={p}
            signedIn={!!user}
            onChanged={() => void load()}
            onError={setError}
            highlighted={linked === p.id}
          />
        ))
      )}
    </section>
  );
}

function Composer({ courseId, onPosted }: { courseId: string; onPosted: () => void }) {
  const [type, setType] = useState<PostType>("Taught me");
  const [body, setBody] = useState("");
  const [similar, setSimilar] = useState<{ post: Post; similarity: number }[]>([]);
  const [note, setNote] = useState("");

  // Ask for similar posts while typing, after a pause.
  useEffect(() => {
    if (body.trim().length < 12) {
      setSimilar([]);
      return;
    }
    let live = true;
    const t = setTimeout(
      () =>
        similarPosts(courseId, body)
          .then((s) => {
            if (live) setSimilar(s);
          })
          .catch(() => undefined),
      450,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [body, courseId]);

  return (
    <form
      className="space-y-3 rounded-2xl border border-border bg-card/60 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const { moderation } = await createPost(courseId, body.trim(), type);
          setBody("");
          setSimilar([]);
          setNote(MODERATION_NOTES[moderation.action]);
          onPosted();
        } catch (err) {
          setNote(err instanceof Error ? err.message : "Couldn't post.");
        }
      }}
    >
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
      <textarea
        className="field"
        rows={3}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setNote("");
        }}
        required
        placeholder={
          type === "Question"
            ? "Ask something future students would want to know…"
            : "This course helped me understand … because …"
        }
        aria-label="Your post"
      />
      {similar.length > 0 && (
        <div className="rounded-xl border border-dashed border-primary/40 p-3">
          <p className="label-mono">Already said? Similar posts</p>
          <ul className="mt-2 space-y-1.5">
            {similar.map(({ post }) => (
              <li key={post.id} className="text-sm font-semibold text-foreground">
                <span className="mr-2 text-[10px] font-bold uppercase text-muted-foreground">
                  {post.type}
                </span>
                {post.body}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={!body.trim()}>
          Post anonymously
        </Button>
        {note && <span className="text-xs font-bold text-primary">{note}</span>}
      </div>
    </form>
  );
}

function PostCard({
  courseId,
  post,
  signedIn,
  onChanged,
  onError,
  highlighted = false,
}: {
  courseId: string;
  post: Post;
  signedIn: boolean;
  onChanged: () => void;
  onError: (msg: string) => void;
  highlighted?: boolean;
}) {
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const cast = async (value: -1 | 1) => {
    try {
      await vote(post.id, post.myVote === value ? 0 : value);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't vote.");
    }
  };

  return (
    <article
      id={`post-${post.id}`}
      className={`flex scroll-mt-24 gap-4 rounded-2xl border bg-card/60 p-5 transition-shadow ${highlighted ? "border-primary ring-2 ring-primary" : "border-border"}`}
    >
      <div className="flex h-fit flex-col items-center gap-0.5 rounded-xl border border-border bg-card px-1.5 py-1 text-sm font-bold text-muted-foreground">
        <button
          onClick={() => void cast(1)}
          disabled={!signedIn || post.mine}
          aria-label="Upvote"
          aria-pressed={post.myVote === 1}
          className={post.myVote === 1 ? "text-primary" : "hover:text-primary disabled:opacity-40"}
        >
          <ArrowUp className="h-4 w-4" />
        </button>
        <span className="text-foreground">{post.score}</span>
        <button
          onClick={() => void cast(-1)}
          disabled={!signedIn || post.mine}
          aria-label="Downvote"
          aria-pressed={post.myVote === -1}
          className={post.myVote === -1 ? "text-primary" : "hover:text-primary disabled:opacity-40"}
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {post.type && (
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${TYPE_STYLES[post.type]}`}
            >
              {post.type}
            </span>
          )}
          <span className="font-mono text-xs font-bold text-muted-foreground">
            {post.author}
            {post.mine && " (you)"} · {post.createdAt.slice(0, 10)}
          </span>
          {post.status && post.status !== "published" && (
            <span className="rounded bg-dust px-1.5 py-0.5 text-[10px] font-bold uppercase">
              {post.status}
            </span>
          )}
        </div>
        <p className="mt-2 leading-relaxed text-foreground">{post.body}</p>

        {post.replies.length > 0 && (
          <ul className="mt-3 space-y-2">
            {post.replies.map((r) => (
              <li key={r.id} className="flex gap-2 text-sm">
                <CornerDownRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p>
                  <span className="font-mono text-xs font-bold text-muted-foreground">
                    {r.author}
                    {r.mine && " (you)"}
                  </span>{" "}
                  <span className="text-foreground">{r.body}</span>
                </p>
              </li>
            ))}
          </ul>
        )}

        {signedIn &&
          (replying ? (
            <form
              className="mt-3 flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await createPost(courseId, reply.trim(), null, post.id);
                  setReply("");
                  setReplying(false);
                  onChanged();
                } catch (err) {
                  onError(err instanceof Error ? err.message : "Couldn't reply.");
                }
              }}
            >
              <input
                className="field"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                required
                placeholder="Reply anonymously"
                aria-label="Reply"
                autoFocus
              />
              <Button type="submit" size="sm" className="h-auto">
                Reply
              </Button>
            </form>
          ) : (
            <button
              className="mt-2 text-xs font-bold text-muted-foreground hover:text-primary"
              onClick={() => setReplying(true)}
            >
              Reply
            </button>
          ))}
      </div>
    </article>
  );
}
