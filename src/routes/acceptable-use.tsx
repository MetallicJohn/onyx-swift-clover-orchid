import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/landing/legal";
import { APP_NAME } from "@/lib/brand";

export const Route = createFileRoute("/acceptable-use")({
  component: AcceptableUsePage,
  head: () => ({
    meta: [
      { title: `Acceptable Use Policy — ${APP_NAME}` },
      { name: "description", content: `Acceptable use of ${APP_NAME}.` },
    ],
  }),
});

function AcceptableUsePage() {
  return (
    <LegalPage
      current="aup"
      title="Acceptable Use Policy"
      lead="Use the platform as an ISP operations workspace. Do not use it to interfere with other tenants, payment networks, or end users."
    >
      <section>
        <h2>Allowed</h2>
        <p>
          Operating your own ISP: customers, billing, collections, access control, notifications, tickets, and
          related network operations inside your tenant.
        </p>
      </section>
      <section>
        <h2>Not allowed</h2>
        <p>
          Attempting to access another tenant's data; flooding payment, SMS, or WhatsApp providers; sending
          unsolicited bulk messages beyond what your configured providers and local law allow; using the software
          to attack networks; or bypassing plan quotas by technical means.
        </p>
      </section>
      <section>
        <h2>Messaging</h2>
        <p>
          You are the sender of SMS, WhatsApp, and email to your subscribers. Comply with Safaricom, Meta, and
          your SMS aggregator rules, including opt-out and lawful basis.
        </p>
      </section>
      <section>
        <h2>Enforcement</h2>
        <p>
          We may rate-limit, suspend, or close a tenant that violates this policy. Platform audit logs record
          administrator actions.
        </p>
      </section>
    </LegalPage>
  );
}
