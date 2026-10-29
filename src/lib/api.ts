// All data access lives here. Pages and components import from this file only.
// Everything except the plan and sample meeting times comes from the FastAPI backend in
// backend/ (VITE_API_URL, default http://localhost:8000).
import { SAMPLE_MEETINGS, type Meeting } from "./sample-offerings";

export const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export type Source = "Catalog" | "Fingerprint" | "Student Reflection";
export type Season = "Fall" | "IAP" | "Spring" | "Summer";
export type PostType = "Taught me" | "Wish I knew" | "Question";
export type Role = "student" | "professor" | "admin";

export const SEASONS: Season[] = ["Fall", "IAP", "Spring", "Summer"];
export const POST_TYPES: PostType[] = ["Taught me", "Wish I knew", "Question"];

// Catalog department codes for the search filter.
export const DEPARTMENTS: { code: string; label: string }[] = [
  { code: "1", label: "Civil & Environmental (1)" },
  { code: "2", label: "Mechanical Engineering (2)" },
  { code: "3", label: "Materials Science (3)" },
  { code: "4", label: "Architecture (4)" },
  { code: "5", label: "Chemistry (5)" },
  { code: "6", label: "EECS (6)" },
  { code: "7", label: "Biology (7)" },
  { code: "8", label: "Physics (8)" },
  { code: "9", label: "Brain & Cognitive Sciences (9)" },
  { code: "10", label: "Chemical Engineering (10)" },
  { code: "11", label: "Urban Studies (11)" },
  { code: "12", label: "Earth & Planetary Sciences (12)" },
  { code: "14", label: "Economics (14)" },
  { code: "15", label: "Management (15)" },
  { code: "16", label: "Aeronautics & Astronautics (16)" },
  { code: "17", label: "Political Science (17)" },
  { code: "18", label: "Mathematics (18)" },
  { code: "20", label: "Biological Engineering (20)" },
  { code: "21M", label: "Music (21M)" },
  { code: "21W", label: "Writing (21W)" },
  { code: "24", label: "Linguistics & Philosophy (24)" },
];

export interface CourseSummary {
  id: string;
  number: string;
  title: string;
  department: string;
  units: string;
  unitsTotal: number | null;
  terms: Season[];
}
export interface SearchFilters {
  department?: string;
  units?: number;
  term?: Season;
}
export interface SearchResult {
  course: CourseSummary;
  matched: Source[];
  snippet: string;
}
export interface Prereq {
  code: string;
  title: string;
  kind: "hard" | "soft";
  source: string;
  support: number | null;
}
export interface CourseDetail extends CourseSummary {
  description: string;
  prereqText: string;
  prereqs: Prereq[];
  instructors: Record<string, string>;
}
export interface Editor {
  kind: "ai" | "student" | "professor" | "admin";
  label: string;
}
export interface Fingerprint {
  id: number;
  question: string;
  aiDraft: boolean;
  lastEditor: Editor | null;
  hasPendingEdit: boolean;
}
export interface Revision {
  id: number;
  question: string | null; // null when it's pending review and you can't see it
  editor: Editor;
  summary: string;
  revertedFrom: number | null;
  status: "approved" | "pending" | "rejected";
  createdAt: string;
}
export interface Post {
  id: number;
  type: PostType | null;
  body: string;
  author: string;
  upvotes: number;
  downvotes: number;
  score: number;
  myVote: -1 | 0 | 1;
  mine: boolean;
  status: string | null; // only shown to the author and admins
  createdAt: string;
  replies: Post[];
}
export interface User {
  id: number;
  email: string;
  displayName: string;
  role: Role;
}
export interface Moderation {
  action: "publish" | "flag" | "hold";
  reasons: string[];
}
export interface GraphEdge {
  source: string;
  target: string;
  type: "hard" | "soft" | "similar";
}
export interface CourseGraph {
  nodes: { id: string; number: string; title: string; department: string }[];
  edges: GraphEdge[];
}

/** Shown when the API can't be reached: names the address this build calls, so a
 * missing VITE_API_URL (falls back to localhost:8000) or a CORS mismatch is easy to spot. */
export function apiUnreachable() {
  return `Can't reach the course API at ${API_URL}. Check that it's running, that VITE_API_URL was set when this site was built, and that the API's CORS_ORIGINS includes this site (${typeof window === "undefined" ? "" : window.location.origin}).`;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// ---- Session (placeholder sign-in; see backend/app/auth.py) ----
const TOKEN_KEY = "id-token";
const USER_KEY = "id-user";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function currentUser(): User | null {
  try {
    const raw = storage()?.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function setSession(token: string | null, user: User | null) {
  const s = storage();
  if (!s) return;
  if (token && user) {
    s.setItem(TOKEN_KEY, token);
    s.setItem(USER_KEY, JSON.stringify(user));
  } else {
    s.removeItem(TOKEN_KEY);
    s.removeItem(USER_KEY);
  }
  window.dispatchEvent(new Event("id-session"));
}

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = storage()?.getItem(TOKEN_KEY);
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${API_URL}${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
  });
  if (response.status === 401 && token) setSession(null, null); // expired session
  if (!response.ok) {
    const detail = await response
      .json()
      .then((b: { detail?: unknown }) => b.detail)
      .catch(() => null);
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? "Check the form and try again."
          : `Request failed (${response.status})`;
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

type ApiUser = { id: number; email: string; display_name: string; role: Role };
const toUser = (u: ApiUser): User => ({
  id: u.id,
  email: u.email,
  displayName: u.display_name,
  role: u.role,
});

export async function signIn(email: string, displayName: string, role: Role): Promise<User> {
  const body = await request<{ token: string; user: ApiUser }>("/auth/dev/login", {
    method: "POST",
    body: { email, display_name: displayName, role },
  });
  const user = toUser(body.user);
  setSession(body.token, user);
  return user;
}

export async function signOut(): Promise<void> {
  await request("/auth/logout", { method: "POST" }).catch(() => undefined);
  setSession(null, null);
}

// ---- Courses ----
const SOURCE_LABELS: Record<string, Source> = {
  catalog: "Catalog",
  fingerprint: "Fingerprint",
  post: "Student Reflection",
};

type ApiSummary = {
  title: string;
  department: string;
  units: string;
  units_total: number | null;
  terms: Season[];
};
const toSummary = (id: string, s: ApiSummary): CourseSummary => ({
  id,
  number: id,
  title: s.title,
  department: s.department,
  units: s.units,
  unitsTotal: s.units_total,
  terms: s.terms,
});

type ApiSearchResult = ApiSummary & {
  course_id: string;
  matched: { source_type: string; snippet: string }[];
};

/** Search results to UI shape: one badge per kind of source that matched, catalog text as the snippet. */
export function toSearchResult(r: ApiSearchResult): SearchResult {
  const matched = [
    ...new Set(r.matched.map((m) => SOURCE_LABELS[m.source_type]).filter((s): s is Source => !!s)),
  ];
  const snippet =
    r.matched.find((m) => m.source_type === "catalog")?.snippet ?? r.matched[0]?.snippet ?? "";
  return { course: toSummary(r.course_id, r), matched, snippet };
}

export async function searchCourses(
  query: string,
  filters: SearchFilters = {},
): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const params = new URLSearchParams({ q, top_k: "12" });
  if (filters.department) params.append("dept", filters.department);
  if (filters.units) params.set("units", String(filters.units));
  if (filters.term) params.set("term", filters.term);
  const body = await request<{ results: ApiSearchResult[] }>(`/courses/search?${params}`);
  return body.results.map(toSearchResult);
}

type ApiCourse = ApiSummary & {
  id: string;
  description: string;
  prereq_text: string;
  prereqs: {
    course_id: string;
    title: string;
    kind: "hard" | "soft";
    source: string;
    support: number | null;
  }[];
  instructors: Record<string, string>;
};

export async function getCourse(id: string): Promise<CourseDetail | null> {
  try {
    const c = await request<ApiCourse>(`/courses/${encodeURIComponent(id)}`);
    return {
      ...toSummary(c.id, c),
      description: c.description,
      prereqText: c.prereq_text,
      prereqs: c.prereqs.map((p) => ({
        code: p.course_id,
        title: p.title,
        kind: p.kind,
        source: p.source,
        support: p.support,
      })),
      instructors: c.instructors,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function findCourses(
  q: string,
): Promise<Pick<CourseSummary, "id" | "number" | "title">[]> {
  const body = await request<{ courses: { id: string; number: string; title: string }[] }>(
    `/courses?${new URLSearchParams({ q: q.trim(), limit: "12" })}`,
  );
  return body.courses;
}

export async function getCourseSummaries(ids: string[]): Promise<Record<string, CourseSummary>> {
  if (!ids.length) return {};
  const params = new URLSearchParams(ids.map((id) => ["id", id]));
  const body = await request<{ courses: Record<string, ApiSummary & { id: string }> }>(
    `/courses/batch?${params}`,
  );
  return Object.fromEntries(Object.entries(body.courses).map(([id, s]) => [id, toSummary(id, s)]));
}

export async function suggestSoftPrereq(
  courseId: string,
  prereqId: string,
  note: string,
): Promise<Prereq[]> {
  const body = await request<{ prereqs: ApiCourse["prereqs"] }>(
    `/courses/${encodeURIComponent(courseId)}/prereqs/soft`,
    {
      method: "POST",
      body: { prereq_course_id: prereqId, note },
    },
  );
  return body.prereqs.map((p) => ({
    code: p.course_id,
    title: p.title,
    kind: p.kind,
    source: p.source,
    support: p.support,
  }));
}

export async function getCourseGraph(courseId: string): Promise<CourseGraph> {
  return getGraph([courseId], true);
}

/** These courses (or whole departments), the prerequisites pointing into them, and (with
 * unlocks) the courses they lead to. */
export async function getGraph(
  courseIds: string[],
  unlocks = false,
  departments: string[] = [],
): Promise<CourseGraph> {
  if (!courseIds.length && !departments.length) return { nodes: [], edges: [] };
  const params = new URLSearchParams([
    ...courseIds.map((id) => ["course", id]),
    ...departments.map((d) => ["dept", d]),
  ]);
  if (unlocks) params.set("unlocks", "true");
  return request<CourseGraph>(`/graph?${params}`);
}

/** Every course in the catalog and every prerequisite between them. */
export async function getFullGraph(): Promise<CourseGraph> {
  return request<CourseGraph>("/graph");
}

/** Courses linked by how similar their catalog descriptions are (embedding neighbors). */
export async function getSimilarityGraph(
  k = 3,
): Promise<CourseGraph & { edges: (GraphEdge & { similarity?: number })[] }> {
  return request(`/graph/similarity?k=${k}`);
}

/** The courses a topic is about, so the graph can circle them as a group. */
export async function getGraphGroup(query: string, topK = 8): Promise<string[]> {
  const params = new URLSearchParams({ q: query.trim(), top_k: String(topK) });
  const body = await request<{ course_ids: string[] }>(`/graph/group?${params}`);
  return body.course_ids;
}

// ---- Fingerprints ----
type ApiFingerprint = {
  id: number;
  question: string;
  ai_draft: boolean;
  last_editor: Editor | null;
  has_pending_edit: boolean;
};
const toFingerprint = (f: ApiFingerprint): Fingerprint => ({
  id: f.id,
  question: f.question,
  aiDraft: f.ai_draft,
  lastEditor: f.last_editor,
  hasPendingEdit: f.has_pending_edit,
});

export async function getFingerprints(courseId: string): Promise<Fingerprint[]> {
  const body = await request<{ fingerprints: ApiFingerprint[] }>(
    `/courses/${encodeURIComponent(courseId)}/fingerprints`,
  );
  return body.fingerprints.map(toFingerprint);
}

export async function addFingerprint(courseId: string, question: string): Promise<Moderation> {
  const body = await request<{ moderation: Moderation }>(
    `/courses/${encodeURIComponent(courseId)}/fingerprints`,
    {
      method: "POST",
      body: { question },
    },
  );
  return body.moderation;
}

export async function editFingerprint(
  id: number,
  question: string,
  summary: string,
): Promise<"approved" | "pending"> {
  const body = await request<{ review_status: "approved" | "pending" }>(`/fingerprints/${id}`, {
    method: "PUT",
    body: { question, summary },
  });
  return body.review_status;
}

type ApiRevision = {
  id: number;
  question: string | null;
  editor: Editor;
  edit_summary: string;
  reverted_from_revision_id: number | null;
  review_status: Revision["status"];
  created_at: string;
};

export async function getFingerprintHistory(id: number): Promise<Revision[]> {
  const body = await request<{ revisions: ApiRevision[] }>(`/fingerprints/${id}/history`);
  return body.revisions.map((r) => ({
    id: r.id,
    question: r.question,
    editor: r.editor,
    summary: r.edit_summary,
    revertedFrom: r.reverted_from_revision_id,
    status: r.review_status,
    createdAt: r.created_at,
  }));
}

export async function revertFingerprint(
  id: number,
  revisionId: number,
): Promise<"approved" | "pending"> {
  const body = await request<{ review_status: "approved" | "pending" }>(
    `/fingerprints/${id}/revert`,
    {
      method: "POST",
      body: { revision_id: revisionId },
    },
  );
  return body.review_status;
}

export async function reviewRevision(
  id: number,
  revisionId: number,
  action: "approve" | "reject",
): Promise<void> {
  await request(`/fingerprints/${id}/revisions/${revisionId}/review`, {
    method: "POST",
    body: { action },
  });
}

// ---- Discussion ----
type ApiPost = {
  id: number;
  type: PostType | null;
  body: string;
  author: string;
  upvotes: number;
  downvotes: number;
  score: number;
  my_vote: -1 | 0 | 1;
  mine: boolean;
  status?: string;
  created_at: string;
  replies: ApiPost[];
};
const toPost = (p: ApiPost): Post => ({
  id: p.id,
  type: p.type,
  body: p.body,
  author: p.author,
  upvotes: p.upvotes,
  downvotes: p.downvotes,
  score: p.score,
  myVote: p.my_vote,
  mine: p.mine,
  status: p.status ?? null,
  createdAt: p.created_at,
  replies: p.replies.map(toPost),
});

export async function getPosts(courseId: string, sort: "top" | "new" = "top"): Promise<Post[]> {
  const body = await request<{ posts: ApiPost[] }>(
    `/courses/${encodeURIComponent(courseId)}/posts?sort=${sort}`,
  );
  return body.posts.map(toPost);
}

export async function createPost(
  courseId: string,
  body: string,
  type: PostType | null,
  parentId?: number,
) {
  const result = await request<{ post: ApiPost; moderation: Moderation }>(
    `/courses/${encodeURIComponent(courseId)}/posts`,
    {
      method: "POST",
      body: parentId ? { body, parent_id: parentId } : { body, type },
    },
  );
  return { post: toPost(result.post), moderation: result.moderation };
}

export async function vote(postId: number, value: -1 | 0 | 1) {
  return request<{ upvotes: number; downvotes: number; score: number; my_vote: -1 | 0 | 1 }>(
    `/posts/${postId}/vote`,
    {
      method: "POST",
      body: { value },
    },
  );
}

export async function similarPosts(
  courseId: string,
  text: string,
): Promise<{ post: Post; similarity: number }[]> {
  const body = await request<{ similar: { post: ApiPost; similarity: number }[] }>(
    `/courses/${encodeURIComponent(courseId)}/posts/similar`,
    { method: "POST", body: { text } },
  );
  return body.similar.map((s) => ({ post: toPost(s.post), similarity: s.similarity }));
}

// ---- Community ----
export interface CommunityQuestion {
  post: Post;
  courseId: string;
  courseTitle: string;
  repliesCount: number;
}
export interface CommunityCourse extends CourseSummary {
  description: string;
  postCounts: Partial<Record<PostType, number>>;
}

type ApiCommunity = {
  questions: (ApiPost & { course_id: string; course_title: string; replies_count: number })[];
  courses: (ApiSummary & {
    id: string;
    description: string;
    post_counts: Partial<Record<PostType, number>>;
  })[];
};

export async function getCommunity(): Promise<{
  questions: CommunityQuestion[];
  courses: CommunityCourse[];
}> {
  const body = await request<ApiCommunity>("/community?limit=8");
  return {
    questions: body.questions.map((q) => ({
      post: toPost(q),
      courseId: q.course_id,
      courseTitle: q.course_title,
      repliesCount: q.replies_count,
    })),
    courses: body.courses.map((c) => ({
      ...toSummary(c.id, c),
      description: c.description,
      postCounts: c.post_counts,
    })),
  };
}

/** What to show before anyone types: the courses students are discussing. */
export async function exploreCourses(): Promise<SearchResult[]> {
  const { courses } = await getCommunity();
  return courses.map((c) => ({
    course: c,
    matched: ["Student Reflection"],
    snippet:
      c.description.length > 160 ? `${c.description.slice(0, 160).trimEnd()}…` : c.description,
  }));
}

// ---- Plans (several per student, like CourseRoad) ----
// slot key: `${year}-${season}`. programs: ids from /programs ("gir", "major:...", ...).
// cart: courses picked up while exploring, waiting to be dragged into a term.
export type Plan = {
  years: number;
  slots: Record<string, string[]>;
  programs: string[];
  cart: string[];
};
export interface SavedPlan {
  id: string;
  name: string;
  data: Plan;
}
export const MAX_PLAN_YEARS = 8;
export const planKey = (year: number, season: Season) => `${year}-${season}`;

export const DEFAULT_PLAN: Plan = {
  years: 4,
  slots: {
    "1-Fall": ["6.100A", "18.06"],
    "1-Spring": ["6.1200"],
    "2-Fall": ["14.01"],
    "2-Spring": ["6.3900"],
  },
  programs: ["gir"],
  cart: [],
};
export const EMPTY_PLAN: Plan = { years: 4, slots: {}, programs: ["gir"], cart: [] };

function normalizePlan(raw: Partial<Plan> | null | undefined): Plan {
  return {
    years: typeof raw?.years === "number" ? raw.years : 4,
    slots: raw?.slots ?? {},
    programs: raw?.programs ?? ["gir"],
    cart: raw?.cart ?? [],
  };
}

// Signed out, plans live in this browser; signed in, on the backend (/plans).
const LOCAL_PLANS_KEY = "id-plans";
const LEGACY_PLAN_KEY = "id-plan";

export function signedIn(): boolean {
  return !!storage()?.getItem(TOKEN_KEY);
}

export function loadLocalPlans(): SavedPlan[] {
  try {
    const raw = storage()?.getItem(LOCAL_PLANS_KEY);
    if (raw)
      return (JSON.parse(raw) as SavedPlan[]).map((p) => ({ ...p, data: normalizePlan(p.data) }));
    const legacy = storage()?.getItem(LEGACY_PLAN_KEY); // the single plan from before plans existed
    return [
      {
        id: "local-1",
        name: "My plan",
        data: legacy ? normalizePlan(JSON.parse(legacy)) : structuredClone(DEFAULT_PLAN),
      },
    ];
  } catch {
    return [{ id: "local-1", name: "My plan", data: structuredClone(DEFAULT_PLAN) }];
  }
}

export function saveLocalPlans(plans: SavedPlan[]) {
  try {
    storage()?.setItem(LOCAL_PLANS_KEY, JSON.stringify(plans));
  } catch {
    // private mode or full storage: plans still work for this visit
  }
}

type ApiPlan = { id: number; name: string; data: Partial<Plan> };
const toSaved = (p: ApiPlan): SavedPlan => ({
  id: String(p.id),
  name: p.name,
  data: normalizePlan(p.data),
});

export async function listRemotePlans(): Promise<SavedPlan[]> {
  return (await request<{ plans: ApiPlan[] }>("/plans")).plans.map(toSaved);
}
export async function createRemotePlan(name: string, data: Plan): Promise<SavedPlan> {
  return toSaved(await request<ApiPlan>("/plans", { method: "POST", body: { name, data } }));
}
export async function saveRemotePlan(plan: SavedPlan): Promise<void> {
  await request(`/plans/${plan.id}`, { method: "PUT", body: { name: plan.name, data: plan.data } });
}
export async function deleteRemotePlan(id: string): Promise<void> {
  await request(`/plans/${id}`, { method: "DELETE" });
}

// ---- Degree requirements (imported from MIT's official pages) ----
export type ProgramKind = "gir" | "major" | "minor" | "concentration";
export interface ProgramSummary {
  id: string;
  kind: ProgramKind;
  name: string;
  code: string;
  sourceUrl: string;
  checked: number;
  requirements: number;
}
export interface RequirementProgress {
  type: "courses" | "attribute" | "prefix" | "manual";
  section: string;
  label: string;
  status: "done" | "partial" | "todo" | "manual";
  fraction: number | null;
  credited: string[];
  options: string[][];
}
export interface ProgramProgress {
  id: string;
  kind: ProgramKind;
  name: string;
  code: string;
  sourceUrl: string;
  notes: string;
  percent: number;
  met: number;
  checked: number;
  manual: number;
  requirements: RequirementProgress[];
  /** minors only: courses also counted toward a major (allowed only with approval) */
  overlap: string[];
  overlapNote: string;
}

type ApiProgram = {
  id: string;
  kind: ProgramKind;
  name: string;
  code: string;
  source_url: string;
  checked: number;
  requirements: number;
};

export async function listPrograms(kind?: ProgramKind, q = ""): Promise<ProgramSummary[]> {
  const params = new URLSearchParams({ q });
  if (kind) params.set("kind", kind);
  const body = await request<{ programs: ApiProgram[] }>(`/programs?${params}`);
  return body.programs.map((p) => ({
    id: p.id,
    kind: p.kind,
    name: p.name,
    code: p.code,
    sourceUrl: p.source_url,
    checked: p.checked,
    requirements: p.requirements,
  }));
}

type ApiProgress = Omit<ApiProgram, "checked" | "requirements"> & {
  notes: string;
  percent: number;
  requirements_met: number;
  requirements_checked: number;
  overlap?: string[];
  overlap_note?: string;
  requirements_manual: number;
  requirements: RequirementProgress[];
};

export async function getProgress(
  programs: string[],
  courses: string[],
): Promise<{ programs: ProgramProgress[]; warnings: string[] }> {
  if (!programs.length) return { programs: [], warnings: [] };
  const body = await request<{ programs: ApiProgress[]; warnings: string[] }>(
    "/requirements/progress",
    {
      method: "POST",
      body: { programs, courses },
    },
  );
  return {
    warnings: body.warnings,
    programs: body.programs.map((p) => ({
      id: p.id,
      kind: p.kind,
      name: p.name,
      code: p.code,
      sourceUrl: p.source_url,
      notes: p.notes,
      percent: p.percent,
      met: p.requirements_met,
      checked: p.requirements_checked,
      manual: p.requirements_manual,
      requirements: p.requirements,
      overlap: p.overlap ?? [],
      overlapNote: p.overlap_note ?? "",
    })),
  };
}

/** Every course a program's requirements name (to isolate it on the graph). */
export async function getProgramCourses(id: string): Promise<string[]> {
  return (await request<{ courses: string[] }>(`/programs/${encodeURIComponent(id)}`)).courses;
}

/** Program requirements with a single required subject, for a bundle's cart. */
export async function getRequiredCourses(id: string): Promise<string[]> {
  const { programs } = await getProgress([id], []);
  return [
    ...new Set(
      (programs[0]?.requirements ?? [])
        .filter((r) => r.type === "courses" && r.options.length === 1)
        .flatMap((r) => r.options[0] ?? []),
    ),
  ].map((c) => c.replace("[J]", ""));
}

// ---- Predicted schedule ----
// Meeting times aren't in the catalog API, so these are sample times for a few courses.
// Whether a course runs in a term at all comes from the catalog (CourseSummary.terms).
export type { Meeting };
export function meetingsFor(courseId: string, season: Season): Meeting[] {
  return SAMPLE_MEETINGS[courseId]?.[season] ?? [];
}
