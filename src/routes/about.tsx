import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPage } from "@/components/landing/legal";
import { buttonVariants } from "@/components/ui/button";
import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/about")({
  component: AboutPage,
  head: () => ({
    meta: [
      { title: `About — ${APP_NAME}` },
      {
        name: "description",
        content: `${APP_NAME} is a multi-tenant platform for running an internet service provider.`,
      },
    ],
  }),
});

function AboutPage() {
  return (
    <LegalPage
      current="about"
      title="About"
      lead={`${APP_NAME} is software for internet service providers: one isolated workspace per ISP, covering customers, money, and the access network.`}
    >
      <section>
        <h2>What we build</h2>
        <p>
          A modular operations console — billing, M-Pesa, RADIUS, MikroTik, hotspot, CPE, messaging, tickets, and
          reports — rather than a consumer internet product. The public homepage is the platform catalog. Tenant
          branding never appears there.
        </p>
      </section>
      <section>
        <h2>Who it is for</h2>
        <p>
          Wireless, fibre, hotspot, and growing multi-POP operators, including teams that work with resellers. It
          is not a generic CRM with a network sticker on it.
        </p>
      </section>
      <section>
        <h2>How to start</h2>
        <p>
          Create an ISP account to begin a trial, or sign in if you already operate a workspace. Platform
          administrators use the same sign-in and continue to the SaaS console.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href="/login?mode=up" className={cn(buttonVariants({ size: "md" }))}>
            Start free trial
          </a>
          <Link to="/login" className={cn(buttonVariants({ variant: "secondary", size: "md" }))}>
            Tenant login
          </Link>
        </div>
      </section>
    </LegalPage>
  );
}
