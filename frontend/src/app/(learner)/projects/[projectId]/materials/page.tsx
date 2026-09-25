"use client";

import { ExternalLink, FileText, Info, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { UploadPanel } from "@/components/materials/upload-panel";
import { MaterialStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog, Dialog, DialogFooter } from "@/components/ui/dialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { errorMessage } from "@/lib/api";
import { formatBytes, formatDateTime, pluralize, timeAgo } from "@/lib/format";
import { useDeleteMaterial, useMaterials, useRenameMaterial } from "@/lib/queries";
import type { Material } from "@/lib/types";

function RenameDialog({ projectId, material, onClose }: { projectId: string; material?: Material; onClose: () => void }) {
  return (
    <Dialog open={Boolean(material)} onOpenChange={(open) => !open && onClose()} title="Rename material" size="sm">
      {material && <RenameForm projectId={projectId} material={material} onClose={onClose} />}
    </Dialog>
  );
}

function RenameForm({ projectId, material, onClose }: { projectId: string; material: Material; onClose: () => void }) {
  const rename = useRenameMaterial(projectId);
  const [title, setTitle] = useState(material.title);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      await rename.mutateAsync({ materialId: material.id, title });
      toast.success("Material renamed");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Field label="Title" htmlFor="material-title" hint={`File: ${material.originalFilename}`}>
        <Input id="material-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </Field>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={rename.isPending}>
          Cancel
        </Button>
        <Button type="submit" loading={rename.isPending} disabled={!title.trim() || title.trim() === material.title}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

function fileUrl(material: Material) {
  return `/api/projects/${material.projectId}/materials/${material.id}/file`;
}

export default function MaterialsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: materials, isLoading, error, refetch } = useMaterials(projectId);
  const deleteMaterial = useDeleteMaterial(projectId);
  const [renaming, setRenaming] = useState<Material | undefined>();
  const [deleting, setDeleting] = useState<Material | undefined>();

  const pending = materials?.filter((m) => m.status === "queued" || m.status === "processing").length ?? 0;

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await deleteMaterial.mutateAsync(deleting.id);
      toast.success(`Removed “${deleting.title}”`);
      setDeleting(undefined);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <UploadPanel projectId={projectId} />

      {pending > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm text-blue-900">
          <Info className="mt-0.5 size-4 shrink-0 text-blue-600" />
          <p>
            {pluralize(pending, "material")} {pending === 1 ? "is" : "are"} queued for background processing (text extraction, OCR,
            concepts and search index). You don&apos;t need to keep this page open.
          </p>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-[15px] font-semibold text-ink">Learning materials</h2>
            <p className="text-sm text-muted">{materials ? pluralize(materials.length, "document") : "—"}</p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : error ? (
          <div className="p-5">
            <ErrorState error={error} onRetry={() => refetch()} />
          </div>
        ) : !materials || materials.length === 0 ? (
          <div className="p-5">
            <EmptyState
              compact
              icon={<FileText />}
              title="No materials yet"
              description="Upload lecture notes, book chapters or papers as PDFs. Your Tutor will answer from them and cite the pages."
            />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {materials.map((material) => (
              <li key={material.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 transition-colors hover:bg-slate-50/70">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-500">
                  <FileText className="size-5" />
                </span>
                <div className="min-w-0 flex-1 basis-56">
                  <a
                    href={fileUrl(material)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate font-medium text-ink hover:text-blue-700"
                  >
                    {material.title}
                  </a>
                  <p className="truncate text-xs text-muted">
                    {material.originalFilename} · {formatBytes(material.sizeBytes)}
                    {material.pageCount ? ` · ${pluralize(material.pageCount, "page")}` : ""}
                  </p>
                </div>
                <MaterialStatusBadge status={material.status} error={material.processing.error?.message} />
                <span className="w-28 text-right text-xs text-muted" title={formatDateTime(material.createdAt)}>
                  {timeAgo(material.createdAt)}
                </span>
                <div className="flex items-center gap-1">
                  <a
                    href={fileUrl(material)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg p-2 text-muted hover:bg-slate-100 hover:text-ink"
                    aria-label={`Open ${material.title}`}
                    title="Open PDF"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                  <Menu
                    trigger={
                      <Button variant="ghost" size="icon" aria-label={`Actions for ${material.title}`}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                    }
                  >
                    <MenuItem icon={<Pencil />} onSelect={() => setRenaming(material)}>
                      Rename
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem icon={<Trash2 />} onSelect={() => setDeleting(material)} danger>
                      Delete
                    </MenuItem>
                  </Menu>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <RenameDialog projectId={projectId} material={renaming} onClose={() => setRenaming(undefined)} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(undefined)}
        title="Delete this material?"
        description={
          deleting && (
            <>
              <strong className="text-ink">{deleting.title}</strong> and its stored file will be permanently deleted.
            </>
          )
        }
        confirmLabel="Delete material"
        onConfirm={confirmDelete}
        loading={deleteMaterial.isPending}
      />
    </div>
  );
}
