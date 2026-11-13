import { describe, expect, it } from "vitest";
import { groundExtraction, type GroundedFields } from "../src/grounding";
import { normaliseInvoiceText } from "../src/normalise";
import { KAROO_FIELDS, KAROO_INVOICE } from "./support/invoices";
import {
  FIXTURE_FIELDS,
  listFixtureFiles,
  readFixture,
  UNGROUNDED_FIXTURE_FIELDS,
  type FixtureFile,
  type UngroundedFixtureFile,
} from "./support/fixture-fields";

const ground = (text: string, fields: Partial<GroundedFields> = {}) =>
  groundExtraction(normaliseInvoiceText(text), { ...KAROO_FIELDS, ...fields });

/** KAROO_INVOICE with its TOTAL line rewritten, and its single line item matched to the new total. */
const karooTotalling = (written: string) => {
  const norm = normaliseInvoiceText(written).replace(/[^0-9.,]/g, "").trim();
  const item = norm === "30" || norm === "30.0" ? "30.00" : norm;
  return KAROO_INVOICE.replace("TOTAL DUE: 30.00 USD", `TOTAL DUE: ${written} USD`).replace(
    "3 x 10.00    30.00",
    `1 x ${item}    ${item}`,
  );
};

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
    const text = "INVOICE\nFrom: Karoo Textiles\nInvoice number: INV-1042\nShipping 12.00\nCotton bolts 18.00\nAmount due: 30.00";
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

  it("covers every fixture .txt, including the five in 14-red-team-split/", () => {
    const covered = [...Object.keys(FIXTURE_FIELDS), ...Object.keys(UNGROUNDED_FIXTURE_FIELDS)].sort();
    expect(covered).toEqual(listFixtureFiles());
    expect(covered).toHaveLength(18);
  });
});

describe("red-team fixtures that grounding must send to a person", () => {
  it.each(Object.keys(UNGROUNDED_FIXTURE_FIELDS) as UngroundedFixtureFile[])("%s does not ground with its faithful fields", (file) => {
    const { fields, reason } = UNGROUNDED_FIXTURE_FIELDS[file];
    expect(groundExtraction(normaliseInvoiceText(readFixture(file)), fields)).toMatch(reason);
  });

  it("10: the line-item sum 45.00 does not ground either, because TOTAL DUE says 49.99", () => {
    const { fields } = UNGROUNDED_FIXTURE_FIELDS["10-red-team-total-mismatch.txt"];
    expect(groundExtraction(normaliseInvoiceText(readFixture("10-red-team-total-mismatch.txt")), { ...fields, amount: "45.00" })).toMatch(/amount/i);
  });

  it.each([
    ["11-red-team-template-tokens.txt", "900"],
    ["12-red-team-fullwidth-tag.txt", "900"],
  ] as const)("%s: the injected amount %s does not ground", (file, amount) => {
    expect(groundExtraction(normaliseInvoiceText(readFixture(file)), { ...FIXTURE_FIELDS[file], amount, lineItems: [] })).toMatch(/amount/i);
  });

  it("11 and 12: normalising removes the template tokens and the fullwidth tags", () => {
    const tokens = normaliseInvoiceText(readFixture("11-red-team-template-tokens.txt"));
    const tags = normaliseInvoiceText(readFixture("12-red-team-fullwidth-tag.txt"));
    expect(tokens).not.toMatch(/<\||\|>/);
    expect(tags).not.toMatch(/invoice[^-\s]*>|<\s*\/?\s*invoice/i);
    expect(tags).not.toMatch(/[＜＞]/);
  });

  it("13: an address that is not on the invoice does not ground", () => {
    const fields = { ...FIXTURE_FIELDS["13-red-team-address-change.txt"], payToAddressOnInvoice: "rXYZattackerWallet4444444444" };
    expect(groundExtraction(normaliseInvoiceText(readFixture("13-red-team-address-change.txt")), fields)).toMatch(/address/i);
  });
});

describe("T06b: the supplier name is grounded on the sender block only", () => {
  const fixture09 = () => normaliseInvoiceText(readFixture("09-red-team-impersonation.txt"));
  const fields09 = FIXTURE_FIELDS["09-red-team-impersonation.txt"];

  it("09: Zambezi Spices, named only in the notes, does not ground", () => {
    expect(groundExtraction(fixture09(), { ...fields09, supplierName: "Zambezi Spices" })).toMatch(/supplier/i);
  });

  it.each(["Karoo Textiles", "Karoo Textiles (Pty) Ltd"])("09: the real sender %s grounds", (supplierName) => {
    expect(groundExtraction(fixture09(), { ...fields09, supplierName })).toBeNull();
  });

  it("does not count a From: line written after the total, in the notes", () => {
    const text = `${KAROO_INVOICE}\nFrom: Zambezi Spices`;
    expect(ground(text, { supplierName: "Zambezi Spices" })).toMatch(/supplier/i);
    expect(ground(text)).toBeNull();
  });

  it("does not count the supplier words on the Bill to line", () => {
    expect(ground(KAROO_INVOICE, { supplierName: "Myrmidons Imports" })).toMatch(/supplier/i);
  });

  it("does not count the From: label itself as a supplier word", () => {
    expect(ground(KAROO_INVOICE, { supplierName: "From" })).toMatch(/supplier/i);
  });

  it("sends an invoice with two From: lines in its header to review, even for the first sender", () => {
    const text = KAROO_INVOICE.replace("Invoice number:", "From: Zambezi Spices Ltd\nInvoice number:");
    expect(ground(text, { supplierName: "Zambezi Spices" })).toMatch(/sender/i);
    expect(ground(text)).toMatch(/sender/i);
  });

  const LETTERHEAD = `Karoo Textiles (Pty) Ltd
14 Marina Road, Lagos
INVOICE
Invoice number: INV-1042
Bill to: Myrmidons Imports, Cape Town

Cotton bolts, natural    3 x 10.00    30.00
TOTAL DUE: 30.00 USD (payable in RLUSD)
Notes: please remit to Zambezi Spices
Pay to XRPL address: rKarooTextilesExample1111111111`;

  it("grounds on the letterhead lines before the first header when there is no From: line", () => {
    expect(ground(LETTERHEAD)).toBeNull();
    expect(ground(LETTERHEAD, { supplierName: "Zambezi Spices" })).toMatch(/supplier/i);
  });

  it("fails closed when a letterhead line ends in an amount, which ends the header before any To: or Invoice header", () => {
    expect(ground(LETTERHEAD.replace("14 Marina Road, Lagos", "14 Marina Road, Lagos, share capital 100.00"))).toMatch(/sender/i);
  });

  it("skips a bare INVOICE title above the letterhead", () => {
    expect(ground(`INVOICE\n${LETTERHEAD.replace("\nINVOICE\n", "\n")}`)).toBeNull();
  });

  it("ends the letterhead at a To: or remit-to line, so a supplier named there does not ground", () => {
    const text = LETTERHEAD.replace("14 Marina Road, Lagos\n", "14 Marina Road, Lagos\nRemit to: Zambezi Spices\n");
    expect(ground(text)).toBeNull();
    expect(ground(text, { supplierName: "Zambezi Spices" })).toMatch(/supplier/i);
    const plainTo = LETTERHEAD.replace("14 Marina Road, Lagos\n", "To: Zambezi Spices\n");
    expect(ground(plainTo, { supplierName: "Zambezi Spices" })).toMatch(/supplier|sender/i);
  });

  it.each([
    ["no From: line and no header after the letterhead", "Karoo Textiles (Pty) Ltd\nRef INV-1042\nCotton bolts    30.00\nTOTAL DUE: 30.00"],
    ["no From: line and nothing before the first header", "INVOICE\nInvoice number: INV-1042\nBill to: Myrmidons Imports, Karoo Textiles\nCotton bolts    30.00\nTOTAL DUE: 30.00"],
    ["the sender named only after the total", "Invoice number: INV-1042\nCotton bolts    30.00\nTOTAL DUE: 30.00\nKaroo Textiles (Pty) Ltd"],
  ])("fails closed to review when there is no sender block: %s", (_label, text) => {
    expect(ground(text, { payToAddressOnInvoice: null })).toMatch(/sender/i);
  });

  it("names no invoice text in the sender reasons", () => {
    const reasons = [
      ground(KAROO_INVOICE, { supplierName: "Myrmidons Imports" }),
      ground("INVOICE\nInvoice number: INV-1042\nBill to: Karoo\nTOTAL DUE: 30.00", { payToAddressOnInvoice: null, lineItems: [] }),
    ];
    for (const reason of reasons) {
      expect(reason).toEqual(expect.any(String));
      expect(reason).not.toMatch(/Karoo|Myrmidons|INV-1042|30\.00/);
    }
  });
});

describe("T06b: line items are checked against the invoice text", () => {
  const fixture10 = () => normaliseInvoiceText(readFixture("10-red-team-total-mismatch.txt"));
  const fields10 = UNGROUNDED_FIXTURE_FIELDS["10-red-team-total-mismatch.txt"].fields;

  it("10: no extracted line items does not ground, because the item lines sum to 45.00", () => {
    expect(groundExtraction(fixture10(), { ...fields10, lineItems: [] })).toMatch(/line items/i);
  });

  it("10: one invented 49.99 item does not ground", () => {
    expect(groundExtraction(fixture10(), { ...fields10, lineItems: [{ description: "Cotton and linen", amount: "49.99" }] })).toMatch(/line items/i);
  });

  it("sends a Karoo invoice whose item lines do not sum to the total to review, whatever the model returned", () => {
    const text = KAROO_INVOICE.replace("Cotton bolts, natural    3 x 10.00    30.00", "Cotton bolts, natural    3 x 10.00    30.00\nThread    5.00");
    expect(ground(text, { lineItems: [] })).toMatch(/line items/i);
    expect(ground(text)).toMatch(/line items/i);
  });

  it("rejects an extracted item amount that is on no item line, even when the sums agree", () => {
    const lineItems = [
      { description: "Cotton bolts", amount: "20.00" },
      { description: "Cotton bolts", amount: "10.00" },
    ];
    expect(ground(KAROO_INVOICE, { lineItems })).toMatch(/line items/i);
  });

  it("accepts extracted items whose amounts are on item lines and sum to the total", () => {
    const text = KAROO_INVOICE.replace("Cotton bolts, natural    3 x 10.00    30.00", "Cotton bolts    2 x 10.00    20.00\nThread    1 x 10.00    10.00");
    const lineItems = [
      { description: "Cotton bolts", amount: "20.00" },
      { description: "Thread", amount: "10.00" },
    ];
    expect(ground(text, { lineItems })).toBeNull();
    expect(ground(text, { lineItems: [] })).toBeNull();
  });

  it("does not count amounts after the first total line as items", () => {
    expect(ground(`${KAROO_INVOICE}\nLate fee after the due date    5.00`)).toBeNull();
  });

  it("stops the items at a VAT or tax line", () => {
    const text = KAROO_INVOICE.replace("TOTAL DUE:", "VAT (15%, included)    3.91\nTOTAL DUE:");
    expect(ground(text)).toBeNull();
    const tax = KAROO_INVOICE.replace("TOTAL DUE:", "Sales tax (included)    3.91\nTOTAL DUE:");
    expect(ground(tax)).toBeNull();
  });

  it("does not stop the items at a TAX INVOICE title or a VAT number in the header", () => {
    const text = readFixture("10-red-team-total-mismatch.txt")
      .replace("INVOICE\n", "TAX INVOICE\nVAT No: 4123456789\n");
    expect(groundExtraction(normaliseInvoiceText(text), { ...fields10, lineItems: [] })).toMatch(/line items/i);
  });

  it("sums item lines in integer cents, with thousands separators", () => {
    const text = KAROO_INVOICE.replace("Cotton bolts, natural    3 x 10.00    30.00", "Bolts    1,000.10\nThread    29.90")
      .replace("TOTAL DUE: 30.00", "TOTAL DUE: 1,030.00");
    expect(ground(text, { amount: "1030.00", lineItems: [] })).toBeNull();
    expect(ground(text.replace("29.90", "29.91"), { amount: "1030.00", lineItems: [] })).toMatch(/line items/i);
  });

  it("skips the sum check when the text has no item lines (07 and 08)", () => {
    for (const file of ["07-red-team-tag-escape.txt", "08-red-team-wrong-currency.txt"] as const) {
      expect(groundExtraction(normaliseInvoiceText(readFixture(file)), FIXTURE_FIELDS[file])).toBeNull();
    }
  });

  it("still rejects extracted line items when the text has no item lines", () => {
    const file = "07-red-team-tag-escape.txt";
    const fields = { ...FIXTURE_FIELDS[file], lineItems: [{ description: "Cotton", amount: "25.00" }] };
    expect(groundExtraction(normaliseInvoiceText(readFixture(file)), fields)).toMatch(/line items/i);
  });
});

describe("T06b review: the item sum cannot be skipped, credits are not ignored, and the real From: line counts", () => {
  const text10 = () => readFixture("10-red-team-total-mismatch.txt");
  const fields10 = { ...UNGROUNDED_FIXTURE_FIELDS["10-red-team-total-mismatch.txt"].fields, lineItems: [] };
  const ground10 = (text: string, amount = "49.99") => groundExtraction(normaliseInvoiceText(text), { ...fields10, amount });

  it.each([
    ["integer item amounts", (t: string) => t.replace("    20.00", "    20").replace("    25.00", "    25")],
    ["comma decimals", (t: string) => t.replace("    20.00", "    20,00").replace("    25.00", "    25,00")],
    ["a EUR suffix on the items", (t: string) => t.replace("    20.00", "    20.00 EUR").replace("    25.00", "    25.00 EUR")],
  ])("10 with %s goes to review: a line with a number before the total that is not a clean item line", (_label, edit) => {
    expect(ground10(edit(text10()))).toMatch(/neither a header nor/i);
  });

  it.each([
    ["RLUSD suffixes", (t: string) => t.replace("    20.00", "    20.00 RLUSD").replace("    25.00", "    25.00 RLUSD")],
    ["USD suffixes", (t: string) => t.replace("    20.00", "    20.00 USD").replace("    25.00", "    25.00 USD")],
    ["$ suffixes", (t: string) => t.replace("    20.00", "    20.00$").replace("    25.00", "    25.00$")],
    ["a column header naming the line total", (t: string) => t.replace("Cotton bolts", "Description   Qty   Unit   Line total\nCotton bolts")],
    ["a line mentioning total with no amount", (t: string) => t.replace("Cotton bolts", "Totally reliable delivery\nCotton bolts")],
    ["a bare Sub-total heading before the items", (t: string) => t.replace("Cotton bolts", "Sub-total\nCotton bolts")],
  ])("10 with %s is still sum-checked and goes to review", (_label, edit) => {
    expect(ground10(edit(text10()))).toMatch(/do not add up to its total/i);
  });

  it("still grounds a correct invoice whose item lines end in RLUSD", () => {
    const text = KAROO_INVOICE.replace("3 x 10.00    30.00", "3 x 10.00    30.00 RLUSD");
    expect(ground(text)).toBeNull();
    expect(ground(text.replace("30.00 RLUSD", "30.00 RLUSD\nThread    5.00 RLUSD"))).toMatch(/do not add up to its total/i);
  });

  it.each([
    ["VAT: 0.00 before the items", (t: string) => t.replace("Cotton bolts", "VAT: 0.00\nCotton bolts")],
    ["VAT rate 15.00 in the header", (t: string) => t.replace("Bill to:", "VAT rate 15.00\nBill to:")],
  ])("10 with %s goes to review: a priced line among the totals", (_label, edit) => {
    expect(ground10(edit(text10()))).toMatch(/among its totals/i);
  });

  it("10 with a priced Sub-total before the items goes to review, as an ambiguous total", () => {
    expect(ground10(text10().replace("Cotton bolts", "Sub-total 0.00\nCotton bolts"))).toMatch(/amount/i);
  });

  it.each([
    ["Discount   -4.99", "49.99", (t: string) => t.replace("TOTAL DUE: 49.99", "Discount   -4.99\nTOTAL DUE: 49.99")],
    ["Discount (4.99)", "45.00", (t: string) => t.replace("TOTAL DUE: 49.99", "Discount (4.99)\nTOTAL DUE: 45.00")],
    ["Credit note 4.99 CR", "45.00", (t: string) => t.replace("TOTAL DUE: 49.99", "Credit note 4.99 CR\nTOTAL DUE: 45.00")],
    ["Adjustment 4.99-", "45.00", (t: string) => t.replace("TOTAL DUE: 49.99", "Adjustment 4.99-\nTOTAL DUE: 45.00")],
    ["Handling 4.99 DR", "45.00", (t: string) => t.replace("TOTAL DUE: 49.99", "Handling 4.99 DR\nTOTAL DUE: 45.00")],
    ["Less: early payment    4.99", "45.00", (t: string) => t.replace("TOTAL DUE: 49.99", "Less: early payment    4.99\nTOTAL DUE: 45.00")],
    ["Refund of overpayment    4.99", "45.00", (t: string) => t.replace("TOTAL DUE: 49.99", "Refund of overpayment    4.99\nTOTAL DUE: 45.00")],
  ])("goes to review for a credit line %s before the total", (_label, amount, edit) => {
    expect(ground10(edit(text10()), amount)).toMatch(/discount, credit or negative/i);
  });

  it("goes to review for a negative VAT line among the totals", () => {
    expect(ground(KAROO_INVOICE.replace("TOTAL DUE:", "VAT adjustment    -3.91\nTOTAL DUE:"))).toMatch(/discount, credit or negative/i);
  });

  it("does not take a hyphenated date, invoice number or description for a minus sign", () => {
    const text = KAROO_INVOICE.replace("Cotton bolts, natural", "Cotton bolts, pre-washed");
    expect(ground(text)).toBeNull();
  });

  it("09: a sender block cut short above the real From: line goes to review", () => {
    const text = readFixture("09-red-team-impersonation.txt").replace("INVOICE\n", "INVOICE\nZambezi Spices\nInvoice ref\nHandling 0.00\n");
    const fields = FIXTURE_FIELDS["09-red-team-impersonation.txt"];
    expect(groundExtraction(normaliseInvoiceText(text), { ...fields, supplierName: "Zambezi Spices", lineItems: [] })).toMatch(/sender block/i);
    expect(groundExtraction(normaliseInvoiceText(text), fields)).toMatch(/sender block/i);
  });

  it("09: a From: line among the items goes to review", () => {
    const text = readFixture("09-red-team-impersonation.txt").replace("TOTAL DUE", "From: Zambezi Spices\nTOTAL DUE");
    expect(groundExtraction(normaliseInvoiceText(text), FIXTURE_FIELDS["09-red-team-impersonation.txt"])).toMatch(/sender block/i);
  });

  it("allows a VAT number and dates in the header", () => {
    const text = KAROO_INVOICE.replace("Invoice number:", "VAT No: 4123456789\nInvoice number:");
    expect(ground(text)).toBeNull();
  });

  it("goes to review for a header line that carries a money amount", () => {
    const text = KAROO_INVOICE.replace("Invoice number: INV-1042", "Invoice number: INV-1042 (deposit 4.99 paid)");
    expect(ground(text)).toMatch(/neither a header nor/i);
  });
});
