import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getWhatsAppAgent,
  pauseWhatsAppConversation,
  refreshWhatsAppLink,
  saveWhatsAppAgent,
  startWhatsAppLink,
  unlinkWhatsApp,
} from "@/lib/isp/server-whatsapp";
import { WA_SAVE_FAIL, WA_SAVE_OK, safeSettingsError } from "@/lib/isp/settings-feedback";
import { SaveButton, SettingsCheck, SettingsField, SettingsStatus, SettingsSubnav, type SettingsNote } from "@/components/isp/settings-ui";

type Section = "connection" | "bot" | "actions" | "security" | "handoff";

type Settings = {
  enabled: boolean;
  ai_enabled: boolean;
  read_only_enabled: boolean;
  connection_actions_enabled: boolean;
  cpe_actions_enabled: boolean;
  password_actions_enabled: boolean;
  service_actions_enabled: boolean;
  kill_switch: boolean;
  otp_ttl_seconds: number;
  level2_ttl_seconds: number;
  business_hours: string;
  handoff_phone: string;
  actions: Record<string, boolean>;
};

type ActionRow = { id: string; name: string; level: number; executable: boolean; enabled: boolean };
type LinkState = { status: string; phone: string; qrDataUrl: string; error: string };
type Chat = { id: string; phone_e164: string; customer_name: string; automation_paused: boolean };

const EMPTY: Settings = {
  enabled: false,
  ai_enabled: false,
  read_only_enabled: true,
  connection_actions_enabled: false,
  cpe_actions_enabled: false,
  password_actions_enabled: false,
  service_actions_enabled: false,
  kill_switch: false,
  otp_ttl_seconds: 300,
  level2_ttl_seconds: 600,
  business_hours: "",
  handoff_phone: "",
  actions: {},
};

export function WhatsAppAgentSettings() {
  const [section, setSection] = useState<Section>("connection");
  const [settings, setSettings] = useState<Settings>(EMPTY);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [link, setLink] = useState<LinkState>({ status: "disconnected", phone: "", qrDataUrl: "", error: "" });
  const [chats, setChats] = useState<Chat[]>([]);
  const [note, setNote] = useState<SettingsNote>(null);
  const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState(false);
  const lock = useRef(false);

  async function load() {
    const data = await getWhatsAppAgent();
    setSettings({ ...EMPTY, ...data.settings, actions: data.settings.actions || {} });
    setActions(data.actions);
    setLink(data.link);
    setChats(data.conversations);
  }

  useEffect(() => {
    load().catch((err) => setNote({ ok: false, text: safeSettingsError(err, WA_SAVE_FAIL) }));
  }, []);

  useEffect(() => {
    if (link.status !== "qr") return;
    const timer = window.setInterval(() => {
      refreshWhatsAppLink()
        .then((next) => setLink(next))
        .catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [link.status]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setNote(null);
    try {
      const saved = await saveWhatsAppAgent({ data: settings });
      setSettings({ ...EMPTY, ...saved.settings, actions: saved.settings.actions || {} });
      setActions(saved.actions);
      setNote({ ok: true, text: WA_SAVE_OK });
    } catch (err) {
      setNote({ ok: false, text: safeSettingsError(err, WA_SAVE_FAIL) });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function toggleAction(id: string, enabled: boolean) {
    setSettings({ ...settings, actions: { ...settings.actions, [id]: enabled } });
  }

  return (
    <div className="grid gap-4">
      <SettingsSubnav
        label="WhatsApp customer service"
        value={section}
        onChange={setSection}
        tabs={[
          { id: "connection", label: "Connection" },
          { id: "bot", label: "Bot" },
          { id: "actions", label: "Customer Actions" },
          { id: "security", label: "Security" },
          { id: "handoff", label: "Human Handoff" },
        ]}
      />

      {section === "connection" ? (
        <div className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:p-5">
          <div>
            <h2 className="font-medium">Link WhatsApp</h2>
            <p className="text-sm text-muted">
              Same as WhatsApp Web. On the phone open WhatsApp, then Linked devices, then Link a device, and scan this code.
            </p>
          </div>
          <p className="text-sm">
            Status: {link.status === "connected" ? `Connected${link.phone ? ` · ${link.phone}` : ""}` : link.status === "qr" ? "Waiting for scan" : "Not linked"}
          </p>
          {link.qrDataUrl ? (
            <img src={link.qrDataUrl} alt="WhatsApp link QR code" className="h-56 w-56 rounded-lg border border-border bg-white p-2" />
          ) : null}
          {link.error ? <p className="text-sm text-danger">{link.error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={linking}
              aria-busy={linking}
              onClick={() => {
                if (lock.current) return;
                lock.current = true;
                setLinking(true);
                startWhatsAppLink()
                  .then((next) => setLink(next))
                  .catch((err) => setNote({ ok: false, text: safeSettingsError(err, "Couldn't start the WhatsApp link.") }))
                  .finally(() => {
                    lock.current = false;
                    setLinking(false);
                  });
              }}
            >
              {linking ? "Preparing code…" : "Link a device"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                unlinkWhatsApp()
                  .then(() => setLink({ status: "disconnected", phone: "", qrDataUrl: "", error: "" }))
                  .catch((err) => setNote({ ok: false, text: safeSettingsError(err, "Couldn't unlink WhatsApp.") }));
              }}
            >
              Unlink
            </Button>
          </div>
          <p className="text-xs text-muted">Billing receipts can still use the WhatsApp Business Cloud API below. The linked phone is the customer-service chat.</p>
          <SettingsStatus note={note} />
        </div>
      ) : null}

      {section !== "connection" ? (
        <form className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:p-5" onSubmit={(event) => void save(event)}>
          {section === "bot" ? (
            <>
              <h2 className="font-medium">Bot</h2>
              <SettingsCheck label="Enable customer WhatsApp" checked={settings.enabled} onChange={(enabled) => setSettings({ ...settings, enabled })} />
              <SettingsCheck label="Use AI when a message is unclear" checked={settings.ai_enabled} onChange={(ai_enabled) => setSettings({ ...settings, ai_enabled })} />
              <p className="text-xs text-muted">AI only classifies intent. It cannot run actions, see secrets, or confirm payments. If AI is off or unavailable, the numbered menu still works.</p>
              <SettingsCheck label="Emergency stop for automated changes" checked={settings.kill_switch} onChange={(kill_switch) => setSettings({ ...settings, kill_switch })} />
              <p className="text-xs text-muted">When this is on, chats still arrive and account checks can stay available, but restarts, password changes, and other changes are blocked.</p>
            </>
          ) : null}
          {section === "actions" ? (
            <>
              <h2 className="font-medium">Customer Actions</h2>
              <SettingsCheck label="Account and payment checks" checked={settings.read_only_enabled} onChange={(read_only_enabled) => setSettings({ ...settings, read_only_enabled })} />
              <SettingsCheck label="Connection actions" checked={settings.connection_actions_enabled} onChange={(connection_actions_enabled) => setSettings({ ...settings, connection_actions_enabled })} />
              <SettingsCheck label="Router actions" checked={settings.cpe_actions_enabled} onChange={(cpe_actions_enabled) => setSettings({ ...settings, cpe_actions_enabled })} />
              <SettingsCheck label="Password actions" checked={settings.password_actions_enabled} onChange={(password_actions_enabled) => setSettings({ ...settings, password_actions_enabled })} />
              <SettingsCheck label="Renewal and upgrade requests" checked={settings.service_actions_enabled} onChange={(service_actions_enabled) => setSettings({ ...settings, service_actions_enabled })} />
              <div className="grid gap-2 sm:grid-cols-2">
                {actions.map((action) => (
                  <SettingsCheck
                    key={action.id}
                    label={action.name}
                    checked={settings.actions[action.id] ?? action.enabled}
                    onChange={(enabled) => toggleAction(action.id, enabled)}
                  />
                ))}
              </div>
            </>
          ) : null}
          {section === "security" ? (
            <>
              <h2 className="font-medium">Customer Verification</h2>
              <p className="text-sm text-muted">Sensitive changes send a code by SMS, never on WhatsApp. Codes expire, and failed attempts lock elevation. These limits cannot be weakened past the platform minimum.</p>
              <SettingsField label="SMS code lifetime (seconds)" hint="Between 60 and 300.">
                <Input
                  type="number"
                  min={60}
                  max={300}
                  value={settings.otp_ttl_seconds}
                  onChange={(event) => setSettings({ ...settings, otp_ttl_seconds: Number(event.target.value) || 300 })}
                />
              </SettingsField>
              <SettingsField label="Verified session (seconds)" hint="Between 60 and 600.">
                <Input
                  type="number"
                  min={60}
                  max={600}
                  value={settings.level2_ttl_seconds}
                  onChange={(event) => setSettings({ ...settings, level2_ttl_seconds: Number(event.target.value) || 600 })}
                />
              </SettingsField>
              <SettingsField label="Business hours" optional hint="24-hour window, for example 08:00-18:00. Empty means always open for checks.">
                <Input value={settings.business_hours} onChange={(event) => setSettings({ ...settings, business_hours: event.target.value })} />
              </SettingsField>
            </>
          ) : null}
          {section === "handoff" ? (
            <>
              <h2 className="font-medium">Human Handoff</h2>
              <SettingsField label="Support phone shown in the menu" optional>
                <Input value={settings.handoff_phone} onChange={(event) => setSettings({ ...settings, handoff_phone: event.target.value })} />
              </SettingsField>
              <div className="grid gap-2">
                {chats.length ? chats.map((chat) => (
                  <div key={chat.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">{chat.customer_name || chat.phone_e164}</p>
                      <p className="text-xs text-muted">{chat.phone_e164}</p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        pauseWhatsAppConversation({ data: { id: chat.id, paused: !chat.automation_paused } })
                          .then(() => setChats((rows) => rows.map((row) => (row.id === chat.id ? { ...row, automation_paused: !row.automation_paused } : row))))
                          .catch((err) => setNote({ ok: false, text: safeSettingsError(err, WA_SAVE_FAIL) }));
                      }}
                    >
                      {chat.automation_paused ? "Resume bot" : "Take over"}
                    </Button>
                  </div>
                )) : <p className="text-sm text-muted">No customer chats yet.</p>}
              </div>
            </>
          ) : null}
          <SettingsStatus note={note} />
          <SaveButton busy={busy} label="Save changes" />
        </form>
      ) : null}
    </div>
  );
}
