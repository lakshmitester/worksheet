import { expect, test, type Page } from "@playwright/test";

// Full onboarding journey against the configured Supabase project (staging).
// Users are created pre-confirmed via the Admin API, so no email is needed,
// and everything is cleaned up afterwards.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;

test.skip(
  !URL || !SECRET,
  "needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY",
);

const run = Date.now().toString(36);
const password = `E2e-${run}-pass!`;
const owner = { name: "Olivia Owner", email: `e2e-${run}-owner@example.test` };
const tutor = { name: "Tom Tutor", email: `e2e-${run}-tutor@example.test` };
const centerName = `E2E Tuition ${run}`;
const createdUserIds: string[] = [];

async function admin(path: string, init: RequestInit = {}) {
  const res = await fetch(`${URL}${path}`, {
    ...init,
    headers: {
      apikey: SECRET!,
      Authorization: `Bearer ${SECRET}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  return res.status === 204 ? null : res.json();
}

async function createConfirmedUser(u: { name: string; email: string }) {
  const user = await admin("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email: u.email,
      password,
      email_confirm: true,
      user_metadata: { display_name: u.name },
    }),
  });
  createdUserIds.push(user.id);
}

async function signIn(page: Page, email: string, path = "/login") {
  await page.goto(path);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.beforeAll(async () => {
  await createConfirmedUser(owner);
  await createConfirmedUser(tutor);
});

test.afterAll(async () => {
  const centers = await admin(
    `/rest/v1/centers?select=id&name=eq.${encodeURIComponent(centerName)}`,
  );
  for (const c of centers ?? [])
    await admin(`/rest/v1/centers?id=eq.${c.id}`, { method: "DELETE" });
  for (const id of createdUserIds)
    await admin(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
});

test("owner creates a center, invites a tutor, tutor joins", async ({
  browser,
}) => {
  // --- Owner: sign in -> onboarding -> create center -> invite
  const ownerCtx = await browser.newContext();
  const op = await ownerCtx.newPage();
  await signIn(op, owner.email, "/login?next=/onboarding");
  await expect(
    op.getByRole("heading", { name: "Set up your tuition center" }),
  ).toBeVisible();
  await op.getByLabel("Center name").fill(centerName);
  await op.getByRole("button", { name: "Create center" }).click();

  await expect(
    op.getByRole("heading", { level: 1, name: centerName }),
  ).toBeVisible();
  await expect(
    op.getByText("You are an owner · 1 active member"),
  ).toBeVisible();

  await op.getByLabel("Email").fill(tutor.email);
  await op.getByRole("button", { name: "Create invite link" }).click();
  const linkBox = op.locator('input[readonly][value*="/invite/"]');
  await expect(linkBox).toBeVisible();
  const inviteUrl = await linkBox.inputValue();
  await expect(op.getByText("Pending invites")).toBeVisible();

  // --- Tutor: open invite signed out -> sign in -> accept
  const tutorCtx = await browser.newContext();
  const tp = await tutorCtx.newPage();
  await tp.goto(inviteUrl);
  await expect(
    tp.getByRole("heading", { name: "You've been invited" }),
  ).toBeVisible();
  await tp.getByRole("link", { name: "I already have an account" }).click();
  await tp.getByLabel("Email").fill(tutor.email);
  await tp.getByLabel("Password").fill(password);
  await tp.getByRole("button", { name: "Sign in" }).click();
  await tp.getByRole("button", { name: "Accept and join" }).click();

  await expect(
    tp.getByRole("heading", { level: 1, name: centerName }),
  ).toBeVisible();
  await expect(
    tp.getByText("You are a tutor · 2 active members"),
  ).toBeVisible();
  await expect(tp.getByText(owner.name)).toBeVisible();
  // Tutors cannot invite.
  await expect(tp.getByRole("heading", { name: "Invite a tutor" })).toHaveCount(
    0,
  );

  // --- Owner sees the tutor; invite link cannot be reused
  await op.reload();
  await expect(op.getByText(tutor.name)).toBeVisible();
  await expect(op.getByText("Pending invites")).toHaveCount(0);

  await tp.goto(inviteUrl);
  await tp.getByRole("button", { name: "Accept and join" }).click();
  await expect(
    tp.getByText("This invite is invalid, has expired"),
  ).toBeVisible();

  // --- Owner removes the tutor -> tutor loses access
  await op
    .getByRole("listitem")
    .filter({ hasText: tutor.name })
    .getByRole("button", { name: "Remove" })
    .click();
  // Profiles of removed members are hidden by RLS, so the row shows "Former member".
  await expect(
    op
      .getByRole("listitem")
      .filter({ hasText: "Former member" })
      .getByText("removed"),
  ).toBeVisible();
  await tp.goto("/dashboard");
  await expect(
    tp.getByRole("heading", { name: "Set up your tuition center" }),
  ).toBeVisible();

  // --- Sign out
  await op.getByRole("button", { name: "Sign out" }).click();
  await expect(op.getByRole("link", { name: "Sign in" }).first()).toBeVisible();

  await ownerCtx.close();
  await tutorCtx.close();
});

test("signed-out users are sent to sign in", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
