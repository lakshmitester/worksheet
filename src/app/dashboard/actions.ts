"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getOrigin } from "@/lib/origin";
import { createClient } from "@/lib/supabase/server";

// Every action re-checks auth. Server actions are public POST endpoints, and
// RLS plus the RPC checks are the real authorization.

export type InviteState =
  { error?: string; inviteUrl?: string; email?: string } | undefined;
export type SimpleState = { error?: string; ok?: boolean } | undefined;

const inviteSchema = z.object({
  centerId: z.uuid(),
  email: z.email("Enter a valid email address").trim().toLowerCase(),
  role: z.enum(["tutor", "owner"]),
});

export async function createInvite(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  await requireUser();
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data: token, error } = await supabase.rpc("create_invite", {
    p_center_id: parsed.data.centerId,
    p_email: parsed.data.email,
    p_role: parsed.data.role,
  });
  if (error || !token) {
    return {
      error:
        error?.code === "23505"
          ? "There is already a pending invite for that email. Revoke it first to send a new one."
          : error?.code === "42501"
            ? "Only center owners can invite people."
            : "Could not create the invite.",
    };
  }
  revalidatePath("/dashboard");
  return {
    inviteUrl: `${await getOrigin()}/invite/${token}`,
    email: parsed.data.email,
  };
}

export async function revokeInvite(formData: FormData) {
  await requireUser();
  const id = z.uuid().parse(formData.get("inviteId"));
  const supabase = await createClient();
  await supabase.from("invites").delete().eq("id", id);
  revalidatePath("/dashboard");
}

const memberSchema = z.object({
  centerId: z.uuid(),
  userId: z.uuid(),
  change: z.enum(["remove", "restore", "make_owner", "make_tutor"]),
});

export async function updateMember(
  _prev: SimpleState,
  formData: FormData,
): Promise<SimpleState> {
  await requireUser();
  const parsed = memberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request." };
  const { centerId, userId, change } = parsed.data;

  const patch =
    change === "remove"
      ? { status: "removed" }
      : change === "restore"
        ? { status: "active" }
        : { role: change === "make_owner" ? "owner" : "tutor" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memberships")
    .update(patch)
    .eq("center_id", centerId)
    .eq("user_id", userId)
    .select("user_id");

  if (error?.code === "23514")
    return { error: "A center must keep at least one active owner." };
  if (error || !data?.length)
    return { error: "You don't have permission to change this member." };
  revalidatePath("/dashboard");
  return { ok: true };
}

const renameSchema = z.object({
  centerId: z.uuid(),
  name: z.string().trim().min(1, "Enter a name").max(120),
});

export async function renameCenter(
  _prev: SimpleState,
  formData: FormData,
): Promise<SimpleState> {
  await requireUser();
  const parsed = renameSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("centers")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.centerId)
    .select("id");
  if (error || !data?.length)
    return { error: "Only owners can rename the center." };
  revalidatePath("/dashboard");
  return { ok: true };
}
