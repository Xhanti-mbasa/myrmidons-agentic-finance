import { z } from "zod";
import { Rules } from "@shucamoxa/shared";
import type { PolicyRules } from "./checks";
import type { RulesReader } from "./rules-reader";

/** The backend's GET /policy/rules body: the agent's rules plus each approved supplier's address. */
const PolicyRulesBody = Rules.omit({ suppliers: true }).extend({
  suppliers: z.array(z.strictObject({ id: z.string(), name: z.string(), address: z.string(), status: z.literal("approved") })),
});

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Reads the owner's live rules on every cosign, so a kill switch or a lowered cap applies to the very
 * next payment. Any failure (network, status, shape) throws, and the policy server then refuses to sign.
 */
export class HttpRulesReader implements RulesReader {
  private readonly url: URL;

  constructor(rawUrl: string, private readonly token: string, private readonly timeoutMs = 5000) {
    const url = new URL(rawUrl);
    if (url.username || url.password || url.search || url.hash) throw new Error("RULES_URL must not carry credentials, a query or a fragment");
    if (!(url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname)))) {
      throw new Error("RULES_URL must be https, or http on this machine");
    }
    if (token.length < 32) throw new Error("RULES_TOKEN must be at least 32 characters");
    this.url = url;
  }

  async getRules(): Promise<PolicyRules> {
    const response = await fetch(this.url, {
      headers: { Authorization: `Bearer ${this.token}` },
      redirect: "error",
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`rules unavailable: HTTP ${response.status}`);
    return PolicyRulesBody.parse(await response.json());
  }
}

/** Builds the reader from RULES_URL and RULES_TOKEN; the policy service will not start without them. */
export function rulesReaderFromEnv(env: Record<string, string | undefined>): HttpRulesReader {
  const url = env.RULES_URL?.trim();
  const token = env.RULES_TOKEN?.trim();
  if (!url || !token) {
    throw new Error("RULES_URL and RULES_TOKEN are required: without the owner's live rules the policy service would refuse every payment");
  }
  return new HttpRulesReader(url, token);
}
