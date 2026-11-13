import { tool } from "ai";
import { z } from "zod";
import { isValidClassicAddress, isValidXAddress } from "ripple-address-codec";
import { Amount, ApprovalRequest, fromCents, LogEntry, XrplAddress, PayRequest, PayResult, Reason, SupplierLookup, toCents, type RuleCode } from "@shucamoxa/shared";
import type { BackendClient } from "./backend";
import { chatInvoiceNumber } from "./ids";
import { escapeRegExp, significantWords } from "./grounding";

/**
 * The lowest GET /suppliers confidence that counts as a match. Below it, nothing is payable: the
 * invoice waits for the owner (propose_supplier) or a person (needs_review).
 */
export const MIN_SUPPLIER_CONFIDENCE = 0.85;

/** What the tools observed during one run. The outcome is built from this, never from model text. */
export type RunState = {
  /**
   * When processing an invoice, pay may only pay exactly this invoice number and amount, and only to
   * supplierId, which code resolved from the invoice's own supplierName before the planner ran.
   * A null supplierId means no confident match, so pay refuses everything.
   */
  mandate: Mandate | null;
  /**
   * The cap and remaining budget code read from GET /rules before the planner ran. request_approval is
   * judged against these, never against figures the model supplies. remaining is null if the rules
   * reply did not carry it, in which case only the cap can justify an approval.
   */
  limits: Limits;
  /** Chat mode only: IDs find_supplier matched at or above MIN_SUPPLIER_CONFIDENCE. pay only accepts one of these. */
  knownSupplierIds: Set<string>;
  /**
   * Every ID find_supplier returned in this run, whatever the confidence. In invoice mode this never
   * makes an ID payable; pay just also requires that the planner looked its supplier up.
   */
  lookedUpSupplierIds: Set<string>;
  /** Invoice numbers already sent to POST /payments in this run, whatever the result. */
  attemptedInvoices: Set<string>;
  payResults: PayResult[];
  /** At most one of each kind per run. ruleCode is why the owner was asked, worked out in cents by code. */
  approvals: Array<{ kind: "supplier" | "payment"; approvalId: string; ruleCode: RuleCode; amount?: string; supplierId?: string }>;
  /** Approval kinds already sent (or being sent) to POST /approvals in this run. */
  requestedApprovalKinds: Set<"supplier" | "payment">;
  /**
   * Chat mode only (null in an invoice run): the owner's message and the one amount code read from it.
   * Chat pay and request_approval refuse unless their amount equals it in cents and the supplier is one
   * the message names.
   */
  chatMandate: ChatMandate | null;
  /** Chat mode only: the supplier name GET /suppliers returned for each confidently matched ID. */
  knownSupplierNames: Map<string, string>;
  /**
   * Chat mode only: every payment chat pay sent to POST /payments, as code built it (code-generated
   * CHAT- invoice number), with the backend's parsed answer or null if there was no usable answer.
   * Pushed before the await, so at most one can ever be sent per run, even with parallel calls.
   */
  chatPayments: Array<{ request: PayRequest; result: PayResult | null }>;
};

/**
 * The owner's chat message and the amount code read from it (ownerAmountFromMessage): null if it held
 * none, several, or any number that is not a clean USD amount.
 */
export type ChatMandate = { message: string; amount: string | null };

/**
 * The invoice being processed, as extraction read it and code resolved it. supplierName and
 * payToAddressOnInvoice are kept so propose_supplier can carry only what the invoice says.
 */
export type Mandate = {
  invoiceNumber: string;
  amount: string;
  supplierId: string | null;
  supplierName: string;
  payToAddressOnInvoice: string | null;
};

export type Limits = { perPaymentCap: string; remaining: string | null };

export function newRunState(mandate: RunState["mandate"], limits: Limits, chatMandate: ChatMandate | null = null): RunState {
  return {
    mandate,
    limits,
    chatMandate,
    chatPayments: [],
    knownSupplierNames: new Map(),
    requestedApprovalKinds: new Set(),
    knownSupplierIds: new Set(),
    lookedUpSupplierIds: new Set(),
    attemptedInvoices: new Set(),
    payResults: [],
    approvals: [],
  };
}

/** A GET /suppliers reply that satisfies the contract and matched, or null. Anything off-contract is no match. */
export function supplierMatch(reply: Awaited<ReturnType<BackendClient["findSupplier"]>>) {
  if (!reply.ok) return null;
  const parsed = SupplierLookup.safeParse(reply.body);
  return parsed.success && "supplierId" in parsed.data ? parsed.data : null;
}

export function isConfident<T extends { confidence: number }>(match: T | null): match is T {
  return match !== null && match.confidence >= MIN_SUPPLIER_CONFIDENCE;
}

const NOT_LOOKED_UP =
  "supplierId was not returned by find_supplier in this run. Only approved suppliers can be paid; use propose_supplier for a new one.";

/** Layer-1 checks for an invoice run. The policy service and ledger enforce again; this just stops bad requests early. */
function refusePay(request: PayRequest, mandate: Mandate, state: RunState): string | null {
  if (carriesAddress(request.reason)) return ADDRESS_IN_TEXT;
  if (mandate.supplierId === null || request.supplierId !== mandate.supplierId)
    return "This invoice can only be paid to its own supplier, matched by the system. Use propose_supplier if it is new.";
  if (!state.lookedUpSupplierIds.has(request.supplierId)) return NOT_LOOKED_UP;
  if (request.invoiceNumber !== mandate.invoiceNumber)
    return "This run may only pay the invoice being processed.";
  if (toCents(request.amount) !== toCents(mandate.amount))
    return `The amount must equal the invoice total, ${mandate.amount}. Amounts mentioned elsewhere in the invoice are ignored.`;
  if (state.attemptedInvoices.has(request.invoiceNumber))
    return "A payment for this invoice was already requested in this run. It is never retried; the owner decides what happens next.";
  return null;
}

/** 25 or more ASCII letters and digits in a row, as written: the shape of an address, key, seed or hash. */
const LONG_RUN = /[A-Za-z0-9]{25,}/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/**
 * True if free text carries something an owner could copy as a destination: any 25+ letters-and-digits
 * run as written, or a checksum-valid classic or X-address once every non-alphanumeric character
 * (spaces, hyphens, dots...) is removed, so "rHH1 MJb3 ..." is caught too.
 */
export function carriesAddress(text: string): boolean {
  return LONG_RUN.test(text) || addressSpans(text).length > 0;
}

/**
 * [start, end) spans of `text` that hold a checksum-valid classic or X-address once every
 * non-alphanumeric character is removed, including addresses split by spaces or punctuation. The scan
 * relies on the address checksum rather than a pattern, because prose without spaces is full of long
 * letter runs. At each position the longest valid classic address wins.
 */
export function addressSpans(text: string): Array<[number, number]> {
  const positions: number[] = [];
  let compact = "";
  for (let k = 0; k < text.length; k++) {
    if (/[A-Za-z0-9]/.test(text[k]!)) {
      compact += text[k];
      positions.push(k);
    }
  }
  const spans: Array<[number, number]> = [];
  for (let i = 0; i < compact.length; ) {
    const len = addressLengthAt(compact, i);
    if (len > 0) {
      spans.push([positions[i]!, positions[i + len - 1]! + 1]);
      i += len;
    } else i++;
  }
  return spans;
}

function addressLengthAt(compact: string, i: number): number {
  const first = compact[i];
  if (first === "r") {
    for (let len = Math.min(35, compact.length - i); len >= 25; len--) {
      const candidate = compact.slice(i, i + len);
      if (BASE58.test(candidate) && validClassic(candidate)) return len;
    }
  } else if ((first === "X" || first === "T") && i + 47 <= compact.length) {
    const candidate = compact.slice(i, i + 47);
    if (BASE58.test(candidate) && validX(candidate)) return 47;
  }
  return 0;
}

const validClassic = (s: string) => {
  try {
    return isValidClassicAddress(s);
  } catch {
    return false;
  }
};
const validX = (s: string) => {
  try {
    return isValidXAddress(s);
  } catch {
    return false;
  }
};

const ADDRESS_IN_TEXT = "The reason must not contain an address, key or any long code. Describe the payment in words.";

const ONE_PER_RUN = "The owner has already been asked once in this run. Wait for their decision; do not ask again.";

/**
 * Why an amount needs the owner, compared in integer cents against the limits code read: the cap first,
 * then the remaining budget. null means it is within both, so pay is the right tool.
 */
export function overLimit(amount: string, limits: Limits): Extract<RuleCode, "OVER_PER_PAYMENT_CAP" | "OVER_BUDGET"> | null {
  const cents = toCents(amount);
  if (cents > toCents(limits.perPaymentCap)) return "OVER_PER_PAYMENT_CAP";
  if (limits.remaining !== null && cents > toCents(limits.remaining)) return "OVER_BUDGET";
  return null;
}

type PaymentApprovalInput = { invoiceNumber: string; supplierId: string; amount: string; reason: string };

/**
 * Builds the payment approval card or says why not. In invoice mode the card carries the mandate's own
 * invoice number, supplier and amount; in chat the supplier must be one find_supplier matched confidently.
 * Either way the amount must actually be over the cap or remaining budget.
 */
function paymentApproval(input: PaymentApprovalInput, state: RunState): { refusal: string } | { request: ApprovalRequest; ruleCode: RuleCode } {
  if (state.requestedApprovalKinds.has("payment")) return { refusal: ONE_PER_RUN };
  const mandate = state.mandate;
  if (mandate) {
    if (mandate.supplierId === null || input.supplierId !== mandate.supplierId)
      return { refusal: "Approval can only be requested for this invoice's own supplier, matched by the system. Use propose_supplier if it is new." };
    if (input.invoiceNumber !== mandate.invoiceNumber) return { refusal: "This run may only ask about the invoice being processed." };
    if (toCents(input.amount) !== toCents(mandate.amount))
      return { refusal: `The amount must equal the invoice total, ${mandate.amount}. Amounts mentioned elsewhere in the invoice are ignored.` };
  } else {
    const refusal = refuseChatMoney(input, state);
    if (refusal) return { refusal };
  }
  if (carriesAddress(input.reason)) return { refusal: ADDRESS_IN_TEXT };
  // The card reads in canonical two decimals ("120" -> "120.00").
  const amount = fromCents(toCents(mandate ? mandate.amount : input.amount));
  const ruleCode = overLimit(amount, state.limits);
  if (!ruleCode) return { refusal: "This amount is within the per-payment cap and the remaining budget, so no approval is needed. Use pay." };
  const parsed = ApprovalRequest.safeParse({
    kind: "payment",
    payload: mandate
      ? { invoiceNumber: mandate.invoiceNumber, supplierId: mandate.supplierId, amount, reason: input.reason }
      : // Chat: code names the request, so a model can't squat on a real invoice number (same scheme as T08).
        { invoiceNumber: chatInvoiceNumber(), supplierId: input.supplierId, amount, reason: input.reason },
  });
  if (!parsed.success) return { refusal: "The approval request does not satisfy the approval contract." };
  return { request: parsed.data, ruleCode };
}

type SupplierProposalInput = { name: string };

/**
 * Builds the supplier proposal card or says why not. Invoice mode only, and only when code matched no
 * supplier. The planner only confirms the name, which must be the invoice's supplierName. Code fills in
 * everything else: the address is the invoice's own pay-to address if it passes XrplAddress (else null,
 * and the owner enters it), the evidence names the invoice, and the invoice number is the mandate's.
 */
function supplierProposal(input: SupplierProposalInput, state: RunState): { refusal: string } | { request: ApprovalRequest } {
  const mandate = state.mandate;
  if (!mandate) return { refusal: "Suppliers are added by the owner on the dashboard." };
  if (state.requestedApprovalKinds.has("supplier")) return { refusal: ONE_PER_RUN };
  if (mandate.supplierId !== null) return { refusal: "This invoice's supplier is already approved. Do not propose it again." };
  if (input.name !== mandate.supplierName) return { refusal: "The proposal must name the invoice's supplier exactly as supplierName." };
  if (carriesAddress(mandate.supplierName)) return { refusal: "The supplier name on this invoice looks like it carries a code. A person should review it." };
  const address = XrplAddress.safeParse(mandate.payToAddressOnInvoice).success ? mandate.payToAddressOnInvoice : null;
  const parsed = ApprovalRequest.safeParse({
    kind: "supplier",
    payload: {
      name: mandate.supplierName,
      address,
      evidence: `Invoice ${mandate.invoiceNumber} from ${mandate.supplierName}`,
      invoiceNumber: mandate.invoiceNumber,
    },
  });
  if (!parsed.success) return { refusal: "The proposal does not satisfy the approval contract. A person should review this invoice." };
  return { request: parsed.data };
}

/**
 * The agent's tools. In invoice mode all six: four read or propose, one pays, none can change rules.
 * In chat (no mandate) propose_supplier is left out, because owners add suppliers on the dashboard,
 * and pay is the chat pay tool: no invoiceNumber input, the owner's own amount, one payment per run.
 * Tool inputs are Zod-parsed by the SDK before execute runs; a bad input goes back to the model as an
 * error result instead of reaching the backend.
 */
export function agentTools(backend: BackendClient, state: RunState) {
  if (state.mandate) return allTools(backend, state, invoicePayTool(backend, state, state.mandate));
  const { propose_supplier: _notInChat, ...chatTools } = allTools(backend, state, chatPayTool(backend, state));
  return chatTools;
}

function invoicePayTool(backend: BackendClient, state: RunState, mandate: Mandate) {
  return tool({
    description: "Request payment to an APPROVED supplier by supplierId. amount is a decimal string in USD (RLUSD).",
    inputSchema: PayRequest,
    execute: async (request) => {
      const refusal = refusePay(request, mandate, state);
      if (refusal) return { refused: true, reason: refusal };
      state.attemptedInvoices.add(request.invoiceNumber); // before the await, so parallel calls see it
      const reply = await backend.pay(request);
      if (!reply.ok) return reply;
      const result = PayResult.parse(reply.body);
      state.payResults.push(result);
      return result;
    },
  });
}

/** Chat pay input: no invoiceNumber, so the model can't squat on a real invoice's number (G6). Strict. */
const ChatPayInput = PayRequest.omit({ invoiceNumber: true });
type ChatPayInput = z.infer<typeof ChatPayInput>;

const ONE_MONEY_ACTION_PER_CHAT =
  "A payment or approval request was already sent in this chat. Only one is made per message; it is never retried or repeated.";
const NO_OWNER_AMOUNT =
  'The owner\'s message does not state exactly one amount in USD, so nothing can be paid or requested. Ask the owner to say the amount, for example "Pay Karoo $30".';
const NOT_NAMED_BY_OWNER = "The owner's message does not name this supplier. Only the supplier the owner named can be paid; ask the owner if unsure.";

/**
 * Layer-1 checks shared by chat pay and chat request_approval: one money action per chat run (a payment
 * sent or a payment approval requested), to a confidently matched supplier the owner's message names,
 * for exactly the amount the owner wrote. The policy service and ledger enforce again.
 */
function refuseChatMoney(input: { supplierId: string; amount: string }, state: RunState): string | null {
  const chat = state.chatMandate;
  if (chat === null) return NO_OWNER_AMOUNT;
  if (state.chatPayments.length > 0 || state.requestedApprovalKinds.has("payment")) return ONE_MONEY_ACTION_PER_CHAT;
  if (!state.knownSupplierIds.has(input.supplierId)) return NOT_LOOKED_UP;
  const name = state.knownSupplierNames.get(input.supplierId);
  if (name === undefined || !ownerNamesSupplier(chat.message, name)) return NOT_NAMED_BY_OWNER;
  if (chat.amount === null) return NO_OWNER_AMOUNT;
  if (toCents(input.amount) !== toCents(chat.amount))
    return `The amount must be the one the owner wrote, ${chat.amount}. Ask the owner if they meant something else.`;
  return null;
}

/** Words that open a business name without identifying it. */
const GENERIC_NAME_WORDS = new Set(["the", "and", "company"]);

/**
 * True if the owner's message names this supplier. The supplier's first identifying word (a significant
 * word as grounding defines it, other than "the", "and" or "company") must appear as a whole word,
 * case-insensitively. So "Pay Karoo" names "Karoo Textiles" but not "Zambezi Spices", and "Karoon"
 * names neither. A name with no such word must appear whole.
 */
export function ownerNamesSupplier(message: string, supplierName: string): boolean {
  const text = message.normalize("NFKC");
  const name = supplierName.normalize("NFKC");
  const word = significantWords(name).find((w) => !GENERIC_NAME_WORDS.has(w.toLowerCase())) ?? name.trim();
  if (word === "") return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, "iu").test(text);
}

function chatPayTool(backend: BackendClient, state: RunState) {
  return tool({
    description:
      "Pay an APPROVED supplier the amount the owner wrote, by supplierId. amount is a decimal string in USD (RLUSD). The system assigns the invoice number. One payment per message.",
    inputSchema: ChatPayInput,
    execute: async (input) => {
      const refusal = carriesAddress(input.reason) ? ADDRESS_IN_TEXT : refuseChatMoney(input, state);
      if (refusal) return { refused: true, reason: refusal };
      const request = PayRequest.parse({ ...input, invoiceNumber: chatInvoiceNumber() });
      const attempt: RunState["chatPayments"][number] = { request, result: null };
      state.chatPayments.push(attempt); // before the await, so parallel calls see it
      const reply = await backend.pay(request);
      if (!reply.ok) return reply;
      const parsed = PayResult.safeParse(reply.body);
      if (!parsed.success) return { error: "The payment service's answer was not understood. Do not retry; the owner will check the activity log." };
      attempt.result = parsed.data;
      state.payResults.push(parsed.data);
      return parsed.data;
    },
  });
}

/** One number as written: digits, optional thousands commas, optional decimals. Validated further below. */
const NUMBER_TOKEN = /\d+(?:,\d+)*(?:\.\d+)?/g;
const PLAIN_AMOUNT = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/;
/** What may stand right before an amount (or its "$" / "USD" marker), and right after it. */
const OPENS = /[\s("':]$/;
const CLOSES = /^[\s.,!?;:)"']/;
/** The only currency markers accepted on the left of the number: "$", "US$", "USD", "RLUSD" (any case). */
const USD_BEFORE = /(?:(?:us)?\$|(?:rl)?usd\s*)$/i;
/** ... and on the right: "USD", "RLUSD" (any case). */
const USD_AFTER = /^\s*(?:rl)?usd(?![\p{L}\p{N}])/iu;
/** Bidi controls can make a message render differently from what it says. */
const BIDI_CONTROL = /[‪-‮⁦-⁩‎‏؜]/;
const ASCII_OR_FULLWIDTH_DIGIT = /[0-9０-９]/;

/** ISO 4217 codes from the runtime, plus the ones our region uses, in case the runtime lacks ICU data. USD excluded. */
const CURRENCY_CODES = new Set(
  [
    ...(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : []),
    ..."ZAR NAD BWP LSL SZL MZN ZMW MWK KES TZS UGX RWF ETB NGN GHS XOF XAF EGP MAD DZD TND AOA ZWL EUR GBP AUD CAD HKD MXN INR JPY CNY CHF".split(" "),
  ]
    .map((code) => code.toLowerCase())
    .filter((code) => code !== "usd"),
);
/** Currency names, symbols spelt out and common abbreviations that are not ISO codes. */
const CURRENCY_WORDS = new Set(
  (
    "r rand rands ksh kshs sh shs shilling shillings kwacha birr dirham dirhams dinar dinars naira cedi cedis pula loti maloti " +
    "lilangeni emalangeni metical meticais kwanza leone leones franc francs cfa euro euros pound pounds quid sterling yen yuan rmb " +
    "renminbi peso pesos real reais rupee rupees rs bucks buck usdc usdt xrp btc eth bitcoin ether ethereum"
  ).split(" "),
);

/** True if a word next to an amount marks a currency other than USD: a currency symbol, a non-USD ISO code or a currency word. */
function marksOtherCurrency(word: string | undefined): boolean {
  if (word === undefined) return false;
  if (/\p{Sc}/u.test(word)) return true;
  const letters = word.replace(/[^\p{L}]/gu, "").toLowerCase();
  return CURRENCY_CODES.has(letters) || CURRENCY_WORDS.has(letters);
}

/**
 * The single USD amount in the owner's chat message, as a canonical two-decimal string, or null.
 * Allowlist: an amount is accepted only as a bare number, "$N", "US$N", "USD N", "N USD", "RLUSD N" or
 * "N RLUSD" (USD and RLUSD in any case), standing apart from other words. It returns null when:
 * - the message has no amount, several different ones, or any other number (a count, a date, the
 *   digits of an invoice number), so the model has to ask;
 * - anything else touches the number or its "$" ("N$30", "HK$30", "-$30", "R500", "30k", "3e1", "30$");
 * - the word next to it marks another currency ("NAD 30", "30 kwacha", "30 ZMW", "€ 30", "30 bucks");
 * - the message holds a bidi control, or NFKC would turn anything but an ASCII or fullwidth digit into
 *   a digit ("¹30", "3⁰", "③").
 * Pure; no model involved.
 */
export function ownerAmountFromMessage(message: string): string | null {
  if (BIDI_CONTROL.test(message)) return null;
  for (const char of message) {
    if (/[0-9]/.test(char.normalize("NFKC")) && !ASCII_OR_FULLWIDTH_DIGIT.test(char)) return null;
  }
  const text = message.normalize("NFKC");
  const values = new Set<string>();
  for (const match of text.matchAll(NUMBER_TOKEN)) {
    const token = match[0];
    const start = match.index;
    const end = start + token.length;
    if (!PLAIN_AMOUNT.test(token)) return null;

    let left = text.slice(0, start);
    const marker = USD_BEFORE.exec(left);
    if (marker) left = left.slice(0, marker.index);
    if (left.length > 0 && !OPENS.test(left)) return null;
    if (marksOtherCurrency(/(\S+)\s*$/.exec(left)?.[1])) return null;

    let right = text.slice(end);
    const suffix = USD_AFTER.exec(right);
    if (suffix) right = right.slice(suffix[0].length);
    if (right.length > 0 && !CLOSES.test(right)) return null;
    if (marksOtherCurrency(/^[\s.,!?;:)"']*(\S+)/.exec(right)?.[1])) return null;

    const plain = token.replaceAll(",", "");
    if (!Amount.safeParse(plain).success) return null;
    values.add(fromCents(toCents(plain)));
  }
  return values.size === 1 ? [...values][0]! : null;
}

function allTools(backend: BackendClient, state: RunState, pay: ReturnType<typeof invoicePayTool> | ReturnType<typeof chatPayTool>) {
  return redactResults({
    get_rules: tool({
      description: "Read the owner's payment rules and remaining budget. Read-only.",
      inputSchema: z.object({}),
      execute: async () => backend.getRules(),
    }),
    find_supplier: tool({
      description: "Find an approved supplier by name. Returns supplierId or notFound. Never returns an address.",
      inputSchema: z.strictObject({ name: z.string().min(1) }),
      execute: async ({ name }) => {
        const reply = await backend.findSupplier(name);
        const match = supplierMatch(reply);
        if (match) {
          state.lookedUpSupplierIds.add(match.supplierId);
          // Invoice mode: results only inform propose_supplier; the payable ID is fixed in the mandate.
          if (!state.mandate && isConfident(match)) {
            state.knownSupplierIds.add(match.supplierId);
            state.knownSupplierNames.set(match.supplierId, match.name);
          }
        }
        return reply;
      },
    }),
    pay,
    propose_supplier: tool({
      description:
        "Ask the owner to approve this invoice's supplier when the system matched none. Give its name exactly as supplierName; the system adds the rest from the invoice.",
      inputSchema: z.strictObject({ name: z.string().min(1) }),
      execute: async (input) => {
        const built = supplierProposal(input, state);
        if ("refusal" in built) return { refused: true, reason: built.refusal };
        state.requestedApprovalKinds.add("supplier"); // before the await, so parallel calls see it
        const reply = await backend.createApproval(built.request);
        if (reply.ok) state.approvals.push({ kind: "supplier", approvalId: approvalIdOf(reply.body), ruleCode: "SUPPLIER_NOT_APPROVED" });
        return reply;
      },
    }),
    request_approval: tool({
      description:
        "Ask the owner to approve a payment that is over the per-payment cap or remaining budget. In chat, the system assigns the invoice number.",
      inputSchema: z.strictObject({ invoiceNumber: z.string().min(1), supplierId: z.string().min(1), amount: Amount, reason: Reason }),
      execute: async (input) => {
        const built = paymentApproval(input, state);
        if ("refusal" in built) return { refused: true, reason: built.refusal };
        state.requestedApprovalKinds.add("payment"); // before the await, so parallel calls see it
        const reply = await backend.createApproval(built.request);
        if (reply.ok) {
          const { amount, supplierId } = built.request.payload as { amount: string; supplierId: string };
          state.approvals.push({ kind: "payment", approvalId: approvalIdOf(reply.body), ruleCode: built.ruleCode, amount, supplierId });
        }
        return reply;
      },
    }),
    query_log: tool({
      description: "Read the payment log. Optional filters: supplierId, from, to (ISO dates), status.",
      inputSchema: z.strictObject({
        supplierId: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        status: z.enum(["settled", "blocked", "pending_approval"]).optional(),
      }),
      execute: async (filter) =>
        logForModel(await backend.queryLog(Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined)) as Record<string, string>)),
    }),
  });
}

/** The log fields the model may read. explanation, reason and any other free text stay on the dashboard. */
const LOG_FIELDS_FOR_MODEL = ["seq", "ts", "event", "invoiceNumber", "supplierId", "amount", "ruleCode", "txHash"] as const;

/**
 * GET /log as the model sees it (T07, G8): each entry cut down to LOG_FIELDS_FOR_MODEL, and each kept
 * value checked against its LogEntry field schema (else null), so free text can't ride in a kept field
 * either. A reply that is not a list becomes an error.
 */
export function logForModel(reply: Awaited<ReturnType<BackendClient["queryLog"]>>) {
  if (!reply.ok) return reply;
  if (!Array.isArray(reply.body)) return { ok: false as const, error: "the log reply was not a list of entries" };
  return {
    ok: true as const,
    body: reply.body.map((raw) => {
      const entry = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      return Object.fromEntries(
        LOG_FIELDS_FOR_MODEL.map((key) => {
          const parsed = (LogEntry.shape[key] as z.ZodType).safeParse(entry[key]);
          return [key, parsed.success ? parsed.data : null];
        }),
      );
    }),
  };
}

/** XRPL classic address shape: "r" plus 24-34 base58 characters (checksum not required). */
const XRPL_ADDRESS = /\br[1-9A-HJ-NP-Za-km-z]{24,34}\b/g;
/** XRPL X-address shape: "X" (mainnet) or "T" (testnet) plus 46 base58 characters. */
const X_ADDRESS = /\b[XT][1-9A-HJ-NP-Za-km-z]{46}\b/g;
const HIDDEN = "[address hidden]";

/**
 * Hides every address in a string: first any checksum-valid classic or X-address, even split by spaces
 * or punctuation (the forms carriesAddress detects), then anything shaped like either kind.
 */
function redactText(text: string): string {
  let out = text;
  for (const [start, end] of addressSpans(text).reverse()) out = out.slice(0, start) + HIDDEN + out.slice(end);
  return out.replace(X_ADDRESS, HIDDEN).replace(XRPL_ADDRESS, HIDDEN);
}
const ADDRESS_KEYS = new Set(["xrplAddress", "address", "destination", "Destination", "destinationTag"]);

/**
 * Wallet addresses never reach the model, even if a backend endpoint leaks one. Applied to every tool
 * result and to the planner prompt.
 */
export function redactAddresses(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactAddresses);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).filter(([k]) => !ADDRESS_KEYS.has(k)).map(([k, v]) => [k, redactAddresses(v)]),
    );
  }
  return value;
}

function redactResults<T extends Record<string, { execute?: (...args: any[]) => any }>>(tools: T): T {
  for (const t of Object.values(tools)) {
    const execute = t.execute;
    if (execute) t.execute = async (...args: any[]) => redactAddresses(await execute(...args));
  }
  return tools;
}

function approvalIdOf(body: unknown): string {
  const id = (body as { approvalId?: unknown } | null)?.approvalId;
  return typeof id === "string" ? id : "unknown";
}
