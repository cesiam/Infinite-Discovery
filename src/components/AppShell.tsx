import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  Infinity as InfinityIcon,
  ListChecks,
  MessagesSquare,
  Moon,
  Network,
  Search,
  ShoppingCart,
  Sun,
} from "lucide-react";
import { PANEL_DRAG_TYPE } from "@/lib/dnd";
import { setRequirementsDock, useRequirementsDock, type Dock } from "@/lib/dock";
import { usePlan } from "@/lib/plan";
import { useDarkMode } from "@/lib/theme";
import { Hero } from "./Hero";
import { PlanBoard } from "./PlanBoard";
import { Profile } from "./Profile";

// The rail's tabs open in the panel beside the plan (the graph takes the whole page);
// clicking the open one again goes back to the plan and search. Requirements only get a
// tab once they've been moved out from above the plan.
const TABS = [
  { to: "/requirements", label: "Requirements", icon: ListChecks },
  { to: "/community", label: "Student Feedback", icon: MessagesSquare },
  { to: "/cart", label: "Class cart", icon: ShoppingCart },
  // the graph needs the room, so it takes the whole page instead of the side panel
  { to: "/graph", label: "Graph", icon: Network },
] as const;

function Rail({ dark, toggleDark }: { dark: boolean; toggleDark: () => void }) {
  const { pathname, search } = useLocation();
  const { plan } = usePlan();
  const dock = useRequirementsDock();
  const searching = pathname === "/" && Boolean((search as { plan?: 1 }).plan);
  const tabs = TABS.filter((t) => t.to !== "/requirements" || dock === "side");
  return (
    <nav className="rail" aria-label="Main">
      <Link to="/" className="rail-logo" aria-label="Infinite Discovery home" title="Home">
        <InfinityIcon />
      </Link>
      <div className="rail-group">
        <Link
          to="/"
          search={{ plan: 1 }}
          className={`rail-btn ${searching ? "rail-btn-active" : ""}`}
          aria-current={searching ? "page" : undefined}
          aria-label="Search"
          title="Search"
        >
          <Search />
        </Link>
        {tabs.map(({ to, label, icon: Icon }) => {
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
      <button
        type="button"
        className="rail-btn rail-bottom"
        onClick={toggleDark}
        aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
        title={dark ? "Light mode" : "Dark mode"}
      >
        {dark ? <Sun /> : <Moon />}
      </button>
      <Profile />
    </nav>
  );
}

const SIDE_PAGES = ["/", "/requirements", "/fingerprints", "/community", "/cart"];

// The side panel's width, set by dragging the divider between it and the plan.
const WIDTH_KEY = "id-side-width";
const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 320;
const MIN_PLAN = 420; // the plan never gets narrower than this

function clampWidth(w: number) {
  const max = Math.max(MIN_WIDTH, window.innerWidth - 72 - 32 - 16 - MIN_PLAN);
  return Math.round(Math.min(Math.max(w, MIN_WIDTH), max));
}

function useSideWidth() {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      if (saved) setWidth(clampWidth(saved));
    } catch {
      // storage blocked: the default width
    }
  }, []);
  const save = (w: number) => {
    const next = clampWidth(w);
    setWidth(next);
    try {
      localStorage.setItem(WIDTH_KEY, String(next));
    } catch {
      // not remembered across visits
    }
  };
  return [width, save] as const;
}

/** The handle between the plan and the side panel: drag it, or focus it and use the arrows. */
function Divider({ width, onChange }: { width: number; onChange: (w: number) => void }) {
  const drag = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing");
    // the panel's right edge stays put, so its width is that edge minus the pointer
    const right = window.innerWidth - 16;
    const move = (ev: globalThis.PointerEvent) => onChange(right - ev.clientX - 8);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      document.body.classList.remove("resizing");
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 80 : 24;
    if (e.key === "ArrowLeft") onChange(width + step);
    else if (e.key === "ArrowRight") onChange(width - step);
    else if (e.key === "Home") onChange(DEFAULT_WIDTH);
    else return;
    e.preventDefault();
  };
  return (
    <div
      className="split-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the plan and the side panel"
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={drag}
      onDoubleClick={() => onChange(DEFAULT_WIDTH)}
      onKeyDown={keys}
    />
  );
}

/** Lets the requirements section be dropped here: the side panel or the plan. */
function useDockDrop(target: Dock) {
  const navigate = useNavigate();
  const [over, setOver] = useState(false);
  return {
    over,
    handlers: {
      onDragOver: (e: DragEvent) => {
        if (!e.dataTransfer.types.includes(PANEL_DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      },
      onDragLeave: (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (e: DragEvent) => {
        if (e.dataTransfer.getData(PANEL_DRAG_TYPE) !== target) return setOver(false);
        e.preventDefault();
        setOver(false);
        document.body.classList.remove("dragging-panel");
        setRequirementsDock(target);
        if (target === "side") void navigate({ to: "/requirements" });
        else void navigate({ to: "/", search: { plan: 1 } });
      },
    },
  };
}

// Where the side panel was scrolled to on each page, so switching tabs and coming back
// (to search, say) lands where you left off instead of at the top.
const sideScroll = new Map<string, number>();

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  const [dark, toggleDark] = useDarkMode();
  const [sideWidth, setSideWidth] = useSideWidth();
  const sideRef = useRef<HTMLElement>(null);
  const toSide = useDockDrop("side");
  const toPlan = useDockDrop("plan");
  const pathRef = useRef(pathname);
  // "/" is the opening screen, "/?plan=1" the planner with search beside it. The rail's
  // tabs and course pages open in that same panel, so a class can go straight onto a term.
  const home = pathname === "/" && !(search as { plan?: 1 }).plan;
  const besidePlan = SIDE_PAGES.includes(pathname) || pathname.startsWith("/courses/");
  const tab = TABS.find((t) => t.to === pathname);

  useLayoutEffect(() => {
    pathRef.current = pathname;
    const el = sideRef.current;
    if (!el) return;
    const target = sideScroll.get(pathname) ?? 0;
    el.scrollTop = target;
    // the page may fill in a frame or two later (a lazy route, cached results); keep trying
    // briefly until it's tall enough to scroll that far
    let tries = 0;
    let frame = 0;
    const retry = () => {
      if (pathRef.current !== pathname || Math.abs(el.scrollTop - target) < 2 || ++tries > 30)
        return;
      el.scrollTop = target;
      frame = requestAnimationFrame(retry);
    };
    frame = requestAnimationFrame(retry);
    return () => cancelAnimationFrame(frame);
  }, [pathname, besidePlan]);

  if (home)
    return (
      <div className="min-h-screen p-2 sm:p-4">
        <Hero />
      </div>
    );
  return (
    <div
      className={`planner-app ${besidePlan ? "planner-split" : ""}`}
      style={{ "--side-w": `${sideWidth}px` } as CSSProperties}
    >
      <Rail dark={dark} toggleDark={toggleDark} />
      {besidePlan ? (
        <>
          <div
            className={`planner-main dock-target ${toPlan.over ? "dock-over" : ""}`}
            data-drop-label="Drop to put requirements back above the plan"
            {...toPlan.handlers}
          >
            <PlanBoard />
          </div>
          <Divider width={sideWidth} onChange={setSideWidth} />
          <aside
            ref={sideRef}
            onScroll={(e) => sideScroll.set(pathRef.current, e.currentTarget.scrollTop)}
            {...toSide.handlers}
            data-drop-label="Drop to move requirements here"
            className={`planner-side glass page-pane @container dock-target ${toSide.over ? "dock-over" : ""}`}
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
        <div className="planner-page glass page-pane @container">
          {/* full-page views (the graph) have no plan beside them, so offer the way back */}
          <Link to="/" className="side-back">
            <ArrowLeft />
            Back home
          </Link>
          {children}
        </div>
      )}
    </div>
  );
}
