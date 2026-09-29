import assert from "node:assert/strict";
import { test } from "node:test";
import { issueInvoice } from "./billing.ts";
import { loadInvoiceDocument } from "./documents.ts";
import {
  getEtimsView,
  initializeEtimsDevice,
  publicEtimsSettings,
  queueEtimsForInvoice,
  retryEtimsInvoice,
  saveEtimsSettings,
  submitInvoiceToEtims,
  testEtimsConnection,
} from "./etims.ts";
import {
  assertProductionSwitch,
  buildSalesPayload,
  classifyOscuFailure,
  etimsCustomerFields,
  etimsHealth,
  etimsReceiptQrUrl,
  isKraPin,
  redactSecrets,
} from "./etims-format.ts";
import { enqueueJob, processQueuedJobs } from "./jobs.ts";
import { etimsQrPng, renderInvoicePdf } from "./pdf/invoice.ts";
import { looksLikeSecret, open } from "./secrets.ts";
import { openTestDb, type Sql } from "./test-db.ts";
import type { InvoiceDocument } from "./document-format.ts";

const PIN = "A123456789Z";
const KEY = "SECRET-KEY-12345";
const CODES = {
  defaultItemCd: "KE1NTX0000001",
  defaultItemClsCd: "99000000",
  defaultTaxTyCd: "B",
  defaultQtyUnitCd: "U",
  defaultPkgUnitCd: "NT",
};

type Hit = { url: string; init?: RequestInit };

function kraFetch(routes: (hit: Hit) => { status?: number; body: unknown } | "throw") {
  const hits: Hit[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const hit = { url: String(url), init };
    hits.push(hit);
    const route = routes(hit);
    if (route === "throw") throw new Error(`network down cmcKey=${KEY}`);
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchImpl, hits };
}

function ok(data: unknown) {
  return { body: { resultCd: "000", resultMsg: "It is succeeded", data } };
}

async function seed(sql: Sql) {
  await sql`insert into tenants (id, name, slug) values ('ten_a', 'Alpha Fibre', 'alpha'), ('ten_b', 'Beta Fibre', 'beta')`;
  await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
    values ('pkg_a', 'ten_a', '10 Mbps', 'pppoe', 10, 10, 2500), ('pkg_b', 'ten_b', 'Other', 'pppoe', 10, 10, 2500)`;
  await sql`insert into customers (id, tenant_id, name, phone) values
    ('cus_a', 'ten_a', 'Amina', '0711000001'), ('cus_b', 'ten_b', 'Otieno', '0711000002')`;
}

function paper(etims: InvoiceDocument["etims"]): InvoiceDocument {
  return {
    kind: "invoice",
    brand: {
      tenantId: "ten_a",
      name: "Alpha Fibre",
      slug: "alpha",
      address: "",
      phone: "",
      email: "",
      website: "",
      taxPin: "",
      vatEnabled: false,
      vatRate: 0,
      currency: "KES",
      timezone: "Africa/Nairobi",
      footer: "",
      notes: "",
      brandColor: "#4aa8a0",
      bankName: "",
      bankAccount: "",
      bankBranch: "",
      paymentMethods: [],
    },
    invoice: {
      id: "inv",
      number: "INV-1001",
      status: "issued",
      statusLabel: "Issued",
      issuedAt: "2026-09-29T09:00:00.000Z",
      dueDate: "2026-10-15",
      notes: "",
    },
    customer: { id: "cus", name: "Amina", accountNo: "ALP-1", phone: "", email: "", address: "" },
    lines: [{ description: "10 Mbps", packageName: "10 Mbps", period: "Sep", quantity: 1, unit: 2500, discount: 0, tax: 0, total: 2500 }],
    totals: {
      subtotal: 2500,
      discount: 0,
      tax: 0,
      taxRate: 0,
      previousBalance: 0,
      payments: 0,
      amountDue: 2500,
      totalPayable: 2500,
      creditBalance: 0,
    },
    payments: [],
    etims,
  };
}

test("sandbox is the default and production needs confirmation", async () => {
  assert.equal(isKraPin("a123456789z"), true);
  assert.equal(isKraPin("123"), false);
  assert.equal(etimsHealth({ enabled: false, status: "not_initialized", lastError: "", lastSuccessAt: null }).title, "Off");
  assert.equal(etimsHealth({ enabled: true, status: "not_initialized", lastError: "", lastSuccessAt: null }).title, "Action required");
  assert.equal(etimsHealth({ enabled: true, status: "initialized", lastError: "", lastSuccessAt: null }).title, "Connected");
  assert.equal(etimsHealth({ enabled: true, status: "error", lastError: "PIN rejected", lastSuccessAt: null }).title, "Error");
  assert.throws(() => assertProductionSwitch("sandbox", "production", false), /Confirm production/);
  assert.doesNotThrow(() => assertProductionSwitch("sandbox", "production", true));
  assert.equal(classifyOscuFailure("001", 200), "transient");
  assert.equal(classifyOscuFailure("902", 200), "rejected");
  assert.equal(classifyOscuFailure("", 503), "transient");
  assert.equal(etimsCustomerFields({ status: "pending", rcptNo: "19", qrUrl: "https://example.invalid", signature: "SIG" }), null);
  assert.equal(etimsCustomerFields({ status: "failed", rcptNo: "19", qrUrl: "https://example.invalid", signature: "SIG" }), null);
  assert.equal(redactSecrets(`boom cmcKey=${KEY}`, [KEY]).includes(KEY), false);
  assert.equal(looksLikeSecret("cmcKey"), true);
  assert.equal(JSON.stringify(publicEtimsSettings(null)).includes("cmcKey"), false);

  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    const fresh = await getEtimsView(sql, "ten_a");
    assert.equal(fresh.enabled, false);
    assert.equal(fresh.environment, "sandbox");
    assert.equal(fresh.hasKey, false);
    await assert.rejects(
      () => saveEtimsSettings(sql, "ten_a", "user_a", { enabled: true, environment: "production", kraPin: PIN, branchId: "00", deviceSerial: "KRA-DEV-1", confirmProduction: false }),
      /Confirm production/,
    );
    const saved = await saveEtimsSettings(sql, "ten_a", "user_a", {
      enabled: true,
      environment: "production",
      kraPin: PIN,
      branchId: "00",
      deviceSerial: "KRA-DEV-1",
      confirmProduction: true,
    });
    assert.equal(saved.environment, "production");
    assert.equal(saved.productionConfirmed, true);
    const [audit] = await sql<{ action: string }>`select action from audit_logs where tenant_id = 'ten_a' and action = 'ETIMS_ENABLED'`;
    assert.equal(audit?.action, "ETIMS_ENABLED");
  } finally {
    await close();
  }
});

test("initialization stores a sealed key and does not repeat itself", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  const { fetchImpl, hits } = kraFetch((hit) => {
    assert.equal(hit.url.endsWith("/selectInitOsdcInfo"), true);
    const headers = new Headers(hit.init?.headers);
    assert.equal(headers.get("cmcKey"), null);
    const body = JSON.parse(String(hit.init?.body)) as { tin: string; bhfId: string; dvcSrlNo: string; cmcKey?: string };
    assert.equal(body.tin, PIN);
    assert.equal(body.bhfId, "00");
    assert.equal(body.dvcSrlNo, "KRA-DEV-1");
    assert.equal(body.cmcKey, undefined);
    return ok({ info: { cmcKey: KEY, tradeNm: "Alpha Fibre", bhfNm: "Head office", sdcId: "SDC1", mrcNo: "MRC1" } });
  });
  try {
    await bypass();
    await seed(sql);
    await saveEtimsSettings(sql, "ten_a", "user_a", {
      enabled: true,
      environment: "sandbox",
      kraPin: PIN,
      branchId: "00",
      deviceSerial: "KRA-DEV-1",
    });
    const first = await initializeEtimsDevice(sql, "ten_a", "user_a", { fetchImpl });
    assert.equal(first.already, false);
    assert.equal(first.view.hasKey, true);
    assert.equal(first.view.status, "initialized");
    assert.equal(JSON.stringify(first.view).includes(KEY), false);
    const [stored] = await sql<{ comm_key_sealed: string }>`select comm_key_sealed from etims_settings where tenant_id = 'ten_a'`;
    assert.match(stored?.comm_key_sealed || "", /^enc:v1:/);
    assert.equal(open(stored?.comm_key_sealed || ""), KEY);
    const second = await initializeEtimsDevice(sql, "ten_a", "user_a", { fetchImpl });
    assert.equal(second.already, true);
    assert.equal(hits.length, 1);
    await sql`update etims_settings set init_lock_at = now(), status = 'not_initialized', comm_key_sealed = '' where tenant_id = 'ten_a'`;
    await assert.rejects(() => initializeEtimsDevice(sql, "ten_a", "user_a", { force: true, fetchImpl }), /already running/);
    await asRole("ten_b");
    const hidden = await sql<{ n: number }>`select count(*)::int as n from etims_settings`;
    assert.equal(hidden[0]?.n, 0);
    const leaked = await testEtimsConnection(sql, "ten_a", fetchImpl);
    assert.equal(leaked.ok, false);
  } finally {
    await close();
  }
});

test("disabled tenants do not queue and a KRA outage does not block the invoice", async () => {
  const { sql, bypass, close } = await openTestDb();
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("kra down");
  }) as typeof fetch;
  try {
    await bypass();
    await seed(sql);
    await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, status, due_date)
      values ('inv_old', 'ten_a', 'cus_a', 'INV-OLD', 1000, 'issued', '2026-08-01')`;
    const old = await sql<{ etims_status: string }>`select etims_status from invoices where id = 'inv_old'`;
    assert.equal(old[0]?.etims_status, "not_applicable");
    const skipped = await issueInvoice(sql, {
      tenantId: "ten_a",
      customerId: "cus_a",
      dueDate: "2026-10-15",
      items: [{ description: "10 Mbps", quantity: 1, unit_kes: 2500, package_id: "pkg_a" }],
    });
    const [plain] = await sql<{ etims_status: string }>`select etims_status from invoices where id = ${skipped.id}`;
    assert.equal(plain?.etims_status, "not_applicable");
    const noJobs = await sql<{ n: number }>`select count(*)::int as n from job_queue where kind = 'etims.submit'`;
    assert.equal(noJobs[0]?.n, 0);

    await saveEtimsSettings(sql, "ten_a", "user_a", {
      enabled: true,
      environment: "sandbox",
      kraPin: PIN,
      branchId: "00",
      deviceSerial: "KRA-DEV-1",
      ...CODES,
    });
    const [historical] = await sql<{ etims_status: string }>`select etims_status from invoices where id = 'inv_old'`;
    assert.equal(historical?.etims_status, "not_applicable");
    const issued = await issueInvoice(sql, {
      tenantId: "ten_a",
      customerId: "cus_a",
      dueDate: "2026-10-20",
      items: [{ description: "10 Mbps", quantity: 1, unit_kes: 2500, package_id: "pkg_a" }],
    });
    const [pending] = await sql<{ etims_status: string }>`select etims_status from invoices where id = ${issued.id}`;
    assert.equal(pending?.etims_status, "pending");
    const queued = await queueEtimsForInvoice(sql, "ten_a", issued.id);
    assert.equal(queued.queued, false);
    const processed = await processQueuedJobs(sql, { workerId: "etims-test", queue: "billing", limit: 4 });
    assert.equal(processed.results.some((row) => row.ok === false), true);
    const [still] = await sql<{ id: string; etims_status: string }>`select id, etims_status from invoices where id = ${issued.id}`;
    assert.equal(still?.id, issued.id);
    assert.equal(still?.etims_status, "pending");
  } finally {
    globalThis.fetch = orig;
    await close();
  }
});

test("submission stores KRA data once, rejects missing codes, and retries only transient failures", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  let salesSaves = 0;
  let mode: "ok" | "reject" | "transient" | "select-down" = "ok";
  const bodies: unknown[] = [];
  const { fetchImpl } = kraFetch((hit) => {
    if (hit.url.endsWith("/selectInitOsdcInfo")) {
      return ok({ info: { cmcKey: KEY, sdcId: "SDC1", mrcNo: "MRC1" } });
    }
    if (hit.url.endsWith("/selectCodeList")) {
      return ok({ clsList: [] });
    }
    if (hit.url.endsWith("/selectTrnsSalesList")) {
      if (mode === "select-down") throw new Error(`lookup cmcKey=${KEY}`);
      return ok({ saleList: [] });
    }
    if (hit.url.endsWith("/saveTrnsSalesOsdc")) {
      salesSaves += 1;
      bodies.push(JSON.parse(String(hit.init?.body)));
      const headers = new Headers(hit.init?.headers);
      assert.equal(headers.get("cmcKey"), KEY);
      if (mode === "reject") return { body: { resultCd: "902", resultMsg: "invalid item", data: null } };
      if (mode === "transient") return { status: 503, body: { resultCd: "001", resultMsg: "try later", data: null } };
      return ok({ rcptSign: "SIG123456", intrlData: "INT", totRcptNo: "19", sdcDateTime: "20260929120000" });
    }
    return { status: 404, body: { resultCd: "404", resultMsg: "nope", data: null } };
  });
  try {
    await bypass();
    await seed(sql);
    await sql`update customers set kra_pin = 'P051234567X' where id = 'cus_a'`;
    await saveEtimsSettings(sql, "ten_a", "user_a", {
      enabled: true,
      environment: "sandbox",
      kraPin: PIN,
      branchId: "00",
      deviceSerial: "KRA-DEV-1",
      ...CODES,
    });
    await initializeEtimsDevice(sql, "ten_a", "user_a", { fetchImpl });
    const tested = await testEtimsConnection(sql, "ten_a", fetchImpl);
    assert.equal(tested.ok, true);
    assert.match(tested.message, /No invoice was created/);
    assert.equal(salesSaves, 0);

    const issued = await issueInvoice(sql, {
      tenantId: "ten_a",
      customerId: "cus_a",
      dueDate: "2026-10-20",
      items: [{ description: "10 Mbps", quantity: 1, unit_kes: 2500, package_id: "pkg_a" }],
    });
    const saved = await submitInvoiceToEtims(sql, "ten_a", issued.id, fetchImpl);
    assert.equal(saved.submitted, true);
    assert.equal(salesSaves, 1);
    const payload = bodies[0] as { itemList: Array<{ itemCd: string; itemClsCd: string }>; custTin: string; invcNo: number; orgInvcNo: number; rcptTyCd: string };
    assert.equal(payload.itemList[0]?.itemCd, CODES.defaultItemCd);
    assert.equal(payload.itemList[0]?.itemClsCd, CODES.defaultItemClsCd);
    assert.equal(payload.custTin, "P051234567X");
    assert.equal(payload.orgInvcNo, 0);
    assert.equal(payload.rcptTyCd, "S");
    const again = await submitInvoiceToEtims(sql, "ten_a", issued.id, fetchImpl);
    assert.equal(again.skipped, true);
    assert.equal(salesSaves, 1);
    const [row] = await sql<{ etims_status: string; etims_rcpt_no: string; etims_qr_url: string; etims_rcpt_sign: string }>`
      select etims_status, etims_rcpt_no, etims_qr_url, etims_rcpt_sign from invoices where id = ${issued.id}`;
    assert.equal(row?.etims_status, "submitted");
    assert.equal(row?.etims_rcpt_no, "19");
    assert.match(row?.etims_qr_url || "", /etims-sbx\.kra\.go\.ke/);
    assert.match(row?.etims_qr_url || "", /SIG123456/);
    const doc = await loadInvoiceDocument(sql, "ten_a", issued.id);
    assert.equal(doc.etims?.invoiceNo, "19");
    assert.ok(doc.etims?.qrUrl);

    await asRole("ten_b");
    await assert.rejects(() => submitInvoiceToEtims(sql, "ten_a", issued.id, fetchImpl), /Invoice not found/);
    await bypass();

    await saveEtimsSettings(sql, "ten_a", "user_a", {
      enabled: true,
      environment: "sandbox",
      kraPin: PIN,
      branchId: "00",
      deviceSerial: "KRA-DEV-1",
    });
    const unmapped = await issueInvoice(sql, {
      tenantId: "ten_a",
      customerId: "cus_a",
      dueDate: "2026-10-21",
      items: [{ description: "10 Mbps", quantity: 1, unit_kes: 2500, package_id: "pkg_a" }],
    });
    const before = salesSaves;
    const rejected = await submitInvoiceToEtims(sql, "ten_a", unmapped.id, fetchImpl);
    assert.equal(rejected.rejected, true);
    assert.equal(salesSaves, before);
    const [bad] = await sql<{ etims_status: string; etims_error: string }>`select etims_status, etims_error from invoices where id = ${unmapped.id}`;
    assert.equal(bad?.etims_status, "rejected");
    assert.match(bad?.etims_error || "", /Map each package/);

    await saveEtimsSettings(sql, "ten_a", "user_a", {
      enabled: true,
      environment: "sandbox",
      kraPin: PIN,
      branchId: "00",
      deviceSerial: "KRA-DEV-1",
      ...CODES,
    });
    mode = "reject";
    const hard = await issueInvoice(sql, {
      tenantId: "ten_a",
      customerId: "cus_a",
      dueDate: "2026-10-22",
      items: [{ description: "10 Mbps", quantity: 1, unit_kes: 2500, package_id: "pkg_a" }],
    });
    const hardHit = await submitInvoiceToEtims(sql, "ten_a", hard.id, fetchImpl);
    assert.equal(hardHit.rejected, true);
    mode = "transient";
    const soft = await issueInvoice(sql, {
      tenantId: "ten_a",
      customerId: "cus_a",
      dueDate: "2026-10-23",
      items: [{ description: "10 Mbps", quantity: 1, unit_kes: 2500, package_id: "pkg_a" }],
    });
    await assert.rejects(() => submitInvoiceToEtims(sql, "ten_a", soft.id, fetchImpl), /try later/);
    const [softRow] = await sql<{ etims_status: string }>`select etims_status from invoices where id = ${soft.id}`;
    assert.equal(softRow?.etims_status, "pending");
    mode = "select-down";
    await assert.rejects(() => submitInvoiceToEtims(sql, "ten_a", soft.id, fetchImpl), /lookup/);
    const retry = await retryEtimsInvoice(sql, "ten_a", "user_a", hard.id);
    assert.equal(retry.queued, true);
    const [retried] = await sql<{ action: string }>`select action from audit_logs where entity_id = ${hard.id} and action = 'ETIMS_INVOICE_RETRY'`;
    assert.equal(retried?.action, "ETIMS_INVOICE_RETRY");

    await sql`delete from job_queue where tenant_id = 'ten_a'`;
    await sql`update invoices set etims_status = 'pending', etims_error = '' where id = ${soft.id}`;
    await enqueueJob(sql, {
      queue: "billing",
      kind: "etims.submit",
      tenantId: "ten_a",
      payload: { tenantId: "ten_a", invoiceId: soft.id },
      idempotencyKey: `dead:${soft.id}`,
      maxAttempts: 1,
    });
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error(`kra down cmcKey=${KEY}`);
    }) as typeof fetch;
    try {
      await processQueuedJobs(sql, { workerId: "etims-dead", queue: "billing", limit: 8 });
    } finally {
      globalThis.fetch = orig;
    }
    const [dead] = await sql<{ etims_status: string; etims_error: string }>`select etims_status, etims_error from invoices where id = ${soft.id}`;
    assert.equal(dead?.etims_status, "failed");
    assert.equal((dead?.etims_error || "").includes(KEY), false);
  } finally {
    await close();
  }
});

test("PDF and QR appear only after a real KRA signature", async () => {
  const url = etimsReceiptQrUrl("sandbox", PIN, "00", "SIG123456");
  assert.match(url, /^https:\/\/etims-sbx\.kra\.go\.ke\/common\/link\/etims\/receipt\/indexEtimsReceiptData\?Data=/);
  assert.equal(etimsReceiptQrUrl("production", PIN, "00", ""), "");
  const png = await etimsQrPng(url);
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const plain = await renderInvoicePdf(paper(null));
  const stamped = await renderInvoicePdf(paper({ invoiceNo: "19", qrUrl: url, signature: "SIG123456" }));
  assert.equal(plain.subarray(0, 5).toString(), "%PDF-");
  assert.equal(stamped.subarray(0, 5).toString(), "%PDF-");
  assert.ok(stamped.length > plain.length + 200);
  const sample = buildSalesPayload({
    tin: PIN,
    bhfId: "00",
    invcNo: 4,
    traderInvoiceNo: "INV-4",
    customerName: "Amina",
    lines: [
      {
        name: "10 Mbps",
        quantity: 1,
        unitKes: 2500,
        taxblKes: 2500,
        taxKes: 400,
        codes: { itemCd: "FROM-ADMIN", itemClsCd: "FROM-CLASS", taxTyCd: "B", qtyUnitCd: "U", pkgUnitCd: "NT" },
      },
    ],
    actor: "isp",
  });
  assert.equal(sample.itemList[0]?.itemCd, "FROM-ADMIN");
  assert.equal(sample.taxRtB, 16);
  assert.equal(sample.taxAmtB, 400);
});
