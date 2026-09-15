import assert from "node:assert/strict";
import { test } from "node:test";
import { createCredentialAccount, provisionTenant } from "./accounts.ts";
import {
  loadPortalHome,
  loadPortalPaymentMethods,
  loadPortalTickets,
  makePortalInvoiceFile,
  openPortalTicket,
  pollPortalPayment,
  sanitizeInvoiceForPortal,
  startPortalPayment,
} from "./customer-portal.ts";
import { commentTicket, openTicket } from "./tickets.ts";
import {
  assertUniqueCustomerPhone,
  ensureInitialPortalPassword,
  portalContext,
  portalPasswordLogin,
  resolvePortalNetwork,
  setPortalPassword,
} from "./portal.ts";
import { portalSlugFromSearch, slugFromPortalHost } from "./portal-network.ts";
import {
  customerSafeText,
  enteredMatchesPhone,
  maskReference,
  phonePasswordCandidates,
} from "./customer-portal-format.ts";
import { openTestDb } from "./test-db.ts";

function assertSafe(payload: unknown) {
  const json = JSON.stringify(payload);
  const lower = json.toLowerCase();
  for (const needle of [
    "pppoe_secret",
    "download_mbps",
    "upload_mbps",
    "static_ip",
    "10.10.10.8",
    "client_secret",
    "passkey",
    "wireguard",
    "genieacs",
    "radius",
    "mikrotik",
    "access_method",
    "vlan",
  ]) {
    assert.equal(lower.includes(needle), false, `leaked ${needle}`);
  }
}

test("portal host and link pick the ISP without a typed slug", () => {
  const tenants = [
    { slug: "imani", public_base_url: "https://portal.imani.ke" },
    { slug: "northline", public_base_url: "https://northline.example" },
  ];
  assert.equal(slugFromPortalHost("portal.imani.ke", tenants), "imani");
  assert.equal(slugFromPortalHost("www.portal.imani.ke", tenants), "imani");
  assert.equal(slugFromPortalHost("imani.ispsolutions.app", tenants), "imani");
  assert.equal(slugFromPortalHost("portal.ispsolutions.app", tenants), null);
  assert.equal(slugFromPortalHost("grok.com", tenants), null);
  assert.equal(portalSlugFromSearch("?slug=imani"), "imani");
  assert.equal(portalSlugFromSearch("isp=northline"), "northline");
});

test("phone variants match the registered number", () => {
  assert.equal(enteredMatchesPhone("0712000111", "0712000111"), true);
  assert.equal(enteredMatchesPhone("0712000111", "254712000111"), true);
  assert.equal(enteredMatchesPhone("0712000111", "+254712000111"), true);
  assert.equal(enteredMatchesPhone("0712000111", "0712999999"), false);
  assert.ok(phonePasswordCandidates("0712000111").includes("254712000111"));
  assert.equal(maskReference("QK12345678").endsWith("5678"), true);
  assert.ok(!maskReference("QK12345678").includes("QK12345678"));
  assert.equal(customerSafeText("Fiber 10/2 Mbps urban", "Home 10"), "Home 10");
  assert.equal(customerSafeText("Home 10", "Internet service"), "Home 10");
  assert.equal(customerSafeText("PPPoE user on VLAN 20", "Internet service"), "Internet service");
});

test("portal invoice sanitizer strips credentials and masks receipts", () => {
  const safe = sanitizeInvoiceForPortal({
    kind: "invoice",
    brand: {
      tenantId: "t",
      name: "PortalNet",
      slug: "portalnet",
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
    invoice: { id: "inv", number: "INV-1", status: "due", statusLabel: "Unpaid", issuedAt: "2026-09-01", dueDate: "2026-09-10", notes: "PPPoE on router" },
    customer: { id: "cus", name: "Amina", accountNo: "PN-1", phone: "0712", email: "", address: "" },
    lines: [{ description: "Fiber 10/2 Mbps urban", packageName: "Home 10", period: "Sep", quantity: 1, unit: 2500, discount: 0, tax: 0, total: 2500 }],
    totals: { subtotal: 2500, discount: 0, tax: 0, taxRate: 0, previousBalance: 0, payments: 0, amountDue: 2500, totalPayable: 2500, creditBalance: 0 },
    payments: [{ provider: "mpesa", reference: "QKSECRET99", amount: 500, paidAt: "2026-09-02" }],
  });
  assert.equal(safe.invoice.notes, "");
  assert.equal(safe.lines[0]?.description, "Home 10");
  assert.ok(safe.payments[0]?.reference.includes("•"));
  assert.ok(!JSON.stringify(safe).includes("QKSECRET99"));
  assert.ok(!JSON.stringify(safe).toLowerCase().includes("pppoe"));
  assert.ok(!JSON.stringify(safe).toLowerCase().includes("mbps"));
});

test("portal network resolves from the ISP domain", async () => {
  const { sql, close } = await openTestDb();
  try {
    const owner = await createCredentialAccount(sql, {
      email: "host-owner@isp.test",
      password: "OwnerPass1",
      name: "Owner",
    });
    const ws = await provisionTenant(sql, owner.id, { ispName: "HostNet" });
    await sql`update tenants set public_base_url = 'https://portal.hostnet.ke' where id = ${ws.tenantId}`;
    const byHost = await resolvePortalNetwork(sql, { host: "portal.hostnet.ke" });
    assert.equal(byHost?.slug, ws.slug);
    assert.equal(byHost?.source, "host");
    const bySlug = await resolvePortalNetwork(sql, { slug: ws.slug, host: "unrelated.example" });
    assert.equal(bySlug?.source, "slug");
    assert.equal(await resolvePortalNetwork(sql, { host: "other.ke" }), null);
  } finally {
    await close();
  }
});

test("customer portal phone login, safe DTO, STK pending, ticket privacy", async () => {
  const { sql, close } = await openTestDb();
  try {
    const owner = await createCredentialAccount(sql, {
      email: "portal-owner@isp.test",
      password: "OwnerPass1",
      name: "Owner",
    });
    const ws = await provisionTenant(sql, owner.id, { ispName: "PortalNet" });
    await sql`insert into customers (id, tenant_id, name, phone, email, address, status, account_number)
      values ('cus_portal', ${ws.tenantId}, 'Amina Otieno', '0712000111', 'amina@isp.test', 'Kisumu', 'active', 'PN-1001')`;
    await sql`insert into customers (id, tenant_id, name, phone, status, account_number)
      values ('cus_other', ${ws.tenantId}, 'Other', '0712999999', 'active', 'PN-1002')`;
    await assert.rejects(() => assertUniqueCustomerPhone(sql, ws.tenantId, "254712000111"), /already exists/);

    await sql`insert into packages (id, tenant_id, name, description, access_method, download_mbps, upload_mbps, price_kes, billing_interval)
      values ('pkg_portal', ${ws.tenantId}, 'Home 10', 'Fiber 10/2 Mbps urban', 'pppoe', 10, 2, 2500, 'monthly')`;
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, static_ip, status, period_end)
      values ('svc_portal', ${ws.tenantId}, 'cus_portal', 'pkg_portal', 'pppoe', 'pppoe_secret', '10.10.10.8', 'active', now() + interval '12 days')`;
    await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, paid_kes, status, due_date)
      values ('inv_portal', ${ws.tenantId}, 'cus_portal', 'INV-P1', 2500, 0, 'due', current_date + 5)`;
    await sql`insert into invoice_items (id, tenant_id, invoice_id, description, quantity, unit_kes, amount_kes, package_id, service_id)
      values ('ii_portal', ${ws.tenantId}, 'inv_portal', 'Fiber 10/2 Mbps urban', 1, 2500, 2500, 'pkg_portal', 'svc_portal')`;
    await sql`insert into payments (id, tenant_id, customer_id, invoice_id, provider, amount_kes, reference, status)
      values ('pay_old', ${ws.tenantId}, 'cus_portal', 'inv_portal', 'mpesa', 500, 'QKSECRET99', 'confirmed')`;
    await sql`insert into payment_providers (id, tenant_id, kind, label, enabled, sandbox, client_id, client_secret, till_number, passkey, stk_type)
      values ('prv_p', ${ws.tenantId}, 'mpesa', 'M-Pesa', true, true, 'secret-id', 'super-secret', '123456', 'pass-secret', 'paybill')`;
    await sql`insert into payment_providers (id, tenant_id, kind, label, enabled, sandbox, client_id, client_secret, till_number)
      values ('prv_dead', ${ws.tenantId}, 'paypal', 'PayPal', false, false, '', 'hidden-secret', '')`;
    await sql`insert into payment_providers (id, tenant_id, kind, label, enabled, sandbox)
      values ('prv_card', ${ws.tenantId}, 'card', 'Card', true, true)`;
    await sql`update tenants set bank_name = 'Equity', bank_account = '001122', bank_branch = 'Kisumu' where id = ${ws.tenantId}`;

    const tkt = await openTicket(sql, ws.tenantId, {
      title: "Slow evenings",
      category: "slow",
      priority: "normal",
      customer_id: "cus_portal",
    });
    await commentTicket(sql, ws.tenantId, tkt.id, "cus_portal", "Line drops after 7pm", {
      internal: false,
      authorKind: "customer",
    });
    await commentTicket(sql, ws.tenantId, tkt.id, owner.id, "Check ONU light — do not tell customer the PPPoE plan", {
      internal: true,
      authorKind: "staff",
    });
    await commentTicket(sql, ws.tenantId, tkt.id, owner.id, "We will visit tomorrow", {
      internal: false,
      authorKind: "staff",
    });

    await ensureInitialPortalPassword(sql, ws.tenantId, "cus_portal", "0712000111");
    const [stored] = await sql<{ portal_password: string; portal_password_is_initial: boolean }>`
      select portal_password, portal_password_is_initial from customers where id = 'cus_portal'`;
    assert.ok(stored?.portal_password);
    assert.notEqual(stored?.portal_password, "0712000111");
    assert.ok(!stored?.portal_password.includes("0712"));
    assert.equal(stored?.portal_password_is_initial, true);

    const session = await portalPasswordLogin(sql, ws.slug, "0712000111", "0712000111");
    assert.ok(session.token.startsWith("prt_"));
    assert.equal(session.using_initial_password, true);
    await portalPasswordLogin(sql, ws.slug, "0712000111", "254712000111");

    const ctx = await portalContext(sql, session.token);
    const home = await loadPortalHome(sql, ctx);
    assertSafe(home);
    assert.equal(home.customer.name, "Amina Otieno");
    assert.equal(home.customer.account_number, "PN-1001");
    assert.equal(home.customer.using_initial_password, true);
    assert.equal(home.dashboard.services_total, 1);
    assert.equal(home.dashboard.services_active, 1);
    assert.equal(home.services[0]?.package_name, "Home 10");
    assert.equal(home.services[0]?.package_price_kes, 2500);
    assert.equal(home.services[0]?.billing_period, "Monthly");
    assert.ok(!("username" in home.services[0]!));
    assert.ok(!JSON.stringify(home.services).includes("Fiber"));
    assert.equal(home.invoices[0]?.number, "INV-P1");
    assert.equal(home.invoices[0]?.package_name, "Home 10");
    assert.ok(home.payments[0]?.reference_masked.includes("•"));
    assert.ok(!JSON.stringify(home.payments).includes("QKSECRET99"));
    assert.equal(home.payments[0]?.service_name, "Home 10");

    const methods = await loadPortalPaymentMethods(sql, ctx);
    assert.ok(methods.some((m) => m.mode === "stk"));
    assert.ok(methods.some((m) => m.mode === "paybill"));
    assert.ok(methods.some((m) => m.mode === "bank"));
    assert.ok(methods.some((m) => m.mode === "card"));
    assert.ok(!methods.some((m) => /paypal/i.test(m.label)));
    assertSafe(methods);
    assert.ok(!JSON.stringify(methods).includes("super-secret"));
    assert.ok(!JSON.stringify(methods).includes("pass-secret"));
    assert.ok(!JSON.stringify(methods).includes("hidden-secret"));

    const started = await startPortalPayment(sql, ctx, { invoice_id: "inv_portal", phone: "0712000111" });
    assert.equal(started.status, "pending");
    const again = await startPortalPayment(sql, ctx, { invoice_id: "inv_portal", phone: "0712000111" });
    assert.equal(again.checkout_id, started.checkout_id);
    const paysBefore = await sql<{ n: number }>`
      select count(*)::int as n from payments where tenant_id = ${ws.tenantId} and reference <> 'QKSECRET99'`;
    assert.equal(paysBefore[0]?.n, 0);

    const polled = await pollPortalPayment(sql, ctx, started.checkout_id);
    assert.equal(polled.status, "confirmed");

    const file = await makePortalInvoiceFile(sql, ctx, "inv_portal");
    assert.ok(file.pdf.length > 100);
    assertSafe(file.doc);
    assert.ok(!JSON.stringify(file.doc).includes("QKSECRET99"));
    assert.ok(!JSON.stringify(file.doc.lines).toLowerCase().includes("mbps"));

    const other = await portalPasswordLogin(sql, ws.slug, "0712999999", "0712999999");
    const otherCtx = await portalContext(sql, other.token);
    await assert.rejects(() => makePortalInvoiceFile(sql, otherCtx, "inv_portal"), /Invoice not found/);

    const tickets = await loadPortalTickets(sql, ctx);
    const bodies = tickets[0]?.comments.map((c) => c.body).join(" ") || "";
    assert.ok(bodies.includes("Line drops"));
    assert.ok(bodies.includes("visit tomorrow"));
    assert.ok(!bodies.includes("ONU"));
    assert.ok(!bodies.includes("PPPoE"));

    await openPortalTicket(sql, ctx, {
      title: "Payment issue",
      category: "mpesa",
      message: "STK did not arrive",
      service_id: "svc_portal",
    });

    await assert.rejects(() => startPortalPayment(sql, otherCtx, { invoice_id: "inv_portal" }), /Invoice not found/);
    const otherHome = await loadPortalHome(sql, otherCtx);
    assert.equal(otherHome.invoices.length, 0);
    assert.equal(otherHome.customer.name, "Other");

    await setPortalPassword(sql, ws.tenantId, "cus_portal", "Portal99!");
    await assert.rejects(() => portalPasswordLogin(sql, ws.slug, "0712000111", "0712000111"), /Wrong phone or password/);
    const changed = await portalPasswordLogin(sql, ws.slug, "0712000111", "Portal99!");
    assert.equal(changed.using_initial_password, false);
  } finally {
    await close();
  }
});
