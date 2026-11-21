import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revokeInvite } from "./actions";
import { InviteForm, MemberActions, RenameCenterForm } from "./forms";

export const metadata = { title: "Dashboard · Worksheet" };

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export default async function DashboardPage({
  searchParams,
}: PageProps<"/dashboard">) {
  const user = await requireUser("/dashboard");
  const supabase = await createClient();
  const sp = await searchParams;

  // Centers this user actively belongs to (RLS limits rows to the user's own tenants).
  const { data: myMemberships } = await supabase
    .from("memberships")
    .select("center_id, role, centers(id, name, created_at)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at");

  const centers = (myMemberships ?? []).flatMap((m) =>
    m.centers ? [{ ...m.centers, role: m.role }] : [],
  );
  if (centers.length === 0) redirect("/onboarding");

  const current = centers.find((c) => c.id === sp.center) ?? centers[0];
  const isOwner = current.role === "owner";

  const { data: roster } = await supabase
    .from("memberships")
    .select("user_id, role, status, created_at")
    .eq("center_id", current.id)
    .order("created_at");

  const userIds = (roster ?? []).map((m) => m.user_id);
  const { data: profiles } = userIds.length
    ? await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", userIds)
    : { data: [] };
  const nameOf = new Map(
    (profiles ?? []).map((p) => [p.user_id, p.display_name]),
  );

  const { data: invites } = isOwner
    ? await supabase
        .from("invites")
        .select("id, email, role, expires_at, created_at")
        .eq("center_id", current.id)
        .is("accepted_at", null)
        .order("created_at", { ascending: false })
    : { data: [] };

  const active = (roster ?? []).filter((m) => m.status === "active");
  const removed = (roster ?? []).filter((m) => m.status !== "active");

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-neutral-500">Your center</p>
          <h1 className="text-2xl font-semibold">{current.name}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            You are {isOwner ? "an owner" : "a tutor"} · {active.length} active
            member{active.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {centers.length > 1 &&
            centers.map((c) => (
              <Link
                key={c.id}
                href={`/dashboard?center=${c.id}`}
                className={`rounded-full px-3 py-1 text-sm ${
                  c.id === current.id
                    ? "bg-indigo-600 text-white"
                    : "border border-black/15 hover:bg-neutral-50 dark:border-white/15 dark:hover:bg-neutral-800"
                }`}
              >
                {c.name}
              </Link>
            ))}
          <Link
            href="/onboarding"
            className="text-sm font-medium text-indigo-600 hover:underline"
          >
            + New center
          </Link>
        </div>
      </div>

      <Card>
        <h2 className="mb-1 font-semibold">Worksheets</h2>
        <p className="text-sm text-neutral-500">
          Coming next: build 11+ English worksheets from the checked question
          bank, download branded PDFs and run live tests.
        </p>
      </Card>

      <Card>
        <h2 className="mb-4 font-semibold">Team</h2>
        <ul className="divide-y divide-black/5 dark:divide-white/10">
          {[...active, ...removed].map((m) => (
            <li
              key={m.user_id}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                  {(nameOf.get(m.user_id) ?? "?").slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p
                    className={`truncate text-sm font-medium ${m.status !== "active" ? "text-neutral-400 line-through" : ""}`}
                  >
                    {nameOf.get(m.user_id) ??
                      (m.status === "active"
                        ? "Unnamed user"
                        : "Former member")}
                    {m.user_id === user.id && (
                      <span className="ml-1.5 text-neutral-500">(you)</span>
                    )}
                  </p>
                  <p className="text-xs text-neutral-500">
                    Joined {fmtDate(m.created_at)}
                  </p>
                </div>
                <Badge>{m.status === "active" ? m.role : "removed"}</Badge>
              </div>
              {isOwner && (
                <MemberActions
                  centerId={current.id}
                  userId={m.user_id}
                  role={m.role}
                  status={m.status}
                  isSelf={m.user_id === user.id}
                />
              )}
            </li>
          ))}
        </ul>
      </Card>

      {isOwner && (
        <Card>
          <h2 className="mb-1 font-semibold">Invite a tutor</h2>
          <p className="mb-4 text-sm text-neutral-500">
            Create a one-time link for a colleague. They sign in or create an
            account with that email, then accept.
          </p>
          <InviteForm centerId={current.id} />

          {!!invites?.length && (
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-medium">Pending invites</h3>
              <ul className="divide-y divide-black/5 dark:divide-white/10">
                {invites.map((inv) => {
                  const expired = new Date(inv.expires_at) <= new Date();
                  return (
                    <li
                      key={inv.id}
                      className="flex items-center justify-between gap-4 py-2.5"
                    >
                      <div className="min-w-0 text-sm">
                        <span className="font-medium">{inv.email}</span>{" "}
                        <Badge>{inv.role}</Badge>
                        <span
                          className={`ml-2 text-xs ${expired ? "text-red-600" : "text-neutral-500"}`}
                        >
                          {expired
                            ? "Expired"
                            : `Expires ${fmtDate(inv.expires_at)}`}
                        </span>
                      </div>
                      <form action={revokeInvite}>
                        <input type="hidden" name="inviteId" value={inv.id} />
                        <Button
                          type="submit"
                          variant="danger"
                          className="px-2.5 py-1 text-xs"
                        >
                          Revoke
                        </Button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Card>
      )}

      {isOwner && (
        <Card>
          <h2 className="mb-3 font-semibold">Center settings</h2>
          <RenameCenterForm
            key={current.id + current.name}
            centerId={current.id}
            name={current.name}
          />
        </Card>
      )}
    </div>
  );
}
