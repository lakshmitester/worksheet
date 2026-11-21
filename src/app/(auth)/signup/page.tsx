import { redirect } from "next/navigation";
import { getUser, safeNext } from "@/lib/auth";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Create account · Worksheet" };

export default async function SignupPage({
  searchParams,
}: PageProps<"/signup">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? safeNext(sp.next) : undefined;
  if (await getUser()) redirect(next ?? "/dashboard");
  return <AuthForm mode="signup" next={next} />;
}
