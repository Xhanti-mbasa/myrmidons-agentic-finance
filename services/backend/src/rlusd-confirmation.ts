import { RLUSD_CURRENCY_HEX, RLUSD_TESTNET_ISSUER } from "@shucamoxa/shared";

/** Verify the ledger response, not a preliminary submission result. */
export function isConfirmedRlusdPayment(
  result: unknown,
  expected: { hash: string; sender: string; recipient: string },
): boolean {
  if (!result || typeof result !== "object") return false;
  const record = result as Record<string, unknown>;
  if (
    !record.tx_json ||
    typeof record.tx_json !== "object" ||
    !record.meta ||
    typeof record.meta !== "object"
  )
    return false;
  const tx = record.tx_json as Record<string, unknown>;
  const meta = record.meta as Record<string, unknown>;
  const isOneRlusd = (amount: unknown): boolean => {
    if (!amount || typeof amount !== "object") return false;
    const a = amount as Record<string, unknown>;
    return (
      a.currency === RLUSD_CURRENCY_HEX &&
      a.issuer === RLUSD_TESTNET_ISSUER &&
      typeof a.value === "string" &&
      /^1(?:\.0+)?$/.test(a.value)
    );
  };
  return (
    record.validated === true &&
    record.hash === expected.hash &&
    meta.TransactionResult === "tesSUCCESS" &&
    tx.TransactionType === "Payment" &&
    tx.Account === expected.sender &&
    tx.Destination === expected.recipient &&
    tx.Paths === undefined &&
    tx.SendMax === undefined &&
    tx.DeliverMin === undefined &&
    (tx.Flags === undefined ||
      (typeof tx.Flags === "number" && (tx.Flags & 0x00020000) === 0)) &&
    isOneRlusd(tx.DeliverMax ?? tx.Amount) &&
    isOneRlusd(meta.delivered_amount)
  );
}
