import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "asc_session";
const LEARNER_ROUTES = ["/dashboard", "/spaces", "/projects"];

type Role = "user" | "admin";

/**
 * Reads the role claim from the session JWT *without verifying it*. This is only a routing hint for
 * fast redirects; the API verifies the signature and the account on every request and is the only authority.
 */
function sessionRole(token: string | undefined): Role | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
    return payload.role === "admin" ? "admin" : "user";
  } catch {
    return null;
  }
}

const homeFor = (role: Role) => (role === "admin" ? "/admin" : "/dashboard");

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const role = sessionRole(request.cookies.get(SESSION_COOKIE)?.value);
  const redirectTo = (path: string) => NextResponse.redirect(new URL(path, request.url));

  if (pathname === "/") return redirectTo(role ? homeFor(role) : "/login");

  if (pathname === "/login" || pathname === "/register") {
    return role ? redirectTo(homeFor(role)) : NextResponse.next();
  }

  const isProtected =
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    LEARNER_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
  if (isProtected && !role) {
    return redirectTo(`/login?next=${encodeURIComponent(pathname + search)}`);
  }
  return NextResponse.next();
}

export const config = {
  // Never run on /api: the proxy would buffer (and cap at 10 MB) upload bodies. Also skip static assets.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
