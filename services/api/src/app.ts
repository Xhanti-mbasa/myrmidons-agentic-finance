import { createHash, randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  ApprovalRequest,
  ApprovalResponse,
  fromCents,
  LogEntry,
  LogFilter,
  PayRequest,
  PayResult,
  RuleCode,
  ruleExplanation,
  Rules,
  SupplierLookup,
  supplierNameConfidence,
  toCents,
} from "@shucamoxa/shared";
import {
  createLogRepo,
  createPaymentsRepo,
  createReservationsRepo,
  createRulesReadRepo,
} from "@shucamoxa/db";
import { createAuthMiddleware } from "./auth";
import type { ApiDeps } from "./types";

const MAX_BODY_BYTES = 64 * 1024; // 64 KB
const MAX_LOG_PAGE_SIZE = 50;
const AMBIGUOUS_CONFIDENCE_CAP = 0.5;

export function createApp(deps: ApiDeps) {
  const app = new Hono();

  const rulesRepo = createRulesReadRepo(deps.db);
  const reservationsRepo = createReservationsRepo(deps.db);
  const paymentsRepo = createPaymentsRepo(deps.db);
  const logRepo = createLogRepo(deps.db);

  // Security headers & cache control
  app.use("*", async (c, next) => {
    await next();
    c.res.headers.set("Cache-Control", "no-store");
  });

  // Body size limit
  app.use(
    "*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) =>
        c.json(
          { error: "payload_too_large", message: "Request body exceeds 64 KB" },
          413
        ),
    })
  );

  // Health check - open
  app.get("/health", (c) => c.json({ ok: true, status: "healthy" }));

  // Auth middleware for all agent-facing endpoints
  const authMiddleware = createAuthMiddleware(deps.config.agentToken);

  // GET /rules
  app.get("/rules", authMiddleware, (c) => {
    const rules = rulesRepo.getRules();
    if (!rules) {
      return c.json(
        { error: "not_found", message: "Rules not configured in database." },
        404
      );
    }

    // Rules schema from @shucamoxa/shared is a strict object.
    // It verifies perPaymentCap, totalBudget, spent, reserved, remaining, periodStart,
    // killSwitch, and suppliers: [{ id, name }]. Zero leak of supplier or treasury addresses!
    const validated = Rules.parse(rules);
    return c.json(validated);
  });

  // GET /suppliers?q=
  app.get("/suppliers", authMiddleware, (c) => {
    const q = c.req.query("q");
    if (!q || !q.trim()) {
      return c.json(
        {
          error: "invalid_query",
          message: "Query parameter 'q' must not be empty.",
        },
        400
      );
    }

    const trimmed = q.trim();
    const approved = rulesRepo.getApprovedSuppliers();
    if (approved.length === 0) {
      return c.json(SupplierLookup.parse({ notFound: true }));
    }

    // Score approved suppliers by exact ID, exact name, substring, or token overlap
    const scored = approved
      .map((s) => {
        let score = 0;
        const idLower = s.id.toLowerCase();
        const nameLower = s.name.toLowerCase();
        const queryLower = trimmed.toLowerCase();

        if (idLower === queryLower || nameLower === queryLower) {
          score = 1.0;
        } else if (idLower.includes(queryLower)) {
          score = 0.95;
        } else if (nameLower.includes(queryLower)) {
          score = Math.max(0.85, supplierNameConfidence(trimmed, s.name));
        } else {
          score = supplierNameConfidence(trimmed, s.name);
        }

        return { s, score };
      })
      .sort((a, b) => b.score - a.score);

    const [best, second] = scored;
    if (!best || best.score <= 0) {
      return c.json(SupplierLookup.parse({ notFound: true }));
    }

    const confidence =
      second && second.score === best.score
        ? Math.min(best.score, AMBIGUOUS_CONFIDENCE_CAP)
        : Number(best.score.toFixed(4));

    const result = SupplierLookup.parse({
      supplierId: best.s.id,
      name: best.s.name,
      confidence,
    });

    return c.json(result);
  });

  // POST /payments
  app.post("/payments", authMiddleware, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: "invalid_json", message: "Request body is not valid JSON." },
        400
      );
    }

    const parsed = PayRequest.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: "invalid_request",
          message: "Request body does not match PayRequest schema.",
          details: parsed.error.issues,
        },
        400
      );
    }

    const request = parsed.data;

    // Idempotency: check if already recorded
    const existingPayment = paymentsRepo.getPaymentByInvoice(request.invoiceNumber);
    if (existingPayment) {
      if (existingPayment.status === "settled" && existingPayment.tx_hash) {
        return c.json(
          PayResult.parse({
            status: "settled",
            ruleCode: "OK",
            txHash: existingPayment.tx_hash,
            logId: existingPayment.log_id,
          })
        );
      }
      if (existingPayment.status === "blocked") {
        return c.json(
          PayResult.parse({
            status: "blocked",
            ruleCode: existingPayment.rule_code as any,
            logId: existingPayment.log_id,
          })
        );
      }
    }

    // Active reservation check
    const existingRes = reservationsRepo.getActiveReservation(request.invoiceNumber);
    if (existingRes && existingRes.status === "reserved") {
      // Conflict if already active
      const logEntry = logRepo.appendLog({
        actor: "policy",
        event: "policy_blocked",
        invoiceNumber: request.invoiceNumber,
        ruleCode: "DUPLICATE_INVOICE",
        explanation: `${ruleExplanation("DUPLICATE_INVOICE")} Invoice ${request.invoiceNumber} is already reserved.`.slice(
          0,
          500
        ),
      });
      paymentsRepo.recordPayment({
        invoiceNumber: request.invoiceNumber,
        status: "blocked",
        ruleCode: "DUPLICATE_INVOICE",
        logId: String(logEntry.seq),
      });
      return c.json(
        PayResult.parse({
          status: "blocked",
          ruleCode: "DUPLICATE_INVOICE",
          logId: String(logEntry.seq),
        })
      );
    }

    // Check rules & policy
    const rules = rulesRepo.getRules();
    if (!rules) {
      return c.json(
        { error: "internal_error", message: "Rules unavailable." },
        500
      );
    }

    let blockCode: RuleCode | null = null;
    if (rules.killSwitch) {
      blockCode = "KILL_SWITCH_ON";
    } else {
      const supplier = rulesRepo.getSupplierById(request.supplierId);
      if (!supplier || supplier.status !== "approved") {
        blockCode = "SUPPLIER_NOT_APPROVED";
      } else {
        const amountCents = toCents(request.amount);
        if (amountCents > toCents(rules.perPaymentCap)) {
          blockCode = "OVER_PER_PAYMENT_CAP";
        } else if (
          toCents(rules.spent) + toCents(rules.reserved) + amountCents >
          toCents(rules.totalBudget)
        ) {
          blockCode = "OVER_BUDGET";
        }
      }
    }

    // If policy blocks
    if (blockCode !== null) {
      const explanation = `${ruleExplanation(blockCode)} Reason: ${request.reason}`.slice(
        0,
        500
      );
      const logEntry = logRepo.appendLog({
        actor: "policy",
        event: "policy_blocked",
        invoiceNumber: request.invoiceNumber,
        ruleCode: blockCode,
        explanation,
      });

      paymentsRepo.recordPayment({
        invoiceNumber: request.invoiceNumber,
        status: "blocked",
        ruleCode: blockCode,
        logId: String(logEntry.seq),
      });

      return c.json(
        PayResult.parse({
          status: "blocked",
          ruleCode: blockCode as any,
          logId: String(logEntry.seq),
        })
      );
    }

    // Policy allowed: create reservation in SQLite
    const amountCents = toCents(request.amount);
    const reservation = reservationsRepo.createReservation({
      invoiceNumber: request.invoiceNumber,
      supplierId: request.supplierId,
      amountCents: Number(amountCents),
      status: "reserved",
    });

    const reqLog = logRepo.appendLog({
      actor: "agent",
      event: "payment_requested",
      invoiceNumber: request.invoiceNumber,
      ruleCode: "OK",
      explanation: `Payment intent requested for ${request.invoiceNumber} to ${request.supplierId}. Reason: ${request.reason}`.slice(
        0,
        500
      ),
    });

    // Relay or persist payment intent
    if (deps.paymentRelayer) {
      try {
        const relayerResult = await deps.paymentRelayer.relay(
          request,
          reservation.id
        );

        if (relayerResult.status === "settled") {
          reservationsRepo.settleReservation(
            request.invoiceNumber,
            relayerResult.txHash
          );
          const settleLog = logRepo.appendLog({
            actor: "payment",
            event: "payment_settled",
            invoiceNumber: request.invoiceNumber,
            ruleCode: "OK",
            txHash: relayerResult.txHash,
            ledgerResult: "tesSUCCESS",
            explanation: `Payment settled on-ledger for ${request.invoiceNumber}`.slice(
              0,
              500
            ),
          });
          paymentsRepo.recordPayment({
            invoiceNumber: request.invoiceNumber,
            status: "settled",
            ruleCode: "OK",
            txHash: relayerResult.txHash,
            logId: String(settleLog.seq),
          });

          return c.json(
            PayResult.parse({
              status: "settled",
              ruleCode: "OK",
              txHash: relayerResult.txHash,
              logId: String(settleLog.seq),
            })
          );
        } else {
          // Relayer returned blocked/failed
          reservationsRepo.releaseReservation(request.invoiceNumber);
          const failLog = logRepo.appendLog({
            actor: "payment",
            event: "payment_failed",
            invoiceNumber: request.invoiceNumber,
            ruleCode: relayerResult.ruleCode,
            explanation: (
              relayerResult.reason ||
              `Payment failed: ${relayerResult.ruleCode}`
            ).slice(0, 500),
          });
          paymentsRepo.recordPayment({
            invoiceNumber: request.invoiceNumber,
            status: "failed",
            ruleCode: relayerResult.ruleCode,
            logId: String(failLog.seq),
          });

          return c.json(
            PayResult.parse({
              status: "blocked",
              ruleCode: relayerResult.ruleCode,
              logId: String(failLog.seq),
            })
          );
        }
      } catch (err) {
        // Relayer threw: payment outcome unknown / 503
        return c.json(
          {
            error: "service_unavailable",
            message:
              "Payment relay failed or timed out. Do not retry automatically; verify ledger outcome.",
          },
          503
        );
      }
    }

    // Default standalone persistence: settle and record payment
    const simulatedTxHash = createHash("sha256")
      .update(`${request.invoiceNumber}:${reqLog.hash}:${Date.now()}`)
      .digest("hex");

    reservationsRepo.settleReservation(request.invoiceNumber, simulatedTxHash);

    const settleLog = logRepo.appendLog({
      actor: "payment",
      event: "payment_settled",
      invoiceNumber: request.invoiceNumber,
      ruleCode: "OK",
      txHash: simulatedTxHash,
      ledgerResult: "tesSUCCESS",
      explanation: `Payment intent settled for invoice ${request.invoiceNumber}`.slice(
        0,
        500
      ),
    });

    paymentsRepo.recordPayment({
      invoiceNumber: request.invoiceNumber,
      status: "settled",
      ruleCode: "OK",
      txHash: simulatedTxHash,
      logId: String(settleLog.seq),
    });

    return c.json(
      PayResult.parse({
        status: "settled",
        ruleCode: "OK",
        txHash: simulatedTxHash,
        logId: String(settleLog.seq),
      })
    );
  });

  // GET /log
  app.get("/log", authMiddleware, (c) => {
    const rawQuery = c.req.query();
    const filterResult = LogFilter.safeParse(rawQuery);
    if (!filterResult.success) {
      return c.json(
        {
          error: "invalid_query",
          message: "Query parameters do not match LogFilter.",
          details: filterResult.error.issues,
        },
        400
      );
    }

    const filter = filterResult.data;

    // Join audit_log with reservations to get supplierId and amount where available
    const rows = deps.db
      .prepare(
        `
        SELECT
          a.seq,
          a.ts,
          a.actor,
          a.event,
          a.invoice_number,
          a.rule_code,
          a.explanation,
          a.tx_hash,
          a.ledger_result,
          a.prev_hash,
          a.hash,
          r.supplier_id,
          r.amount_cents
        FROM audit_log a
        LEFT JOIN (
          SELECT invoice_number, supplier_id, amount_cents, MAX(id)
          FROM reservations
          GROUP BY invoice_number
        ) r ON a.invoice_number = r.invoice_number
        ORDER BY a.seq ASC
      `
      )
      .all() as Array<{
      seq: number;
      ts: string;
      actor: string;
      event: string;
      invoice_number: string | null;
      rule_code: string | null;
      explanation: string;
      tx_hash: string | null;
      ledger_result: string | null;
      prev_hash: string;
      hash: string;
      supplier_id: string | null;
      amount_cents: number | null;
    }>;

    const fromTs = filter.from ? Date.parse(filter.from) : -Infinity;
    const toTs = filter.to
      ? filter.to.length === 10
        ? Date.parse(filter.to) + 86_400_000 - 1
        : Date.parse(filter.to)
      : Infinity;

    const targetEvent =
      filter.status === "settled"
        ? "payment_settled"
        : filter.status === "blocked"
        ? "policy_blocked"
        : filter.status === "pending_approval"
        ? "approval_requested"
        : undefined;

    const mapped = rows
      .map((row) => {
        const candidate: unknown = {
          seq: row.seq,
          ts: row.ts,
          actor: row.actor,
          event: row.event,
          invoiceNumber: row.invoice_number,
          supplierId: row.supplier_id,
          amount:
            row.amount_cents !== null && row.amount_cents !== undefined
              ? fromCents(BigInt(row.amount_cents))
              : null,
          ruleCode: row.rule_code,
          explanation: row.explanation.slice(0, 500),
          txHash: row.tx_hash,
          ledgerResult: row.ledger_result,
          prevHash: row.prev_hash,
          hash: row.hash,
        };
        return LogEntry.parse(candidate);
      })
      .filter((e) => {
        if (filter.supplierId && e.supplierId !== filter.supplierId) {
          return false;
        }
        if (targetEvent && e.event !== targetEvent) {
          return false;
        }
        const ts = Date.parse(e.ts);
        if (ts < fromTs || ts > toTs) {
          return false;
        }
        return true;
      });

    // Newest first, max 50 entries
    const page = mapped.reverse().slice(0, MAX_LOG_PAGE_SIZE);

    return c.json(page);
  });

  // POST /approvals (agent approval requests)
  app.post("/approvals", authMiddleware, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: "invalid_json", message: "Request body is not valid JSON." },
        400
      );
    }

    const parsed = ApprovalRequest.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: "invalid_request",
          message: "Request body does not match ApprovalRequest schema.",
        },
        400
      );
    }

    const request = parsed.data;
    const approvalId = `appr_${randomUUID().replace(/-/g, "")}`;
    const invoiceNumber = request.payload.invoiceNumber;

    deps.db
      .prepare(
        `
      INSERT INTO approvals (id, kind, payload, status, invoice_number)
      VALUES (?, ?, ?, 'pending', ?)
    `
      )
      .run(approvalId, request.kind, JSON.stringify(request.payload), invoiceNumber);

    logRepo.appendLog({
      actor: "agent",
      event: "approval_requested",
      invoiceNumber,
      ruleCode: null,
      explanation:
        request.kind === "payment"
          ? `Agent requested owner approval for payment on invoice ${invoiceNumber}`
          : `Agent requested owner approval for new supplier`,
    });

    const response = ApprovalResponse.parse({
      approvalId,
      status: "pending",
    });

    return c.json(response, 201);
  });

  app.notFound((c) =>
    c.json({ error: "not_found", message: "Endpoint not found." }, 404)
  );

  return app;
}
