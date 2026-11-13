import { extractText } from "unpdf";

/** Maximum decoded PDF size in bytes (2 MB). */
export const MAX_PDF_BYTES = 2 * 1024 * 1024;

/** Maximum allowed pages for automatic processing. */
export const MAX_PDF_PAGES = 5;

/** PDF extraction timeout in milliseconds (10 s). */
export const PDF_EXTRACTION_TIMEOUT_MS = 10_000;

/** Magic bytes at the beginning of a valid PDF document. */
export const PDF_MAGIC_BYTES = "%PDF-";

export class PdfTooLargeError extends Error {
  constructor(message = "The decoded PDF is over 2 MB.") {
    super(message);
    this.name = "PdfTooLargeError";
  }
}

export class InvalidPdfError extends Error {
  constructor(message = "The provided file does not appear to be a PDF.") {
    super(message);
    this.name = "InvalidPdfError";
  }
}

export type PdfExtractionResult =
  | { status: "ok"; text: string }
  | { status: "needs_review"; reason: string };

/**
 * Validates the raw base64-encoded PDF and decodes it.
 * Throws InvalidPdfError if the data is not valid base64 or does not start with %PDF-.
 * Throws PdfTooLargeError if the decoded byte length exceeds 2 MB.
 */
export function decodeAndValidatePdf(pdfBase64: string): Uint8Array {
  // Strip optional whitespace and validate base64 character set
  const trimmed = pdfBase64.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    throw new InvalidPdfError("The base64 payload is not well-formed.");
  }

  const buffer = Buffer.from(trimmed, "base64");
  if (buffer.byteLength > MAX_PDF_BYTES) {
    throw new PdfTooLargeError();
  }

  if (buffer.subarray(0, 5).toString("latin1") !== PDF_MAGIC_BYTES) {
    throw new InvalidPdfError();
  }

  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

/**
 * Extracts text from a PDF buffer using unpdf with mergePages behind a 10s timeout.
 * Returns needs_review for:
 * - PDFs with more than 5 pages
 * - PDFs with no text layer (e.g. empty or scans without OCR)
 * - Encrypted, password-protected, corrupted, or unreadable PDFs
 * - PDFs where extraction exceeds the 10 s timeout
 */
export async function extractPdfText(
  pdfData: Uint8Array,
  timeoutMs = PDF_EXTRACTION_TIMEOUT_MS,
): Promise<PdfExtractionResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Extraction timed out after 10 s"));
    }, timeoutMs);
  });

  try {
    const extractionPromise = extractText(pdfData, { mergePages: true });
    const result = await Promise.race([extractionPromise, timeoutPromise]);

    if (result.totalPages > MAX_PDF_PAGES) {
      return {
        status: "needs_review",
        reason: `The PDF has ${result.totalPages} pages, which exceeds the limit of ${MAX_PDF_PAGES} pages.`,
      };
    }

    const raw: string = result.text; // mergePages: true yields a single string
    if (raw.trim().length === 0) {
      return {
        status: "needs_review",
        reason: "The PDF contains no readable text layer. A person should review this invoice.",
      };
    }

    return { status: "ok", text: raw };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "needs_review",
      reason: `Could not read this PDF reliably (${message}).`,
    };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

