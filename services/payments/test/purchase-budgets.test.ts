import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PurchaseBudgetService, purchaseWeekStart, purchasePeriodStart } from "../src/purchase-budgets";
import { toMicros, fromMicros } from "../../../packages/shared/src/index";
const owner = {ownerId:"business",subjectId:"owner",role:"owner"} as const;
const agent = {...owner,subjectId:"agent",role:"agent"} as const;
const policy = {enabled:true,timezone:"Africa/Johannesburg",categories:{articles:{perPurchaseZar:"0.10",period:"weekly",periodBudgetZar:"0.20",merchantIds:["publisher"],autoPurchase:true},data:{perPurchaseZar:"1",period:"weekly",periodBudgetZar:"1",merchantIds:["publisher"],autoPurchase:true}}};
const cleanup: (()=>void)[] = [];
afterEach(()=>{for (const fn of cleanup.splice(0)) fn();});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(),"purchase-budget-")), path = join(dir,"budget.db");
  let time = new Date("2026-11-13T12:00:00Z"), rate="20";
  const adapters = {quotes:{resolve:(id:string)=>({id,source:"controlled-test-quote",zarPerRlusd:rate,issuedAt:"2026-11-01T00:00:00Z",expiresAt:"2026-12-01T00:00:00Z"})},
    outcomes:{verify:(_reservation:unknown,evidence:unknown)=>evidence === "verified-settlement" ? "settled" as const : evidence === "verified-rejection" ? "rejected" as const : "unknown" as const}};
  const services: PurchaseBudgetService[]=[];
  const open=()=>{const service=new PurchaseBudgetService(path,adapters,()=>time);services.push(service);return service;};
  const service=open(); service.setPolicy(owner,policy);
  cleanup.push(()=>{services.forEach(s=>s.close());rmSync(dir,{recursive:true,force:true});});
  const request=(extra:Record<string,string>={})=>({purchaseId:randomUUID(),merchantId:"publisher",categoryId:"articles",resourceHash:"a".repeat(64),amountRlusd:"0.005",feeRlusd:"0",quoteId:"quote",...extra});
  return {service,open,request,advance:(value:string)=>{time=new Date(value);},rate:(value:string)=>{rate=value;}};
}
describe("independent category purchase budgets",()=>{
  it("uses owner-selected daily and monthly Johannesburg boundaries",()=>{
    expect(purchasePeriodStart(new Date("2026-11-30T21:59:59Z"),"daily")).toBe("2026-11-29T22:00:00.000Z");
    expect(purchasePeriodStart(new Date("2026-11-30T22:00:00Z"),"daily")).toBe("2026-11-30T22:00:00.000Z");
    expect(purchasePeriodStart(new Date("2026-11-30T22:00:00Z"),"monthly")).toBe("2026-11-30T22:00:00.000Z");
    const f=fixture();
    f.service.setPolicy(owner,{...policy,categories:{articles:{...policy.categories.articles,period:"daily"}}});
    expect(f.service.reserve(agent,f.request()).period).toBe("daily");
    expect(()=>f.service.reserve(agent,f.request({amountRlusd:"0.015"}))).toThrow("OVER_PER_PURCHASE_CAP");
  });
  it("does not erase settled spend when owner changes the category period",()=>{
    const f=fixture(), first=f.service.reserve(agent,f.request());
    f.service.authorize(agent,first.purchaseId);
    f.service.recordOutcome(agent,first.purchaseId,"verified-settlement");
    f.service.setPolicy(owner,{...policy,categories:{articles:{...policy.categories.articles,period:"daily",periodBudgetZar:"0.10"}}});
    expect(f.service.remaining(owner,"articles")).toMatchObject({spentZar:"0.100000",remainingZar:"0.000000"});
    expect(()=>f.service.reserve(agent,f.request())).toThrow("OVER_PERIOD_BUDGET");
  });
  it("uses exact micro precision, rejects exponent/float input and rounds charges upward",()=>{
    expect(fromMicros(toMicros("0.000001"))).toBe("0.000001");
    expect(()=>toMicros("1e-6")).toThrow();
    const f=fixture();f.rate("0.000001");
    expect(f.service.reserve(agent,f.request({amountRlusd:"0.000001"})).chargedZar).toBe("0.000001");
  });
  it("permits the last purchase and blocks the first over budget across two connections",()=>{
    const f=fixture(),second=f.open();
    f.service.reserve(agent,f.request());second.reserve(agent,f.request());
    expect(()=>f.service.reserve(agent,f.request())).toThrow("OVER_PERIOD_BUDGET");
    expect(f.service.remaining(owner,"articles")).toMatchObject({reservedZar:"0.200000",remainingZar:"0.000000"});
    expect(f.service.reserve(agent,f.request({categoryId:"data"})).chargedZar).toBe("0.100000");
  });
  it("requires owner changes, approved merchants and explicit payment when auto is disabled",()=>{
    const f=fixture();expect(()=>f.service.setPolicy(agent,policy)).toThrow("NOT_AUTHORIZED");
    expect(()=>f.service.reserve(agent,f.request({merchantId:"unknown"}))).toThrow("MERCHANT_NOT_APPROVED");
    f.service.setPolicy(owner,{...policy,categories:{articles:{...policy.categories.articles,autoPurchase:false}}});
    expect(()=>f.service.reserve(agent,f.request())).toThrow("OWNER_APPROVAL_REQUIRED");
    expect(f.service.reserve(owner,f.request()).state).toBe("reserved");
  });
  it("does not equate rand to RLUSD and includes declared fees at the trusted quote rate",()=>{
    const f=fixture();expect(()=>f.service.reserve(agent,f.request({amountRlusd:"0.10"}))).toThrow("OVER_PER_PURCHASE_CAP");
    expect(()=>f.service.reserve(agent,f.request({feeRlusd:"0.000001"}))).toThrow("OVER_PER_PURCHASE_CAP");
    f.rate("21");expect(()=>f.service.reserve(agent,f.request())).toThrow("OVER_PER_PURCHASE_CAP");
    f.rate("10");expect(f.service.reserve(agent,f.request()).chargedZar).toBe("0.050000");
  });
  it("deduplicates canonically after restart and refuses changed resource, amount or quote",()=>{
    const f=fixture(),request=f.request(),reserved=f.service.reserve(agent,request),second=f.open();
    expect(second.reserve(agent,{...request,amountRlusd:"0.005000"})).toEqual(reserved);
    expect(()=>second.reserve(agent,{...request,resourceHash:"b".repeat(64)})).toThrow("PURCHASE_MISMATCH");
    expect(()=>second.reserve(agent,{...request,amountRlusd:"0.004"})).toThrow("PURCHASE_MISMATCH");
    expect(second.remaining(owner,"articles").reservedZar).toBe("0.100000");
  });
  it("uses Monday Johannesburg midnight and retains unknown reservations through rollover",()=>{
    expect(purchaseWeekStart(new Date("2026-11-15T21:59:59Z"))).toBe("2026-11-08T22:00:00.000Z");
    expect(purchaseWeekStart(new Date("2026-11-15T22:00:00Z"))).toBe("2026-11-15T22:00:00.000Z");
    const f=fixture(),a=f.service.reserve(agent,f.request()),b=f.service.reserve(agent,f.request());
    f.service.authorize(agent,a.purchaseId); f.service.authorize(agent,b.purchaseId);
    f.service.recordOutcome(agent,a.purchaseId,"verified-settlement");
    f.advance("2026-11-16T00:00:00Z");const second=f.open();
    expect(second.remaining(owner,"articles")).toMatchObject({spentZar:"0.000000",reservedZar:"0.100000",remainingZar:"0.100000"});
    second.recordOutcome(agent,b.purchaseId,"untrusted-claimed-success");
    expect(second.remaining(owner,"articles").reservedZar).toBe("0.100000");
    second.recordOutcome(agent,b.purchaseId,"verified-settlement");
    expect(second.remaining(owner,"articles")).toMatchObject({spentZar:"0.100000",reservedZar:"0.000000"});
    second.reserve(agent,f.request());expect(()=>second.reserve(agent,f.request())).toThrow("OVER_PERIOD_BUDGET");
  });
  it("rechecks kill switch, version and quote expiry before authority, without releasing uncertain capacity",()=>{
    const f=fixture(),a=f.service.reserve(agent,f.request());
    f.service.setPolicy(owner,{...policy,enabled:false});
    expect(()=>f.service.authorize(agent,a.purchaseId)).toThrow("KILL_SWITCH_ON");
    f.service.setPolicy(owner,policy);
    expect(()=>f.service.authorize(agent,a.purchaseId)).toThrow("POLICY_CHANGED");
    const b=f.service.reserve(agent,f.request());f.advance("2026-12-01T00:00:00Z");
    expect(()=>f.service.authorize(agent,b.purchaseId)).toThrow("QUOTE_UNAVAILABLE");
    expect(f.service.remaining(owner,"articles").reservedZar).toBe("0.200000");
  });
  it("never reauthorizes unknown or completed purchases and only verified rejection releases funds",()=>{
    const f=fixture(),a=f.service.reserve(agent,f.request());f.service.authorize(agent,a.purchaseId);
    expect(()=>f.service.authorize(agent,a.purchaseId)).toThrow("PURCHASE_ALREADY_EXECUTED");
    f.service.recordOutcome(agent,a.purchaseId,{});expect(f.service.remaining(owner,"articles").reservedZar).toBe("0.100000");
    f.service.recordOutcome(agent,a.purchaseId,"verified-rejection");expect(f.service.remaining(owner,"articles").reservedZar).toBe("0.000000");
    expect(f.service.reserve(agent,f.request({purchaseId:a.purchaseId})).state).toBe("rejected");
  });
});
