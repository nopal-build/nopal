/**
 * The standard terms each payment carries (Austin, 2026-11-03: "each
 * payment should carry a standard terms and conditions that matches the
 * service"). Paying is accepting them: the pay button says "By paying
 * you agree to the contract terms and conditions below", the category's
 * text follows the Stripe form (Austin, 2026-11-03), the version rides on
 * the Stripe intent, and a successful payment writes
 * the version, who paid and when onto the row.
 *
 * Austin owns this text, built from his invoice terms (2026-11-03). Any edit to a text bumps its version, so a row
 * always names the words that person agreed to (git keeps every version).
 * A version starting with `draft-` has not been approved: Stripe in live
 * mode refuses to raise a payment under it (`assertTermsUsable`).
 */
import { cardFeeRate, stripeKeyMode, type PaymentCategory } from "./billingRules";

export type PaymentTerms = { version: string; title: string; text: string[] };

export const TERMS_PREAMBLE = "Contract terms and conditions";

/** Austin's invoice terms (2026-11-03), sections 4 to 6 as he wrote them:
 * on every payment. Sections 1 to 3 (payment, expenses, termination) are
 * per category below, worded to what the app does. */
const GENERAL_TERMS = [
  "Independent contractor and indemnification: Guide is an advisory independent contractor only — not a developer, contractor, or construction manager. Client indemnifies Guide against any claims arising from Client's projects. Guide will not accept undisclosed compensation from referred vendors.",
  "Liability and confidentiality: Total liability is capped at fees paid under this engagement. Neither party is liable for indirect or consequential damages. Each party will keep the other's non-public information confidential; breach liability is capped at $10,000.",
  "Ownership and governing law: Client owns all deliverables upon full payment. Governed by Arizona law. Disputes resolved by AAA arbitration in Phoenix, AZ. Prevailing party may recover attorneys' fees up to $10,000.",
];

/** Paying is accepting (Austin, 2026-11-17: "Payment is acceptance of
 * the terms, yes"). For a plan the acceptance is linking what it's paid
 * from, since that is the one thing the Client does. */
const ACCEPTANCE = "Acceptance: Paying, or linking an account or card for a plan, is acceptance of these terms.";

/** Work billed beside a plan or a service (Austin, 2026-11-17). The rates
 * are on the expenses bill itself (`reimbursement` below). */
const TRAVEL_AND_EXPENSES = "Travel and expenses: Travel time and expenses for your project may be charged in addition, as their own bills.";

/** Sections 1 and 3 for a one-time bill. */
const BILL_TERMS = [
  "Payment: Payment is due within 30 days of this bill. Guide may suspend services on accounts over 10 days past due.",
  "Termination: Either party may terminate with 30 days' written notice. Client owes Guide for all services performed and approved expenses through the termination date, payable within 30 days.",
];

/** Approved by Austin 2026-11-17 (no `draft-`): live payments may be
 * raised under it. Any edit to a text below needs his read and a new
 * version. */
const VERSION = "2026-11-17";

export const PAYMENT_TERMS: Record<PaymentCategory, PaymentTerms> = {
  subscription: {
    version: VERSION,
    title: "Guide plan",
    text: [
      `Payment: Your plan is billed monthly, from the account or card you link, on your monthly renewal date, until you or your guide ends it. Each payment covers the next month of service. A plan paid by credit card adds a card fee of ${cardFeeRate()} to each payment, shown before you link the card and as its own line on each receipt. Bank transfers and debit cards pay no fee.`,
      "Changes and pauses: You can pause the plan from your profile, and ask there for a different plan; your guide confirms a change with you. Your guide can also change or pause the plan. A pause starts at your next renewal date. A change starts at the next renewal date after your guide confirms it, or the one after if that date is less than 7 days away. A paused month isn't billed. Nothing is refunded or prorated for a month that has started. To come back, ask to resume from your profile; your guide confirms, and billing restarts that day on a new monthly date.",
      "Late payment: Guide may suspend services when a payment is over 10 days past due, including when no bank account or card is linked by the plan's start. An account or card linked late is billed for every month since the plan started.",
      "Termination: Either party may terminate with 30 days' written notice; cancelling from your profile is written notice. The plan ends on the first renewal date at least 30 days after notice, so one more month may be billed. A paused plan ends right away.",
      TRAVEL_AND_EXPENSES,
      ACCEPTANCE,
      ...GENERAL_TERMS,
    ],
  },
  service: {
    version: VERSION,
    title: "One-off service",
    text: ["This is a one-time payment for the service described above.", ...BILL_TERMS, TRAVEL_AND_EXPENSES, ACCEPTANCE, ...GENERAL_TERMS],
  },
  reimbursement: {
    version: VERSION,
    title: "Reimbursed expenses",
    text: [
      "Expenses: These are expenses for your project. Expenses over $500 require prior written approval. Unapproved expenses over $1,500 are non-reimbursable. Mileage: $0.57/mile; travel time: $90/hr; printing: cost +10%.",
      ...BILL_TERMS,
      ACCEPTANCE,
      ...GENERAL_TERMS,
    ],
  },
};

export function termsFor(category: PaymentCategory): PaymentTerms {
  return PAYMENT_TERMS[category];
}

export function termsAreDraft(category: PaymentCategory): boolean {
  return PAYMENT_TERMS[category].version.startsWith("draft-");
}

/** Throws when a payment would be raised in Stripe live mode under terms
 * nobody has approved. Only a key that says it is a test key is test
 * mode: a live secret key, a live restricted key, or a key this can't
 * read all count as live. No key at all raises nothing anyway. */
export function assertTermsUsable(category: PaymentCategory, secretKey = process.env.STRIPE_SECRET_KEY ?? ""): void {
  if (secretKey && stripeKeyMode(secretKey) !== "test" && termsAreDraft(category)) {
    throw new Error(`The ${PAYMENT_TERMS[category].title} terms are still a draft; approve them before taking live payments`);
  }
}
