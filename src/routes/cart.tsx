import { createFileRoute, Link } from "@tanstack/react-router";
import { GripVertical, X } from "lucide-react";
import { AddToPlanButton } from "@/components/AddToPlanButton";
import { DRAG_TYPE } from "@/lib/dnd";
import { usePlan } from "@/lib/plan";

export const Route = createFileRoute("/cart")({
  head: () => ({ meta: [{ title: "Class cart — Infinite Discovery" }] }),
  component: CartPage,
});

/** The cart beside the plan: drag a class onto a term, or place it from a list. */
function CartPage() {
  const { plan, courses, removeFromCart } = usePlan();
  return (
    <main className="find">
      <p className="label-mono">Waiting for a term</p>
      <h1 className="find-title">
        Class <span>cart.</span>
      </h1>
      <p className="find-count mt-5">
        {plan.cart.length} class{plan.cart.length === 1 ? "" : "es"} · drag one onto a term, or
        press Place
      </p>
      {plan.cart.length === 0 && (
        <p className="find-empty">
          Empty. Add classes from search, a course page, or a requirement card.
        </p>
      )}
      <ul className="find-list">
        {plan.cart.map((id) => (
          <li
            key={id}
            draggable
            onDragStart={(e) => e.dataTransfer.setData(DRAG_TYPE, id)}
            className="find-card cursor-grab"
          >
            <div className="find-card-top">
              <GripVertical className="h-4 w-4 text-muted-foreground" />
              <Link to="/courses/$courseId" params={{ courseId: id }} className="find-num">
                {id}
              </Link>
              {courses[id]?.unitsTotal != null && (
                <span className="find-units">{courses[id]?.unitsTotal} units</span>
              )}
              <span className="find-status">
                <AddToPlanButton courseId={id} label="Place" className="find-place" />
                <button
                  type="button"
                  className="find-cart"
                  onClick={() => removeFromCart(id)}
                  aria-label={`Remove ${id} from cart`}
                >
                  <X />
                </button>
              </span>
            </div>
            {courses[id] && <h3 className="find-name">{courses[id]?.title}</h3>}
          </li>
        ))}
      </ul>
    </main>
  );
}
