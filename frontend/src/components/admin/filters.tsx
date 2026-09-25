"use client";

import { Select } from "@/components/ui/field";
import { useAdminProjects, useAdminSpaces, useAdminUsers } from "@/lib/queries";

// Option lists are capped at 100 entries; a typeahead replaces these once user counts grow.

export function UserFilter({ value, onChange }: { value: string; onChange: (userId: string) => void }) {
  const { data } = useAdminUsers({ limit: 100 });
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="sm:w-52" aria-label="User">
      <option value="">All users</option>
      {data?.items.map((user) => (
        <option key={user.id} value={user.id}>
          {user.name} ({user.email})
        </option>
      ))}
    </Select>
  );
}

export function SpaceFilter({ userId, value, onChange }: { userId: string; value: string; onChange: (spaceId: string) => void }) {
  const { data } = useAdminSpaces({ userId, limit: 100 });
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="sm:w-48" aria-label="Space">
      <option value="">All spaces</option>
      {data?.items.map((space) => (
        <option key={space.id} value={space.id}>
          {space.name}
          {!userId && space.owner ? ` — ${space.owner.name}` : ""}
        </option>
      ))}
    </Select>
  );
}

export function ProjectFilter({
  userId,
  spaceId,
  value,
  onChange,
}: {
  userId: string;
  spaceId: string;
  value: string;
  onChange: (projectId: string) => void;
}) {
  const { data } = useAdminProjects({ userId, spaceId, limit: 100 });
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="sm:w-48" aria-label="Project">
      <option value="">All projects</option>
      {data?.items.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name}
        </option>
      ))}
    </Select>
  );
}
