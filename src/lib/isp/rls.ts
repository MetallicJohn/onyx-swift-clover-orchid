type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export async function applyRls(
  sql: Sql,
  opts: { tenantId?: string; bypass?: boolean },
) {
  const tenantId = opts.tenantId ?? "";
  const bypass = opts.bypass ? "on" : "off";
  await sql.query("select set_config('app.tenant_id', $1, false)", [tenantId]);
  await sql.query("select set_config('app.bypass_rls', $1, false)", [bypass]);
}
