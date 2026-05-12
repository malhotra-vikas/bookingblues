'use client';

import { useMemo, useState } from 'react';

type TierKey = 'starter' | 'pro' | 'enterprise';

const TIERS: Record<TierKey, { name: string; platform: number; setupDefault: number }> = {
  starter: { name: 'Launch', platform: 997, setupDefault: 2500 },
  pro: { name: 'Command', platform: 1897, setupDefault: 7500 },
  enterprise: { name: 'Fleet', platform: 3497, setupDefault: 23000 },
};

const TIER_SETUP_MULTIPLIER: Record<TierKey, number> = {
  starter: 1.0,
  pro: 1.0,
  enterprise: 1.2,
};

const HITL_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 300, label: 'Overflow (20 hrs/mo) — $300' },
  { value: 750, label: 'Standard (60 hrs/mo) — $750' },
  { value: 1800, label: 'Dedicated (160 hrs/mo) — $1,800' },
];

const DEFAULTS = {
  tier: 'pro' as TierKey,
  sal: 45_000,
  ovh: 28,
  miss: 12,
  job: 320,
  conv: 65,
  trucks: 8,
  callsPerTruck: 8,
  bizDays: 22,
  amort: 12,
  hitlOn: true,
  hitlFee: 750,
} as const;

const MISSED_CALL_RATE = 0.12; // industry average
const BASE_SETUP = 2_500;
const PER_TRUCK_SETUP = 625;
const PARTNER_CUT_PCT = 0.20;
const REP_COMM_PCT = 0.25;
const REP_SETUP_BONUS_PCT = 0.10;

function fmt(n: number): string {
  return '$' + Math.round(n).toLocaleString();
}
function fmtK(n: number): string {
  if (Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(1) + 'k';
  return fmt(n);
}
function pct(n: number): string {
  return Math.round(n) + '%';
}

export function SalesCalculator(): JSX.Element {
  const [tier, setTier] = useState<TierKey>(DEFAULTS.tier);
  const [sal, setSal] = useState<number>(DEFAULTS.sal);
  const [ovh, setOvh] = useState<number>(DEFAULTS.ovh);
  const [miss, setMiss] = useState<number>(DEFAULTS.miss);
  const [job, setJob] = useState<number>(DEFAULTS.job);
  const [conv, setConv] = useState<number>(DEFAULTS.conv);
  const [trucks, setTrucks] = useState<number>(DEFAULTS.trucks);
  const [callsPerTruck, setCallsPerTruck] = useState<number>(DEFAULTS.callsPerTruck);
  const [bizDays, setBizDays] = useState<number>(DEFAULTS.bizDays);
  const [amort, setAmort] = useState<number>(DEFAULTS.amort);
  const [hitlOn, setHitlOn] = useState<boolean>(DEFAULTS.hitlOn);
  const [hitlFee, setHitlFee] = useState<number>(DEFAULTS.hitlFee);
  const [copied, setCopied] = useState(false);

  const m = useMemo(() => computeAll({
    tier, sal, ovh, miss, job, conv, trucks, callsPerTruck, bizDays, amort, hitlOn, hitlFee,
  }), [tier, sal, ovh, miss, job, conv, trucks, callsPerTruck, bizDays, amort, hitlOn, hitlFee]);

  function copyPitch(): void {
    navigator.clipboard.writeText(m.pitch).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function reset(): void {
    setTier(DEFAULTS.tier);
    setSal(DEFAULTS.sal); setOvh(DEFAULTS.ovh); setMiss(DEFAULTS.miss);
    setJob(DEFAULTS.job); setConv(DEFAULTS.conv);
    setTrucks(DEFAULTS.trucks); setCallsPerTruck(DEFAULTS.callsPerTruck);
    setBizDays(DEFAULTS.bizDays); setAmort(DEFAULTS.amort);
    setHitlOn(DEFAULTS.hitlOn); setHitlFee(DEFAULTS.hitlFee);
  }

  return (
    <div className="rounded-xl bg-[#0d0f11] text-[#e8eaed] font-mono-fallback p-6 -mx-6 -my-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-base font-semibold tracking-tight">
            <span className="text-emerald-400">BookingBlues</span>
            <span className="text-slate-500 mx-2">|</span>
            <span className="text-sm font-normal text-slate-400">Sales Calculator</span>
          </h1>
          <p className="text-[11px] text-slate-500 mt-1">
            Internal pitch tool — not for prospects. All math is real-time; sliders persist while
            this page is open.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-semibold tracking-widest uppercase bg-amber-500/10 text-amber-400 border border-amber-500/30 px-2.5 py-1 rounded">
            ⚠ Internal Use Only
          </span>
          <button
            type="button"
            onClick={reset}
            className="text-xs bg-[#1a1e24] border border-[#252a32] text-slate-300 px-3 py-1.5 rounded hover:border-emerald-400 hover:text-emerald-400"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <aside className="flex flex-col gap-4">
          <Card title="Pricing Tier">
            <div className="grid grid-cols-3 gap-1.5 mb-4">
              {(Object.keys(TIERS) as TierKey[]).map((k) => {
                const active = k === tier;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTier(k)}
                    className={`rounded border px-1 py-2 text-center ${
                      active
                        ? 'bg-emerald-500/10 border-emerald-400'
                        : 'bg-[#1a1e24] border-[#252a32] hover:border-[#2e3540]'
                    }`}
                  >
                    <div className={`text-[11px] font-semibold tracking-wider ${active ? 'text-emerald-400' : 'text-slate-400'}`}>
                      {TIERS[k].name.toUpperCase()}
                    </div>
                    <div className="text-xs text-[#e8eaed]">${TIERS[k].platform.toLocaleString()}/mo</div>
                  </button>
                );
              })}
            </div>

            <SliderRow label="Dispatcher salary ($/yr)" value={fmt(sal)}
              min={30_000} max={70_000} step={1_000} v={sal} setV={setSal} />
            <SliderRow label="Employer overhead %" value={pct(ovh)}
              min={15} max={45} step={1} v={ovh} setV={setOvh} />
            <SliderRow label="Missed calls / month (manual override)" value={String(miss)}
              min={1} max={50} step={1} v={miss} setV={setMiss} />
            <SliderRow label="Avg job value ($)" value={fmt(job)}
              min={100} max={1_200} step={10} v={job} setV={setJob} />
            <SliderRow label="Call booking conversion %" value={pct(conv)}
              min={40} max={90} step={1} v={conv} setV={setConv} />
          </Card>

          <Card title="Fleet Calculation">
            <SliderRow label="Number of trucks" value={String(trucks)}
              min={1} max={50} step={1} v={trucks} setV={setTrucks} />
            <SliderRow label="Avg calls per truck/day" value={String(callsPerTruck)}
              min={2} max={20} step={1} v={callsPerTruck} setV={setCallsPerTruck} />
            <SliderRow label="Business days/month" value={String(bizDays)}
              min={15} max={30} step={1} v={bizDays} setV={setBizDays} />
            <Separator label="Calculated values" />
            <KV label="Total monthly calls" value={m.totalMonthlyCalls.toLocaleString()} />
            <KV label="Estimated missed calls (12%)" value={m.calculatedMissedCalls.toLocaleString()} />
          </Card>

          <Card title="HITL Verification">
            <div className="flex items-center justify-between py-2 border-b border-[#252a32]">
              <span className="text-xs text-slate-400">Include HITL service</span>
              <ToggleSwitch on={hitlOn} setOn={setHitlOn} />
            </div>
            <div className={hitlOn ? '' : 'opacity-40 pointer-events-none'}>
              <div className="flex items-center justify-between py-2 border-b border-[#252a32]">
                <span className="text-xs text-slate-400">Coverage level</span>
                <select
                  value={hitlFee}
                  onChange={(e) => setHitlFee(Number(e.target.value))}
                  className="bg-[#1a1e24] border border-[#2e3540] text-[#e8eaed] text-xs px-2 py-1 rounded cursor-pointer"
                >
                  {HITL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <KV label="HITL monthly fee" value={hitlOn ? fmt(hitlFee) + '/mo' : '$0/mo'} pos />
            </div>
          </Card>

          <Card title="Setup Fee">
            <KV label="Calculated setup fee" value={fmt(m.setupFee)} />
            <SliderRow label="Amortize over (months)" value={String(amort)}
              min={6} max={36} step={6} v={amort} setV={setAmort} />
            <Separator label="Setup fee breakdown" />
            <KV label="Base setup" value={fmt(BASE_SETUP)} />
            <KV label="Per-truck setup" value={`${fmt(PER_TRUCK_SETUP * trucks)} (${trucks} × $${PER_TRUCK_SETUP})`} />
            <KV label="Tier multiplier" value={`${TIER_SETUP_MULTIPLIER[tier].toFixed(1)}x`} />
          </Card>
        </aside>

        {/* ── Main ────────────────────────────────────────────────────── */}
        <main className="flex flex-col gap-4">
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi top="emerald" label="Monthly savings" value={fmt(m.savings) + '/mo'} sub="dispatcher cost − BookingBlues total" />
            <Kpi top="blue" label="Revenue recovered" value={fmt(m.revRec) + '/mo'} sub="from AI-captured missed calls" />
            <Kpi top="amber" label="Combined monthly benefit" value={fmt(m.combined) + '/mo'} sub="savings + new revenue" />
            <Kpi top="red" label="First-year ROI" value={pct(m.roi) + ' yr1'} sub="after setup fee" />
          </div>

          {/* Cost & Revenue */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Cost comparison">
              <Table rows={[
                { label: 'Dispatcher base salary', value: fmt(m.dispSalMo) + '/mo', tone: 'neg' },
                { label: 'Payroll taxes & benefits', value: fmt(m.dispTaxMo) + '/mo', tone: 'neg' },
                { label: 'True dispatcher cost/mo', value: fmt(m.dispMonthly) + '/mo', tone: 'neg', total: true },
                { spacer: true },
                { label: 'BookingBlues platform (MRR)', value: fmt(m.platform) + '/mo' },
                { label: 'HITL verification', value: hitlOn ? fmt(hitlFee) + '/mo' : '$0 (excluded)' },
                { label: 'Setup fee (amortized)', value: fmt(m.amortized) + `/mo (${amort} mo)` },
                { label: 'Total BB cost/mo (yr 1)', value: fmt(m.keeprMo) + '/mo', total: true },
              ]} />
            </Card>

            <Card title="Revenue recovery">
              <Table rows={[
                { label: 'Missed calls/mo (estimated)', value: `${m.effectiveMissedCalls} ${miss === 12 ? '(calculated)' : '(manual)'}` },
                { label: 'AI answers (24/7 coverage)', value: `${m.effectiveMissedCalls} (100% captured)` },
                { label: 'Booked at conversion rate', value: `${m.booked} jobs @ ${conv}%` },
                { label: 'At average job value', value: fmt(job) + ' avg' },
                { label: 'New revenue/mo recovered', value: fmt(m.revRec) + '/mo', tone: 'pos', total: true },
                { spacer: true },
                { label: 'Break-even calls/mo needed', value: typeof m.breakeven === 'number' ? `${m.breakeven} calls/mo` : '∞' },
                { label: 'Payback period (setup)', value: m.paybackMonths === Infinity ? '∞' : `${m.paybackMonths} months` },
              ]} />
            </Card>
          </div>

          {/* Silo allocation */}
          <Card title="Monthly revenue allocation (MRR only)" right={`Total MRR: ${fmt(m.totalMRR)}/mo`}>
            <SiloRow name="HITL (Core)" value={m.hitlFee} max={m.siloMax} variant="core" />
            <SiloRow name="Recurring (your 80%)" value={m.yourSteady} max={m.siloMax} variant="steady" />
            <SiloRow name="Partner payout (20%)" value={m.partnerCut} max={m.siloMax} variant="partner" />
            <SiloRow name="Sales rep (25% of MRR)" value={m.repComm} max={m.siloMax} variant="rep" />
          </Card>

          {/* Health + Scale */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Commission sustainability">
              <HealthRow dot={dotFor(m.grossMarginPct, 60, 40)} label="Gross margin after rep commission" value={fmt(m.grossAfterRep) + `/mo (${m.grossMarginPct}%)`} />
              <HealthRow dot={dotFor(m.netToYou, 500, 200)} label="Net to you (after partner + rep)" value={fmt(m.netToYou) + '/mo'} />
              <HealthRow dot={dotFor(m.setupNet, m.setupFee * 0.7, m.setupFee * 0.4)} label="Setup fee (100% to BB)" value={fmt(m.setupFee)} />
              <HealthRow dot="green" label="Rep setup bonus (10% one-time)" value={fmt(m.repSetupBonus) + ' (10%)'} />
              <HealthRow dot="green" label="Your net setup (after rep bonus)" value={fmt(m.setupNet)} pos />
            </Card>

            <Card title="@ 100 accounts (scale projection)">
              <HealthRow dot="green" label="Total MRR (platform only)" value={fmtK(m.s100MRR) + '/mo'} pos />
              <HealthRow dot="amber" label="Total rep commissions/mo" value={fmtK(m.s100Rep) + '/mo'} />
              <HealthRow dot="amber" label="Partner payouts/mo" value={fmtK(m.s100Partner) + '/mo'} />
              <HealthRow dot="green" label="Your net MRR at 100 accounts" value={fmtK(m.s100Net) + '/mo'} pos />
              <HealthRow dot="green" label="HITL revenue/mo at scale" value={fmtK(m.s100HITL) + '/mo'} pos />
            </Card>
          </div>

          {/* Pitch */}
          <div className="rounded-lg bg-[#13161a] border border-[#252a32]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-emerald-500/15 bg-emerald-500/5">
              <span className="text-[11px] font-semibold tracking-widest uppercase text-emerald-400">
                ⬡ Live pitch script — read to prospect
              </span>
              <button
                type="button"
                onClick={copyPitch}
                className={`text-[10px] font-medium tracking-widest uppercase px-2.5 py-1 rounded border ${
                  copied
                    ? 'border-emerald-400 text-emerald-400'
                    : 'border-[#2e3540] bg-[#1a1e24] text-slate-400 hover:border-emerald-400 hover:text-emerald-400'
                }`}
              >
                {copied ? 'Copied!' : 'Copy script'}
              </button>
            </div>
            <div className="p-4">
              <p className="text-[13px] italic text-[#e8eaed] leading-relaxed border-l-2 border-emerald-400 pl-3.5">
                {m.pitch}
              </p>
            </div>
          </div>

          <p className="text-[10px] text-slate-500 font-mono-fallback text-right pt-2">
            CONFIDENTIAL — Do not share with prospects · pricing effective Q2 2026
          </p>
        </main>
      </div>
    </div>
  );
}

// ── Math ────────────────────────────────────────────────────────────────

interface Inputs {
  tier: TierKey;
  sal: number;
  ovh: number;
  miss: number;
  job: number;
  conv: number;
  trucks: number;
  callsPerTruck: number;
  bizDays: number;
  amort: number;
  hitlOn: boolean;
  hitlFee: number;
}

function computeAll(x: Inputs) {
  const tierInfo = TIERS[x.tier];
  const platform = tierInfo.platform;
  const hitlFee = x.hitlOn ? x.hitlFee : 0;
  const tierMultiplier = TIER_SETUP_MULTIPLIER[x.tier];
  const setupFee = Math.round((BASE_SETUP + x.trucks * PER_TRUCK_SETUP) * tierMultiplier);

  const totalMonthlyCalls = x.trucks * x.callsPerTruck * x.bizDays;
  const calculatedMissedCalls = Math.round(totalMonthlyCalls * MISSED_CALL_RATE);
  const effectiveMissedCalls = x.miss === DEFAULTS.miss ? calculatedMissedCalls : x.miss;

  const dispMonthly = Math.round((x.sal * (1 + x.ovh / 100)) / 12);
  const dispSalMo = Math.round(x.sal / 12);
  const dispTaxMo = dispMonthly - dispSalMo;

  const amortized = Math.round(setupFee / x.amort);
  const keeprMo = platform + hitlFee + amortized;
  const savings = dispMonthly - keeprMo;

  const booked = Math.round((effectiveMissedCalls * x.conv) / 100);
  const revRec = booked * x.job;
  const combined = savings + revRec;

  const revenuePerCall = (x.job * x.conv) / 100;
  const breakeven: number | '∞' = revenuePerCall > 0 ? Math.ceil(keeprMo / revenuePerCall) : '∞';
  const paybackMonths = combined > 0 ? Math.ceil(setupFee / combined) : Infinity;
  const yr1Benefit = combined * 12 - setupFee;
  const roi = setupFee > 0 ? Math.round((yr1Benefit / setupFee) * 100) : 0;

  const partnerCut = Math.round(platform * PARTNER_CUT_PCT);
  const yourSteady = Math.round(platform * (1 - PARTNER_CUT_PCT));
  const repComm = Math.round(platform * REP_COMM_PCT);
  const totalMRR = platform + hitlFee;
  const siloMax = Math.max(hitlFee, yourSteady, partnerCut, repComm);

  const grossAfterRep = platform - repComm;
  const netToYou = yourSteady - repComm + hitlFee;
  const repSetupBonus = Math.round(setupFee * REP_SETUP_BONUS_PCT);
  const setupNet = setupFee - repSetupBonus;
  const grossMarginPct = Math.round((grossAfterRep / platform) * 100);

  const s100MRR = platform * 100;
  const s100Rep = repComm * 100;
  const s100Partner = partnerCut * 100;
  const s100Net = (yourSteady - repComm) * 100;
  const s100HITL = hitlFee * 100;

  const pitch =
    `"Right now you're paying ${fmt(dispMonthly)} every single month for your dispatcher — and that's before overtime, sick days, or turnover. With BookingBlues ${tierInfo.name}, your all-in cost drops to ${fmt(keeprMo)} per month in year one. That's ${fmt(Math.abs(savings))} ${savings >= 0 ? 'back in your pocket' : 'more, but here is where it gets interesting'} every month just on labor. But here's the number most owners miss: you're leaving roughly ${effectiveMissedCalls} calls on the table each month. Our AI answers every single one, 24/7. At your job value of ${fmt(x.job)}, that's ${fmt(revRec)} in revenue you're recovering that you weren't seeing before. Combined, we're talking ${fmt(combined)} per month in real financial impact — your setup is paid back in ${paybackMonths === Infinity ? 'a few months' : paybackMonths + ' month' + (paybackMonths === 1 ? '' : 's')} and your first-year ROI is ${pct(roi)}. There's also a live human HITL agent monitoring the AI's every dispatch decision, so you're not just getting automation — you're getting accountability. What does your current dispatcher situation look like?"`;

  return {
    platform, hitlFee, setupFee, totalMonthlyCalls, calculatedMissedCalls, effectiveMissedCalls,
    dispMonthly, dispSalMo, dispTaxMo, amortized, keeprMo, savings, booked, revRec, combined,
    breakeven, paybackMonths, roi,
    partnerCut, yourSteady, repComm, totalMRR, siloMax,
    grossAfterRep, netToYou, repSetupBonus, setupNet, grossMarginPct,
    s100MRR, s100Rep, s100Partner, s100Net, s100HITL,
    pitch,
  };
}

// ── Subcomponents ──────────────────────────────────────────────────────

function Card({ title, right, children }: { title: string; right?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded-lg bg-[#13161a] border border-[#252a32] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#252a32] flex items-center justify-between">
        <span className="text-[11px] font-medium tracking-widest uppercase text-slate-400">{title}</span>
        {right && <span className="text-[11px] text-slate-500 font-mono-fallback">{right}</span>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function SliderRow({ label, value, min, max, step, v, setV }: {
  label: string; value: string; min: number; max: number; step: number; v: number; setV: (n: number) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 mb-3">
      <div className="flex justify-between items-baseline">
        <span className="text-xs text-slate-400">{label}</span>
        <span className="text-[13px] font-semibold text-emerald-400 font-mono-fallback">{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={v}
        onChange={(e) => setV(Number(e.target.value))}
        className="w-full accent-emerald-400 h-[3px]" />
    </div>
  );
}

function Separator({ label }: { label: string }): JSX.Element {
  return (
    <div className="flex items-center gap-2.5 my-2">
      <span className="text-[10px] tracking-widest uppercase text-slate-500">{label}</span>
      <span className="flex-1 h-px bg-[#252a32]" />
    </div>
  );
}

function KV({ label, value, pos }: { label: string; value: string; pos?: boolean }): JSX.Element {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[#252a32] last:border-0">
      <span className="text-xs text-slate-400">{label}</span>
      <span className={`text-xs font-medium font-mono-fallback ${pos ? 'text-emerald-400' : 'text-[#e8eaed]'}`}>{value}</span>
    </div>
  );
}

function ToggleSwitch({ on, setOn }: { on: boolean; setOn: (b: boolean) => void }): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => setOn(!on)}
      className={`relative w-9 h-5 rounded-full border transition-colors ${
        on ? 'bg-emerald-500/15 border-emerald-400' : 'bg-[#1a1e24] border-[#2e3540]'
      }`}
    >
      <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-transform ${
        on ? 'bg-emerald-400 left-[18px]' : 'bg-slate-500 left-0.5'
      }`} />
    </button>
  );
}

function Kpi({ top, label, value, sub }: { top: 'emerald' | 'blue' | 'amber' | 'red'; label: string; value: string; sub: string }): JSX.Element {
  const bar = {
    emerald: 'bg-emerald-400',
    blue: 'bg-blue-400',
    amber: 'bg-amber-400',
    red: 'bg-red-400',
  }[top];
  return (
    <div className="relative rounded-lg bg-[#13161a] border border-[#252a32] p-4 overflow-hidden">
      <span className={`absolute top-0 left-0 right-0 h-0.5 ${bar}`} />
      <div className="text-[11px] text-slate-500 tracking-wide mb-1.5">{label}</div>
      <div className="text-[22px] font-semibold text-[#e8eaed] font-mono-fallback leading-none">{value}</div>
      <div className="text-[11px] text-slate-500 mt-1">{sub}</div>
    </div>
  );
}

type Row =
  | { spacer: true }
  | { label: string; value: string; tone?: 'pos' | 'neg'; total?: boolean };

function Table({ rows }: { rows: ReadonlyArray<Row> }): JSX.Element {
  return (
    <table className="w-full text-[13px]">
      <tbody>
        {rows.map((r, i) => {
          if ('spacer' in r) {
            return <tr key={`s${i}`}><td colSpan={2} className="h-2" /></tr>;
          }
          const tone = r.tone === 'pos' ? 'text-emerald-400' : r.tone === 'neg' ? 'text-red-400' : '';
          const total = r.total
            ? 'border-t border-[#2e3540] pt-2.5 font-semibold text-[#e8eaed]'
            : '';
          return (
            <tr key={r.label} className="border-b border-[#252a32] last:border-0">
              <td className={`py-2 text-slate-400 ${total}`}>{r.label}</td>
              <td className={`py-2 text-right font-medium font-mono-fallback ${total} ${tone}`}>
                {r.value}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SiloRow({ name, value, max, variant }: {
  name: string; value: number; max: number; variant: 'core' | 'steady' | 'partner' | 'rep';
}): JSX.Element {
  const width = Math.max(8, Math.round((value / (max * 1.1)) * 100));
  const cls = {
    core: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    steady: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    partner: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    rep: 'bg-red-500/15 text-red-400 border-red-500/30',
  }[variant];
  return (
    <div className="flex items-center gap-2.5 mb-2">
      <span className="text-xs text-slate-400 w-36 shrink-0">{name}</span>
      <div className="flex-1 bg-[#1a1e24] rounded-sm h-5 overflow-hidden">
        <div
          className={`h-full flex items-center pl-2 text-[11px] font-medium font-mono-fallback border min-w-[44px] transition-[width] duration-500 ${cls}`}
          style={{ width: `${width}%` }}
        >
          {fmt(value)}
        </div>
      </div>
    </div>
  );
}

function HealthRow({ dot, label, value, pos }: { dot: 'green' | 'amber' | 'red'; label: string; value: string; pos?: boolean }): JSX.Element {
  const color = { green: 'bg-emerald-400', amber: 'bg-amber-400', red: 'bg-red-400' }[dot];
  return (
    <div className="flex items-center gap-3 py-2 border-b border-[#252a32] last:border-0">
      <span className={`w-2 h-2 rounded-full ${color} shrink-0`} />
      <span className="text-xs text-slate-400 flex-1">{label}</span>
      <span className={`text-[13px] font-semibold font-mono-fallback ${pos ? 'text-emerald-400' : 'text-[#e8eaed]'}`}>
        {value}
      </span>
    </div>
  );
}

function dotFor(value: number, good: number, warn: number): 'green' | 'amber' | 'red' {
  if (value >= good) return 'green';
  if (value >= warn) return 'amber';
  return 'red';
}
