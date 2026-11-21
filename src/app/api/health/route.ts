// Liveness probe for uptime checks (brief §8). Deliberately touches no
// dependencies; a deeper readiness check can be added once the DB is wired.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok", time: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
