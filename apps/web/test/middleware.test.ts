import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../src/middleware";

describe("Web middleware session auth", () => {
  it("redirects to /login when no session cookie is present for authenticated pages", () => {
    const pages = ["/", "/rules", "/approvals", "/activity", "/chat"];
    for (const page of pages) {
      const req = new NextRequest(`http://localhost:3000${page}`);
      const res = middleware(req);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("http://localhost:3000/login");
    }
  });

  it("allows access to /login without a session cookie", () => {
    const req = new NextRequest("http://localhost:3000/login");
    const res = middleware(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("allows access to authenticated pages when a session cookie is present", () => {
    const req = new NextRequest("http://localhost:3000/rules", {
      headers: {
        cookie: "session=mock-owner-session-token",
      },
    });
    const res = middleware(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("supports shucamoxa_session cookie name as well", () => {
    const req = new NextRequest("http://localhost:3000/approvals", {
      headers: {
        cookie: "shucamoxa_session=mock-owner-session-token",
      },
    });
    const res = middleware(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});
