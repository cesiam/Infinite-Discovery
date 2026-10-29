import { Link, useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  PenLine,
  Fingerprint,
  Network,
  Search,
  X,
  PanelLeft,
  CalendarDays,
  Users,
  ArrowUpRight,
  House,
  GripVertical,
  LogOut,
} from "lucide-react";
import { signIn, signOut, type Role } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { usePlan } from "@/lib/plan";
import { clampPlanPercent, DEFAULT_PLAN_PERCENT } from "@/lib/workspace";
import { useAppearance } from "@/lib/appearance";
import { Backdrop } from "./Backdrop";
import { CartButton } from "./Cart";
import { PlanBoard } from "./PlanBoard";
import { Button } from "@/components/ui/button";

const OPENING_QUESTIONS = [
  "I loved the hands-on circuits in 6.1910 — what should I take next?",
  "18.06 finally made linear algebra click. Where do I go deeper?",
  "21M.301 changed how I hear music — any good follow-ups?",
  "14.01 made the news make sense. Which econ class comes next?",
] as const;

function Logo() {
  return (
    <Link
      to="/"
      className="flex min-w-0 items-center gap-3 font-display text-lg font-extrabold text-foreground"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary font-display text-2xl font-black leading-none text-primary-foreground">
        ∞
      </span>
      <span className="leading-tight">
        Infinite<span className="block text-primary">Discovery</span>
      </span>
    </Link>
  );
}

// Placeholder "Sign in with MIT": the backend's dev sign-in until MIT login is wired up.
function SignIn() {
  const user = useUser();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("student");
  const [error, setError] = useState("");

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden text-sm font-bold text-foreground sm:inline">
          {user.displayName}
          <span className="ml-1 text-xs text-muted-foreground">· {user.role}</span>
        </span>
        <Button size="sm" variant="outline" onClick={() => void signOut()} aria-label="Sign out">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Button size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="sm:hidden">Sign in</span>
        <span className="hidden sm:inline">Sign in with MIT</span>
      </Button>
      {open && (
        <form
          className="glass-strong absolute right-0 top-11 z-50 w-72 space-y-3 rounded-2xl p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              await signIn(email, name, role);
              setOpen(false);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Sign-in failed");
            }
          }}
        >
          <div className="flex items-center justify-between">
            <p className="label-mono">Development sign-in</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
          <p className="text-xs font-semibold text-muted-foreground">
            MIT login isn&apos;t connected yet. Pick any MIT email and a role to try the app.
          </p>
          <input
            className="field"
            type="email"
            required
            placeholder="kerb@mit.edu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Email"
          />
          <input
            className="field"
            placeholder="Display name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Display name"
          />
          <select
            className="field"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            aria-label="Role"
          >
            <option value="student">Student</option>
            <option value="professor">Professor</option>
            <option value="admin">Admin</option>
          </select>
          {error && <p className="text-xs font-bold text-destructive">{error}</p>}
          <Button type="submit" size="sm" className="w-full">
            Sign in
          </Button>
        </form>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { layout, wordmark } = useAppearance();
  const planYears = usePlan().plan.years;
  const [percent, setPercent] = useState(DEFAULT_PLAN_PERCENT);
  const workspace = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  // Each view has its own URL, so Home, the logo and the browser's back button all
  // return to the opening screen: "/" is home, "/?plan=1" is the planner, "/community".
  const { plan: planParam } = useSearch({ strict: false });
  const community = location.pathname === "/community";
  const planOpen = !community && (location.pathname !== "/" || !!planParam);
  const showPlan = () => navigate({ to: "/", search: { plan: 1 } });
  const goHome = () => navigate({ to: "/" });
  const splitStyle = { "--plan-width": `${percent}%` } as CSSProperties;
  return (
    <div
      className={`app-layout app-layout-${layout} ${!planOpen && !community ? "workspace-collapsed" : ""} ${community ? "workspace-community" : ""} min-h-screen p-2 sm:p-5`}
      onClick={(e) => {
        // The workspace sits in a frame over the campus visual: clicking the backdrop
        // around it (not anything inside it) goes back to the opening screen.
        if (!planOpen && !community) return;
        const target = e.target as HTMLElement;
        if (target === e.currentTarget || (community && target.classList.contains("app-frame")))
          goHome();
      }}
    >
      <Backdrop interactive={!planOpen && !community} />
      <div className="app-frame">
        <header className="app-header grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-4 sm:flex sm:justify-between sm:px-7">
          <Logo />
          <div className="flex shrink-0 items-center gap-2">
            {(planOpen || community) && <CartButton />}
            <SignIn />
          </div>
        </header>
        {(planOpen || community) && (
          <div className="workspace-mode-bar">
            <span className="label-mono hidden sm:block">Map your path through MIT</span>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={planOpen && !community ? "default" : "outline"}
                onClick={showPlan}
              >
                <CalendarDays className="h-4 w-4" />
                Plan
              </Button>
              <Button
                size="sm"
                variant={community ? "default" : "outline"}
                onClick={() => navigate({ to: "/community" })}
              >
                <Users className="h-4 w-4" />
                Community
              </Button>
              <Button size="sm" variant="ghost" onClick={goHome} title="Back to the opening screen">
                <House className="h-4 w-4" />
                Home
              </Button>
            </div>
          </div>
        )}
        {!planOpen && !community ? (
          <div className="collapsed-stage">
            <div className="opening-wordmark">
              {wordmark === "vertical" ? (
                <div className="wordmark-vertical">
                  <span className="wordmark-line" aria-hidden="true" />
                  <h1 className="vertical-title" aria-label="Infinite Discovery">
                    <span aria-hidden="true" className="wordmark-infinity">
                      ∞
                    </span>{" "}
                    Discovery
                  </h1>
                </div>
              ) : (
                <h1 className="oversized-title" aria-label="Infinite Discovery">
                  <span className="title-line">
                    Infinite{" "}
                    <span aria-hidden="true" className="wordmark-infinity-inline">
                      ∞
                    </span>
                  </span>
                  <span className="title-line">
                    Discovery
                    <span aria-hidden="true" className="wordmark-dot">
                      .
                    </span>
                  </span>
                </h1>
              )}
            </div>
            <nav className="opening-choices" aria-label="Choose your workspace">
              <button type="button" className="opening-choice" onClick={showPlan}>
                Plan
                <ArrowUpRight />
              </button>
              <button
                type="button"
                className="opening-choice"
                onClick={() => navigate({ to: "/community" })}
              >
                Community
                <ArrowUpRight />
              </button>
              <div className="stage-questions" aria-label="Questions to explore">
                {OPENING_QUESTIONS.map((q) => (
                  <button
                    type="button"
                    key={q}
                    className="stage-question"
                    onClick={() => navigate({ to: "/community" })}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </nav>
          </div>
        ) : community ? (
          <div className="community-workspace page-pane @container">{children}</div>
        ) : (
          <div className="workspace-grid" ref={workspace} style={splitStyle}>
            <aside className="plan-pane min-w-0">
              <div className="pane-bar">
                <span className="flex items-center gap-2">
                  <PanelLeft className="h-4 w-4" />
                  Academic planner
                </span>
                <span className="font-mono text-[10px]">
                  01 — {String(planYears).padStart(2, "0")}
                </span>
              </div>
              <PlanBoard />
            </aside>
            <div
              role="separator"
              tabIndex={0}
              aria-label="Resize planner"
              aria-orientation="vertical"
              aria-valuenow={Math.round(percent)}
              aria-valuemin={40}
              aria-valuemax={72}
              className="split-handle"
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  setPercent((p) => clampPlanPercent(p + (e.key === "ArrowRight" ? 2 : -2)));
                }
              }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                const rect = workspace.current?.getBoundingClientRect();
                if (rect)
                  setPercent(clampPlanPercent(((e.clientX - rect.left) / rect.width) * 100));
              }}
              onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
            >
              <GripVertical className="h-5 w-3" />
            </div>
            <div className="page-workspace min-w-0">
              <nav
                className="pane-bar justify-start gap-2 overflow-x-auto"
                aria-label="Main navigation"
              >
                <Link
                  to="/"
                  search={{ plan: 1 }}
                  activeOptions={{ exact: true }}
                  className="workspace-tab"
                  activeProps={{ className: "workspace-tab-active" }}
                >
                  <Search className="h-4 w-4" />
                  Search
                </Link>
                <Link
                  to="/fingerprints"
                  className="workspace-tab"
                  activeProps={{ className: "workspace-tab-active" }}
                >
                  <Fingerprint className="h-4 w-4" />
                  Fingerprints
                </Link>
                <Link
                  to="/graph"
                  className="workspace-tab"
                  activeProps={{ className: "workspace-tab-active" }}
                >
                  <Network className="h-4 w-4" />
                  Graph
                </Link>
                <Link
                  to="/contribute"
                  className="workspace-tab"
                  activeProps={{ className: "workspace-tab-active" }}
                >
                  <PenLine className="h-4 w-4" />
                  Contribute
                </Link>
              </nav>
              <div className="page-pane @container">{children}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
