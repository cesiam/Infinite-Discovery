import { useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { usePlan } from "@/lib/plan";
import { useUser } from "@/lib/auth";
import { SignIn } from "./SignIn";

/** The planner's header: a tab per plan (double-click to rename), new, duplicate, delete. */
export function PlanSwitcher() {
  const user = useUser();
  const { plans, activeId, switchPlan, newPlan, renamePlan, deletePlan, saving } = usePlan();
  const active = plans.find((p) => p.id === activeId);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState(false);

  const finishRename = () => {
    if (name.trim() && name.trim() !== active?.name) renamePlan(name.trim());
    setEditing(false);
  };

  return (
    <header className="card-glass plan-header">
      <div className="plan-header-row">
        <p className="plan-wordmark">
          Infinite
          <span>Discovery</span>
        </p>
        <div className="plan-tabs" role="tablist" aria-label="Your plans">
          {plans.map((p) =>
            editing && p.id === activeId ? (
              <input
                key={p.id}
                className="plan-tab plan-tab-active"
                value={name}
                autoFocus
                maxLength={80}
                aria-label="Plan name"
                onChange={(e) => setName(e.target.value)}
                onBlur={finishRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") finishRename();
                  if (e.key === "Escape") setEditing(false);
                }}
              />
            ) : (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={p.id === activeId}
                className={`plan-tab ${p.id === activeId ? "plan-tab-active" : ""}`}
                onClick={() => switchPlan(p.id)}
                onDoubleClick={() => {
                  if (p.id !== activeId) return;
                  setName(p.name);
                  setEditing(true);
                }}
                title={p.id === activeId ? "Double-click to rename" : `Switch to ${p.name}`}
              >
                {p.name}
              </button>
            ),
          )}
        </div>
        <div className="plan-header-actions">
          <button
            type="button"
            className="pill-btn"
            onClick={() => void newPlan(`Plan ${plans.length + 1}`, false)}
            title="Start a blank plan"
          >
            <Plus />
            New
          </button>
          <button
            type="button"
            className="pill-btn"
            onClick={() => void newPlan(`${active?.name ?? "Plan"} (copy)`, true)}
            title="Copy this plan"
          >
            <Copy />
            Duplicate
          </button>
          {plans.length > 1 && (
            <button
              type="button"
              className={`pill-btn ${confirming ? "pill-btn-danger" : ""}`}
              onClick={() =>
                confirming
                  ? void deletePlan().then(() => setConfirming(false))
                  : setConfirming(true)
              }
              onBlur={() => setConfirming(false)}
              aria-label={
                confirming ? `Confirm deleting ${active?.name}` : `Delete ${active?.name}`
              }
              title="Delete this plan"
            >
              <Trash2 />
              {confirming && "Delete?"}
            </button>
          )}
          <SignIn className="pill-btn-red" />
        </div>
      </div>
      <p className="plan-header-note">
        {user
          ? saving
            ? "Saving to your account…"
            : "Saved to your account."
          : "Saved in this browser. Sign in to keep plans in your account."}
      </p>
    </header>
  );
}
