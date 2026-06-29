import { redirect } from 'next/navigation';

// Legacy Stripe cancel_url target. Redirect older `/booking/cancelled` links to
// the canonical result page.
export default function BookingCancelledPage(): never {
  redirect('/booking/result?status=cancelled');
}
