/**
 * Turns raw invoice text into the one form that both the extraction model and the grounding check
 * see. Order matters: decode and normalise first, so that look-alike and invisible-character
 * spellings of a tag become plain ASCII; only then strip template tokens and invoice tags.
 *
 * Every regex here keeps each run of whitespace in a single quantifier, so matching stays linear
 * on adversarial input such as "<<" followed by 20,000 spaces.
 */

/** Thrown when decoding has not settled within the pass limit. The message never quotes the invoice. */
export class UnsettledInvoiceTextError extends Error {
  override name = "UnsettledInvoiceTextError";
  constructor() {
    super("Invoice text was still changing after the maximum number of decode passes.");
  }
}

/** Rendered-invisible code points: zero-width, bidi controls and isolates, soft hyphen, Unicode tag characters, variation selectors. */
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;
/** C0 and C1 control characters, except tab, newline and carriage return. */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** Angle-bracket look-alikes that NFKC leaves alone, folded to ASCII in the text itself. */
const LEFT_ANGLE = /[‹˂ᐸ〈❬❮⟨〈]/g;
const RIGHT_ANGLE = /[›˃ᐳ〉❭❯⟩〉]/g;

const NAMED_ENTITY = /&(lt|gt|amp);?/gi;
const NUMERIC_ENTITY = /&#(?:x0*([0-9a-f]{1,6})|0*(\d{1,7}));?/gi;
const NAMED: Record<string, string> = { lt: "<", gt: ">", amp: "&" };

/**
 * Honest invoices settle in one or two passes. Text that is still changing after this many
 * (entities nested 7 or more deep) is refused rather than half-decoded.
 */
const MAX_DECODE_PASSES = 8;

/**
 * Chat-template control tokens for the model families we may run (Qwen/ChatML, Llama 2, Mistral,
 * Gemma), including Qwen3's think and tool-call markers. A model server may tokenise these as
 * real control tokens even inside user content. Mistral's tokens are an explicit list, so
 * bracketed words such as "[PAID]" survive.
 */
const TEMPLATE_TOKENS: RegExp[] = [
  /<\|[^\n]{0,64}?\|>/g,
  /<\|/g,
  /\[\s*(?:\/\s*)?(?:INST|TOOL_CALLS|AVAILABLE_TOOLS|SYSTEM_PROMPT|TOOL_RESULTS)\s*\]/gi,
  /<<\s*(?:\/\s*)?SYS\s*>>/gi,
  /<\s*(?:\/\s*)?(?:s|bos|eos|start_of_turn|end_of_turn|think|tool_call|tool_response)\s*>/gi,
];

/**
 * Any opening or closing invoice tag, including our own "invoice-XXXXXXXX" form, terminated or not.
 * Matched against the tag skeleton (lower case, no accents, look-alike letters folded), and stops at
 * a line end or the next bracket.
 */
const INVOICE_TAG = /<\s*(?:\/\s*)?invoice\b[^<>\n]*>?/g;

/** Cyrillic, Greek and Armenian letters that look like the letters of "invoice". */
const CONFUSABLES: Record<string, string> = {
  "ı": "i", "Ι": "i", "ι": "i", "І": "i", "і": "i", "Ӏ": "i", "ӏ": "i",
  "Ν": "n", "ո": "n",
  "ν": "v", "Ѵ": "v", "ѵ": "v",
  "Ο": "o", "ο": "o", "О": "o", "о": "o", "օ": "o",
  "ϲ": "c", "Ϲ": "c", "С": "c", "с": "c",
  "Е": "e", "е": "e", "ҽ": "e",
};

export function normaliseInvoiceText(raw: string): string {
  let text = raw;
  let settled = false;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass++) {
    const next = decodeEntities(foldAngleBrackets(stripInvisible(text.normalize("NFKC"))));
    if (next === text) {
      settled = true;
      break;
    }
    text = next;
  }
  if (!settled) throw new UnsettledInvoiceTextError();
  for (const token of TEMPLATE_TOKENS) text = text.replace(token, "[token removed]");
  return neutraliseInvoiceTags(text);
}

function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, "").replace(CONTROL, "");
}

function foldAngleBrackets(text: string): string {
  return text.replace(LEFT_ANGLE, "<").replace(RIGHT_ANGLE, ">");
}

/** Decodes &lt; &gt; &amp; and every numeric entity, so "&#x3c;" or "&amp;lt;" cannot hide a bracket. */
function decodeEntities(text: string): string {
  return text
    .replace(NUMERIC_ENTITY, (_match, hex: string | undefined, dec: string | undefined) => {
      const codePoint = hex !== undefined ? parseInt(hex, 16) : parseInt(dec!, 10);
      const valid = codePoint > 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff);
      return valid ? String.fromCodePoint(codePoint) : "�";
    })
    .replace(NAMED_ENTITY, (_match, name: string) => NAMED[name.toLowerCase()]!);
}

/**
 * Finds tags on a skeleton of the text, then replaces the matching span of the real text. Accented
 * or Cyrillic text that is not a tag is left exactly as written, so supplier names keep their spelling.
 */
function neutraliseInvoiceTags(text: string): string {
  let skeleton = "";
  const spanStart: number[] = [];
  const spanEnd: number[] = [];
  let index = 0;
  for (const char of text) {
    const folded = skeletonOf(char);
    for (let unit = 0; unit < folded.length; unit++) {
      spanStart.push(index);
      spanEnd.push(index + char.length);
    }
    skeleton += folded;
    index += char.length;
  }

  let result = "";
  let copiedUpTo = 0;
  for (const match of skeleton.matchAll(INVOICE_TAG)) {
    const start = spanStart[match.index]!;
    const end = spanEnd[match.index + match[0].length - 1]!;
    result += text.slice(copiedUpTo, start) + "[tag removed]";
    copiedUpTo = end;
  }
  return result + text.slice(copiedUpTo);
}

function skeletonOf(char: string): string {
  if (char.charCodeAt(0) < 0x80) return char.toLowerCase();
  let folded = "";
  for (const base of char.normalize("NFKD").replace(/\p{M}/gu, "")) folded += CONFUSABLES[base] ?? base.toLowerCase();
  return folded;
}
