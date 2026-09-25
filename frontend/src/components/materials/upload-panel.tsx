"use client";

import { AlertCircle, CheckCircle2, CloudUpload, FileText, X } from "lucide-react";
import { useCallback, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { ApiError, uploadFile } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { useInvalidateAfterUpload } from "@/lib/queries";
import type { Material } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAX_MB = 20; // mirrors the API's MAX_UPLOAD_MB; the server remains the authority

interface UploadItem {
  id: string;
  file: File;
  progress: number;
  state: "uploading" | "done" | "error";
  error?: string;
}

function precheck(file: File): string | null {
  // Fast feedback only: the API verifies the PDF signature, whatever the browser reports as the type.
  if (!/\.pdf$/i.test(file.name)) return "Only PDF files are supported.";
  if (file.size === 0) return "The file is empty.";
  if (file.size > MAX_MB * 1024 * 1024) return `The file exceeds the ${MAX_MB} MB limit.`;
  return null;
}

export function UploadPanel({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const invalidate = useInvalidateAfterUpload();

  const patch = (id: string, update: Partial<UploadItem>) =>
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...update } : item)));

  const startUploads = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const queued: UploadItem[] = files.map((file) => ({
        id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
        file,
        progress: 0,
        state: "uploading",
      }));
      setItems((list) => [...queued, ...list]);

      // Sequential: predictable progress, gentle on the upload rate limit.
      for (const item of queued) {
        const problem = precheck(item.file);
        if (problem) {
          patch(item.id, { state: "error", error: problem });
          continue;
        }
        try {
          const { material } = await uploadFile<{ material: Material }>(
            `/projects/${projectId}/materials`,
            item.file,
            {},
            (fraction) => patch(item.id, { progress: fraction }),
          );
          patch(item.id, { state: "done", progress: 1 });
          toast.success(`Uploaded “${material.title}”`, { description: "Queued for background processing." });
          void invalidate();
          setTimeout(() => setItems((list) => list.filter((i) => i.id !== item.id)), 4000);
        } catch (err) {
          const message = err instanceof ApiError ? err.message : "Upload failed.";
          patch(item.id, { state: "error", error: message });
        }
      }
    },
    [projectId, invalidate],
  );

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void startUploads(Array.from(event.dataTransfer.files));
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Upload PDF files"
        className={cn(
          "group relative flex cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border-2 border-dashed px-6 py-10 text-center transition",
          dragging ? "border-blue-500 bg-blue-50" : "border-line-strong bg-white hover:border-blue-400 hover:bg-blue-50/40",
        )}
      >
        <div className="bg-ai-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <span className="relative flex size-12 items-center justify-center rounded-2xl bg-linear-to-br from-blue-500 to-indigo-600 text-white shadow-glow transition group-hover:scale-105">
          <CloudUpload className="size-6" />
        </span>
        <div className="relative">
          <p className="font-medium text-ink">
            <span className="text-blue-700">Click to upload</span> or drag and drop PDFs
          </p>
          <p className="mt-1 text-sm text-muted">PDF only · up to {MAX_MB} MB each · processed in the background</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          data-testid="material-file-input"
          onChange={(e) => {
            void startUploads(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>

      {items.length > 0 && (
        <ul className="space-y-2" aria-live="polite">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5 shadow-card">
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg",
                  item.state === "error" ? "bg-red-50 text-red-500" : item.state === "done" ? "bg-emerald-50 text-emerald-600" : "bg-blue-50 text-blue-600",
                )}
              >
                {item.state === "error" ? <AlertCircle className="size-4" /> : item.state === "done" ? <CheckCircle2 className="size-4" /> : <FileText className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-medium text-ink">{item.file.name}</span>
                  <span className="shrink-0 text-xs text-muted tabular-nums">
                    {item.state === "uploading" ? `${Math.round(item.progress * 100)}%` : formatBytes(item.file.size)}
                  </span>
                </div>
                {item.state === "error" ? (
                  <p className="mt-0.5 text-xs text-red-600">{item.error}</p>
                ) : (
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={cn("h-full rounded-full transition-[width] duration-200", item.state === "done" ? "bg-emerald-500" : "bg-linear-to-r from-blue-500 to-indigo-500")}
                      style={{ width: `${Math.max(4, item.progress * 100)}%` }}
                    />
                  </div>
                )}
              </div>
              {item.state !== "uploading" && (
                <button
                  onClick={() => setItems((list) => list.filter((i) => i.id !== item.id))}
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-ink"
                  aria-label="Dismiss"
                >
                  <X className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
