import { cn } from "@/lib/utils";

function initials(name: string) {
  const parts = name
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "ISP";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

export function BrandMark({
  name,
  logo,
  size = 32,
  className,
}: {
  name: string;
  logo?: string;
  size?: number;
  className?: string;
}) {
  if (logo) {
    return (
      <img
        src={logo}
        alt=""
        width={size}
        height={size}
        className={cn("shrink-0 rounded-md object-contain", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={cn("grid shrink-0 place-items-center rounded-md bg-accent font-semibold text-accent-fg", className)}
      style={{ width: size, height: size, fontSize: size > 28 ? 12 : 10 }}
      aria-hidden
    >
      {initials(name)}
      <span className="sr-only">{name}</span>
    </span>
  );
}
