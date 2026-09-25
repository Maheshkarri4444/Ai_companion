"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type {
  AiCallDetail,
  AiCallSummary,
  AiConfiguration,
  AiOverview,
  Concept,
  Conversation,
  EvalRunDetail,
  EvaluationOverview,
  EvaluationRow,
  JobDetail,
  JobRow,
  JobsOverview,
  LearningItem,
  MaterialPageText,
  TutorMessage,
  TutorOverview,
  AdminActivityEvent,
  AdminMaterialRow,
  AdminOverview,
  AdminProjectRow,
  AdminSpaceRow,
  AdminUserDetail,
  AdminUserRow,
  HomeDashboard,
  Material,
  Paginated,
  Project,
  ProjectDashboard,
  Space,
  SpaceColor,
  SpaceDashboard,
  SpaceIcon,
  SystemHealth,
  User,
} from "./types";
import { toQueryString } from "./utils";

/** Centralised query keys: mutations invalidate by prefix. */
export const qk = {
  me: ["me"] as const,
  dashboard: ["dashboard"] as const,
  spaces: ["spaces"] as const,
  space: (id: string) => ["spaces", id] as const,
  projects: ["projects"] as const,
  project: (id: string) => ["projects", id] as const,
  materials: (projectId: string) => ["projects", projectId, "materials"] as const,
  concepts: (projectId: string) => ["projects", projectId, "concepts"] as const,
  tutor: (projectId: string) => ["projects", projectId, "tutor"] as const,
  conversation: (projectId: string, conversationId: string) => ["projects", projectId, "tutor", "conversation", conversationId] as const,
  memory: (projectId: string) => ["projects", projectId, "tutor", "memory"] as const,
  admin: ["admin"] as const,
};

// ── Session ───────────────────────────────────────────────────────────────
export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: async () => (await api.get<{ user: User }>("/auth/me")).user,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

// ── Learner workspace ─────────────────────────────────────────────────────
export function useDashboard() {
  return useQuery({ queryKey: qk.dashboard, queryFn: () => api.get<HomeDashboard>("/dashboard") });
}

export function useSpaces() {
  return useQuery({
    queryKey: qk.spaces,
    queryFn: async () => (await api.get<{ items: Space[] }>("/spaces")).items,
  });
}

export function useSpace(spaceId: string) {
  return useQuery({ queryKey: qk.space(spaceId), queryFn: () => api.get<SpaceDashboard>(`/spaces/${spaceId}`) });
}

export function useProject(projectId: string) {
  return useQuery({ queryKey: qk.project(projectId), queryFn: () => api.get<ProjectDashboard>(`/projects/${projectId}`) });
}

export function useMaterials(projectId: string) {
  return useQuery({
    queryKey: qk.materials(projectId),
    queryFn: async () => (await api.get<{ items: Material[] }>(`/projects/${projectId}/materials`)).items,
    // Background processing is observable: poll while anything is still queued or processing.
    refetchInterval: (query) =>
      query.state.data?.some((m) => m.status === "queued" || m.status === "processing") ? 2500 : false,
  });
}

export function useRetryMaterial(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (materialId: string) =>
      (await api.post<{ material: Material }>(`/projects/${projectId}/materials/${materialId}/retry`)).material,
    onSuccess: () => client.invalidateQueries({ queryKey: qk.project(projectId) }),
  });
}

export function useConcepts(projectId: string, enabled = true) {
  return useQuery({
    queryKey: qk.concepts(projectId),
    queryFn: async () => (await api.get<{ items: Concept[] }>(`/projects/${projectId}/concepts`)).items,
    enabled,
  });
}

export function useMaterialPage(projectId: string, materialId: string | null, page: number | null) {
  return useQuery({
    queryKey: ["projects", projectId, "materials", materialId, "pages", page],
    queryFn: async () => (await api.get<{ page: MaterialPageText }>(`/projects/${projectId}/materials/${materialId}/pages/${page}`)).page,
    enabled: Boolean(materialId && page),
    staleTime: 5 * 60_000,
  });
}

// ── AI Tutor (Zoya) ───────────────────────────────────────────────────────
export function useTutorOverview(projectId: string) {
  return useQuery({ queryKey: qk.tutor(projectId), queryFn: () => api.get<TutorOverview>(`/projects/${projectId}/tutor`) });
}

export function useConversation(projectId: string, conversationId: string | null) {
  return useQuery({
    queryKey: qk.conversation(projectId, conversationId ?? "none"),
    queryFn: () =>
      api.get<{ conversation: Conversation; messages: TutorMessage[]; hasMore: boolean }>(
        `/projects/${projectId}/tutor/conversations/${conversationId}`,
      ),
    enabled: Boolean(conversationId),
  });
}

export function useRenameConversation(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, title }: { conversationId: string; title: string }) =>
      (await api.patch<{ conversation: Conversation }>(`/projects/${projectId}/tutor/conversations/${conversationId}`, { title })).conversation,
    onSuccess: () => client.invalidateQueries({ queryKey: qk.tutor(projectId) }),
  });
}

export function useDeleteConversation(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => api.delete(`/projects/${projectId}/tutor/conversations/${conversationId}`),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.tutor(projectId) }),
  });
}

export function useTutorFeedback(projectId: string) {
  return useMutation({
    mutationFn: async ({ messageId, rating, reason }: { messageId: string; rating: "up" | "down"; reason?: string }) =>
      (await api.post<{ message: TutorMessage }>(`/projects/${projectId}/tutor/messages/${messageId}/feedback`, { rating, reason })).message,
  });
}

export function useTutorMemory(projectId: string, enabled = true) {
  return useQuery({
    queryKey: qk.memory(projectId),
    queryFn: async () => (await api.get<{ items: LearningItem[] }>(`/projects/${projectId}/tutor/memory`)).items,
    enabled,
  });
}

export function useForgetMemory(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => api.delete(`/projects/${projectId}/tutor/memory/${itemId}`),
    onSuccess: () =>
      Promise.all([client.invalidateQueries({ queryKey: qk.memory(projectId) }), client.invalidateQueries({ queryKey: qk.tutor(projectId) })]),
  });
}

/** Workspace writes touch several views (lists, dashboards, counts); refresh them all. */
function useInvalidateWorkspace() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: qk.spaces }),
      client.invalidateQueries({ queryKey: qk.projects }),
      client.invalidateQueries({ queryKey: qk.dashboard }),
    ]);
}

export interface SpaceInput {
  name: string;
  description: string;
  color: SpaceColor;
  icon: SpaceIcon;
}

export function useCreateSpace() {
  const invalidate = useInvalidateWorkspace();
  return useMutation({
    mutationFn: async (input: SpaceInput) => (await api.post<{ space: Space }>("/spaces", input)).space,
    onSuccess: invalidate,
  });
}

export function useUpdateSpace(spaceId: string) {
  const invalidate = useInvalidateWorkspace();
  return useMutation({
    mutationFn: async (input: Partial<SpaceInput>) => (await api.patch<{ space: Space }>(`/spaces/${spaceId}`, input)).space,
    onSuccess: invalidate,
  });
}

export function useDeleteSpace() {
  const invalidate = useInvalidateWorkspace();
  return useMutation({ mutationFn: (spaceId: string) => api.delete(`/spaces/${spaceId}`), onSuccess: invalidate });
}

export interface ProjectInput {
  name: string;
  description: string;
  learningGoal: string;
}

export function useCreateProject(spaceId: string) {
  const invalidate = useInvalidateWorkspace();
  return useMutation({
    mutationFn: async (input: ProjectInput) =>
      (await api.post<{ project: Project }>(`/spaces/${spaceId}/projects`, input)).project,
    onSuccess: invalidate,
  });
}

export function useUpdateProject(projectId: string) {
  const invalidate = useInvalidateWorkspace();
  return useMutation({
    mutationFn: async (input: Partial<ProjectInput>) =>
      (await api.patch<{ project: Project }>(`/projects/${projectId}`, input)).project,
    onSuccess: invalidate,
  });
}

export function useDeleteProject() {
  const invalidate = useInvalidateWorkspace();
  return useMutation({ mutationFn: (projectId: string) => api.delete(`/projects/${projectId}`), onSuccess: invalidate });
}

export function useRenameMaterial(projectId: string) {
  const invalidate = useInvalidateWorkspace();
  return useMutation({
    mutationFn: async ({ materialId, title }: { materialId: string; title: string }) =>
      (await api.patch<{ material: Material }>(`/projects/${projectId}/materials/${materialId}`, { title })).material,
    onSuccess: invalidate,
  });
}

export function useDeleteMaterial(projectId: string) {
  const invalidate = useInvalidateWorkspace();
  return useMutation({
    mutationFn: (materialId: string) => api.delete(`/projects/${projectId}/materials/${materialId}`),
    onSuccess: invalidate,
  });
}

export function useInvalidateAfterUpload() {
  return useInvalidateWorkspace();
}

// ── Admin ─────────────────────────────────────────────────────────────────
type Params = Record<string, string | number | undefined>;

function useAdminQuery<T>(path: string, params?: Params, options: { refetchInterval?: number } = {}) {
  const qs = params ? toQueryString(params) : "";
  return useQuery({
    queryKey: [...qk.admin, path, qs],
    queryFn: () => api.get<T>(`/admin${path}${qs}`),
    // Refetches keep the previous frame on screen instead of flashing skeletons.
    placeholderData: keepPreviousData,
    refetchInterval: options.refetchInterval,
  });
}

export const useAdminOverview = () => useAdminQuery<AdminOverview>("/overview");
export const useAdminUsers = (params: Params) => useAdminQuery<Paginated<AdminUserRow>>("/users", params);
export const useAdminUser = (userId: string) => useAdminQuery<AdminUserDetail>(`/users/${userId}`);
export const useAdminSpaces = (params: Params) => useAdminQuery<Paginated<AdminSpaceRow>>("/spaces", params);
export const useAdminProjects = (params: Params) => useAdminQuery<Paginated<AdminProjectRow>>("/projects", params);
export const useAdminMaterials = (params: Params) => useAdminQuery<Paginated<AdminMaterialRow>>("/materials", params);
export const useAdminActivity = (params: Params) => useAdminQuery<Paginated<AdminActivityEvent>>("/activity", params);
export const useAdminActivityTypes = () => useAdminQuery<{ items: string[] }>("/activity/types");
export const useSystemHealth = () => useAdminQuery<SystemHealth>("/system/health", undefined, { refetchInterval: 15_000 });

// Admin — AI observability & background processing
export const useAiOverview = (range: string) => useAdminQuery<AiOverview>("/ai/overview", { range }, { refetchInterval: 30_000 });
export const useAiCalls = (params: Params) => useAdminQuery<Paginated<AiCallSummary>>("/ai/calls", params);
export const useAiCall = (callId: string | null) =>
  useQuery({ queryKey: [...qk.admin, "ai-call", callId], queryFn: () => api.get<AiCallDetail>(`/admin/ai/calls/${callId}`), enabled: Boolean(callId) });
export const useAiConfig = () => useAdminQuery<AiConfiguration>("/ai/config");
export const useEvaluationOverview = (range: string) => useAdminQuery<EvaluationOverview>("/ai/evaluations/overview", { range });
export const useEvaluations = (params: Params) => useAdminQuery<Paginated<EvaluationRow>>("/ai/evaluations", params);
export const useEvalRun = (runId: string | null) =>
  useQuery({ queryKey: [...qk.admin, "eval-run", runId], queryFn: () => api.get<EvalRunDetail>(`/admin/ai/eval-runs/${runId}`), enabled: Boolean(runId) });
export const useJobsOverview = () => useAdminQuery<JobsOverview>("/jobs/overview", undefined, { refetchInterval: 5_000 });
export const useJobs = (params: Params) => useAdminQuery<Paginated<JobRow>>("/jobs", params, { refetchInterval: 5_000 });
export const useJob = (jobId: string | null) =>
  useQuery({ queryKey: [...qk.admin, "job", jobId], queryFn: () => api.get<JobDetail>(`/admin/jobs/${jobId}`), enabled: Boolean(jobId) });

export function useRetryJob() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => (await api.post<{ job: JobRow }>(`/admin/jobs/${jobId}/retry`)).job,
    onSuccess: () => client.invalidateQueries({ queryKey: qk.admin }),
  });
}
