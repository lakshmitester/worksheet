import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const { safeNext } = await import("./auth");

describe("safeNext", () => {
  it.each([
    ["/dashboard?center=1", "/dashboard?center=1"],
    ["/invite/abc", "/invite/abc"],
    ["//evil.example", "/dashboard"],
    ["/\\evil.example", "/dashboard"],
    ["https://evil.example", "/dashboard"],
    ["", "/dashboard"],
    [undefined, "/dashboard"],
    [42, "/dashboard"],
  ])("safeNext(%j) -> %s", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});
