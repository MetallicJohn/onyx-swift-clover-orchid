import { nid } from "@/lib/utils";
import { commandRosScript } from "./routeros";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export function templateScript(prompt: string) {
  const p = prompt.toLowerCase();
  if (p.includes("hotspot")) {
    return commandRosScript("hotspot.upsert", { username: "guest1", password: "changeme", package: "default" });
  }
  if (p.includes("static") || p.includes("queue")) {
    return commandRosScript("static.upsert", { username: "static1", static_ip: "10.10.10.20", download_mbps: 10, upload_mbps: 5 });
  }
  if (p.includes("pppoe") || p.includes("secret")) {
    return commandRosScript("pppoe.upsert", { username: "user1", password: "changeme", package: "default" });
  }
  return `# Review before paste — generated from: ${prompt.replace(/\n/g, " ").slice(0, 80)}
/system identity print
/interface print
/ppp secret print
/ip hotspot user print`;
}

export async function generateMikrotikScript(sql: Sql, tenantId: string, prompt: string) {
  const text = prompt.trim();
  if (text.length < 8) throw new Error("Describe the change in more detail");
  if (text.length > 2000) throw new Error("Prompt too long");
  let script = templateScript(text);
  let model = "template";
  const key = process.env.XAI_API_KEY;
  if (key) {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 700,
        messages: [
          {
            role: "system",
            content:
              "You write MikroTik RouterOS v7 scripts only. No markdown. Use :local, :if, :do on-error. Never reboot unless asked. Placeholders for secrets.",
          },
          { role: "user", content: text },
        ],
      }),
    });
    if (res.ok) {
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const out = body.choices?.[0]?.message?.content?.trim();
      if (out) {
        script = out.replace(/^```[\w]*\n?/, "").replace(/```$/, "");
        model = "grok-4.5";
      }
    }
  }
  await sql`insert into ai_scripts (id, tenant_id, prompt, script, model)
    values (${nid("ai")}, ${tenantId}, ${text.slice(0, 2000)}, ${script.slice(0, 8000)}, ${model})`;
  return { script, model };
}
