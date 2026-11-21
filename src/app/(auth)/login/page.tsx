import { redirect } from "next/navigation";
import { getUser, safeNext } from "@/lib/auth";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Sign in · Worksheet" };

const NOTICES: Record<string, string> = {
  link: "That link is invalid or has expired. Please sign in, or request a new link.",
  confirmed: "Email confirmed. Please sign in.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? safeNext(sp.next) : undefined;
  if (await getUser()) redirect(next ?? "/dashboard");
  const notice = typeof sp.error === "string" ? NOTICES[sp.error] : undefined;
  return <AuthForm mode="login" next={next} notice={notice} />;
}
