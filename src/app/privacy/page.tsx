import type { Metadata } from "next";

import { InfoPage } from "@/components/InfoPage";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How GatherBite handles group order details and delivery addresses.",
};

export default function PrivacyPage() {
  return (
    <InfoPage
      title="Privacy"
      intro="GatherBite is designed to collect only the details needed to evaluate a group food order."
    >
      <section>
        <h2>Information you provide</h2>
        <p>
          The organizer may enter a headcount, budget, fulfillment preference, delivery address,
          dietary needs, food preferences, and optional notes. GatherBite does not offer accounts
          and does not ask for payment card details.
        </p>
      </section>

      <section>
        <h2>How the information is used</h2>
        <p>
          Group requirements and notes are sent to the configured AI service to produce candidate
          orders. Delivery addresses are used server-side for restaurant serviceability checks and
          are not included in the AI planning prompt. Restaurant services may receive an address
          when GatherBite checks whether delivery is available.
        </p>
      </section>

      <section>
        <h2>Storage and sharing</h2>
        <p>
          GatherBite does not intentionally save form submissions to an application database or sell
          personal information. Requests are processed by the hosting provider, the configured AI
          provider, and relevant restaurant services. Those providers may retain technical records
          under their own terms and policies.
        </p>
      </section>

      <section>
        <h2>Safety and ordering</h2>
        <p>
          Dietary checks are decision support, not medical advice or a guarantee against cross-contact.
          The organizer must confirm ingredients with the restaurant, review the final order, and
          complete payment on the restaurant&apos;s own service.
        </p>
      </section>

      <section>
        <h2>Your choices</h2>
        <p>
          You can use the simulated demo without submitting personal details. Because GatherBite does
          not create user accounts or intentionally retain submissions, there is no in-app account data
          to download or delete. For a privacy question, use the support page.
        </p>
      </section>

      <p className="info-updated">Last updated October 12, 2026.</p>
    </InfoPage>
  );
}
