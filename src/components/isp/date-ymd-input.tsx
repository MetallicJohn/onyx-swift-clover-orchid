import { CalendarDays } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  dateInputPlaceholder,
  formatYmdInput,
  getActiveDateFormat,
  tryParseYmdInput,
} from "@/lib/isp/display";
import { cn } from "@/lib/utils";

type DateYmdInputProps = {
  value: string;
  onChange: (ymd: string) => void;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  className?: string;
  "aria-label"?: string;
};

/**
 * Date entry for operators. Shows and accepts the active console format
 * (default dd/mm/yy). Emits YYYY-MM-DD. Native ISO pickers stay hidden.
 */
export function DateYmdInput({
  value,
  onChange,
  disabled,
  required,
  id,
  name,
  className,
  "aria-label": ariaLabel,
}: DateYmdInputProps) {
  const format = getActiveDateFormat();
  const placeholder = dateInputPlaceholder(format);
  const autoId = useId();
  const inputId = id || autoId;
  const textRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(() => formatYmdInput(value, format));
  const stored = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";

  useEffect(() => {
    if (focused) return;
    setText(formatYmdInput(value, format));
  }, [value, format, focused]);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const parsed = tryParseYmdInput(text);
    if (!text.trim()) el.setCustomValidity(required ? `Enter a date (${placeholder})` : "");
    else if (parsed === null) el.setCustomValidity(`Use ${placeholder}`);
    else el.setCustomValidity("");
  }, [text, required, placeholder]);

  function commitText(next: string) {
    setText(next);
    const parsed = tryParseYmdInput(next);
    if (parsed !== null) onChange(parsed);
  }

  function finishEdit() {
    setFocused(false);
    const parsed = tryParseYmdInput(text);
    if (parsed === null) {
      setText(formatYmdInput(value, format));
      return;
    }
    onChange(parsed);
    setText(formatYmdInput(parsed, format));
  }

  return (
    <div className={cn("relative", className)}>
      <Input
        ref={textRef}
        id={inputId}
        name={name}
        type="text"
        inputMode={format === "d MMM yyyy" ? "text" : "numeric"}
        autoComplete="off"
        spellCheck={false}
        lang="en-GB"
        placeholder={placeholder}
        value={text}
        required={required}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={Boolean(text.trim() && tryParseYmdInput(text) === null)}
        className="pr-11"
        onFocus={() => setFocused(true)}
        onChange={(e) => commitText(e.target.value)}
        onBlur={finishEdit}
      />
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        value={stored}
        className="pointer-events-none absolute h-0 w-0 opacity-0"
        onChange={(e) => {
          onChange(e.target.value);
          setText(formatYmdInput(e.target.value, format));
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label="Open calendar"
        className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:text-fg disabled:pointer-events-none disabled:opacity-50"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const el = pickerRef.current;
          if (!el || disabled) return;
          if (typeof el.showPicker === "function") el.showPicker();
          else el.click();
        }}
      >
        <CalendarDays className="size-4" aria-hidden />
      </button>
    </div>
  );
}
