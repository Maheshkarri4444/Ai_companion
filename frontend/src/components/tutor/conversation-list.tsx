"use client";

import { MessageSquarePlus, MessagesSquare, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { errorMessage } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useDeleteConversation, useRenameConversation } from "@/lib/queries";
import type { Conversation } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ConversationList({
  projectId,
  conversations,
  activeId,
  onSelect,
  onNew,
  onDeleted,
}: {
  projectId: string;
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDeleted: (id: string) => void;
}) {
  const [renaming, setRenaming] = useState<Conversation | null>(null);
  const [deleting, setDeleting] = useState<Conversation | null>(null);
  const remove = useDeleteConversation(projectId);

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      toast.success("Conversation deleted");
      onDeleted(deleting.id);
      setDeleting(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="flex h-full flex-col">
      <Button onClick={onNew} variant="secondary" className="w-full justify-start">
        <MessageSquarePlus className="size-4 text-blue-600" /> New conversation
      </Button>
      <p className="mt-4 mb-1.5 px-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Conversations</p>
      {conversations.length === 0 ? (
        <p className="flex items-center gap-2 px-1 py-3 text-sm text-muted">
          <MessagesSquare className="size-4" /> No conversations yet
        </p>
      ) : (
        <ul className="scrollbar-thin -mx-1 flex-1 space-y-0.5 overflow-y-auto px-1">
          {conversations.map((c) => (
            <li key={c.id} className="group relative">
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                aria-current={c.id === activeId ? "true" : undefined}
                className={cn(
                  "w-full rounded-xl px-3 py-2 pr-9 text-left transition-colors",
                  c.id === activeId ? "bg-blue-50 ring-1 ring-blue-200" : "hover:bg-slate-100",
                )}
              >
                <span className={cn("block truncate text-sm font-medium", c.id === activeId ? "text-blue-800" : "text-ink")}>{c.title}</span>
                <span className="block truncate text-xs text-muted">
                  {timeAgo(c.lastMessageAt)} · {c.lastMessagePreview || "—"}
                </span>
              </button>
              <div className="absolute top-1.5 right-1 opacity-100 transition-opacity lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100">
                <Menu
                  trigger={
                    <Button variant="ghost" size="icon" className="size-7" aria-label={`Actions for ${c.title}`}>
                      <MoreHorizontal className="size-4" />
                    </Button>
                  }
                >
                  <MenuItem icon={<Pencil />} onSelect={() => setRenaming(c)}>
                    Rename
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem icon={<Trash2 />} onSelect={() => setDeleting(c)} danger>
                    Delete
                  </MenuItem>
                </Menu>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={Boolean(renaming)} onOpenChange={(open) => !open && setRenaming(null)} title="Rename conversation" size="sm">
        {renaming && <RenameForm projectId={projectId} conversation={renaming} onClose={() => setRenaming(null)} />}
      </Dialog>
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this conversation?"
        description={
          deleting && (
            <>
              <strong className="text-ink">{deleting.title}</strong> and all its messages will be deleted. What Zoya learned about you is
              kept (you can manage it under “What Zoya remembers”).
            </>
          )
        }
        confirmLabel="Delete conversation"
        onConfirm={confirmDelete}
        loading={remove.isPending}
      />
    </div>
  );
}

function RenameForm({ projectId, conversation, onClose }: { projectId: string; conversation: Conversation; onClose: () => void }) {
  const rename = useRenameConversation(projectId);
  const [title, setTitle] = useState(conversation.title);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      await rename.mutateAsync({ conversationId: conversation.id, title: title.trim() });
      toast.success("Conversation renamed");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Field label="Title" htmlFor="conversation-title">
        <Input id="conversation-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </Field>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={rename.isPending}>
          Cancel
        </Button>
        <Button type="submit" loading={rename.isPending} disabled={!title.trim() || title.trim() === conversation.title}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
