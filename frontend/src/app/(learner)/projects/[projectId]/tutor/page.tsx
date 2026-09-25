"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Brain, FileText, History, Loader2, Upload } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AssistantMessage, LiveAssistant, UserBubble, type LiveTurnView } from "@/components/tutor/chat-message";
import { Composer } from "@/components/tutor/composer";
import { ConversationList } from "@/components/tutor/conversation-list";
import { MemoryDialog } from "@/components/tutor/memory-dialog";
import { SourceViewer } from "@/components/tutor/source-viewer";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { ZoyaAvatar } from "@/components/zoya/zoya-avatar";
import { api, errorMessage } from "@/lib/api";
import { pluralize } from "@/lib/format";
import { qk, useConversation, useMe, useTutorOverview } from "@/lib/queries";
import { newClientMessageId, streamTutorMessage } from "@/lib/tutor-stream";
import type { Conversation, TutorAction, TutorMessage, TutorOverview, TutorSource } from "@/lib/types";

interface LiveTurn extends LiveTurnView {
  clientMessageId: string;
  question: string;
  mode: "auto" | "general";
  action: TutorAction | null;
  conversationId: string | null;
  userMessage: TutorMessage | null;
  assistantId: string | null;
}

interface SendInput {
  content: string;
  mode?: "auto" | "general";
  action?: TutorAction | null;
  clientMessageId?: string;
}

type ConversationData = { conversation: Conversation; messages: TutorMessage[]; hasMore: boolean };

export default function TutorPage() {
  return (
    <Suspense fallback={<TutorSkeleton />}>
      <Tutor />
    </Suspense>
  );
}

function TutorSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[272px_minmax(0,1fr)]">
      <Skeleton className="hidden h-96 rounded-2xl lg:block" />
      <Skeleton className="h-[560px] rounded-2xl" />
    </div>
  );
}

function Tutor() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const conversationId = searchParams.get("c");
  const askParam = searchParams.get("ask");
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const overview = useTutorOverview(projectId);
  const conversation = useConversation(projectId, conversationId);

  const [turn, setTurn] = useState<LiveTurn | null>(null);
  const liveRef = useRef<LiveTurn | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [viewing, setViewing] = useState<TutorSource | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const busy = Boolean(turn && !turn.error);

  const selectConversation = useCallback(
    (id: string | null) => router.replace(id ? `${pathname}?c=${id}` : pathname, { scroll: false }),
    [pathname, router],
  );

  function update(patch: Partial<LiveTurn> | ((current: LiveTurn) => Partial<LiveTurn>)) {
    const current = liveRef.current;
    if (!current) return;
    const next = { ...current, ...(typeof patch === "function" ? patch(current) : patch) };
    liveRef.current = next;
    setTurn(next);
  }

  async function finish(message: TutorMessage, conv: Conversation) {
    const question = liveRef.current?.userMessage;
    const key = qk.conversation(projectId, conv.id);
    // An in-flight fetch (started when the URL switched to the new conversation) must not overwrite this.
    await queryClient.cancelQueries({ queryKey: key });
    queryClient.setQueryData<ConversationData>(key, (old) => {
      const kept = (old?.messages ?? []).filter(
        (m) => m.id !== message.id && m.id !== question?.id && (!question || m.replyTo !== question.id),
      );
      return { conversation: conv, messages: question ? [...kept, question, message] : [...kept, message], hasMore: old?.hasMore ?? false };
    });
    liveRef.current = null;
    setTurn(null);
    void queryClient.invalidateQueries({ queryKey: qk.tutor(projectId), exact: true });
  }

  async function send(input: SendInput) {
    if (liveRef.current && !liveRef.current.error) return;
    const retrying = input.clientMessageId && liveRef.current?.clientMessageId === input.clientMessageId;
    const initial: LiveTurn = {
      clientMessageId: input.clientMessageId ?? newClientMessageId(),
      question: input.content,
      mode: input.mode ?? "auto",
      action: input.action ?? null,
      conversationId: retrying ? liveRef.current!.conversationId : conversationId,
      userMessage: null,
      assistantId: null,
      stage: "understanding",
      label: "Understanding your question",
      content: "",
      sources: [],
      tools: [],
      error: null,
    };
    liveRef.current = initial;
    setTurn(initial);
    stickToBottom.current = true;
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamTutorMessage(
        projectId,
        {
          clientMessageId: initial.clientMessageId,
          content: initial.question,
          conversationId: initial.conversationId ?? undefined,
          mode: initial.mode,
          action: initial.action,
        },
        (event) => {
          switch (event.type) {
            case "start":
              update({ userMessage: event.userMessage, assistantId: event.assistantMessageId, conversationId: event.conversation.id });
              if (event.conversation.id !== conversationId) selectConversation(event.conversation.id);
              break;
            case "status":
              update({ stage: event.stage, label: event.label });
              break;
            case "sources":
              update({ sources: event.sources });
              break;
            case "tool":
              update((t) => ({
                tools:
                  event.status === "started"
                    ? [...t.tools, { name: event.name, status: event.status, summary: event.summary }]
                    : t.tools.map((tool, i) =>
                        i === t.tools.findLastIndex((x) => x.name === event.name) ? { ...tool, status: event.status, summary: event.summary } : tool,
                      ),
              }));
              break;
            case "delta":
              update((t) => ({ content: t.content + event.text }));
              break;
            case "reset":
              update({ content: "", label: "Retrying with another model" });
              break;
            case "done":
              void finish(event.message, event.conversation);
              break;
            case "error":
              update({ error: event.message });
              break;
          }
        },
        controller.signal,
      );
      // Stream ended without a final event (connection dropped): let the learner retry idempotently.
      if (liveRef.current && liveRef.current.clientMessageId === initial.clientMessageId) {
        update({ error: "The connection was interrupted before Zoya finished. Try again — your question won't be duplicated." });
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      update({ error: errorMessage(err) });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function stop() {
    const live = liveRef.current;
    if (!live) return;
    abortRef.current?.abort();
    if (live.assistantId) void api.post(`/projects/${projectId}/tutor/messages/${live.assistantId}/stop`).catch(() => undefined);
    liveRef.current = null;
    setTurn(null);
    // The server keeps the partial answer as "stopped"; show it once persisted.
    if (live.conversationId) {
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: qk.conversation(projectId, live.conversationId!) }), 800);
    }
  }

  /** Re-asks a failed/stopped answer with the original clientMessageId: the server replaces it, never duplicates. */
  function retryMessage(answer: TutorMessage) {
    const q = questionFor(answer);
    if (q?.clientMessageId) void send({ content: q.content, mode: q.mode, action: q.action, clientMessageId: q.clientMessageId });
  }

  function retryLive() {
    const live = liveRef.current;
    if (!live) return;
    void send({ content: live.question, mode: live.mode, action: live.action, clientMessageId: live.clientMessageId });
  }

  // Keep the newest content in view unless the learner scrolled up to read.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [turn?.content, turn?.stage, turn?.error, conversation.data?.messages.length]);

  const messages = (conversationId ? (conversation.data?.messages ?? []) : []).filter(
    (m) => !turn || (m.id !== turn.userMessage?.id && m.id !== turn.assistantId),
  );
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;
  const questionFor = (m: TutorMessage) => messages.find((q) => q.id === m.replyTo);
  const data = overview.data;
  const noMaterials = data ? data.knowledge.readyMaterials === 0 : false;
  const hasTopic = messages.some((m) => m.role === "assistant" && m.status === "complete");
  const zoyaState = turn && !turn.error ? (turn.content ? "speaking" : "thinking") : "idle";

  if (overview.error) return <ErrorState error={overview.error} onRetry={() => overview.refetch()} />;

  const list = data && (
    <ConversationList
      projectId={projectId}
      conversations={data.conversations}
      activeId={conversationId}
      onSelect={(id) => {
        selectConversation(id);
        setHistoryOpen(false);
      }}
      onNew={() => {
        if (busy) return;
        liveRef.current = null;
        setTurn(null);
        selectConversation(null);
        setHistoryOpen(false);
      }}
      onDeleted={(id) => id === conversationId && selectConversation(null)}
    />
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[272px_minmax(0,1fr)]">
      <aside className="hidden lg:block">
        <Card className="sticky top-4 flex h-[calc(100dvh-17rem)] min-h-[520px] flex-col p-3">{list ?? <Skeleton className="h-full" />}</Card>
      </aside>

      <Card className="flex h-[calc(100dvh-17rem)] min-h-[560px] flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-line bg-linear-to-r from-white to-blue-50/60 px-4 py-3">
          <ZoyaAvatar size={42} state={zoyaState} ring />
          <div className="min-w-0 flex-1">
            <p className="font-display text-[15px] font-semibold text-ink">Zoya</p>
            <p className="truncate text-xs text-muted">
              {!data ? (
                "Loading…"
              ) : noMaterials ? (
                "Waiting for your first processed material"
              ) : (
                <>
                  AI tutor · answers from {pluralize(data.knowledge.readyMaterials, "material")}
                  {data.knowledge.concepts.length > 0 && ` · ${pluralize(data.knowledge.concepts.length, "key concept")}`}
                </>
              )}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setMemoryOpen(true)} title="What Zoya remembers about you">
            <Brain className="size-4 text-violet-600" />
            <span className="hidden sm:inline">Memory</span>
            {data && data.memoryCount > 0 && (
              <span className="rounded-full bg-violet-100 px-1.5 text-[11px] font-semibold text-violet-700">{data.memoryCount}</span>
            )}
          </Button>
          <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setHistoryOpen(true)}>
            <History className="size-4" /> Chats
          </Button>
        </header>

        {data && data.knowledge.pendingMaterials > 0 && (
          <div className="flex items-center gap-2 border-b border-blue-100 bg-blue-50/70 px-4 py-2 text-xs text-blue-900">
            <Loader2 className="size-3.5 animate-spin" />
            {pluralize(data.knowledge.pendingMaterials, "material")} still processing — Zoya will use {data.knowledge.pendingMaterials === 1 ? "it" : "them"} as
            soon as {data.knowledge.pendingMaterials === 1 ? "it's" : "they're"} ready.
          </div>
        )}

        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="scrollbar-thin flex-1 overflow-y-auto px-4 py-5 sm:px-6"
        >
          {conversationId && conversation.isLoading ? (
            <div className="space-y-5">
              <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
              <Skeleton className="h-28 w-4/5 rounded-2xl" />
            </div>
          ) : conversationId && conversation.error ? (
            <ErrorState error={conversation.error} onRetry={() => conversation.refetch()} />
          ) : messages.length === 0 && !turn ? (
            <Welcome
              overview={data}
              firstName={me?.name.split(" ")[0]}
              projectId={projectId}
              onAsk={(text) => void send({ content: text })}
            />
          ) : (
            <div className="mx-auto max-w-3xl space-y-6">
              {messages.map((m) =>
                m.role === "user" ? (
                  <UserBubble key={m.id} content={m.content} action={m.action} mode={m.mode} />
                ) : (
                  <AssistantMessage
                    key={m.id}
                    message={m}
                    projectId={projectId}
                    isLast={!turn && m.id === lastAssistantId}
                    busy={busy}
                    onOpenSource={setViewing}
                    onFollowUp={(text) => void send({ content: text })}
                    onGeneralKnowledge={() => {
                      const q = questionFor(m);
                      if (q) void send({ content: q.content, mode: "general", action: "general_knowledge" });
                    }}
                    onRetry={questionFor(m)?.clientMessageId ? () => retryMessage(m) : undefined}
                  />
                ),
              )}
              {turn && (
                <>
                  <UserBubble content={turn.question} action={turn.action} mode={turn.mode} />
                  <LiveAssistant turn={turn} onOpenSource={setViewing} onRetry={retryLive} />
                </>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-line bg-white px-3 py-3 sm:px-4">
          <div className="mx-auto max-w-3xl">
            <Composer
              key={askParam ?? "composer"}
              initialText={askParam?.slice(0, 500) ?? ""}
              busy={busy}
              disabled={noMaterials && !messages.length}
              hasTopic={hasTopic}
              onSend={(text) => void send({ content: text })}
              onAction={(action, label) => void send({ content: label, action })}
              onStop={stop}
            />
          </div>
        </div>
      </Card>

      <SourceViewer projectId={projectId} source={viewing} onClose={() => setViewing(null)} />
      <MemoryDialog projectId={projectId} open={memoryOpen} onOpenChange={setMemoryOpen} />
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen} title="Conversations" size="sm">
        <div className="h-[60vh]">{list}</div>
      </Dialog>
    </div>
  );
}

function Welcome({
  overview,
  firstName,
  projectId,
  onAsk,
}: {
  overview: TutorOverview | undefined;
  firstName: string | undefined;
  projectId: string;
  onAsk: (text: string) => void;
}) {
  if (!overview) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-blue-500" />
      </div>
    );
  }
  const { knowledge } = overview;
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center py-6 text-center">
      <ZoyaAvatar size={112} ring className="shadow-lift" />
      <h2 className="mt-5 font-display text-xl font-semibold text-ink sm:text-2xl">
        Hi{firstName ? ` ${firstName}` : ""}, I&apos;m <span className="text-blue-700">Zoya</span>
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        Your AI tutor for <strong className="text-ink">{overview.project.name}</strong>. I explain concepts from your own materials,
        show you the exact page I used, and tell you honestly when your notes don&apos;t cover something.
      </p>

      {knowledge.readyMaterials === 0 ? (
        <div className="mt-6 w-full rounded-2xl border border-dashed border-blue-200 bg-blue-50/50 p-5">
          <FileText className="mx-auto size-6 text-blue-500" />
          <p className="mt-2 text-sm font-medium text-ink">
            {knowledge.pendingMaterials > 0 ? "Your materials are being processed" : "Add a PDF to get started"}
          </p>
          <p className="mt-1 text-xs text-muted">
            {knowledge.pendingMaterials > 0
              ? "Extraction, concepts and the search index are built in the background. This usually takes under a minute."
              : "Upload lecture notes, a book chapter or a paper — I'll learn it with you and cite the pages."}
          </p>
          <Link href={`/projects/${projectId}/materials`} className={buttonClasses("primary", "sm", "mt-4")}>
            <Upload className="size-3.5" /> Go to Materials
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-6 mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">Try asking</p>
          <div className="grid w-full gap-2 sm:grid-cols-2">
            {overview.starters.map((starter) => (
              <button
                key={starter}
                type="button"
                onClick={() => onAsk(starter)}
                className="rounded-xl border border-line bg-white px-4 py-3 text-left text-sm text-ink-soft shadow-card transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:text-blue-800 hover:shadow-lift"
              >
                {starter}
              </button>
            ))}
          </div>
          {knowledge.concepts.length > 0 && (
            <p className="mt-5 text-xs text-muted">
              Key concepts in your materials: {knowledge.concepts.slice(0, 6).join(" · ")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
