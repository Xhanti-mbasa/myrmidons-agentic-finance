import { type NextRequest } from "next/server";
import { loadWebConfig } from "./env";

export type ProxyOptions = {
  apiUrl?: string;
  fetch?: typeof fetch;
};

/**
 * Rejects path traversal and dangerous characters in raw URL pathname and decoded segments.
 */
function isPathTraversal(pathSegments: string[], rawUrl: string): boolean {
  let pathname = rawUrl;
  try {
    pathname = new URL(rawUrl).pathname;
  } catch {
    // If rawUrl is just a path
  }

  const lowerPath = pathname.toLowerCase();
  if (
    lowerPath.includes("..") ||
    lowerPath.includes("%2f") ||
    lowerPath.includes("%2e") ||
    lowerPath.includes("http:") ||
    lowerPath.includes("https:") ||
    lowerPath.includes("\\")
  ) {
    return true;
  }

  for (const segment of pathSegments) {
    const decoded = decodeURIComponent(segment);
    if (
      segment === "." ||
      segment === ".." ||
      decoded === "." ||
      decoded === ".." ||
      segment.includes("/") ||
      segment.includes("\\") ||
      segment.includes(":") ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      decoded.includes(":")
    ) {
      return true;
    }
  }

  return false;
}

export async function handleProxyRequest(
  request: NextRequest,
  pathSegments: string[],
  options: ProxyOptions = {},
): Promise<Response> {
  const rawUrl = request.url || "";

  if (isPathTraversal(pathSegments, rawUrl)) {
    return Response.json(
      { error: "bad_request", message: "Path traversal rejected" },
      { status: 400 },
    );
  }

  const apiBaseUrl = options.apiUrl || loadWebConfig().apiUrl;
  const fetchFn = options.fetch || fetch;

  const targetBase = new URL(apiBaseUrl);
  // Construct clean path ensuring leading slash
  const subPath = pathSegments.map((s) => encodeURIComponent(s)).join("/");
  const basePath = targetBase.pathname.endsWith("/")
    ? targetBase.pathname.slice(0, -1)
    : targetBase.pathname;
  const finalPath = `${basePath}/${subPath}`;

  const targetUrl = new URL(finalPath, targetBase.origin);

  // Security check: ensure target URL is strictly within the target origin and path
  if (
    targetUrl.origin !== targetBase.origin ||
    !targetUrl.pathname.startsWith(basePath)
  ) {
    return Response.json(
      { error: "bad_request", message: "Path escaped target origin" },
      { status: 400 },
    );
  }

  // Preserve query parameters if present
  const search = request.nextUrl.search;
  if (search) {
    targetUrl.search = search;
  }

  // Construct forwarded headers: strictly forward only session cookie and Origin
  const forwardHeaders = new Headers();

  const origin = request.headers.get("origin");
  if (origin) {
    forwardHeaders.set("origin", origin);
  }

  const sessionCookie =
    request.cookies.get("session")?.value ||
    request.cookies.get("shucamoxa_session")?.value;
  if (sessionCookie) {
    forwardHeaders.set("cookie", `session=${sessionCookie}`);
  }

  // Forward Content-Type for request bodies
  const contentType = request.headers.get("content-type");
  if (contentType) {
    forwardHeaders.set("content-type", contentType);
  }

  // Ensure Authorization is never forwarded
  forwardHeaders.delete("authorization");

  let body: string | undefined;
  if (
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    request.body !== null
  ) {
    try {
      body = await request.text();
    } catch {
      body = undefined;
    }
  }

  try {
    const backendResponse = await fetchFn(targetUrl.toString(), {
      method: request.method,
      headers: forwardHeaders,
      body,
    });

    // Forward response headers
    const responseHeaders = new Headers();
    for (const [key, value] of backendResponse.headers.entries()) {
      // Don't forward hop-by-hop headers
      const lower = key.toLowerCase();
      if (
        lower !== "transfer-encoding" &&
        lower !== "connection" &&
        lower !== "keep-alive"
      ) {
        responseHeaders.set(key, value);
      }
    }

    const responseBody = await backendResponse.arrayBuffer();
    return new Response(responseBody, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    return Response.json(
      {
        error: "bad_gateway",
        message: "Failed to connect to backend API",
      },
      { status: 502 },
    );
  }
}
