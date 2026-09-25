"use client";

import { Layers, Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { SpaceFormDialog } from "@/components/spaces/space-form-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/misc";
import { SpaceCard } from "@/components/workspace-cards";
import { errorMessage } from "@/lib/api";
import { pluralize } from "@/lib/format";
import { useDeleteSpace, useSpaces } from "@/lib/queries";
import type { Space } from "@/lib/types";

function SpacesView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: spaces, isLoading, error, refetch } = useSpaces();
  const deleteSpace = useDeleteSpace();
  const [formOpenState, setFormOpenState] = useState(false);
  const [editing, setEditing] = useState<Space | undefined>();
  const [deleting, setDeleting] = useState<Space | undefined>();

  // Deep link from "Create a Space" CTAs (/spaces?new=1): derived from the URL, cleared on close.
  const deepLinked = searchParams.get("new") === "1";
  const formOpen = formOpenState || deepLinked;
  const setFormOpen = (open: boolean) => {
    setFormOpenState(open);
    if (!open && deepLinked) router.replace("/spaces");
  };

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await deleteSpace.mutateAsync(deleting.id);
      toast.success(`Deleted “${deleting.name}”`);
      setDeleting(undefined);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="animate-rise">
      <PageHeader
        title="Spaces"
        description="Broad learning areas. Each Space holds focused Projects with their own goals and materials."
        actions={
          <Button
            onClick={() => {
              setEditing(undefined);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" /> New space
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : spaces && spaces.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {spaces.map((space) => (
            <SpaceCard
              key={space.id}
              space={space}
              onEdit={() => {
                setEditing(space);
                setFormOpen(true);
              }}
              onDelete={() => setDeleting(space)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Layers />}
          title="Create your first Space"
          description="A Space can be a technical skill, a certification, a professional goal or a personal interest — anything you want to learn."
          action={
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="size-4" /> New space
            </Button>
          }
        />
      )}

      <SpaceFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        space={editing}
        onSaved={(space) => {
          if (!editing) router.push(`/spaces/${space.id}`);
        }}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(undefined)}
        title="Delete this space?"
        description={
          deleting && (
            <>
              <strong className="text-ink">{deleting.name}</strong> will be permanently deleted together with its{" "}
              {pluralize(deleting.projectCount, "project")} and {pluralize(deleting.materialCount, "uploaded material")}. This
              cannot be undone.
            </>
          )
        }
        confirmLabel="Delete space"
        onConfirm={confirmDelete}
        loading={deleteSpace.isPending}
      />
    </div>
  );
}

export default function SpacesPage() {
  return (
    <Suspense>
      <SpacesView />
    </Suspense>
  );
}
