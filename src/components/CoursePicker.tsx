import { useEffect, useState } from "react";
import { findCourses } from "@/lib/api";

type Option = { id: string; number: string; title: string };

/** Type a number or title; picks from the full catalog. */
export function CoursePicker({
  value,
  onChange,
  label = "Course",
}: {
  value: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  const [text, setText] = useState(value);
  const [options, setOptions] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || !text.trim()) {
      setOptions([]);
      return;
    }
    let live = true;
    const t = setTimeout(
      () =>
        findCourses(text)
          .then((o) => {
            if (live) setOptions(o);
          })
          .catch(() => undefined),
      200,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [text, open]);

  return (
    <label className="relative block space-y-1.5">
      <span className="label-mono">{label}</span>
      <input
        className="field"
        value={text}
        placeholder="6.3900 or “machine learning”"
        autoComplete="off"
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-autocomplete="list"
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          onChange("");
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => setOpen(true)}
      />
      {open && options.length > 0 && (
        <ul
          role="listbox"
          className="glass-strong absolute inset-x-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-xl p-1"
        >
          {options.map((o) => (
            <li key={o.id} role="option" aria-selected={value === o.id}>
              <button
                type="button"
                className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-card"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(o.id);
                  setText(`${o.number} — ${o.title}`);
                  setOpen(false);
                }}
              >
                <span className="font-mono font-bold text-primary">{o.number}</span>{" "}
                <span className="font-semibold text-foreground">{o.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}
