import { Link } from "@tanstack/react-router";
import { crumbsForPath } from "@/lib/isp/ui-shell";

export function Breadcrumbs({ pathname }: { pathname: string }) {
  const crumbs = crumbsForPath(pathname);
  if (!crumbs.length) return null;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 ? <span className="text-subtle">/</span> : null}
              {crumb.to && !last ? (
                <Link to={crumb.to as never} className="truncate text-muted hover:text-fg">
                  {crumb.label}
                </Link>
              ) : (
                <span className="truncate font-medium" aria-current={last ? "page" : undefined}>
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
