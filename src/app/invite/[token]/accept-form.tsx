"use client";

import { useActionState } from "react";
import { Alert, Button } from "@/components/ui";
import { acceptInvite } from "./actions";

export function AcceptInviteForm({
  token,
  email,
}: {
  token: string;
  email: string;
}) {
  const [state, action, pending] = useActionState(acceptInvite, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <p className="text-sm">
        Signed in as <strong>{email}</strong>.
      </p>
      {state?.error && <Alert>{state.error}</Alert>}
      <Button type="submit" disabled={pending}>
        {pending ? "Joining…" : "Accept and join"}
      </Button>
    </form>
  );
}
