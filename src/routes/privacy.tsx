import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/landing/legal";
import { APP_NAME } from "@/lib/brand";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
  head: () => ({
    meta: [
      { title: `Privacy Policy — ${APP_NAME}` },
      { name: "description", content: `How ${APP_NAME} handles operator and customer data.` },
    ],
  }),
});

function PrivacyPage() {
  return (
    <LegalPage
      current="privacy"
      title="Privacy Policy"
      lead="This describes how the platform treats data that ISPs and visitors submit. It is a product disclosure, not a substitute for your own subscriber privacy notice."
    >
      <section>
        <h2>Who is the controller</h2>
        <p>
          {APP_NAME} operates the multi-tenant software. Each ISP (tenant) is responsible for the personal data of
          its own subscribers. We process that data to provide the service the ISP has subscribed to.
        </p>
      </section>
      <section>
        <h2>What we collect</h2>
        <p>
          Operator accounts: name, email, password hash, and workspace membership. Tenant records: company name,
          branding, router inventory, billing configuration, and operational logs. Subscriber records are entered
          by the ISP. The public contact form stores name, company, email, phone, topic, and message.
        </p>
      </section>
      <section>
        <h2>Isolation</h2>
        <p>
          Customer, invoice, payment, and router rows are scoped to a tenant with row-level security. Platform
          administrators see tenant metadata and usage, not subscriber PII. The public homepage never loads a
          tenant theme or tenant customer list.
        </p>
      </section>
      <section>
        <h2>Payments and messaging</h2>
        <p>
          Payment provider credentials and SMS/WhatsApp keys are stored for the ISP that configured them and used
          only to process that ISP's traffic. We do not sell subscriber lists.
        </p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>
          Privacy questions can be sent through the public contact form. If a support or sales address is published
          on the homepage, you may use that as well.
        </p>
      </section>
    </LegalPage>
  );
}
