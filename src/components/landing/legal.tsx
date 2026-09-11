import type { ReactNode } from "react";
import { APP_NAME } from "@/lib/brand";
import { PublicShell } from "./shell";

export function LegalPage({
  current,
  title,
  lead,
  children,
}: {
  current: "about" | "privacy" | "terms" | "aup";
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <PublicShell current={current}>
      <article className="mx-auto max-w-3xl px-4 py-16 md:py-20">
        <p className="text-xs font-medium tracking-[0.2em] text-accent uppercase">{APP_NAME}</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-4 text-base leading-relaxed text-muted">{lead}</p>
        <div className="mt-10 grid gap-8 text-sm leading-relaxed text-muted [&_h2]:text-lg [&_h2]:font-medium [&_h2]:text-fg [&_p]:mt-2">
          {children}
        </div>
      </article>
    </PublicShell>
  );
}
