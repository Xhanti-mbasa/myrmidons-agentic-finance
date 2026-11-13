import { CosignRequest, CosignResponse } from "@shucamoxa/shared";
import type { PolicyClientLike } from "./types";

export class HttpPolicyClient implements PolicyClientLike {
  constructor(
    private readonly url: string,
    private readonly token?: string,
  ) {}

  async cosign(request: CosignRequest): Promise<CosignResponse> {
    let res: Response;
    try {
      res = await fetch(`${this.url}/cosign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify(request),
      });
    } catch (err: any) {
      const error = new Error(`Policy service unreachable: ${err?.message ?? "fetch failed"}`);
      (error as any).status = 503;
      throw error;
    }

    if (!res.ok) {
      if (res.status >= 500 || res.status === 503) {
        const error = new Error(`Policy service error: ${res.status} ${res.statusText}`);
        (error as any).status = 503;
        throw error;
      }
      throw new Error(`Policy service returned status ${res.status}`);
    }

    const json = await res.json();
    return CosignResponse.parse(json);
  }
}
