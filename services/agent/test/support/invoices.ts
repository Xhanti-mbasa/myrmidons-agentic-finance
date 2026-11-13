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

/** The invoice text behind the Atlas fields in agent-run tests (fixture 02), so they ground. */
export const ATLAS_INVOICE = `INVOICE
From: Atlas Freight Brokers, Mombasa
Invoice number: INV-7781
Date: 2026-11-11   Due: 2026-11-25
Bill to: Myrmidons Imports, Cape Town

Customs clearance fee    1 x 20.00    20.00
TOTAL DUE: 20.00 USD (payable in RLUSD)
Pay to XRPL address: rAtlasFreight22222222222222222`;

/** A Karoo invoice over the $50 cap, matching the over-cap fields in agent-run tests, so they ground. */
export const KAROO_OVER_CAP_INVOICE = `INVOICE
From: Karoo Textiles (Pty) Ltd, Lagos office
Invoice number: INV-2001
Date: 2026-11-11   Due: 2026-11-30
Bill to: Myrmidons Imports, Cape Town

Cotton bolts, natural    12 x 10.00    120.00
TOTAL DUE: 120.00 USD (payable in RLUSD)
Pay to XRPL address: rKarooTextilesExample1111111111`;
