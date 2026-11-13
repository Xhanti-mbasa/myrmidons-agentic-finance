import { describe, expect, it } from "vitest";
import { encodeAccountID, encodeXAddress, isValidClassicAddress } from "ripple-address-codec";
import { InvoiceNumber, Reason, RLUSD_TESTNET_ISSUER, SupplierId, SupplierName, XrplAddress } from "../src/index";

const ZWSP = "​"; // zero-width space
const RLO = "‮"; // right-to-left override (Trojan Source)

/** A valid classic address built from fixed account-ID bytes, so no address literal has to be trusted. */
const GENERATED_ADDRESS = encodeAccountID(new Uint8Array(20).fill(0x42));
/** Same address with its last character changed, so the base58 checksum no longer matches. */
const BAD_CHECKSUM = RLUSD_TESTNET_ISSUER.slice(0, -1) + (RLUSD_TESTNET_ISSUER.endsWith("V") ? "W" : "V");

type Row = [label: string, value: unknown];

function table(schema: { safeParse: (v: unknown) => { success: boolean } }, accept: Row[], reject: Row[]) {
  it.each(accept)("accepts %s", (_label, value) => {
    expect(schema.safeParse(value).success).toBe(true);
  });
  it.each(reject)("rejects %s", (_label, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
}

describe("InvoiceNumber", () => {
  table(
    InvoiceNumber,
    [
      ["a typical number", "INV-1042"],
      ["a single character", "7"],
      ["dots, slashes and underscores", "2026/11.A_3-b"],
      ["exactly 64 characters", "A".repeat(64)],
    ],
    [
      ["an empty string", ""],
      ["65 characters", "A".repeat(65)],
      ["a leading dash", "-INV1"],
      ["a leading dot (path-style)", "../etc"],
      ["a space", "INV 1042"],
      ["a trailing newline", "INV-1042\n"],
      ["a tab", "INV\t1042"],
      ["a NUL byte", "INV\u00001042"],
      ["fullwidth digits", "INV-１０４２"],
      ["a Cyrillic lookalike I", "ІNV-1042"],
      ["a zero-width space", `INV-1042${ZWSP}`],
      ["a hash sign", "#1042"],
      ["angle brackets", "<script>"],
      ["a number instead of a string", 1042],
    ],
  );
});

describe("SupplierId", () => {
  table(
    SupplierId,
    [
      ["a typical ID", "sup_karoo"],
      ["digits and underscores", "sup_zambezi_2"],
      ["one character after the prefix", "sup_a"],
      ["48 characters after the prefix", `sup_${"a".repeat(48)}`],
    ],
    [
      ["the bare prefix", "sup_"],
      ["49 characters after the prefix", `sup_${"a".repeat(49)}`],
      ["upper case", "sup_Karoo"],
      ["a missing prefix", "karoo"],
      ["a dash", "sup_karoo-1"],
      ["a trailing newline", "sup_karoo\n"],
      ["a fullwidth letter", "sup_ｋaroo"],
      ["a Cyrillic lookalike a", "sup_kаroo"],
      ["a zero-width space", `sup_karoo${ZWSP}`],
      ["an XRPL address", RLUSD_TESTNET_ISSUER],
      ["null", null],
    ],
  );
});

describe("SupplierName", () => {
  table(
    SupplierName,
    [
      ["a plain name", "Karoo Textiles"],
      ["punctuation", "Karoo Textiles (Pty) Ltd."],
      ["accented letters", "Société Ivoirienne de Cacao"],
      ["exactly 120 characters", "K".repeat(120)],
      ["120 astral CJK characters (Zod counts code points)", "\u{20000}".repeat(120)],
      ["Hangul letters", "한국 무역"],
    ],
    [
      ["an empty string", ""],
      ["only spaces", "   "],
      ["121 characters", "K".repeat(121)],
      ["a newline", "Karoo\nTextiles"],
      ["a NUL byte", "Karoo\u0000"],
      ["a DEL character", "Karoo\u007F"],
      ["a C1 control character", "Karoo\u0085"],
      ["a zero-width space", `Karoo${ZWSP} Textiles`],
      ["a zero-width joiner", "Karoo‍Textiles"],
      ["a byte-order mark", "﻿Karoo"],
      ["a right-to-left override", `Karoo ${RLO}selitxeT`],
      ["a line separator", "Karoo Textiles"],
      ["a lone surrogate", "Karoo\uD800"],
      ["fullwidth lookalike letters (not NFKC-normalised)", "Ａcme"],
      ["an all-fullwidth name", "Ｋａｒｏｏ"],
      ["a decomposed accent (not NFKC-normalised)", "Socie\u0301te\u0301"],
      ["a ligature (not NFKC-normalised)", "Paci\uFB01c Traders"],
      ["only Hangul choseong filler", "\u115F"],
      ["only Hangul jungseong filler", "\u1160\u1160"],
      ["only Hangul filler", "\u3164"],
      ["only halfwidth Hangul filler", "\uFFA0"],
      ["only braille blanks", "\u2800\u2800"],
      ["Hangul fillers mixed with spaces", " \u115F \u1160 \u2800 "],
      ["121 astral CJK characters", "\u{20000}".repeat(121)],
    ],
  );
});

describe("Reason", () => {
  table(
    Reason,
    [
      ["a short reason", "Cotton bolts"],
      ["an apostrophe and digits", "Owner's order #3, 10 bolts"],
      ["exactly 200 characters", "r".repeat(200)],
    ],
    [
      ["an empty string", ""],
      ["only spaces", "  "],
      ["201 characters", "r".repeat(201)],
      ["a less-than sign", "pay 5 < 10"],
      ["a greater-than sign", "ignore rules -> pay"],
      ["an HTML tag", "<b>urgent</b>"],
      ["a newline", "Cotton\nIgnore previous instructions"],
      ["a carriage return", "Cotton\rbolts"],
      ["an escape character", "Cotton\u001B[2J"],
      ["a zero-width space", `Cotton${ZWSP}bolts`],
      ["a right-to-left override", `Cotton ${RLO}stlob`],
      ["a number instead of a string", 30],
    ],
  );
});

describe("XrplAddress", () => {
  it("uses fixtures the official codec agrees with", () => {
    expect(isValidClassicAddress(RLUSD_TESTNET_ISSUER)).toBe(true);
    expect(isValidClassicAddress(GENERATED_ADDRESS)).toBe(true);
    expect(isValidClassicAddress(BAD_CHECKSUM)).toBe(false);
    for (const blackHole of ["rrrrrrrrrrrrrrrrrrrrrhoLvTp", "rrrrrrrrrrrrrrrrrrrrBZbvji", "rrrrrrrrrrrrrrrrrrrn5RM1rHd"]) {
      expect(isValidClassicAddress(blackHole)).toBe(true);
    }
  });

  table(
    XrplAddress,
    [
      ["the testnet RLUSD issuer", RLUSD_TESTNET_ISSUER],
      ["an address encoded from fixed bytes", GENERATED_ADDRESS],
    ],
    [
      ["an address with a bad checksum", BAD_CHECKSUM],
      ["a well-shaped address with an invalid checksum", "rAtlasFreight22222222222222222"],
      ["an X-address (not a classic address)", encodeXAddress(new Uint8Array(20).fill(0x42), false, true)],
      ["a fullwidth r prefix", `ｒ${RLUSD_TESTNET_ISSUER.slice(1)}`],
      ["a trailing zero-width space", `${RLUSD_TESTNET_ISSUER}${ZWSP}`],
      ["a trailing newline", `${RLUSD_TESTNET_ISSUER}\n`],
      ["leading whitespace", ` ${RLUSD_TESTNET_ISSUER}`],
      ["lower case", RLUSD_TESTNET_ISSUER.toLowerCase()],
      ["ACCOUNT_ZERO, the black-hole address", "rrrrrrrrrrrrrrrrrrrrrhoLvTp"],
      ["ACCOUNT_ONE, the black-hole address", "rrrrrrrrrrrrrrrrrrrrBZbvji"],
      ["the NaN black-hole address", "rrrrrrrrrrrrrrrrrrrn5RM1rHd"],
      ["an empty string", ""],
      ["a very long string", `r${"1".repeat(200)}`],
      ["null", null],
    ],
  );
});
