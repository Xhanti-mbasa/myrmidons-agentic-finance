/** "RLUSD" as XRPL's 20-byte non-standard currency code, in hex. */
export const RLUSD_CURRENCY_HEX = "524C555344000000000000000000000000000000";

/** Ripple's RLUSD issuer on the XRPL Testnet. */
export const RLUSD_TESTNET_ISSUER = "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV";

/** Public XRPL Testnet WebSocket endpoint. Code that signs or submits must refuse any other network. */
export const XRPL_TESTNET_WSS = "wss://s.altnet.rippletest.net:51233";

/** MemoType of every Shucamoxa payment, before hex encoding (use toHex(MEMO_TYPE) on the ledger). */
export const MEMO_TYPE = "shucamoxa/log";

/** LastLedgerSequence may be at most this many ledgers ahead of the current one. */
export const LAST_LEDGER_WINDOW = 20;

/** Policy rate limit: at most `count` co-sign requests per `windowMs`. Frozen so no service can loosen it. */
export const RATE_LIMIT: Readonly<{ count: 5; windowMs: 60000 }> = Object.freeze({ count: 5, windowMs: 60000 } as const);

/** A budget reservation is released if not settled within this many milliseconds. */
export const RESERVATION_TTL_MS = 120000;

/** prevHash of the first audit log row: 64 zeros. */
export const GENESIS_HASH = "0".repeat(64);
