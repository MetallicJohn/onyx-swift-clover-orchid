export type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type DomainEvent = {
  type:
    | "payment.confirmed"
    | "service.changed";
  tenantId: string;
  payload: Record<string, unknown>;
};

type Handler = (sql: Sql, event: DomainEvent) => Promise<void>;

const handlers = new Map<string, Handler[]>();

export function on(type: DomainEvent["type"], handler: Handler) {
  const list = handlers.get(type) ?? [];
  list.push(handler);
  handlers.set(type, list);
}

export async function emit(sql: Sql, event: DomainEvent) {
  const { wireModules } = await import("./subscribers");
  wireModules();
  const list = handlers.get(event.type) ?? [];
  for (const handler of list) {
    await handler(sql, event);
  }
}
