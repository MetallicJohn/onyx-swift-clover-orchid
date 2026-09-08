export function newOtp(sandbox: boolean) {
  if (sandbox) return "000000";
  return String(100000 + Math.floor(Math.random() * 900000));
}
