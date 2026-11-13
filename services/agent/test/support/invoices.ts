export const KAROO_INVOICE = `INVOICE
From: Karoo Textiles (Pty) Ltd, Lagos office
Invoice number: INV-1042
Date: 2026-11-10   Due: 2026-11-20
Bill to: Myrmidons Imports, Cape Town

Cotton bolts, natural    3 x 10.00    30.00
TOTAL DUE: 30.00 USD (payable in RLUSD)
Pay to XRPL address: rKarooTextilesExample1111111111`;

export const KAROO_FIELDS = {
  supplierName: "Karoo Textiles",
  invoiceNumber: "INV-1042",
  amount: "30.00",
  currency: "USD",
  dueDate: "2026-11-20",
  lineItems: [{ description: "Cotton bolts, natural", amount: "30.00" }],
  payToAddressOnInvoice: "rKarooTextilesExample1111111111",
  suspiciousText: [] as string[],
};

/**
 * TEST-ONLY XRPL addresses. Checksum-valid so they pass XrplAddress, but nobody holds a key for them:
 * each is ripple-address-codec's encodeAccountID of a fixed 20-byte buffer, as noted. Never fund them.
 */
export const ATLAS_TEST_ADDRESS = "rEjdRNJWChUHPCirDV8QVuMC3ouRVd5Lxq"; // encodeAccountID(new Uint8Array(20).fill(0xa1))
export const ATTACKER_TEST_ADDRESS = "rHH1MJb32htjymP7c81ZTuq8sWXDeMN5Ak"; // encodeAccountID(new Uint8Array(20).fill(0xb2))
/** The same test-only account as a testnet X-address: classicAddressToXAddress(ATTACKER_TEST_ADDRESS, false, true). */
export const ATTACKER_TEST_X_ADDRESS = "TVJw37dMwrktFaToJ6sU7Lc3QBmwbZo2eadRm9iUTx7zdFe";

/**
 * The invoice text behind ATLAS_FIELDS, from a supplier the owner has not approved, so it grounds.
 * Like fixture 02, but its pay-to address is the checksum-valid test-only ATLAS_TEST_ADDRESS.
 */
export const ATLAS_INVOICE = `INVOICE
From: Atlas Freight Brokers, Mombasa
Invoice number: INV-7781
Date: 2026-11-11   Due: 2026-11-25
Bill to: Myrmidons Imports, Cape Town

Customs clearance fee    1 x 20.00    20.00
TOTAL DUE: 20.00 USD (payable in RLUSD)
Pay to XRPL address: ${ATLAS_TEST_ADDRESS}`;

export const ATLAS_FIELDS = {
  supplierName: "Atlas Freight Brokers",
  invoiceNumber: "INV-7781",
  amount: "20.00",
  currency: "USD",
  dueDate: "2026-11-25",
  lineItems: [{ description: "Customs clearance fee", amount: "20.00" }],
  payToAddressOnInvoice: ATLAS_TEST_ADDRESS as string | null,
  suspiciousText: [] as string[],
};

/** A Karoo invoice over the $50 cap, matching the over-cap fields in agent-run tests, so they ground. */
export const KAROO_OVER_CAP_INVOICE = `INVOICE
From: Karoo Textiles (Pty) Ltd, Lagos office
Invoice number: INV-2001
Date: 2026-11-11   Due: 2026-11-30
Bill to: Myrmidons Imports, Cape Town

Cotton bolts, natural    12 x 10.00    120.00
TOTAL DUE: 120.00 USD (payable in RLUSD)
Pay to XRPL address: rKarooTextilesExample1111111111`;

type FieldsForText = {
  supplierName: string;
  invoiceNumber: string;
  amount: string;
  lineItems: Array<{ description: string; amount: string }>;
  payToAddressOnInvoice: string | null;
  suspiciousText?: string[];
};

/**
 * Invoice text that grounds the given fields under T06 (one total line with the amount, the invoice
 * number, every supplier word, the address), so a test with custom fields reaches the planner.
 */
export function invoiceTextFor(fields: FieldsForText): string {
  return [
    "INVOICE",
    `From: ${fields.supplierName}`,
    `Invoice number: ${fields.invoiceNumber}`,
    "Bill to: Myrmidons Imports, Cape Town",
    "",
    ...fields.lineItems.map((item) => `${item.description}    ${item.amount}`),
    `TOTAL DUE: ${fields.amount} USD (payable in RLUSD)`,
    ...(fields.payToAddressOnInvoice === null ? [] : [`Pay to XRPL address: ${fields.payToAddressOnInvoice}`]),
    ...(fields.suspiciousText ?? []).map((text) => `Note: ${text}`),
  ].join("\n");
}
