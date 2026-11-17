import { useEffect, useRef, useState } from "react";
import { LogOut, UserRound } from "lucide-react";
import { signOut } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { usePlan } from "@/lib/plan";
import { SignInForm } from "./SignIn";

const initials = (name: string) =>
  name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** The student at the bottom of the rail: who's signed in, or a way to sign in. */
export function Profile() {
  const user = useUser();
  const { plans, plan, courses } = usePlan();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) =>
      ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const planned = Object.values(plan.slots).flat();
  const units = [...planned, ...plan.credit].reduce(
    (s, id) => s + (courses[id]?.unitsTotal ?? 0),
    0,
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={`rail-avatar ${user ? "" : "rail-avatar-out"}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={user ? `Your profile: ${user.displayName}` : "Sign in"}
        title={user ? user.displayName : "Sign in"}
      >
        {user ? initials(user.displayName || user.email) : <UserRound />}
      </button>
      {open && (
        <div className="rail-pop rail-pop-up glass-strong">
          {user ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="rail-avatar">{initials(user.displayName || user.email)}</span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{user.displayName}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {user.email} · {user.role}
                  </span>
                </span>
              </div>
              <dl className="profile-stats">
                <div>
                  <dt>Plans</dt>
                  <dd>{plans.length}</dd>
                </div>
                <div>
                  <dt>Classes</dt>
                  <dd>{planned.length}</dd>
                </div>
                <div>
                  <dt>Units</dt>
                  <dd>{units}</dd>
                </div>
              </dl>
              <button
                type="button"
                className="pill-btn w-full justify-center"
                onClick={() => {
                  void signOut();
                  setOpen(false);
                }}
              >
                <LogOut />
                Sign out
              </button>
            </div>
          ) : (
            <SignInForm onClose={() => setOpen(false)} />
          )}
        </div>
      )}
    </div>
  );
}
