export type TicketLiveEvent = {
  tenantId: string;
  type: string;
  ticketId: string;
  summary: string;
};

type Listener = (event: TicketLiveEvent) => void;

const rooms = new Map<string, Set<Listener>>();

export function publishTicketLive(event: TicketLiveEvent) {
  const room = rooms.get(event.tenantId);
  if (!room) return;
  for (const listener of room) {
    try {
      listener(event);
    } catch {
      /* a closed stream must not stop the others */
    }
  }
}

export function subscribeTicketLive(tenantId: string, listener: Listener) {
  const room = rooms.get(tenantId) ?? new Set<Listener>();
  room.add(listener);
  rooms.set(tenantId, room);
  return () => {
    room.delete(listener);
    if (room.size === 0) rooms.delete(tenantId);
  };
}
