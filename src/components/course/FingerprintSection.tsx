import { useCallback, useEffect, useState } from "react";
import { Check, History, Pencil, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import {
  addFingerprint,
  editFingerprint,
  getFingerprintHistory,
  getFingerprints,
  reviewRevision,
  revertFingerprint,
  type Fingerprint,
  type Revision,
} from "@/lib/api";
import { useUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Heading } from "./Heading";

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

/** Wikipedia-style: every edit is a new revision; the history keeps them all. */
export function FingerprintSection({
  courseId,
  eyebrow = "02 · Community wiki",
  title = "Course Fingerprint",
}: {
  courseId: string;
  eyebrow?: string;
  title?: string;
}) {
  const user = useUser();
  const [items, setItems] = useState<Fingerprint[] | null>(null);
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState("");

  const load = useCallback(
    () =>
      getFingerprints(courseId)
        .then(setItems)
        .catch(() => setItems([])),
    [courseId],
  );
  useEffect(() => {
    void load();
  }, [load, user]);

  const anyAi = items?.some((f) => f.aiDraft);

  return (
    <section className="glass space-y-4 rounded-3xl p-6 sm:p-8">
      <Heading n={eyebrow} title={title} />
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-muted-foreground">
        Questions you should be able to answer after this course.
        {anyAi && (
          <span className="inline-flex items-center gap-1 rounded-full border border-accent-foreground/20 bg-cyan px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-accent-foreground">
            <Sparkles className="h-3 w-3" />
            AI drafts until edited
          </span>
        )}
      </p>
      {notice && (
        <p className="rounded-xl bg-cyan px-3 py-2 text-sm font-bold text-accent-foreground">
          {notice}
        </p>
      )}

      {items === null ? (
        <p className="text-sm font-semibold text-muted-foreground">Loading…</p>
      ) : (
        <ol className="space-y-2.5">
          {items.map((fp, i) => (
            <FingerprintItem
              key={fp.id}
              n={i + 1}
              fp={fp}
              canEdit={!!user}
              isStaff={user?.role === "professor" || user?.role === "admin"}
              onChanged={(msg) => {
                setNotice(msg);
                void load();
              }}
            />
          ))}
        </ol>
      )}

      {user ? (
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const m = await addFingerprint(courseId, adding.trim());
              setAdding("");
              setNotice(
                m.action === "hold" ? "Your question is waiting for review." : "Question added.",
              );
              void load();
            } catch (err) {
              setNotice(errorText(err));
            }
          }}
        >
          <input
            className="field"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            minLength={10}
            required
            placeholder="Add a question students should be able to answer"
            aria-label="New fingerprint question"
          />
          <Button type="submit" size="sm" className="h-auto">
            <Plus />
            Add
          </Button>
        </form>
      ) : (
        <p className="text-xs font-bold text-muted-foreground">Sign in to edit or add questions.</p>
      )}
    </section>
  );
}

function FingerprintItem({
  n,
  fp,
  canEdit,
  isStaff,
  onChanged,
}: {
  n: number;
  fp: Fingerprint;
  canEdit: boolean;
  isStaff: boolean;
  onChanged: (msg: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fp.question);
  const [summary, setSummary] = useState("");
  const [history, setHistory] = useState<Revision[] | null>(null);
  const [error, setError] = useState("");

  const run = async (action: () => Promise<string>) => {
    setError("");
    try {
      const msg = await action();
      setHistory(null);
      onChanged(msg);
    } catch (err) {
      setError(errorText(err));
    }
  };
  const statusMessage = (s: "approved" | "pending") =>
    s === "pending"
      ? "Saved. A professor approved the current version, so your edit is waiting for review."
      : "Saved as a new revision.";

  return (
    <li className="rounded-2xl bg-card/60 p-4">
      <div className="flex gap-4">
        <span className="font-mono text-sm font-bold text-primary">
          {String(n).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const s = await editFingerprint(fp.id, draft.trim(), summary.trim());
                  setEditing(false);
                  setSummary("");
                  return statusMessage(s);
                });
              }}
            >
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                className="field"
                minLength={10}
                required
                aria-label="Question"
              />
              <input
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Describe your edit (optional)"
                className="field"
                aria-label="Edit summary"
              />
              <div className="flex gap-2">
                <Button size="sm" type="submit">
                  Save revision
                </Button>
                <Button size="sm" type="button" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <p className="font-semibold leading-relaxed text-foreground">{fp.question}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-muted-foreground">
            <span className={fp.aiDraft ? "text-accent-foreground" : ""}>
              {fp.lastEditor?.label}
            </span>
            {fp.hasPendingEdit && (
              <span className="rounded bg-dust px-1.5 py-0.5 uppercase text-foreground">
                Edit pending review
              </span>
            )}
            {canEdit && !editing && (
              <button
                className="inline-flex items-center gap-1 hover:text-primary"
                onClick={() => {
                  setDraft(fp.question);
                  setEditing(true);
                }}
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
            )}
            <button
              className="inline-flex items-center gap-1 hover:text-primary"
              aria-expanded={history !== null}
              onClick={async () => setHistory(history ? null : await getFingerprintHistory(fp.id))}
            >
              <History className="h-3 w-3" />
              History
            </button>
          </div>
          {error && <p className="mt-2 text-xs font-bold text-destructive">{error}</p>}

          {history && (
            <ul className="mt-3 space-y-2 border-l-4 border-primary/40 pl-3">
              {history.map((r, i) => (
                <li key={r.id} className="text-sm">
                  <p className="font-semibold text-foreground">
                    {r.question ?? <em className="text-muted-foreground">Waiting for review</em>}
                  </p>
                  <p className="font-mono text-[11px] font-bold text-muted-foreground">
                    {r.editor.label} · {r.createdAt.slice(0, 10)}
                    {r.summary && ` · ${r.summary}`}
                    {r.status !== "approved" && (
                      <span className="ml-1 uppercase text-primary">· {r.status}</span>
                    )}
                  </p>
                  <div className="mt-1 flex gap-3 text-[11px] font-bold">
                    {canEdit && i > 0 && r.status === "approved" && (
                      <button
                        className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary"
                        onClick={() =>
                          void run(async () => statusMessage(await revertFingerprint(fp.id, r.id)))
                        }
                      >
                        <RotateCcw className="h-3 w-3" />
                        Restore this version
                      </button>
                    )}
                    {isStaff && r.status === "pending" && (
                      <>
                        <button
                          className="inline-flex items-center gap-1 text-primary"
                          onClick={() =>
                            void run(async () => {
                              await reviewRevision(fp.id, r.id, "approve");
                              return "Edit approved.";
                            })
                          }
                        >
                          <Check className="h-3 w-3" />
                          Approve
                        </button>
                        <button
                          className="inline-flex items-center gap-1 text-muted-foreground hover:text-destructive"
                          onClick={() =>
                            void run(async () => {
                              await reviewRevision(fp.id, r.id, "reject");
                              return "Edit rejected.";
                            })
                          }
                        >
                          <X className="h-3 w-3" />
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}
