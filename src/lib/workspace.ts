export const DEFAULT_WORKSPACE_OPEN = false;
export const DEFAULT_PLAN_PERCENT = 60;
export function clampPlanPercent(value: number) {
  return Math.min(72, Math.max(40, value));
}
