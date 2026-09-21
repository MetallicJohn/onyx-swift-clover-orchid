import assert from "node:assert/strict";
import { test } from "node:test";
import { restorePaidAccess } from "./access-policy.ts";
import {
  defaultActivation,
  defaultExpiryYmd,
  displayDraftAccount,
  expiryAfterActivationChange,
  expiryHelperText,
  sanitizePayload,
  sanitizeService,
  scoreDuplicate,
  storedAccessFields,
  validatePayload,
} from "./onboard.ts";
import {
  createOnboard,
  findCustomerDuplicates,
  loadOnboardCatalog,
  searchOnboardCustomers,
} from "./onboard-create.ts";
import { nairobiDate } from "./empty-tenant.ts";
import { openTestDb } from "./test-db.ts";

async function seed(sql: Awaited<ReturnType<typeof openTestDb>>["sql"]) {
  await sql`insert into tenants (id, name, slug) values ('ten_a', 'Alpha', 'alpha'), ('ten_b', 'Beta', 'beta')`;
  await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes, billing_interval, validity_hours, active)
    values
      ('pkg_pppoe', 'ten_a', 'Home 10', 'pppoe', 10, 5, 2500, 'monthly', 0, true),
      ('pkg_static', 'ten_a', 'Office 20', 'static', 20, 20, 8000, 'monthly', 0, true),
      ('pkg_hot', 'ten_a', 'Cafe', 'hotspot', 5, 5, 500, 'daily', 24, true),
      ('pkg_free', 'ten_a', 'Comp', 'pppoe', 2, 2, 0, 'monthly', 0, true),
      ('pkg_off', 'ten_a', 'Retired', 'pppoe', 10, 10, 100, 'monthly', 0, false),
      ('pkg_b', 'ten_b', 'Other 10', 'pppoe', 10, 10, 1, 'monthly', 0, true)`;
  await sql`insert into ip_pools (id, tenant_id, name, cidr, next_host)
    values ('pool_a', 'ten_a', 'Core', '10.8.0.0/24', 20), ('pool_b', 'ten_b', 'Other', '10.9.0.0/24', 20)`;
  await sql`insert into customers (id, tenant_id, name, phone, email, account_number)
    values
      ('cus_a1', 'ten_a', 'Amina Wanjiku', '0712001001', 'amina@example.com', 'A1001'),
      ('cus_b1', 'ten_b', 'Other', '0712001999', 'other@example.com', 'B1001')`;
  await sql`insert into cpe_devices (id, tenant_id, serial, product_class, status, last_inform)
    values
      ('cpe_free', 'ten_a', 'SN-FREE-1', 'HG8245', 'online', now()),
      ('cpe_b', 'ten_b', 'SN-OTHER', 'HG8245', 'online', now())`;
}

test("sanitize drops incompatible fields and hidden values are not stored", () => {
  const payload = sanitizePayload({
    customer_mode: "new",
    include_service: true,
    customer: { name: "  Jane  ", phone: "0712888111", email: "", address: "", type: "individual", tag_ids: [], account_number: "", notes: "", portal_password: "" },
    service: {
      access_method: "static",
      package_id: "pkg_static",
      username: "should-not-keep",
      auto_username: false,
      static_ip: "10.8.0.40",
      pool_id: "pool_a",
      router_id: "",
      mac_address: "aa:bb:cc:dd:ee:ff",
      cpe_id: "cpe_free",
      expiry_ymd: "2026-10-01",
      activation: "after_payment",
      notes: "",
      hotspot_mode: "voucher",
    },
  });
  assert.equal(payload.service?.username, "");
  assert.equal(payload.service?.static_ip, "10.8.0.40");
  assert.equal(payload.service?.hotspot_mode, "account");
  const stored = storedAccessFields(payload.service!);
  assert.equal(stored.username, null);
  assert.equal(stored.static_ip, "10.8.0.40");
  assert.equal(stored.mac_address, "AABBCCDDEEFF");

  const pppoe = sanitizePayload({
    customer_mode: "existing",
    customer_id: "cus_a1",
    include_service: true,
    service: {
      access_method: "pppoe",
      package_id: "pkg_pppoe",
      username: "",
      auto_username: true,
      static_ip: "10.8.0.99",
      pool_id: "pool_a",
      router_id: "",
      mac_address: "",
      cpe_id: "",
      expiry_ymd: "",
      activation: "active",
      notes: "",
      hotspot_mode: "account",
    },
  });
  assert.equal(pppoe.service?.static_ip, "");
  assert.equal(storedAccessFields(pppoe.service!).static_ip, null);
});

test("validation requires customer, matching package, and activation", () => {
  const errors = validatePayload({
    customer_mode: "new",
    include_service: true,
    customer: {
      name: "",
      phone: "12",
      email: "bad",
      address: "",
      type: "individual",
      tag_ids: [],
      account_number: "",
      notes: "",
      portal_password: "",
    },
    service: {
      access_method: "pppoe",
      package_id: "pkg_static",
      username: "",
      auto_username: true,
      static_ip: "",
      pool_id: "",
      router_id: "",
      mac_address: "",
      cpe_id: "",
      expiry_ymd: "not-a-date",
      activation: "after_payment",
      notes: "",
      hotspot_mode: "account",
    },
  }, { id: "pkg_static", access_method: "static", active: true });
  assert.equal(errors.name, "Name is required");
  assert.ok(errors.phone);
  assert.ok(errors.email);
  assert.match(errors.package_id || "", /does not match/);
  assert.ok(errors.expiry_ymd);
});

test("default activation is after payment when the package has a price", () => {
  assert.equal(defaultActivation(2500), "after_payment");
  assert.equal(defaultActivation(0), "active");
  const today = nairobiDate();
  assert.equal(defaultExpiryYmd({ billing_interval: "monthly", validity_hours: 0 }, "after_payment"), today);
  assert.equal(defaultExpiryYmd({ billing_interval: "monthly", validity_hours: 0 }, "after_partial"), today);
  const active = defaultExpiryYmd({ billing_interval: "monthly", validity_hours: 0 }, "active");
  assert.match(active, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(active > today);
  const daily = defaultExpiryYmd({ billing_interval: "daily", validity_hours: 24 }, "active");
  assert.ok(daily >= today);
  assert.equal(displayDraftAccount(""), "Assigned on save");
  assert.equal(displayDraftAccount("W8CWV"), "W8CWV");
  assert.equal(displayDraftAccount("", "existing"), "No ID");
});

test("duplicate scoring blocks the same last-9 phone and warns on name or email", () => {
  const phone = scoreDuplicate(
    { name: "Amina", phone: "254712001001", email: "" },
    { id: "cus_a1", name: "Amina Wanjiku", phone: "0712001001", email: "amina@example.com" },
  );
  assert.equal(phone?.reason, "phone");
  assert.equal(phone?.blocking, true);
  const email = scoreDuplicate(
    { name: "Someone", phone: "0712999999", email: "amina@example.com" },
    { id: "cus_a1", name: "Amina Wanjiku", phone: "0712001001", email: "amina@example.com" },
  );
  assert.equal(email?.reason, "email");
  assert.equal(email?.blocking, false);
  const name = scoreDuplicate(
    { name: "Amina Wanjiku", phone: "0712999999", email: "" },
    { id: "cus_a1", name: "Amina Wanjiku", phone: "0712001001", email: "" },
  );
  assert.equal(name?.reason, "name");
});

test("create customer and first service together; after payment stays pending until paid", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    const created = await createOnboard(sql, {
      tenantId: "ten_a",
      tenantName: "Alpha",
      actorId: "usr_staff",
      input: {
        customer_mode: "new",
        include_service: true,
        acknowledge_duplicates: false,
        customer: {
          name: "Brian Otieno",
          phone: "0712888001",
          email: "brian@example.com",
          address: "Kasarani",
          type: "individual",
          tag_ids: [],
          account_number: "",
          notes: "New install",
          portal_password: "",
        },
        service: {
          access_method: "pppoe",
          package_id: "pkg_pppoe",
          username: "",
          auto_username: true,
          static_ip: "10.8.0.99",
          pool_id: "pool_a",
          router_id: "",
          mac_address: "",
          cpe_id: "",
          expiry_ymd: "",
          activation: "after_payment",
          notes: "",
          hotspot_mode: "account",
        },
      },
    });
    assert.ok(created.customer_id);
    assert.ok(created.service_id);
    assert.ok(created.invoice_id);
    assert.equal(created.status, "pending");
    assert.equal(created.activation, "after_payment");
    assert.equal(created.password, null);
    const [svc] = await sql<{ status: string; suspend_reason: string; username: string | null; static_ip: string | null }>`
      select status, suspend_reason, username, static_ip from services where id = ${created.service_id}`;
    assert.equal(svc?.status, "pending");
    assert.equal(svc?.suspend_reason, "awaiting_payment");
    assert.equal(svc?.username, "brian.otieno");
    assert.equal(svc?.static_ip, null);
    const [rad] = await sql<{ enabled: boolean }>`
      select enabled from radius_accounts where tenant_id = 'ten_a' and service_id = ${created.service_id}`;
    assert.equal(rad?.enabled, false);
    const invoices = await sql<{ n: number }>`
      select count(*)::int as n from invoices where tenant_id = 'ten_a' and customer_id = ${created.customer_id}`;
    assert.equal(invoices[0]?.n, 1);

    await restorePaidAccess(sql, "ten_a", created.customer_id);
    const [live] = await sql<{ status: string; suspend_reason: string }>`
      select status, suspend_reason from services where id = ${created.service_id}`;
    assert.equal(live?.status, "active");
    assert.equal(live?.suspend_reason, "");
    const [rad2] = await sql<{ enabled: boolean }>`
      select enabled from radius_accounts where tenant_id = 'ten_a' and service_id = ${created.service_id}`;
    assert.equal(rad2?.enabled, true);
    await restorePaidAccess(sql, "ten_a", created.customer_id);
    const inv2 = await sql<{ n: number }>`
      select count(*)::int as n from invoices where tenant_id = 'ten_a' and customer_id = ${created.customer_id}`;
    assert.equal(inv2[0]?.n, 1);
  } finally {
    await close();
  }
});

test("start as active enables RADIUS and does not keep PPPoE fields on a static line", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    const created = await createOnboard(sql, {
      tenantId: "ten_a",
      tenantName: "Alpha",
      actorId: "usr_staff",
      input: {
        customer_mode: "existing",
        customer_id: "cus_a1",
        include_service: true,
        service: {
          access_method: "static",
          package_id: "pkg_static",
          username: "leaked-user",
          auto_username: false,
          static_ip: "",
          pool_id: "pool_a",
          router_id: "",
          mac_address: "",
          cpe_id: "",
          expiry_ymd: "2026-12-31",
          activation: "active",
          notes: "",
          hotspot_mode: "account",
        },
      },
    });
    assert.equal(created.status, "active");
    assert.ok(created.static_ip);
    const [svc] = await sql<{ username: string | null; static_ip: string | null; status: string; expiry_source: string }>`
      select username, static_ip, status, expiry_source from services where id = ${created.service_id}`;
    assert.equal(svc?.username, null);
    assert.ok(svc?.static_ip?.startsWith("10.8.0."));
    assert.equal(svc?.status, "active");
    assert.equal(svc?.expiry_source, "staff");
    const [rad] = await sql<{ enabled: boolean; username: string }>`
      select enabled, username from radius_accounts where service_id = ${created.service_id}`;
    assert.equal(rad?.enabled, true);
  } finally {
    await close();
  }
});

test("hotspot fields persist username only; CPE skip is allowed; assigned CPE cannot move", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    const skipped = await createOnboard(sql, {
      tenantId: "ten_a",
      tenantName: "Alpha",
      actorId: "usr_staff",
      input: {
        customer_mode: "existing",
        customer_id: "cus_a1",
        include_service: true,
        service: {
          access_method: "hotspot",
          package_id: "pkg_hot",
          username: "",
          auto_username: true,
          static_ip: "10.8.0.77",
          pool_id: "pool_a",
          router_id: "",
          mac_address: "AABBCCDDEEFF",
          cpe_id: "",
          expiry_ymd: "",
          activation: "active",
          notes: "",
          hotspot_mode: "account",
        },
      },
    });
    const [hot] = await sql<{ username: string | null; static_ip: string | null; mac_address: string }>`
      select username, static_ip, mac_address from services where id = ${skipped.service_id}`;
    assert.ok(hot?.username);
    assert.equal(hot?.static_ip, null);
    assert.equal(hot?.mac_address, "");

    const voucher = await createOnboard(sql, {
      tenantId: "ten_a",
      tenantName: "Alpha",
      actorId: "usr_staff",
      input: {
        customer_mode: "existing",
        customer_id: "cus_a1",
        include_service: true,
        service: {
          access_method: "hotspot",
          package_id: "pkg_hot",
          username: "",
          auto_username: true,
          static_ip: "",
          pool_id: "",
          router_id: "",
          mac_address: "",
          cpe_id: "",
          expiry_ymd: "",
          activation: "active",
          notes: "",
          hotspot_mode: "voucher",
        },
      },
    });
    const [vrow] = await sql<{ code: string; service_id: string; status: string }>`
      select code, service_id, status from hotspot_vouchers where service_id = ${voucher.service_id}`;
    assert.equal(vrow?.service_id, voucher.service_id);
    assert.equal(vrow?.status, "active");
    assert.equal(vrow?.code, voucher.username);

    const withCpe = await createOnboard(sql, {
      tenantId: "ten_a",
      tenantName: "Alpha",
      actorId: "usr_staff",
      input: {
        customer_mode: "existing",
        customer_id: "cus_a1",
        include_service: true,
        service: {
          access_method: "pppoe",
          package_id: "pkg_free",
          username: "",
          auto_username: true,
          static_ip: "",
          pool_id: "",
          router_id: "",
          mac_address: "",
          cpe_id: "cpe_free",
          expiry_ymd: "",
          activation: "active",
          notes: "",
          hotspot_mode: "account",
        },
      },
    });
    const [cpe] = await sql<{ service_id: string | null; customer_id: string | null }>`
      select service_id, customer_id from cpe_devices where id = 'cpe_free'`;
    assert.equal(cpe?.service_id, withCpe.service_id);
    assert.equal(cpe?.customer_id, "cus_a1");

    await assert.rejects(
      () =>
        createOnboard(sql, {
          tenantId: "ten_a",
          tenantName: "Alpha",
          actorId: "usr_staff",
          input: {
            customer_mode: "existing",
            customer_id: "cus_a1",
            include_service: true,
            service: {
              access_method: "pppoe",
              package_id: "pkg_free",
              username: "",
              auto_username: true,
              static_ip: "",
              pool_id: "",
              router_id: "",
              mac_address: "",
              cpe_id: "cpe_free",
              expiry_ymd: "",
              activation: "active",
              notes: "",
              hotspot_mode: "account",
            },
          },
        }),
      /already assigned/,
    );
  } finally {
    await close();
  }
});

test("duplicate phone is blocked; catalog and search stay on the current ISP", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    const dupes = await findCustomerDuplicates(sql, "ten_a", {
      name: "Amina Wanjiku",
      phone: "254712001001",
      email: "amina@example.com",
    });
    assert.ok(dupes.some((d) => d.blocking && d.id === "cus_a1"));
    await assert.rejects(
      () =>
        createOnboard(sql, {
          tenantId: "ten_a",
          tenantName: "Alpha",
          actorId: "usr_staff",
          input: {
            customer_mode: "new",
            include_service: false,
            customer: {
              name: "Amina Clone",
              phone: "0712001001",
              email: "",
              address: "",
              type: "individual",
              tag_ids: [],
              account_number: "",
              notes: "",
              portal_password: "",
            },
          },
        }),
      /already exists/,
    );
    const catalog = await loadOnboardCatalog(sql, "ten_a", "alpha");
    assert.ok(catalog.packages.every((p) => p.id !== "pkg_b"));
    assert.ok(catalog.packages.every((p) => p.active));
    assert.ok(!catalog.packages.some((p) => p.id === "pkg_off"));
    assert.ok(catalog.devices.every((d) => d.id !== "cpe_b"));
    const hits = await searchOnboardCustomers(sql, "ten_a", "Amina");
    assert.ok(hits.some((h) => h.id === "cus_a1"));
    assert.ok(hits.every((h) => h.id !== "cus_b1"));
    const byAccount = await searchOnboardCustomers(sql, "ten_a", "A1001");
    assert.equal(byAccount[0]?.id, "cus_a1");

    await sql`delete from ip_addresses where tenant_id = 'ten_a'`;
    await sql`delete from ip_pools where tenant_id = 'ten_a'`;
    const before = await sql<{ n: number }>`select count(*)::int as n from services where tenant_id = 'ten_a'`;
    await assert.rejects(
      () =>
        createOnboard(sql, {
          tenantId: "ten_a",
          tenantName: "Alpha",
          actorId: "usr_staff",
          input: {
            customer_mode: "existing",
            customer_id: "cus_a1",
            include_service: true,
            service: {
              access_method: "static",
              package_id: "pkg_static",
              username: "",
              auto_username: true,
              static_ip: "",
              pool_id: "",
              router_id: "",
              mac_address: "",
              cpe_id: "",
              expiry_ymd: "",
              activation: "active",
              notes: "",
              hotspot_mode: "account",
            },
          },
        }),
      /No IP pool/,
    );
    const after = await sql<{ n: number }>`select count(*)::int as n from services where tenant_id = 'ten_a'`;
    assert.equal(after[0]?.n, before[0]?.n);

    const onlyCustomer = await createOnboard(sql, {
      tenantId: "ten_a",
      tenantName: "Alpha",
      actorId: "usr_staff",
      input: {
        customer_mode: "new",
        include_service: false,
        customer: {
          name: "Mercy Achieng",
          phone: "0712555001",
          email: "",
          address: "",
          type: "individual",
          tag_ids: [],
          account_number: "",
          notes: "",
          portal_password: "",
        },
      },
    });
    assert.ok(onlyCustomer.customer_id);
    assert.equal(onlyCustomer.service_id, null);
    assert.equal(onlyCustomer.invoice_id, null);
    const [svcN] = await sql<{ n: number }>`
      select count(*)::int as n from services where customer_id = ${onlyCustomer.customer_id}`;
    assert.equal(svcN?.n, 0);
  } finally {
    await close();
  }
});

test("switching activation recalculates the default date unless staff edited it", () => {
  const now = new Date("2026-09-16T10:00:00+03:00");
  const monthly = { billing_interval: "monthly", validity_hours: 0 };
  assert.equal(defaultExpiryYmd(monthly, "after_payment", now), "2026-09-16");
  assert.equal(defaultExpiryYmd(monthly, "active", now), "2026-10-16");
  assert.equal(
    expiryAfterActivationChange({
      currentYmd: "2026-09-16",
      previousActivation: "after_payment",
      nextActivation: "active",
      pkg: monthly,
      dirty: false,
      now,
    }),
    "2026-10-16",
  );
  assert.equal(
    expiryAfterActivationChange({
      currentYmd: "2026-11-01",
      previousActivation: "after_payment",
      nextActivation: "active",
      pkg: monthly,
      dirty: true,
      now,
    }),
    "2026-11-01",
  );
  assert.match(expiryHelperText("after_payment"), /today/);
  assert.match(expiryHelperText("active"), /30 days/);
});

test("continuing clients require expiry, default notify off, and keep the picked date", () => {
  const missing = validatePayload({
    customer_mode: "existing",
    customer_id: "cus_a1",
    include_service: true,
    service: {
      access_method: "pppoe",
      package_id: "pkg_pppoe",
      username: "acme.pppoe",
      auto_username: false,
      static_ip: "",
      pool_id: "",
      router_id: "",
      mac_address: "",
      cpe_id: "",
      expiry_ymd: "",
      activation: "active",
      notes: "",
      hotspot_mode: "account",
      onboarding_type: "continuing",
      subscription_start_ymd: "",
      send_onboarding_notification: false,
    },
  }, { id: "pkg_pppoe", access_method: "pppoe", active: true });
  assert.match(missing.expiry_ymd || "", /expiry/);

  const ok = sanitizeService({
    access_method: "pppoe",
    package_id: "pkg_pppoe",
    username: "acme.pppoe",
    auto_username: false,
    expiry_ymd: "30/09/26",
    activation: "active",
    onboarding_type: "continuing",
  });
  assert.equal(ok.expiry_ymd, "2026-09-30");
  assert.equal(ok.send_onboarding_notification, false);
  assert.equal(ok.onboarding_type, "continuing");
  const fresh = sanitizeService({ onboarding_type: "new" });
  assert.equal(fresh.send_onboarding_notification, true);
  assert.equal(
    expiryAfterActivationChange({
      currentYmd: "2026-09-30",
      previousActivation: "active",
      nextActivation: "after_payment",
      pkg: { billing_interval: "monthly", validity_hours: 0 },
      dirty: false,
      onboardingType: "continuing",
      now: new Date("2026-09-17T10:00:00+03:00"),
    }),
    "2026-09-30",
  );
  assert.match(expiryHelperText("active", "continuing"), /first renewal/i);
});
