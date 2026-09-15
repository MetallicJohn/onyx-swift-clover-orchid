import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export function Hint({
  label,
  meaning,
  className,
  children,
}: {
  label: string;
  meaning: string;
  className?: string;
  children?: ReactNode;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  function place() {
    const box = triggerRef.current?.getBoundingClientRect();
    if (!box) return;
    const width = 288;
    const left = Math.min(Math.max(12, box.left), window.innerWidth - width - 12);
    const below = box.bottom + 8;
    const top = below + 120 > window.innerHeight ? Math.max(12, box.top - 128) : below;
    setPos({ top, left });
  }

  function show() {
    place();
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onMove() {
      const box = triggerRef.current?.getBoundingClientRect();
      if (!box) return;
      const width = 288;
      const left = Math.min(Math.max(12, box.left), window.innerWidth - width - 12);
      const below = box.bottom + 8;
      const top = below + 120 > window.innerHeight ? Math.max(12, box.top - 128) : below;
      setPos({ top, left });
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          "inline-flex min-h-11 items-center border-b border-dotted border-muted text-left",
          "text-muted transition-colors duration-150 hover:border-fg hover:text-fg",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          className,
        )}
        aria-label={`${label}: ${meaning}`}
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={() => setOpen(false)}
        onFocus={show}
        onBlur={() => setOpen(false)}
      >
        {children ?? label}
      </button>
      {open
        ? createPortal(
            <div
              id={id}
              role="tooltip"
              style={{ top: pos.top, left: pos.left }}
              className="pointer-events-none fixed z-50 w-72 rounded-md border border-border bg-elevated px-3 py-2 text-sm text-fg shadow-card"
            >
              <div className="font-medium">{label}</div>
              <p className="mt-1 text-muted">{meaning}</p>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
