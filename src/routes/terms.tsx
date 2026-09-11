import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/landing/legal";
import { APP_NAME } from "@/lib/brand";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
  head: () => ({
    meta: [
      { title: `Terms of Service — ${APP_NAME}` },
      { name: "description", content: `Terms for using ${APP_NAME}.` },
    ],
  }),
});

function TermsPage() {
  return (
    <LegalPage
      current="terms"
      title="Terms of Service"
      lead={`${APP_NAME} is provided as a multi-tenant operations platform. Using it means you accept these terms.`}
    >
      <section>
        <h2>The service</h2>
        <p>
          We provide software for ISP operators to manage customers, billing, payments, access, and related
          operations. Availability, modules, and limits follow the subscription plan assigned to the tenant.
        </p>
      </section>
      <section>
        <h2>Accounts</h2>
        <p>
          The person who signs up is the workspace owner. Additional staff logins are created by the ISP or a
          platform administrator. You are responsible for keeping credentials confidential and for activity under
          your account.
        </p>
      </section>
      <section>
        <h2>Plans and payment</h2>
        <p>
          Fees, trial days, and entitlements are those shown in the live catalog and on the tenant's
          subscription. Exceeding plan limits blocks new customers, routers, services, or staff until you upgrade.
          Existing data is not deleted solely because a limit is reached.
        </p>
      </section>
      <section>
        <h2>Acceptable use</h2>
        <p>
          You may not probe other tenants, abuse payment or messaging providers, or use the platform to send
          unlawful traffic. The Acceptable Use Policy applies.
        </p>
      </section>
      <section>
        <h2>Suspension</h2>
        <p>
          We may suspend a tenant for non-payment, abuse, or operational risk. Subscriber records remain in the
          tenant until the ISP or a lawful request requires otherwise.
        </p>
      </section>
    </LegalPage>
  );
}
