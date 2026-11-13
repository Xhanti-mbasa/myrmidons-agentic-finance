import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { decode, Wallet, decodeAccountID } from "xrpl";
import {
  XRPL_TESTNET_WSS,
  LAST_LEDGER_WINDOW,
} from "@shucamoxa/shared";
import {
  buildRevokeAgentSignerListSet,
  buildRestoreSignerListSet,
  buildCustomSignerListSet,
  buildOwnerMultisignedTx,
  sortSignerEntries,
  redactSecrets,
  loadConfig,
  getStatus,
  revoke,
  restore,
  verifyRevocation,
  main,
  assertTestnet,
  type SignerListStatus,
} from "../kill-switch";

describe("T27 XRPL On-Ledger Kill Switch & Revocation", () => {
  const mockTreasuryWallet = Wallet.generate();
  const mockTreasury = mockTreasuryWallet.address;
  const mockAgentWallet = Wallet.generate();
  const mockAgent = mockAgentWallet.address;
  const mockPolicyWallet = Wallet.generate();
  const mockPolicy = mockPolicyWallet.address;
  const mockOwnerWallet = Wallet.generate();
  const mockOwner = mockOwnerWallet.address;

  describe("1. Pure tx builders & canonical sorting", () => {
    it("buildRevokeAgentSignerListSet produces SignerListSet omitting agent with Quorum 2", () => {
      const tx = buildRevokeAgentSignerListSet({
        treasury: mockTreasury,
        owner: mockOwner,
        policy: mockPolicy,
      });

      expect(tx.TransactionType).toBe("SignerListSet");
      expect(tx.Account).toBe(mockTreasury);
      expect(tx.SignerQuorum).toBe(2);
      expect(tx.SignerEntries).toHaveLength(2);

      // Verify agent is omitted
      const accounts = tx.SignerEntries?.map((e) => e.SignerEntry.Account);
      expect(accounts).not.toContain(mockAgent);
      expect(accounts).toContain(mockOwner);
      expect(accounts).toContain(mockPolicy);

      // Verify weights: owner 2, policy 1
      const ownerEntry = tx.SignerEntries?.find((e) => e.SignerEntry.Account === mockOwner);
      const policyEntry = tx.SignerEntries?.find((e) => e.SignerEntry.Account === mockPolicy);
      expect(ownerEntry?.SignerEntry.SignerWeight).toBe(2);
      expect(policyEntry?.SignerEntry.SignerWeight).toBe(1);

      // Verify entries are sorted by decoded account ID
      const buf0 = decodeAccountID(tx.SignerEntries![0]!.SignerEntry.Account);
      const buf1 = decodeAccountID(tx.SignerEntries![1]!.SignerEntry.Account);
      expect(Buffer.compare(buf0, buf1)).toBeLessThanOrEqual(0);
    });

    it("buildRevokeAgentSignerListSet supports full freeze (no policy, owner only)", () => {
      const tx = buildRevokeAgentSignerListSet({
        treasury: mockTreasury,
        owner: mockOwner,
      });

      expect(tx.SignerEntries).toHaveLength(1);
      expect(tx.SignerEntries![0]!.SignerEntry.Account).toBe(mockOwner);
      expect(tx.SignerEntries![0]!.SignerEntry.SignerWeight).toBe(2);
      expect(tx.SignerQuorum).toBe(2);
    });

    it("buildRestoreSignerListSet produces SignerListSet with agent (1), policy (1), owner (2)", () => {
      const tx = buildRestoreSignerListSet({
        treasury: mockTreasury,
        agent: mockAgent,
        policy: mockPolicy,
        owner: mockOwner,
      });

      expect(tx.TransactionType).toBe("SignerListSet");
      expect(tx.Account).toBe(mockTreasury);
      expect(tx.SignerQuorum).toBe(2);
      expect(tx.SignerEntries).toHaveLength(3);

      const agentEntry = tx.SignerEntries?.find((e) => e.SignerEntry.Account === mockAgent);
      const policyEntry = tx.SignerEntries?.find((e) => e.SignerEntry.Account === mockPolicy);
      const ownerEntry = tx.SignerEntries?.find((e) => e.SignerEntry.Account === mockOwner);

      expect(agentEntry?.SignerEntry.SignerWeight).toBe(1);
      expect(policyEntry?.SignerEntry.SignerWeight).toBe(1);
      expect(ownerEntry?.SignerEntry.SignerWeight).toBe(2);

      // Verify all 3 entries are canonically sorted
      for (let i = 0; i < tx.SignerEntries!.length - 1; i++) {
        const bA = decodeAccountID(tx.SignerEntries![i]!.SignerEntry.Account);
        const bB = decodeAccountID(tx.SignerEntries![i + 1]!.SignerEntry.Account);
        expect(Buffer.compare(bA, bB)).toBeLessThanOrEqual(0);
      }
    });

    it("buildCustomSignerListSet generates arbitrary SignerListSet with sorted entries", () => {
      const tx = buildCustomSignerListSet({
        treasury: mockTreasury,
        quorum: 3,
        entries: [
          { account: mockOwner, weight: 3 },
          { account: mockAgent, weight: 1 },
          { account: mockPolicy, weight: 2 },
        ],
      });

      expect(tx.SignerQuorum).toBe(3);
      expect(tx.SignerEntries).toHaveLength(3);
      for (let i = 0; i < tx.SignerEntries!.length - 1; i++) {
        const bA = decodeAccountID(tx.SignerEntries![i]!.SignerEntry.Account);
        const bB = decodeAccountID(tx.SignerEntries![i + 1]!.SignerEntry.Account);
        expect(Buffer.compare(bA, bB)).toBeLessThanOrEqual(0);
      }
    });

    it("buildOwnerMultisignedTx produces valid multisigned tx blob signed by Owner alone", () => {
      const ownerWallet = Wallet.generate();
      const tx = buildRevokeAgentSignerListSet({
        treasury: mockTreasury,
        owner: ownerWallet.address,
        policy: mockPolicy,
      });

      const blob = buildOwnerMultisignedTx({
        tx,
        ownerWallet,
        sequence: 42,
        lastLedgerSequence: 500,
        feeDrops: "100",
      });

      expect(typeof blob).toBe("string");
      expect(blob.length).toBeGreaterThan(0);

      // Decode blob and verify fields
      const decoded = decode(blob) as any;
      expect(decoded.TransactionType).toBe("SignerListSet");
      expect(decoded.Account).toBe(mockTreasury);
      expect(decoded.Sequence).toBe(42);
      expect(decoded.Fee).toBe("100");
      expect(decoded.LastLedgerSequence).toBe(500);
      expect(decoded.SigningPubKey).toBe("");

      // Exactly 1 signer: the Owner
      expect(decoded.Signers).toHaveLength(1);
      expect(decoded.Signers[0].Signer.Account).toBe(ownerWallet.address);
      expect(decoded.Signers[0].Signer.SigningPubKey).toBe(ownerWallet.publicKey);
      expect(typeof decoded.Signers[0].Signer.TxnSignature).toBe("string");
    });
  });

  describe("2. Network guard & assertTestnet", () => {
    it("allows testnet endpoints and rejects non-testnet URLs", () => {
      expect(() => assertTestnet(XRPL_TESTNET_WSS)).not.toThrow();
      expect(() => assertTestnet("wss://testnet.xrpl-labs.com")).not.toThrow();

      expect(() => assertTestnet("wss://s1.ripple.com")).toThrow(/not on the testnet allowlist/);
      expect(() => assertTestnet("wss://s.devnet.rippletest.net:51233")).toThrow(/not on the testnet allowlist/);
    });

    it("validates server_info network_id === 1", () => {
      expect(() => assertTestnet(XRPL_TESTNET_WSS, { info: { network_id: 1 } })).not.toThrow();
      expect(() => assertTestnet(XRPL_TESTNET_WSS, { info: { network_id: 0 } })).toThrow(/network_id must be 1/);
    });
  });

  describe("3. Strict no-seed leakage in logs and stdout/stderr", () => {
    it("redactSecrets scrubs any XRPL seed pattern", () => {
      const seed = "sEdT1SecretSeedTreasuryFake12345678";
      const masked = redactSecrets(`Error: failed with seed ${seed}`);
      expect(masked).not.toContain(seed);
      expect(masked).toContain("[REDACTED_SEED]");
    });

    it("captured stdout and stderr contain zero seeds during status, revoke, restore, verify", async () => {
      const ownerWallet = Wallet.generate();
      const agentWallet = Wallet.generate();
      const policyWallet = Wallet.generate();
      const fakeOwnerSeed = ownerWallet.seed!;
      const fakeAgentSeed = agentWallet.seed!;
      const fakePolicySeed = policyWallet.seed!;

      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((str) => {
        stdoutChunks.push(String(str));
        return true;
      });
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((str) => {
        stderrChunks.push(String(str));
        return true;
      });
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
        stdoutChunks.push(args.map(String).join(" "));
      });
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
        stderrChunks.push(args.map(String).join(" "));
      });

      try {
        const testDir = join(tmpdir(), `test-t27-seeds-${Date.now()}`);
        mkdirSync(join(testDir, "secrets"), { recursive: true });

        // Run dry-run actions with seeds present
        await getStatus({
          dryRun: true,
          repoRoot: testDir,
          treasury: mockTreasury,
          agent: agentWallet.address,
          policy: policyWallet.address,
          ownerSeed: fakeOwnerSeed,
        });

        await revoke({
          dryRun: true,
          repoRoot: testDir,
          treasury: mockTreasury,
          ownerSeed: fakeOwnerSeed,
          agent: agentWallet.address,
          policy: policyWallet.address,
        });

        await restore({
          dryRun: true,
          repoRoot: testDir,
          treasury: mockTreasury,
          ownerSeed: fakeOwnerSeed,
          agent: agentWallet.address,
          policy: policyWallet.address,
        });

        await verifyRevocation({
          dryRun: true,
          repoRoot: testDir,
          treasury: mockTreasury,
          agentSeed: fakeAgentSeed,
          policySeed: fakePolicySeed,
        });

        const allCapturedOutput = stdoutChunks.join("") + stderrChunks.join("");
        expect(allCapturedOutput).not.toContain(fakeOwnerSeed);
        expect(allCapturedOutput).not.toContain(fakeAgentSeed);
        expect(allCapturedOutput).not.toContain(fakePolicySeed);
      } finally {
        stdoutSpy.mockRestore();
        stderrSpy.mockRestore();
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
      }
    });
  });

  describe("4. --dry-run makes 0 network/client calls", () => {
    it("status, revoke, restore, and verify make 0 client calls with dryRun: true", async () => {
      const mockClient = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        request: vi.fn(),
        submit: vi.fn(),
        submitAndWait: vi.fn(),
        getLedgerIndex: vi.fn(),
        isConnected: vi.fn().mockReturnValue(false),
      };

      const ownerWallet = Wallet.generate();

      await getStatus({
        dryRun: true,
        client: mockClient as any,
        treasury: mockTreasury,
      });

      await revoke({
        dryRun: true,
        client: mockClient as any,
        treasury: mockTreasury,
        ownerSeed: ownerWallet.seed!,
        agent: mockAgent,
        policy: mockPolicy,
      });

      await restore({
        dryRun: true,
        client: mockClient as any,
        treasury: mockTreasury,
        ownerSeed: ownerWallet.seed!,
        agent: mockAgent,
        policy: mockPolicy,
      });

      await verifyRevocation({
        dryRun: true,
        client: mockClient as any,
        treasury: mockTreasury,
      });

      expect(mockClient.connect).not.toHaveBeenCalled();
      expect(mockClient.request).not.toHaveBeenCalled();
      expect(mockClient.submit).not.toHaveBeenCalled();
      expect(mockClient.submitAndWait).not.toHaveBeenCalled();
      expect(mockClient.getLedgerIndex).not.toHaveBeenCalled();
    });
  });

  describe("5. Status query via account_objects and account_info", () => {
    function createMockClientForStatus(signerEntries: any[], flags = 0x00100000) {
      return {
        connected: false,
        isConnected: vi.fn(function (this: any) {
          return this.connected;
        }),
        connect: vi.fn(async function (this: any) {
          this.connected = true;
        }),
        disconnect: vi.fn(async function (this: any) {
          this.connected = false;
        }),
        request: vi.fn().mockImplementation(async (req: any) => {
          if (req.command === "server_info") {
            return { result: { info: { network_id: 1 } } };
          }
          if (req.command === "account_objects") {
            return {
              result: {
                account_objects: [
                  {
                    LedgerEntryType: "SignerList",
                    SignerQuorum: 2,
                    SignerEntries: signerEntries,
                  },
                ],
              },
            };
          }
          if (req.command === "account_info") {
            return {
              result: {
                account_data: {
                  Flags: flags, // 0x00100000 = lsfDisableMaster
                  Sequence: 10,
                },
              },
            };
          }
          return { result: {} };
        }),
      };
    }

    it("detects ACTIVE status when agent, policy, and owner are present", async () => {
      const mockClient = createMockClientForStatus([
        { SignerEntry: { Account: mockAgent, SignerWeight: 1 } },
        { SignerEntry: { Account: mockPolicy, SignerWeight: 1 } },
        { SignerEntry: { Account: mockOwner, SignerWeight: 2 } },
      ]);

      const status = await getStatus({
        client: mockClient as any,
        treasury: mockTreasury,
        agent: mockAgent,
        policy: mockPolicy,
        ownerSeed: Wallet.generate().seed, // will derive owner
      });

      expect(status.hasSignerList).toBe(true);
      expect(status.quorum).toBe(2);
      expect(status.state).toBe("active");
      expect(status.masterKeyDisabled).toBe(true);
      expect(status.agent?.active).toBe(true);
      expect(status.policy?.active).toBe(true);
      expect(status.signers).toHaveLength(3);
    });

    it("detects REVOKED status when agent is omitted from SignerEntries", async () => {
      const mockClient = createMockClientForStatus([
        { SignerEntry: { Account: mockPolicy, SignerWeight: 1 } },
        { SignerEntry: { Account: mockOwner, SignerWeight: 2 } },
      ]);

      const status = await getStatus({
        client: mockClient as any,
        treasury: mockTreasury,
        agent: mockAgent,
        policy: mockPolicy,
      });

      expect(status.hasSignerList).toBe(true);
      expect(status.quorum).toBe(2);
      expect(status.state).toBe("revoked");
      expect(status.agent?.active).toBe(false);
      expect(status.policy?.active).toBe(true);
      expect(status.signers).toHaveLength(2);
    });

    it("detects unconfigured treasury when no SignerList is returned", async () => {
      const mockClient = {
        connected: false,
        isConnected: vi.fn(() => true),
        connect: vi.fn(),
        disconnect: vi.fn(),
        request: vi.fn().mockImplementation(async (req: any) => {
          if (req.command === "server_info") return { result: { info: { network_id: 1 } } };
          if (req.command === "account_objects") return { result: { account_objects: [] } };
          if (req.command === "account_info") return { result: { account_data: { Flags: 0 } } };
          return { result: {} };
        }),
      };

      const status = await getStatus({
        client: mockClient as any,
        treasury: mockTreasury,
      });

      expect(status.hasSignerList).toBe(false);
      expect(status.state).toBe("not_configured");
      expect(status.masterKeyDisabled).toBe(false);
    });
  });

  describe("6. Revoke flow with mocked XRPL client", () => {
    it("submits owner-multisigned SignerListSet revoking agent and verifies on-ledger result", async () => {
      const ownerWallet = Wallet.generate();
      let onLedgerEntries = [
        { SignerEntry: { Account: mockAgent, SignerWeight: 1 } },
        { SignerEntry: { Account: mockPolicy, SignerWeight: 1 } },
        { SignerEntry: { Account: ownerWallet.address, SignerWeight: 2 } },
      ];

      let submittedBlob: string | undefined;

      const mockClient = {
        connected: false,
        isConnected: vi.fn(function (this: any) {
          return this.connected;
        }),
        connect: vi.fn(async function (this: any) {
          this.connected = true;
        }),
        disconnect: vi.fn(async function (this: any) {
          this.connected = false;
        }),
        getLedgerIndex: vi.fn().mockResolvedValue(100),
        request: vi.fn().mockImplementation(async (req: any) => {
          if (req.command === "server_info") {
            return { result: { info: { network_id: 1 } } };
          }
          if (req.command === "account_objects") {
            return {
              result: {
                account_objects: [
                  {
                    LedgerEntryType: "SignerList",
                    SignerQuorum: 2,
                    SignerEntries: onLedgerEntries,
                  },
                ],
              },
            };
          }
          if (req.command === "account_info") {
            return {
              result: {
                account_data: {
                  Flags: 0x00100000,
                  Sequence: 15,
                },
              },
            };
          }
          return { result: {} };
        }),
        submitAndWait: vi.fn().mockImplementation(async (txBlob: string) => {
          submittedBlob = txBlob;
          // Simulate ledger updating signer entries upon successful submission
          onLedgerEntries = [
            { SignerEntry: { Account: mockPolicy, SignerWeight: 1 } },
            { SignerEntry: { Account: ownerWallet.address, SignerWeight: 2 } },
          ];
          return {
            result: {
              hash: "E4F5A6B7C8D9E0F1A2B3C4D5E6F7A8B9C0D1E2F3A4B5C6D7E8F9A0B1C2D3E4F5",
              meta: {
                TransactionResult: "tesSUCCESS",
              },
            },
          };
        }),
      };

      const testDir = join(tmpdir(), `test-t27-revoke-${Date.now()}`);
      mkdirSync(join(testDir, "secrets"), { recursive: true });

      const res = await revoke({
        client: mockClient as any,
        repoRoot: testDir,
        treasury: mockTreasury,
        ownerSeed: ownerWallet.seed!,
        agent: mockAgent,
        policy: mockPolicy,
        logger: { log: () => {}, error: () => {} },
      });

      expect(res.success).toBe(true);
      expect(res.txHash).toBe("E4F5A6B7C8D9E0F1A2B3C4D5E6F7A8B9C0D1E2F3A4B5C6D7E8F9A0B1C2D3E4F5");
      expect(res.previousState.state).toBe("active");
      expect(res.newState.state).toBe("revoked");
      expect(mockClient.submitAndWait).toHaveBeenCalledTimes(1);

      // Verify the submitted blob is a valid SignerListSet signed by owner alone
      expect(submittedBlob).toBeDefined();
      const decoded = decode(submittedBlob!) as any;
      expect(decoded.TransactionType).toBe("SignerListSet");
      expect(decoded.SignerQuorum).toBe(2);
      expect(decoded.Signers[0].Signer.Account).toBe(ownerWallet.address);

      // Verify evidence file saved
      const evidenceFile = join(testDir, "secrets", "kill-switch-evidence.json");
      expect(existsSync(evidenceFile)).toBe(true);
      const evidence = JSON.parse(readFileSync(evidenceFile, "utf8"));
      expect(evidence.action).toBe("revoke");
      expect(evidence.txHash).toBe(res.txHash);
    });

    it("is idempotent: skips submitting transaction if already in revoked state", async () => {
      const ownerWallet = Wallet.generate();
      const mockClient = {
        connected: false,
        isConnected: vi.fn(() => true),
        connect: vi.fn(),
        disconnect: vi.fn(),
        getLedgerIndex: vi.fn().mockResolvedValue(100),
        request: vi.fn().mockImplementation(async (req: any) => {
          if (req.command === "server_info") return { result: { info: { network_id: 1 } } };
          if (req.command === "account_objects") {
            return {
              result: {
                account_objects: [
                  {
                    LedgerEntryType: "SignerList",
                    SignerQuorum: 2,
                    SignerEntries: [
                      { SignerEntry: { Account: mockPolicy, SignerWeight: 1 } },
                      { SignerEntry: { Account: ownerWallet.address, SignerWeight: 2 } },
                    ],
                  },
                ],
              },
            };
          }
          if (req.command === "account_info") {
            return { result: { account_data: { Flags: 0x00100000, Sequence: 15 } } };
          }
          return { result: {} };
        }),
        submitAndWait: vi.fn(),
      };

      const res = await revoke({
        client: mockClient as any,
        treasury: mockTreasury,
        ownerSeed: ownerWallet.seed!,
        agent: mockAgent,
        policy: mockPolicy,
        logger: { log: () => {}, error: () => {} },
      });

      expect(res.success).toBe(true);
      expect(res.alreadyRevoked).toBe(true);
      expect(mockClient.submitAndWait).not.toHaveBeenCalled();
    });
  });

  describe("7. Restore flow with mocked XRPL client", () => {
    it("submits owner-multisigned SignerListSet restoring agent and verifies on-ledger result", async () => {
      const ownerWallet = Wallet.generate();
      let onLedgerEntries = [
        { SignerEntry: { Account: mockPolicy, SignerWeight: 1 } },
        { SignerEntry: { Account: ownerWallet.address, SignerWeight: 2 } },
      ];

      const mockClient = {
        connected: false,
        isConnected: vi.fn(function (this: any) {
          return this.connected;
        }),
        connect: vi.fn(async function (this: any) {
          this.connected = true;
        }),
        disconnect: vi.fn(async function (this: any) {
          this.connected = false;
        }),
        getLedgerIndex: vi.fn().mockResolvedValue(105),
        request: vi.fn().mockImplementation(async (req: any) => {
          if (req.command === "server_info") {
            return { result: { info: { network_id: 1 } } };
          }
          if (req.command === "account_objects") {
            return {
              result: {
                account_objects: [
                  {
                    LedgerEntryType: "SignerList",
                    SignerQuorum: 2,
                    SignerEntries: onLedgerEntries,
                  },
                ],
              },
            };
          }
          if (req.command === "account_info") {
            return {
              result: {
                account_data: {
                  Flags: 0x00100000,
                  Sequence: 16,
                },
              },
            };
          }
          return { result: {} };
        }),
        submitAndWait: vi.fn().mockImplementation(async () => {
          onLedgerEntries = [
            { SignerEntry: { Account: mockAgent, SignerWeight: 1 } },
            { SignerEntry: { Account: mockPolicy, SignerWeight: 1 } },
            { SignerEntry: { Account: ownerWallet.address, SignerWeight: 2 } },
          ];
          return {
            result: {
              hash: "A1A2A3A4A5A6A7A8A9B0B1B2B3B4B5B6B7B8B9C0C1C2C3C4C5C6C7C8C9D0D1D2",
              meta: {
                TransactionResult: "tesSUCCESS",
              },
            },
          };
        }),
      };

      const res = await restore({
        client: mockClient as any,
        treasury: mockTreasury,
        ownerSeed: ownerWallet.seed!,
        agent: mockAgent,
        policy: mockPolicy,
        logger: { log: () => {}, error: () => {} },
      });

      expect(res.success).toBe(true);
      expect(res.previousState.state).toBe("revoked");
      expect(res.newState.state).toBe("active");
      expect(mockClient.submitAndWait).toHaveBeenCalledTimes(1);
    });

    it("is idempotent: skips submitting transaction if already in active state", async () => {
      const ownerWallet = Wallet.generate();
      const mockClient = {
        connected: false,
        isConnected: vi.fn(() => true),
        connect: vi.fn(),
        disconnect: vi.fn(),
        getLedgerIndex: vi.fn().mockResolvedValue(105),
        request: vi.fn().mockImplementation(async (req: any) => {
          if (req.command === "server_info") return { result: { info: { network_id: 1 } } };
          if (req.command === "account_objects") {
            return {
              result: {
                account_objects: [
                  {
                    LedgerEntryType: "SignerList",
                    SignerQuorum: 2,
                    SignerEntries: [
                      { SignerEntry: { Account: mockAgent, SignerWeight: 1 } },
                      { SignerEntry: { Account: mockPolicy, SignerWeight: 1 } },
                      { SignerEntry: { Account: ownerWallet.address, SignerWeight: 2 } },
                    ],
                  },
                ],
              },
            };
          }
          if (req.command === "account_info") {
            return { result: { account_data: { Flags: 0x00100000, Sequence: 16 } } };
          }
          return { result: {} };
        }),
        submitAndWait: vi.fn(),
      };

      const res = await restore({
        client: mockClient as any,
        treasury: mockTreasury,
        ownerSeed: ownerWallet.seed!,
        agent: mockAgent,
        policy: mockPolicy,
        logger: { log: () => {}, error: () => {} },
      });

      expect(res.success).toBe(true);
      expect(res.alreadyActive).toBe(true);
      expect(mockClient.submitAndWait).not.toHaveBeenCalled();
    });
  });

  describe("8. Verification tests prove revoked signers produce tefBAD_QUORUM / rejection on-ledger", () => {
    it("proves policy alone, revoked agent alone, and agent+policy produce tefBAD_QUORUM rejection", async () => {
      const mockClient = {
        connected: false,
        isConnected: vi.fn(function (this: any) {
          return this.connected;
        }),
        connect: vi.fn(async function (this: any) {
          this.connected = true;
        }),
        disconnect: vi.fn(async function (this: any) {
          this.connected = false;
        }),
        getLedgerIndex: vi.fn().mockResolvedValue(110),
        request: vi.fn().mockImplementation(async (req: any) => {
          if (req.command === "server_info") return { result: { info: { network_id: 1 } } };
          if (req.command === "account_info") {
            return {
              result: {
                account_data: {
                  Flags: 0x00100000,
                  Sequence: 20,
                },
              },
            };
          }
          return { result: {} };
        }),
        submit: vi.fn().mockImplementation(async () => {
          // Both insufficient quorum and unauthorized signer produce tefBAD_QUORUM or tefBAD_SIGNATURE
          return {
            result: {
              engine_result: "tefBAD_QUORUM",
              engine_result_message: "Signatures provided do not meet the quorum.",
            },
          };
        }),
      };

      const res = await verifyRevocation({
        client: mockClient as any,
        treasury: mockTreasury,
        logger: { log: () => {}, error: () => {} },
      });

      expect(res.verified).toBe(true);
      expect(res.checks).toHaveLength(3);

      const policyAlone = res.checks.find((c) => c.scenario === "policy_alone_insufficient_quorum");
      expect(policyAlone?.verified).toBe(true);
      expect(policyAlone?.actualResult).toBe("tefBAD_QUORUM");

      const agentAlone = res.checks.find((c) => c.scenario === "revoked_agent_alone");
      expect(agentAlone?.verified).toBe(true);
      expect(agentAlone?.actualResult).toBe("tefBAD_QUORUM");

      const agentPlusPolicy = res.checks.find((c) => c.scenario === "revoked_agent_plus_policy");
      expect(agentPlusPolicy?.verified).toBe(true);
      expect(agentPlusPolicy?.actualResult).toBe("tefBAD_QUORUM");

      // Exactly 3 submit calls made
      expect(mockClient.submit).toHaveBeenCalledTimes(3);
    });
  });

  describe("9. Configuration loading from secrets files", () => {
    let testDir: string;

    beforeEach(() => {
      testDir = join(tmpdir(), `test-t27-config-${Date.now()}`);
      mkdirSync(join(testDir, "secrets"), { recursive: true });
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    it("loads treasury, agent, policy addresses and owner seed from secrets directory", () => {
      const ownerWallet = Wallet.generate();
      writeFileSync(
        join(testDir, "secrets", "owner-dev.env"),
        `OWNER_DEV_SEED=${ownerWallet.seed}\n`
      );
      writeFileSync(
        join(testDir, "secrets", "setup-output.json"),
        JSON.stringify({
          treasury: mockTreasury,
          agent: mockAgent,
          policy: mockPolicy,
          owner: ownerWallet.address,
        })
      );

      const config = loadConfig({ repoRoot: testDir });
      expect(config.treasury).toBe(mockTreasury);
      expect(config.agentAddress).toBe(mockAgent);
      expect(config.policyAddress).toBe(mockPolicy);
      expect(config.ownerSeed).toBe(ownerWallet.seed);
      expect(config.ownerAddress).toBe(ownerWallet.address);
    });
  });

  describe("10. CLI entry point", () => {
    let origArgv: string[];
    let origExitCode: string | number | null | undefined;

    beforeEach(() => {
      origArgv = process.argv;
      origExitCode = process.exitCode;
    });

    afterEach(() => {
      process.argv = origArgv;
      process.exitCode = origExitCode as number | undefined;
    });

    it("runs status command in dry-run mode via CLI", async () => {
      process.argv = [
        "node",
        "scripts/kill-switch.ts",
        "status",
        "--dry-run",
        "--treasury",
        mockTreasury,
      ];

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        await main();
        expect(logSpy).toHaveBeenCalled();
      } finally {
        logSpy.mockRestore();
      }
    });

    it("runs status command with --json output", async () => {
      process.argv = [
        "node",
        "scripts/kill-switch.ts",
        "status",
        "--dry-run",
        "--treasury",
        mockTreasury,
        "--json",
      ];

      let jsonOut = "";
      const logSpy = vi.spyOn(console, "log").mockImplementation((str) => {
        jsonOut += String(str);
      });
      try {
        await main();
        const parsed = JSON.parse(jsonOut);
        expect(parsed.treasury).toBe(mockTreasury);
        expect(parsed.quorum).toBe(2);
      } finally {
        logSpy.mockRestore();
      }
    });

    it("handles unknown CLI action by setting exitCode = 1", async () => {
      process.argv = ["node", "scripts/kill-switch.ts", "invalid-action"];
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await main();
        expect(process.exitCode).toBe(1);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown action"));
      } finally {
        errorSpy.mockRestore();
      }
    });
  });
});
