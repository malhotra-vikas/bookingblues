// Read-only: retrieve a connected account and print capability/verification state.
// Usage: node apps/api/scripts/check-connect-account.mjs <acct_id>
import Stripe from 'stripe';

const acctId = process.argv[2];
if (!acctId) {
  console.error('Usage: node check-connect-account.mjs <acct_id>');
  process.exit(1);
}
const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('Missing STRIPE_SECRET_KEY');
  process.exit(1);
}

const stripe = new Stripe(key);
const a = await stripe.accounts.retrieve(acctId);
console.log(
  JSON.stringify(
    {
      id: a.id,
      charges_enabled: a.charges_enabled,
      payouts_enabled: a.payouts_enabled,
      details_submitted: a.details_submitted,
      requirements: {
        currently_due: a.requirements?.currently_due,
        past_due: a.requirements?.past_due,
        pending_verification: a.requirements?.pending_verification,
        disabled_reason: a.requirements?.disabled_reason,
      },
    },
    null,
    2,
  ),
);
