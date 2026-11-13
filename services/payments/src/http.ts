import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { TransferId, EmptyTransferBody, UnlockTransferAuthority, isTransferValidationError } from "../../../packages/shared/src/index";
import { PaymentError, PaymentService, type Principal } from "./payment";

/** Embed behind a private listener/TLS proxy. Never accept role/owner/subject from model-supplied JSON. */
export function createTransferServer(service: PaymentService, credentials: ReadonlyMap<string, Principal>) {
  if (credentials.size === 0 || [...credentials.keys()].some(token => Buffer.byteLength(token) < 32))
    throw new Error("Supply private, independently generated credentials of at least 32 bytes");
  const tokens = [...credentials].map(([token, principal]) => [Buffer.from(token), Object.freeze({ ...principal })] as const);
  return createServer((request, response) => { void handle(request, response); });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    };
    const auth = req.headers.authorization;
    const presented = Buffer.from(typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : "");
    const ctx = tokens.find(([token]) => token.length === presented.length && timingSafeEqual(token, presented))?.[1];
    if (!ctx) { send(401, { code: "NOT_AUTHORIZED" }); return; }
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.search || url.hash) { send(400, { code: "INVALID_REQUEST" }); return; }
      const path = url.pathname;
      let body: unknown;
      if (req.method === "POST" || req.method === "PUT") {
        if (req.headers["content-type"]?.split(";")[0] !== "application/json") {
          send(415, { code: "INVALID_REQUEST" }); return;
        }
        let bytes = 0; const chunks: Buffer[] = [];
        for await (const raw of req) {
          const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
          bytes += chunk.length;
          if (bytes > 16384) { send(413, { code: "INVALID_REQUEST" }); return; }
          chunks.push(chunk);
        }
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      }
      if (req.method === "POST" && path === "/transfers/intents") { send(201, service.createIntent(ctx, body)); return; }
      if (req.method === "POST" && path === "/transfers/pay") { send(200, await service.pay(ctx, body)); return; }
      if (req.method === "POST" && path === "/transfers/due") {
        EmptyTransferBody.parse(body); send(200, { results: await service.executeDue(ctx) }); return;
      }
      if (req.method === "PUT" && path === "/transfers/policy") { service.setPolicy(ctx, body); send(200, { ok: true }); return; }
      if (req.method === "POST" && path === "/transfers/accounts") { service.registerAccount(ctx, body); send(201, { ok: true }); return; }
      if (req.method === "POST" && path === "/transfers/recipients") { service.approveRecipient(ctx, body); send(201, { ok: true }); return; }
      if (req.method === "POST" && path === "/transfers/unlock") {
        const { subjectId } = UnlockTransferAuthority.parse(body);
        service.unlock(ctx, subjectId); send(200, { ok: true }); return;
      }
      if (req.method === "GET" && path === "/transfers/audit") { send(200, { entries: service.audit(ctx) }); return; }
      const match = /^\/transfers\/([^/]+)(\/reconcile)?$/.exec(path);
      if (match) {
        const id = TransferId.parse(match[1]);
        if (req.method === "GET" && !match[2]) { send(200, service.getStatus(ctx, id)); return; }
        if (req.method === "POST" && match[2]) {
          EmptyTransferBody.parse(body); send(200, await service.reconcile(ctx, id)); return;
        }
      }
      send(404, { code: "NOT_FOUND" });
    } catch (error) {
      if (error instanceof PaymentError) send(error.code === "NOT_AUTHORIZED" ? 403 : 409, { code: error.code });
      else if (isTransferValidationError(error) || error instanceof SyntaxError) send(400, { code: "INVALID_REQUEST" });
      else send(503, { code: "OUTCOME_UNAVAILABLE", message: "Read intent status; do not assume payment failed or retry with a new intent." });
    }
  }
}
