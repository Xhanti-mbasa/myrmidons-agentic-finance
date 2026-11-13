import { z } from "zod";
import { isValidClassicAddress } from "ripple-address-codec";

/**
 * Control and invisible characters: C0/C1 controls (Cc), format characters such as zero-width spaces,
 * joiners, the BOM and bidi overrides (Cf), line/paragraph separators (Zl, Zp) and lone surrogates (Cs).
 * Zero-width and bidi characters let a lookalike name or reason render identically to a real one.
 */
const CONTROL_OR_INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u;
/** Characters that render as nothing but are not whitespace: Hangul fillers and the braille blank. */
const BLANK_LOOKALIKES = /[\s\u115F\u1160\u3164\uFFA0\u2800]/gu;
const hasVisibleText = (value: string) => value.replace(BLANK_LOOKALIKES, "").length > 0;
const noControlOrInvisible = (value: string) => !CONTROL_OR_INVISIBLE.test(value);

/**
 * An invoice number: ASCII letters and digits, then up to 63 of letters, digits, ".", "_", "/", "-".
 * ASCII only, so fullwidth and Cyrillic lookalikes can't pass as another invoice. Never use one as a file path.
 */
export const InvoiceNumber = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/, "invoice number must be 1-64 ASCII letters, digits or ._/- and start with a letter or digit");
export type InvoiceNumber = z.infer<typeof InvoiceNumber>;

/** A supplier ID issued by the backend: "sup_" plus 1-48 lower-case letters, digits or underscores. */
export const SupplierId = z.string().regex(/^sup_[a-z0-9_]{1,48}$/, "supplier ID must look like \"sup_karoo\"");
export type SupplierId = z.infer<typeof SupplierId>;

/**
 * A supplier's display name: 1-120 characters (Zod counts code points), any script, no control or
 * invisible characters, and already NFKC-normalised, so fullwidth lookalikes ("Ａcme"), ligatures and
 * decomposed accents are refused. The checks are refinements rather than a regex pattern, so they never
 * reach a model's JSON schema.
 */
export const SupplierName = z
  .string()
  .min(1)
  .max(120)
  .refine(hasVisibleText, "supplier name must not be blank")
  .refine(noControlOrInvisible, "supplier name must not contain control or invisible characters")
  .refine((value) => value.normalize("NFKC") === value, "supplier name must be NFKC-normalised (no fullwidth or compatibility characters)");
export type SupplierName = z.infer<typeof SupplierName>;

/** A one-line payment reason: 1-200 characters, no control or invisible characters, no "<" or ">". */
export const Reason = z
  .string()
  .min(1)
  .max(200)
  .refine(hasVisibleText, "reason must not be blank")
  .refine(noControlOrInvisible, "reason must not contain control or invisible characters")
  .refine((value) => !/[<>]/.test(value), "reason must not contain < or >");
export type Reason = z.infer<typeof Reason>;

/** ACCOUNT_ZERO, ACCOUNT_ONE and the NaN account. Valid checksums, but nobody holds their keys. */
const BLACK_HOLES = new Set(["rrrrrrrrrrrrrrrrrrrrrhoLvTp", "rrrrrrrrrrrrrrrrrrrrBZbvji", "rrrrrrrrrrrrrrrrrrrn5RM1rHd"]);

/**
 * A classic XRPL address whose base58 checksum is verified by ripple-address-codec (the xrpl.js codec).
 * X-addresses and the two black-hole accounts are refused.
 */
export const XrplAddress = z
  .string()
  .min(25)
  .max(35)
  .refine((value) => {
    try {
      return isValidClassicAddress(value);
    } catch {
      return false;
    }
  }, "not a valid classic XRPL address")
  .refine((value) => !BLACK_HOLES.has(value), "black-hole address");
export type XrplAddress = z.infer<typeof XrplAddress>;
