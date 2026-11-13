import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client, Wallet, type Payment, type TrustSet } from "xrpl";
import { LAST_LEDGER_WINDOW, RLUSD_CURRENCY_HEX, RLUSD_TESTNET_ISSUER, XRPL_TESTNET_WSS } from "@shucamoxa/shared";
import { isConfirmedRlusdPayment } from "./rlusd-confirmation";

const dir = fileURLToPath(new URL("../wallets/", import.meta.url));
const walletFile = `${dir}rlusd-wallets.json`;
const pendingFile = `${dir}rlusd-pending.json`;
const lockFile = `${dir}rlusd.lock`;
const asset = { currency: RLUSD_CURRENCY_HEX, issuer: RLUSD_TESTNET_ISSUER };
const explorer = (hash: string) => `https://testnet.xrpl.org/transactions/${hash}`;
let uncertainHash: string | undefined;

function prepareDirectory() {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform === "win32") {
    const user = process.env.USERNAME;
    const domain = process.env.USERDOMAIN;
    if (!user || !domain) throw new Error("Cannot determine Windows account for private wallet storage");
    execFileSync("icacls", [dir, "/inheritance:r", "/grant:r", `${domain}\\${user}:(OI)(CI)F`], { stdio: "ignore" });
  } else chmodSync(dir, 0o700);
}
function durableCreate(path: string, data: string) {
  const fd = openSync(path, "wx", 0o600);
  try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
}
function wallets(create: boolean): [Wallet, Wallet] {
  if (!existsSync(walletFile)) {
    if (!create) throw new Error("Run setup first");
    const sender = Wallet.generate(), recipient = Wallet.generate();
    if (!sender.seed || !recipient.seed) throw new Error("Wallet generation failed");
    durableCreate(walletFile, JSON.stringify({ sender: sender.seed, recipient: recipient.seed }));
  }
  const saved = JSON.parse(readFileSync(walletFile, "utf8")) as { sender: string; recipient: string };
  return [Wallet.fromSeed(saved.sender), Wallet.fromSeed(saved.recipient)];
}
async function state(client: Client, address: string) {
  const info = await client.request({ command: "account_info", account: address, ledger_index: "validated" });
  const lines = await client.request({ command: "account_lines", account: address, peer: RLUSD_TESTNET_ISSUER, ledger_index: "validated" });
  if (lines.result.marker) throw new Error("Unexpected paginated trust lines; refusing incomplete data");
  const line = lines.result.lines.find(item => item.currency === asset.currency && item.account === asset.issuer);
  return { drops: info.result.account_data.Balance, line };
}
async function funded(client: Client, wallet: Wallet) {
  try {
    const info = await client.request({ command: "account_info", account: wallet.address, ledger_index: "validated" });
    if (BigInt(info.result.account_data.Balance) < 3_000_000n) await client.fundWallet(wallet);
  } catch (error) {
    const data = (error as { data?: { error?: string } }).data;
    if (data?.error !== "actNotFound") throw error;
    await client.fundWallet(wallet);
  }
}
async function setupAccount(client: Client, wallet: Wallet, label: string) {
  await funded(client, wallet);
  const current = (await state(client, wallet.address)).line;
  if (!current || !Number(current.limit)) {
    const info = await client.request({ command: "account_info", account: wallet.address, ledger_index: "validated" });
    const tx: TrustSet = { TransactionType: "TrustSet", Account: wallet.address,
      LimitAmount: { ...asset, value: "1000000000" }, Fee: "100", Sequence: info.result.account_data.Sequence,
      LastLedgerSequence: (await client.getLedgerIndex()) + LAST_LEDGER_WINDOW };
    const signed = wallet.sign(tx);
    const result = (await client.submitAndWait(signed.tx_blob)).result;
    if (!result.validated || typeof result.meta !== "object" || result.meta?.TransactionResult !== "tesSUCCESS") throw new Error(`${label} trust line not confirmed`);
  }
  const line = (await state(client, wallet.address)).line;
  if (!line || !Number(line.limit)) throw new Error(`${label} trust line not active`);
  console.log(`${label} RLUSD trust line: validated`);
}
async function main() {
  const action = process.argv[2];
  if (!action || !["setup", "balances", "send"].includes(action)) throw new Error("Usage: pnpm xrpl:rlusd setup|balances|send");
  prepareDirectory();
  const lock = openSync(lockFile, "wx", 0o600);
  const client = new Client(XRPL_TESTNET_WSS, { timeout: 20000 });
  try {
    const [sender, recipient] = wallets(action === "setup");
    console.log(`Sender: ${sender.address}\nRecipient: ${recipient.address}`);
    await client.connect();
    if (action === "setup") {
      await setupAccount(client, sender, "Sender"); await setupAccount(client, recipient, "Recipient");
      console.log(`Request Testnet RLUSD for the Sender at https://tryrlusd.com/`);
    } else if (action === "balances") {
      for (const [label, wallet] of [["Sender", sender], ["Recipient", recipient]] as const) {
        const s = await state(client, wallet.address);
        console.log(`${label}: ${s.drops} drops XRP; ${s.line?.balance ?? "0"} RLUSD; trust line ${s.line ? "present" : "missing"}`);
      }
    } else {
      if (existsSync(pendingFile)) {
        const pending = JSON.parse(readFileSync(pendingFile, "utf8")) as { hash: string; sender: string; recipient: string };
        uncertainHash = pending.hash;
        console.log(`Existing transaction: ${pending.hash}\n${explorer(pending.hash)}`);
        try {
          const result = (await client.request({ command: "tx", transaction: pending.hash })).result;
          if (pending.sender === sender.address && pending.recipient === recipient.address && isConfirmedRlusdPayment(result, pending)) {
            renameSync(pendingFile, `${dir}rlusd-confirmed-${pending.hash}.json`);
            console.log("Previous payment validated; run send again only if you intend another payment."); return;
          }
        } catch { /* Unknown remains blocked. */ }
        throw new Error("Previous payment remains unresolved; reconcile its hash before another send");
      }
      const from = await state(client, sender.address), to = await state(client, recipient.address);
      if (!from.line || !to.line || !/^(?:[1-9]\d*)(?:\.\d+)?$/.test(from.line.balance) || !Number(to.line.limit)) throw new Error("Active trust lines and at least 1 RLUSD are required");
      const info = await client.request({ command: "account_info", account: sender.address, ledger_index: "validated" });
      const tx: Payment = { TransactionType: "Payment", Account: sender.address, Destination: recipient.address,
        Amount: { ...asset, value: "1" }, Fee: "100", Sequence: info.result.account_data.Sequence,
        LastLedgerSequence: (await client.getLedgerIndex()) + LAST_LEDGER_WINDOW };
      const signed = sender.sign(tx);
      durableCreate(pendingFile, JSON.stringify({ hash: signed.hash, sender: sender.address, recipient: recipient.address, sequence: tx.Sequence, lastLedgerSequence: tx.LastLedgerSequence }));
      uncertainHash = signed.hash;
      console.log(`Transaction hash: ${signed.hash}\n${explorer(signed.hash)}`);
      const result = (await client.submitAndWait(signed.tx_blob)).result;
      if (!isConfirmedRlusdPayment(result, { hash: signed.hash, sender: sender.address, recipient: recipient.address })) throw new Error("Payment outcome not confirmed; reconcile the saved hash");
      renameSync(pendingFile, `${dir}rlusd-confirmed-${signed.hash}.json`);
      console.log("Validated tesSUCCESS: 1 RLUSD delivered to Recipient.");
    }
  } finally {
    if (client.isConnected()) await client.disconnect().catch(() => { process.exitCode = 1; });
    closeSync(lock); unlinkSync(lockFile);
  }
}
void main().catch(() => {
  if (uncertainHash) console.error(`Payment outcome unknown; reconcile ${uncertainHash} at ${explorer(uncertainHash)}. Another payment is blocked.`);
  else console.error("Command failed. Check the connection, account state, or local lock before retrying.");
  process.exitCode = 1;
});
