import { LearnerShell } from "@/components/layout/learner-shell";

export default function LearnerLayout({ children }: { children: React.ReactNode }) {
  return <LearnerShell>{children}</LearnerShell>;
}
