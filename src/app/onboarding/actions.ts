"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type CreateCenterState = { error?: string } | undefined;

const schema = z.object({
  name: z.string().trim().min(1, "Enter your center's name").max(120),
});

export async function createCenter(
  _prev: CreateCenterState,
  formData: FormData,
): Promise<CreateCenterState> {
  await requireUser("/onboarding");
  const parsed = schema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data: centerId, error } = await supabase.rpc("create_center", {
    p_name: parsed.data.name,
  });
  if (error || !centerId)
    return { error: "Could not create the center. Please try again." };

  redirect(`/dashboard?center=${centerId}`);
}
