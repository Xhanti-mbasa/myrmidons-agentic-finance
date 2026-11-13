import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  Client,
  Wallet,
  multisign,
  decodeAccountID,
  type AccountSet,
  type Payment,
  type SignerListSet,
  type TrustSet,
} from "xrpl";
import {
  RLUSD_CURRENCY_HEX,
  RLUSD_TESTNET_ISSUER,
  XRPL_TESTNET_WSS,
  LAST_LEDGER_WINDOW,
} from "@shucamoxa/shared";

/** Allowed Testnet URLs. Signing or setup must refuse any other network. */
export const TESTNET_URL_ALLOWLIST: readonly string[] = Object.freeze([
  XRPL_TESTNET_WSS,
  "wss://testnet.xrpl-labs.com",
]);

/** The 3 allowed paths where writeServiceEnv can write env files. */
export const ALLOWED_ENV_PATHS: readonly string[] = Object.freeze([
  "services/payment/.env",
  "services/policy/.env",
  "secrets/owner-dev.env",
]);

/**
 * Validates that an endpoint URL and optional server_info represent XRPL Testnet.
 * Refuses mainnet, devnet, and any other network.
 */
export function assertTestnet(url: string, serverInfo?: unknown): void {
  const trimmedUrl = url.trim();
  if (!TESTNET_URL_ALLOWLIST.includes(trimmedUrl)) {
    throw new Error(`assertTestnet: URL "${trimmedUrl}" is not on the testnet allowlist`);
  }

  if (serverInfo !== undefined) {
    let networkId: unknown;
    if (typeof serverInfo === "number") {
      networkId = serverInfo;
    } else if (typeof serverInfo === "object" && serverInfo !== null) {
      const rec = serverInfo as Record<string, unknown>;
      if (typeof rec.network_id === "number") {
        networkId = rec.network_id;
      } else if (typeof rec.info === "object" && rec.info !== null) {
        networkId = (rec.info as Record<string, unknown>).network_id;
      } else if (typeof rec.result === "object" && rec.result !== null) {
        const res = rec.result as Record<string, unknown>;
        if (typeof res.network_id === "number") {
          networkId = res.network_id;
        } else if (typeof res.info === "object" && res.info !== null) {
          networkId = (res.info as Record<string, unknown>).network_id;
        }
      }
    }

    if (networkId !== 1) {
      throw new Error(`assertTestnet: server_info network_id must be 1 for Testnet, got ${String(networkId)}`);
    }
  }
}

/**
 * Pure builder for a TrustSet transaction for RLUSD.
 */
export function buildTrustSet(
  accountOrOpts: string | { account: string; limit?: string; currency?: string; issuer?: string },
  limitArg?: string,
): TrustSet {
  const account = typeof accountOrOpts === "string" ? accountOrOpts : accountOrOpts.account;
  const val = typeof accountOrOpts === "string" ? (limitArg ?? "1000000000") : (accountOrOpts.limit ?? limitArg ?? "1000000000");
  const currency = typeof accountOrOpts === "object" && accountOrOpts.currency ? accountOrOpts.currency : RLUSD_CURRENCY_HEX;
  const issuer = typeof accountOrOpts === "object" && accountOrOpts.issuer ? accountOrOpts.issuer : RLUSD_TESTNET_ISSUER;

  return {
    TransactionType: "TrustSet",
    Account: account,
    LimitAmount: {
      currency,
      issuer,
      value: val,
    },
  };
}

/**
 * Pure builder for a SignerListSet transaction.
 * Quorum 2; agent weight 1, policy weight 1, owner weight 2.
 * Signer entries are sorted in ascending order of decoded account ID per XRPL spec.
 */
export function buildSignerListSet(
  signers: { agent: string; policy: string; owner: string; treasury?: string },
  treasury?: string,
): SignerListSet {
  const account = treasury ?? signers.treasury;

  const rawEntries = [
    { SignerEntry: { Account: signers.agent, SignerWeight: 1 } },
    { SignerEntry: { Account: signers.policy, SignerWeight: 1 } },
    { SignerEntry: { Account: signers.owner, SignerWeight: 2 } },
  ];

  const sortedEntries = [...rawEntries].sort((a, b) => {
    try {
      const bufA = decodeAccountID(a.SignerEntry.Account);
      const bufB = decodeAccountID(b.SignerEntry.Account);
      return Buffer.compare(bufA, bufB);
    } catch {
      return a.SignerEntry.Account.localeCompare(b.SignerEntry.Account);
    }
  });

  return {
    TransactionType: "SignerListSet",
    ...(account ? { Account: account } : {}),
    SignerQuorum: 2,
    SignerEntries: sortedEntries,
  } as unknown as SignerListSet;
}

/**
 * Pure builder for AccountSet transaction with asfDisableMaster (4).
 */
export function buildDisableMaster(
  accountOrOpts?: string | { account?: string },
): AccountSet {
  const account = typeof accountOrOpts === "string" ? accountOrOpts : accountOrOpts?.account;

  return {
    TransactionType: "AccountSet",
    ...(account ? { Account: account } : {}),
    SetFlag: 4, // asfDisableMaster
  } as unknown as AccountSet;
}

/**
 * Normalizes relative path using POSIX forward slashes.
 */
function normalizeRelativePath(relPath: string): string {
  return relPath.replace(/^[./\\]+/, "").replace(/\\/g, "/");
}

/**
 * Writes an environment file with mode 0600.
 * Refuses overwrite without force flag.
 * Refuses any path other than the 3 allowed paths:
 *   - services/payment/.env
 *   - services/policy/.env
 *   - secrets/owner-dev.env
 */
export function writeServiceEnv(
  targetRelPath: string,
  envVars: Record<string, string> | string,
  options?: { force?: boolean; repoRoot?: string },
): void {
  const root = resolve(options?.repoRoot ?? process.cwd());
  const normalizedRel = normalizeRelativePath(
    relative(root, resolve(root, targetRelPath))
  );

  if (!ALLOWED_ENV_PATHS.includes(normalizedRel)) {
    throw new Error(`writeServiceEnv: path not allowed: "${normalizedRel}". Allowed paths: ${ALLOWED_ENV_PATHS.join(", ")}`);
  }

  const fullPath = join(root, normalizedRel);

  if (existsSync(fullPath) && !options?.force) {
    throw new Error(`writeServiceEnv: file already exists: "${fullPath}" (use force: true to overwrite)`);
  }

  mkdirSync(dirname(fullPath), { recursive: true });

  let content: string;
  if (typeof envVars === "string") {
    content = envVars.endsWith("\n") ? envVars : `${envVars}\n`;
  } else {
    content = Object.entries(envVars)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n";
  }

  writeFileSync(fullPath, content, { mode: 0o600 });
  try {
    chmodSync(fullPath, 0o600);
  } catch {
    // Ignore chmod failure on non-POSIX platforms where not supported
  }
}

export interface SetupState {
  endpoint: string;
  accounts: {
    treasury: { address: string; seed: string };
    agent: { address: string; seed: string };
    policy: { address: string; seed: string };
    owner: { address: string; seed: string };
    supplierA: { address: string; seed: string };
    supplierB: { address: string; seed: string };
    unknownSupplier: { address: string; seed: string };
  };
  funded: {
    treasury: boolean;
    agent: boolean;
    policy: boolean;
    owner: boolean;
    supplierA: boolean;
    supplierB: boolean;
    unknownSupplier: boolean;
  };
  trustlines: {
    treasury: boolean;
    supplierA: boolean;
    supplierB: boolean;
    unknownSupplier: boolean;
  };
  treasuryRlusdFunded: boolean;
  signerListSet: boolean;
  signerListConfirmed: boolean;
  masterDisabled: boolean;
  masterDisabledProven: boolean;
  evidencePayment?: {
    hash: string;
    status: string;
  };
  envFilesWritten: boolean;
}

export interface SetupTreasuryOptions {
  dryRun?: boolean;
  endpoint?: string;
  repoRoot?: string;
  force?: boolean;
  client?: Client;
  mockWallets?: Record<string, { address: string; seed: string }>;
  skipHumanStep?: boolean;
  logger?: {
    log: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

/**
 * Core orchestrator for treasury setup.
 */
export async function setupTreasury(options?: SetupTreasuryOptions): Promise<{
  state: SetupState;
  output: Record<string, string>;
}> {
  const dryRun = options?.dryRun ?? false;
  const endpoint = options?.endpoint ?? XRPL_TESTNET_WSS;
  const root = resolve(options?.repoRoot ?? process.cwd());
  const force = options?.force ?? false;
  const log = options?.logger?.log ?? console.log;
  const logErr = options?.logger?.error ?? console.error;

  assertTestnet(endpoint);

  const secretsDir = join(root, "secrets");
  mkdirSync(secretsDir, { recursive: true });
  const statePath = join(secretsDir, "setup-state.json");
  const outputPath = join(secretsDir, "setup-output.json");

  // Load existing state if resumable
  let state: SetupState;
  if (existsSync(statePath) && !force) {
    try {
      state = JSON.parse(readFileSync(statePath, "utf8")) as SetupState;
    } catch {
      state = initEmptyState(endpoint, options?.mockWallets);
    }
  } else {
    state = initEmptyState(endpoint, options?.mockWallets);
  }

  function saveState(): void {
    writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
    try {
      chmodSync(statePath, 0o600);
    } catch {
      // Ignored if chmod fails on Windows
    }
  }

  saveState();

  const accounts = state.accounts;

  if (dryRun) {
    log("[dry-run] Treasury setup plan:");
    log(`  Treasury:         ${accounts.treasury.address}`);
    log(`  Agent:            ${accounts.agent.address}`);
    log(`  Policy:           ${accounts.policy.address}`);
    log(`  Owner:            ${accounts.owner.address}`);
    log(`  Supplier A:       ${accounts.supplierA.address}`);
    log(`  Supplier B:       ${accounts.supplierB.address}`);
    log(`  Unknown Supplier: ${accounts.unknownSupplier.address}`);
    log(`  Signer Quorum:    2 (agent weight 1, policy weight 1, owner weight 2)`);
    log(`  Master key:       Disable via asfDisableMaster (4)`);
    log(`  Evidence payment: 1.00 RLUSD to Supplier A`);

    writeServiceEnv("services/payment/.env", { AGENT_SEED: accounts.agent.seed }, { repoRoot: root, force: true });
    writeServiceEnv("services/policy/.env", { POLICY_SEED: accounts.policy.seed }, { repoRoot: root, force: true });
    writeServiceEnv("secrets/owner-dev.env", { OWNER_DEV_SEED: accounts.owner.seed }, { repoRoot: root, force: true });

    const output: Record<string, string> = {
      treasury: accounts.treasury.address,
      agent: accounts.agent.address,
      policy: accounts.policy.address,
      owner: accounts.owner.address,
      supplierA: accounts.supplierA.address,
      supplierB: accounts.supplierB.address,
      unknownSupplier: accounts.unknownSupplier.address,
    };
    writeFileSync(outputPath, JSON.stringify(output, null, 2));

    return { state, output };
  }

  // Live execution
  const client = options?.client ?? new Client(endpoint, { timeout: 30000 });
  let connectedByUs = false;

  try {
    if (!client.isConnected()) {
      await client.connect();
      connectedByUs = true;
    }

    const serverInfo = await client.request({ command: "server_info" });
    assertTestnet(endpoint, serverInfo);

    // Reconstruct wallets from seeds
    const treasuryWallet = Wallet.fromSeed(accounts.treasury.seed);
    const agentWallet = Wallet.fromSeed(accounts.agent.seed);
    const policyWallet = Wallet.fromSeed(accounts.policy.seed);
    const ownerWallet = Wallet.fromSeed(accounts.owner.seed);
    const suppAWallet = Wallet.fromSeed(accounts.supplierA.seed);
    const suppBWallet = Wallet.fromSeed(accounts.supplierB.seed);
    const suppUnkWallet = Wallet.fromSeed(accounts.unknownSupplier.seed);

    const allWallets: Record<keyof SetupState["funded"], Wallet> = {
      treasury: treasuryWallet,
      agent: agentWallet,
      policy: policyWallet,
      owner: ownerWallet,
      supplierA: suppAWallet,
      supplierB: suppBWallet,
      unknownSupplier: suppUnkWallet,
    };

    // 1. Fund all 7 accounts from faucet if not yet funded
    for (const [name, wallet] of Object.entries(allWallets) as Array<[keyof SetupState["funded"], Wallet]>) {
      if (!state.funded[name]) {
        log(`Funding ${name} (${wallet.address}) from Testnet faucet...`);
        await client.fundWallet(wallet);
        state.funded[name] = true;
        saveState();
      }
    }

    // 2. Set RLUSD trustlines on treasury, supplier A, supplier B, and unknown supplier
    const trustlineWallets: Record<keyof SetupState["trustlines"], Wallet> = {
      treasury: treasuryWallet,
      supplierA: suppAWallet,
      supplierB: suppBWallet,
      unknownSupplier: suppUnkWallet,
    };

    for (const [name, wallet] of Object.entries(trustlineWallets) as Array<[keyof SetupState["trustlines"], Wallet]>) {
      if (!state.trustlines[name]) {
        log(`Setting RLUSD trustline on ${name} (${wallet.address})...`);
        const trustTx = buildTrustSet(wallet.address, "1000000000");
        const prepared = await client.autofill(trustTx);
        const signed = wallet.sign(prepared);
        const res = await client.submitAndWait(signed.tx_blob);
        const code = typeof res.result.meta === "object" && res.result.meta ? res.result.meta.TransactionResult : undefined;
        if (code !== "tesSUCCESS") {
          throw new Error(`Failed to set RLUSD trustline on ${name}: result ${String(code)}`);
        }
        state.trustlines[name] = true;
        saveState();
      }
    }

    // 3. Human step: claim test RLUSD at tryrlusd.com for treasury
    if (!state.treasuryRlusdFunded && !options?.skipHumanStep) {
      log("\n=======================================================");
      log("ACTION REQUIRED (Human step):");
      log(`Claim test RLUSD for treasury at https://tryrlusd.com`);
      log(`Treasury Address: ${treasuryWallet.address}`);
      log("Polling account_lines until RLUSD balance appears...");
      log("=======================================================\n");

      let hasBalance = false;
      while (!hasBalance) {
        const linesRes = await client.request({
          command: "account_lines",
          account: treasuryWallet.address,
          peer: RLUSD_TESTNET_ISSUER,
          ledger_index: "validated",
        });

        const lines = linesRes.result.lines;
        for (const line of lines) {
          if (
            (line.currency === RLUSD_CURRENCY_HEX || line.currency === "RLUSD") &&
            Number(line.balance) > 0
          ) {
            hasBalance = true;
            log(`Detected RLUSD balance for treasury: ${line.balance}`);
            break;
          }
        }

        if (!hasBalance) {
          await new Promise((r) => setTimeout(r, 4000));
        }
      }

      state.treasuryRlusdFunded = true;
      saveState();
    }

    // 4. SignerListSet: quorum 2; agent weight 1, policy weight 1, owner weight 2
    if (!state.signerListSet) {
      log(`Submitting SignerListSet on treasury (${treasuryWallet.address})...`);
      const signerTx = buildSignerListSet({
        agent: agentWallet.address,
        policy: policyWallet.address,
        owner: ownerWallet.address,
        treasury: treasuryWallet.address,
      });

      const prepared = await client.autofill(signerTx);
      const signed = treasuryWallet.sign(prepared);
      const res = await client.submitAndWait(signed.tx_blob);
      const code = typeof res.result.meta === "object" && res.result.meta ? res.result.meta.TransactionResult : undefined;
      if (code !== "tesSUCCESS") {
        throw new Error(`SignerListSet failed: result ${String(code)}`);
      }
      state.signerListSet = true;
      saveState();
    }

    // 5. Confirm list through account_objects before disabling master key
    if (!state.signerListConfirmed) {
      log("Confirming SignerList through account_objects...");
      const objectsRes = await client.request({
        command: "account_objects",
        account: treasuryWallet.address,
        type: "signer_list",
        ledger_index: "validated",
      });

      const listObj = objectsRes.result.account_objects.find(
        (obj: { LedgerEntryType?: string }) => obj.LedgerEntryType === "SignerList"
      );

      if (!listObj) {
        throw new Error("SignerList not found in account_objects for treasury");
      }
      state.signerListConfirmed = true;
      saveState();
      log("SignerList confirmed on ledger.");
    }

    // 6. AccountSet with asfDisableMaster (4)
    if (!state.masterDisabled) {
      log("Disabling treasury master key via AccountSet (asfDisableMaster)...");
      const disableTx = buildDisableMaster(treasuryWallet.address);
      const prepared = await client.autofill(disableTx);
      const signed = treasuryWallet.sign(prepared);
      const res = await client.submitAndWait(signed.tx_blob);
      const code = typeof res.result.meta === "object" && res.result.meta ? res.result.meta.TransactionResult : undefined;
      if (code !== "tesSUCCESS") {
        throw new Error(`AccountSet (asfDisableMaster) failed: result ${String(code)}`);
      }
      state.masterDisabled = true;
      saveState();
      log("Treasury master key disabled.");
    }

    // 7. Prove master key is disabled: single-signed payment with master key must be rejected
    if (!state.masterDisabledProven) {
      log("Proving master key is disabled by attempting single-signed payment...");
      const testPayment: Payment = {
        TransactionType: "Payment",
        Account: treasuryWallet.address,
        Destination: suppAWallet.address,
        Amount: "1000",
      };
      const prepared = await client.autofill(testPayment);
      const signed = treasuryWallet.sign(prepared);
      const res = await client.submit(signed.tx_blob);
      const engineResult = res.result.engine_result;

      if (engineResult !== "tefMASTER_DISABLED") {
        throw new Error(`Expected tefMASTER_DISABLED for single-signed master payment, got: ${String(engineResult)}`);
      }
      log(`Master key disable confirmed by ledger: ${engineResult}`);
      state.masterDisabledProven = true;
      saveState();
    }

    // 8. Send one 1.00 RLUSD multisigned payment (agent + policy) to supplier A
    if (!state.evidencePayment) {
      log("Sending 1.00 RLUSD multisigned payment (agent + policy) to supplier A...");
      const currentLedger = await client.getLedgerIndex();
      const accountInfo = await client.request({
        command: "account_info",
        account: treasuryWallet.address,
        ledger_index: "validated",
      });

      const multisigTx: Payment = {
        TransactionType: "Payment",
        Account: treasuryWallet.address,
        Destination: suppAWallet.address,
        Amount: {
          currency: RLUSD_CURRENCY_HEX,
          issuer: RLUSD_TESTNET_ISSUER,
          value: "1",
        },
        Fee: "100",
        Sequence: accountInfo.result.account_data.Sequence,
        LastLedgerSequence: currentLedger + LAST_LEDGER_WINDOW,
        SigningPubKey: "",
      };

      const agentSigned = agentWallet.sign(multisigTx, true);
      const policySigned = policyWallet.sign(multisigTx, true);
      const multisignedTxBlob = multisign([agentSigned.tx_blob, policySigned.tx_blob]);

      const submitRes = await client.submitAndWait(multisignedTxBlob);
      const code = typeof submitRes.result.meta === "object" && submitRes.result.meta ? submitRes.result.meta.TransactionResult : undefined;
      if (code !== "tesSUCCESS") {
        throw new Error(`Multisigned RLUSD payment failed: ${String(code)}`);
      }

      const txHash = submitRes.result.hash;
      const explorerUrl = `https://testnet.xrpl.org/transactions/${txHash}`;
      log(`Evidence transaction hash: ${txHash}`);
      log(`Testnet explorer: ${explorerUrl}`);

      state.evidencePayment = {
        hash: txHash,
        status: "validated",
      };
      saveState();
    }

    // 9. Write seed env files with mode 0600
    writeServiceEnv("services/payment/.env", { AGENT_SEED: accounts.agent.seed }, { repoRoot: root, force: true });
    writeServiceEnv("services/policy/.env", { POLICY_SEED: accounts.policy.seed }, { repoRoot: root, force: true });
    writeServiceEnv("secrets/owner-dev.env", { OWNER_DEV_SEED: accounts.owner.seed }, { repoRoot: root, force: true });
    state.envFilesWritten = true;
    saveState();

    // 10. Write addresses & evidence hash to secrets/setup-output.json (no seeds)
    const output: Record<string, string> = {
      treasury: accounts.treasury.address,
      agent: accounts.agent.address,
      policy: accounts.policy.address,
      owner: accounts.owner.address,
      supplierA: accounts.supplierA.address,
      supplierB: accounts.supplierB.address,
      unknownSupplier: accounts.unknownSupplier.address,
      evidenceTxHash: state.evidencePayment?.hash ?? "",
      explorerUrl: state.evidencePayment?.hash
        ? `https://testnet.xrpl.org/transactions/${state.evidencePayment.hash}`
        : "",
    };
    writeFileSync(outputPath, JSON.stringify(output, null, 2));

    log("\nTreasury setup completed successfully!");
    log(`Output written to: ${outputPath}`);

    return { state, output };
  } finally {
    if (connectedByUs && client.isConnected()) {
      try {
        await client.disconnect();
      } catch {
        logErr("Failed to disconnect XRPL client cleanly");
      }
    }
  }
}

function initEmptyState(
  endpoint: string,
  mockWallets?: Record<string, { address: string; seed: string }>,
): SetupState {
  function getWallet(key: string): { address: string; seed: string } {
    if (mockWallets?.[key]) {
      return mockWallets[key];
    }
    const w = Wallet.generate();
    return { address: w.address, seed: w.seed! };
  }

  return {
    endpoint,
    accounts: {
      treasury: getWallet("treasury"),
      agent: getWallet("agent"),
      policy: getWallet("policy"),
      owner: getWallet("owner"),
      supplierA: getWallet("supplierA"),
      supplierB: getWallet("supplierB"),
      unknownSupplier: getWallet("unknownSupplier"),
    },
    funded: {
      treasury: false,
      agent: false,
      policy: false,
      owner: false,
      supplierA: false,
      supplierB: false,
      unknownSupplier: false,
    },
    trustlines: {
      treasury: false,
      supplierA: false,
      supplierB: false,
      unknownSupplier: false,
    },
    treasuryRlusdFunded: false,
    signerListSet: false,
    signerListConfirmed: false,
    masterDisabled: false,
    masterDisabledProven: false,
    envFilesWritten: false,
  };
}

// CLI entry point
export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  const skipHumanStep = args.includes("--skip-human");

  try {
    await setupTreasury({ dryRun, force, skipHumanStep });
  } catch (err: unknown) {
    console.error("Setup failed:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

if (process.argv[1] && (process.argv[1].endsWith("setup-treasury.ts") || process.argv[1].endsWith("setup-treasury.js"))) {
  void main();
}
