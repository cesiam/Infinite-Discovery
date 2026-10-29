import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createRemotePlan,
  deleteRemotePlan,
  EMPTY_PLAN,
  getCourseSummaries,
  listRemotePlans,
  loadLocalPlans,
  MAX_PLAN_YEARS,
  planKey,
  saveLocalPlans,
  saveRemotePlan,
  SEASONS,
  signedIn,
  type CourseSummary,
  type Plan,
  type SavedPlan,
  type Season,
} from "./api";
import { useUser } from "./auth";

interface PlanCtx {
  /** The plan being edited. */
  plan: Plan;
  plans: SavedPlan[];
  activeId: string;
  /** Catalog data for every course in the plan or cart: units and offered seasons. */
  courses: Record<string, CourseSummary>;
  add: (courseId: string, key: string) => void;
  remove: (courseId: string) => void;
  addNext: (courseId: string) => string;
  has: (courseId: string) => boolean;
  addYear: () => void;
  /** Removes the year and its courses; later years move up one. */
  removeYear: (year: number) => void;
  addProgram: (id: string) => void;
  removeProgram: (id: string) => void;
  addToCart: (ids: string[]) => void;
  removeFromCart: (id: string) => void;
  switchPlan: (id: string) => void;
  newPlan: (name: string, copyCurrent: boolean) => Promise<void>;
  renamePlan: (name: string) => void;
  deletePlan: () => Promise<void>;
  saving: boolean;
  /** Courses to spotlight in the plan (hovering a program or a course tag); null = none. */
  highlight: Set<string> | null;
  setHighlight: (ids: Iterable<string> | null) => void;
}
const Ctx = createContext<PlanCtx | null>(null);
export const PLAN_TERMS: Season[] = SEASONS;

const strip = (slots: Plan["slots"], id: string) =>
  Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, v.filter((x) => x !== id)]));
const ACTIVE_KEY = "id-active-plan";

function readActive() {
  try {
    return localStorage.getItem(ACTIVE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function PlanProvider({ children }: { children: ReactNode }) {
  const user = useUser();
  const [plans, setPlans] = useState<SavedPlan[]>([
    { id: "local-1", name: "My plan", data: EMPTY_PLAN },
  ]);
  const [activeId, setActiveId] = useState("local-1");
  const [courses, setCourses] = useState<Record<string, CourseSummary>>({});
  const [saving, setSaving] = useState(false);
  const [highlight, setHighlightState] = useState<Set<string> | null>(null);
  const setHighlight = (ids: Iterable<string> | null) =>
    setHighlightState(ids ? new Set(ids) : null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remote = !!user && signedIn();

  // Plans come from the account when signed in (this browser's plans are uploaded the
  // first time), otherwise from this browser.
  useEffect(() => {
    let live = true;
    (async () => {
      let loaded: SavedPlan[];
      if (user && signedIn()) {
        loaded = await listRemotePlans();
        if (!loaded.length)
          loaded = await Promise.all(loadLocalPlans().map((p) => createRemotePlan(p.name, p.data)));
      } else {
        loaded = loadLocalPlans();
      }
      if (!live) return;
      setPlans(loaded);
      const wanted = readActive();
      setActiveId(loaded.some((p) => p.id === wanted) ? wanted : (loaded[0]?.id ?? ""));
    })().catch(() => {
      if (!live) return;
      const local = loadLocalPlans();
      setPlans(local);
      setActiveId(local[0]?.id ?? "");
    });
    return () => {
      live = false;
    };
  }, [user]);

  const active = plans.find((p) => p.id === activeId) ?? plans[0];
  const plan = active?.data ?? EMPTY_PLAN;

  const ids = useMemo(
    () => [...new Set([...Object.values(plan.slots).flat(), ...plan.cart])].sort(),
    [plan],
  );
  useEffect(() => {
    const missing = ids.filter((id) => !courses[id]);
    if (missing.length)
      getCourseSummaries(missing)
        .then((found) => setCourses((c) => ({ ...c, ...found })))
        .catch(() => undefined);
  }, [ids, courses]);

  /** Save after a change: debounced to the account, or straight to this browser. */
  const persist = (next: SavedPlan[], changedId: string | undefined) => {
    if (!remote) return saveLocalPlans(next);
    const changed = next.find((p) => p.id === changedId);
    if (!changed) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaving(true);
    saveTimer.current = setTimeout(() => {
      saveRemotePlan(changed).finally(() => setSaving(false));
    }, 500);
  };

  const update = (fn: (p: Plan) => Plan) =>
    setPlans((all) => {
      const next = all.map((p) => (p.id === active?.id ? { ...p, data: fn(p.data) } : p));
      persist(next, active?.id);
      return next;
    });

  const add = (id: string, key: string) =>
    update((p) => {
      const slots = strip(p.slots, id);
      return {
        ...p,
        slots: { ...slots, [key]: [...(slots[key] ?? []), id] },
        cart: p.cart.filter((x) => x !== id),
      };
    });
  const remove = (id: string) => update((p) => ({ ...p, slots: strip(p.slots, id) }));
  const has = (id: string) => Object.values(plan.slots).some((v) => v.includes(id));
  const addNext = (id: string) => {
    for (let y = 1; y <= plan.years; y++)
      for (const t of ["Fall", "Spring"] as Season[]) {
        if ((plan.slots[planKey(y, t)] ?? []).length < 4) {
          add(id, planKey(y, t));
          return `Year ${y} ${t}`;
        }
      }
    add(id, planKey(plan.years, "Spring"));
    return `Year ${plan.years} Spring`;
  };
  const addYear = () => update((p) => ({ ...p, years: Math.min(p.years + 1, MAX_PLAN_YEARS) }));
  const removeYear = (year: number) =>
    update((p) => {
      if (p.years <= 1) return p;
      const slots: Plan["slots"] = {};
      for (const [key, list] of Object.entries(p.slots)) {
        const [y, season] = key.split("-") as [string, Season];
        const n = Number(y);
        if (n < year) slots[key] = list;
        else if (n > year) slots[planKey(n - 1, season)] = list;
      }
      return { ...p, years: p.years - 1, slots };
    });
  const addProgram = (id: string) =>
    update((p) => (p.programs.includes(id) ? p : { ...p, programs: [...p.programs, id] }));
  const removeProgram = (id: string) =>
    update((p) => ({ ...p, programs: p.programs.filter((x) => x !== id) }));
  const addToCart = (more: string[]) =>
    update((p) => {
      const planned = new Set(Object.values(p.slots).flat());
      return { ...p, cart: [...new Set([...p.cart, ...more.filter((id) => !planned.has(id))])] };
    });
  const removeFromCart = (id: string) =>
    update((p) => ({ ...p, cart: p.cart.filter((x) => x !== id) }));

  const switchPlan = (id: string) => {
    setActiveId(id);
    try {
      localStorage.setItem(ACTIVE_KEY, id);
    } catch {
      // not remembered across visits
    }
  };
  const newPlan = async (name: string, copyCurrent: boolean) => {
    const data = copyCurrent ? structuredClone(plan) : structuredClone(EMPTY_PLAN);
    const created = remote
      ? await createRemotePlan(name, data)
      : { id: `local-${Date.now()}`, name, data };
    setPlans((all) => {
      const next = [...all, created];
      if (!remote) saveLocalPlans(next);
      return next;
    });
    switchPlan(created.id);
  };
  const renamePlan = (name: string) =>
    setPlans((all) => {
      const next = all.map((p) => (p.id === active?.id ? { ...p, name } : p));
      persist(next, active?.id);
      return next;
    });
  const deletePlan = async () => {
    if (!active || plans.length <= 1) return;
    if (remote) await deleteRemotePlan(active.id);
    const next = plans.filter((p) => p.id !== active.id);
    setPlans(next);
    if (!remote) saveLocalPlans(next);
    switchPlan(next[0]?.id ?? "");
  };

  return (
    <Ctx.Provider
      value={{
        plan,
        plans,
        activeId: active?.id ?? "",
        courses,
        add,
        remove,
        addNext,
        has,
        addYear,
        removeYear,
        addProgram,
        removeProgram,
        addToCart,
        removeFromCart,
        switchPlan,
        newPlan,
        renamePlan,
        deletePlan,
        saving,
        highlight,
        setHighlight,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function usePlan() {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlan outside provider");
  return v;
}

/** Fall of plan year 1 is Fall 2026; IAP/Spring/Summer of year 1 fall in 2027. */
export const PLAN_START_YEAR = 2026;
export const seasonYear = (year: number, season: Season) =>
  PLAN_START_YEAR + year - (season === "Fall" ? 1 : 0);
