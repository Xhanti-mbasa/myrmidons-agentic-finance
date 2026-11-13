/**
 * Renders every fixtures/invoices/**.txt to fixtures/invoices/pdf/<same path>.pdf: a plain letterhead
 * taken from the invoice's From line, the invoice text in a monospace body, and a "sample" footer.
 * Output is byte-deterministic: no clock, fixed metadata dates, and no font embedding.
 *
 *   pnpm fixtures:pdf
 *
 * The .txt files are the canonical test inputs; the PDFs are for the demo video and PDF ingestion.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";

export const INVOICES_DIR = resolve(import.meta.dirname, "../fixtures/invoices");
export const PDF_DIR = join(INVOICES_DIR, "pdf");

/** Every PDF gets this creation and modification date, so a re-render is byte-identical. */
export const FIXED_DATE = new Date("2026-11-13T00:00:00.000Z");

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const BODY_SIZE = 10;
const LINE_HEIGHT = 13;
/** Courier is 0.6 em wide, so 80 columns at 10 pt is 480 pt, inside A4 less the margins. */
const COLUMNS = 80;
const FOOTER = "Sample invoice for the Shucamoxa demo on XRPL Testnet. Not a real invoice.";
const INK = rgb(0.1, 0.1, 0.1);
const GREY = rgb(0.45, 0.45, 0.45);

/**
 * The standard PDF fonts only draw WinAnsi characters. These are drawn as the nearest WinAnsi
 * look-alike instead; normaliseInvoiceText folds both forms to the same ASCII, so the attack survives.
 * Any other character outside WinAnsi stops the render rather than being dropped.
 */
const PDF_LOOKALIKES: Record<string, string> = { "＜": "‹", "＞": "›" };

/** Every invoice .txt under dir, as a "/"-separated relative path, sorted by code unit. Skips pdf/. */
export function listInvoiceTexts(dir = INVOICES_DIR, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && !(prefix === "" && entry.name === "pdf")) found.push(...listInvoiceTexts(join(dir, entry.name), `${prefix}${entry.name}/`));
    else if (entry.isFile() && entry.name.endsWith(".txt")) found.push(`${prefix}${entry.name}`);
  }
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function pdfPathFor(relativeTxt: string, pdfDir = PDF_DIR): string {
  return join(pdfDir, relativeTxt.replace(/\.txt$/, ".pdf"));
}

/** The supplier name and detail from the From line: "Karoo Textiles (Pty) Ltd" and "Lagos office". */
export function letterheadOf(text: string): { name: string; detail: string } {
  const from = /^From:[ \t]*(.+)$/m.exec(text)?.[1]?.trim();
  if (!from) return { name: "INVOICE", detail: "" };
  const comma = from.indexOf(",");
  return comma === -1 ? { name: from, detail: "" } : { name: from.slice(0, comma).trim(), detail: from.slice(comma + 1).trim() };
}

/** The text as drawn: LF line ends, tabs as spaces, and PDF_LOOKALIKES applied. */
export function pdfSafeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .replace(/[＜＞]/g, (char) => PDF_LOOKALIKES[char]!);
}

/** Splits a line into pieces of at most COLUMNS characters, at a space where there is one. */
function wrap(line: string): string[] {
  const pieces: string[] = [];
  let rest = [...line];
  while (rest.length > COLUMNS) {
    const space = rest.lastIndexOf(" ", COLUMNS);
    const cut = space > 0 ? space : COLUMNS;
    pieces.push(rest.slice(0, cut).join(""));
    rest = rest.slice(space > 0 ? cut + 1 : cut);
  }
  pieces.push(rest.join(""));
  return pieces;
}

function assertDrawable(text: string, font: PDFFont, title: string): void {
  const drawable = new Set(font.getCharacterSet());
  for (const char of text) {
    const codePoint = char.codePointAt(0)!;
    if (char !== "\n" && !drawable.has(codePoint)) {
      const hex = codePoint.toString(16).toUpperCase().padStart(4, "0");
      throw new Error(`${title}: U+${hex} cannot be drawn in the standard PDF fonts; add a look-alike to PDF_LOOKALIKES.`);
    }
  }
}

export async function renderInvoicePdf(text: string, title: string): Promise<Uint8Array> {
  // updateMetadata false: pdf-lib would otherwise stamp the current time and its own producer string.
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(title);
  doc.setSubject("Sample invoice fixture. Not a real invoice.");
  doc.setCreator("scripts/make-invoice-pdfs.ts");
  doc.setProducer("pdf-lib");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);

  const mono = await doc.embedFont(StandardFonts.Courier);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);

  const body = pdfSafeText(text).replace(/\n+$/, "");
  const { name, detail } = letterheadOf(body);
  assertDrawable(body, mono, title);
  assertDrawable(name + detail, bold, title);

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - MARGIN - 18;
  page.drawText(name, { x: MARGIN, y, size: 18, font: bold, color: INK });
  y -= 16;
  if (detail) {
    page.drawText(detail, { x: MARGIN, y, size: 10, font: sans, color: GREY });
    y -= 12;
  }
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A4[0] - MARGIN, y }, thickness: 0.75, color: GREY });
  y -= 28;

  for (const line of body.split("\n")) {
    for (const piece of wrap(line)) {
      if (y < MARGIN) {
        page = doc.addPage(A4);
        y = A4[1] - MARGIN - BODY_SIZE;
      }
      if (piece.trim() !== "") page.drawText(piece, { x: MARGIN, y, size: BODY_SIZE, font: mono, color: INK });
      y -= LINE_HEIGHT;
    }
  }

  // Last, so the drawing order (and any text extraction) reads letterhead, body, footer.
  for (const each of doc.getPages()) each.drawText(FOOTER, { x: MARGIN, y: MARGIN - 24, size: 7.5, font: sans, color: GREY });
  return doc.save({ useObjectStreams: false });
}

/** Renders every fixture and writes it under pdfDir. Returns the relative .txt paths rendered. */
export async function writeInvoicePdfs(invoicesDir = INVOICES_DIR, pdfDir = PDF_DIR): Promise<string[]> {
  const files = listInvoiceTexts(invoicesDir);
  for (const file of files) {
    const bytes = await renderInvoicePdf(readFileSync(join(invoicesDir, file), "utf8"), file);
    const out = pdfPathFor(file, pdfDir);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, bytes);
  }
  return files;
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const files = await writeInvoicePdfs();
  console.log(`Wrote ${files.length} invoice PDFs to fixtures/invoices/pdf/.`);
}
