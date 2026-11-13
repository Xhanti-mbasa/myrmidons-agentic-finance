import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  RLUSD_CURRENCY_HEX,
  RLUSD_TESTNET_ISSUER,
  XRPL_TESTNET_WSS,
} from "@shucamoxa/shared";
import {
  buildTrustSet,
  buildSignerListSet,
  buildDisableMaster,
  assertTestnet,
  writeServiceEnv,
  setupTreasury,
  ALLOWED_ENV_PATHS,
} from "../setup-treasury";

describe("T25 XRPL Testnet Treasury Setup", () => {
  describe("1. Pure tx builders", () => {
    it("buildTrustSet produces exact expected TrustSet tx object", () => {
      const treasuryAddress = "rTreasuryAccount1111111111111111";
      const tx = buildTrustSet(treasuryAddress, "1000000");

      expect(tx).toEqual({
        TransactionType: "TrustSet",
        Account: treasuryAddress,
        LimitAmount: {
          currency: RLUSD_CURRENCY_HEX,
          issuer: RLUSD_TESTNET_ISSUER,
          value: "1000000",
        },
      });

      // Pure check: verify it works with object syntax as well
      const txObj = buildTrustSet({
        account: "rSupplierA11111111111111111111",
        limit: "500000",
      });
      expect(txObj).toEqual({
        TransactionType: "TrustSet",
        Account: "rSupplierA11111111111111111111",
        LimitAmount: {
          currency: RLUSD_CURRENCY_HEX,
          issuer: RLUSD_TESTNET_ISSUER,
          value: "500000",
        },
      });
    });

    it("buildSignerListSet({agent, policy, owner}) produces exact expected tx object with quorum 2", () => {
      const agent = "rAgent111111111111111111111111";
      const policy = "rPolicy11111111111111111111111";
      const owner = "rOwner111111111111111111111111";

      const tx = buildSignerListSet({ agent, policy, owner });

      expect(tx.TransactionType).toBe("SignerListSet");
      expect(tx.SignerQuorum).toBe(2);
      expect(tx.SignerEntries).toHaveLength(3);

      // Check weights: agent weight 1, policy weight 1, owner weight 2
      const agentEntry = tx.SignerEntries?.find((e) => e.SignerEntry.Account === agent);
      const policyEntry = tx.SignerEntries?.find((e) => e.SignerEntry.Account === policy);
      const ownerEntry = tx.SignerEntries?.find((e) => e.SignerEntry.Account === owner);

      expect(agentEntry).toBeDefined();
      expect(agentEntry?.SignerEntry.SignerWeight).toBe(1);

      expect(policyEntry).toBeDefined();
      expect(policyEntry?.SignerEntry.SignerWeight).toBe(1);

      expect(ownerEntry).toBeDefined();
      expect(ownerEntry?.SignerEntry.SignerWeight).toBe(2);

      // Also verify when treasury account is provided
      const treasury = "rTreasury11111111111111111111";
      const txWithTreasury = buildSignerListSet({ agent, policy, owner, treasury });
      expect(txWithTreasury.Account).toBe(treasury);
    });

    it("buildDisableMaster produces exact expected AccountSet tx object with asfDisableMaster (4)", () => {
      const treasuryAddress = "rTreasuryAccount1111111111111111";
      const tx = buildDisableMaster(treasuryAddress);

      expect(tx).toEqual({
        TransactionType: "AccountSet",
        Account: treasuryAddress,
        SetFlag: 4,
      });

      // Pure check: verify it works with optional account
      const txEmpty = buildDisableMaster();
      expect(txEmpty).toEqual({
        TransactionType: "AccountSet",
        SetFlag: 4,
      });
    });
  });

  describe("2. assertTestnet network validation", () => {
    it("accepts allowed testnet URLs and rejects mainnet and devnet URLs", () => {
      // Allowed testnet URLs
      expect(() => assertTestnet(XRPL_TESTNET_WSS)).not.toThrow();
      expect(() => assertTestnet("wss://testnet.xrpl-labs.com")).not.toThrow();

      // Refuses mainnet
      expect(() => assertTestnet("wss://s1.ripple.com")).toThrow(/not on the testnet allowlist/);
      expect(() => assertTestnet("wss://s2.ripple.com")).toThrow(/not on the testnet allowlist/);
      expect(() => assertTestnet("wss://xrplcluster.com")).toThrow(/not on the testnet allowlist/);

      // Refuses devnet
      expect(() => assertTestnet("wss://s.devnet.rippletest.net:51233")).toThrow(/not on the testnet allowlist/);
      expect(() => assertTestnet("wss://devnet.xrpl-labs.com")).toThrow(/not on the testnet allowlist/);

      // Refuses other arbitrary endpoints
      expect(() => assertTestnet("wss://localhost:6006")).toThrow(/not on the testnet allowlist/);
      expect(() => assertTestnet("http://127.0.0.1:5005")).toThrow(/not on the testnet allowlist/);
    });

    it("refuses server_info whose network_id != 1", () => {
      // Testnet network_id is 1
      expect(() =>
        assertTestnet(XRPL_TESTNET_WSS, { info: { network_id: 1 } })
      ).not.toThrow();
      expect(() =>
        assertTestnet(XRPL_TESTNET_WSS, { network_id: 1 })
      ).not.toThrow();

      // Mainnet network_id 0
      expect(() =>
        assertTestnet(XRPL_TESTNET_WSS, { info: { network_id: 0 } })
      ).toThrow(/network_id must be 1/);

      // Devnet network_id 2
      expect(() =>
        assertTestnet(XRPL_TESTNET_WSS, { info: { network_id: 2 } })
      ).toThrow(/network_id must be 1/);

      // Missing or undefined network_id
      expect(() =>
        assertTestnet(XRPL_TESTNET_WSS, { info: {} })
      ).toThrow(/network_id must be 1/);
    });
  });

  describe("3. writeServiceEnv security and access control", () => {
    let testDir: string;

    beforeEach(() => {
      testDir = join(tmpdir(), `test-t25-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    it("writes mode 0600 and writes only to the 3 allowed paths", () => {
      expect(ALLOWED_ENV_PATHS).toEqual([
        "services/payment/.env",
        "services/policy/.env",
        "secrets/owner-dev.env",
      ]);

      for (const allowedRelPath of ALLOWED_ENV_PATHS) {
        const fullPath = join(testDir, allowedRelPath);
        writeServiceEnv(allowedRelPath, { SOME_SEED: "sEdTestSeed123" }, { repoRoot: testDir });

        expect(existsSync(fullPath)).toBe(true);
        const content = readFileSync(fullPath, "utf8");
        expect(content).toContain("SOME_SEED=sEdTestSeed123");

        // Verify mode 0600 (on POSIX systems; on Windows stat may differ, but permissions mask is tested)
        if (process.platform !== "win32") {
          const stats = statSync(fullPath);
          expect(stats.mode & 0o777).toBe(0o600);
        }
      }
    });

    it("refuses to write to any path not in the 3 allowed paths", () => {
      const disallowed = [
        ".env",
        "services/agent/.env",
        "secrets/setup-output.json",
        "secrets/arbitrary.env",
        "package.json",
      ];

      for (const p of disallowed) {
        expect(() =>
          writeServiceEnv(p, { SEED: "sEdDisallowed" }, { repoRoot: testDir })
        ).toThrow(/path not allowed/);
      }
    });

    it("refuses overwrite without force flag", () => {
      const target = "services/payment/.env";
      writeServiceEnv(target, { AGENT_SEED: "seed-original" }, { repoRoot: testDir });

      // Overwriting without force must fail
      expect(() =>
        writeServiceEnv(target, { AGENT_SEED: "seed-attempted-overwrite" }, { repoRoot: testDir })
      ).toThrow(/already exists/);

      // Verify content was NOT overwritten
      expect(readFileSync(join(testDir, target), "utf8")).toContain("AGENT_SEED=seed-original");

      // Overwriting with force: true succeeds
      writeServiceEnv(
        target,
        { AGENT_SEED: "seed-overwritten" },
        { repoRoot: testDir, force: true }
      );
      expect(readFileSync(join(testDir, target), "utf8")).toContain("AGENT_SEED=seed-overwritten");
    });
  });

  describe("4. No seed is ever printed to stdout/stderr", () => {
    it("captured stdout and stderr contain none of the generated seeds", async () => {
      const fakeSeeds = [
        "sEdT1SecretSeedTreasuryFake12345678",
        "sEdT1SecretSeedAgentFake1234567890",
        "sEdT1SecretSeedPolicyFake123456789",
        "sEdT1SecretSeedOwnerFake1234567890",
        "sEdT1SecretSeedSuppAFake1234567890",
        "sEdT1SecretSeedSuppBFake1234567890",
        "sEdT1SecretSeedUnknownFake12345678",
      ];

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
        const testDir = join(tmpdir(), `test-t25-seeds-${Date.now()}`);
        await setupTreasury({
          dryRun: true,
          repoRoot: testDir,
          // Inject predictable seeds to explicitly search for
          mockWallets: {
            treasury: { address: "rTreasuryMock1111111111111111", seed: fakeSeeds[0]! },
            agent: { address: "rAgentMock1111111111111111111111", seed: fakeSeeds[1]! },
            policy: { address: "rPolicyMock11111111111111111111", seed: fakeSeeds[2]! },
            owner: { address: "rOwnerMock1111111111111111111111", seed: fakeSeeds[3]! },
            supplierA: { address: "rSuppAMock111111111111111111111", seed: fakeSeeds[4]! },
            supplierB: { address: "rSuppBMock111111111111111111111", seed: fakeSeeds[5]! },
            unknownSupplier: { address: "rSuppUnkMock11111111111111111", seed: fakeSeeds[6]! },
          },
        });

        const allCapturedOutput = stdoutChunks.join("") + stderrChunks.join("");

        for (const seed of fakeSeeds) {
          expect(allCapturedOutput).not.toContain(seed);
        }
      } finally {
        stdoutSpy.mockRestore();
        stderrSpy.mockRestore();
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
      }
    });
  });

  describe("5. --dry-run makes 0 client calls", () => {
    it("--dry-run performs zero network / client calls", async () => {
      const mockClient = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        fundWallet: vi.fn(),
        request: vi.fn(),
        submit: vi.fn(),
        submitAndWait: vi.fn(),
        autofill: vi.fn(),
        getLedgerIndex: vi.fn(),
        isConnected: vi.fn().mockReturnValue(false),
      };

      const testDir = join(tmpdir(), `test-t25-dryrun-${Date.now()}`);

      await setupTreasury({
        dryRun: true,
        client: mockClient as any,
        repoRoot: testDir,
      });

      expect(mockClient.connect).not.toHaveBeenCalled();
      expect(mockClient.fundWallet).not.toHaveBeenCalled();
      expect(mockClient.request).not.toHaveBeenCalled();
      expect(mockClient.submit).not.toHaveBeenCalled();
      expect(mockClient.submitAndWait).not.toHaveBeenCalled();
      expect(mockClient.autofill).not.toHaveBeenCalled();
      expect(mockClient.getLedgerIndex).not.toHaveBeenCalled();
    });
  });

  describe("Resumable state & output files", () => {
    it("writes addresses to secrets/setup-output.json and stores resumable state in secrets/setup-state.json", async () => {
      const testDir = join(tmpdir(), `test-t25-state-${Date.now()}`);

      await setupTreasury({
        dryRun: true,
        repoRoot: testDir,
      });

      const statePath = join(testDir, "secrets", "setup-state.json");
      const outputPath = join(testDir, "secrets", "setup-output.json");

      expect(existsSync(statePath)).toBe(true);
      expect(existsSync(outputPath)).toBe(true);

      const output = JSON.parse(readFileSync(outputPath, "utf8"));
      expect(output).toHaveProperty("treasury");
      expect(output).toHaveProperty("agent");
      expect(output).toHaveProperty("policy");
      expect(output).toHaveProperty("owner");
      expect(output).toHaveProperty("supplierA");
      expect(output).toHaveProperty("supplierB");
      expect(output).toHaveProperty("unknownSupplier");

      // Verify no seeds in setup-output.json
      const rawOutputStr = readFileSync(outputPath, "utf8");
      expect(rawOutputStr).not.toContain("seed");
      expect(rawOutputStr).not.toContain("sEd");
    });

    it("executes all setup steps with a mock XRPL client, proving multisig and disabled master key", async () => {
      const testDir = join(tmpdir(), `test-t25-fullflow-${Date.now()}`);

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
        fundWallet: vi.fn().mockResolvedValue({ balance: "1000" }),
        autofill: vi.fn().mockImplementation(async (tx: any) => ({
          ...tx,
          Sequence: 1,
          Fee: "12",
          LastLedgerSequence: 100,
        })),
        getLedgerIndex: vi.fn().mockResolvedValue(50),
        request: vi.fn().mockImplementation(async (req: any) => {
          if (req.command === "server_info") {
            return { result: { info: { network_id: 1 } } };
          }
          if (req.command === "account_lines") {
            return {
              result: {
                lines: [
                  {
                    currency: RLUSD_CURRENCY_HEX,
                    balance: "1000",
                    limit: "1000000000",
                  },
                ],
              },
            };
          }
          if (req.command === "account_objects") {
            return {
              result: {
                account_objects: [
                  {
                    LedgerEntryType: "SignerList",
                    SignerQuorum: 2,
                    SignerEntries: [
                      { SignerEntry: { SignerWeight: 1 } },
                      { SignerEntry: { SignerWeight: 1 } },
                      { SignerEntry: { SignerWeight: 2 } },
                    ],
                  },
                ],
              },
            };
          }
          if (req.command === "account_info") {
            return {
              result: {
                account_data: {
                  Sequence: 2,
                },
              },
            };
          }
          return { result: {} };
        }),
        submit: vi.fn().mockImplementation(async (_blob: string) => {
          return {
            result: {
              engine_result: "tefMASTER_DISABLED",
              engine_result_message: "Master key is disabled.",
            },
          };
        }),
        submitAndWait: vi.fn().mockImplementation(async (_blob: string) => {
          return {
            result: {
              hash: "A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2",
              meta: {
                TransactionResult: "tesSUCCESS",
              },
            },
          };
        }),
      };

      const result = await setupTreasury({
        client: mockClient as any,
        repoRoot: testDir,
        logger: { log: () => {}, error: () => {} },
      });

      expect(mockClient.connect).toHaveBeenCalled();
      // All 7 accounts funded
      expect(mockClient.fundWallet).toHaveBeenCalledTimes(7);
      // 4 trustlines + 1 SignerListSet + 1 AccountSet + 1 multisig payment = 7 submitAndWait calls
      expect(mockClient.submitAndWait).toHaveBeenCalledTimes(7);
      // 1 single-signed payment submitted to prove master key disabled
      expect(mockClient.submit).toHaveBeenCalledTimes(1);

      // Verify final state
      expect(result.state.signerListSet).toBe(true);
      expect(result.state.signerListConfirmed).toBe(true);
      expect(result.state.masterDisabled).toBe(true);
      expect(result.state.masterDisabledProven).toBe(true);
      expect(result.state.evidencePayment?.status).toBe("validated");
      expect(result.state.evidencePayment?.hash).toBe(
        "A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2"
      );

      // Verify files created
      expect(existsSync(join(testDir, "services", "payment", ".env"))).toBe(true);
      expect(existsSync(join(testDir, "services", "policy", ".env"))).toBe(true);
      expect(existsSync(join(testDir, "secrets", "owner-dev.env"))).toBe(true);
      expect(existsSync(join(testDir, "secrets", "setup-output.json"))).toBe(true);
      expect(existsSync(join(testDir, "secrets", "setup-state.json"))).toBe(true);
    });
  });
});
