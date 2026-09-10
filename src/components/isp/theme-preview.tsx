import type { ThemePalette } from "@/lib/theme/presets";

export function ThemePreview({ palette, name }: { palette: ThemePalette; name: string }) {
  return (
    <div
      className="overflow-hidden rounded-xl border text-left"
      style={{ background: palette.bg, color: palette.fg, borderColor: palette.border, maxHeight: 280 }}
    >
      <div className="flex min-h-[220px]">
        <aside className="hidden w-28 shrink-0 flex-col gap-1 p-2 sm:flex" style={{ background: palette.surface, borderRight: `1px solid ${palette.border}` }}>
          <div className="mb-2 flex items-center gap-1.5 px-1 py-1">
            <span className="grid size-5 place-items-center rounded text-[8px] font-bold" style={{ background: palette.primary, color: palette.primaryFg }}>
              {name.slice(0, 1)}
            </span>
            <span className="truncate text-[10px] font-semibold">{name}</span>
          </div>
          {["Overview", "Customers", "Billing"].map((item, i) => (
            <div
              key={item}
              className="rounded px-2 py-1 text-[10px]"
              style={
                i === 0
                  ? { background: `${palette.primary}22`, color: palette.fg }
                  : { color: palette.muted }
              }
            >
              {item}
            </div>
          ))}
        </aside>
        <div className="min-w-0 flex-1 p-3">
          <div className="mb-2 flex items-center justify-between text-[10px]" style={{ color: palette.muted }}>
            <span>Operations</span>
            <span className="rounded px-1.5 py-0.5" style={{ background: palette.elevated }}>
              Admin
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Revenue", value: "KES 48k", color: palette.success },
              { label: "Online", value: "128", color: palette.primary },
              { label: "Overdue", value: "4", color: palette.warning },
            ].map((k) => (
              <div key={k.label} className="rounded-lg p-2" style={{ background: palette.surface, border: `1px solid ${palette.border}` }}>
                <div className="text-[9px]" style={{ color: palette.muted }}>
                  {k.label}
                </div>
                <div className="mt-1 font-mono text-xs">{k.value}</div>
                <div className="mt-2 h-1 rounded-full" style={{ background: k.color }} />
              </div>
            ))}
          </div>
          <div className="mt-2 flex h-10 items-end gap-1 px-1">
            {[40, 65, 50, 80, 45, 90, 70].map((h, i) => (
              <div key={i} className="flex-1 rounded-sm" style={{ height: `${h}%`, background: palette.primary, opacity: 0.35 + h / 200 }} />
            ))}
          </div>
          <div className="mt-2 overflow-hidden rounded-lg" style={{ border: `1px solid ${palette.border}` }}>
            <div className="grid grid-cols-3 px-2 py-1 text-[9px]" style={{ background: palette.elevated, color: palette.muted }}>
              <span>Customer</span>
              <span>Status</span>
              <span className="text-right">Amount</span>
            </div>
            <div className="grid grid-cols-3 items-center px-2 py-1 text-[10px]" style={{ background: palette.surface }}>
              <span>Amina</span>
              <span>
                <span className="rounded-full px-1.5 py-0.5 text-[9px]" style={{ background: `${palette.success}22`, color: palette.success }}>
                  Active
                </span>
              </span>
              <span className="text-right font-mono">2,500</span>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className="inline-flex h-7 items-center rounded-md px-3 text-[10px] font-medium"
              style={{ background: palette.primary, color: palette.primaryFg }}
            >
              Save
            </span>
            <span
              className="inline-flex h-7 items-center rounded-md px-3 text-[10px]"
              style={{ background: palette.elevated, color: palette.fg, border: `1px solid ${palette.border}` }}
            >
              Cancel
            </span>
            <span
              className="h-7 min-w-24 rounded-md px-2 text-[10px] leading-7"
              style={{ background: palette.bg, border: `1px solid ${palette.border}`, color: palette.muted }}
            >
              Search…
            </span>
            <span className="inline-flex h-7 items-center rounded-md px-3 text-[10px]" style={{ color: palette.danger }}>
              Suspend
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
