// Mirrors the API's DTOs (backend/src/modules/serializers.ts).

export type Role = "user" | "admin";
export type MaterialStatus = "queued" | "processing" | "ready" | "failed";
export type StatusCounts = Record<MaterialStatus, number>;

export const SPACE_COLOR_KEYS = ["blue", "indigo", "violet", "cyan", "teal", "emerald", "amber", "rose", "slate"] as const;
export type SpaceColor = (typeof SPACE_COLOR_KEYS)[number];

export const SPACE_ICON_KEYS = [
  "book", "brain", "code", "flask", "calculator", "globe", "palette", "music",
  "briefcase", "rocket", "cpu", "languages", "chart", "atom", "scale", "graduation",
] as const;
export type SpaceIcon = (typeof SPACE_ICON_KEYS)[number];

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: "active" | "disabled";
  createdAt: string;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
}

export interface SpaceSummary {
  id: string;
  name: string;
  color: SpaceColor;
  icon: SpaceIcon;
}

export interface Space extends SpaceSummary {
  description: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  projectCount: number;
  materialCount: number;
}

export interface Project {
  id: string;
  spaceId: string;
  name: string;
  description: string;
  learningGoal: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  materialCount: number;
  materialStatusCounts: StatusCounts;
}

export interface RecentProject extends Project {
  space: SpaceSummary | null;
}

export interface Material {
  id: string;
  projectId: string;
  spaceId: string;
  title: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: MaterialStatus;
  pageCount: number | null;
  processing: {
    stage: string | null;
    progress: number;
    attempts: number;
    error: { code: string; message: string } | null;
  };
  createdAt: string;
  updatedAt: string;
}

export type ActivityType =
  | "user.registered"
  | "user.logged_in"
  | "space.created"
  | "space.updated"
  | "space.deleted"
  | "project.created"
  | "project.updated"
  | "project.deleted"
  | "material.uploaded"
  | "material.updated"
  | "material.deleted";

export interface ActivityEvent {
  id: string;
  type: ActivityType;
  ownerId: string;
  actorId: string | null;
  spaceId: string | null;
  projectId: string | null;
  materialId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type NextStep =
  | { kind: "create_space" }
  | { kind: "create_project"; spaceId: string; spaceName: string }
  | { kind: "upload_material"; projectId: string; projectName: string }
  | { kind: "await_processing"; projectId: string; projectName: string; pendingCount: number }
  | { kind: "retry_failed"; projectId: string; projectName: string; failedCount: number }
  | { kind: "continue_project"; projectId: string; projectName: string };

export interface HomeDashboard {
  stats: { spaceCount: number; projectCount: number; materialCount: number; totalBytes: number; materialsByStatus: StatusCounts };
  continueLearning: RecentProject | null;
  recentProjects: RecentProject[];
  recentActivity: ActivityEvent[];
  nextStep: NextStep;
}

export interface SpaceDashboard {
  space: Space;
  projects: Project[];
  stats: { projectCount: number; materialCount: number; totalBytes: number; materialsByStatus: StatusCounts };
  recentActivity: ActivityEvent[];
}

export interface ProjectDashboard {
  project: Project;
  space: SpaceSummary | null;
  stats: { materialCount: number; totalBytes: number; totalPages: number; materialsByStatus: StatusCounts };
  recentMaterials: Material[];
  recentActivity: ActivityEvent[];
  nextStep: NextStep;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

// ── Admin ─────────────────────────────────────────────────────────────────
export interface UserRef {
  id: string;
  name: string;
  email: string;
}

export interface AdminActivityEvent extends ActivityEvent {
  user: UserRef | null;
  actor: UserRef | null;
}

export interface AdminOverview {
  kpis: {
    learners: number;
    admins: number;
    newLearners7d: number;
    activeLearners7d: number;
    spaces: number;
    projects: number;
    materials: number;
    materialsByStatus: StatusCounts;
    storageBytes: number;
    events24h: number;
  };
  activitySeries: Array<{ date: string; events: number; activeUsers: number; signups: number }>;
  topEventTypes: Array<{ type: ActivityType; count: number }>;
  recentUsers: User[];
  recentActivity: AdminActivityEvent[];
}

export interface AdminUserRow extends User {
  counts: { spaces: number; projects: number; materials: number; storageBytes: number };
}

export interface AdminUserDetail {
  user: User;
  stats: {
    spaceCount: number;
    projectCount: number;
    materialCount: number;
    totalBytes: number;
    materialsByStatus: StatusCounts;
    eventCount: number;
  };
  spaces: Array<Space & { projects: Project[] }>;
  materials: Array<Material & { projectName: string | null }>;
  recentActivity: ActivityEvent[];
}

export interface AdminSpaceRow extends Space {
  owner: UserRef | null;
}

export interface AdminProjectRow extends Project {
  owner: UserRef | null;
  space: SpaceSummary | null;
}

export interface AdminMaterialRow extends Material {
  owner: UserRef | null;
  project: { id: string; name: string | null };
  space: { id: string; name: string | null };
}

export interface SystemHealth {
  status: "ok" | "degraded";
  checkedAt: string;
  api: {
    status: string;
    version: string;
    nodeVersion: string;
    environment: string;
    role: string;
    uptimeSec: number;
    memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number };
  };
  database: {
    status: "up" | "down";
    latencyMs: number | null;
    name: string;
    collections: number | null;
    objects: number | null;
    dataSizeBytes: number | null;
    storageSizeBytes: number | null;
    indexSizeBytes: number | null;
  };
  storage: { status: string; provider: string; files: number | null; totalBytes: number | null };
  ai: {
    status: "configured" | "not_configured";
    provider: string;
    models: { primary: string; fallbacks: string[]; light: string; embedding: string };
  };
  worker: { status: string; detail: string };
}
