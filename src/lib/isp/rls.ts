type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

/**
 * Set tenant RLS GUCs on the current database session.
 * Must run inside `withDbSession` (request middleware / job worker) so the
 * following queries reuse the same Postgres client. Combined into one
 * statement so both GUCs land on that client together.
 */
export async function applyRls(
  sql: Sql,
  opts: { tenantId?: string; bypass?: boolean },
) {
  const tenantId = opts.tenantId ?? "";
  const bypass = opts.bypass ? "on" : "off";
  await sql.query(
    "select set_config('app.tenant_id', $1, false), set_config('app.bypass_rls', $2, false)",
    [tenantId, bypass],
  );
}
