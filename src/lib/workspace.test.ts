import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN_PERCENT, DEFAULT_WORKSPACE_OPEN, clampPlanPercent } from "./workspace";

describe("workspace preferences", () => {
  it("starts with the entire planner collapsed", () => {
    expect(DEFAULT_WORKSPACE_OPEN).toBe(false);
  });
  it("starts with the four-year plan wider than the page pane", () => {
    expect(DEFAULT_PLAN_PERCENT).toBe(60);
    expect(DEFAULT_PLAN_PERCENT).toBeGreaterThan(50);
  });
  it("allows resizing without either pane disappearing", () => {
    expect(clampPlanPercent(65)).toBe(65);
    expect(clampPlanPercent(0)).toBe(40);
    expect(clampPlanPercent(100)).toBe(72);
  });
});
