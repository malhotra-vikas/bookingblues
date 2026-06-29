import { redirect } from 'next/navigation';

// Legacy Stripe success_url target. Older Checkout Sessions were created with
// `/booking/paid` baked in; redirect them to the canonical result page.
export default function BookingPaidPage(): never {
  redirect('/booking/result?status=paid');
}
