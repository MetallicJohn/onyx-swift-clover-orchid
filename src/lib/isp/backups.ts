import { existsSync, lstatSync, readdirSync, realpathSync, unlinkSync } from "node:fs";
import path from "node:path";

export const DEFAULT_BACKUP_DIR = "/opt/ispsolutions/backups";
export const DEFAULT_BACKUP_KEEP = 14;
export const MIN_BACKUP_KEEP = 1;
export const MAX_BACKUP_KEEP = 365;

const BACKUP_NAME = /^ispsolutions-[A-Za-z0-9._-]+\.(dump|sql\.gz)$/;

export type BackupRow = {
  id: string;
  name: string;
  type: string;
  size_bytes: number;
  size_label: string;
  modified_at: string;
  path: string;
};

export function resolveBackupDir(override?: string) {
  const raw = (override || process.env.ISPSOLUTIONS_BACKUP_DIR || DEFAULT_BACKUP_DIR).trim();
  return raw || DEFAULT_BACKUP_DIR;
}

export function isBackupBasename(name: string) {
  const n = String(name || "");
  if (!n || n !== path.basename(n)) return false;
  if (n.includes("..") || n.includes("/") || n.includes("\\") || n.includes("\0")) return false;
  return BACKUP_NAME.test(n);
}

export function parseBackupKeep(raw: unknown) {
  if (typeof raw === "boolean" || raw == null || Array.isArray(raw)) {
    throw new Error("Enter a whole number of backups to keep");
  }
  const text = String(raw).trim();
  if (!/^[0-9]+$/.test(text)) throw new Error("Enter a whole number of backups to keep");
  const n = Number(text);
  if (!Number.isInteger(n) || n < MIN_BACKUP_KEEP) throw new Error("Keep at least 1 backup");
  if (n > MAX_BACKUP_KEEP) throw new Error("Keep at most 365 backups");
  return n;
}

export function formatBackupSize(bytes: number) {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${n < 10 * 1024 ? (n / 1024).toFixed(1) : Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) {
    const mb = n / (1024 * 1024);
    return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
  }
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function backupType(name: string) {
  if (name.endsWith(".sql.gz")) return "SQL gzip";
  if (name.endsWith(".dump")) return "PostgreSQL custom dump";
  return "Backup";
}

function inspectDir(dir: string): { ok: true; root: string } | { ok: false; error: string } {
  if (!existsSync(dir)) return { ok: false, error: "Backup directory is not available" };
  try {
    const st = lstatSync(dir);
    if (st.isSymbolicLink()) return { ok: false, error: "Backup directory is not available" };
    if (!st.isDirectory()) return { ok: false, error: "Backup directory is not available" };
    const root = realpathSync(dir);
    return { ok: true, root };
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
    if (code === "EACCES") return { ok: false, error: "Permission denied" };
    return { ok: false, error: "Backup directory is not available" };
  }
}

export function safeBackupPath(dir: string, name: string) {
  if (!isBackupBasename(name)) throw new Error("Invalid filename");
  const inspected = inspectDir(dir);
  if (!inspected.ok) throw new Error(inspected.error);
  const target = path.resolve(inspected.root, name);
  const rel = path.relative(inspected.root, target);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Invalid filename");
  return { root: inspected.root, target, name };
}

export function listBackupFiles(dir = resolveBackupDir()): {
  available: boolean;
  error: string | null;
  directory: string;
  backups: BackupRow[];
} {
  const directory = dir;
  const inspected = inspectDir(dir);
  if (!inspected.ok) {
    return { available: false, error: inspected.error, directory, backups: [] };
  }
  let names: string[] = [];
  try {
    names = readdirSync(inspected.root);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
    return {
      available: false,
      error: code === "EACCES" ? "Permission denied" : "Could not read backups",
      directory,
      backups: [],
    };
  }
  const backups: BackupRow[] = [];
  for (const name of names) {
    if (!isBackupBasename(name)) continue;
    const full = path.join(inspected.root, name);
    let st;
    try {
      st = lstatSync(full);
    } catch {
      continue;
    }
    if (st.isSymbolicLink() || !st.isFile()) continue;
    backups.push({
      id: name,
      name,
      type: backupType(name),
      size_bytes: st.size,
      size_label: formatBackupSize(st.size),
      modified_at: new Date(st.mtimeMs).toISOString(),
      path: `${DEFAULT_BACKUP_DIR}/${name}`,
    });
  }
  backups.sort((a, b) => (a.modified_at < b.modified_at ? 1 : a.modified_at > b.modified_at ? -1 : a.name.localeCompare(b.name)));
  return { available: true, error: null, directory: DEFAULT_BACKUP_DIR, backups };
}

function unlinkQuiet(file: string) {
  try {
    unlinkSync(file);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
    if (code !== "ENOENT") throw err;
  }
}

export function deleteBackupFile(name: string, dir = resolveBackupDir()) {
  const { root, target } = safeBackupPath(dir, name);
  let st;
  try {
    st = lstatSync(target);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
    if (code === "ENOENT") throw new Error("Backup not found");
    if (code === "EACCES") throw new Error("Permission denied");
    throw new Error("Could not delete backup");
  }
  if (st.isSymbolicLink()) throw new Error("Invalid filename");
  if (!st.isFile()) throw new Error("Invalid filename");
  try {
    unlinkSync(target);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
    if (code === "ENOENT") throw new Error("Backup already deleted");
    if (code === "EACCES") throw new Error("Permission denied");
    throw new Error("Could not delete backup");
  }
  unlinkQuiet(path.join(root, `${name}.meta`));
  unlinkQuiet(path.join(root, `${name}.counts.json`));
  return { deleted: name };
}

/** Keep the newest `keep` dump/sql.gz files. Sidecars of pruned dumps are removed. */
export function pruneBackupFiles(keep: number, dir = resolveBackupDir()) {
  const n = parseBackupKeep(keep);
  const listed = listBackupFiles(dir);
  if (!listed.available) return { pruned: [] as string[] };
  const extra = listed.backups.slice(n);
  const pruned: string[] = [];
  for (const row of extra) {
    deleteBackupFile(row.name, dir);
    pruned.push(row.name);
  }
  return { pruned };
}
