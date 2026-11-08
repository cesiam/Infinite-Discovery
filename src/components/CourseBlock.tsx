import { Link } from "@tanstack/react-router";
import { TriangleAlert, X } from "lucide-react";
import { tone } from "@/lib/blocks";
import { DRAG_TYPE } from "@/lib/dnd";
import { usePlan } from "@/lib/plan";

/** A class as a colored block: drag it to another term, the cart or prior credit. */
export function CourseBlock({
  id,
  onRemove,
  chip = false,
  warning,
}: {
  id: string;
  onRemove: () => void;
  /** one-line form for the cart and prior credit */
  chip?: boolean;
  warning?: string;
}) {
  const { courses, highlight } = usePlan();
  const info = courses[id];
  const units = info?.unitsTotal;
  const dim = highlight ? (highlight.has(id) ? "cblock-lit" : "cblock-dim") : "";
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData(DRAG_TYPE, id)}
      className={`cblock tone-${tone(id)} ${chip ? "cblock-chip" : ""} ${dim}`}
      title={warning ? `${id}: ${warning}` : info?.title}
    >
      <span className="min-w-0 flex-1">
        <Link to="/courses/$courseId" params={{ courseId: id }} className="cblock-num">
          {id}
          {warning && <TriangleAlert className="cblock-warn" aria-label={warning} />}
        </Link>
        {!chip && info && <span className="cblock-title">{info.title}</span>}
      </span>
      {units != null && <span className="cblock-units">{units}u</span>}
      <button type="button" className="cblock-x" onClick={onRemove} aria-label={`Remove ${id}`}>
        <X />
      </button>
    </div>
  );
}
