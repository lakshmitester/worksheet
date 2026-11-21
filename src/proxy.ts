import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // Email links can land on any page with ?code=... (the Supabase Site URL
  // fallback). Send them to the callback so the code becomes a session.
  const { pathname, searchParams } = request.nextUrl;
  if (searchParams.has("code") && pathname !== "/auth/callback") {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/callback";
    if (!url.searchParams.has("next"))
      url.searchParams.set("next", "/dashboard");
    return NextResponse.redirect(url);
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    // Skip static assets, the health probe, and the paths the brief keeps
    // outside session handling: live student sessions (/live, /api/live) and
    // the Stripe webhook.
    "/((?!_next/static|_next/image|favicon.ico|api/health|api/live|api/stripe|live|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
