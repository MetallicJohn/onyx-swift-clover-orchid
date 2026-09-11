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
      { title: `${APP_NAME} — Run your ISP from one place` },
      {
        name: "description",
        content:
          "Keep customers, billing, payments and network operations connected. ISP software for M-Pesa, PPPoE, hotspot, MikroTik, RADIUS and reports.",
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
