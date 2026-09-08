import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { exportCustomersCsv, importCustomers, type ImportRow } from "@/lib/isp/server";

export const Route = createFileRoute("/app/import")({ component: ImportPage });

function ImportPage() {
  const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  function parseCsv(text: string): ImportRow[] {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
    return lines.slice(1).map((line) => {
      const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      const get = (k: string) => cols[headers.indexOf(k)] ?? "";
      return {
        name: get("name"),
        phone: get("phone"),
        email: get("email"),
        address: get("address"),
        access_method: (get("access_method") || "pppoe") as ImportRow["access_method"],
        username: get("username"),
        static_ip: get("static_ip"),
        package_name: get("package_name"),
      };
    });
  }

  async function onFile(file: File) {
    setBusy(true);
    setResult(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      const res = await importCustomers({ data: { rows } });
      setResult(res);
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
    a.download = "gridline-customers.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import / export</h1>
        <p className="text-sm text-muted">
          Fast onboarding for PPPoE and static customers. Preview is not required — invalid rows are skipped with
          errors.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-4">
          <h2 className="font-medium">Import CSV</h2>
          <p className="mt-2 text-sm text-muted">
            Columns: name, phone, email, address, access_method (pppoe|static|hotspot), username, static_ip,
            package_name
          </p>
          <input
            className="mt-4 block w-full text-sm"
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
          {result ? (
            <div className="mt-4 text-sm">
              <p className="text-ok">{result.created} customers created</p>
              {result.errors.map((err) => (
                <p key={err} className="text-danger">
                  {err}
                </p>
              ))}
            </div>
          ) : null}
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <h2 className="font-medium">Export</h2>
          <p className="mt-2 text-sm text-muted">Download customers with PPPoE usernames and static IPs.</p>
          <Button className="mt-4" variant="secondary" onClick={() => void onExport()}>
            Download CSV
          </Button>
        </div>
      </div>

      <pre className="overflow-x-auto rounded-xl border border-border bg-elevated p-4 font-mono text-xs text-muted">
        {`name,phone,email,address,access_method,username,static_ip,package_name
Jane Muthoni,+254700111222,jane@example.com,Karen,pppoe,jane.muthoni,,Home 10
Acme Ltd,+254700333444,net@acme.ke,Industrial Area,static,,102.68.10.20,Business 50`}
      </pre>
    </div>
  );
}
