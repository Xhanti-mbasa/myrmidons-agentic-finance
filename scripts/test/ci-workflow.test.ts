import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./support/git-sandbox";

// Text checks on the workflow, so a later edit can't quietly unpin an action or widen
// the token. GitHub itself validates the YAML on every run.
const CI = readFileSync(join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");
const job = (name: string) => {
  const m = CI.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [\\w-]+:\\n|(?![\\s\\S]))`, "m"));
  if (!m) throw new Error(`no job ${name}`);
  return m[1]!;
};

describe("CI workflow", () => {
  it("runs on pull requests and pushes to main and the security repair branch", () => {
    expect(CI).toMatch(/^on:\n  pull_request:\n  push:\n    branches: \[main, fix\/submission-security\]$/m);
  });

  it("gives the token read-only access to contents and nothing else", () => {
    expect(CI).toMatch(/^permissions:\n  contents: read\n(?!  )/m);
    expect(CI).not.toMatch(/:\s*write\b/);
  });

  it("pins every action to a full commit SHA with the version in a comment", () => {
    const uses = [...CI.matchAll(/uses:\s*(\S+)(.*)$/gm)];
    expect(uses.length).toBeGreaterThan(0);
    for (const [, ref, rest] of uses) {
      expect(ref).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
      expect(rest).toMatch(/^ # v\d+\.\d+\.\d+$/);
    }
  });

  it("does not use gitleaks-action, which needs a licence for organisations", () => {
    expect(CI).not.toMatch(/gitleaks\/gitleaks-action/);
  });

  it("test job: refuses local-only files, then installs from the lockfile, typechecks and tests", () => {
    const steps = job("test");
    const order = ["scripts/check-tracked-paths.sh", "pnpm install --frozen-lockfile", "pnpm typecheck", "pnpm test"];
    const at = order.map((s) => steps.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(steps).toMatch(/node-version-file: \.nvmrc/);
    expect(steps).toMatch(/cache: pnpm/);
  });

  it("secrets job: scans the full history with a checksum-verified gitleaks binary", () => {
    const steps = job("secrets");
    expect(steps).toMatch(/fetch-depth: 0/);
    expect(steps).toMatch(/GITLEAKS_SHA256: [0-9a-f]{64}$/m);
    expect(steps).toMatch(/sha256sum --check --strict/);
    expect(steps).toMatch(/gitleaks" git .*--config \.gitleaks\.toml --redact --no-banner/);
  });

  it("cancels superseded runs only on pull requests, never on main", () => {
    expect(CI).toMatch(/^  cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}$/m);
  });

  it("secrets job: scans the history of the commit under test, not every teammate branch", () => {
    expect(job("secrets")).toMatch(/gitleaks" git --log-opts="--full-history HEAD" /);
  });

  it("secrets job: the self-test fails unless gitleaks exits 3 (leak found)", () => {
    expect(job("secrets")).toMatch(/--exit-code 3[\s\S]*?code=\$\?[\s\S]*?if \[ "\$code" -ne 3 \]; then\n[^\n]*::error::[^\n]*\n\s*exit 1\n\s*fi/);
  });

  it("secrets job: proves the config catches a fake seed before trusting a clean scan", () => {
    const steps = job("secrets");
    expect(steps.indexOf("stdin")).toBeGreaterThan(-1);
    expect(steps.indexOf("stdin")).toBeLessThan(steps.indexOf('gitleaks" git '));
  });

  it("never leaves the checkout's credentials on disk", () => {
    const checkouts = CI.match(/uses: actions\/checkout@/g) ?? [];
    const persisted = CI.match(/persist-credentials: false/g) ?? [];
    expect(checkouts.length).toBe(2);
    expect(persisted.length).toBe(checkouts.length);
  });
});
