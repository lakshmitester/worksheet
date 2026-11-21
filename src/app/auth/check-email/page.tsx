import Link from "next/link";
import { Card } from "@/components/ui";

export const metadata = { title: "Check your email · Worksheet" };

export default async function CheckEmailPage({
  searchParams,
}: PageProps<"/auth/check-email">) {
  const { email } = await searchParams;
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm text-center">
        <h1 className="mb-2 text-xl font-semibold">Check your email</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          We sent a confirmation link to{" "}
          <strong className="text-neutral-900 dark:text-neutral-100">
            {typeof email === "string" ? email : "your inbox"}
          </strong>
          . Open it to finish creating your account.
        </p>
        <p className="mt-5 text-sm">
          <Link
            href="/login"
            className="font-medium text-indigo-600 hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
