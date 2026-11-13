import { afterAll } from "vitest";
import { agentApiContract } from "@shucamoxa/shared/test-support/contract";
import { AGENT_TOKEN, startTestBackend } from "./support/backend";

// The same suite T30 runs against W4's real API, here against the mock.
const backend = await startTestBackend();
afterAll(() => backend.close());

agentApiContract(backend.url, AGENT_TOKEN);
