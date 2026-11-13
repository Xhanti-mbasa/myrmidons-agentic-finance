import { Client, Wallet, type Payment } from "xrpl";
import { LAST_LEDGER_WINDOW, XRPL_TESTNET_WSS } from "@shucamoxa/shared";
import { isConfirmedPayment } from "./confirmation";

// Fixed endpoint and faucet: this developer command accepts no network configuration.
async function main(): Promise<void> {
  const client = new Client(XRPL_TESTNET_WSS, { timeout: 20000 });
  let hash: string | undefined;
  let submissionStarted = false;
  try {
    await client.connect();
    const ledger = await client.request({ command: "ledger", ledger_index: "validated" });
    console.log(`Latest validated ledger: ${ledger.result.ledger_index}`);
    const sender = Wallet.generate();
    const recipient = Wallet.generate();
    console.log(`Sender: ${sender.address}\nRecipient: ${recipient.address}`);
    console.log("Funding temporary Testnet accounts...");
    await client.fundWallet(sender);
    await client.fundWallet(recipient);
    const account = await client.request({ command: "account_info", account: sender.address, ledger_index: "validated" });
    const currentLedger = await client.getLedgerIndex();
    const payment: Payment = {
      TransactionType: "Payment", Account: sender.address, Destination: recipient.address,
      Amount: "1000000", Sequence: account.result.account_data.Sequence,
      Fee: "100", LastLedgerSequence: currentLedger + LAST_LEDGER_WINDOW,
    };
    const signed = sender.sign(payment);
    hash = signed.hash;
    console.log(`Transaction hash: ${hash}`);
    console.log(`Testnet explorer: https://testnet.xrpl.org/transactions/${hash}`);
    submissionStarted = true;
    const response = await client.submitAndWait(signed.tx_blob);
    const result = response.result;
    const code = typeof result.meta === "object" && result.meta ? result.meta.TransactionResult : undefined;
    console.log(`Final result: ${code ?? "unavailable"}; validated: ${result.validated === true}`);
    if (!isConfirmedPayment(result, { hash, sender: sender.address, recipient: recipient.address })) {
      throw new Error("Confirmed transaction did not satisfy all success checks");
    }
    console.log("Success: validated 1 XRP payment matches the expected sender and recipient.");
  } catch {
    // Do not log error objects: libraries may include request or signing data.
    if (submissionStarted) console.error(`Payment not confirmed; outcome may be unknown. Reconcile hash ${hash} on Testnet before taking further action.`);
    else console.error("Demo failed before payment submission. Check the Testnet connection and faucet availability.");
    process.exitCode = 1;
  } finally {
    if (client.isConnected()) {
      try { await client.disconnect(); } catch { console.error("Could not close the Testnet connection cleanly."); process.exitCode = 1; }
    }
  }
}

void main();
