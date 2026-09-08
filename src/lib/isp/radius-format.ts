export function mikrotikRateLimit(downMbps: number, upMbps: number) {
  return `${Math.max(1, upMbps)}M/${Math.max(1, downMbps)}M`;
}

export function renderFreeRadiusUsers(
  accounts: Array<{ username: string; password: string; framed_ip: string; group_name: string; enabled: boolean; rate_limit: string }>,
) {
  return accounts
    .map((a) => {
      if (!a.enabled) {
        return `${a.username} Auth-Type := Reject`;
      }
      const attrs = [`Cleartext-Password := "${a.password}"`];
      if (a.rate_limit) attrs.push(`Mikrotik-Rate-Limit := "${a.rate_limit}"`);
      if (a.framed_ip) attrs.push(`Framed-IP-Address := ${a.framed_ip}`);
      attrs.push(`Mikrotik-Group := "${a.group_name}"`);
      return `${a.username} ${attrs[0]}\n\t${attrs.slice(1).join(",\n\t")}`;
    })
    .join("\n\n");
}

export function publicRadiusAccount<T extends { password: string }>(row: T) {
  const p = row.password;
  const shown = !p ? "" : p.length <= 4 ? "••••" : `••••${p.slice(-4)}`;
  return { ...row, password: shown };
}
