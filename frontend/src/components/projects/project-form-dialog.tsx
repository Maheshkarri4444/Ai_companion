"use client";

import { Target } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { errorMessage, fieldErrors } from "@/lib/api";
import { useCreateProject, useUpdateProject, type ProjectInput } from "@/lib/queries";
import type { Project } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId: string;
  spaceName?: string;
  project?: Project;
  onSaved?: (project: Project) => void;
}

export function ProjectFormDialog({ open, onOpenChange, spaceId, spaceName, project, onSaved }: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={project ? "Edit project" : "Start a new project"}
      description={
        project ? undefined : `A focused learning journey${spaceName ? ` inside ${spaceName}` : ""}, with its own goal, materials and progress.`
      }
    >
      <ProjectForm spaceId={spaceId} project={project} onClose={() => onOpenChange(false)} onSaved={onSaved} />
    </Dialog>
  );
}

function ProjectForm({
  spaceId,
  project,
  onClose,
  onSaved,
}: {
  spaceId: string;
  project?: Project;
  onClose: () => void;
  onSaved?: (project: Project) => void;
}) {
  const create = useCreateProject(spaceId);
  const update = useUpdateProject(project?.id ?? "");
  const [form, setForm] = useState<ProjectInput>(() =>
    project
      ? { name: project.name, description: project.description, learningGoal: project.learningGoal }
      : { name: "", description: "", learningGoal: "" },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pending = create.isPending || update.isPending;
  const complete = form.name.trim() && form.description.trim() && form.learningGoal.trim();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    try {
      const saved = project ? await update.mutateAsync(form) : await create.mutateAsync(form);
      toast.success(project ? "Project updated" : `Project “${saved.name}” created`);
      onClose();
      onSaved?.(saved);
    } catch (err) {
      const byField = fieldErrors(err);
      setErrors(byField);
      if (Object.keys(byField).length === 0) toast.error(errorMessage(err));
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <Field label="Project name" htmlFor="project-name" error={errors.name}>
        <Input
          id="project-name"
          value={form.name}
          maxLength={100}
          placeholder="e.g. Neural Networks Fundamentals"
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          aria-invalid={!!errors.name}
          autoFocus
        />
      </Field>
      <Field label="Description" htmlFor="project-description" error={errors.description}>
        <Textarea
          id="project-description"
          value={form.description}
          maxLength={1000}
          rows={3}
          placeholder="What will this project cover?"
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          aria-invalid={!!errors.description}
        />
      </Field>
      <Field
        label="Learning goal"
        htmlFor="project-goal"
        error={errors.learningGoal}
        hint="Your Tutor, quizzes and recommendations are tailored to this goal."
      >
        <div className="relative">
          <Target className="pointer-events-none absolute top-3 left-3.5 size-4 text-blue-500" />
          <Textarea
            id="project-goal"
            value={form.learningGoal}
            maxLength={500}
            rows={2}
            className="pl-10"
            placeholder="e.g. Explain backpropagation and implement a small network from scratch"
            onChange={(e) => setForm((f) => ({ ...f, learningGoal: e.target.value }))}
            aria-invalid={!!errors.learningGoal}
          />
        </div>
      </Field>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending} disabled={!complete}>
          {project ? "Save changes" : "Create project"}
        </Button>
      </DialogFooter>
    </form>
  );
}
