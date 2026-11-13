import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { handleProxyRequest } from "../src/proxy";

describe("API Proxy handler", () => {
  const API_URL = "http://127.0.0.1:8790";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards session cookie and Origin to API_URL, and drops Authorization", async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: Headers | undefined;

    const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = new Headers(init.headers);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const req = new NextRequest("http://localhost:3000/api/rules", {
      method: "GET",
      headers: {
        cookie: "session=owner_session_123; untrusted_cookie=foo",
        origin: "http://localhost:3000",
        authorization: "Bearer malicious-token",
        "x-custom-browser-header": "test",
      },
    });

    const res = await handleProxyRequest(req, ["rules"], { apiUrl: API_URL, fetch: mockFetch });

    expect(res.status).toBe(200);
    expect(capturedUrl).toBe("http://127.0.0.1:8790/rules");
    expect(capturedHeaders?.get("origin")).toBe("http://localhost:3000");
    expect(capturedHeaders?.get("cookie")).toBe("session=owner_session_123");
    expect(capturedHeaders?.get("cookie")).not.toContain("untrusted_cookie");
    expect(capturedHeaders?.get("authorization")).toBeNull();
    expect(capturedHeaders?.get("x-custom-browser-header")).toBeNull();
  });

  it("forwards shucamoxa_session cookie as session cookie", async () => {
    let capturedHeaders: Headers | undefined;
    const mockFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedHeaders = new Headers(init.headers);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const req = new NextRequest("http://localhost:3000/api/approvals", {
      headers: {
        cookie: "shucamoxa_session=custom_sess_456",
        origin: "http://localhost:3000",
      },
    });

    await handleProxyRequest(req, ["approvals"], { apiUrl: API_URL, fetch: mockFetch });
    expect(capturedHeaders?.get("cookie")).toContain("session=custom_sess_456");
  });

  it("forwards request query parameters to API_URL", async () => {
    let capturedUrl: string | undefined;
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ found: true }), { status: 200 });
    });

    const req = new NextRequest("http://localhost:3000/api/suppliers?q=karoo", {
      headers: { origin: "http://localhost:3000" },
    });

    await handleProxyRequest(req, ["suppliers"], { apiUrl: API_URL, fetch: mockFetch });
    expect(capturedUrl).toBe("http://127.0.0.1:8790/suppliers?q=karoo");
  });

  it("forwards POST body and returns backend response headers and body", async () => {
    let capturedBody: string | undefined;
    const mockFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return new Response(JSON.stringify({ outcome: "pending" }), {
        status: 201,
        headers: {
          "content-type": "application/json",
          "set-cookie": "session=new_session_xyz; HttpOnly",
        },
      });
    });

    const req = new NextRequest("http://localhost:3000/api/approvals", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ invoiceId: "INV-1" }),
    });

    const res = await handleProxyRequest(req, ["approvals"], { apiUrl: API_URL, fetch: mockFetch });
    expect(res.status).toBe(201);
    expect(capturedBody).toBe(JSON.stringify({ invoiceId: "INV-1" }));
    expect(res.headers.get("set-cookie")).toContain("session=new_session_xyz");
  });

  it("rejects path traversal with status 400 and never forwards", async () => {
    const mockFetch = vi.fn();

    const traversalRequests = [
      new NextRequest("http://localhost:3000/api/..%2f..%2fhttp:%2f%2fevil"),
      new NextRequest("http://localhost:3000/api/../../etc/passwd"),
      new NextRequest("http://localhost:3000/api/%2e%2e/admin"),
      new NextRequest("http://localhost:3000/api/%2e%2e%2fadmin"),
    ];

    for (const req of traversalRequests) {
      const res = await handleProxyRequest(req, ["..", "evil"], { apiUrl: API_URL, fetch: mockFetch });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("bad_request");
    }

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("never forwards to a URL outside API_URL", async () => {
    const mockFetch = vi.fn();
    const req = new NextRequest("http://localhost:3000/api/http://evil.com/steal");
    const res = await handleProxyRequest(req, ["http:", "evil.com", "steal"], { apiUrl: API_URL, fetch: mockFetch });
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
