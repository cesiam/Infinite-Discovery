import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { findCourses } from "@/lib/api";

type Option = { id: string; number: string; title: string };

/** Type a number or title right where the class should go; Enter takes the first match. */
export function QuickAdd({
  label,
  onPick,
  onClose,
}: {
  label: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [options, setOptions] = useState<Option[]>([]);

  useEffect(() => {
    if (!text.trim()) {
      setOptions([]);
      return;
    }
    let live = true;
    const t = setTimeout(
      () =>
        findCourses(text)
          .then((o) => live && setOptions(o.slice(0, 6)))
          .catch(() => undefined),
      180,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [text]);

  const pick = (id: string) => {
    onPick(id);
    setText("");
    setOptions([]);
  };

  return (
    <div className="quick-add">
      <div className="flex items-center gap-1">
        <input
          className="field !py-1.5 !text-xs"
          value={text}
          autoFocus
          placeholder="6.1210 or “algorithms”"
          aria-label={label}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && options[0]) {
              e.preventDefault();
              pick(options[0].id);
            }
          }}
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-muted-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {options.length > 0 && (
        <ul className="mt-1 space-y-0.5" role="listbox" aria-label="Matching classes">
          {options.map((o) => (
            <li key={o.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="w-full truncate rounded-md px-1.5 py-1 text-left text-xs hover:bg-accent"
                onClick={() => pick(o.id)}
              >
                <span className="font-mono font-bold text-primary">{o.number}</span> {o.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
