import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  Actor,
  canonicalJson,
  fromHex,
  GENESIS_HASH,
  hashLogEntry,
  LogEntry,
  LogEvent,
  MEMO_TYPE,
  verifyChain,
  toHex,
} from "../src/index";

type Entry = LogEntry;
type Unhashed = Omit<LogEntry, "hash">;

/** The fixed entry every service checks itself against. Change it and every service's self-test breaks. */
const KNOWN_ENTRY: Unhashed = {
  seq: 1,
  ts: "2026-11-12T08:00:00.000Z",
  actor: "agent",
  event: "payment_requested",
  invoiceNumber: "INV-1042",
  supplierId: "sup_karoo",
  amount: "30.00",
  ruleCode: null,
  explanation: "Agent requested payment of INV-1042.",
  txHash: null,
  ledgerResult: null,
  prevHash: GENESIS_HASH,
};

/** KNOWN_ENTRY written out by hand with its keys sorted, so this test does not trust canonicalJson. */
const KNOWN_CANONICAL =
  '{"actor":"agent","amount":"30.00","event":"payment_requested","explanation":"Agent requested payment of INV-1042.",' +
  '"invoiceNumber":"INV-1042","ledgerResult":null,"prevHash":"' + "0".repeat(64) + '","ruleCode":null,"seq":1,' +
  '"supplierId":"sup_karoo","ts":"2026-11-12T08:00:00.000Z","txHash":null}';

/** sha256(GENESIS_HASH + KNOWN_CANONICAL), computed once with node:crypto. Other services can copy this known-answer hash. */
const KNOWN_ANSWER_HASH = "03de26b9343749d04738c706e3b015f59e2c90233ab56ccac30f9e31b7dced43";

describe("canonicalJson", () => {
  it("gives the same output whatever order the keys were inserted in", () => {
    const a = { b: 1, a: { d: [1, { z: true, y: null }], c: "x" } };
    const b = { a: { c: "x", d: [1, { y: null, z: true }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":{"c":"x","d":[1,{"y":null,"z":true}]},"b":1}');
  });

  it("sorts keys by UTF-16 code unit, not by locale", () => {
    expect(canonicalJson({ a: 1, B: 2, _: 3, "ä": 4 })).toBe('{"B":2,"_":3,"a":1,"ä":4}');
  });

  it("keeps array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("escapes strings exactly like JSON", () => {
    expect(canonicalJson({ s: 'a"b\\c\n é' })).toBe(JSON.stringify({ s: 'a"b\\c\n é' }));
  });

  it("matches the hand-written canonical form of the known entry", () => {
    expect(canonicalJson(KNOWN_ENTRY)).toBe(KNOWN_CANONICAL);
  });

  it.each([
    ["30.5 (money must be a string)", { amount: 30.5 }],
    ["NaN", { n: Number.NaN }],
    ["Infinity", { n: Number.POSITIVE_INFINITY }],
    ["an unsafe integer", { n: 2 ** 53 }],
    ["undefined as a value", { a: undefined }],
    ["undefined at the top level", undefined],
    ["undefined inside an array", [1, undefined]],
    ["a function", { f: () => 1 }],
    ["a bigint", { n: 1n }],
    ["a symbol", { s: Symbol("x") }],
    ["a Date (not a plain object)", { ts: new Date(0) }],
    ["a Map", new Map([["a", 1]])],
  ])("refuses %s", (_label, value) => {
    expect(() => canonicalJson(value)).toThrow();
  });

  it("refuses a hole in an array, rather than reading it as undefined or null", () => {
    expect(() => canonicalJson([1, , 3])).toThrow(/holes/); // eslint-disable-line no-sparse-arrays
  });

  it("refuses a cycle instead of overflowing the stack", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => canonicalJson(loop)).toThrow(/cycle/i);
  });

  it("accepts null-prototype objects", () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { b: 2, a: 1 });
    expect(canonicalJson(bare)).toBe('{"a":1,"b":2}');
  });
});

describe("hashLogEntry", () => {
  it("matches the known answer, computed independently with node:crypto", async () => {
    const independent = createHash("sha256").update(GENESIS_HASH + KNOWN_CANONICAL, "utf8").digest("hex");
    expect(independent).toBe(KNOWN_ANSWER_HASH);
    expect(await hashLogEntry(GENESIS_HASH, KNOWN_ENTRY)).toBe(KNOWN_ANSWER_HASH);
  });

  it("returns 64 lower-case hex characters", async () => {
    expect(await hashLogEntry(GENESIS_HASH, KNOWN_ENTRY)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any field changes", async () => {
    const edited = await hashLogEntry(GENESIS_HASH, { ...KNOWN_ENTRY, amount: "30.01" });
    expect(edited).not.toBe(KNOWN_ANSWER_HASH);
  });

  it("refuses a prevHash that is not 64 lower-case hex", async () => {
    await expect(hashLogEntry("0".repeat(63), { ...KNOWN_ENTRY, prevHash: "0".repeat(63) })).rejects.toThrow();
    await expect(hashLogEntry("A".repeat(64), { ...KNOWN_ENTRY, prevHash: "A".repeat(64) })).rejects.toThrow();
  });

  it("refuses an entry whose own prevHash disagrees with the one given", async () => {
    await expect(hashLogEntry("1".repeat(64), KNOWN_ENTRY)).rejects.toThrow();
  });

  it("refuses an entry that already has a hash field", async () => {
    const withHash = { ...KNOWN_ENTRY, hash: KNOWN_ANSWER_HASH } as Unhashed;
    await expect(hashLogEntry(GENESIS_HASH, withHash)).rejects.toThrow();
  });
});

async function buildChain(count: number): Promise<Entry[]> {
  const chain: Entry[] = [];
  let prevHash = GENESIS_HASH;
  for (let seq = 1; seq <= count; seq++) {
    const row: Unhashed = { ...KNOWN_ENTRY, seq, ts: `2026-11-12T08:00:0${seq}.000Z`, explanation: `row ${seq}`, prevHash };
    const hash = await hashLogEntry(prevHash, row);
    chain.push({ ...row, hash });
    prevHash = hash;
  }
  return chain;
}

describe("verifyChain", () => {
  it("returns null for an intact chain", async () => {
    const chain = await buildChain(5);
    expect(chain.every((entry) => LogEntry.safeParse(entry).success)).toBe(true);
    expect(await verifyChain(chain)).toBeNull();
  });

  it("returns null for an empty log", async () => {
    expect(await verifyChain([])).toBeNull();
  });

  it("catches an edited row at its seq", async () => {
    const chain = await buildChain(5);
    chain[2] = { ...chain[2]!, amount: "4500.00" };
    expect(await verifyChain(chain)).toBe(3);
  });

  it("catches an edited row whose hash was recomputed, at the next seq", async () => {
    const chain = await buildChain(5);
    const { hash: _old, ...row } = { ...chain[2]!, amount: "4500.00" };
    chain[2] = { ...row, hash: await hashLogEntry(row.prevHash, row) };
    expect(await verifyChain(chain)).toBe(4);
  });

  it("catches a deleted row at the seq after it", async () => {
    const chain = await buildChain(5);
    chain.splice(1, 1);
    expect(await verifyChain(chain)).toBe(3);
  });

  it("catches a deleted first row", async () => {
    const chain = await buildChain(3);
    chain.shift();
    expect(await verifyChain(chain)).toBe(2);
  });

  it("catches two swapped rows", async () => {
    const chain = await buildChain(5);
    [chain[1], chain[2]] = [chain[2]!, chain[1]!];
    expect(await verifyChain(chain)).toBe(3);
  });

  it("catches a first row that does not start from the genesis hash", async () => {
    const prevHash = "1".repeat(64);
    const row: Unhashed = { ...KNOWN_ENTRY, prevHash };
    const forged = { ...row, hash: await hashLogEntry(prevHash, row) };
    expect(await verifyChain([forged])).toBe(1);
  });

  it("catches a row with an extra field, even when its hash covers that field", async () => {
    const chain = await buildChain(3);
    const { hash: _old, ...row } = { ...chain[1]!, destination: "rAnything" } as Entry & { destination: string };
    chain[1] = { ...row, hash: await hashLogEntry(row.prevHash, row as Unhashed) } as Entry;
    expect(await verifyChain(chain)).toBe(2);
  });

  it("catches a seq that jumps (1 then 5), even when the hashes link", async () => {
    const [first] = await buildChain(1);
    const row: Unhashed = { ...KNOWN_ENTRY, seq: 5, ts: "2026-11-12T08:00:05.000Z", prevHash: first!.hash };
    const jumped = { ...row, hash: await hashLogEntry(row.prevHash, row) };
    expect(await verifyChain([first!, jumped])).toBe(5);
  });

  it("catches a chain whose first seq is not 1", async () => {
    const row: Unhashed = { ...KNOWN_ENTRY, seq: 2 };
    const entry = { ...row, hash: await hashLogEntry(row.prevHash, row) };
    expect(await verifyChain([entry])).toBe(2);
  });

  it("reports a row that cannot be canonicalised instead of throwing", async () => {
    const chain = await buildChain(2);
    chain[1] = { ...chain[1]!, amount: 30.5 as unknown as string };
    expect(await verifyChain(chain)).toBe(2);
  });
});

describe("toHex and fromHex", () => {
  it("encodes the memo type as upper-case hex, as XRPL returns it", () => {
    expect(toHex(MEMO_TYPE)).toBe("73687563616D6F78612F6C6F67");
  });

  it.each(["shucamoxa/log", "", "Société", "日本"])("round-trips %j", (text) => {
    expect(fromHex(toHex(text))).toBe(text);
  });

  it("decodes lower-case hex too", () => {
    expect(fromHex("73687563616D6F7861")).toBe("shucamoxa");
  });

  it.each(["0", "zz", "70 61", "C3"])("fromHex refuses %j (odd length, not hex, or not UTF-8)", (hex) => {
    expect(() => fromHex(hex)).toThrow();
  });
});

describe("LogEvent, Actor and LogEntry", () => {
  it("has exactly the 13 events in the spec", () => {
    expect([...LogEvent.options].sort()).toEqual(
      [
        "invoice_received", "invoice_extracted", "payment_requested", "policy_allowed", "policy_blocked",
        "payment_settled", "payment_failed", "approval_requested", "approval_decided", "rules_changed",
        "kill_switch_on", "kill_switch_off", "signer_list_changed",
      ].sort(),
    );
  });

  it("has the five actors", () => {
    expect([...Actor.options].sort()).toEqual(["agent", "owner", "payment", "policy", "system"]);
  });

  it.each([
    ["a float amount", { amount: 30 }],
    ["an unknown event", { event: "funds_moved" }],
    ["an unknown actor", { actor: "model" }],
    ["seq 0", { seq: 0 }],
    ["a non-ISO timestamp", { ts: "12 Nov 2026" }],
    ["an upper-case hash", { hash: "A".repeat(64) }],
    ["a short tx hash", { txHash: "TX4" }],
    ["an extra field", { destination: "r123" }],
    ["an explanation over 500 characters", { explanation: "x".repeat(501) }],
  ])("rejects an entry with %s", async (_label, override) => {
    const [entry] = await buildChain(1);
    expect(LogEntry.safeParse(entry).success).toBe(true);
    expect(LogEntry.safeParse({ ...entry, ...override }).success).toBe(false);
  });

  it("accepts a settled entry with a real-shaped tx hash and ledger result", async () => {
    const [entry] = await buildChain(1);
    const settled = { ...entry, event: "payment_settled", actor: "payment", ruleCode: "OK", txHash: "C".repeat(64), ledgerResult: "tesSUCCESS" };
    expect(LogEntry.safeParse(settled).success).toBe(true);
  });
});
