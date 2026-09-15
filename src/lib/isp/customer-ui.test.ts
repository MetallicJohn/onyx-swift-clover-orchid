import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("customer names on lists open the dedicated customer page", () => {
  const customers = readFileSync(new URL("../../routes/app/customers.tsx", import.meta.url), "utf8");
  const desk = readFileSync(new URL("../../components/isp/customer-desk-ui.tsx", import.meta.url), "utf8");
  const services = readFileSync(new URL("../../routes/app/services.tsx", import.meta.url), "utf8");
  const serviceDesk = readFileSync(new URL("../../components/isp/service-desk-ui.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../../routes/app/customers.$customerId.tsx", import.meta.url), "utf8");
  const svcPage = readFileSync(new URL("../../routes/app/services.$serviceId.tsx", import.meta.url), "utf8");
  assert.match(customers, /to="\/app\/customers\/\$customerId"/);
  assert.match(desk, /to="\/app\/customers\/\$customerId"/);
  assert.match(customers, /queryCustomersDeskFn/);
  assert.match(customers, /<Outlet \/>/);
  assert.match(customers, /Add customer/);
  assert.match(desk, /Quick preview/);
  assert.match(desk, /View realtime traffic/);
  assert.match(desk, /placement="drawer"/);
  assert.match(desk, /tab: "services"/);
  assert.match(desk, /action: "add-service"/);
  assert.match(desk, /DeskOverflowMenu/);
  assert.match(page, /normalizeProfileSearch/);
  assert.match(page, /accountStateLabel/);
  assert.match(serviceDesk, /to="\/app\/customers\/\$customerId"/);
  assert.match(services, /queryServicesDeskFn/);
  assert.match(services, /<Outlet \/>/);
  assert.match(services, /Add service/);
  assert.match(serviceDesk, /placement="drawer"/);
  assert.match(serviceDesk, /View realtime traffic|Realtime traffic/);
  assert.match(page, /createFileRoute\("\/app\/customers\/\$customerId"\)/);
  assert.match(svcPage, /createFileRoute\("\/app\/services\/\$serviceId"\)/);
  assert.match(page, /deleteCustomerFn/);
  assert.match(page, /Realtime traffic/);
  assert.match(svcPage, /deleteServiceFn/);
  assert.match(services, /deleteServiceFn/);
});

test("traffic drawer polls real RADIUS data and stops when closed", () => {
  const drawer = readFileSync(new URL("../../components/isp/traffic-drawer.tsx", import.meta.url), "utf8");
  assert.match(drawer, /customerTrafficFn/);
  assert.match(drawer, /TRAFFIC_POLL_MS/);
  assert.match(drawer, /TRAFFIC_SOURCE_LABEL/);
  assert.match(drawer, /No active session/);
  assert.match(drawer, /cancelled = true/);
});

test("Recycle Bin is wired from customers, services, settings, and administration paths", () => {
  const bin = readFileSync(new URL("../../routes/app/recycle-bin.tsx", import.meta.url), "utf8");
  const customers = readFileSync(new URL("../../routes/app/customers.tsx", import.meta.url), "utf8");
  const desk = readFileSync(new URL("../../components/isp/customer-desk-ui.tsx", import.meta.url), "utf8");
  const serviceDesk = readFileSync(new URL("../../components/isp/service-desk-ui.tsx", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../../routes/app/settings.tsx", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../../components/app-shell.tsx", import.meta.url), "utf8");
  assert.match(bin, /createFileRoute\("\/app\/recycle-bin"\)/);
  assert.match(bin, /listRecycleBinFn/);
  assert.match(bin, /restoreCustomerFn/);
  assert.match(bin, /restoreServiceFn/);
  assert.match(bin, /purgeCustomerFn/);
  assert.match(bin, /PERMANENTLY DELETE|confirmPhrase/);
  assert.match(customers, /\/app\/recycle-bin/);
  assert.match(desk, /\/app\/recycle-bin/);
  assert.match(serviceDesk, /\/app\/recycle-bin/);
  assert.match(settings, /\/app\/recycle-bin/);
  assert.match(shell, /\/app\/recycle-bin/);
  const svcPage = readFileSync(new URL("../../routes/app/services.$serviceId.tsx", import.meta.url), "utf8");
  assert.match(svcPage, /\/app\/recycle-bin/);
});
