"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { buttonClasses } from "@/components/ui/button";

/** History back when there is somewhere to go back to, otherwise home (e.g. a 404 opened from a pasted link). */
export function BackButton({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
      className={buttonClasses("secondary", "md", className)}
    >
      <ArrowLeft className="size-4" /> Go back
    </button>
  );
}
