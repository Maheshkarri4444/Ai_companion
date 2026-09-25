"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { api, errorMessage, fieldErrors } from "@/lib/api";
import { qk } from "@/lib/queries";
import type { User } from "@/lib/types";
import { cn } from "@/lib/utils";

const rules = [
  { label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { label: "A letter", test: (p: string) => /[A-Za-z]/.test(p) },
  { label: "A number", test: (p: string) => /\d/.test(p) },
];

export default function RegisterPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setFormError(null);
    setPending(true);
    try {
      const { user } = await api.post<{ user: User }>("/auth/register", form);
      queryClient.clear();
      queryClient.setQueryData(qk.me, user);
      router.replace("/dashboard");
    } catch (err) {
      const byField = fieldErrors(err);
      setErrors(byField);
      if (Object.keys(byField).length === 0) setFormError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <div className="animate-rise">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Create your account</h1>
      <p className="mt-1.5 text-sm text-muted">Set up your first learning Space in a minute.</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
        {formError && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {formError}
          </div>
        )}
        <Field label="Full name" htmlFor="name" error={errors.name}>
          <Input id="name" autoComplete="name" placeholder="Ada Lovelace" value={form.name} onChange={set("name")} aria-invalid={!!errors.name} autoFocus />
        </Field>
        <Field label="Email" htmlFor="email" error={errors.email}>
          <Input id="email" type="email" autoComplete="email" placeholder="you@example.com" value={form.email} onChange={set("email")} aria-invalid={!!errors.email} />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password}>
          <PasswordInput id="password" autoComplete="new-password" placeholder="Create a password" value={form.password} onChange={set("password")} aria-invalid={!!errors.password} />
          <ul className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
            {rules.map((rule) => {
              const ok = rule.test(form.password);
              return (
                <li key={rule.label} className={cn("flex items-center gap-1 text-xs", ok ? "text-emerald-600" : "text-muted")}>
                  <Check className={cn("size-3.5", !ok && "opacity-40")} />
                  {rule.label}
                </li>
              );
            })}
          </ul>
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={pending} disabled={!form.name || !form.email || !form.password}>
          Create account <ArrowRight className="size-4" />
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-blue-700 hover:text-blue-600">
          Sign in
        </Link>
      </p>
    </div>
  );
}
