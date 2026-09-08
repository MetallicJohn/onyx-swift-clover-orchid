import assert from "node:assert/strict";
import { test } from "node:test";
import { mikrotikRateLimit, publicRadiusAccount, renderFreeRadiusUsers } from "./radius-format.ts";

test("rate limit is Mikrotik up/down format", () => {
  assert.equal(mikrotikRateLimit(20, 10), "10M/20M");
});

test("list DTO redacts the RADIUS secret", () => {
  const pub = publicRadiusAccount({ username: "amina", password: "s3cretpass" });
  assert.equal(pub.password.includes("s3cretpass"), false);
});

test("FreeRADIUS export rejects disabled users", () => {
  const text = renderFreeRadiusUsers([
    { username: "off", password: "x", framed_ip: "", group_name: "pppoe", enabled: false, rate_limit: "" },
    { username: "on", password: "pw", framed_ip: "10.1.1.8", group_name: "pppoe", enabled: true, rate_limit: "5M/10M" },
  ]);
  assert.match(text, /off Auth-Type := Reject/);
  assert.match(text, /Mikrotik-Rate-Limit := "5M\/10M"/);
  assert.match(text, /Framed-IP-Address := 10.1.1.8/);
});
