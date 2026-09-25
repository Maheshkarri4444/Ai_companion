import { redirect } from "next/navigation";

// `proxy.ts` normally routes "/" by session and role before this renders; this is the fallback.
export default function RootPage() {
  redirect("/dashboard");
}
