import { afterEach, describe, expect, it } from "vitest";
import { startTestBackend, type TestBackend } from "./support/backend";

let backend: TestBackend;
afterEach(() => backend?.close());

describe("POST /dev/kill-switch (mock only, owner token only)", () => {
  it("refuses the agent token with 403 and leaves the kill switch off", async () => {
    backend = await startTestBackend();
    expect((await backend.agent("POST", "/dev/kill-switch", { on: true })).status).toBe(403);
    expect((await backend.agent("GET", "/rules")).json.killSwitch).toBe(false);
  });

  it("refuses the agent token turning it off again", async () => {
    backend = await startTestBackend();
    await backend.owner("POST", "/dev/kill-switch", { on: true });
    expect((await backend.agent("POST", "/dev/kill-switch", { on: false })).status).toBe(403);
    expect((await backend.agent("GET", "/rules")).json.killSwitch).toBe(true);
  });

  it("accepts MOCK_OWNER_TOKEN with 200 and logs the change as the owner", async () => {
    backend = await startTestBackend();
    const on = await backend.owner("POST", "/dev/kill-switch", { on: true });
    expect(on).toMatchObject({ status: 200, json: { killSwitch: true } });
    const off = await backend.owner("POST", "/dev/kill-switch", { on: false });
    expect(off).toMatchObject({ status: 200, json: { killSwitch: false } });
    const events = (await backend.agent("GET", "/log")).json.map((e: { event: string; actor: string }) => `${e.actor}:${e.event}`);
    expect(events).toEqual(["owner:kill_switch_off", "owner:kill_switch_on"]);
  });

  it("is 401 without a token and 400 for a bad body", async () => {
    backend = await startTestBackend();
    expect((await backend.anonymous("POST", "/dev/kill-switch", { on: true })).status).toBe(401);
    expect((await backend.owner("POST", "/dev/kill-switch", { on: "yes" })).status).toBe(400);
  });
});

describe("token scopes", () => {
  it("refuses the owner token on agent routes, so the two can't be swapped", async () => {
    backend = await startTestBackend();
    expect((await backend.owner("GET", "/rules")).status).toBe(403);
    expect((await backend.owner("POST", "/payments", { supplierId: "sup_karoo", amount: "1.00", invoiceNumber: "I-1", reason: "x" })).status).toBe(403);
  });

  it("refuses a token that only shares a prefix with the real one", async () => {
    backend = await startTestBackend();
    const res = await fetch(`${backend.url}/rules`, { headers: { Authorization: "Bearer test-agent-token" } });
    expect(res.status).toBe(401);
    const lower = await fetch(`${backend.url}/rules`, { headers: { Authorization: "bearer test-agent-token-not-a-secret-000001x" } });
    expect(lower.status).toBe(401);
  });

  it("marks every response as coming from the mock and never echoes the token", async () => {
    backend = await startTestBackend();
    for (const res of [await backend.agent("GET", "/rules"), await backend.anonymous("GET", "/rules"), await backend.agent("GET", "/nope")]) {
      expect(res.headers.get("x-shucamoxa-mock")).toBe("1");
      expect(res.text).not.toContain("test-agent-token");
    }
  });
});
