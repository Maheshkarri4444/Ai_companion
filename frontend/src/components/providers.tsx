"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { ApiError } from "@/lib/api";

let redirecting = false;

/**
 * An expired or revoked session surfaces as a 401 from any request. Clear the cookie first (otherwise
 * the route proxy would bounce /login straight back to the app), then go to the login page.
 */
async function handleUnauthorized(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 401 || redirecting) return;
  if (["/login", "/register"].includes(window.location.pathname)) return;
  redirecting = true;
  await fetch("/api/auth/logout", { method: "POST", headers: { "X-Requested-With": "fetch" } }).catch(() => undefined);
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.replace(`/login?next=${next}`);
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: handleUnauthorized }),
        mutationCache: new MutationCache({ onError: handleUnauthorized }),
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // Client errors (4xx) are final; retry transient failures once.
            retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster position="bottom-right" richColors closeButton toastOptions={{ className: "font-sans" }} />
    </QueryClientProvider>
  );
}
