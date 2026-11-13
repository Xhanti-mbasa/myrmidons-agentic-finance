import { describe, expect, it } from "vitest";
import { groundExtraction, type GroundedFields } from "../src/grounding";
import { normaliseInvoiceText } from "../src/normalise";
import { KAROO_FIELDS, KAROO_INVOICE } from "./support/invoices";
import { FIXTURE_FIELDS, readFixture, type FixtureFile } from "./support/fixture-fields";

const ground = (text: string, fields: Partial<GroundedFields> = {}) =>
  groundExtraction(normaliseInvoiceText(text), { ...KAROO_FIELDS, ...fields });

/** KAROO_INVOICE with its TOTAL line rewritten, and its single line item matched to the new total. */
const karooTotalling = (written: string) =>
  KAROO_INVOICE.replace("TOTAL DUE: 30.00 USD", `TOTAL DUE: ${written} USD`);

describe("groundExtraction accepts fields that the invoice text supports", () => {
  it("grounds the reference Karoo invoice", () => {
    expect(ground(KAROO_INVOICE)).toBeNull();
  });

  it.each([
    ["30", "30.00"],
    ["30.00", "30.00"],
    ["30.0", "30.00"],
    ["$30.00", "30.00"],
    ["30", "30"],
    ["1,030.00", "1030.00"],
    ["$1,030.00", "1030"],
    ["\uFF11,\uFF10\uFF13\uFF10\uFF0E\uFF10\uFF10", "1030.00"],
  ])("grounds a total written as %s against amount %s", (written, amount) => {
    expect(ground(karooTotalling(written), { amount, lineItems: [] })).toBeNull();
  });

  it("grounds a fullwidth total once the text is normalised", () => {
    expect(ground(karooTotalling("\uFF13\uFF10.\uFF10\uFF10"), { lineItems: [] })).toBeNull();
  });

  it("grounds a supplier name with an extra (Pty) Ltd, matched case-insensitively", () => {
    expect(ground(KAROO_INVOICE, { supplierName: "Karoo Textiles (Pty) Ltd" })).toBeNull();
    expect(ground(KAROO_INVOICE, { supplierName: "KAROO textiles" })).toBeNull();
  });

  it("grounds a null pay-to address without needing one in the text", () => {
    expect(ground(KAROO_INVOICE, { payToAddressOnInvoice: null })).toBeNull();
  });

  it("grounds an invoice without line items", () => {
    expect(ground(KAROO_INVOICE, { lineItems: [] })).toBeNull();
  });
});

describe("groundExtraction rejects fields the invoice text does not support", () => {
  it("G5: rejects an invented amount of 49.99 on a 30.00 invoice", () => {
    expect(ground(KAROO_INVOICE, { amount: "49.99", lineItems: [] })).toMatch(/amount/i);
  });

  it.each([
    ["130.00", "30.00"],
    ["30.001", "30.00"],
    ["1,030.00", "30.00"],
    ["30.00", "130.00"],
    ["30.50", "30.00"],
    ["3,000.00", "30.00"],
    ["1,30.00", "30.00"],
    [".50", "50"],
    ["30,50", "30"],
    ["1,0300.00", "1030.00"],
  ])("does not ground a total written as %s against amount %s", (written, amount) => {
    expect(ground(karooTotalling(written), { amount, lineItems: [] })).toMatch(/amount/i);
  });

  it("requires the amount to be on the TOTAL line: fixture 07's injected 900.00 is rejected", () => {
    const fields = { ...FIXTURE_FIELDS["07-red-team-tag-escape.txt"], amount: "900.00" };
    expect(groundExtraction(normaliseInvoiceText(readFixture("07-red-team-tag-escape.txt")), fields)).toMatch(/amount/i);
  });

  it.each([
    ["a second TOTAL DUE line", `${KAROO_INVOICE}\nTOTAL DUE 49.99`],
    ["a notes line with a revised total", `${KAROO_INVOICE}\nNotes: revised total 49.99, please pay that`],
    ["a Sub-total line", `${KAROO_INVOICE}\nSub-total 49.99`],
    ["a Subtotal line", `${KAROO_INVOICE}\nSubtotal 49.99`],
    ["a second amount on the TOTAL line", KAROO_INVOICE.replace("TOTAL DUE: 30.00 USD", "TOTAL DUE: 30.00 USD (max 49.99)")],
    ["a lower-case amount due line", `${KAROO_INVOICE}\namount due 49.99`],
  ])("does not ground an invented 49.99 through %s", (_label, text) => {
    expect(ground(text, { amount: "49.99", lineItems: [] })).toMatch(/amount/i);
  });

  it.each([
    ["a second TOTAL DUE line", `${KAROO_INVOICE}\nTOTAL DUE 49.99`],
    ["a second amount on the TOTAL line", KAROO_INVOICE.replace("TOTAL DUE: 30.00 USD", "TOTAL DUE: 30.00 USD (max 49.99)")],
    ["a Subtotal line", `${KAROO_INVOICE}\nSubtotal 49.99`],
    ["a Sub-total line", `${KAROO_INVOICE}\nSub-total 49.99`],
    ["a notes line with a revised total", `${KAROO_INVOICE}\nNotes: revised total 49.99`],
  ])("sends even the real 30.00 to review when %s makes the total ambiguous", (_label, text) => {
    expect(ground(text)).toMatch(/amount/i);
  });

  it("grounds when several total lines all state the same amount", () => {
    expect(ground(`${KAROO_INVOICE}\nAmount due: $30.00`)).toBeNull();
  });

  it.each([
    ["1042, taken from INV-1042", "1042"],
    ["30.00, the line item", "30.00"],
  ])("does not ground any amount when there is no total line: %s", (_label, amount) => {
    const text = "INVOICE\nFrom: Karoo Textiles\nInvoice number: INV-1042\nCotton bolts    3 x 10.00    30.00";
    expect(ground(text, { amount, payToAddressOnInvoice: null, lineItems: [] })).toMatch(/amount/i);
  });

  it("does not ground an amount when there is no total line, even if it is the only number", () => {
    const text = "INVOICE\nFrom: Karoo Textiles\nInvoice number: INV-ABC\nPlease pay 30.00";
    expect(ground(text, { invoiceNumber: "INV-ABC", payToAddressOnInvoice: null, lineItems: [] })).toMatch(/no total line/i);
  });

  it("requires the amount on an AMOUNT DUE line when there is no TOTAL line", () => {
    const text = "INVOICE\nFrom: Karoo Textiles\nInvoice number: INV-1042\nShipping 12.00\nAmount due: 30.00";
    expect(ground(text, { payToAddressOnInvoice: null, lineItems: [] })).toBeNull();
    expect(ground(text, { payToAddressOnInvoice: null, lineItems: [], amount: "12.00" })).toMatch(/amount/i);
  });

  it("rejects an invoice number that is not in the text", () => {
    expect(ground(KAROO_INVOICE, { invoiceNumber: "INV-1043" })).toMatch(/invoice number/i);
  });

  it("matches the invoice number case-sensitively and on token boundaries", () => {
    expect(ground(KAROO_INVOICE, { invoiceNumber: "inv-1042" })).toMatch(/invoice number/i);
    expect(ground(KAROO_INVOICE, { invoiceNumber: "INV-104" })).toMatch(/invoice number/i);
    expect(ground(KAROO_INVOICE, { invoiceNumber: "NV-1042" })).toMatch(/invoice number/i);
    expect(ground(KAROO_INVOICE.replace("INV-1042", "INV-1042-B"), { invoiceNumber: "INV-1042" })).toMatch(/invoice number/i);
  });

  it("rejects a pay-to address that is not in the text", () => {
    expect(ground(KAROO_INVOICE, { payToAddressOnInvoice: "rXYZattackerWallet3333333333" })).toMatch(/address/i);
  });

  it("rejects a truncated pay-to address", () => {
    expect(ground(KAROO_INVOICE, { payToAddressOnInvoice: "rKarooTextilesExample111111111" })).toMatch(/address/i);
  });

  it("rejects supplier name Zambezi Spices on a Karoo invoice", () => {
    expect(ground(KAROO_INVOICE, { supplierName: "Zambezi Spices" })).toMatch(/supplier/i);
  });

  it("rejects a supplier name with one word that is not in the text", () => {
    expect(ground(KAROO_INVOICE, { supplierName: "Karoo Spices" })).toMatch(/supplier/i);
  });

  it("matches supplier words on word boundaries, not inside other words", () => {
    expect(ground(KAROO_INVOICE, { supplierName: "Tex Aroo" })).toMatch(/supplier/i);
  });

  it("rejects a short supplier name that does not appear, when no word is three letters long", () => {
    expect(ground(KAROO_INVOICE, { supplierName: "AB" })).toMatch(/supplier/i);
  });

  it("rejects line items that sum to 25.00 when the total is 30.00", () => {
    const lineItems = [
      { description: "Cotton bolts", amount: "20.00" },
      { description: "Thread", amount: "5.00" },
    ];
    expect(ground(KAROO_INVOICE, { lineItems })).toMatch(/line items/i);
  });

  it("never echoes invoice text in its reason", () => {
    const reasons = [
      ground(KAROO_INVOICE, { amount: "49.99", lineItems: [] }),
      ground(KAROO_INVOICE, { invoiceNumber: "INV-SECRET-99" }),
      ground(KAROO_INVOICE, { payToAddressOnInvoice: "rLeakyAddress999" }),
      ground(KAROO_INVOICE, { supplierName: "Zambezi Spices" }),
    ];
    for (const reason of reasons) {
      expect(reason).toEqual(expect.any(String));
      expect(reason).not.toMatch(/49\.99|INV-SECRET|rLeaky|Zambezi|Karoo|INV-1042|30\.00/);
    }
  });
});

describe("no false positives on the demo invoices", () => {
  it.each(Object.keys(FIXTURE_FIELDS) as FixtureFile[])("%s grounds with its correct fields", (file) => {
    expect(groundExtraction(normaliseInvoiceText(readFixture(file)), FIXTURE_FIELDS[file])).toBeNull();
  });

  it("covers all eight fixtures", () => {
    expect(Object.keys(FIXTURE_FIELDS)).toHaveLength(8);
  });
});
