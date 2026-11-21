import Link from "next/link";
import { Card } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CreateCenterForm } from "./create-center-form";

export const metadata = { title: "Set up your center · Worksheet" };

export default async function OnboardingPage() {
  const user = await requireUser("/onboarding");
  const supabase = await createClient();
  const { count } = await supabase
    .from("memberships")
    .select("center_id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "active");

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <h1 className="mb-1 text-xl font-semibold">
          Set up your tuition center
        </h1>
        <p className="mb-5 text-sm text-neutral-500">
          You&apos;ll be the owner. Invite your tutors next. If a colleague
          already invited you, open their invite link instead.
        </p>
        <CreateCenterForm />
        {!!count && (
          <p className="mt-5 text-center text-sm">
            <Link
              href="/dashboard"
              className="font-medium text-indigo-600 hover:underline"
            >
              Back to dashboard
            </Link>
          </p>
        )}
      </Card>
    </div>
  );
}
