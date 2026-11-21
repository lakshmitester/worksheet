import Link from "next/link";
import { Card } from "@/components/ui";
import { getUser } from "@/lib/auth";
import { AcceptInviteForm } from "./accept-form";

export const metadata = { title: "Accept invite · Worksheet" };

export default async function InvitePage({
  params,
}: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const user = await getUser();
  const here = `/invite/${encodeURIComponent(token)}`;

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-xl font-semibold">You&apos;ve been invited</h1>
        <p className="mb-5 text-sm text-neutral-500">
          A tuition center has invited you to join their team on Worksheet.
        </p>

        {user ? (
          <AcceptInviteForm token={token} email={user.email} />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              Sign in or create an account using the email address the invite
              was sent to.
            </p>
            <Link
              href={`/signup?next=${encodeURIComponent(here)}`}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-indigo-700"
            >
              Create an account
            </Link>
            <Link
              href={`/login?next=${encodeURIComponent(here)}`}
              className="rounded-lg border border-black/15 px-4 py-2 text-center text-sm font-medium hover:bg-neutral-50 dark:border-white/15 dark:hover:bg-neutral-800"
            >
              I already have an account
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}
