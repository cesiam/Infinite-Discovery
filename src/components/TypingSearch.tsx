import { useEffect, useState } from "react";

const PROMPTS = [
  "build something with transistors",
  "understand how machines learn",
  "hear music differently",
  "make sense of the news",
];

export function useTypingPlaceholder() {
  const [text, setText] = useState("");
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setText(PROMPTS[0] ?? "explore something new");
      return;
    }
    let index = 0;
    let count = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const prompt = PROMPTS[index] ?? "explore something new";
      count += deleting ? -1 : 1;
      setText(prompt.slice(0, count));
      let wait = deleting ? 35 : 75;
      if (count === prompt.length && !deleting) {
        deleting = true;
        wait = 1800;
      }
      if (count === 0 && deleting) {
        deleting = false;
        index = (index + 1) % PROMPTS.length;
        wait = 350;
      }
      timer = setTimeout(tick, wait);
    };
    timer = setTimeout(tick, 500);
    return () => clearTimeout(timer);
  }, []);
  return `I want to ${text}`;
}
