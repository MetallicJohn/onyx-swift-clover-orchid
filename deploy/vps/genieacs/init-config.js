// Idempotent GenieACS Mongo config. Digest auth, connection-request auth,
// URL-lock and service-provision presets. Safe to re-run on every deploy.
// Run from compose genieacs-init against mongodb://mongo/genieacs.

const auth = 'AUTH(USERNAME, EXT("ispsolutions", "passwordFor", USERNAME))';
const connreq = "AUTH(username, password)";

const lockScript = `const now = Date.now();
const igdUser = declare("InternetGatewayDevice.ManagementServer.Username", {value: 1});
const devUser = declare("Device.ManagementServer.Username", {value: 1});
const username = String((igdUser.value && igdUser.value[0]) || (devUser.value && devUser.value[0]) || "");
const url = ext("ispsolutions", "acsUrlFor", username);
if (url) {
  declare("InternetGatewayDevice.ManagementServer.URL", {value: now}).value = [now, url];
  declare("Device.ManagementServer.URL", {value: now}).value = [now, url];
}
const crUser = ext("ispsolutions", "connreqUserFor", username);
const crPass = ext("ispsolutions", "connreqPasswordFor", username);
if (crUser && crPass) {
  declare("InternetGatewayDevice.ManagementServer.ConnectionRequestUsername", {value: now}).value = [now, crUser];
  declare("InternetGatewayDevice.ManagementServer.ConnectionRequestPassword", {value: now}).value = [now, crPass];
  declare("Device.ManagementServer.ConnectionRequestUsername", {value: now}).value = [now, crUser];
  declare("Device.ManagementServer.ConnectionRequestPassword", {value: now}).value = [now, crPass];
}
`;

const serviceScript = `const now = Date.now();
const serialDecl = declare("DeviceID.SerialNumber", {value: 1});
const serial = String((serialDecl.value && serialDecl.value[0]) || "");
const igdUser = declare("InternetGatewayDevice.ManagementServer.Username", {value: 1});
const devUser = declare("Device.ManagementServer.Username", {value: 1});
const username = String((igdUser.value && igdUser.value[0]) || (devUser.value && devUser.value[0]) || "");
const raw = ext("ispsolutions", "serviceFor", username, serial);
let p = {wan_username: "", wan_password: "", ssid: "", wifi_password: ""};
try { p = JSON.parse(raw || "{}"); } catch (e) { p = {wan_username: "", wan_password: "", ssid: "", wifi_password: ""}; }
if (p && p.wan_username && p.wan_password) {
  declare("InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username", {value: now}).value = [now, p.wan_username];
  declare("InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Password", {value: now}).value = [now, p.wan_password];
  declare("InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Enable", {value: now}).value = [now, true];
  declare("Device.PPP.Interface.1.Username", {value: now}).value = [now, p.wan_username];
  declare("Device.PPP.Interface.1.Password", {value: now}).value = [now, p.wan_password];
  declare("Device.PPP.Interface.1.Enable", {value: now}).value = [now, true];
}
if (p && p.ssid) {
  declare("InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", {value: now}).value = [now, p.ssid];
  declare("InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.SSID", {value: now}).value = [now, p.ssid];
  declare("InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID", {value: now}).value = [now, p.ssid];
  declare("Device.WiFi.SSID.1.SSID", {value: now}).value = [now, p.ssid];
  declare("Device.WiFi.SSID.2.SSID", {value: now}).value = [now, p.ssid];
  declare("InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Enable", {value: now}).value = [now, true];
  declare("Device.WiFi.SSID.1.Enable", {value: now}).value = [now, true];
  declare("Device.WiFi.Radio.1.Enable", {value: now}).value = [now, true];
}
if (p && p.wifi_password) {
  declare("InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase", {value: now}).value = [now, p.wifi_password];
  declare("InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase", {value: now}).value = [now, p.wifi_password];
  declare("InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.PreSharedKey.1.KeyPassphrase", {value: now}).value = [now, p.wifi_password];
  declare("InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.KeyPassphrase", {value: now}).value = [now, p.wifi_password];
  declare("Device.WiFi.AccessPoint.1.Security.KeyPassphrase", {value: now}).value = [now, p.wifi_password];
  declare("Device.WiFi.AccessPoint.2.Security.KeyPassphrase", {value: now}).value = [now, p.wifi_password];
}
`;

db = db.getSiblingDB("genieacs");

db.config.updateOne({ _id: "cwmp.auth" }, { $set: { value: auth } }, { upsert: true });
db.config.updateOne({ _id: "cwmp.connectionRequestAuth" }, { $set: { value: connreq } }, { upsert: true });
db.config.updateOne(
  { _id: "cwmp.connectionRequestAllowBasicAuth" },
  { $set: { value: "true" } },
  { upsert: true },
);
db.config.updateOne({ _id: "cwmp.debug" }, { $set: { value: "false" } }, { upsert: true });

db.provisions.updateOne({ _id: "ispsolutions-lock-url" }, { $set: { script: lockScript } }, { upsert: true });
db.provisions.updateOne({ _id: "ispsolutions-service" }, { $set: { script: serviceScript } }, { upsert: true });

db.presets.updateOne(
  { _id: "ispsolutions-lock-url" },
  {
    $set: {
      weight: 1,
      channel: "",
      precondition: "true",
      configurations: [{ type: "provision", name: "ispsolutions-lock-url" }],
    },
  },
  { upsert: true },
);
db.presets.updateOne(
  { _id: "ispsolutions-service" },
  {
    $set: {
      weight: 0,
      channel: "",
      precondition: "true",
      configurations: [{ type: "provision", name: "ispsolutions-service" }],
    },
  },
  { upsert: true },
);

print("ispsolutions cwmp security config upserted");
