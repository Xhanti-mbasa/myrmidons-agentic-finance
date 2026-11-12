import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gitSandbox, REPO_ROOT } from "./support/git-sandbox";

const SCRIPT = join(REPO_ROOT, "scripts", "check-tracked-paths.sh");

let sandbox: ReturnType<typeof gitSandbox> | undefined;
afterEach(() => sandbox?.cleanup());

function checkWith(...paths: string[]) {
  sandbox = gitSandbox();
  sandbox.track("README.md", ...paths);
  return sandbox.run(SCRIPT);
}

describe("check-tracked-paths refuses env files and local-only paths", () => {
  it.each([
    [".env at the root", ".env"],
    ["a service .env", "services/agent/.env"],
    ["a .env.local", ".env.local"],
    ["a service .env.fallback", "services/agent/.env.fallback"],
    ["an .env.example with a suffix", "services/agent/.env.example.bak"],
    ["CLAUDE.md", "CLAUDE.md"],
    ["a nested CLAUDE.md", "services/agent/CLAUDE.md"],
    ["CLAUDE.local.md", "CLAUDE.local.md"],
    ["CONTEXT.md", "CONTEXT.md"],
    ["a file under .scratch/", ".scratch/payguard/spec.md"],
    ["a nested .scratch/", "services/agent/.scratch/notes.md"],
    ["a file under docs/agents/", "docs/agents/issue-tracker.md"],
    ["a file under docs/adr/", "docs/adr/0001-sqlite.md"],
    ["an .env.example inside .scratch/", ".scratch/x/.env.example"],
    ["an .env.example inside docs/agents/", "docs/agents/.env.example"],
  ])("fails when %s is tracked", (_label, path) => {
    const r = checkWith(path);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(path);
  });

  it("lists every offending path, not just the first", () => {
    const r = checkWith(".env", "CLAUDE.md", "docs/agents/x.md");
    expect(r.code).toBe(1);
    for (const p of [".env", "CLAUDE.md", "docs/agents/x.md"]) expect(r.stderr).toContain(p);
  });
});

describe("check-tracked-paths accepts the repo's legitimate files", () => {
  it.each([
    ["the root .env.example", ".env.example"],
    ["a service .env.example", "services/agent/.env.example"],
    ["a doc whose name starts with agent", "docs/agent-api.md"],
    ["a docs/agents.md file", "docs/agents.md"],
    ["a doc under a similarly named folder", "docs/agents-guide/setup.md"],
    ["an ADR-like name outside docs/adr/", "docs/adr.md"],
    ["source that mentions env in its name", "services/agent/src/env.ts"],
    ["a file named like an env var", "fixtures/my.env.json"],
    ["a scratch-like name that is not the folder", "scripts/scratch.ts"],
    ["a markdown file that merely contains CLAUDE", "docs/CLAUDE-notes.md"],
  ])("passes with %s", (_label, path) => {
    const r = checkWith(path);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
  });

  it("passes on this repository as it stands", () => {
    const result = spawnSync("sh", [SCRIPT], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
