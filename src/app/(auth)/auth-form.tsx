"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { signIn, signUp } from "./actions";

export function AuthForm({
  mode,
  next,
  notice,
}: {
  mode: "login" | "signup";
  next?: string;
  notice?: string;
}) {
  const [state, action, pending] = useActionState(
    mode === "login" ? signIn : signUp,
    undefined,
  );
  const isLogin = mode === "login";
  const otherHref = `${isLogin ? "/signup" : "/login"}${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <Card className="w-full max-w-sm">
      <h1 className="mb-1 text-xl font-semibold">
        {isLogin ? "Sign in" : "Create your account"}
      </h1>
      <p className="mb-5 text-sm text-neutral-500">
        {isLogin ? "Welcome back." : "Set up your tuition center in a minute."}
      </p>

      <form action={action} className="flex flex-col gap-4">
        {next && <input type="hidden" name="next" value={next} />}
        {notice && <Alert kind="info">{notice}</Alert>}
        {state?.error && <Alert>{state.error}</Alert>}

        {!isLogin && (
          <Field label="Your name">
            <Input
              name="displayName"
              autoComplete="name"
              required
              maxLength={80}
            />
          </Field>
        )}
        <Field label="Email">
          <Input
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={state?.email}
          />
        </Field>
        <Field
          label="Password"
          hint={isLogin ? undefined : "At least 8 characters"}
        >
          <Input
            name="password"
            type="password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            required
            minLength={isLogin ? undefined : 8}
          />
        </Field>

        <Button type="submit" disabled={pending}>
          {pending ? "Please wait…" : isLogin ? "Sign in" : "Create account"}
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-neutral-500">
        {isLogin ? "New here? " : "Already have an account? "}
        <Link
          href={otherHref}
          className="font-medium text-indigo-600 hover:underline"
        >
          {isLogin ? "Create an account" : "Sign in"}
        </Link>
      </p>
    </Card>
  );
}
