import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addStaffMember,
  createCredentialAccount,
  createIspWithOwner,
  ensureFirstPlatformAdmin,
  isPlatformAdmin,
  passwordVerifies,
  provisionTenant,
} from "./accounts.ts";
import { openTestDb } from "./test-db.ts";

test("credential accounts can be created and verified for sign-in", async () => {
  const { sql, close } = await openTestDb();
  try {
    const user = await createCredentialAccount(sql, {
      email: "owner@imani.ke",
      password: "ChangeMe1!",
      name: "Amina",
    });
    assert.equal(user.created, true);
    assert.equal(await passwordVerifies(sql, "owner@imani.ke", "ChangeMe1!"), true);
    assert.equal(await passwordVerifies(sql, "owner@imani.ke", "wrong-password"), false);
    await assert.rejects(
      () =>
        createCredentialAccount(sql, {
          email: "owner@imani.ke",
          password: "AnotherPass1",
          name: "Amina",
        }),
      /already exists/,
    );
  } finally {
    await close();
  }
});

test("signup provisions an ISP the owner can use", async () => {
  const { sql, close } = await openTestDb();
  try {
    const user = await createCredentialAccount(sql, {
      email: "jane@gridline.test",
      password: "SignupPass1",
      name: "Jane Wanjiku",
    });
    const ws = await provisionTenant(sql, user.id, {
      ispName: "Imani Networks",
      personName: "Jane Wanjiku",
      email: user.email,
    });
    assert.equal(ws.tenantName, "Imani Networks");
    assert.equal(ws.role, "isp_owner");
    assert.equal(await isPlatformAdmin(sql, user.id), true);

    const again = await provisionTenant(sql, user.id, { ispName: "Other" });
    assert.equal(again.tenantId, ws.tenantId);
  } finally {
    await close();
  }
});

test("superadmin can create a staff login that verifies", async () => {
  const { sql, close } = await openTestDb();
  try {
    const owner = await createCredentialAccount(sql, {
      email: "boss@isp.test",
      password: "OwnerPass1",
      name: "Boss",
    });
    const ws = await provisionTenant(sql, owner.id, { ispName: "Northline" });
    const staff = await addStaffMember(sql, ws.tenantId, {
      email: "tech@isp.test",
      password: "TechPass1",
      name: "Kamau",
      role: "technician",
    });
    assert.equal(staff.role, "technician");
    assert.equal(await passwordVerifies(sql, "tech@isp.test", "TechPass1"), true);

    const techWs = await provisionTenant(sql, staff.user_id);
    assert.equal(techWs.tenantId, ws.tenantId);
    assert.equal(techWs.role, "technician");
  } finally {
    await close();
  }
});

test("platform superadmin can create an ISP with an owner login", async () => {
  const { sql, close } = await openTestDb();
  try {
    const first = await createCredentialAccount(sql, {
      email: "ops@gridline.test",
      password: "Gridline1!",
      name: "Ops",
    });
    await ensureFirstPlatformAdmin(sql, first.id);
    const created = await createIspWithOwner(sql, {
      ispName: "Coast Fibre",
      ownerName: "Fatma",
      ownerEmail: "fatma@coast.ke",
      ownerPassword: "CoastPass1",
    });
    assert.equal(created.tenant_name, "Coast Fibre");
    assert.equal(await passwordVerifies(sql, "fatma@coast.ke", "CoastPass1"), true);
    const ownerWs = await provisionTenant(sql, created.owner_id);
    assert.equal(ownerWs.tenantName, "Coast Fibre");
    assert.equal(ownerWs.role, "isp_owner");
  } finally {
    await close();
  }
});
