import {
  Amount,
  LAST_LEDGER_WINDOW,
  MEMO_TYPE,
  RLUSD_CURRENCY_HEX,
  RLUSD_TESTNET_ISSUER,
  Sha256Hex,
  XRPL_TESTNET_WSS,
  XrplAddress,
  toHex,
} from "@shucamoxa/shared";
import type { Payment } from "xrpl";
import type { PreparedTransfer } from "../../payments/src/payment";

/** Construct only the permitted transaction shape. This does not grant signing authority. */
export function prepareTransfer(
  payment: PreparedTransfer,
  sequence: number,
  validatedLedger: number,
): Payment {
  if (
    payment.network !== XRPL_TESTNET_WSS ||
    payment.currency !== RLUSD_CURRENCY_HEX ||
    payment.issuer !== RLUSD_TESTNET_ISSUER
  )
    throw new Error("Only official Testnet RLUSD is supported");
  XrplAddress.parse(payment.sourceAddress);
  XrplAddress.parse(payment.destination);
  Amount.parse(payment.amount);
  Sha256Hex.parse(payment.auditHash);
  if (
    !Number.isSafeInteger(sequence) ||
    sequence <= 0 ||
    sequence > 0xffffffff ||
    !Number.isSafeInteger(validatedLedger) ||
    validatedLedger <= 0 ||
    validatedLedger + LAST_LEDGER_WINDOW > 0xffffffff ||
    (payment.destinationTag !== undefined &&
      (!Number.isInteger(payment.destinationTag) ||
        payment.destinationTag < 0 ||
        payment.destinationTag > 0xffffffff))
  )
    throw new Error("Invalid ledger sequence or destination tag");
  return {
    TransactionType: "Payment",
    Account: payment.sourceAddress,
    Destination: payment.destination,
    ...(payment.destinationTag === undefined
      ? {}
      : { DestinationTag: payment.destinationTag }),
    Amount: {
      currency: RLUSD_CURRENCY_HEX,
      issuer: RLUSD_TESTNET_ISSUER,
      value: payment.amount,
    },
    Fee: "100",
    Sequence: sequence,
    LastLedgerSequence: validatedLedger + LAST_LEDGER_WINDOW,
    Memos: [
      {
        Memo: {
          MemoType: toHex(MEMO_TYPE),
          MemoData: toHex(payment.auditHash),
        },
      },
    ],
  };
}
