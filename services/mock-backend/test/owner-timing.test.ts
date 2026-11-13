import { describe, expect, it, vi } from "vitest";

// Wrap timingSafeEqual so the test can see that every login attempt goes through it.
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const { timingSafeEqual } = await import("node:crypto");
const { loadMockConfig, ownerTokenMatches } = await import("../src/config");
const { AGENT_TOKEN, MOCK_ENV, OWNER_TOKEN } = await import("./support/backend");

const spy = vi.mocked(timingSafeEqual);

describe("owner token check (POST /owner/login)", () => {
  const config = loadMockConfig(MOCK_ENV);

  it("accepts only the exact owner token", () => {
    expect(ownerTokenMatches(config, OWNER_TOKEN)).toBe(true);
    expect(ownerTokenMatches(config, AGENT_TOKEN)).toBe(false);
  });

  it.each([
    ["empty", ""],
    ["one character", "t"],
    ["a prefix", OWNER_TOKEN.slice(0, 20)],
    ["one wrong last character", OWNER_TOKEN.replace(/.$/, "X")],
    ["much longer", OWNER_TOKEN.repeat(8)],
  ])("compares %s input in constant time over equal-length digests, with no length shortcut", (_name, presented) => {
    const before = spy.mock.calls.length;
    expect(ownerTokenMatches(config, presented)).toBe(false);
    expect(spy.mock.calls.length - before).toBe(1);
    const [a, b] = spy.mock.calls.at(-1)! as unknown as [Buffer, Buffer];
    expect(a.length).toBe(32);
    expect(b.length).toBe(32);
  });
});
