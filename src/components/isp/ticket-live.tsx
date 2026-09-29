import { useEffect, useRef } from "react";
import { getBearerToken } from "@/lib/auth/client";

export function TicketLive({ onEvent }: { onEvent: (summary: string) => void }) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  useEffect(() => {
    const ac = new AbortController();
    let stopped = false;
    (async () => {
      const headers = new Headers({ Accept: "text/event-stream" });
      const token = getBearerToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      let res: Response;
      try {
        res = await fetch("/api/tickets/live", { headers, signal: ac.signal, credentials: "include" });
      } catch {
        return;
      }
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (!stopped) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";
        for (const part of parts) {
          const line = part.split("\n").find((row) => row.startsWith("data:"));
          if (!line) continue;
          try {
            const data = JSON.parse(line.slice(5).trim()) as { type?: string; summary?: string };
            if (data.type && data.type !== "ready" && data.summary) onEventRef.current(data.summary);
          } catch {
            /* ignore a partial frame */
          }
        }
      }
    })().catch(() => undefined);
    return () => {
      stopped = true;
      ac.abort();
    };
  }, []);
  return null;
}