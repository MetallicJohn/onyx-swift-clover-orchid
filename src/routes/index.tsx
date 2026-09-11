import { createFileRoute } from "@tanstack/react-router";
import { LandingContact } from "@/components/landing/contact";
import { LandingHero } from "@/components/landing/hero";
import {
  LandingArchitecture,
  LandingFaq,
  LandingFeatures,
  LandingHow,
  LandingMessaging,
  LandingPayments,
  LandingSolutions,
} from "@/components/landing/sections";
import { PublicShell } from "@/components/landing/shell";
import { PublicPricing } from "@/components/public-pricing";
import { APP_NAME } from "@/lib/brand";

export const Route = createFileRoute("/")({
  component: Home,
  head: () => ({
    meta: [
      { title: `${APP_NAME} — Customers, billing, and network operations` },
      {
        name: "description",
        content:
          "Operations software for ISPs: customers, invoices, M-Pesa, PPPoE, hotspot, MikroTik, RADIUS, and reports. Each ISP works in its own workspace.",
      },
    ],
  }),
});

function Home() {
  return (
    <PublicShell current="home">
      <LandingHero />
      <LandingFeatures />
      <LandingPayments />
      <LandingMessaging />
      <LandingSolutions />
      <LandingHow />
      <LandingArchitecture />
      <PublicPricing />
      <LandingFaq />
      <LandingContact />
    </PublicShell>
  );
}
