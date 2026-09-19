import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  canSubmitReassign,
  customerStatusLabel,
  customerUnavailable,
  displayReassignPhone,
  reassignInfoFromRow,
  reassignSearchReady,
} from "./reassign-format.ts";

test("reassign search needs two characters and does not auto-submit", () => {
  assert.equal(reassignSearchReady(""), false);
  assert.equal(reassignSearchReady("J"), false);
  assert.equal(reassignSearchReady("Jo"), true);
  assert.equal(reassignSearchReady("  amina  "), true);
  assert.equal(
    canSubmitReassign({ destinationId: "", currentCustomerId: "cus_a", confirmed: true }),
    false,
  );
  assert.equal(
    canSubmitReassign({ destinationId: "cus_b", currentCustomerId: "cus_a", confirmed: false }),
    false,
  );
  assert.equal(
    canSubmitReassign({ destinationId: "cus_a", currentCustomerId: "cus_a", confirmed: true }),
    false,
  );
  assert.equal(
    canSubmitReassign({ destinationId: "cus_b", currentCustomerId: "cus_a", confirmed: true, busy: true }),
    false,
  );
  assert.equal(
    canSubmitReassign({ destinationId: "cus_b", currentCustomerId: "cus_a", confirmed: true }),
    true,
  );
});

test("deleted and inactive customers are unavailable destinations", () => {
  assert.equal(customerUnavailable("active", null), false);
  assert.equal(customerUnavailable("suspended", null), false);
  assert.equal(customerUnavailable("inactive", null), true);
  assert.equal(customerUnavailable("deleted", null), true);
  assert.equal(customerUnavailable("active", "2026-09-17"), true);
  assert.equal(customerStatusLabel("suspended"), "Suspended");
  assert.equal(displayReassignPhone("254712345678"), "0712345678");
  const info = reassignInfoFromRow({
    id: "svc_1",
    customer_id: "cus_a",
    customer_name: "Amina",
    customer_phone: "0712001001",
    account_number: "S-1",
    package_name: "Home 10",
    access_method: "pppoe",
    status: "active",
    period_end: "2026-09-30",
  });
  assert.equal(info.customer_id, "cus_a");
  assert.equal(info.account_number, "S-1");
});

test("reassign dialog searches, confirms, and stacks on small screens", () => {
  const src = readFileSync(new URL("../../components/isp/reassign-service-dialog.tsx", import.meta.url), "utf8");
  assert.match(src, /Search destination customer/);
  assert.match(src, /type="radio"/);
  assert.match(src, /Change customer/);
  assert.match(src, /Reassigning this service will move it to the selected customer/);
  assert.match(src, /I confirm this reassignment/);
  assert.match(src, /w-full sm:w-auto/);
  assert.match(src, /searchReassignCustomersFn/);
  assert.match(src, /submitLock/);
  assert.match(src, /setSelected\(null\)/);
  assert.match(src, /No matching customers found/);
  assert.match(src, /ID/);
  assert.match(src, /250/);
  assert.doesNotMatch(src, /Select customer/);
});

test("all three reassign entry points use the searchable dialog", () => {
  for (const rel of [
    "../../routes/app/services.$serviceId.tsx",
    "../../routes/app/services.tsx",
    "../../routes/app/customers.$customerId.tsx",
  ]) {
    const src = readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.match(src, /ReassignServiceDialog/);
    assert.match(src, /reassignInfoFromRow/);
    assert.match(src, /reason/);
  }
  const life = readFileSync(new URL("./server-lifecycle.ts", import.meta.url), "utf8");
  assert.match(life, /searchReassignCustomersFn/);
  assert.match(life, /service.reassigned/);
  assert.match(life, /from_name/);
  assert.match(life, /to_name/);
  assert.match(life, /service_account_number/);
  assert.match(life, /trigger_billing: false/);
  assert.match(life, /send_customer_notifications: false/);
});
