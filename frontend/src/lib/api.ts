/**
 * Same-origin API client. Requests go to `/api/*` on this origin (proxied to the Express API by a
 * Next.js rewrite), so the httpOnly session cookie is sent automatically and never touched by JS.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Required by the API's CSRF guard on every state-changing request.
const BASE_HEADERS = { "X-Requested-With": "fetch" } as const;

async function parseError(res: Response): Promise<ApiError> {
  const data = await res.json().catch(() => null);
  const error = data?.error;
  return new ApiError(
    res.status,
    error?.code ?? "HTTP_ERROR",
    error?.message ?? (res.status >= 500 ? "The server had a problem. Please try again." : res.statusText),
    error?.details,
    error?.requestId,
  );
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: body === undefined ? BASE_HEADERS : { ...BASE_HEADERS, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Can't reach the server. Check your connection and try again.");
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  delete: <T = void>(path: string) => request<T>("DELETE", path),
};

/** Multipart upload via XHR, because fetch cannot report upload progress. */
export function uploadFile<T>(
  path: string,
  file: File,
  fields: Record<string, string> = {},
  onProgress?: (fraction: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-Requested-With", "fetch");
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve(xhr.response as T);
      const error = xhr.response?.error;
      reject(
        new ApiError(
          xhr.status,
          error?.code ?? "UPLOAD_FAILED",
          error?.message ?? (xhr.status === 413 ? "The file is too large." : "Upload failed."),
          error?.details,
          error?.requestId,
        ),
      );
    };
    xhr.onerror = () => reject(new ApiError(0, "NETWORK_ERROR", "Upload failed: network error."));
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    form.append("file", file);
    xhr.send(form);
  });
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

/** Maps API validation details to `{ field: message }` for inline form errors. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return {};
  const out: Record<string, string> = {};
  for (const detail of error.details as Array<{ path?: string; message?: string }>) {
    if (detail.path && detail.message && !out[detail.path]) out[detail.path] = detail.message;
  }
  return out;
}
