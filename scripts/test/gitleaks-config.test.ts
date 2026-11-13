import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./support/git-sandbox";

// Reads .gitleaks.toml and checks its custom rules with JavaScript regexes. The rules
// use only syntax that means the same in Go RE2 and JavaScript (\b, classes, {m,n});
// a leading (?i) is the one Go-only construct and is turned into the "i" flag here.
// CI's "secrets" job runs the real gitleaks binary against the same file.

const TOML = readFileSync(join(REPO_ROOT, ".gitleaks.toml"), "utf8");

type Allowlist = { body: string; paths: string[]; regexes: string[]; regexTarget?: string; condition?: string };
type Rule = { id: string; regex: RegExp; allowlists: Allowlist[] };

const literals = (body: string, key: string) => {
  const m = body.match(new RegExp(`^\\s*${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, "m"));
  return m ? [...m[1]!.matchAll(/'''([\s\S]*?)'''/g)].map((x) => x[1]!) : [];
};
const scalar = (body: string, key: string) => body.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m"))?.[1];
const goRegex = (src: string, extra = "") =>
  src.startsWith("(?i)") ? new RegExp(src.slice(4), `i${extra}`) : new RegExp(src, extra);

function parseRules(): Rule[] {
  return TOML.split(/^\[\[rules\]\]\s*$/m)
    .slice(1)
    .map((block) => {
      const [head, ...lists] = block.split(/^\s*\[\[rules\.allowlists\]\]\s*$/m);
      const id = scalar(head!, "id")!;
      const regex = head!.match(/^\s*regex\s*=\s*'''([\s\S]*?)'''/m)![1]!;
      const allowlists = lists.map((body) => ({
        body,
        paths: literals(body, "paths"),
        regexes: literals(body, "regexes"),
        regexTarget: scalar(body, "regexTarget"),
        condition: scalar(body, "condition"),
      }));
      return { id, regex: goRegex(regex, "g"), allowlists };
    });
}

const RULES = parseRules();
const rule = (id: string) => {
  const r = RULES.find((x) => x.id === id);
  if (!r) throw new Error(`no rule ${id} in .gitleaks.toml`);
  return r;
};
const secrets = (r: Rule, text: string) => [...text.matchAll(r.regex)].map((m) => m[1] ?? m[0]);

/** Mirrors gitleaks: a finding is dropped if any allowlist on the rule matches it. */
function allowed(r: Rule, finding: { path: string; secret: string; line: string }) {
  return r.allowlists.some((a) => {
    const checks: boolean[] = [];
    if (a.paths.length) checks.push(a.paths.some((p) => goRegex(p).test(finding.path)));
    if (a.regexes.length) {
      const target = a.regexTarget === "line" ? finding.line : finding.secret;
      checks.push(a.regexes.some((re) => goRegex(re).test(target)));
    }
    return a.condition === "AND" ? checks.every(Boolean) : checks.some(Boolean);
  });
}

// Built at runtime so this file holds no seed or key literal for scanners to flag.
const FAKE_SEED = "sEdT" + "FAKE".repeat(6) + "FAK";
const B58 = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";
const b58 = (n: number) => Array.from({ length: n }, (_, i) => B58[(i * 7 + 3) % B58.length]).join("");
const hex = (n: number) => Array.from({ length: n }, (_, i) => "0123456789ABCDEF"[(i * 5 + 1) % 16]).join("");

const CONFIG_TEST = "services/agent/test/config.test.ts";
const FAKE_SEEDS_IN_CONFIG_TEST = [
  ...new Set(readFileSync(join(REPO_ROOT, CONFIG_TEST), "utf8").match(/\bs[A-Za-z0-9]{28,30}\b/g) ?? []),
];

describe(".gitleaks.toml keeps gitleaks' default rules", () => {
  it("extends the default config", () => {
    expect(TOML).toMatch(/^\[extend\]\s*\n\s*useDefault\s*=\s*true/m);
  });
});

describe("xrpl-family-seed rule", () => {
  const seedRule = rule("xrpl-family-seed");

  it("catches the 31-character fake ed25519 seed from the ticket", () => {
    expect(FAKE_SEED).toHaveLength(31);
    expect(secrets(seedRule, `AGENT_SEED=${FAKE_SEED}`)).toEqual([FAKE_SEED]);
  });

  it.each([29, 30, 31])("catches a %i-character seed in quotes, JSON and env syntax", (len) => {
    const seed = "s" + b58(len - 1);
    for (const text of [`seed: "${seed}"`, `{"seed":"${seed}"}`, `SEED=${seed}`, `'${seed}'`]) {
      expect(secrets(seedRule, text)).toEqual([seed]);
    }
  });

  it("catches every deliberately fake seed in the agent config test", () => {
    expect(FAKE_SEEDS_IN_CONFIG_TEST.length).toBeGreaterThan(0);
    for (const seed of FAKE_SEEDS_IN_CONFIG_TEST) expect(secrets(seedRule, `"${seed}"`)).toEqual([seed]);
  });

  it.each([
    ["too short", "s" + b58(27)],
    ["too long", "s" + b58(31)],
    ["an XRPL classic address", "r" + b58(30)],
    ["characters outside the Ripple alphabet", "s" + b58(20) + "0OIl" + b58(5)],
    ["a seed-shaped run inside a longer word", "x" + "s" + b58(28)],
  ])("ignores %s", (_label, text) => {
    expect(secrets(seedRule, ` ${text} `)).toEqual([]);
  });

  it("allowlists the fake seeds only in the agent config test", () => {
    for (const seed of FAKE_SEEDS_IN_CONFIG_TEST) {
      expect(allowed(seedRule, { path: CONFIG_TEST, secret: seed, line: `"${seed}"` })).toBe(true);
      expect(allowed(seedRule, { path: "services/agent/src/config.ts", secret: seed, line: "" })).toBe(false);
      expect(allowed(seedRule, { path: `services/agent/test/x/${CONFIG_TEST}`, secret: seed, line: "" })).toBe(false);
      expect(allowed(seedRule, { path: "services/agent/test/config.test.ts.bak", secret: seed, line: "" })).toBe(false);
    }
  });

  it("still flags a different seed pasted into the allowlisted test file", () => {
    expect(allowed(seedRule, { path: CONFIG_TEST, secret: FAKE_SEED, line: `"${FAKE_SEED}"` })).toBe(false);
  });
});

describe("hex private key rules", () => {
  const prefixed = rule("xrpl-hex-private-key");
  const bare = rule("hex-private-key-64");

  it.each(["ED", "00", "ed"])("catches a %s-prefixed 64-hex XRPL private key", (prefix) => {
    const key = prefix + hex(64);
    expect(secrets(prefixed, `privateKey: "${key}"`)).toEqual([key]);
    expect(secrets(bare, `privateKey: "${key}"`)).toEqual([]);
  });

  it("catches a bare 64-hex key wherever the line doesn't label it a hash", () => {
    const key = hex(64);
    for (const line of [`POLICY_KEY=${key}`, `{"k":"${key}"}`, `const secret = "${key.toLowerCase()}";`]) {
      const [found] = secrets(bare, line);
      expect(found).toBeDefined();
      expect(allowed(bare, { path: "services/policy/src/keys.ts", secret: found!, line })).toBe(false);
    }
  });

  it("rejects raw keys regardless of hash-like labels or checksum comments", () => {
    const value = hex(64);
    for (const line of [`txHash: "${value}"`, `prev_hash=${value}`, `GITLEAKS_SHA256: ${value}`, `digest: ${value}`, `KEY=${value} # checksum`]) {
      expect(secrets(bare, line)).toEqual([value]);
      expect(allowed(bare, { path: "fixtures/ledger.json", secret: value, line })).toBe(false);
    }
  });

  it("never lets a prefixed private key through, even on a line that mentions a hash", () => {
    const key = "ED" + hex(64);
    expect(allowed(prefixed, { path: "x.ts", secret: key, line: `txHash: "${key}"` })).toBe(false);
  });

  it.each([
    ["63 hex characters", hex(63)],
    ["a 40-hex git commit SHA", hex(40)],
  ])("ignores %s", (_label, text) => {
    expect(secrets(bare, ` ${text} `)).toEqual([]);
    expect(secrets(prefixed, ` ${text} `)).toEqual([]);
  });
});

describe("allowlists stay narrow", () => {
  it("has no global allowlist that could hide findings from every rule", () => {
    expect(TOML).not.toMatch(/^\s*\[\[?allowlists?\]\]?\s*$/m);
  });

  it("names only exact files that exist, with no directory or wildcard paths", () => {
    const paths = RULES.flatMap((r) => r.allowlists.flatMap((a) => a.paths));
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(p).toMatch(/^\^(?:\\\.)?[\w/-]+(\\\.[\w-]+)+\$$/);
      const file = p.slice(1, -1).replace(/\\\./g, ".");
      expect(existsSync(join(REPO_ROOT, file)), file).toBe(true);
    }
  });

  it("pins every path allowlist to specific secret values too", () => {
    for (const r of RULES) {
      for (const a of r.allowlists.filter((x) => x.paths.length)) {
        expect(a.condition).toBe("AND");
        expect(a.regexes.length).toBeGreaterThan(0);
        for (const re of a.regexes) expect(re).toMatch(/^\^[A-Za-z0-9]+\$$/);
      }
    }
  });
});

it('allows only the exact public upstream hash fixtures at their test paths', () => {
  const bare = rule('hex-private-key-64');
  const paths = ['packages/db/test/audit-log.test.ts', 'packages/db/test/log.test.ts', 'scripts/test/setup-treasury.test.ts'];
  const sources = paths.map(path => readFileSync(join(REPO_ROOT, path), 'utf8'));
  const values = ['0'.repeat(64), sources[1]!.match(/const KNOWN_ANSWER_HASH\s*=\s*"([a-f0-9]+)"/)![1]!,
    sources[2]!.match(/"(A1B2C3D4E5F6[A-F0-9]{52})"/)![1]!];
  for (let i = 0; i < paths.length; i++) {
    const finding = { path: paths[i]!, secret: values[i]!, line: '"' + values[i] + '"' };
    expect(allowed(bare, finding)).toBe(true);
    expect(allowed(bare, { ...finding, path: 'services/backend/src/signing.ts' })).toBe(false);
    expect(allowed(bare, { ...finding, secret: 'c'.repeat(64), line: '"' + 'c'.repeat(64) + '"' })).toBe(false);
  }
});
