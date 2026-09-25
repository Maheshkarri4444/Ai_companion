import { ApiError } from "./api";
import type { TutorAction, TutorStreamEvent } from "./types";

export interface SendTutorMessage {
  clientMessageId: string;
  content: string;
  conversationId?: string;
  mode?: "auto" | "general";
  action?: TutorAction | null;
}

/** Client-generated idempotency key: resending the same id never creates a second question. */
export function newClientMessageId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * POSTs a message and consumes the Server-Sent Events answer stream (fetch + ReadableStream, because
 * EventSource cannot POST or send the CSRF header). Validation/ownership errors arrive as ordinary JSON
 * errors before the stream opens and are thrown as ApiError.
 */
export async function streamTutorMessage(
  projectId: string,
  body: SendTutorMessage,
  onEvent: (event: TutorStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/projects/${projectId}/tutor/messages`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Requested-With": "fetch", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "NETWORK_ERROR", "Can't reach Zoya right now. Check your connection and try again.");
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error?.code ?? "HTTP_ERROR", data?.error?.message ?? "Zoya couldn't answer. Please try again.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");
      if (data) {
        try {
          onEvent(JSON.parse(data) as TutorStreamEvent);
        } catch {
          // A malformed frame is skipped rather than killing the whole answer.
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}
