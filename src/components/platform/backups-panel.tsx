import { useEffect, useState } from "react";
import { nairobiTime } from "@/components/platform/format";
import { Panel } from "@/components/platform/ui";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { deleteSaasBackup, listSaasBackups, saveSaasBackupRetention } from "@/lib/isp/server-platform";

type BackupRow = {
  id: string;
  name: string;
  type: string;
  size_label: string;
  modified_at: string;
  path: string;
};

type Snapshot = {
  available: boolean;
  error: string | null;
  directory: string;
  backups: BackupRow[];
  backup_keep: number;
};

export function BackupsPanel() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [keep, setKeep] = useState("14");
  const [busy, setBusy] = useState(false);
  const [keepBusy, setKeepBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, setPending] = useState<BackupRow | null>(null);

  async function load() {
    const res = await listSaasBackups();
    setData(res);
    setKeep(String(res.backup_keep));
  }

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Could not load backups"));
  }, []);

  return (
    <div className="grid gap-6">
      <Panel>
        <h2 className="text-base font-semibold tracking-tight">Backup retention</h2>
        <p className="mt-1 text-sm text-muted">Number of recent backup iterations retained by the system.</p>
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setKeepBusy(true);
            setError(null);
            setOk(null);
            try {
              const saved = await saveSaasBackupRetention({ data: { keep } });
              setKeep(String(saved.backup_keep));
              setOk(`Keeping the last ${saved.backup_keep} backups.`);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not save retention");
            } finally {
              setKeepBusy(false);
            }
          }}
        >
          <Field label="Backups to keep">
            <Input
              type="number"
              min={1}
              max={365}
              step={1}
              value={keep}
              onChange={(e) => setKeep(e.target.value)}
              className="w-28"
            />
          </Field>
          <Button type="submit" disabled={keepBusy}>
            {keepBusy ? "Saving…" : "Save"}
          </Button>
        </form>
      </Panel>

      <Panel>
        <h2 className="text-base font-semibold tracking-tight">Backup list</h2>
        <p className="mt-1 text-sm text-muted">
          Files currently in {data?.directory || "/opt/ispsolutions/backups"}. Newest first.
        </p>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        {ok ? <p className="mt-3 text-sm text-ok">{ok}</p> : null}
        {!data ? <p className="mt-4 text-sm text-muted">Loading backups…</p> : null}
        {data && !data.available ? (
          <p className="mt-4 text-sm text-muted">{data.error || "Backup directory is not available."}</p>
        ) : null}
        {data?.available && data.backups.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No backups yet.</p>
        ) : null}
        {data?.available && data.backups.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs font-medium uppercase tracking-wider text-subtle">
                  <th className="py-2 pr-3 font-medium">Backup</th>
                  <th className="py-2 pr-3 font-medium">Size</th>
                  <th className="py-2 pr-3 font-medium">Modified</th>
                  <th className="py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.backups.map((row) => (
                  <tr key={row.id} className="border-b border-border/70">
                    <td className="py-3 pr-3">
                      <div className="font-medium">{row.name}</div>
                      <div className="text-xs text-muted">{row.type}</div>
                      <div className="text-xs text-subtle">{row.path}</div>
                    </td>
                    <td className="py-3 pr-3 font-mono text-xs">{row.size_label}</td>
                    <td className="py-3 pr-3 text-xs">{nairobiTime(row.modified_at)}</td>
                    <td className="py-3">
                      <Button type="button" size="sm" variant="danger" onClick={() => setPending(row)}>
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>

      <Dialog
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title="Delete backup"
        description={pending ? `Delete ${pending.name}? This cannot be undone.` : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={busy || !pending}
              onClick={async () => {
                if (!pending) return;
                setBusy(true);
                setError(null);
                setOk(null);
                try {
                  await deleteSaasBackup({ data: { name: pending.name } });
                  setPending(null);
                  await load();
                  setOk("Backup deleted.");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not delete backup");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </div>
        }
      >
        {pending ? (
          <p className="text-sm">
            Filename: <span className="font-mono">{pending.name}</span>
          </p>
        ) : (
          <p className="text-sm text-muted">No backup selected.</p>
        )}
      </Dialog>
    </div>
  );
}
