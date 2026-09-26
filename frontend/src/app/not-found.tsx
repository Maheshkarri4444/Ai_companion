import { BarChart3, Home, Layers } from "lucide-react";
import Link from "next/link";
import { BackButton } from "@/components/back-button";
import { Logo } from "@/components/brand";
import { buttonClasses } from "@/components/ui/button";
import { ZoyaAvatar } from "@/components/zoya/zoya-avatar";

const shortcuts = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/spaces", label: "Spaces", icon: Layers },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

/** Root 404: every unmatched URL (and any `notFound()` without a closer boundary) lands here. */
export default function NotFound() {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-canvas px-4 py-16">
      <div className="bg-ai-grid pointer-events-none absolute inset-0 opacity-70" aria-hidden />
      <div
        className="pointer-events-none absolute -top-40 left-1/2 size-[520px] -translate-x-1/2 rounded-full bg-blue-400/15 blur-3xl"
        aria-hidden
      />

      <div className="relative w-full max-w-lg text-center">
        <Link href="/" className="inline-flex" aria-label="AI Study Companion home">
          <Logo />
        </Link>

        <p className="mt-12 bg-linear-to-r from-blue-600 via-indigo-600 to-cyan-500 bg-clip-text font-display text-8xl leading-none font-semibold tracking-tight text-transparent sm:text-9xl">
          404
        </p>
        <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight text-ink">Page not found</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          The page you&apos;re looking for doesn&apos;t exist or may have moved. Your Spaces, Projects and learning progress are safe.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/" className={buttonClasses("primary", "md")}>
            <Home className="size-4" /> Back to your workspace
          </Link>
          <BackButton />
        </div>

        <div className="mt-10 flex items-center gap-3 rounded-2xl border border-line bg-white/80 p-4 text-left shadow-card backdrop-blur-sm">
          <ZoyaAvatar size={40} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">Zoya looked everywhere — this page isn&apos;t in your workspace.</p>
            <nav aria-label="Shortcuts" className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {shortcuts.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} className="inline-flex items-center gap-1.5 font-medium text-blue-700 hover:text-blue-600">
                  <Icon className="size-3.5" /> {label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </div>
    </main>
  );
}
