import { refuseUnsafeEnv, type Env } from "@shucamoxa/shared";

export type WebConfig = {
  apiUrl: string;
};

export const WEB_ENV_NAMES = ["API_URL"] as const;

export function loadWebConfig(env: Env = process.env): WebConfig {
  refuseUnsafeEnv(env, {
    allowedNames: [
      "API_URL",
      "NODE_ENV",
      "PORT",
      "HOST",
      "HOSTNAME",
      "NEXT_RUNTIME",
      "PATH",
      "PWD",
    ],
    label: "Web config",
  });

  const rawApiUrl = env.API_URL;
  if (!rawApiUrl) {
    throw new Error("Web config: API_URL is required");
  }

  try {
    const url = new URL(rawApiUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Invalid protocol");
    }
  } catch {
    throw new Error(`Web config: Invalid API_URL '${rawApiUrl}'`);
  }

  return {
    apiUrl: rawApiUrl.replace(/\/+$/, ""),
  };
}
