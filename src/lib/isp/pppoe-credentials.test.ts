import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createOnboard } from "./onboard-create.ts";
import { storedAccessFields, validateServiceDraft } from "./onboard.ts";
import { updateService } from "./customer-lifecycle.ts";
import { hasPermission } from "./rbac.ts";
import {
  PPPOE_USERNAME_IN_USE,
  allocatePppoeUsername,
  assertPppoeUsernameAvailable,
  generatePppoePassword,
  passwordHasAmbiguousChars,
  pppoeUsernameFromName,
  revealRadiusPassword,
  sanitizePppoeUsername,
  suggestPppoeUsername,
  usernameTaken,
  validatePppoePassword,
  validatePppoeUsername,
} from "./pppoe-credentials.ts";
import { openTestDb } from "./test-db.ts";

async function seed(sql: Awaited<ReturnType<typeof openTestDb>>["sql"]) {
  await sql`insert into tenants (id, name, slug) values ('ten_a', 'Alpha', 'alpha'), ('ten_b', 'Beta', 'beta')`;
  await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes, billing_interval, validity_hours, active)
    values
      ('pkg_pppoe', 'ten_a', 'Home 10', 'pppoe', 10, 5, 2500, 'monthly', 0, true),
      ('pkg_static', 'ten_a', 'Office 20', 'static', 20, 20, 8000, 'monthly', 0, true),
      ('pkg_hot', 'ten_a', 'Cafe', 'hotspot', 5, 5, 500, 'daily', 24, true),
      ('pkg_free', 'ten_a', 'Comp', 'pppoe', 2, 2, 0, 'monthly', 0, true)`;
  await sql`insert into ip_pools (id, tenant_id, name, cidr, next_host)
    values ('pool_a', 'ten_a', 'Core', '10.8.0.0/24', 20)`;
  await sql`insert into customers (id, tenant_id, name, phone, email, account_number)
    values
      ('cus_john', 'ten_a', 'John Mwangi', '0712002001', 'john@example.com', 'J1001'),
      ('cus_other', 'ten_a', 'Other Client', '0712002002', 'other@example.com', 'J1002')`;
}

function pppoeService(over: Record<string, unknown> = {}) {
  return {
    access_method: "pppoe" as const,
    package_id: "pkg_free",
    username: "",
    auto_username: true,
    static_ip: "",
    pool_id: "",
    router_id: "",
    mac_address: "",
    cpe_id: "",
    expiry_ymd: "",
    activation: "active" as const,
    notes: "",
    hotspot_mode: "account" as const,
    ...over,
  };
}

test("customer name generates a RouterOS-safe john.mwangi username", () => {
  assert.equal(pppoeUsernameFromName("John Mwangi"), "john.mwangi");
  assert.equal(pppoeUsernameFromName("  José  García "), "jose.garcia");
  assert.equal(pppoeUsernameFromName("Mary-Ann O'Brien"), "mary.ann.o.brien");
  assert.equal(sanitizePppoeUsername("John..Mwangi!!"), "john.mwangi");
  assert.equal(suggestPppoeUsername({ name: "John Mwangi", phone: "0712002001", accountNumber: "J1001", serviceId: "svc_x" }), "john.mwangi");
  assert.equal(validatePppoeUsername("john.mwangi"), "");
  assert.match(validatePppoeUsername("!!!"), /invalid/i);
  assert.match(validatePppoeUsername(""), /enter/i);
});

test("generated passwords are strong, random, and avoid ambiguous characters", () => {
  const a = generatePppoePassword();
  const b = generatePppoePassword();
  assert.equal(a.length, 12);
  assert.equal(b.length, 12);
  assert.notEqual(a, b);
  assert.equal(passwordHasAmbiguousChars(a), false);
  assert.equal(passwordHasAmbiguousChars(b), false);
  assert.equal(validatePppoePassword(a), "");
  assert.match(validatePppoePassword("short"), /at least/);
  assert.equal(passwordHasAmbiguousChars("X7kP9mQ4vL2s"), false);
});

test("PPPoE credential fields keep username and password visible as text", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../components/isp/pppoe-credential-fields.tsx"),
    "utf8",
  );
  assert.match(src, /type="text"/);
  assert.equal(src.includes('type="password"'), false);
  assert.match(src, /PPPoE Username/);
  assert.match(src, /PPPoE Password/);
  assert.match(src, /Regenerate/);
  assert.equal((src.match(/type="text"/g) || []).length >= 2, true);
});

test("auto-generated usernames avoid collisions; staff duplicates are rejected", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    assert.equal(await usernameTaken(sql, "ten_a", "john.mwangi"), false);
    const first = await allocatePppoeUsername(sql, "ten_a", "svc_new", "john.mwangi");
    assert.equal(first, "john.mwangi");
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status)
      values ('svc_taken', 'ten_a', 'cus_john', 'pkg_free', 'pppoe', 'john.mwangi', 'active')`;
    assert.equal(await usernameTaken(sql, "ten_a", "John.Mwangi"), true);
    const next = await allocatePppoeUsername(sql, "ten_a", "svc_new2", "john.mwangi");
    assert.equal(next, "john.mwangi2");
    const rotated = await allocatePppoeUsername(sql, "ten_a", "svc_taken", "john.mwangi", "john.mwangi");
    assert.equal(rotated, "john.mwangi2");
    await assert.rejects(() => assertPppoeUsernameAvailable(sql, "ten_a", "john.mwangi"), (err: Error) => {
      assert.equal(err.message, PPPOE_USERNAME_IN_USE);
      return true;
    });
    const kept = await assertPppoeUsernameAvailable(sql, "ten_a", "john.mwangi", "svc_taken");
    assert.equal(kept, "john.mwangi");
  } finally {
    await close();
  }
});

test("new PPPoE service generates name-based credentials and preserves staff overrides", async () => {
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
        customer_id: "cus_john",
        include_service: true,
        service: pppoeService(),
      },
    });
    assert.equal(created.username, "john.mwangi");
    assert.ok(created.password);
    assert.equal(created.password?.length, 12);
    assert.equal(passwordHasAmbiguousChars(created.password || ""), false);
    assert.equal(validatePppoePassword(created.password || ""), "");
    const [rad] = await sql<{ username: string; password: string }>`
      select username, password from radius_accounts where tenant_id = 'ten_a' and service_id = ${created.service_id}`;
    assert.equal(rad?.username, "john.mwangi");
    assert.match(rad?.password || "", /^enc:v1:/);
    assert.equal(revealRadiusPassword(rad!.password), created.password);
    assert.notEqual(rad?.password, created.password);

    const audits = await sql<{ action: string; details: string }>`
      select action, details from audit_logs where tenant_id = 'ten_a' and entity_id = ${created.service_id}`;
    for (const row of audits) {
      assert.equal(row.details.includes(created.password || "___never___"), false);
      assert.equal(/"password"\s*:/.test(row.details), false);
    }

    const second = await createOnboard(sql, {
      tenantId: "ten_a",
      tenantName: "Alpha",
      actorId: "usr_staff",
      input: {
        customer_mode: "existing",
        customer_id: "cus_john",
        include_service: true,
        service: pppoeService(),
      },
    });
    assert.equal(second.username, "john.mwangi2");
    assert.ok(second.password);
    assert.notEqual(second.password, created.password);

    await assert.rejects(
      () =>
        createOnboard(sql, {
          tenantId: "ten_a",
          tenantName: "Alpha",
          actorId: "usr_staff",
          input: {
            customer_mode: "existing",
            customer_id: "cus_other",
            include_service: true,
            service: pppoeService({ username: "john.mwangi", auto_username: false, pppoe_password: "MyCustomPassword123" }),
          },
        }),
      (err: Error) => {
        assert.equal(err.message, PPPOE_USERNAME_IN_USE);
        return true;
      },
    );

    const custom = await createOnboard(sql, {
      tenantId: "ten_a",
      tenantName: "Alpha",
      actorId: "usr_staff",
      input: {
        customer_mode: "existing",
        customer_id: "cus_other",
        include_service: true,
        service: pppoeService({
          username: "john_home",
          auto_username: false,
          pppoe_password: "MyCustomPassword123",
        }),
      },
    });
    assert.equal(custom.username, "john_home");
    assert.equal(custom.password, "MyCustomPassword123");
    const [customRad] = await sql<{ password: string }>`
      select password from radius_accounts where service_id = ${custom.service_id}`;
    assert.equal(revealRadiusPassword(customRad!.password), "MyCustomPassword123");
  } finally {
    await close();
  }
});

test("non-PPPoE services do not generate PPPoE credentials; name changes leave usernames", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    const staticLine = await createOnboard(sql, {
      tenantId: "ten_a",
      tenantName: "Alpha",
      actorId: "usr_staff",
      input: {
        customer_mode: "existing",
        customer_id: "cus_john",
        include_service: true,
        service: {
          ...pppoeService({ package_id: "pkg_static", access_method: "static", username: "should-not-keep", auto_username: false }),
        },
      },
    });
    const [staticSvc] = await sql<{ username: string | null; access_method: string }>`
      select username, access_method from services where id = ${staticLine.service_id}`;
    assert.equal(staticSvc?.access_method, "static");
    assert.equal(staticSvc?.username, null);
    const [pppoeProv] = await sql<{ n: number }>`
      select count(*)::int as n from service_provisioning where service_id = ${staticLine.service_id}`;
    assert.equal(pppoeProv?.n, 0);

    const pppoe = await createOnboard(sql, {
      tenantId: "ten_a",
      tenantName: "Alpha",
      actorId: "usr_staff",
      input: {
        customer_mode: "existing",
        customer_id: "cus_john",
        include_service: true,
        service: pppoeService({ username: "john.mwangi" }),
      },
    });
    assert.equal(pppoe.username, "john.mwangi");
    await sql`update customers set name = 'Changed Name' where id = 'cus_john' and tenant_id = 'ten_a'`;
    const [still] = await sql<{ username: string | null }>`select username from services where id = ${pppoe.service_id}`;
    assert.equal(still?.username, "john.mwangi");

    const hotspot = storedAccessFields({
      ...pppoeService({ access_method: "hotspot", auto_username: true, username: "x" }),
    });
    assert.equal(hotspot.username, null);
  } finally {
    await close();
  }
});

test("editing a PPPoE service does not rotate credentials unless staff changes them", async () => {
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
        customer_id: "cus_john",
        include_service: true,
        service: pppoeService({ username: "john.mwangi", pppoe_password: "KeepThisPass1" }),
      },
    });
    const [before] = await sql<{ username: string; password: string }>`
      select username, password from radius_accounts where service_id = ${created.service_id}`;
    await updateService(sql, "ten_a", { id: created.service_id!, notes: "CPE on roof" });
    const [after] = await sql<{ username: string; password: string; notes: string }>`
      select a.username, a.password, s.notes
      from services s join radius_accounts a on a.service_id = s.id
      where s.id = ${created.service_id}`;
    assert.equal(after?.username, "john.mwangi");
    assert.equal(after?.password, before?.password);
    assert.equal(after?.notes, "CPE on roof");
    assert.equal(revealRadiusPassword(after!.password), "KeepThisPass1");

    const changed = await updateService(sql, "ten_a", {
      id: created.service_id!,
      username: "john_home",
      password: "MyCustomPassword123",
    });
    assert.equal(changed.credentials_changed, true);
    const [updated] = await sql<{ username: string; password: string }>`
      select username, password from radius_accounts where service_id = ${created.service_id}`;
    assert.equal(updated?.username, "john_home");
    assert.equal(revealRadiusPassword(updated!.password), "MyCustomPassword123");

    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status)
      values ('svc_dup', 'ten_a', 'cus_other', 'pkg_free', 'pppoe', 'taken.user', 'active')`;
    await assert.rejects(
      () => updateService(sql, "ten_a", { id: created.service_id!, username: "taken.user" }),
      (err: Error) => {
        assert.equal(err.message, PPPOE_USERNAME_IN_USE);
        return true;
      },
    );
  } finally {
    await close();
  }
});

test("draft validation and RBAC keep PPPoE passwords off unauthorized roles", () => {
  const missing = validateServiceDraft(pppoeService({ auto_username: false, username: "", pppoe_password: "" }), {
    id: "pkg_free",
    access_method: "pppoe",
    active: true,
  });
  assert.ok(missing.username);
  assert.ok(missing.pppoe_password);
  const ok = validateServiceDraft(pppoeService({ username: "john.mwangi", pppoe_password: "X7kP9mQ4vL2s" }), {
    id: "pkg_free",
    access_method: "pppoe",
    active: true,
  });
  assert.equal(ok.username, undefined);
  assert.equal(ok.pppoe_password, undefined);
  const staticDraft = validateServiceDraft(
    {
      ...pppoeService({ access_method: "static", package_id: "pkg_static", username: "", pppoe_password: "" }),
    },
    { id: "pkg_static", access_method: "static", active: true },
  );
  assert.equal(staticDraft.username, undefined);
  assert.equal(staticDraft.pppoe_password, undefined);
  assert.equal(hasPermission("finance", "services.manage"), false);
  assert.equal(hasPermission("technician", "services.manage"), false);
  assert.equal(hasPermission("network_engineer", "services.manage"), true);
});
