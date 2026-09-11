import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState } from "react";

export function useColumnCount(mobile = 1, tablet = 2, desktop = 2) {
  const [columns, setColumns] = useState(mobile);
  useEffect(() => {
    const md = window.matchMedia("(min-width: 768px)");
    const xl = window.matchMedia("(min-width: 1280px)");
    const apply = () => {
      if (xl.matches) setColumns(desktop);
      else if (md.matches) setColumns(tablet);
      else setColumns(mobile);
    };
    apply();
    md.addEventListener("change", apply);
    xl.addEventListener("change", apply);
    return () => {
      md.removeEventListener("change", apply);
      xl.removeEventListener("change", apply);
    };
  }, [mobile, tablet, desktop]);
  return columns;
}

export function useTableVirtualizer(count: number, estimateSize: number, overscan = 12) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
    measureElement: (el) => el.getBoundingClientRect().height,
  });
  const rows = virtualizer.getVirtualItems();
  const padTop = rows[0]?.start ?? 0;
  const padBottom = virtualizer.getTotalSize() - (rows[rows.length - 1]?.end ?? 0);
  return { parentRef, virtualizer, rows, padTop, padBottom };
}
