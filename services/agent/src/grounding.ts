import { toCents, type ExtractedInvoice } from "@shucamoxa/shared";

/** The fields the agent relies on later: they set who is paid, how much, and for which invoice. */
export type GroundedFields = Pick<ExtractedInvoice, "supplierName" | "invoiceNumber" | "amount" | "lineItems" | "payToAddressOnInvoice">;

/**
 * A number on number boundaries: "30", "30.00", "1,030.00", and the "30.00" in "$30.00".
 * Not the "30.00" inside "130.00", "1,030.00" or "30.001", and not the "50" in ".50".
 */
const NUMBER = /(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?!\d|[.,]\d)/g;
/** Any line that talks about a total: TOTAL DUE, Subtotal, "revised total", Amount due. */
const TOTAL_LINE = /total|amount\s+due/i;
const LINE_BREAK = /\r\n|[\n\r\u2028\u2029]/;
const SIGNIFICANT_WORD_LENGTH = 3;

/** A money amount with exactly two decimals at the end of a line, optionally followed by USD, RLUSD or $. */
const TRAILING_AMOUNT = /(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?:\s*\$|\s+(?:USD|RLUSD))?\s*$/i;
/** A VAT or tax line ends the item lines when it carries an amount; a "VAT No:" header line never does. */
const TAX_WORD = /\b(?:vat|gst|tax)\b/i;
/** A tax or company registration number in the header: "VAT No: 4123456789", "Reg. number 2019/123456/07". */
const REGISTRATION_LINE = /^\s*(?:(?:vat|tax|gst)\s*(?:reg(?:istration)?\.?\s*)?|(?:company\s+)?reg(?:istration)?\.?\s*)(?:no\b\.?|number\b|id\b|#)/i;
/** A date header: "Date: 2026-11-10   Due: 2026-11-20", "Due date: ...", "Invoice date: ...". */
const DATE_LINE = /^\s*(?:(?:invoice|issue|due)\s+)?(?:date|due)\b/i;
/** Something that reads as money: a number with one or two decimals, "4.99" or "20,00". */
const MONEY_LIKE = /\d[.,]\d{1,2}(?!\d)/;
/**
 * A discount, credit or negative amount: words such as "discount" or "less", a leading or trailing minus,
 * an amount in parentheses, or CR/DR next to a number. Grounding cannot sign amounts, so these go to a person.
 */
const CREDIT: RegExp[] = [
  /\b(?:discount|credit|less|refund|rebate|deduct\w*)\b/i,
  /(?:^|[\s:=(])[-\u2212\u2012\u2013\u2014]\s*\$?\s*\d/,
  /\d[.,]\d{2}\s*[-\u2212\u2012\u2013\u2014](?![\p{L}\p{N}])/u,
  /\(\s*\$?\s*\d[\d,]*(?:\.\d+)?\s*\)/,
  /\d\s*(?:CR|DR)\b/i,
];
/** "From: Karoo Textiles (Pty) Ltd, Lagos office": the label is not part of the sender. */
const FROM_LINE = /^\s*from\s*:\s*/i;
/** A recipient or payment header ends the letterhead: "To:", "Bill to:", "Ship to", "Remit to:", "Pay to ...". */
const RECIPIENT_HEADER = /^\s*(?:(?:bill|ship|sold|deliver|remit|pay(?:able)?)\s+)?to\b/i;
/** An invoice header ends the letterhead: "Invoice number: ...", "Invoice date", "Tax invoice". */
const INVOICE_HEADER = /^\s*(?:tax\s+)?invoice\b/i;
/** A bare title line, skipped before the letterhead: "INVOICE", "TAX INVOICE". */
const TITLE_LINE = /^\s*(?:tax\s+)?invoice\s*$/i;

const REASONS = {
  amountNotTheTotal: "The extracted amount is not the one amount stated on the invoice's total lines.",
  noTotalLine: "The invoice has no total line, so the extracted amount could not be confirmed.",
  invoiceNumber: "The extracted invoice number does not appear in the invoice text.",
  address: "The extracted pay-to address does not appear in the invoice text.",
  supplier: "The extracted supplier name does not match who the invoice is from.",
  noSender: "The invoice has no single recognisable sender block, so it could not be checked automatically.",
  lineItems: "The extracted line items do not add up to the extracted total.",
  textLineItems: "The line items on the invoice do not add up to its total.",
  lineItemNotInText: "An extracted line item amount does not appear on any of the invoice's line items.",
  credit: "The invoice has a discount, credit or negative amount before its total, so it was not checked automatically.",
  unrecognisedLine: "A line with a number before the invoice's total is neither a header nor a line item, so it was not checked automatically.",
  pricedLineAmongTotals: "The invoice has a priced line among its totals, so it was not checked automatically.",
  unchecked: "The extracted fields could not be checked against the invoice text.",
} as const;

/**
 * Stage 1 is a model reading attacker-controlled text, so every value the agent relies on must
 * literally appear in that text. Takes the normalised text (what the model saw) and returns null
 * when the fields are grounded, or a reason that names the field. A reason never quotes the invoice.
 */
export function groundExtraction(normalisedText: string, invoice: GroundedFields): string | null {
  try {
    return firstProblem(normalisedText, invoice);
  } catch {
    return REASONS.unchecked;
  }
}

function firstProblem(text: string, invoice: GroundedFields): string | null {
  const total = toCents(invoice.amount);
  const lines = text.split(LINE_BREAK);
  // Every total line must state the same single amount, and it must be this one. A second total,
  // a "revised total" in the notes or an extra number on the TOTAL line makes the total ambiguous.
  const totalLines = lines.filter((line) => TOTAL_LINE.test(line));
  if (totalLines.length === 0) return REASONS.noTotalLine;
  const stated = new Set(totalLines.flatMap((line) => [...amountsIn(line)]));
  if (stated.size !== 1 || !stated.has(total)) return REASONS.amountNotTheTotal;

  if (!appearsAsToken(text, invoice.invoiceNumber)) return REASONS.invoiceNumber;

  if (invoice.payToAddressOnInvoice !== null && !appearsAsToken(text, invoice.payToAddressOnInvoice)) return REASONS.address;

  const layout = layoutOf(lines);
  // The supplier is who sent the invoice, not any name the text mentions: a "remit to Zambezi Spices"
  // note must not ground Zambezi. No single sender block means no way to tell, so a person decides.
  if (layout.sender === null) return REASONS.noSender;
  if (!supplierNameAppears(layout.sender, invoice.supplierName)) return REASONS.supplier;

  if (invoice.lineItems.length > 0) {
    const sum = invoice.lineItems.reduce((acc, item) => acc + toCents(item.amount), 0n);
    if (sum !== total) return REASONS.lineItems;
  }
  // Fail closed on anything the item sum cannot account for: before the total, every line with a
  // number is a header line or a clean item line, and nothing is a credit or sits among the totals.
  if (layout.problem !== null) return REASONS[layout.problem];
  // The text's own item lines must add up to the total, whatever the model returned: an empty or
  // invented list of line items cannot hide an invoice whose items say 45.00 and whose total says 49.99.
  if (layout.itemLines.length > 0) {
    const textSum = layout.itemLines.reduce((acc, line) => acc + trailingAmountOf(line)!, 0n);
    if (textSum !== total) return REASONS.textLineItems;
  }
  const onItemLines = new Set(layout.itemLines.flatMap((line) => [...amountsIn(line)]));
  if (invoice.lineItems.some((item) => !onItemLines.has(toCents(item.amount)))) return REASONS.lineItemNotInText;
  return null;
}

type Layout = {
  /** The sender block's text, or null when there is no single recognisable sender block. */
  sender: string | null;
  /** Lines before the first priced total, sub-total, VAT or tax line that end in a clean amount. */
  itemLines: string[];
  /** Why the lines before the total cannot be trusted to account for it, or null. */
  problem: "credit" | "unrecognisedLine" | "pricedLineAmongTotals" | null;
};

/**
 * Splits the invoice into its sender block and its item lines.
 * - The body is every line before the first total or tax line that carries an amount, so a column
 *   heading such as "Line total" or a bare "Sub-total" does not end it.
 * - The header is the body up to the first item line. The sender block is the header's one From: line
 *   or, without one, the letterhead: the lines before the first To:, Bill to: or Invoice header, after
 *   a bare INVOICE title. A From: line anywhere else in the body, or a second one, leaves no sender.
 */
function layoutOf(lines: string[]): Layout {
  const stop = lines.findIndex(isTotalOrTaxLine);
  const body = stop === -1 ? lines : lines.slice(0, stop);
  const itemIndexes = body.flatMap((line, index) => (trailingAmountOf(line) !== null ? [index] : []));
  const headerEnd = itemIndexes[0] ?? body.length;
  const header = body.slice(0, headerEnd);

  const fromIndexes = body.flatMap((line, index) => (FROM_LINE.test(line) ? [index] : []));
  let sender: string | null = null;
  let letterheadEnd = 0;
  if (fromIndexes.length === 1 && fromIndexes[0]! < headerEnd) {
    sender = body[fromIndexes[0]!]!.replace(FROM_LINE, "");
  } else if (fromIndexes.length === 0) {
    let start = 0;
    while (start < header.length && (header[start]!.trim() === "" || TITLE_LINE.test(header[start]!))) start++;
    const end = header.findIndex((line, index) => index >= start && (RECIPIENT_HEADER.test(line) || INVOICE_HEADER.test(line)));
    if (end !== -1) {
      sender = header.slice(start, end).join("\n");
      letterheadEnd = end;
    }
  }
  if (sender !== null && sender.trim() === "") sender = null;
  // The header ends at the first item line, so no sender line is ever an item.
  return { sender, itemLines: itemIndexes.map((index) => body[index]!), problem: problemIn(lines, body, headerEnd, letterheadEnd) };
}

/**
 * The item sum is only meaningful if it accounts for every number before the total. Checks, in order:
 * no credit or negative amount from the first item line to the last total line; every header line with
 * a number is a recognised header (or a letterhead line) and carries no money amount; every later body
 * line with a number is a clean item line; and no priced line sits among the totals.
 */
function problemIn(lines: string[], body: string[], headerEnd: number, letterheadEnd: number): Layout["problem"] {
  let lastTotal = -1;
  lines.forEach((line, index) => {
    if (TOTAL_LINE.test(line) && amountsIn(line).size > 0) lastTotal = index;
  });
  const totals = lines.slice(body.length, lastTotal + 1);
  if ([...body.slice(headerEnd), ...totals].some((line) => CREDIT.some((pattern) => pattern.test(line)))) return "credit";
  for (const [index, line] of body.entries()) {
    if (!/\d/.test(line)) continue;
    const allowed =
      index < headerEnd ? (index < letterheadEnd || isHeaderLine(line)) && !MONEY_LIKE.test(line) : trailingAmountOf(line) !== null;
    if (!allowed) return "unrecognisedLine";
  }
  if (totals.some((line) => MONEY_LIKE.test(line) && !isTotalOrTaxLine(line))) return "pricedLineAmongTotals";
  return null;
}

function isHeaderLine(line: string): boolean {
  return [FROM_LINE, TITLE_LINE, RECIPIENT_HEADER, INVOICE_HEADER, DATE_LINE, REGISTRATION_LINE].some((pattern) => pattern.test(line));
}

/** A total or tax line that states an amount. A registration-number line is never one. */
function isTotalOrTaxLine(line: string): boolean {
  if (REGISTRATION_LINE.test(line)) return false;
  return (TOTAL_LINE.test(line) && amountsIn(line).size > 0) || (TAX_WORD.test(line) && MONEY_LIKE.test(line));
}

/** The amount at the end of an item line, in integer cents, or null when the line does not end in one. */
function trailingAmountOf(line: string): bigint | null {
  const match = TRAILING_AMOUNT.exec(line);
  if (!match) return null;
  try {
    return toCents(`${match[1]!.replace(/,/g, "").replace(/^0+(?=\d)/, "")}.${match[2]}`);
  } catch {
    return null;
  }
}

/** Every number in the text, in integer cents. Numbers with more than two non-zero decimals are skipped. */
function amountsIn(text: string): Set<bigint> {
  const found = new Set<bigint>();
  for (const [, whole = "", fraction = ""] of text.matchAll(NUMBER)) {
    const integer = whole.replace(/,/g, "").replace(/^0+(?=\d)/, "");
    const decimals = fraction.replace(/0+$/, "");
    try {
      found.add(toCents(decimals ? `${integer}.${decimals}` : integer));
    } catch {
      // Too many digits or decimals for an amount: it cannot be the total.
    }
  }
  return found;
}

/**
 * Literal and case-sensitive, on token boundaries: "INV-1042" is not grounded by "INV-10423",
 * "XINV-1042" or "INV-1042-B", but is by "INV-1042." at the end of a sentence.
 */
function appearsAsToken(text: string, needle: string, flags = "u"): boolean {
  if (needle.trim() === "") return false;
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?<![\\p{L}\\p{N}][-/._])${escapeRegExp(needle)}(?![\\p{L}\\p{N}_])(?![-/._][\\p{L}\\p{N}])`,
    flags,
  );
  return pattern.test(text);
}

/** The words of a supplier name that identify it: three or more letters or digits. */
export function significantWords(supplierName: string): string[] {
  return supplierName.split(/[^\p{L}\p{N}]+/u).filter((word) => [...word].length >= SIGNIFICANT_WORD_LENGTH);
}

/** Every word of three or more letters must appear as a whole word, case-insensitively. */
function supplierNameAppears(text: string, supplierName: string): boolean {
  const words = significantWords(supplierName);
  // A name with no significant word ("BP") must then appear whole, so it is never grounded by default.
  if (words.length === 0) return appearsAsToken(text, supplierName.trim(), "iu");
  return words.every((word) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, "iu").test(text));
}

/** Escapes only the characters that unicode-mode regexes allow to be escaped. */
export function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
}
