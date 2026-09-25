"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { SPACE_COLOR_STYLES, SPACE_ICONS, SpaceTile } from "@/components/space-visuals";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { errorMessage, fieldErrors } from "@/lib/api";
import { useCreateSpace, useUpdateSpace, type SpaceInput } from "@/lib/queries";
import { SPACE_COLOR_KEYS, SPACE_ICON_KEYS, type Space } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  space?: Space;
  onSaved?: (space: Space) => void;
}

export function SpaceFormDialog({ open, onOpenChange, space, onSaved }: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={space ? "Edit space" : "Create a space"}
      description={space ? undefined : "A Space is a broad learning area, e.g. “Machine Learning” or “Spanish”."}
    >
      {/* Dialog content mounts on open, so the form starts from fresh props every time. */}
      <SpaceForm space={space} onClose={() => onOpenChange(false)} onSaved={onSaved} />
    </Dialog>
  );
}

function SpaceForm({ space, onClose, onSaved }: { space?: Space; onClose: () => void; onSaved?: (space: Space) => void }) {
  const create = useCreateSpace();
  const update = useUpdateSpace(space?.id ?? "");
  const [form, setForm] = useState<SpaceInput>(() =>
    space
      ? { name: space.name, description: space.description, color: space.color, icon: space.icon }
      : { name: "", description: "", color: "blue", icon: "book" },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pending = create.isPending || update.isPending;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    try {
      const saved = space ? await update.mutateAsync(form) : await create.mutateAsync(form);
      toast.success(space ? "Space updated" : `Space “${saved.name}” created`);
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
      <div className="flex items-center gap-3 rounded-xl border border-line bg-canvas/60 p-3">
        <SpaceTile color={form.color} icon={form.icon} />
        <div className="min-w-0">
          <p className="truncate font-display font-semibold text-ink">{form.name || "Your space"}</p>
          <p className="truncate text-xs text-muted">{form.description || "Description"}</p>
        </div>
      </div>

      <Field label="Name" htmlFor="space-name" error={errors.name}>
        <Input
          id="space-name"
          value={form.name}
          maxLength={80}
          placeholder="e.g. Machine Learning"
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          aria-invalid={!!errors.name}
          autoFocus
        />
      </Field>
      <Field label="Description" htmlFor="space-description" error={errors.description} hint="What is this area about?">
        <Textarea
          id="space-description"
          value={form.description}
          maxLength={500}
          rows={3}
          placeholder="e.g. Foundations of supervised learning, neural networks and model evaluation."
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          aria-invalid={!!errors.description}
        />
      </Field>

      <fieldset>
        <legend className="text-sm font-medium text-ink">Color</legend>
        <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Color">
          {SPACE_COLOR_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={form.color === key}
              aria-label={SPACE_COLOR_STYLES[key].label}
              title={SPACE_COLOR_STYLES[key].label}
              onClick={() => setForm((f) => ({ ...f, color: key }))}
              className={cn(
                "size-7 rounded-full ring-offset-2 transition",
                SPACE_COLOR_STYLES[key].swatch,
                form.color === key ? "ring-2 ring-blue-500" : "hover:scale-110",
              )}
            />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium text-ink">Icon</legend>
        <div className="mt-2 grid grid-cols-8 gap-1.5" role="radiogroup" aria-label="Icon">
          {SPACE_ICON_KEYS.map((key) => {
            const { Icon, label } = SPACE_ICONS[key];
            const selected = form.icon === key;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={label}
                title={label}
                onClick={() => setForm((f) => ({ ...f, icon: key }))}
                className={cn(
                  "flex aspect-square items-center justify-center rounded-lg border transition",
                  selected ? "border-blue-500 bg-blue-50 text-blue-700" : "border-line text-muted hover:border-line-strong hover:text-ink",
                )}
              >
                <Icon className="size-4" />
              </button>
            );
          })}
        </div>
      </fieldset>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending} disabled={!form.name.trim() || !form.description.trim()}>
          {space ? "Save changes" : "Create space"}
        </Button>
      </DialogFooter>
    </form>
  );
}
