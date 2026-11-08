import { Link, useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  PenLine,
  Fingerprint,
  Network,
  Search,
  PanelLeft,
  CalendarDays,
  Users,
  House,
  GripVertical,
} from "lucide-react";
import { usePlan } from "@/lib/plan";
import { clampPlanPercent, DEFAULT_PLAN_PERCENT } from "@/lib/workspace";
import { useAppearance } from "@/lib/appearance";
import { Backdrop } from "./Backdrop";
import { Hero } from "./Hero";
import { SignIn } from "./SignIn";
import { CartButton } from "./Cart";
import { PlanBoard } from "./PlanBoard";
import { Button } from "@/components/ui/button";

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

export function AppShell({ children }: { children: ReactNode }) {
  const { layout } = useAppearance();
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
  if (!planOpen && !community)
    return (
      <div className="min-h-screen p-2 sm:p-4">
        <Hero />
      </div>
    );
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
      <Backdrop />
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
        {community ? (
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
