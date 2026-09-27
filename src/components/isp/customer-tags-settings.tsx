import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SaveButton, SettingsField, SettingsStatus, type SettingsNote } from "@/components/isp/settings-ui";
import { TAG_SAVE_FAIL, TAG_SAVE_OK, safeSettingsError } from "@/lib/isp/settings-feedback";
import {
  createCustomerTagFn,
  deleteCustomerTagFn,
  listCustomerTagsFn,
  renameCustomerTagFn,
  setCustomerTagEnabledFn,
} from "@/lib/isp/server-tags";

type TagRow = Awaited<ReturnType<typeof listCustomerTagsFn>>["tags"][number];

export function CustomerTagsSettings() {
  const [tags, setTags] = useState<TagRow[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<SettingsNote>(null);
  const lock = useRef(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [rename, setRename] = useState("");

  async function load() {
    const res = await listCustomerTagsFn();
    setTags(res.tags);
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-medium">Customer tags</h2>
        <p className="text-sm text-muted">
          One-word labels for this ISP only — VIP, Student, Fibre, Rural. Assign them on the customer, then filter the
          list and message that audience.
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          setNote(null);
          try {
            await createCustomerTagFn({ data: { name } });
            setName("");
            await load();
            setNote({ ok: true, text: TAG_SAVE_OK });
          } catch (err) {
            setNote({ ok: false, text: safeSettingsError(err, TAG_SAVE_FAIL) });
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        <SettingsField label="New tag" required hint="One word, up to 32 characters.">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="VIP"
            required
            maxLength={32}
            className="sm:w-56"
          />
        </SettingsField>
        <SaveButton busy={busy} label="Create tag" />
      </form>
      <SettingsStatus note={note} />

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {tags.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
            {editing === t.id ? (
              <form
                className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (lock.current) return;
                  lock.current = true;
                  setBusy(true);
                  setNote(null);
                  try {
                    await renameCustomerTagFn({ data: { id: t.id, name: rename } });
                    setEditing(null);
                    await load();
                    setNote({ ok: true, text: TAG_SAVE_OK });
                  } catch (err) {
                    setNote({ ok: false, text: safeSettingsError(err, TAG_SAVE_FAIL) });
                  } finally {
                    lock.current = false;
                    setBusy(false);
                  }
                }}
              >
                <Input value={rename} onChange={(e) => setRename(e.target.value)} className="max-w-xs" required maxLength={32} />
                <SaveButton busy={busy} label="Save changes" />
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <div className="min-w-0 flex-1">
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-muted">
                  {t.customer_count} {t.customer_count === 1 ? "customer" : "customers"}
                  {t.enabled ? "" : " · disabled"}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setEditing(t.id);
                  setRename(t.name);
                }}
              >
                Rename
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  if (lock.current) return;
                  lock.current = true;
                  setNote(null);
                  try {
                    await setCustomerTagEnabledFn({ data: { id: t.id, enabled: !t.enabled } });
                    await load();
                    setNote({ ok: true, text: TAG_SAVE_OK });
                  } catch (err) {
                    setNote({ ok: false, text: safeSettingsError(err, TAG_SAVE_FAIL) });
                  } finally {
                    lock.current = false;
                  }
                }}
              >
                {t.enabled ? "Disable" : "Enable"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  if (lock.current) return;
                  lock.current = true;
                  setNote(null);
                  try {
                    await deleteCustomerTagFn({ data: { id: t.id } });
                    await load();
                    setNote({ ok: true, text: "Customer tag removed." });
                  } catch (err) {
                    setNote({ ok: false, text: safeSettingsError(err, TAG_SAVE_FAIL) });
                  } finally {
                    lock.current = false;
                  }
                }}
              >
                Delete
              </Button>
            </div>
          </li>
        ))}
        {tags.length === 0 ? <li className="px-4 py-6 text-sm text-muted">No tags yet. Create VIP or Fibre to get started.</li> : null}
      </ul>
    </div>
  );
}
