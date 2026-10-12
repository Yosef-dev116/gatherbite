import type { Metadata } from "next";

import { InfoPage } from "@/components/InfoPage";

export const metadata: Metadata = {
  title: "Support",
  description: "Get help with GatherBite or report a problem.",
};

export default function SupportPage() {
  return (
    <InfoPage
      title="Support"
      intro="GatherBite fails closed when live evidence is missing, so an unavailable option can be the safe and expected result."
    >
      <section>
        <h2>Before you retry</h2>
        <ul>
          <li>Check that the address is complete and located in Prince Edward Island.</li>
          <li>Try carryout if restaurant delivery service cannot be verified.</li>
          <li>Adjust the budget or preferences, but never remove a real dietary need.</li>
          <li>Use the simulated demo to explore the full decision flow without a live request.</li>
        </ul>
      </section>

      <section>
        <h2>Report a problem</h2>
        <p>
          Open a GitHub issue with the steps you took, what you expected, and what appeared on screen.
          Never include an API key, payment information, or a full delivery address.
        </p>
        <a
          className="secondary-action inline-flex self-start"
          href="https://github.com/Yosef-dev116/gatherbite/issues/new"
          target="_blank"
          rel="noreferrer"
        >
          Open a support issue
        </a>
      </section>

      <section>
        <h2>Ordering help</h2>
        <p>
          GatherBite cannot modify, cancel, refund, or track a restaurant order. Contact the restaurant
          directly for help after you place an order on its service.
        </p>
      </section>
    </InfoPage>
  );
}
