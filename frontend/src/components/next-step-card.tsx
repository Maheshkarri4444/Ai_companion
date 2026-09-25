import { ArrowRight, Clock, FileUp, FolderPlus, Layers, ListChecks, MessageSquareText, PlayCircle, RotateCcw, Sparkles, Target } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { NextStep } from "@/lib/types";
import { buttonClasses } from "./ui/button";

interface StepView {
  icon: ReactNode;
  title: string;
  body: string;
  cta?: { label: string; href: string };
}

export function describeNextStep(step: NextStep): StepView {
  switch (step.kind) {
    case "create_space":
      return {
        icon: <Layers />,
        title: "Create your first Space",
        body: "Spaces group a broad learning area — a skill, a certification or a personal interest.",
        cta: { label: "Create a Space", href: "/spaces?new=1" },
      };
    case "create_project":
      return {
        icon: <FolderPlus />,
        title: `Start a project in ${step.spaceName}`,
        body: "A Project is a focused learning journey with its own goal, materials and progress.",
        cta: { label: "New project", href: `/spaces/${step.spaceId}?newProject=1` },
      };
    case "upload_material":
      return {
        icon: <FileUp />,
        title: `Add learning material to ${step.projectName}`,
        body: "Upload the PDFs you're studying. Your Tutor and quizzes will be grounded in them.",
        cta: { label: "Upload material", href: `/projects/${step.projectId}/materials` },
      };
    case "await_processing":
      return {
        icon: <Clock />,
        title: `${step.pendingCount} ${step.pendingCount === 1 ? "material is" : "materials are"} queued for processing`,
        body: "Processing runs in the background — you don't need to keep this page open. Zoya can answer from it as soon as it's ready.",
        cta: { label: "View materials", href: `/projects/${step.projectId}/materials` },
      };
    case "retry_failed":
      return {
        icon: <RotateCcw />,
        title: `Processing failed for ${step.failedCount} ${step.failedCount === 1 ? "material" : "materials"}`,
        body: "Check the error on the materials page and upload a readable PDF.",
        cta: { label: "Review materials", href: `/projects/${step.projectId}/materials` },
      };
    case "ask_tutor":
      return {
        icon: <Sparkles />,
        title: `Ask Zoya about ${step.projectName}`,
        body: step.concept
          ? `Your material is ready. Start with a question — for example, “What is ${step.concept}?” — and Zoya will answer from your notes with page citations.`
          : "Your material is ready. Ask Zoya a question and she'll answer from your notes with page citations.",
        cta: { label: "Ask Zoya", href: `/projects/${step.projectId}/tutor` },
      };
    case "continue_tutor":
      return {
        icon: <MessageSquareText />,
        title: `Continue with Zoya: ${step.conversationTitle}`,
        body: "Pick up your last conversation — Zoya remembers where you left off and what you found tricky.",
        cta: { label: "Continue conversation", href: `/projects/${step.projectId}/tutor?c=${step.conversationId}` },
      };
    case "resume_quiz":
      return {
        icon: <ListChecks />,
        title: `Finish your quiz in ${step.projectName}`,
        body: `You've answered ${step.answered} of ${step.target} questions. Pick up where you left off — every answer updates your mastery.`,
        cta: { label: "Resume quiz", href: `/projects/${step.projectId}/quiz/${step.sessionId}` },
      };
    case "start_quiz":
      return step.reason === "practice_weak" && step.conceptId && step.conceptName
        ? {
            icon: <Target />,
            title: `Practise ${step.conceptName}`,
            body: `It's your weakest concept so far${step.mastery != null ? ` (${Math.round(step.mastery * 100)}% mastery)` : ""}. A short focused quiz is the quickest way to close the gap.`,
            cta: { label: "Practise now", href: `/projects/${step.projectId}/quiz?focus=${step.conceptId}&count=5` },
          }
        : {
            icon: <ListChecks />,
            title: "Check what you've learned",
            body: "You've studied with Zoya — now test yourself. An adaptive quiz written from your materials shows what you know and what to revisit.",
            cta: { label: "Take a quiz", href: `/projects/${step.projectId}/quiz` },
          };
    case "continue_project":
      return {
        icon: <PlayCircle />,
        title: `Continue ${step.projectName}`,
        body: "Pick up where you left off.",
        cta: { label: "Open project", href: `/projects/${step.projectId}` },
      };
  }
}

/** Rule-based guidance for now; replaced by AI recommendations once learning data exists. */
export function NextStepCard({ step, variant = "light" }: { step: NextStep; variant?: "light" | "hero" }) {
  const view = describeNextStep(step);
  if (variant === "hero") {
    return (
      <div className="flex flex-col gap-4 rounded-2xl bg-white/10 p-4 ring-1 ring-white/15 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/15 text-cyan-200 [&>svg]:size-[18px]">
            {view.icon}
          </span>
          <div>
            <p className="text-xs font-semibold tracking-wider text-cyan-200/90 uppercase">Recommended next step</p>
            <p className="mt-0.5 font-medium text-white">{view.title}</p>
            <p className="mt-0.5 text-sm text-blue-100/75">{view.body}</p>
          </div>
        </div>
        {view.cta && (
          <Link
            href={view.cta.href}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50"
          >
            {view.cta.label}
            <ArrowRight className="size-4" />
          </Link>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-blue-100 bg-linear-to-br from-blue-50 via-white to-indigo-50/60 p-5 shadow-card">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-blue-500 to-indigo-600 text-white shadow-glow [&>svg]:size-[18px]">
          {view.icon}
        </span>
        <div>
          <p className="text-xs font-semibold tracking-wider text-blue-700/80 uppercase">Next step</p>
          <p className="mt-0.5 font-display font-semibold text-ink">{view.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">{view.body}</p>
        </div>
      </div>
      {view.cta && (
        <Link href={view.cta.href} className={buttonClasses("primary", "md", "self-start")}>
          {view.cta.label}
          <ArrowRight className="size-4" />
        </Link>
      )}
    </div>
  );
}
