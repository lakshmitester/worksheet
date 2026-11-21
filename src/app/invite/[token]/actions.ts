"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type AcceptState = { error?: string } | undefined;

export async function acceptInvite(
  _prev: AcceptState,
  formData: FormData,
): Promise<AcceptState> {
  const token = String(formData.get("token") ?? "");
  await requireUser(`/invite/${encodeURIComponent(token)}`);

  const supabase = await createClient();
  const { data: centerId, error } = await supabase.rpc("accept_invite", {
    p_token: token,
  });
  if (error || !centerId) {
    return {
      error:
        "This invite is invalid, has expired, or was sent to a different email address. Ask the center owner for a new link.",
    };
  }
  redirect(`/dashboard?center=${centerId}`);
}
