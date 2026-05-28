'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ConfirmModal } from '../ConfirmModal';
import { getSupabaseBrowserClient } from '../../lib/supabase/browser';
import { PLANS, type PlanSlug } from '../../lib/brand';
import { publicEnv } from '../../lib/env';
import { CarrierForwarding } from './CarrierForwarding';
import { StepCard } from './StepCard';

type Cadence = 'monthly' | 'annual';

interface Operator {
  id: string;
  business_name: string;
  category: string | null;
  twilio_number_e164: string | null;
  google_calendar_id: string | null;
  stripe_connect_account_id: string | null;
  stripe_connect_charges_enabled: boolean;
  stripe_connect_payouts_enabled: boolean;
  booking_fee_enabled: boolean;
  booking_fee_cents: number | null;
  service_zip_codes: string[];
  service_radius_zones: Array<{ center_zip: string; radius_miles: number }>;
  subscription_status: string | null;
  onboarding_completed_at: string | null;
}

type Category = { slug: string; display_name: string };

interface TwilioCandidate {
  phone_number_e164: string;
  friendly_name: string;
  vanity_match: string | null;
  locality: string | null;
  region: string | null;
}

const ALL_CATEGORIES: Category[] = [
  { slug: 'plumbing', display_name: 'Plumbing' },
  { slug: 'hvac', display_name: 'HVAC' },
  { slug: 'electrical', display_name: 'Electrical' },
  { slug: 'roofing', display_name: 'Roofing' },
  { slug: 'garage_door', display_name: 'Garage Door' },
];

// Category filtering moved to props from the Server Component parent
// (apps/web/app/(dashboard)/onboarding/page.tsx). The page reads
// NEXT_PUBLIC_ENABLED_CATEGORIES on the server and passes the slug list as
// a prop. This bypasses Turbopack 16.x's NEXT_PUBLIC_* inlining bug for
// custom vars — confirmed via browser-console debug 2026-05-15: all four
// process.env / publicEnv reads returned undefined client-side despite
// being correctly set in the build environment.
//
// Also fixes a hydration mismatch (React error #418) that the server-vs-
// client divergence caused: server had `plumbing` from real env, client
// had `undefined` from a missing bundle replacement → trees differed →
// React discarded the SSR tree and re-rendered with the fallback (all 5).

/** US E.164 → `(415) 555-1234` for display. Non-US falls through unchanged. */
function formatE164(e164: string): string {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
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

export function Wizard({
  initial,
  enabledCategorySlugs,
  setupCallUrl,
}: {
  initial: Operator | null;
  enabledCategorySlugs: ReadonlyArray<string>;
  setupCallUrl: string;
}): JSX.Element {
  const router = useRouter();
  const op = initial;
  const [error, setError] = useState<string | null>(null);

  // Derived from server-prop. Same object identity across SSR and hydration
  // because the prop is serialized into the rendered HTML — no env reads
  // happen on the client, no mismatch possible.
  const CATEGORIES: Category[] = ALL_CATEGORIES.filter((c) =>
    enabledCategorySlugs.includes(c.slug),
  );

  const [pendingCategory, setPendingCategory] = useState(op?.category ?? '');
  const [pendingAreaCode, setPendingAreaCode] = useState('');
  const [candidates, setCandidates] = useState<TwilioCandidate[] | null>(null);
  const [pendingFeeEnabled, setPendingFeeEnabled] = useState(op?.booking_fee_enabled ?? false);
  const [pendingFeeDollars, setPendingFeeDollars] = useState(
    op?.booking_fee_cents != null
      ? (op.booking_fee_cents / 100).toFixed(2)
      : (publicEnv.NEXT_PUBLIC_DEFAULT_BOOKING_FEE_CENTS / 100).toFixed(2),
  );
  const [pendingZipsText, setPendingZipsText] = useState(
    (op?.service_zip_codes ?? []).join(', '),
  );
  const [pendingZones, setPendingZones] = useState<
    Array<{ center_zip: string; radius_miles: number }>
  >(op?.service_radius_zones ?? []);
  const [zoneCenter, setZoneCenter] = useState('');
  const [zoneRadius, setZoneRadius] = useState('30');

  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [disconnectGoogleOpen, setDisconnectGoogleOpen] = useState(false);
  const [pendingCadence, setPendingCadence] = useState<Cadence>('monthly');

  // Per-action busy tracker. Keeps individual buttons disabled while their
  // request is in flight, so a fast double-click can't fire two checkouts /
  // two number provisions / two PATCHes (the bug that produced an orphan
  // Twilio number earlier in QA).
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set());
  const isBusy = (key: string): boolean => busyKeys.has(key);

  async function handle<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    if (busyKeys.has(key)) return null;
    setError(null);
    setBusyKeys((s) => {
      const next = new Set(s);
      next.add(key);
      return next;
    });
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      return null;
    } finally {
      setBusyKeys((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
    }
  }

  async function saveCategory(): Promise<void> {
    await handle('saveCategory', async () => {
      const res = await authedFetch('/v1/operators/me', {
        method: 'PATCH',
        body: JSON.stringify({ category: pendingCategory }),
      });
      if (!res.ok) throw new Error(`Could not save category (${res.status})`);
      router.refresh();
    });
  }

  async function fetchCandidates(): Promise<void> {
    await handle('fetchCandidates', async () => {
      const qs = new URLSearchParams();
      if (pendingAreaCode) qs.set('area_code', pendingAreaCode);
      qs.set('limit', '4');
      const res = await authedFetch(`/v1/operators/me/twilio-number/candidates?${qs.toString()}`);
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail ?? `Could not load options (${res.status})`);
      }
      const data = (await res.json()) as { candidates: TwilioCandidate[] };
      setCandidates(data.candidates);
    });
  }

  /** Buy a specific candidate the operator picked. */
  async function provisionTwilio(phoneNumberE164?: string): Promise<void> {
    await handle(phoneNumberE164 ?? 'provisionTwilio', async () => {
      const body: Record<string, string> = {};
      if (pendingAreaCode) body.area_code = pendingAreaCode;
      if (phoneNumberE164) body.phone_number_e164 = phoneNumberE164;
      const res = await authedFetch('/v1/operators/me/twilio-number', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail ?? `Could not get a number (${res.status})`);
      }
      setCandidates(null);
      router.refresh();
    });
  }

  async function releaseTwilioConfirmed(): Promise<void> {
    const res = await authedFetch('/v1/operators/me/twilio-number', { method: 'DELETE' });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.detail ?? `Could not release the number (${res.status})`);
    }
    setReleaseModalOpen(false);
    router.refresh();
  }

  async function disconnectGoogleConfirmed(): Promise<void> {
    const res = await authedFetch('/v1/operators/me/google/disconnect', { method: 'POST' });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.detail ?? `Could not disconnect Google (${res.status})`);
    }
    setDisconnectGoogleOpen(false);
    router.refresh();
  }

  async function startGoogleConnect(): Promise<void> {
    await handle('startGoogleConnect', async () => {
      const res = await authedFetch('/v1/operators/me/google/connect', { method: 'POST' });
      if (!res.ok) throw new Error('Could not start Google sign-in');
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    });
  }

  async function startStripeConnect(): Promise<void> {
    await handle('startStripeConnect', async () => {
      const res = await authedFetch('/v1/operators/me/connect/onboarding-link', { method: 'POST' });
      if (!res.ok) {
        // Surface the underlying problem-details so the operator can act on it
        // (e.g. "your Stripe platform doesn't have Connect enabled in test mode").
        const detail = await res.json().catch(() => ({}));
        throw new Error(
          detail.detail ?? detail.message ?? `Could not start Stripe payout setup (${res.status})`,
        );
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    });
  }

  async function startBilling(plan: PlanSlug, cadence: Cadence): Promise<void> {
    await handle(`startBilling:${plan}:${cadence}`, async () => {
      const res = await authedFetch('/v1/billing/checkout-session', {
        method: 'POST',
        body: JSON.stringify({ plan, cadence }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail ?? `Could not start checkout (${res.status})`);
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    });
  }
  // While ANY plan is checking out, every plan button should disable —
  // double-tapping different tiers would otherwise race two Stripe sessions.
  const anyBillingBusy = (): boolean =>
    PLANS.some((p) =>
      isBusy(`startBilling:${p.slug}:monthly`) || isBusy(`startBilling:${p.slug}:annual`),
    );

  async function saveServiceArea(): Promise<void> {
    await handle('saveServiceArea', async () => {
      const zips = pendingZipsText
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
        body: JSON.stringify({
          service_zip_codes: zips,
          service_radius_zones: pendingZones,
        }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail ?? 'Could not save service area');
      }
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
    setPendingZones([
      ...pendingZones,
      { center_zip: zoneCenter.trim(), radius_miles: Math.floor(r) },
    ]);
    setZoneCenter('');
    setZoneRadius('30');
  }

  function removeZone(idx: number): void {
    setPendingZones(pendingZones.filter((_, i) => i !== idx));
  }

  async function saveFee(): Promise<void> {
    await handle('saveFee', async () => {
      const cents = pendingFeeEnabled
        ? Math.max(0, Math.round(Number(pendingFeeDollars) * 100))
        : null;
      const res = await authedFetch('/v1/operators/me', {
        method: 'PATCH',
        body: JSON.stringify({
          booking_fee_enabled: pendingFeeEnabled,
          ...(cents != null ? { booking_fee_cents: cents } : {}),
        }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail ?? 'Could not save the booking fee');
      }
      router.refresh();
    });
  }

  const subscribed = op?.subscription_status === 'trialing' || op?.subscription_status === 'active';
  const categoryDone = !!op?.category;
  const twilioDone = !!op?.twilio_number_e164;
  const googleDone = !!op?.google_calendar_id;
  const stripeConnectDone =
    !!op?.stripe_connect_account_id &&
    op.stripe_connect_charges_enabled &&
    op.stripe_connect_payouts_enabled;
  const feeDecided = op != null && (!op.booking_fee_enabled || op.booking_fee_cents != null);
  const serviceAreaSet = (op?.service_zip_codes?.length ?? 0) > 0;

  // Stripe redirects back here after Connect onboarding with ?connect=return
  // or ?connect=refresh. Surface a banner so the operator sees acknowledgement
  // (the actual charges_enabled/payouts_enabled flips arrive via webhook —
  // can be a beat or two later — so we keep it informational rather than
  // claiming completion).
  const searchParams = useSearchParams();
  const connectStatus = searchParams.get('connect');
  const [connectBanner, setConnectBanner] = useState<string | null>(
    connectStatus === 'return'
      ? "Thanks — we're syncing your Stripe payout details. Status updates in a moment."
      : connectStatus === 'refresh'
        ? "Stripe needs a bit more from you. Continue setup below."
        : null,
  );
  useEffect(() => {
    if (!connectBanner) return;
    // Strip the query param after a few seconds so refreshing doesn't re-show.
    const t = setTimeout(() => {
      setConnectBanner(null);
      router.replace('/onboarding');
      router.refresh();
    }, 5000);
    return () => clearTimeout(t);
  }, [connectBanner, router]);

  // setupCallUrl is now passed in as a prop from the server-rendered page.
  // See note at top of file re: Turbopack inlining + hydration mismatch.

  return (
    <div className="space-y-4">
      {setupCallUrl ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 p-3 flex items-center justify-between gap-3">
          <div className="text-sm text-emerald-900 dark:text-emerald-200">
            <p className="font-medium">Stuck on any step? We&apos;ll set this up with you live.</p>
            <p className="text-xs mt-0.5 opacity-90">
              10 minutes on Zoom and you&apos;re booking jobs by tonight.
            </p>
          </div>
          <a
            href={setupCallUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white no-underline hover:bg-emerald-700"
          >
            Schedule a setup call
          </a>
        </div>
      ) : null}
      {connectBanner ? (
        <div className="rounded-md border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40 p-3 text-sm text-blue-800 dark:text-blue-300">
          {connectBanner}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <StepCard
        number={1}
        title="Subscribe"
        description="7-day free trial. We need a card up front, but you won't be charged until day 8."
        done={!!subscribed}
      >
        {!subscribed ? (
          <div className="space-y-4">
            {/* Monthly / Annual cadence toggle — matches the public /pricing page */}
            <div className="inline-flex rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1 text-xs">
              {(['monthly', 'annual'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setPendingCadence(c)}
                  className={`rounded-full px-3 py-1 transition-colors ${
                    pendingCadence === c
                      ? 'bg-accent text-white'
                      : 'text-muted hover:text-ink dark:hover:text-slate-100'
                  }`}
                >
                  {c === 'monthly' ? 'Monthly' : 'Annual (save 2 months)'}
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {PLANS.map((plan) => {
                const busyHere = isBusy(`startBilling:${plan.slug}:${pendingCadence}`);
                const monthlyEquivalent =
                  pendingCadence === 'annual'
                    ? Math.round((plan.annualPriceUsd / 12) * 100) / 100
                    : plan.monthlyPriceUsd;
                return (
                  <div
                    key={plan.slug}
                    className={`relative rounded-lg border p-4 ${
                      plan.recommended
                        ? 'border-accent ring-1 ring-accent/30 bg-white dark:bg-slate-900'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                    }`}
                  >
                    {plan.recommended ? (
                      <span className="absolute -top-2 left-3 inline-block rounded-full bg-accent text-white text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5">
                        Most popular
                      </span>
                    ) : null}
                    <p className="text-xs uppercase tracking-wide text-muted">{plan.name}</p>
                    <p className="mt-1 text-2xl font-semibold text-ink dark:text-slate-100">
                      ${monthlyEquivalent.toLocaleString()}
                      <span className="text-sm text-muted font-normal">/mo</span>
                    </p>
                    <p className="text-[11px] text-muted">
                      {pendingCadence === 'annual'
                        ? `$${plan.annualPriceUsd.toLocaleString()}/yr billed`
                        : 'Billed monthly'}
                    </p>
                    <p className="mt-3 text-xs text-ink dark:text-slate-200">
                      {plan.conversationsPerMonth.toLocaleString()} convos/mo · +{plan.platformFeePct}% deposit fee
                    </p>
                    <button
                      type="button"
                      onClick={() => startBilling(plan.slug, pendingCadence)}
                      disabled={anyBillingBusy()}
                      className={`mt-4 w-full rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50 ${
                        plan.recommended
                          ? 'bg-accent text-white hover:bg-blue-700'
                          : 'border border-slate-300 dark:border-slate-700 dark:text-slate-200'
                      }`}
                    >
                      {busyHere
                        ? 'Opening checkout…'
                        : `Start trial — ${plan.name}`}
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-muted">
              Cancel in 2 clicks from Settings · No long-term contract · {' '}
              See the{' '}
              <a href="/pricing" className="underline">
                full pricing page
              </a>{' '}
              for deposit and overage details.
            </p>
          </div>
        ) : null}
      </StepCard>

      <StepCard
        number={2}
        title="Pick your trade"
        description="The AI only handles calls about this trade. Calls outside it get a polite handoff."
        done={categoryDone}
      >
        <div className="flex gap-2">
          <select
            value={pendingCategory}
            onChange={(e) => setPendingCategory(e.target.value)}
            className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm"
          >
            <option value="">— Select —</option>
            {CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.display_name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!pendingCategory || isBusy('saveCategory')}
            onClick={saveCategory}
            className="rounded-md bg-accent px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {isBusy('saveCategory') ? 'Saving…' : 'Save'}
          </button>
        </div>
      </StepCard>

      <StepCard
        number={8}
        title="Service area"
        description="The ZIP codes you cover. The AI books only jobs inside this area and sends out-of-area callers a polite handoff. Leave blank to accept any address."
        done={serviceAreaSet || pendingZones.length > 0}
      >
        <div className="space-y-4">
          {/* Explicit ZIP list */}
          <div>
            <label className="block text-xs font-medium mb-1">ZIPs you cover explicitly</label>
            <textarea
              value={pendingZipsText}
              onChange={(e) => setPendingZipsText(e.target.value)}
              placeholder="e.g. 90210, 90211, 90212"
              rows={2}
              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm font-mono"
            />
            <p className="mt-1 text-xs text-muted dark:text-slate-400">
              Comma, space, or newline separated. Each must be a 5-digit US ZIP. We de-dupe + sort.
            </p>
          </div>

          {/* Radius zones */}
          <div>
            <label className="block text-xs font-medium mb-1">
              Radius zones (everything within X miles of a center ZIP)
            </label>
            <div className="space-y-1">
              {pendingZones.map((zone, idx) => (
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
            <p className="mt-1 text-xs text-muted dark:text-slate-400">
              Cities and towns by name will be supported once Google Maps geocoding is wired up
              (waiting on billing approval).
            </p>
          </div>

          {/* Save row */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={saveServiceArea}
              disabled={isBusy('saveServiceArea')}
              className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {isBusy('saveServiceArea') ? 'Saving…' : 'Save service area'}
            </button>
            <span className="text-xs text-muted dark:text-slate-400">
              {(op?.service_zip_codes?.length ?? 0) + (op?.service_radius_zones?.length ?? 0) === 0
                ? 'Currently accepting any address.'
                : `Saved: ${op!.service_zip_codes.length} explicit ZIP${
                    op!.service_zip_codes.length === 1 ? '' : 's'
                  } + ${op!.service_radius_zones.length} radius zone${
                    op!.service_radius_zones.length === 1 ? '' : 's'
                  }.`}
            </span>
          </div>
        </div>
      </StepCard>

      <StepCard
        number={3}
        title="Get your KeeprSteady phone number"
        description="A new local US number we'll use to text customers when you miss their call. You'll forward your real business line to it in step 7."
        done={twilioDone}
      >
        {!twilioDone ? (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2 items-center">
              <input
                placeholder="Area code (optional, e.g. 415)"
                value={pendingAreaCode}
                onChange={(e) =>
                  setPendingAreaCode(e.target.value.replace(/\D/g, '').slice(0, 3))
                }
                className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm w-48"
              />
              <button
                type="button"
                onClick={fetchCandidates}
                disabled={isBusy('fetchCandidates')}
                className="rounded-md bg-accent px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {isBusy('fetchCandidates') ? 'Finding…' : 'Show me options'}
              </button>
              <button
                type="button"
                onClick={() => provisionTwilio()}
                disabled={isBusy('provisionTwilio')}
                className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                title="Skip the picker and grab the first vanity match we can find"
              >
                {isBusy('provisionTwilio') ? 'Getting…' : 'Just pick one for me'}
              </button>
            </div>

            {candidates && candidates.length > 0 && (
              <ul className="flex flex-col gap-2">
                {candidates.map((c) => (
                  <li key={c.phone_number_e164}>
                    <button
                      type="button"
                      onClick={() => provisionTwilio(c.phone_number_e164)}
                      disabled={isBusy(c.phone_number_e164)}
                      className="w-full text-left rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50 flex items-center justify-between"
                    >
                      <span className="font-mono">{formatE164(c.phone_number_e164)}</span>
                      <span className="text-xs text-slate-500 flex items-center gap-2">
                        {c.vanity_match && (
                          <span className="rounded bg-emerald-50 text-emerald-700 px-1.5 py-0.5 font-medium">
                            Contains {c.vanity_match}
                          </span>
                        )}
                        {c.locality && c.region && (
                          <span>
                            {c.locality}, {c.region}
                          </span>
                        )}
                        {isBusy(c.phone_number_e164) ? 'Buying…' : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {candidates && candidates.length === 0 && (
              <p className="text-sm text-slate-500">
                No options found{pendingAreaCode ? ` in ${pendingAreaCode}` : ''}. Try a
                different area code or use &quot;Just pick one for me.&quot;
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <p className="text-sm font-mono">{op?.twilio_number_e164}</p>
            <button
              type="button"
              onClick={() => setReleaseModalOpen(true)}
              className="text-xs text-red-700 hover:underline"
              title="Permanently release the number"
            >
              Release this number
            </button>
          </div>
        )}
      </StepCard>

      <StepCard
        number={4}
        title="Connect your Google Calendar"
        description="So the AI knows when you're free and can put new appointments on your calendar automatically."
        done={googleDone}
      >
        {!googleDone ? (
          <button
            type="button"
            onClick={startGoogleConnect}
            disabled={isBusy('startGoogleConnect')}
            className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {isBusy('startGoogleConnect') ? 'Opening Google…' : 'Connect Google'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setDisconnectGoogleOpen(true)}
            className="text-xs text-red-700 hover:underline"
          >
            Disconnect
          </button>
        )}
      </StepCard>

      <StepCard
        number={5}
        title="Set up payouts (only if you charge a booking fee)"
        description="Lets us send the booking-fee money straight to your bank. Skip this step if you don't take deposits."
        done={stripeConnectDone}
      >
        {stripeConnectDone ? (
          <p className="text-sm text-emerald-700">
            ✓ Payouts ready — money goes straight to your bank.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <ConnectStatusInline
              hasAccount={Boolean(op?.stripe_connect_account_id)}
              charges={Boolean(op?.stripe_connect_charges_enabled)}
              payouts={Boolean(op?.stripe_connect_payouts_enabled)}
            />
            <div>
              <button
                type="button"
                onClick={startStripeConnect}
                disabled={isBusy('startStripeConnect')}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {isBusy('startStripeConnect')
                  ? 'Opening Stripe…'
                  : op?.stripe_connect_account_id
                    ? 'Continue Stripe setup'
                    : 'Set up payouts with Stripe'}
              </button>
            </div>
          </div>
        )}
      </StepCard>

      <StepCard
        number={6}
        title="Booking fee"
        description="Charge a non-refundable deposit before confirming the slot. Cuts down on no-shows."
        done={feeDecided}
      >
        <div className="space-y-3">
          <div className="flex items-end gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pendingFeeEnabled}
                onChange={(e) => setPendingFeeEnabled(e.target.checked)}
              />
              Collect a booking fee
            </label>
            {pendingFeeEnabled ? (
              <div>
                <label className="block text-xs text-muted dark:text-slate-400">Amount (USD)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={pendingFeeDollars}
                  onChange={(e) => setPendingFeeDollars(e.target.value)}
                  className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm w-32"
                />
              </div>
            ) : null}
            <button
              type="button"
              onClick={saveFee}
              disabled={isBusy('saveFee')}
              className="rounded-md bg-accent px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {isBusy('saveFee') ? 'Saving…' : 'Save'}
            </button>
          </div>
          {pendingFeeEnabled && Number(pendingFeeDollars) > 0 ? (
            <FeeBreakdown depositDollars={Number(pendingFeeDollars)} />
          ) : null}
        </div>
      </StepCard>

      <StepCard
        number={7}
        title="Forward your real business line"
        description="When customers call your real number and you don't pick up, your phone carrier sends the call to KeeprSteady. Your phone still rings normally — only missed calls get caught by the AI."
        done={false}
      >
        {twilioDone ? (
          <CarrierForwarding twilioNumber={op!.twilio_number_e164!} />
        ) : (
          <p className="text-sm text-muted dark:text-slate-400">
            Get your KeeprSteady number first (step 3) — once you have it we&apos;ll show you the
            short code to dial on your phone for your carrier.
          </p>
        )}
      </StepCard>

      {/* ── Modals ────────────────────────────────────────────────────── */}
      <ConfirmModal
        open={releaseModalOpen}
        onClose={() => setReleaseModalOpen(false)}
        title="Release this phone number?"
        confirmLabel="Yes, release it permanently"
        cancelLabel="Keep it"
        severity="danger"
        {...(op?.twilio_number_e164 ? { typeToConfirm: op.twilio_number_e164 } : {})}
        body={
          <div className="space-y-3">
            <p>
              You&apos;re about to give up <span className="font-mono">{op?.twilio_number_e164}</span>.
              This is permanent and almost always a bad idea unless you&apos;re shutting down or
              switching to a new business phone.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-xs">
              <li>The number goes back into the public pool — anyone can buy it next.</li>
              <li>We <strong>cannot</strong> get this exact number back for you later.</li>
              <li>Customers who saved this number lose touch with you.</li>
              <li>Your call-forwarding setup (from step 7) becomes useless until you set it up
                again with a new number.</li>
            </ul>
            <p className="text-xs">
              If you just want to pause for a while, contact support instead — we can put your
              account on hold without losing the number.
            </p>
          </div>
        }
        onConfirm={releaseTwilioConfirmed}
      />

      <ConfirmModal
        open={disconnectGoogleOpen}
        onClose={() => setDisconnectGoogleOpen(false)}
        title="Disconnect your Google Calendar?"
        confirmLabel="Yes, disconnect"
        cancelLabel="Keep it connected"
        severity="warning"
        body={
          <div className="space-y-2">
            <p>
              The AI won&apos;t be able to check your availability or add new appointments to your
              calendar until you reconnect.
            </p>
            <p className="text-xs text-muted dark:text-slate-400">
              Appointments already on your calendar stay where they are — nothing gets deleted.
              You can reconnect anytime.
            </p>
          </div>
        }
        onConfirm={disconnectGoogleConfirmed}
      />
    </div>
  );
}

/**
 * Mirrors apps/api/src/modules/payments/pricing.ts at the same default config.
 * The server is authoritative — this is just for the wizard's "what do I keep"
 * preview. Values clamp the same way the server clamps.
 */
function FeeBreakdown({ depositDollars }: { depositDollars: number }): JSX.Element {
  const depositCents = Math.round(depositDollars * 100);
  const takeRateBps = publicEnv.NEXT_PUBLIC_PLATFORM_TAKE_RATE_BPS;

  // Stripe US standard: 2.9% + 30¢ per charge.
  const stripeFeeCents = Math.ceil(depositCents * 0.029) + 30;
  const requestedAppFee = Math.max(
    Math.floor((depositCents * takeRateBps) / 10_000),
    100, // mirrors MIN_PLATFORM_FEE_CENTS default
  );
  const cap = Math.max(0, depositCents - stripeFeeCents);
  const platformFeeCents = Math.min(requestedAppFee, cap);
  const operatorKeepsCents = depositCents - stripeFeeCents - platformFeeCents;

  const fmt = (c: number): string => `$${(c / 100).toFixed(2)}`;
  const ratePct = (takeRateBps / 100).toFixed(0);

  return (
    <div className="rounded-md border bg-slate-50 p-3 text-xs">
      <div className="font-medium mb-2">For a {fmt(depositCents)} deposit:</div>
      <ul className="space-y-1 text-muted">
        <li className="flex justify-between"><span>Card processing fee (2.9% + 30¢)</span><span className="font-mono">−{fmt(stripeFeeCents)}</span></li>
        <li className="flex justify-between"><span>KeeprSteady fee ({ratePct}%)</span><span className="font-mono">−{fmt(platformFeeCents)}</span></li>
        <li className="flex justify-between font-medium text-ink border-t pt-1"><span>You get</span><span className="font-mono">{fmt(operatorKeepsCents)}</span></li>
      </ul>
    </div>
  );
}

function ConnectStatusInline({
  hasAccount,
  charges,
  payouts,
}: {
  hasAccount: boolean;
  charges: boolean;
  payouts: boolean;
}): JSX.Element {
  if (!hasAccount) {
    return (
      <p className="text-xs text-slate-500">
        Stripe will ask for your bank details and basic verification. We never see your bank info.
      </p>
    );
  }
  if (!charges || !payouts) {
    return (
      <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2 inline-flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        Stripe is still verifying your account
        {!charges && ' (charges)'} {!payouts && '(payouts)'}. Continue setup if anything's missing.
      </div>
    );
  }
  return (
    <p className="text-xs text-emerald-700">✓ Stripe says you&apos;re ready to receive payouts.</p>
  );
}
