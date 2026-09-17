/** Vendor/model parameter profiles for TR-069 (InternetGatewayDevice) and TR-181 (Device). */

export type AcsTree = "InternetGatewayDevice" | "Device";

export type OpticalMetric = {
  key: "rx" | "tx" | "temperature" | "voltage" | "bias" | "los" | "pon" | "registration" | "module";
  label: string;
  unit: string;
  paths: string[];
  scale?: number;
};

export type WifiBandProfile = {
  id: "2.4" | "5" | "guest";
  label: string;
  ssid: string[];
  enable: string[];
  password: string[];
  security: string[];
  channel: string[];
  channelWidth: string[];
  mode: string[];
};

export type AcsParameterProfile = {
  id: string;
  label: string;
  tree: AcsTree;
  match: { manufacturer?: RegExp; productClass?: RegExp };
  wifi: WifiBandProfile[];
  optical: OpticalMetric[];
  wanIp: string[];
  wanStatus: string[];
  gateway: string[];
  dns: string[];
  lanIp: string[];
  mac: string[];
  uptime: string[];
  firmware: string[];
  hardware: string[];
  manufacturer: string[];
  model: string[];
  hosts: string[];
  firmwareDownload: boolean;
};

const IGD_WIFI_24: WifiBandProfile = {
  id: "2.4",
  label: "2.4 GHz",
  ssid: [
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID",
    "InternetGatewayDevice.LANDevice.1.WIFI.Radio.1.SSID",
  ],
  enable: ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Enable"],
  password: [
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase",
  ],
  security: ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.BeaconType"],
  channel: ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Channel"],
  channelWidth: ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_ZTE-COM_ChannelWidth"],
  mode: ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Standard"],
};

const IGD_WIFI_5: WifiBandProfile = {
  id: "5",
  label: "5 GHz",
  ssid: ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID", "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.SSID"],
  enable: ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Enable", "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.Enable"],
  password: [
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.KeyPassphrase",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.PreSharedKey.1.KeyPassphrase",
  ],
  security: ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.BeaconType"],
  channel: ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Channel"],
  channelWidth: ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.X_ZTE-COM_ChannelWidth"],
  mode: ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Standard"],
};

const TR181_WIFI_24: WifiBandProfile = {
  id: "2.4",
  label: "2.4 GHz",
  ssid: ["Device.WiFi.SSID.1.SSID"],
  enable: ["Device.WiFi.Radio.1.Enable", "Device.WiFi.SSID.1.Enable"],
  password: ["Device.WiFi.AccessPoint.1.Security.KeyPassphrase"],
  security: ["Device.WiFi.AccessPoint.1.Security.ModeEnabled"],
  channel: ["Device.WiFi.Radio.1.Channel"],
  channelWidth: ["Device.WiFi.Radio.1.OperatingChannelBandwidth"],
  mode: ["Device.WiFi.Radio.1.OperatingStandards"],
};

const TR181_WIFI_5: WifiBandProfile = {
  id: "5",
  label: "5 GHz",
  ssid: ["Device.WiFi.SSID.2.SSID"],
  enable: ["Device.WiFi.Radio.2.Enable", "Device.WiFi.SSID.2.Enable"],
  password: ["Device.WiFi.AccessPoint.2.Security.KeyPassphrase"],
  security: ["Device.WiFi.AccessPoint.2.Security.ModeEnabled"],
  channel: ["Device.WiFi.Radio.2.Channel"],
  channelWidth: ["Device.WiFi.Radio.2.OperatingChannelBandwidth"],
  mode: ["Device.WiFi.Radio.2.OperatingStandards"],
};

const IGD_OPTICAL: OpticalMetric[] = [
  {
    key: "rx",
    label: "Optical RX power",
    unit: "dBm",
    scale: 0.01,
    paths: [
      "InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.RXPower",
      "InternetGatewayDevice.WANDevice.1.X_HW_PONInterfaceConfig.RXPower",
      "InternetGatewayDevice.WANDevice.1.X_FH_GponInterfaceConfig.RXPower",
      "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.X_CT-COM_WANGponLinkConfig.RXPower",
    ],
  },
  {
    key: "tx",
    label: "Optical TX power",
    unit: "dBm",
    scale: 0.01,
    paths: [
      "InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.TXPower",
      "InternetGatewayDevice.WANDevice.1.X_HW_PONInterfaceConfig.TXPower",
      "InternetGatewayDevice.WANDevice.1.X_FH_GponInterfaceConfig.TXPower",
    ],
  },
  {
    key: "temperature",
    label: "Temperature",
    unit: "°C",
    scale: 0.01,
    paths: [
      "InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.TransceiverTemperature",
      "InternetGatewayDevice.WANDevice.1.X_HW_PONInterfaceConfig.TransceiverTemperature",
    ],
  },
  {
    key: "voltage",
    label: "Voltage",
    unit: "V",
    scale: 0.01,
    paths: [
      "InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.SupplyVottage",
      "InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.SupplyVoltage",
      "InternetGatewayDevice.WANDevice.1.X_HW_PONInterfaceConfig.SupplyVoltage",
    ],
  },
  {
    key: "bias",
    label: "Bias current",
    unit: "mA",
    scale: 0.01,
    paths: [
      "InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.BiasCurrent",
      "InternetGatewayDevice.WANDevice.1.X_HW_PONInterfaceConfig.BiasCurrent",
    ],
  },
  {
    key: "los",
    label: "LOS status",
    unit: "",
    paths: [
      "InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.LOS",
      "InternetGatewayDevice.WANDevice.1.X_HW_PONInterfaceConfig.Status",
    ],
  },
  {
    key: "pon",
    label: "PON status",
    unit: "",
    paths: [
      "InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.Status",
      "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.X_CT-COM_WANGponLinkConfig.Status",
    ],
  },
  {
    key: "registration",
    label: "Registration status",
    unit: "",
    paths: ["InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.RegState"],
  },
];

const TR181_OPTICAL: OpticalMetric[] = [
  { key: "rx", label: "Optical RX power", unit: "dBm", paths: ["Device.Optical.Interface.1.RXPower", "Device.XPON.Interface.1.Stats.BytesReceived"] },
  { key: "tx", label: "Optical TX power", unit: "dBm", paths: ["Device.Optical.Interface.1.TXPower"] },
  { key: "temperature", label: "Temperature", unit: "°C", paths: ["Device.Optical.Interface.1.Temperature"] },
  { key: "voltage", label: "Voltage", unit: "V", paths: ["Device.Optical.Interface.1.Voltage"] },
  { key: "bias", label: "Bias current", unit: "mA", paths: ["Device.Optical.Interface.1.Bias"] },
  { key: "los", label: "LOS status", unit: "", paths: ["Device.Optical.Interface.1.LowerLayers", "Device.Optical.Interface.1.Status"] },
  { key: "pon", label: "PON status", unit: "", paths: ["Device.XPON.Interface.1.Status"] },
  { key: "registration", label: "Registration status", unit: "", paths: ["Device.XPON.Interface.1.ONU.1.RegistrationState"] },
  { key: "module", label: "Optical module", unit: "", paths: ["Device.Optical.Interface.1.Name"] },
];

export const ACS_PARAMETER_PROFILES: AcsParameterProfile[] = [
  {
    id: "zte-igd",
    label: "ZTE (TR-069)",
    tree: "InternetGatewayDevice",
    match: { manufacturer: /zte/i, productClass: /f6|zxhn|f670|f660|f601/i },
    wifi: [IGD_WIFI_24, IGD_WIFI_5],
    optical: IGD_OPTICAL,
    wanIp: [
      "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress",
      "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress",
    ],
    wanStatus: [
      "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ConnectionStatus",
      "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ConnectionStatus",
    ],
    gateway: ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.DefaultGateway"],
    dns: ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.DNSServers"],
    lanIp: ["InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.IPInterface.1.IPInterfaceIPAddress"],
    mac: [
      "InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress",
      "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.MACAddress",
    ],
    uptime: ["InternetGatewayDevice.DeviceInfo.UpTime"],
    firmware: ["InternetGatewayDevice.DeviceInfo.SoftwareVersion"],
    hardware: ["InternetGatewayDevice.DeviceInfo.HardwareVersion"],
    manufacturer: ["InternetGatewayDevice.DeviceInfo.Manufacturer"],
    model: ["InternetGatewayDevice.DeviceInfo.ModelName"],
    hosts: ["InternetGatewayDevice.LANDevice.1.Hosts.HostNumberOfEntries"],
    firmwareDownload: false,
  },
  {
    id: "huawei-igd",
    label: "Huawei (TR-069)",
    tree: "InternetGatewayDevice",
    match: { manufacturer: /huawei/i, productClass: /hg|eg8|hs8|optix/i },
    wifi: [IGD_WIFI_24, IGD_WIFI_5],
    optical: IGD_OPTICAL,
    wanIp: ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress"],
    wanStatus: ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ConnectionStatus"],
    gateway: ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.DefaultGateway"],
    dns: ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.DNSServers"],
    lanIp: ["InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.IPInterface.1.IPInterfaceIPAddress"],
    mac: ["InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress"],
    uptime: ["InternetGatewayDevice.DeviceInfo.UpTime"],
    firmware: ["InternetGatewayDevice.DeviceInfo.SoftwareVersion"],
    hardware: ["InternetGatewayDevice.DeviceInfo.HardwareVersion"],
    manufacturer: ["InternetGatewayDevice.DeviceInfo.Manufacturer"],
    model: ["InternetGatewayDevice.DeviceInfo.ModelName"],
    hosts: ["InternetGatewayDevice.LANDevice.1.Hosts.HostNumberOfEntries"],
    firmwareDownload: false,
  },
  {
    id: "tr181",
    label: "TR-181 Device",
    tree: "Device",
    match: { productClass: /./ },
    wifi: [TR181_WIFI_24, TR181_WIFI_5],
    optical: TR181_OPTICAL,
    wanIp: ["Device.IP.Interface.1.IPv4Address.1.IPAddress", "Device.PPP.Interface.1.IPCP.LocalIPAddress"],
    wanStatus: ["Device.PPP.Interface.1.ConnectionStatus", "Device.IP.Interface.1.Status"],
    gateway: ["Device.Routing.Router.1.IPv4Forwarding.1.GatewayIPAddress"],
    dns: ["Device.DNS.Relay.Forwarding.1.DNSServer"],
    lanIp: ["Device.IP.Interface.2.IPv4Address.1.IPAddress"],
    mac: ["Device.Ethernet.Interface.1.MACAddress", "Device.WiFi.SSID.1.MACAddress"],
    uptime: ["Device.DeviceInfo.UpTime"],
    firmware: ["Device.DeviceInfo.SoftwareVersion"],
    hardware: ["Device.DeviceInfo.HardwareVersion"],
    manufacturer: ["Device.DeviceInfo.Manufacturer"],
    model: ["Device.DeviceInfo.ModelName"],
    hosts: ["Device.Hosts.HostNumberOfEntries"],
    firmwareDownload: false,
  },
  {
    id: "igd-generic",
    label: "TR-069 generic",
    tree: "InternetGatewayDevice",
    match: { productClass: /./ },
    wifi: [IGD_WIFI_24, IGD_WIFI_5],
    optical: IGD_OPTICAL,
    wanIp: [
      "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress",
      "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress",
    ],
    wanStatus: ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ConnectionStatus"],
    gateway: ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.DefaultGateway"],
    dns: ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.DNSServers"],
    lanIp: ["InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.IPInterface.1.IPInterfaceIPAddress"],
    mac: ["InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress"],
    uptime: ["InternetGatewayDevice.DeviceInfo.UpTime"],
    firmware: ["InternetGatewayDevice.DeviceInfo.SoftwareVersion"],
    hardware: ["InternetGatewayDevice.DeviceInfo.HardwareVersion"],
    manufacturer: ["InternetGatewayDevice.DeviceInfo.Manufacturer"],
    model: ["InternetGatewayDevice.DeviceInfo.ModelName"],
    hosts: ["InternetGatewayDevice.LANDevice.1.Hosts.HostNumberOfEntries"],
    firmwareDownload: false,
  },
];

export function resolveAcsProfile(manufacturer: string, productClass: string, preferredTree?: string) {
  const m = manufacturer || "";
  const p = productClass || "";
  if (preferredTree === "Device") {
    const tr181 = ACS_PARAMETER_PROFILES.find((row) => row.id === "tr181");
    if (tr181) return tr181;
  }
  for (const profile of ACS_PARAMETER_PROFILES) {
    if (profile.id === "tr181" || profile.id === "igd-generic") continue;
    if (profile.match.manufacturer?.test(m) || profile.match.productClass?.test(p)) return profile;
  }
  if (/^Device(\.|$)/i.test(preferredTree || "") || /tr.?181/i.test(p)) {
    return ACS_PARAMETER_PROFILES.find((row) => row.id === "tr181")!;
  }
  return ACS_PARAMETER_PROFILES.find((row) => row.id === "igd-generic")!;
}

export function firstPathValue(doc: Record<string, unknown>, paths: string[], read: (doc: Record<string, unknown>, path: string) => string) {
  for (const path of paths) {
    const value = read(doc, path);
    if (value) return { path, value };
  }
  return null;
}

export function scaleOptical(raw: string, scale?: number) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  if (!scale || scale === 1) return String(n);
  if (Math.abs(n) >= 100) return (n * scale).toFixed(2);
  return String(n);
}

export function profileSupports(profile: AcsParameterProfile, action: string) {
  if (action === "firmware_upgrade") return profile.firmwareDownload;
  if (action === "optical" || action === "signal") return profile.optical.length > 0;
  if (action === "wifi" || action === "ssid" || action === "wifi_password" || action === "wifi_radio") {
    return profile.wifi.some((b) => b.ssid.length > 0);
  }
  if (action === "wifi_24") return profile.wifi.some((b) => b.id === "2.4");
  if (action === "wifi_5") return profile.wifi.some((b) => b.id === "5");
  if (action === "channel") return profile.wifi.some((b) => b.channel.length > 0);
  if (action === "channel_width") return profile.wifi.some((b) => b.channelWidth.length > 0);
  if (action === "wifi_mode") return profile.wifi.some((b) => b.mode.length > 0);
  if (action === "wan") return profile.wanIp.length > 0;
  if (action === "lan") return profile.lanIp.length > 0;
  if (action === "clients") return profile.hosts.length > 0;
  if (action === "uptime") return profile.uptime.length > 0;
  if (action === "firmware_info") return profile.firmware.length > 0;
  return true;
}
