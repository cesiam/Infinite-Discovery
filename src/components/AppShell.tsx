import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CalendarDays,
  Fingerprint,
  Infinity as InfinityIcon,
  Moon,
  Network,
  PenLine,
  Search,
  ShoppingCart,
  Sun,
  Users,
  X,
} from "lucide-react";
import { usePlan } from "@/lib/plan";
import { useDarkMode } from "@/lib/theme";
import { CartList } from "./Cart";
import { Hero } from "./Hero";
import { PlanBoard } from "./PlanBoard";

const PAGES = [
  { to: "/", label: "Plan", icon: CalendarDays, search: { plan: 1 as const } },
  { to: "/graph", label: "Graph", icon: Network },
  { to: "/community", label: "Community", icon: Users },
  { to: "/fingerprints", label: "Fingerprints", icon: Fingerprint },
  { to: "/contribute", label: "Contribute", icon: PenLine },
] as const;

/** The cart's count on the rail; opens the list beside it. */
function RailCart() {
  const { plan } = usePlan();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) =>
      ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="rail-btn"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Cart, ${plan.cart.length} classes`}
        title="Class cart"
      >
        <ShoppingCart />
        {plan.cart.length > 0 && <span className="rail-badge">{plan.cart.length}</span>}
      </button>
      {open && (
        <div className="rail-pop glass-strong">
          <div className="mb-2 flex items-center justify-between">
            <p className="label-mono">Class cart</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close cart">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
          <CartList compact />
          <p className="mt-2 text-[11px] font-semibold text-muted-foreground">
            Drag a class onto a term in your plan, or press Place.
          </p>
        </div>
      )}
    </div>
  );
}

function Rail({ dark, toggleDark }: { dark: boolean; toggleDark: () => void }) {
  const navigate = useNavigate();
  return (
    <nav className="rail" aria-label="Main">
      <Link to="/" className="rail-logo" aria-label="Infinite Discovery home" title="Home">
        <InfinityIcon />
      </Link>
      <div className="rail-group">
        {PAGES.map(({ to, label, icon: Icon, ...rest }) => (
          <Link
            key={label}
            to={to}
            search={"search" in rest ? rest.search : {}}
            className="rail-btn"
            activeOptions={{ exact: to === "/", includeSearch: false }}
            activeProps={{ className: "rail-btn-active", "aria-current": "page" }}
            aria-label={label}
            title={label}
          >
            <Icon />
          </Link>
        ))}
        <RailCart />
        <button
          type="button"
          className="rail-btn"
          aria-label="Search classes"
          title="Search classes"
          onClick={() =>
            void navigate({ to: "/", search: { plan: 1 } }).then(() =>
              document.getElementById("course-search")?.focus(),
            )
          }
        >
          <Search />
        </button>
      </div>
      <button
        type="button"
        className="rail-btn rail-bottom"
        onClick={toggleDark}
        aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
        title={dark ? "Light mode" : "Dark mode"}
      >
        {dark ? <Sun /> : <Moon />}
      </button>
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  const [dark, toggleDark] = useDarkMode();
  // "/" is the opening screen, "/?plan=1" the planner with search beside it. A course page
  // also opens beside the plan, so its class can be dragged straight onto a term.
  const home = pathname === "/" && !(search as { plan?: 1 }).plan;
  const besidePlan = pathname === "/" || pathname.startsWith("/courses/");

  if (home)
    return (
      <div className="min-h-screen p-2 sm:p-4">
        <Hero />
      </div>
    );
  return (
    <div className="planner-app">
      <Rail dark={dark} toggleDark={toggleDark} />
      {besidePlan ? (
        <>
          <div className="planner-main">
            <PlanBoard />
          </div>
          <aside className="planner-side glass page-pane @container" aria-label="Find classes">
            {children}
          </aside>
        </>
      ) : (
        <div className="planner-page glass page-pane @container">{children}</div>
      )}
    </div>
  );
}
