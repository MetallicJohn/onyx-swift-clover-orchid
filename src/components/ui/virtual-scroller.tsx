import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";

export const VIRTUAL_VIEWPORT = "max-h-[min(70vh,44rem)] overflow-auto";

export function VirtualList<T>({
  items,
  estimateSize,
  overscan = 8,
  className,
  viewportClassName = VIRTUAL_VIEWPORT,
  scrollToIndex,
  renderItem,
}: {
  items: T[];
  estimateSize: number;
  overscan?: number;
  className?: string;
  viewportClassName?: string;
  scrollToIndex?: number;
  renderItem: (item: T, index: number) => ReactNode;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  useEffect(() => {
    if (scrollToIndex == null || scrollToIndex < 0 || scrollToIndex >= items.length) return;
    virtualizer.scrollToIndex(scrollToIndex, { align: "auto" });
  }, [scrollToIndex, items.length, virtualizer]);

  return (
    <div ref={parentRef} className={cn(viewportClassName, className)}>
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            data-index={row.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${row.start}px)` }}
          >
            {renderItem(items[row.index], row.index)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function VirtualGrid<T>({
  items,
  estimateSize,
  columns,
  gapClass = "gap-3 pb-3",
  className,
  viewportClassName = VIRTUAL_VIEWPORT,
  renderItem,
}: {
  items: T[];
  estimateSize: number;
  columns: number;
  gapClass?: string;
  className?: string;
  viewportClassName?: string;
  renderItem: (item: T, index: number) => ReactNode;
}) {
  const cols = Math.max(1, columns);
  const rowCount = Math.ceil(items.length / cols);
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan: 6,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  return (
    <div ref={parentRef} className={cn(viewportClassName, className)}>
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const start = row.index * cols;
          const slice = items.slice(start, start + cols);
          return (
            <div
              key={row.key}
              data-index={row.index}
              ref={virtualizer.measureElement}
              className={cn("absolute left-0 top-0 grid w-full", gapClass)}
              style={{
                transform: `translateY(${row.start}px)`,
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              }}
            >
              {slice.map((item, i) => renderItem(item, start + i))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TablePad({ height, colSpan }: { height: number; colSpan: number }) {
  if (height <= 0) return null;
  return (
    <tr aria-hidden>
      <td colSpan={colSpan} className="p-0" style={{ height }} />
    </tr>
  );
}

export function VirtualTableFrame({
  parentRef,
  className,
  children,
}: {
  parentRef: RefObject<HTMLDivElement | null>;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div ref={parentRef} className={cn(VIRTUAL_VIEWPORT, className)}>
      {children}
    </div>
  );
}
