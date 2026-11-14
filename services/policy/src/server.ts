import { createHash, timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  CosignRequest,
  CosignResponse,
  type RuleCode,
  ruleExplanation,
  type Rules,
} from "@shucamoxa/shared";
import { Wallet } from "xrpl";
import { DEFAULT_POLICY_CHECKS, type PolicyCheck, type PolicyCheckContext } from "./checks";
import { loadPolicyConfig, type PolicyServerConfig } from "./config";
import { readRules, type ReadableRules, type RulesReaderLike } from "./rules-reader";
import { decodeAndVerifyAgentSignedBlob } from "./verify";

export const MAX_POLICY_REQUEST_BYTES = 64 * 1024; // 64 KB

export type PolicyLogEntry =
  | { event: "cosign_evaluated"; decision: "allow" | "block"; ruleCode: RuleCode; durationMs: number }
  | { event: "cosign_failed"; durationMs: number }
  | { event: "request_refused"; status: number };

export type PolicyLogger = (entry: PolicyLogEntry) => void;

export type PolicyServerDeps = {
  env: Record<string, string | undefined>;
  rulesReader?: RulesReaderLike;
  checks?: readonly PolicyCheck[];
  logger?: PolicyLogger;
};

const digest = (value: string) => createHash("sha256").update(value).digest();

const DEFAULT_RULES: Rules = {
  perPaymentCap: "100.00",
  totalBudget: "10000.00",
  spent: "0.00",
  reserved: "0.00",
  remaining: "10000.00",
  periodStart: "2026-11-01",
  killSwitch: false,
  suppliers: [],
};

export function createPolicyServer(deps: PolicyServerDeps) {
  const config: PolicyServerConfig = loadPolicyConfig(deps.env);
  const policyWallet = Wallet.fromSeed(config.policySeed);

  const log = deps.logger ?? ((entry: PolicyLogEntry) => console.log(JSON.stringify(entry)));
  const checks = deps.checks ?? DEFAULT_POLICY_CHECKS;
  const expectedTokenDigest = digest(config.callerToken);

  const since = (started: number) => Math.round(performance.now() - started);

  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    c.res.headers.set("Cache-Control", "no-store");
  });

  app.get("/health", (c) => c.json({ ok: true }));

  app.use("*", async (c, next) => {
    const token = /^Bearer (\S+)$/.exec(c.req.header("Authorization") ?? "")?.[1];
    const matches = token !== undefined && timingSafeEqual(digest(token), expectedTokenDigest);
    if (!matches) {
      log({ event: "request_refused", status: 401 });
      return c.json({ error: "unauthorized", message: "A valid bearer token is required." }, 401);
    }
    await next();
  });

  app.use(
    "*",
    bodyLimit({
      maxSize: MAX_POLICY_REQUEST_BYTES,
      onError: (c) => {
        log({ event: "request_refused", status: 413 });
        return c.json({ error: "payload_too_large", message: "The request body is over 64 KB." }, 413);
      },
    })
  );

  app.post("/cosign", async (c) => {
    const started = performance.now();
    try {
      let bodyText: string;
      try {
        bodyText = await c.req.text();
      } catch {
        log({ event: "request_refused", status: 400 });
        return c.json({ error: "invalid_body", message: "Could not read request body." }, 400);
      }

      let json: unknown;
      try {
        json = JSON.parse(bodyText);
      } catch {
        log({ event: "request_refused", status: 400 });
        return c.json({ error: "invalid_json", message: "The request body is not valid JSON." }, 400);
      }

      const parsedRequest = CosignRequest.safeParse(json);
      if (!parsedRequest.success) {
        log({ event: "request_refused", status: 400 });
        return c.json(
          { error: "invalid_request", message: "The request body does not match CosignRequest." },
          400
        );
      }

      const cosignRequest = parsedRequest.data;

      // 1. Decode and verify agentSignedBlob & match against txJson
      const verifyResult = decodeAndVerifyAgentSignedBlob(
        cosignRequest.agentSignedBlob,
        cosignRequest.txJson,
        config.agentAccount
      );

      if (!verifyResult.ok) {
        const response = CosignResponse.parse({
          decision: "block",
          ruleCode: verifyResult.ruleCode,
          reason: verifyResult.reason,
        });
        log({
          event: "cosign_evaluated",
          decision: "block",
          ruleCode: verifyResult.ruleCode,
          durationMs: since(started),
        });
        return c.json(response);
      }

      // 2. Read rules
      let rules: ReadableRules;
      try {
        rules = deps.rulesReader ? await readRules(deps.rulesReader) : DEFAULT_RULES;
      } catch {
        const response = CosignResponse.parse({
          decision: "block",
          ruleCode: "FORBIDDEN_TX_FIELDS",
          reason: "policy check failed",
        });
        log({
          event: "cosign_evaluated",
          decision: "block",
          ruleCode: "FORBIDDEN_TX_FIELDS",
          durationMs: since(started),
        });
        return c.json(response);
      }

      // 3. Run check pipeline on decoded transaction
      const ctx: PolicyCheckContext = {
        decodedTx: verifyResult.decodedTx,
        request: cosignRequest,
        rules,
        treasuryAccount: config.treasuryAccount,
        agentAccount: config.agentAccount,
      };

      for (const check of checks) {
        const code = check(ctx);
        if (code !== null) {
          const response = CosignResponse.parse({
            decision: "block",
            ruleCode: code,
            reason: ruleExplanation(code),
          });
          log({
            event: "cosign_evaluated",
            decision: "block",
            ruleCode: code,
            durationMs: since(started),
          });
          return c.json(response);
        }
      }

      // 4. All checks passed: sign the decoded transaction
      const signed = policyWallet.sign(verifyResult.txToSign as any, true);
      const response = CosignResponse.parse({
        decision: "allow",
        ruleCode: "OK",
        reason: ruleExplanation("OK"),
        policySignedBlob: signed.tx_blob,
      });

      log({
        event: "cosign_evaluated",
        decision: "allow",
        ruleCode: "OK",
        durationMs: since(started),
      });

      return c.json(response);
    } catch {
      log({ event: "cosign_failed", durationMs: since(started) });
      return c.json(
        CosignResponse.parse({
          decision: "block",
          ruleCode: "FORBIDDEN_TX_FIELDS",
          reason: "policy check failed",
        })
      );
    }
  });

  app.notFound((c) => c.json({ error: "not_found", message: "No such route." }, 404));

  app.onError((_err, c) => {
    return c.json(
      CosignResponse.parse({
        decision: "block",
        ruleCode: "FORBIDDEN_TX_FIELDS",
        reason: "policy check failed",
      })
    );
  });

  return { app, host: config.host, port: config.port, wallet: policyWallet };
}
