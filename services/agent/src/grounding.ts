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

const REASONS = {
  amountNotTheTotal: "The extracted amount is not the one amount stated on the invoice's total lines.",
  noTotalLine: "The invoice has no total line, so the extracted amount could not be confirmed.",
  invoiceNumber: "The extracted invoice number does not appear in the invoice text.",
  address: "The extracted pay-to address does not appear in the invoice text.",
  supplier: "The extracted supplier name does not appear in the invoice text.",
  lineItems: "The extracted line items do not add up to the extracted total.",
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

  if (!supplierNameAppears(text, invoice.supplierName)) return REASONS.supplier;

  if (invoice.lineItems.length > 0) {
    const sum = invoice.lineItems.reduce((acc, item) => acc + toCents(item.amount), 0n);
    if (sum !== total) return REASONS.lineItems;
  }
  return null;
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
