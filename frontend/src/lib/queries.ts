"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type {
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
export const useSystemHealth = () => useAdminQuery<SystemHealth>("/system/health", undefined, { refetchInterval: 30_000 });
