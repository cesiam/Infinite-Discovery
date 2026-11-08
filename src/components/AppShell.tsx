import { Link, useLocation } from "@tanstack/react-router";
import { type ReactNode } from "react";
import {
  ArrowLeft,
  Fingerprint,
  Infinity as InfinityIcon,
  MessagesSquare,
  Network,
  ShoppingCart,
} from "lucide-react";
import { usePlan } from "@/lib/plan";
import { useDarkMode } from "@/lib/theme";
import { Hero } from "./Hero";
import { PlanBoard } from "./PlanBoard";
import { Profile } from "./Profile";

// The rail's tabs open in the panel beside the plan (the graph takes the whole page);
// clicking the open one again goes back to the plan and search.
const TABS = [
  { to: "/fingerprints", label: "Fingerprints", icon: Fingerprint },
  { to: "/community", label: "Student output", icon: MessagesSquare },
  { to: "/cart", label: "Class cart", icon: ShoppingCart },
  // the graph needs the room, so it takes the whole page instead of the side panel
  { to: "/graph", label: "Graph", icon: Network },
] as const;

function Rail() {
  const { pathname } = useLocation();
  const { plan } = usePlan();
  return (
    <nav className="rail" aria-label="Main">
      <Link to="/" className="rail-logo" aria-label="Infinite Discovery home" title="Home">
        <InfinityIcon />
      </Link>
      <div className="rail-group">
        {TABS.map(({ to, label, icon: Icon }) => {
          const open = pathname === to;
          return (
            <Link
              key={to}
              to={open ? "/" : to}
              search={open ? { plan: 1 } : {}}
              className={`rail-btn ${open ? "rail-btn-active" : ""}`}
              aria-current={open ? "page" : undefined}
              aria-label={to === "/cart" ? `${label}, ${plan.cart.length} classes` : label}
              title={open ? `Close ${label.toLowerCase()}` : label}
            >
              <Icon />
              {to === "/cart" && plan.cart.length > 0 && (
                <span className="rail-badge">{plan.cart.length}</span>
              )}
            </Link>
          );
        })}
      </div>
      <Profile />
    </nav>
  );
}

const SIDE_PAGES = ["/", "/fingerprints", "/community", "/cart"];

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  useDarkMode();
  // "/" is the opening screen, "/?plan=1" the planner with search beside it. The rail's
  // tabs and course pages open in that same panel, so a class can go straight onto a term.
  const home = pathname === "/" && !(search as { plan?: 1 }).plan;
  const besidePlan = SIDE_PAGES.includes(pathname) || pathname.startsWith("/courses/");
  const tab = TABS.find((t) => t.to === pathname);

  if (home)
    return (
      <div className="min-h-screen p-2 sm:p-4">
        <Hero />
      </div>
    );
  return (
    <div className="planner-app">
      <Rail />
      {besidePlan ? (
        <>
          <div className="planner-main">
            <PlanBoard />
          </div>
          <aside
            className="planner-side glass page-pane @container"
            aria-label={tab?.label ?? "Find classes"}
          >
            {tab && (
              <Link to="/" search={{ plan: 1 }} className="side-back">
                <ArrowLeft />
                Back to search
              </Link>
            )}
            {children}
          </aside>
        </>
      ) : (
        <div className="planner-page glass page-pane @container">{children}</div>
      )}
    </div>
  );
}
