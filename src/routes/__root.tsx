import { createServerFn } from "@tanstack/react-start";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { APP_NAME } from "@/lib/brand";
import appCss from "../styles.css?url";

const fetchSessionUser = createServerFn({ method: "GET" }).handler(async () => {
  const { getRequest } = await import("@tanstack/react-start/server");
  const { GATE_IDENTITY_HEADER } = await import("@/lib/auth/gate-identity.server");
  const request = getRequest();
  const headers = request?.headers;
  // Gate identity on a cookie-only request would replace an email/password
  // session. Let the client attach the operator bearer (or materialize the
  // Grok viewer) instead of resolving here.
  if (headers?.get(GATE_IDENTITY_HEADER) && !headers.get("authorization")) {
    return null;
  }
  const { getSessionUser } = await import("@/lib/auth/verify.server");
  const u = await getSessionUser();
  return u ? { id: u.id, email: u.email } : null;
});

export const Route = createRootRoute({
  beforeLoad: async () => ({ sessionUser: await fetchSessionUser() }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      { name: "theme-color", content: "#0a0e13" },
      {
        name: "description",
        content: "Multi-tenant ISP operations, billing, and network management.",
      },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Outfit:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(location.pathname.indexOf("/app")===0){var t=sessionStorage.getItem("isp-theme.v1");if(t){var p=JSON.parse(t);if(p&&p.vars){var r=document.documentElement;for(var k in p.vars)r.style.setProperty(k,p.vars[k]);r.dataset.appearance=p.appearance||"dark";r.style.colorScheme=p.appearance||"dark";}}}}catch(e){}`,
          }}
        />
      </head>
      <body>
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
