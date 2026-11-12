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
