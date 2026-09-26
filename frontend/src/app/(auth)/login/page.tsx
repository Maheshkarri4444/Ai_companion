"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { PasswordInput, safeNextPath } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { api, errorMessage } from "@/lib/api";
import { DEMO_ADMIN } from "@/lib/demo";
import { qk } from "@/lib/queries";
import type { User } from "@/lib/types";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { user } = await api.post<{ user: User }>("/auth/login", { email, password });
      queryClient.clear();
      queryClient.setQueryData(qk.me, user);
      const next = safeNextPath(searchParams.get("next"));
      const home = user.role === "admin" ? "/admin" : "/dashboard";
      // Only follow `next` into the area this role can use.
      router.replace(next && (user.role === "admin" || !next.startsWith("/admin")) ? next : home);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <>
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}
      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />
      </Field>
      <Field label="Password" htmlFor="password">
        <PasswordInput
          id="password"
          autoComplete="current-password"
          placeholder="Your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={pending} disabled={!email || !password}>
        Sign in <ArrowRight className="size-4" />
      </Button>
    </form>
    {DEMO_ADMIN.email && (
      <section aria-labelledby="demo-admin" className="mt-6 rounded-xl border border-blue-200 bg-blue-50/70 p-4">
        <p id="demo-admin" className="flex items-center gap-2 text-sm font-semibold text-blue-900">
          <ShieldCheck className="size-4 text-blue-600" /> Demo admin access
        </p>
        <p className="mt-1 text-xs leading-relaxed text-blue-900/75">For demo purposes, use these admin credentials to log in to the admin panel.</p>
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-xs text-muted">Email</dt>
            <dd className="truncate font-mono text-[13px] text-ink select-all">{DEMO_ADMIN.email}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-xs text-muted">Password</dt>
            <dd className="truncate font-mono text-[13px] text-ink select-all">{DEMO_ADMIN.password}</dd>
          </div>
        </dl>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-3 w-full"
          onClick={() => {
            setEmail(DEMO_ADMIN.email);
            setPassword(DEMO_ADMIN.password);
            setError(null);
          }}
        >
          Use demo admin login
        </Button>
      </section>
    )}
    </>
  );
}

export default function LoginPage() {
  return (
    <div className="animate-rise">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Welcome back</h1>
      <p className="mt-1.5 text-sm text-muted">Sign in to continue your learning journey.</p>
      <div className="mt-8">
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
      <p className="mt-8 text-center text-sm text-muted">
        New to Study Companion?{" "}
        <Link href="/register" className="font-medium text-blue-700 hover:text-blue-600">
          Create an account
        </Link>
      </p>
    </div>
  );
}
