"use client";

import { ArrowUp, BookMarked, Lightbulb, ListChecks, NotebookPen, Sparkles, Square } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import type { TutorAction } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ACTION_LABELS } from "./chat-message";

const QUICK_ACTIONS: Array<{ action: Exclude<TutorAction, "general_knowledge">; label: string; icon: typeof Sparkles; needsTopic: boolean }> = [
  { action: "simplify", label: "Simpler", icon: Sparkles, needsTopic: true },
  { action: "example", label: "Example", icon: Lightbulb, needsTopic: true },
  { action: "check_understanding", label: "Test me", icon: ListChecks, needsTopic: true },
  { action: "summarize", label: "Summarize", icon: NotebookPen, needsTopic: false },
  { action: "revision", label: "Revision plan", icon: BookMarked, needsTopic: false },
];

const MAX_LENGTH = 4000;

export function Composer({
  busy,
  disabled,
  hasTopic,
  initialText = "",
  onSend,
  onAction,
  onStop,
}: {
  busy: boolean;
  /** Pre-filled question (e.g. "Explain Backpropagation" from the concept list) — never auto-sent. */
  initialText?: string;
  disabled?: boolean;
  /** Follow-up actions ("simpler", "example") need a previous answer to refer to. */
  hasTopic: boolean;
  onSend: (text: string) => void;
  onAction: (action: Exclude<TutorAction, "general_knowledge">, label: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState(initialText);
  const ref = useRef<HTMLTextAreaElement>(null);

  function resize() {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }

  function submit() {
    const value = text.trim();
    if (!value || busy || disabled) return;
    onSend(value);
    setText("");
    requestAnimationFrame(resize);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="scrollbar-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
        {QUICK_ACTIONS.map(({ action, label, icon: Icon, needsTopic }) => (
          <button
            key={action}
            type="button"
            disabled={busy || disabled || (needsTopic && !hasTopic)}
            onClick={() => onAction(action, ACTION_LABELS[action])}
            title={needsTopic && !hasTopic ? "Ask a question first" : ACTION_LABELS[action]}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:pointer-events-none disabled:opacity-45"
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>
      <div
        className={cn(
          "flex items-end gap-2 rounded-2xl border bg-white p-2 pl-4 shadow-card transition-shadow",
          "border-line-strong focus-within:border-blue-400 focus-within:shadow-glow",
        )}
      >
        <textarea
          ref={ref}
          value={text}
          rows={1}
          maxLength={MAX_LENGTH}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            resize();
          }}
          onKeyDown={onKeyDown}
          placeholder={disabled ? "Add a processed material to start learning with Zoya" : "Ask Zoya about your materials…"}
          aria-label="Message Zoya"
          className="scrollbar-thin max-h-44 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[15px] text-ink outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
        />
        {busy ? (
          <button
            type="button"
            onClick={onStop}
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white transition-colors hover:bg-slate-700"
            aria-label="Stop answering"
            title="Stop"
          >
            <Square className="size-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim() || disabled}
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-blue-600 to-indigo-600 text-white shadow-[0_8px_20px_-8px_rgb(37_99_235/0.8)] transition-opacity disabled:opacity-40"
            aria-label="Send"
            title="Send (Enter)"
          >
            <ArrowUp className="size-4.5" />
          </button>
        )}
      </div>
      <p className="px-1 text-[11px] text-muted">
        Zoya answers from your Project materials and cites the pages. Enter to send · Shift + Enter for a new line.
      </p>
    </div>
  );
}
