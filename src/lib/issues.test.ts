import { describe, expect, it } from "vitest";
import { EMPTY_PLAN, type CourseSummary } from "./api";
import { planIssues } from "./issues";

const course = (id: string, terms: CourseSummary["terms"], requires: string[] = []) => ({
  id,
  number: id,
  title: id,
  department: id.split(".")[0]!,
  units: "",
  unitsTotal: 12,
  terms,
  requires,
});
const courses = {
  "6.1210": course("6.1210", ["Fall", "Spring"], ["6.1200"]),
  "6.1200": course("6.1200", ["Fall", "Spring"]),
  "7.012": course("7.012", ["Fall"]),
};
const name = (key: string) => key;

describe("plan issues", () => {
  it("flags a class placed in a season it isn't offered", () => {
    const plan = { ...EMPTY_PLAN, slots: { "1-Spring": ["7.012"] } };
    expect(planIssues(plan, courses, name)).toEqual([
      { courseId: "7.012", key: "1-Spring", message: "Usually offered in Fall" },
    ]);
  });
  it("flags a prerequisite planned for the same term or later", () => {
    const plan = { ...EMPTY_PLAN, slots: { "1-Fall": ["6.1210"], "1-Spring": ["6.1200"] } };
    expect(planIssues(plan, courses, name)).toEqual([
      { courseId: "6.1210", key: "1-Fall", message: "Take 6.1200 before this (it's in 1-Spring)" },
    ]);
  });
  it("doesn't judge a season the catalog has no schedule for", () => {
    const fallOnly = { "7.012": courses["7.012"], "6.1200": course("6.1200", ["Fall"]) };
    const plan = { ...EMPTY_PLAN, slots: { "1-Spring": ["7.012", "6.1200"] } };
    expect(planIssues(plan, fallOnly, name)).toEqual([]);
  });
  it("is quiet when the order and seasons work", () => {
    const plan = {
      ...EMPTY_PLAN,
      slots: { "1-Fall": ["6.1200", "7.012"], "1-Spring": ["6.1210"] },
    };
    expect(planIssues(plan, courses, name)).toEqual([]);
  });
});
