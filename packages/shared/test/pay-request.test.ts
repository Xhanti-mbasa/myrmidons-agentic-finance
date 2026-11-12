import { describe, expect, it } from "vitest";
import { PayRequest } from "../src/index";

const valid = { supplierId: "sup_karoo", amount: "30.00", invoiceNumber: "INV-1042", reason: "Cotton bolts" };

describe("PayRequest", () => {
  it("accepts a payment to a supplier ID", () => {
    expect(PayRequest.safeParse(valid).success).toBe(true);
  });

  it.each(["destination", "address", "Destination", "payTo"])(
    "rejects a request that also carries a %s field, so no address can ride along",
    (field) => {
      expect(PayRequest.safeParse({ ...valid, [field]: "rXYZattacker111111111111111" }).success).toBe(false);
    },
  );
});
