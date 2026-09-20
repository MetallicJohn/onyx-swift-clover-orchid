import assert from "node:assert/strict";
import { test } from "node:test";
import { primaryScript, scriptSections } from "./ros-script-pack.ts";

test("script dialog exposes copy targets for bootstrap, enroll, API user, and sync", () => {
  const both = scriptSections({
    title: "Re-provision",
    bootstrap: "# bootstrap paste\n",
    enroll: "# enroll paste\n/interface wireguard add\n",
  });
  assert.deepEqual(
    both.map((s) => s.label),
    ["Bootstrap", "Enroll"],
  );
  assert.equal(primaryScript({ bootstrap: "# b", enroll: "# e" })?.label, "Bootstrap");

  const enrollOnly = scriptSections({ enroll: "/user add name=ispsolutions-agent" });
  assert.equal(enrollOnly.length, 1);
  assert.equal(enrollOnly[0]?.label, "Enroll");

  const api = scriptSections({ extraLabel: "API user", extra: "/user add name=ispsolutions-agent" });
  assert.equal(api[0]?.label, "API user");
  assert.match(api[0]?.body || "", /ispsolutions-agent/);

  assert.deepEqual(scriptSections(null), []);
  assert.equal(primaryScript({ bootstrap: "   " }), null);
});
