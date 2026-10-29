import { useEffect, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { usePlan } from "@/lib/plan";
import { useUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";

/** Several plans, CourseRoad-style: switch, rename, start fresh, duplicate, delete. */
export function PlanSwitcher() {
  const user = useUser();
  const { plans, activeId, switchPlan, newPlan, renamePlan, deletePlan, saving } = usePlan();
  const active = plans.find((p) => p.id === activeId);
  const [name, setName] = useState(active?.name ?? "");
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setName(active?.name ?? ""), [active?.id, active?.name]);

  return (
    <div className="mt-4 rounded-lg border border-border bg-card/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="field !w-auto !py-1.5"
          value={activeId}
          onChange={(e) => switchPlan(e.target.value)}
          aria-label="Switch plan"
        >
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          className="field !w-auto min-w-0 flex-1 !py-1.5"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name.trim() !== active?.name && renamePlan(name.trim())}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          aria-label="Plan name"
          maxLength={80}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => void newPlan(`Plan ${plans.length + 1}`, false)}
          title="Start a blank plan"
        >
          <Plus />
          New
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void newPlan(`${active?.name ?? "Plan"} (copy)`, true)}
          title="Copy this plan"
        >
          <Copy />
          Duplicate
        </Button>
        {plans.length > 1 && (
          <Button
            size="sm"
            variant={confirming ? "destructive" : "ghost"}
            onClick={() =>
              confirming ? void deletePlan().then(() => setConfirming(false)) : setConfirming(true)
            }
            onBlur={() => setConfirming(false)}
            aria-label={confirming ? "Confirm deleting this plan" : "Delete this plan"}
          >
            <Trash2 />
            {confirming && "Delete?"}
          </Button>
        )}
      </div>
      <p className="mt-1.5 text-[11px] font-semibold text-muted-foreground">
        {user
          ? saving
            ? "Saving to your account…"
            : "Saved to your account."
          : "Saved in this browser. Sign in to keep plans in your account."}
      </p>
    </div>
  );
}
