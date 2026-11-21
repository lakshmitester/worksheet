import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";

const FEATURES = [
  [
    "Exam-style worksheets",
    "Build 11+ English worksheets from a checked question bank in seconds.",
  ],
  [
    "Your branding",
    "Your logo, colours and center name on every print-ready PDF.",
  ],
  [
    "Live tests, no logins",
    "Share a link. Students answer on any device and are scored automatically.",
  ],
];

export default async function Home() {
  if (await getUser()) redirect("/dashboard");

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-12 px-4 py-16">
      <div className="flex flex-col gap-5">
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          English worksheets and live tests for tuition centers
        </h1>
        <p className="max-w-xl text-lg text-neutral-600 dark:text-neutral-400">
          Branded, exam-style practice for your students, without the hours of
          formatting and marking.
        </p>
        <div className="flex gap-3">
          <Link
            href="/signup"
            className="rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-700"
          >
            Create your center
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-black/15 px-5 py-2.5 font-medium hover:bg-white dark:border-white/15 dark:hover:bg-neutral-900"
          >
            Sign in
          </Link>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {FEATURES.map(([title, body]) => (
          <div
            key={title}
            className="rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-neutral-900"
          >
            <h2 className="mb-1 font-semibold">{title}</h2>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              {body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
