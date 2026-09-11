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

test("FreeRADIUS export assigns the PCQ profile and does not send Rate-Limit", () => {
  const text = renderFreeRadiusUsers([
    { username: "off", password: "x", framed_ip: "", group_name: "isp-home-10", enabled: false },
    { username: "on", password: "pw", framed_ip: "10.1.1.8", group_name: "isp-home-10", enabled: true },
  ]);
  assert.match(text, /off Auth-Type := Reject/);
  assert.doesNotMatch(text, /Mikrotik-Rate-Limit/);
  assert.match(text, /Mikrotik-Group := "isp-home-10"/);
  assert.match(text, /Framed-IP-Address := 10.1.1.8/);
});
