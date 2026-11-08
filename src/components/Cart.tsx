import { Link } from "@tanstack/react-router";
import { Check, GripVertical, ShoppingCart, X } from "lucide-react";
import { usePlan } from "@/lib/plan";
import { Button } from "@/components/ui/button";
import { DRAG_TYPE } from "@/lib/dnd";

/** "Add to cart" for any course: collect classes while exploring, place them later. */
export function AddToCartButton({
  courseId,
  size = "sm",
}: {
  courseId: string;
  size?: "sm" | "icon";
}) {
  const { plan, has, addToCart, removeFromCart } = usePlan();
  const inCart = plan.cart.includes(courseId);
  if (has(courseId)) {
    return (
      <Button variant="outline" size={size} disabled title="Already in your plan">
        <Check />
        {size === "sm" && "In plan"}
      </Button>
    );
  }
  return (
    <Button
      variant={inCart ? "default" : "outline"}
      size={size}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (inCart) removeFromCart(courseId);
        else addToCart([courseId]);
      }}
      aria-pressed={inCart}
      aria-label={inCart ? `Remove ${courseId} from cart` : `Add ${courseId} to cart`}
    >
      {inCart ? <Check /> : <ShoppingCart />}
      {size === "sm" && (inCart ? "In cart" : "Add to cart")}
    </Button>
  );
}

/** The cart's courses as draggable chips: drop one on a term to place it. */
export function CartList({ compact = false }: { compact?: boolean }) {
  const { plan, courses, removeFromCart, addNext } = usePlan();
  if (!plan.cart.length) {
    return (
      <p className="text-xs font-semibold text-muted-foreground">
        Empty. Add classes from search, a course page, or the graph.
      </p>
    );
  }
  return (
    <ul className={compact ? "space-y-1" : "flex flex-wrap gap-1.5"}>
      {plan.cart.map((id) => (
        <li
          key={id}
          draggable
          onDragStart={(e) => e.dataTransfer.setData(DRAG_TYPE, id)}
          className="flex cursor-grab items-center gap-1 rounded-md border border-border bg-card px-1.5 py-1 text-xs"
          title="Drag onto a term"
        >
          <GripVertical className="h-3 w-3 text-muted-foreground" />
          <Link
            to="/courses/$courseId"
            params={{ courseId: id }}
            className="font-mono font-bold text-primary hover:underline"
          >
            {id}
          </Link>
          {compact && (
            <span className="min-w-0 flex-1 truncate font-semibold text-foreground">
              {courses[id]?.title}
            </span>
          )}
          <button
            type="button"
            className="ml-1 text-[10px] font-bold text-muted-foreground hover:text-primary"
            onClick={() => addNext(id)}
            title="Put it in the next open term"
          >
            Place
          </button>
          <button
            type="button"
            onClick={() => removeFromCart(id)}
            aria-label={`Remove ${id} from cart`}
            className="text-muted-foreground hover:text-destructive"
          >
            <X className="h-3 w-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}
