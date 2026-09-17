import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { formatDate } from "@/lib/isp/display";
import {
  IMPORT_COLUMNS,
  IMPORT_MODES,
  importModeLabel,
  importTemplateCsv,
  onboardingTypeLabel,
  parseDelimitedText,
  suggestColumnMap,
  type ImportColumnKey,
  type ImportMode,
  type ImportPreviewRow,
} from "@/lib/isp/onboard-import-format";
import { confirmCustomerImportFn, previewCustomerImportFn } from "@/lib/isp/server-onboard";
import { exportCustomersCsv } from "@/lib/isp/server";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/import")({ component: ImportPage });

type Step = "upload" | "map" | "preview" | "done";

function ImportPage() {
  const [step, setStep] = useState<Step>("upload");
  const [mode, setMode] = useState<ImportMode>("continuing");
  const [fileName, setFileName] = useState("");
  const [text, setText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [map, setMap] = useState<Record<ImportColumnKey, string>>(suggestColumnMap([]));
  const [preview, setPreview] = useState<{
    rows: ImportPreviewRow[];
    ready_count: number;
    error_count: number;
    truncated: boolean;
    total_rows: number;
  } | null>(null);
  const [result, setResult] = useState<{
    created: number;
    attached: number;
    skipped: number;
    errors: string[];
    batch_id: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mappedRequired = useMemo(
    () => IMPORT_COLUMNS.filter((c) => c.required).every((c) => map[c.key]),
    [map],
  );

  function downloadTemplate() {
    const csv = importTemplateCsv();
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ispsolutions-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(file: File) {
    setError(null);
    setResult(null);
    const name = file.name.toLowerCase();
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      setError("Save the spreadsheet as CSV or TSV, then upload that file.");
      return;
    }
    const raw = await file.text();
    const parsed = parseDelimitedText(raw);
    if (!parsed.headers.length || !parsed.rows.length) {
      setError("The file has no data rows.");
      return;
    }
    setFileName(file.name);
    setText(raw);
    setHeaders(parsed.headers);
    setMap(suggestColumnMap(parsed.headers));
    setPreview(null);
    setStep("map");
  }

  async function runPreview() {
    setBusy(true);
    setError(null);
    try {
      const res = await previewCustomerImportFn({ data: { text, mode, map } });
      setPreview(res);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not validate the file");
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!preview?.ready_count) return;
    setBusy(true);
    setError(null);
    try {
      const res = await confirmCustomerImportFn({ data: { text, mode, map } });
      setResult(res);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import");
    } finally {
      setBusy(false);
    }
  }

  async function onExport() {
    const csv = await exportCustomersCsv();
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ispsolutions-customers.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import / export</h1>
        <p className="text-sm text-muted">
          Migrate customers without resetting their paid-through date. CSV or TSV, up to 500 rows. Excel workbooks
          should be saved as CSV first.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {(["upload", "map", "preview", "done"] as Step[]).map((s) => (
          <span
            key={s}
            className={cn(
              "rounded-full px-3 py-1",
              step === s ? "bg-accent text-accent-fg" : "bg-elevated text-muted",
            )}
          >
            {s === "upload" ? "1. File" : s === "map" ? "2. Columns" : s === "preview" ? "3. Preview" : "4. Result"}
          </span>
        ))}
      </div>

      {step === "upload" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="font-medium">Import file</h2>
            <p className="mt-2 text-sm text-muted">CSV or TSV. Maximum 500 rows. Required: name, phone, package.</p>
            <div className="mt-4 grid gap-3">
              <Field label="Import mode">
                <Select value={mode} onChange={(e) => setMode(e.target.value as ImportMode)}>
                  {IMPORT_MODES.map((m) => (
                    <option key={m} value={m}>
                      {importModeLabel(m)}
                    </option>
                  ))}
                </Select>
              </Field>
              <p className="text-xs text-muted">
                Continuing clients need an expiry column. First renewal uses that date — not the day you import.
              </p>
              <input
                className="block w-full text-sm"
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                }}
              />
              <Button type="button" variant="secondary" onClick={downloadTemplate}>
                Download sample template
              </Button>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="font-medium">Export</h2>
            <p className="mt-2 text-sm text-muted">Download customers with usernames, packages, and expiry dates.</p>
            <Button className="mt-4" variant="secondary" onClick={() => void onExport()}>
              Download CSV
            </Button>
          </div>
        </div>
      ) : null}

      {step === "map" ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h2 className="font-medium">Map columns</h2>
          <p className="mt-1 text-sm text-muted">
            {fileName || "Uploaded file"} · {headers.length} columns. Match the existing expiry column for continuing
            clients.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {IMPORT_COLUMNS.map((col) => (
              <Field key={col.key} label={`${col.label}${col.required ? " *" : ""}`}>
                <Select
                  value={map[col.key]}
                  onChange={(e) => setMap((prev) => ({ ...prev, [col.key]: e.target.value }))}
                >
                  <option value="">{col.required ? "Choose a column" : "Not in file"}</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="ghost" onClick={() => setStep("upload")}>
              Back
            </Button>
            <Button type="button" onClick={() => void runPreview()} disabled={busy || !mappedRequired}>
              {busy ? "Checking…" : "Validate and preview"}
            </Button>
          </div>
        </div>
      ) : null}

      {step === "preview" && preview ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h2 className="font-medium">Preview</h2>
          <p className="mt-1 text-sm text-muted">
            {preview.ready_count} ready · {preview.error_count} with errors
            {preview.truncated ? ` · first 500 of ${preview.total_rows} rows` : ""}
            . No invoice is created on import. Onboarding SMS is off unless the file says yes.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted">
                  <th className="px-2 py-2">Customer</th>
                  <th className="px-2 py-2">Package</th>
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2">Expiry</th>
                  <th className="px-2 py-2">First renewal</th>
                  <th className="px-2 py-2">SMS</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.line} className="border-b border-border/60">
                    <td className="px-2 py-2">
                      {row.name || "—"}
                      <span className="block text-xs text-muted">{row.phone}</span>
                    </td>
                    <td className="px-2 py-2">{row.package_name || "—"}</td>
                    <td className="px-2 py-2">{onboardingTypeLabel(row.onboarding_type)}</td>
                    <td className="px-2 py-2">{row.expiry_ymd ? formatDate(row.expiry_ymd) : "—"}</td>
                    <td className="px-2 py-2">{row.first_renewal_ymd ? formatDate(row.first_renewal_ymd) : "—"}</td>
                    <td className="px-2 py-2">{row.notify_label}</td>
                    <td className="px-2 py-2">
                      {row.errors.length ? (
                        <span className="text-danger">{row.errors.map((e) => e.message).join("; ")}</span>
                      ) : (
                        <span className="text-ok">
                          Ready
                          {row.attach_customer_name ? ` · extra service on ${row.attach_customer_name}` : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="ghost" onClick={() => setStep("map")} disabled={busy}>
              Back
            </Button>
            <Button type="button" onClick={() => void runImport()} disabled={busy || !preview.ready_count}>
              {busy ? "Importing…" : `Import ${preview.ready_count} ready row${preview.ready_count === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      ) : null}

      {step === "done" && result ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h2 className="font-medium">Import finished</h2>
          <p className="mt-2 text-sm">
            {result.created} new customers · {result.attached} extra services on existing customers · {result.skipped}{" "}
            skipped
          </p>
          <p className="mt-1 text-xs text-muted">Batch {result.batch_id}. No renewal invoices were issued for this import.</p>
          {result.errors.length ? (
            <div className="mt-3 space-y-1 text-sm text-danger">
              {result.errors.slice(0, 40).map((err) => (
                <p key={err}>{err}</p>
              ))}
            </div>
          ) : null}
          <Button
            className="mt-4"
            type="button"
            variant="secondary"
            onClick={() => {
              setStep("upload");
              setPreview(null);
              setResult(null);
              setText("");
              setFileName("");
            }}
          >
            Import another file
          </Button>
        </div>
      ) : null}

      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
