/** Check only public, validated ledger evidence for this exact signed transaction. */
export function isConfirmedPayment(result: unknown, expected: { hash: string; sender: string; recipient: string }): boolean {
  if (!result || typeof result !== "object") return false;
  const record = result as Record<string, unknown>;
  const tx = record.tx_json;
  const meta = record.meta;
  if (!tx || typeof tx !== "object" || !meta || typeof meta !== "object") return false;
  const payment = tx as Record<string, unknown>;
  const metadata = meta as Record<string, unknown>;
  return record.validated === true && record.hash === expected.hash &&
    metadata.TransactionResult === "tesSUCCESS" && metadata.delivered_amount === "1000000" &&
    payment.TransactionType === "Payment" && payment.Account === expected.sender &&
    payment.Destination === expected.recipient &&
    (payment.DeliverMax ?? payment.Amount) === "1000000";
}
