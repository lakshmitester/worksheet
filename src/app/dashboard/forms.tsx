"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { createInvite, renameCenter, updateMember } from "./actions";

export function InviteForm({ centerId }: { centerId: string }) {
  const [state, action, pending] = useActionState(createInvite, undefined);
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <form
        action={action}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <input type="hidden" name="centerId" value={centerId} />
        <div className="flex-1">
          <Field label="Email">
            <Input
              name="email"
              type="email"
              required
              placeholder="tutor@example.com"
            />
          </Field>
        </div>
        <Field label="Role">
          <Select name="role" defaultValue="tutor">
            <option value="tutor">Tutor</option>
            <option value="owner">Owner</option>
          </Select>
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create invite link"}
        </Button>
      </form>

      {state?.error && <Alert>{state.error}</Alert>}
      {state?.inviteUrl && (
        <div className="flex flex-col gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950">
          <p className="text-sm text-emerald-900 dark:text-emerald-200">
            Invite created for <strong>{state.email}</strong>. Send them this
            link. It works once, only for that email, and expires in 7 days. You
            won&apos;t be able to see it again.
          </p>
          <div className="flex gap-2">
            <Input
              readOnly
              value={state.inviteUrl}
              className="flex-1 font-mono text-xs"
              onFocus={(e) => e.target.select()}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(state.inviteUrl!);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function MemberActions({
  centerId,
  userId,
  role,
  status,
  isSelf,
}: {
  centerId: string;
  userId: string;
  role: string;
  status: string;
  isSelf: boolean;
}) {
  const [state, action, pending] = useActionState(updateMember, undefined);
  const btn = (
    change: string,
    label: string,
    variant: "secondary" | "danger" = "secondary",
  ) => (
    <form action={action}>
      <input type="hidden" name="centerId" value={centerId} />
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="change" value={change} />
      <Button
        type="submit"
        variant={variant}
        disabled={pending}
        className="px-2.5 py-1 text-xs"
      >
        {label}
      </Button>
    </form>
  );

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        {status === "active" ? (
          <>
            {role === "tutor"
              ? btn("make_owner", "Make owner")
              : btn("make_tutor", "Make tutor")}
            {btn("remove", isSelf ? "Leave" : "Remove", "danger")}
          </>
        ) : (
          btn("restore", "Restore")
        )}
      </div>
      {state?.error && (
        <span className="text-xs text-red-600 dark:text-red-400">
          {state.error}
        </span>
      )}
    </div>
  );
}

export function RenameCenterForm({
  centerId,
  name,
}: {
  centerId: string;
  name: string;
}) {
  const [state, action, pending] = useActionState(renameCenter, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="centerId" value={centerId} />
      <div className="flex gap-2">
        <Input
          name="name"
          defaultValue={name}
          required
          maxLength={120}
          className="flex-1"
          aria-label="Center name"
        />
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      {state?.error && <Alert>{state.error}</Alert>}
      {state?.ok && <Alert kind="success">Saved.</Alert>}
    </form>
  );
}
