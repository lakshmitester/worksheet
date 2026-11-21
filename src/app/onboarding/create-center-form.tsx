"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { createCenter } from "./actions";

export function CreateCenterForm() {
  const [state, action, pending] = useActionState(createCenter, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      {state?.error && <Alert>{state.error}</Alert>}
      <Field
        label="Center name"
        hint="Shown on your worksheets and PDFs. You can change it later."
      >
        <Input
          name="name"
          required
          maxLength={120}
          placeholder="e.g. Bright Minds Tuition"
          autoFocus
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create center"}
      </Button>
    </form>
  );
}
