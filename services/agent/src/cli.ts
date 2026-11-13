import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import * as readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ProcessInvoiceResponse, type AgentInvoiceId } from "@shucamoxa/shared";

export const DEFAULT_AGENT_URL = "http://127.0.0.1:8790";

export type CliArgs =
  | { mode: "demo" }
  | { mode: "file"; filePath: string }
  | { mode: "error"; message: string };

/**
 * Parses command line arguments.
 * Strictly enforces that AGENT_INBOUND_TOKEN must never be passed as a flag.
 */
export function parseCliArgs(argv: string[]): CliArgs {
  if (argv.some((arg) => arg === "--token" || arg.startsWith("--token="))) {
    return { mode: "error", message: "Token flag is not allowed. Set AGENT_INBOUND_TOKEN in the environment instead." };
  }

  if (argv.includes("--demo")) {
    return { mode: "demo" };
  }

  const fileArgs = argv.filter((arg) => !arg.startsWith("-"));
  if (fileArgs.length === 0) {
    return { mode: "error", message: "Usage: pnpm agent:invoice <file.pdf|file.txt> or pnpm agent:invoice --demo" };
  }

  if (fileArgs.length > 1) {
    return { mode: "error", message: "Only one invoice file may be specified at a time." };
  }

  const filePath = fileArgs[0]!;
  if (!filePath.endsWith(".pdf") && !filePath.endsWith(".txt")) {
    return { mode: "error", message: "Invoice file must be a .pdf or .txt file." };
  }

  return { mode: "file", filePath };
}

/** Formats a one-screen summary from an invoice response. */
export function formatInvoiceSummary(response: ProcessInvoiceResponse): string {
  const { outcome } = response;
  const lines: string[] = [
    "============================================================",
    `  INVOICE SUMMARY: ${outcome.invoiceNumber ?? "(none)"}`,
    "============================================================",
    `Decision:     ${outcome.decision.toUpperCase()}`,
    `Rule Code:    ${outcome.ruleCode ?? "none"}`,
  ];

  if (outcome.txHash) {
    lines.push(`Tx Hash:      ${outcome.txHash}`);
    lines.push(`Explorer:     https://testnet.xrpl.org/transactions/${outcome.txHash}`);
  }

  lines.push(`Flags:        ${outcome.flags.length > 0 ? outcome.flags.join(", ") : "none"}`);
  lines.push(`Explanation:  ${outcome.explanation}`);

  if (outcome.suspiciousText.length > 0) {
    lines.push(`Suspicious:   ${outcome.suspiciousText.length} passage(s) flagged`);
  }
  lines.push("============================================================");
  return lines.join("\n");
}

/** Derives a valid AgentInvoiceId from a file path. */
export function deriveInvoiceId(filePath: string): AgentInvoiceId {
  const base = basename(filePath).replace(/\.[^.]+$/, "");
  const sanitized = base.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
  return (sanitized.length > 0 ? sanitized : "inv_1") as AgentInvoiceId;
}

/** Reads a file from disk and returns the ProcessInvoiceRequest payload. */
export function prepareInvoicePayload(filePath: string): { invoiceId: string; text?: string; pdfBase64?: string } {
  const invoiceId = deriveInvoiceId(filePath);
  if (filePath.endsWith(".pdf")) {
    const bytes = readFileSync(filePath);
    return { invoiceId, pdfBase64: bytes.toString("base64") };
  }
  const text = readFileSync(filePath, "utf8");
  return { invoiceId, text };
}

/** Sends an invoice request to the agent HTTP service. */
export async function postInvoice(
  payload: { invoiceId: string; text?: string; pdfBase64?: string },
  options: { agentUrl: string; token: string; fetch?: typeof fetch },
): Promise<ProcessInvoiceResponse> {
  const customFetch = options.fetch ?? fetch;
  const url = `${options.agentUrl.replace(/\/+$/, "")}/agent/invoices`;
  const res = await customFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Agent request failed (HTTP ${res.status}): ${errorText}`);
  }

  const json = await res.json();
  return ProcessInvoiceResponse.parse(json);
}

/** Finds demo invoice fixtures (01 to 06) in fixtures/invoices. */
export function listDemoInvoices(invoicesDir: string): string[] {
  const prefixes = ["01", "02", "03", "04", "05", "06"];
  const pdfDir = join(invoicesDir, "pdf");
  const result: string[] = [];

  for (const prefix of prefixes) {
    let found = false;
    if (existsSync(pdfDir)) {
      const pdfFiles = readdirSync(pdfDir).filter((f) => f.startsWith(`${prefix}-`) && f.endsWith(".pdf"));
      if (pdfFiles.length > 0) {
        result.push(join(pdfDir, pdfFiles[0]!));
        found = true;
      }
    }
    if (!found && existsSync(invoicesDir)) {
      const txtFiles = readdirSync(invoicesDir).filter((f) => f.startsWith(`${prefix}-`) && f.endsWith(".txt"));
      if (txtFiles.length > 0) {
        result.push(join(invoicesDir, txtFiles[0]!));
      }
    }
  }

  return result;
}

/** Pauses for user to press Enter. */
export async function waitForEnter(stdin = process.stdin, stdout = process.stdout): Promise<void> {
  if (stdin.isTTY === false) return;
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    rl.question("\nPress Enter to continue to the next invoice...", () => {
      rl.close();
      resolve();
    });
  });
}

export type RunCliDeps = {
  argv: string[];
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  stdin?: NodeJS.ReadableStream;
  stdout?: (msg: string) => void;
  stderr?: (msg: string) => void;
  pause?: () => Promise<void>;
};

/** Executes the CLI command. */
export async function runCli(deps: RunCliDeps): Promise<number> {
  const log = deps.stdout ?? ((msg: string) => console.log(msg));
  const errLog = deps.stderr ?? ((msg: string) => console.error(msg));

  const parsed = parseCliArgs(deps.argv);
  if (parsed.mode === "error") {
    errLog(`Error: ${parsed.message}`);
    return 1;
  }

  const token = deps.env.AGENT_INBOUND_TOKEN?.trim();
  if (!token) {
    errLog("Error: AGENT_INBOUND_TOKEN environment variable is required.");
    return 1;
  }

  const agentUrl = deps.env.AGENT_URL?.trim() || DEFAULT_AGENT_URL;
  const pause = deps.pause ?? (() => waitForEnter());

  if (parsed.mode === "file") {
    if (!existsSync(parsed.filePath)) {
      errLog(`Error: File not found: ${parsed.filePath}`);
      return 1;
    }
    try {
      const payload = prepareInvoicePayload(parsed.filePath);
      log(`Submitting ${parsed.filePath} to ${agentUrl}...`);
      const response = await postInvoice(payload, { agentUrl, token, fetch: deps.fetch });
      log(formatInvoiceSummary(response));
      return 0;
    } catch (err) {
      errLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  // Demo mode: fixtures/invoices/01-06
  const currentDir = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
  const baseDir = resolve(currentDir, "../../../fixtures/invoices");
  const demoFiles = listDemoInvoices(baseDir);
  if (demoFiles.length === 0) {
    errLog(`Error: No demo invoice fixtures found in ${baseDir}`);
    return 1;
  }

  log(`Running demo across ${demoFiles.length} fixtures in ${baseDir}...`);
  for (let i = 0; i < demoFiles.length; i++) {
    const file = demoFiles[i]!;
    log(`\n[${i + 1}/${demoFiles.length}] Processing: ${basename(file)}`);
    try {
      const payload = prepareInvoicePayload(file);
      const response = await postInvoice(payload, { agentUrl, token, fetch: deps.fetch });
      log(formatInvoiceSummary(response));
    } catch (err) {
      errLog(`Failed to process ${basename(file)}: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (i < demoFiles.length - 1) {
      await pause();
    }
  }

  return 0;
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  runCli({ argv: process.argv.slice(2), env: process.env }).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
