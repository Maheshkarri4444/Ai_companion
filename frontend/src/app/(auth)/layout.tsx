import { BookOpenCheck, Lock, Sparkles, Target, TrendingUp } from "lucide-react";
import { Logo } from "@/components/brand";

const features = [
  { icon: BookOpenCheck, title: "Grounded answers", body: "Every Tutor answer cites the exact page it came from." },
  { icon: Target, title: "Adaptive practice", body: "Quizzes focus on the concepts you haven't mastered yet." },
  { icon: TrendingUp, title: "Measurable growth", body: "Track concept mastery and always know your next step." },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-ai-hero p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
        <div className="bg-ai-grid pointer-events-none absolute inset-0 opacity-50" aria-hidden />
        <div className="relative">
          <Logo dark />
        </div>

        <div className="relative max-w-lg space-y-8">
          <div className="space-y-4">
            <p className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-cyan-100 ring-1 ring-white/15">
              <Sparkles className="size-3.5" /> Your AI learning partner
            </p>
            <h1 className="font-display text-4xl leading-[1.15] font-semibold tracking-tight xl:text-[44px]">
              Learn from your own material — with an AI that <span className="text-gradient-ai">remembers, measures and guides.</span>
            </h1>
          </div>

          {/* Illustrative example of a grounded, cited Tutor answer. */}
          <div className="rounded-2xl bg-white/[0.07] p-4 ring-1 ring-white/15 backdrop-blur-md">
            <p className="text-sm text-blue-100/80">Why does gradient descent need a learning rate?</p>
            <div className="mt-3 flex gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-blue-400 to-indigo-500">
                <Sparkles className="size-3.5" />
              </span>
              <div className="space-y-2 text-sm leading-relaxed text-white/90">
                <p>It sets the step size of each update: too large and the loss diverges, too small and training crawls.</p>
                <p className="inline-flex items-center gap-1.5 rounded-md bg-cyan-400/15 px-2 py-0.5 text-xs text-cyan-100 ring-1 ring-cyan-300/25">
                  <BookOpenCheck className="size-3.5" /> Source: Machine Learning Notes — Page 14
                </p>
              </div>
            </div>
          </div>

          <ul className="grid gap-4">
            {features.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                  <Icon className="size-[18px] text-cyan-200" />
                </span>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="text-sm text-blue-100/70">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative flex items-center gap-2 text-xs text-blue-100/60">
          <Lock className="size-3.5" /> Hashed passwords · Private workspaces · Your materials stay yours
        </p>
      </aside>

      <main className="flex items-center justify-center bg-white px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
