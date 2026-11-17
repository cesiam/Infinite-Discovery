import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { RequirementsPanel } from "@/components/RequirementsPanel";
import { setRequirementsDock } from "@/lib/dock";

export const Route = createFileRoute("/requirements")({
  head: () => ({ meta: [{ title: "Requirements — Infinite Discovery" }] }),
  component: RequirementsPage,
});

/** The requirements moved into the side panel (they start above the plan): hover a row to
 * spotlight its classes in the terms, drag a class from a checklist onto a term. */
function RequirementsPage() {
  // opening this tab (a link, the address bar) puts the requirements here, not above the plan
  useEffect(() => setRequirementsDock("side"), []);
  return (
    <main className="find">
      <p className="label-mono">What your degree asks for</p>
      <h1 className="find-title">
        Require<span>ments.</span>
      </h1>
      <div className="mt-5">
        <RequirementsPanel dock="side" />
      </div>
    </main>
  );
}
