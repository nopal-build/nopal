// The terms on a pay page (Austin, 2026-11-03): each section's title in
// bold, so the text reads as sections. Gates: every titled line in every
// category splits; a line with no title stays whole.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PaymentTerms, splitSection } from "../components/PaymentTerms";
import { PAYMENT_TERMS } from "robustness-core/data/billingTerms";

describe("the terms' section titles", () => {
  it("bold every section title in every category", () => {
    for (const terms of Object.values(PAYMENT_TERMS)) {
      const html = renderToStaticMarkup(<PaymentTerms terms={{ preamble: "Contract terms and conditions", title: terms.title, text: terms.text, draft: false }} />);
      for (const title of ["Termination", "Independent contractor and indemnification", "Liability and confidentiality", "Ownership and governing law"]) {
        expect(html, `${terms.title}: ${title}`).toContain(`<strong`);
        expect(html).toMatch(new RegExp(`>${title}: </strong>`));
      }
    }
  });
  it("leave a line with no title whole", () => {
    expect(splitSection("This is a one-time payment for the service described above.")).toEqual({ title: null, body: "This is a one-time payment for the service described above." });
    expect(splitSection("Payment: Payment is due within 30 days.").title).toBe("Payment");
  });
});
