/** Vendor-neutral TR-069 WAN PPPoE paths. Never assume one tree fits every CPE. */

export type WanPppoeProfile = {
  id: "InternetGatewayDevice" | "Device";
  label: string;
  username: string;
  password: string;
  enable: string;
};

export const WAN_PPPOE_PROFILES: WanPppoeProfile[] = [
  {
    id: "InternetGatewayDevice",
    label: "TR-098 InternetGatewayDevice WANPPPConnection",
    username: "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username",
    password: "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Password",
    enable: "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Enable",
  },
  {
    id: "Device",
    label: "TR-181 Device.PPP.Interface",
    username: "Device.PPP.Interface.1.Username",
    password: "Device.PPP.Interface.1.Password",
    enable: "Device.PPP.Interface.1.Enable",
  },
];

export function selectWanPppoeProfile(productClass: string, lastInformRaw = "") {
  const blob = `${productClass} ${lastInformRaw}`.toLowerCase();
  if (blob.includes("device.ppp.interface") && !blob.includes("internetgatewaydevice")) {
    return WAN_PPPOE_PROFILES[1]!;
  }
  if (blob.includes("internetgatewaydevice") || blob.includes("wanpppconnection")) {
    return WAN_PPPOE_PROFILES[0]!;
  }
  return WAN_PPPOE_PROFILES[0]!;
}

export function pppoeSetParameterValues(profile: WanPppoeProfile, username: string, password: string) {
  return {
    name: "setParameterValues",
    parameterValues: [
      [profile.username, username, "xsd:string"],
      [profile.password, password, "xsd:string"],
      [profile.enable, "true", "xsd:boolean"],
    ],
  };
}

export function pppoeGetParameterNames(profile: WanPppoeProfile) {
  return { name: "getParameterValues", parameterNames: [profile.username, profile.enable] };
}

export function isOverlayOrNasIp(ip: string) {
  const a = (ip || "").trim();
  if (!a) return true;
  if (a.startsWith("10.200.0.")) return true;
  if (a === "10.200.0.1") return true;
  return false;
}
