import { wordlist as BIP39_ENGLISH } from "@scure/bip39/wordlists/english.js";

export type Env = Record<string, string | undefined>;

/**
 * Names that belong to other services (wallets, policy, payment, database), never the agent or web frontend.
 * A name denylist always misses one, so this is a backstop: callers allowlist known safe names,
 * and every value is scanned for key shapes below. Case-insensitive because a lowercase `wallet_secret` is no safer.
 */
export const UNSAFE_ENV_NAME =
  /SEED|SECRET|MNEMONIC|PRIVATE|PASSWORD|PASSWD|(^|_)PASS($|_)|DATABASE|POSTGRES|^PG[A-Z]|SUPABASE|SERVICE_ROLE|XRPL_[A-Z_]*KEY$|(AGENT|OWNER|POLICY|TREASURY|WALLET|PAYMENT)_[A-Z_]*(KEY|TOKEN)$/i;

/**
 * Ordinary dev and container variables whose names match UNSAFE_ENV_NAME. Exact names only, and
 * only with the harmless values they take in practice (a number, or "random" for Python).
 */
export const BENIGN_NAME_VALUES: ReadonlyMap<string, RegExp> = new Map([
  ["PYTHONHASHSEED", /^(random|\d{1,10})$/],
  ["PGID", /^(random|\d{1,10})$/],
]);

/**
 * XRPL family seed: "s" plus 28 to 30 Ripple base58 characters (29 for secp256k1, 31 for ed25519 "sEd...").
 * Found anywhere in a value, but only as a whole token. Before it: not a letter, digit, "_" or "+", so
 * a slice of a GitHub token or a base64 blob doesn't match, while a seed after "/" (a URL path) or "-"
 * does. After it: not a letter, digit or token joiner ("_", "+", "-").
 */
const XRPL_SEED = /(?<![A-Za-z0-9_+])s[rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz]{28,30}(?![A-Za-z0-9_+-])/;

/** A 32-byte key in hex, optionally with a "0x" prefix and the XRPL "ED" (ed25519) or "00" (secp256k1) prefix. */
const HEX_KEY = /(?<![0-9A-Za-z])(?:0x)?(?:ED|00)?[0-9A-F]{64}(?![0-9A-Za-z])/i;
/** The same, but only with a prefix: what a bare 64-hex token must not look like. */
const PREFIXED_HEX_KEY = /(?<![0-9A-Za-z])(?:0x(?:ED|00)?|ED|00)[0-9A-F]{64}(?![0-9A-Za-z])/i;

/**
 * BIP39 mnemonic: a run of exactly 12, 15, 18, 21 or 24 words from the English wordlist. Words are
 * split on whitespace, commas, quotes and brackets, so a JSON array is caught too. Any other token
 * ends the run, so ordinary English (which needs "the", "a", "is"...) never gets close.
 */
const BIP39_WORDS: ReadonlySet<string> = new Set(BIP39_ENGLISH);
const MNEMONIC_LENGTHS: ReadonlySet<number> = new Set([12, 15, 18, 21, 24]);
const WORD_SEPARATORS = /[\s,"'`[\]{}()]+/;

const POSTGRES_URL = /postgres(?:ql)?(?:\+\w+)?:\/\//i;
const SUPABASE_SECRET_KEY = /\bsb_secret_/;

/** A JWT (header.payload.signature, base64url). Its payload is decoded and checked for service_role. */
const JWT = /eyJ[A-Za-z0-9_-]*\.(eyJ[A-Za-z0-9_-]*)\.[A-Za-z0-9_-]*/g;

/**
 * Returns what kind of secret the value holds, or undefined. The description never contains any
 * part of the value. `allowPlainHexToken` lets a bare 64-hex token through.
 */
export function findSecretInValue(value: string, options: { allowPlainHexToken?: boolean } = {}): string | undefined {
  for (const form of percentDecodings(value)) {
    const kind = findSecretInText(form, options);
    if (kind) return kind;
  }
  return undefined;
}

function findSecretInText(value: string, options: { allowPlainHexToken?: boolean }): string | undefined {
  if (XRPL_SEED.test(value)) return "an XRPL seed";
  if ((options.allowPlainHexToken ? PREFIXED_HEX_KEY : HEX_KEY).test(value)) return "a 64-hex private key";
  if (holdsMnemonic(value)) return "a wallet mnemonic";
  if (POSTGRES_URL.test(value)) return "a database connection URL";
  if (SUPABASE_SECRET_KEY.test(value)) return "a Supabase server key";
  if (holdsServiceRoleJwt(value)) return "a Supabase service-role JWT";
  return undefined;
}

/**
 * The value as given, then percent-decoded up to three times (for %253A-style double encoding).
 * Decodes byte by byte, so a malformed sequence can't throw.
 */
function percentDecodings(value: string): string[] {
  const forms = [value];
  let current = value;
  for (let i = 0; i < 3 && /%[0-9A-Fa-f]{2}/.test(current); i++) {
    current = current.replace(/%([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    forms.push(current);
  }
  return forms;
}

function holdsMnemonic(value: string): boolean {
  let run = 0;
  for (const token of value.split(WORD_SEPARATORS)) {
    if (BIP39_WORDS.has(token)) {
      run++;
      continue;
    }
    if (MNEMONIC_LENGTHS.has(run)) return true;
    run = 0;
  }
  return MNEMONIC_LENGTHS.has(run);
}

function holdsServiceRoleJwt(value: string): boolean {
  for (const match of value.matchAll(JWT)) {
    const payload = Buffer.from(match[1] ?? "", "base64url").toString("utf8");
    if (payload.includes("service_role")) return true;
  }
  return false;
}

export type EnvScanOptions = {
  /** Names exempt from the name pattern. Their values are still scanned. */
  allowedNames: readonly string[];
  /** Names whose value may be a bare 64-hex token. */
  tokenNames?: readonly string[];
  /** Prefix for error messages, such as "Agent config" or "Web config". */
  label?: string;
};

/**
 * Refuses an environment that holds a secret by name or by value. Reusable by any service that must
 * never hold wallet or database credentials. Errors name the variable and never echo any part of its value.
 */
export function refuseUnsafeEnv(env: Env, options: EnvScanOptions): void {
  const label = options.label ?? "Config";
  for (const [name, value] of Object.entries(env)) {
    const benign = BENIGN_NAME_VALUES.get(name);
    const allowed = options.allowedNames.includes(name) || (benign !== undefined && value !== undefined && benign.test(value));
    let reason: string | undefined;
    if (!allowed && UNSAFE_ENV_NAME.test(name)) reason = "its name marks it as a secret or database credential";
    else if (value !== undefined) {
      const kind = findSecretInValue(value, { allowPlainHexToken: options.tokenNames?.includes(name) ?? false });
      if (kind) reason = `its value looks like ${kind}`;
    }
    if (reason) {
      throw new Error(
        `${label}: the environment must not hold ${name} (${reason}). Wallet seeds, private keys and database credentials belong to other services.`,
      );
    }
  }
}
