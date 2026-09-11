import assert from "node:assert/strict";
import { test } from "node:test";
import { createCredentialAccount, provisionTenant } from "./accounts.ts";
import { savePlatformSettings } from "./platform.ts";
import { publicSiteContact, submitInquiry } from "./public-site.ts";
import { openTestDb } from "./test-db.ts";

test("public contact only exposes configured sales fields", async () => {
  const { sql, close } = await openTestDb();
  try {
    const admin = await createCredentialAccount(sql, {
      email: "root@isp.solutions",
      password: "RootPass1!",
      name: "Platform",
    });
    await provisionTenant(sql, admin.id, { ispName: "Control Plane", email: admin.email });
    const empty = await publicSiteContact(sql);
    assert.equal(empty.sales_email, "");
    assert.equal(empty.support_email, "");
    assert.equal(empty.contact_phone, "");
    await savePlatformSettings(sql, admin.id, {
      sales_email: "sales@isp.solutions",
      support_email: "help@isp.solutions",
      contact_phone: "+254700000000",
    });
    const live = await publicSiteContact(sql);
    assert.equal(live.sales_email, "sales@isp.solutions");
    assert.equal(live.support_email, "help@isp.solutions");
    assert.equal(live.contact_phone, "+254700000000");
  } finally {
    await close();
  }
});

test("inquiry form validates, drops honeypots, and stores the message", async () => {
  const { sql, close } = await openTestDb();
  try {
    await assert.rejects(
      () =>
        submitInquiry(sql, {
          name: "Amina",
          company: "Coast Fiber",
          email: "amina@coast.test",
          phone: "0700",
          topic: "sales",
          message: "We need a walkthrough of billing and RADIUS.",
          website: "https://spam.test",
        }),
      /Could not send/,
    );
    await assert.rejects(
      () =>
        submitInquiry(sql, {
          name: "A",
          company: "",
          email: "bad",
          phone: "",
          topic: "sales",
          message: "short",
        }),
      /Enter your name/,
    );
    const ok = await submitInquiry(sql, {
      name: "Amina Hassan",
      company: "Coast Fiber",
      email: "amina@coast.test",
      phone: "0700123456",
      topic: "partnership",
      message: "We resell last-mile in Mombasa and want a walkthrough.",
      ip: "10.0.0.8",
    });
    assert.equal(ok.ok, true);
    const [row] = await sql<{ topic: string; email: string }>`
      select topic, email from platform_inquiries where email = 'amina@coast.test'`;
    assert.equal(row?.topic, "partnership");
    assert.equal(row?.email, "amina@coast.test");
  } finally {
    await close();
  }
});
