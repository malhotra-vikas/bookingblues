'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { getSupabaseBrowserClient } from '../lib/supabase/browser';
import { publicEnv } from '../lib/env';
import { PLANS, depositLabel } from '../lib/brand';

interface Operator {
  id: string;
  business_name: string;
  category: string | null;
  timezone: string;
  personal_phone_e164: string | null;
  twilio_number_e164: string | null;
  google_calendar_id: string | null;
  booking_fee_enabled: boolean;
  booking_fee_cents: number | null;
  emergency_visit_fee_cents: number | null;
  allow_unpaid_emergency_booking: boolean;
  visit_duration_min: number;
  business_hours: Record<string, { start: string; end: string }[]> | null;
  service_zip_codes: string[] | null;
  service_radius_zones: Array<{ center_zip: string; radius_miles: number }> | null;
  subscription_status: string | null;
  plan: string | null;
  plan_cadence: string | null;
  trial_ends_at: string | null;
  stripe_connect_account_id: string | null;
  stripe_connect_charges_enabled: boolean;
  stripe_connect_payouts_enabled: boolean;
}

const DAYS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

interface DayHours {
  open: boolean;
  start: string;
  end: string;
}

/** Seed the per-day editor from the stored business_hours (first interval/day). */
function initDayHours(bh: Operator['business_hours']): Record<string, DayHours> {
  const out: Record<string, DayHours> = {};
  for (const { key } of DAYS) {
    const interval = bh?.[key]?.[0];
    out[key] = interval
      ? { open: true, start: interval.start, end: interval.end }
      : { open: false, start: '09:00', end: '17:00' };
  }
  return out;
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return fetch(`${publicEnv.NEXT_PUBLIC_API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

function formatE164(e164: string | null): string {
  if (!e164) return '—';
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

export function SettingsPanel({ operator }: { operator: Operator }): JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [businessName, setBusinessName] = useState(operator.business_name);
  const [timezone, setTimezone] = useState(operator.timezone);
  const [feeEnabled, setFeeEnabled] = useState(
    PLANS.find((p) => p.slug === operator.plan)?.depositMode === 'mandatory'
      ? true
      : operator.booking_fee_enabled,
  );
  const [feeDollars, setFeeDollars] = useState(
    operator.booking_fee_cents != null ? (operator.booking_fee_cents / 100).toFixed(2) : '',
  );
  const [emergencyFeeDollars, setEmergencyFeeDollars] = useState(
    operator.emergency_visit_fee_cents != null
      ? (operator.emergency_visit_fee_cents / 100).toFixed(2)
      : '',
  );
  const [allowUnpaidEmergency, setAllowUnpaidEmergency] = useState(
    operator.allow_unpaid_emergency_booking,
  );
  const [visitDuration, setVisitDuration] = useState(String(operator.visit_duration_min ?? 60));
  const [hours, setHours] = useState<Record<string, DayHours>>(() =>
    initDayHours(operator.business_hours),
  );

  // Service area (lifted from the onboarding wizard so coverage is editable later).
  const [zipsText, setZipsText] = useState((operator.service_zip_codes ?? []).join(', '));
  const [zones, setZones] = useState<Array<{ center_zip: string; radius_miles: number }>>(
    operator.service_radius_zones ?? [],
  );
  const [zoneCenter, setZoneCenter] = useState('');
  const [zoneRadius, setZoneRadius] = useState('30');
  const hoursInvalid = DAYS.some(({ key }) => {
    const d = hours[key];
    return d?.open && !(d.start < d.end);
  });

  // Per-plan take rate (Solo 10% / Crew 15% / Fleet 20%), charged ON TOP of the
  // deposit and paid by the customer. Mirrors computeBookingFeeCharge on the API.
  const currentPlan = PLANS.find((p) => p.slug === operator.plan);
  const platformFeePct = currentPlan?.platformFeePct ?? 10;
  const depositMandatory = currentPlan?.depositMode === 'mandatory';
  const takeBps = platformFeePct * 100;
  // Shared on-top math (mirrors computeBookingFeeCharge): caller pays base +
  // platform fee; operator keeps base less Stripe card processing.
  const charge = (baseCents: number) => {
    const platform = baseCents > 0 ? Math.max(Math.floor((baseCents * takeBps) / 10_000), 100) : 0;
    const customerPays = baseCents + platform;
    const stripe = customerPays > 0 ? Math.ceil(customerPays * 0.029) + 30 : 0;
    return { base: baseCents, platform, customerPays, stripe, youReceive: Math.max(0, customerPays - platform - stripe) };
  };
  const durationMin = Math.min(480, Math.max(15, Math.round(Number(visitDuration || '60') || 60)));
  const durationInvalid = !/^\d+$/.test(visitDuration.trim()) || durationMin !== Number(visitDuration);
  const feeCents = Math.max(0, Math.round(Number(feeDollars || '0') * 100));
  const emergencyCents = Math.max(0, Math.round(Number(emergencyFeeDollars || '0') * 100));
  const deposit = charge(feeCents);
  const emergency = charge(feeCents + emergencyCents); // deposit + emergency surcharge
  // Legacy aliases kept for the existing deposit breakdown rows below.
  const platformCents = deposit.platform;
  const customerPaysCents = deposit.customerPays;
  const stripeProcessingCents = deposit.stripe;
  const operatorTakeCents = deposit.youReceive;

  const connectStatus: ConnectStatus =
    !operator.stripe_connect_account_id
      ? 'not_started'
      : operator.stripe_connect_charges_enabled && operator.stripe_connect_payouts_enabled
        ? 'active'
        : 'pending';
  const feeChargeable =
    operator.booking_fee_enabled &&
    operator.booking_fee_cents != null &&
    (operator.subscription_status === 'trialing' || operator.subscription_status === 'active') &&
    operator.stripe_connect_charges_enabled &&
    operator.stripe_connect_payouts_enabled;

  async function run(label: string, fn: () => Promise<void>): Promise<void> {
    setBusy(label);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  async function saveProfile(): Promise<void> {
    await run('save', async () => {
      const cents = feeEnabled ? feeCents : null;
      const emergencyCents = feeEnabled
        ? Math.max(0, Math.round(Number(emergencyFeeDollars || '0') * 100))
        : null;
      const res = await authedFetch('/v1/operators/me', {
        method: 'PATCH',
        body: JSON.stringify({
          business_name: businessName,
          timezone,
          booking_fee_enabled: feeEnabled,
          ...(cents != null ? { booking_fee_cents: cents } : {}),
          emergency_visit_fee_cents: emergencyCents,
          allow_unpaid_emergency_booking: allowUnpaidEmergency,
          visit_duration_min: durationMin,
        }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail ?? `Save failed (${res.status})`);
      }
      setInfo('Saved.');
      router.refresh();
    });
  }

  async function saveServiceArea(): Promise<void> {
    await run('save-area', async () => {
      const zips = zipsText
        .split(/[\s,]+/)
        .map((z) => z.trim())
        .filter(Boolean);
      const invalid = zips.filter((z) => !/^\d{5}$/.test(z));
      if (invalid.length > 0) {
        throw new Error(
          `These don't look like 5-digit US ZIP codes: ${invalid.slice(0, 3).join(', ')}${
            invalid.length > 3 ? ` and ${invalid.length - 3} more` : ''
          }`,
        );
      }
      const res = await authedFetch('/v1/operators/me', {
        method: 'PATCH',
        body: JSON.stringify({ service_zip_codes: zips, service_radius_zones: zones }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail ?? `Save failed (${res.status})`);
      }
      setInfo('Service area saved.');
      router.refresh();
    });
  }

  function addZone(): void {
    setError(null);
    if (!/^\d{5}$/.test(zoneCenter.trim())) {
      setError('Zone center must be a 5-digit US ZIP code.');
      return;
    }
    const r = Number(zoneRadius);
    if (!Number.isFinite(r) || r < 1 || r > 500) {
      setError('Radius must be a whole number between 1 and 500 miles.');
      return;
    }
    setZones([...zones, { center_zip: zoneCenter.trim(), radius_miles: Math.floor(r) }]);
    setZoneCenter('');
    setZoneRadius('30');
  }

  function removeZone(idx: number): void {
    setZones(zones.filter((_, i) => i !== idx));
  }

  async function saveHours(): Promise<void> {
    await run('save-hours', async () => {
      // Build business_hours: each open day → one [{start,end}] interval; closed
      // days are omitted. Matches BusinessHoursSchema on the API.
      const business_hours: Record<string, { start: string; end: string }[]> = {};
      for (const { key } of DAYS) {
        const d = hours[key];
        if (d?.open) business_hours[key] = [{ start: d.start, end: d.end }];
      }
      const res = await authedFetch('/v1/operators/me', {
        method: 'PATCH',
        body: JSON.stringify({ business_hours }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail ?? `Save failed (${res.status})`);
      }
      setInfo('Business hours saved.');
      router.refresh();
    });
  }

  function setDay(key: string, patch: Partial<DayHours>): void {
    setHours((prev) => ({ ...prev, [key]: { ...prev[key]!, ...patch } }));
  }

  async function startStripeConnect(): Promise<void> {
    await run('connect', async () => {
      const res = await authedFetch('/v1/operators/me/connect/onboarding-link', { method: 'POST' });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail ?? `Could not start Stripe payout setup (${res.status})`);
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    });
  }

  async function disconnectGoogle(): Promise<void> {
    await run('disconnect-google', async () => {
      const res = await authedFetch('/v1/operators/me/google/disconnect', { method: 'POST' });
      if (!res.ok) throw new Error(`disconnect failed: ${res.status}`);
      setInfo("Calendar disconnected. Reconnect from Onboarding when you're ready.");
      router.refresh();
    });
  }

  async function openBillingPortal(): Promise<void> {
    await run('billing-portal', async () => {
      const res = await authedFetch('/v1/billing/portal-session');
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail ?? `portal failed: ${res.status}`);
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    });
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {error ? (
        <Banner tone="error">{error}</Banner>
      ) : null}
      {info ? <Banner tone="success">{info}</Banner> : null}

      {/* ── Business profile ──────────────────────────────────────────── */}
      <Card title="Business profile" description="Shown to callers and used to format messages.">
        <Field label="Business name">
          <input
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm w-full"
          />
        </Field>
        <Field label="Timezone" hint="IANA name — e.g. America/New_York, America/Los_Angeles">
          <input
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm w-full font-mono"
          />
        </Field>
        <Field label="Your mobile (read-only)" hint="Set at signup. Reach us to change.">
          <div className="text-sm font-mono text-muted dark:text-slate-300">{formatE164(operator.personal_phone_e164)}</div>
        </Field>
        <Field
          label="Visit length (minutes)"
          hint="How long each appointment runs. The AI proposes and books slots of exactly this length. 15–480."
        >
          <input
            type="number"
            min={15}
            max={480}
            step={15}
            value={visitDuration}
            onChange={(e) => setVisitDuration(e.target.value.replace(/\D/g, '').slice(0, 3))}
            className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm w-32"
          />
          {durationInvalid ? (
            <span className="ml-2 text-xs text-red-600">must be a whole number 15–480</span>
          ) : null}
        </Field>
        <SaveButton busy={busy === 'save'} onClick={saveProfile} disabled={durationInvalid} />
      </Card>

      {/* ── Business hours ───────────────────────────────────────────── */}
      <Card
        title="Business hours"
        description="When the AI may book appointments. Callers are only offered slots inside these hours (in your timezone)."
      >
        <div className="space-y-2">
          {DAYS.map(({ key, label }) => {
            const d = hours[key]!;
            const invalid = d.open && !(d.start < d.end);
            return (
              <div key={key} className="flex items-center gap-3 text-sm">
                <label className="flex items-center gap-2 w-32 shrink-0">
                  <input
                    type="checkbox"
                    checked={d.open}
                    onChange={(e) => setDay(key, { open: e.target.checked })}
                  />
                  <span className="text-ink dark:text-slate-100">{label}</span>
                </label>
                {d.open ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={d.start}
                      onChange={(e) => setDay(key, { start: e.target.value })}
                      className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 px-2 py-1 text-sm"
                    />
                    <span className="text-muted dark:text-slate-400">to</span>
                    <input
                      type="time"
                      value={d.end}
                      onChange={(e) => setDay(key, { end: e.target.value })}
                      className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 px-2 py-1 text-sm"
                    />
                    {invalid ? (
                      <span className="text-xs text-red-600">end must be after start</span>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-xs text-muted dark:text-slate-400">Closed</span>
                )}
              </div>
            );
          })}
        </div>
        <SaveButton busy={busy === 'save-hours'} onClick={saveHours} disabled={hoursInvalid} />
      </Card>

      {/* ── Service area ─────────────────────────────────────────────── */}
      <Card
        title="Service area"
        description="ZIP codes you cover. The AI books only jobs inside this area and sends out-of-area callers a polite handoff. Leave both blank to accept any address."
      >
        <div className="space-y-4">
          <Field
            label="ZIPs you cover explicitly"
            hint="Comma, space, or newline separated. Each must be a 5-digit US ZIP. We de-dupe + sort."
          >
            <textarea
              value={zipsText}
              onChange={(e) => setZipsText(e.target.value)}
              placeholder="e.g. 90210, 90211, 90212"
              rows={2}
              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm font-mono"
            />
          </Field>

          <div>
            <label className="block text-sm font-medium text-ink dark:text-slate-200 mb-1">
              Radius zones (everything within X miles of a center ZIP)
            </label>
            <div className="space-y-1">
              {zones.map((zone, idx) => (
                <div
                  key={`${zone.center_zip}-${idx}`}
                  className="flex items-center gap-3 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-sm"
                >
                  <span className="font-mono">{zone.radius_miles} mi</span>
                  <span className="text-muted dark:text-slate-400">around</span>
                  <span className="font-mono">{zone.center_zip}</span>
                  <button
                    type="button"
                    onClick={() => removeZone(idx)}
                    className="ml-auto text-xs text-red-700 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                placeholder="Center ZIP"
                value={zoneCenter}
                onChange={(e) => setZoneCenter(e.target.value.replace(/\D/g, '').slice(0, 5))}
                className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-1.5 text-sm font-mono w-32"
              />
              <input
                placeholder="30"
                value={zoneRadius}
                onChange={(e) => setZoneRadius(e.target.value.replace(/\D/g, '').slice(0, 3))}
                className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-1.5 text-sm w-20"
              />
              <span className="text-xs text-muted dark:text-slate-400">miles</span>
              <button
                type="button"
                onClick={addZone}
                className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                + Add zone
              </button>
            </div>
          </div>

          <SaveButton busy={busy === 'save-area'} onClick={saveServiceArea} />
        </div>
      </Card>

      {/* ── Booking fee + economics ──────────────────────────────────── */}
      <Card
        title="Booking fee"
        description="Charge a non-refundable deposit before confirming the slot. Cuts down on no-shows."
      >
        {currentPlan ? (
          <p className="text-xs text-muted dark:text-slate-400 mb-2">
            <span className="font-medium text-ink dark:text-slate-200">{currentPlan.name} plan:</span>{' '}
            {depositLabel(currentPlan.depositMode)}. Platform fee is{' '}
            <span className="font-medium text-ink dark:text-slate-200">{currentPlan.platformFeePct}% on top of your deposit</span>,
            charged to the customer.
          </p>
        ) : null}
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={feeEnabled}
            disabled={depositMandatory}
            onChange={(e) => setFeeEnabled(e.target.checked)}
          />
          Collect a booking fee{depositMandatory ? ' (required on Fleet)' : ''}
        </label>
        {feeEnabled && (
          <>
            <Field label="Deposit amount (USD)">
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={feeDollars}
                onChange={(e) => setFeeDollars(e.target.value)}
                className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm w-32"
              />
            </Field>
            <Field label="Emergency visit fee (USD, optional)">
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={emergencyFeeDollars}
                onChange={(e) => setEmergencyFeeDollars(e.target.value)}
                className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm w-32"
              />
              <p className="mt-1 text-xs text-muted dark:text-slate-400">
                Charged to the caller in addition to the deposit on emergency jobs (active
                flooding, gas, etc.). Same platform fee applies. Leave blank for none.
              </p>
            </Field>
            <Field label="Allow booking without payment in life-safety emergencies">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allowUnpaidEmergency}
                  onChange={(e) => setAllowUnpaidEmergency(e.target.checked)}
                />
                <span>Let the AI book immediate-danger jobs (gas, CO, sparks, active flooding) without taking payment first</span>
              </label>
              <p className="mt-1 text-xs text-muted dark:text-slate-400">
                When on, the AI books these jobs right away so your tech can respond fast, and
                flags them on the dashboard + calendar invite as <strong>collect on site</strong>.
                When off, the AI collects the deposit + emergency fee up front like any other booking.
              </p>
            </Field>
            {feeCents > 0 && (
              <div className="rounded-md bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-3 text-sm">
                <div className="text-xs text-muted dark:text-slate-400 uppercase tracking-wide mb-2">
                  For a ${(feeCents / 100).toFixed(2)} deposit
                </div>
                <EconomicsRow label="Your deposit" amount={feeCents} />
                <EconomicsRow label={`KeeprSteady fee (${platformFeePct}%, on top)`} amount={platformCents} />
                <div className="border-t border-slate-200 dark:border-slate-700 mt-2 pt-2">
                  <EconomicsRow label="Customer pays" amount={customerPaysCents} bold />
                </div>
                <EconomicsRow label="Card processing (2.9% + 30¢)" amount={-stripeProcessingCents} />
                <div className="border-t border-slate-200 dark:border-slate-700 mt-2 pt-2">
                  <EconomicsRow label="You receive" amount={operatorTakeCents} bold />
                </div>
              </div>
            )}
            {emergencyCents > 0 && (
              <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3 text-sm">
                <div className="text-xs text-amber-800 dark:text-amber-300 uppercase tracking-wide mb-2">
                  On an emergency job (${(feeCents / 100).toFixed(2)} deposit + $
                  {(emergencyCents / 100).toFixed(2)} emergency)
                </div>
                <EconomicsRow label="Deposit + emergency fee" amount={emergency.base} />
                <EconomicsRow label={`KeeprSteady fee (${platformFeePct}%, on top)`} amount={emergency.platform} />
                <div className="border-t border-amber-200 dark:border-amber-900 mt-2 pt-2">
                  <EconomicsRow label="Customer pays" amount={emergency.customerPays} bold />
                </div>
                <EconomicsRow label="Card processing (2.9% + 30¢)" amount={-emergency.stripe} />
                <div className="border-t border-amber-200 dark:border-amber-900 mt-2 pt-2">
                  <EconomicsRow label="You receive" amount={emergency.youReceive} bold />
                </div>
              </div>
            )}
            <ConnectStatusNotice status={connectStatus} chargeable={feeChargeable} />
          </>
        )}
        <SaveButton busy={busy === 'save'} onClick={saveProfile} />
      </Card>

      {/* ── Stripe Connect ───────────────────────────────────────────── */}
      <Card
        title="Payouts (Stripe Connect)"
        description="Where booking-fee money lands. KeeprSteady collects, takes our cut, deposits the rest to your bank."
      >
        <ConnectStatusBadge status={connectStatus} />
        <p className="text-sm text-muted">
          {connectStatus === 'active' ? (
            <>
              Your account is ready to accept fees. Manage details in the{' '}
              <a
                href={
                  operator.stripe_connect_account_id
                    ? `https://dashboard.stripe.com/${operator.stripe_connect_account_id}`
                    : '#'
                }
                target="_blank"
                rel="noreferrer"
                className="text-accent"
              >
                Stripe Express dashboard
              </a>
              .
            </>
          ) : connectStatus === 'pending' ? (
            <>Stripe is still verifying your account. Finish any remaining steps below.</>
          ) : (
            <>Connect a bank account so we can deposit booking fees directly. ~2 minutes.</>
          )}
        </p>
        {connectStatus !== 'active' && (
          <button
            type="button"
            onClick={startStripeConnect}
            disabled={busy === 'connect'}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === 'connect'
              ? 'Opening Stripe…'
              : connectStatus === 'pending'
                ? 'Continue Stripe setup'
                : 'Set up payouts with Stripe'}
          </button>
        )}
      </Card>

      {/* ── Integrations ─────────────────────────────────────────────── */}
      <Card title="Integrations">
        <IntegrationRow
          name="Google Calendar"
          state={operator.google_calendar_id ? 'connected' : 'disconnected'}
          detail={operator.google_calendar_id ?? 'Not connected'}
          action={
            operator.google_calendar_id ? (
              <button
                type="button"
                onClick={disconnectGoogle}
                disabled={busy === 'disconnect-google'}
                className="rounded-md border border-slate-300 dark:border-slate-700 dark:text-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                {busy === 'disconnect-google' ? 'Disconnecting…' : 'Disconnect'}
              </button>
            ) : null
          }
        />
        <IntegrationRow
          name="Twilio number"
          state={operator.twilio_number_e164 ? 'connected' : 'disconnected'}
          detail={
            operator.twilio_number_e164 ? formatE164(operator.twilio_number_e164) : 'Not provisioned'
          }
        />
      </Card>

      {/* ── Billing ──────────────────────────────────────────────────── */}
      <Card
        title="Subscription"
        description="Your KeeprSteady plan. Manage card, change plans, or cancel via the customer portal."
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm">
              Status:{' '}
              <span
                className={`font-medium ${
                  operator.subscription_status === 'active'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : operator.subscription_status === 'trialing'
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-red-700 dark:text-red-400'
                }`}
              >
                {operator.subscription_status ?? 'none'}
              </span>
              {operator.trial_ends_at && operator.subscription_status === 'trialing' && (
                <span className="ml-2 text-xs text-muted dark:text-slate-400">
                  ends {new Date(operator.trial_ends_at).toLocaleDateString()}
                </span>
              )}
            </div>
            <PlanLine plan={operator.plan} cadence={operator.plan_cadence} />
          </div>
          <button
            type="button"
            onClick={openBillingPortal}
            disabled={busy === 'billing-portal'}
            className="rounded-md border border-slate-300 dark:border-slate-700 dark:text-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            {busy === 'billing-portal' ? 'Opening…' : 'Open billing portal'}
          </button>
        </div>
      </Card>
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────

/** Shows the operator's current plan name, cadence, and included conversations
 *  inline, so they don't have to open the Stripe portal to see what they're on. */
function PlanLine({ plan, cadence }: { plan: string | null; cadence: string | null }): JSX.Element | null {
  const match = PLANS.find((p) => p.slug === plan);
  if (!match) return null;
  return (
    <div className="mt-1 text-xs text-muted dark:text-slate-400">
      {match.name} plan · {cadence === 'annual' ? 'billed annually' : 'billed monthly'} ·{' '}
      {match.conversationsPerMonth.toLocaleString()} conversations/mo included
    </div>
  );
}

type ConnectStatus = 'not_started' | 'pending' | 'active';

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur shadow-card p-6 space-y-4">
      <header>
        <h2 className="text-base font-semibold text-ink dark:text-slate-100">{title}</h2>
        {description ? <p className="text-xs text-muted dark:text-slate-400 mt-0.5">{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div>
      <label className="block text-xs font-medium text-muted dark:text-slate-400 mb-1">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{hint}</p> : null}
    </div>
  );
}

function SaveButton({
  busy,
  onClick,
  disabled,
}: {
  busy: boolean;
  onClick: () => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50 self-start"
    >
      {busy ? 'Saving…' : 'Save'}
    </button>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: 'error' | 'success';
  children: React.ReactNode;
}): JSX.Element {
  const cls =
    tone === 'error'
      ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300';
  return <div className={`rounded-md border p-3 text-sm ${cls}`}>{children}</div>;
}

function EconomicsRow({
  label,
  amount,
  bold,
}: {
  label: string;
  amount: number;
  bold?: boolean;
}): JSX.Element {
  const dollars = (amount / 100).toFixed(2);
  const positive = amount >= 0;
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold text-ink dark:text-slate-100' : 'text-muted dark:text-slate-400'}`}>
      <span>{label}</span>
      <span className={`font-mono ${!positive ? 'text-red-600 dark:text-red-400' : ''}`}>
        {positive ? '$' : '-$'}{Math.abs(Number(dollars)).toFixed(2)}
      </span>
    </div>
  );
}

function ConnectStatusBadge({ status }: { status: ConnectStatus }): JSX.Element {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-900 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        Active — charges + payouts enabled
      </span>
    );
  }
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-900 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        Pending verification
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
      Not connected
    </span>
  );
}

function ConnectStatusNotice({
  status,
  chargeable,
}: {
  status: ConnectStatus;
  chargeable: boolean;
}): JSX.Element | null {
  if (chargeable) return null;
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 p-3 text-xs text-amber-800 dark:text-amber-300">
      <strong className="font-medium">Heads up:</strong> we won&apos;t actually charge fees yet —{' '}
      {status === 'not_started'
        ? 'finish Stripe payout setup below.'
        : status === 'pending'
          ? 'Stripe is still verifying your payout account.'
          : 'check your subscription status.'}{' '}
      .
    </div>
  );
}

function IntegrationRow({
  name,
  state,
  detail,
  action,
}: {
  name: string;
  state: 'connected' | 'disconnected';
  detail: string;
  action?: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <div className="flex items-center gap-3">
        <span
          className={`w-2 h-2 rounded-full ${
            state === 'connected' ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
          }`}
        />
        <div>
          <div className="text-sm font-medium text-ink dark:text-slate-100">{name}</div>
          <div className="text-xs text-muted dark:text-slate-400 font-mono">{detail}</div>
        </div>
      </div>
      {action}
    </div>
  );
}
