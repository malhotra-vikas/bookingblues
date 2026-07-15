import { BRAND } from './brand';

/**
 * Per-trade landing-page content (SEO Tier 2). Each entry is deliberately
 * differentiated — real trade-specific jobs, emergencies, and terminology — so
 * the pages target distinct search intent and are NOT thin/duplicate doorway
 * pages. URL: /for/{slug}. Add a trade → it's picked up by the route,
 * generateStaticParams, and the sitemap automatically.
 */
export interface Trade {
  /** URL slug, e.g. "plumbers". */
  slug: string;
  /** Plural noun for headings, e.g. "Plumbers". */
  plural: string;
  /** Singular, e.g. "plumbing company". */
  business: string;
  metaTitle: string;
  metaDescription: string;
  h1: string;
  /** Two intro paragraphs (trade-specific). */
  intro: [string, string];
  /** Common job types this trade books. */
  jobTypes: string[];
  /** Emergency scenarios the AI recognizes for this trade. */
  emergencies: string[];
  /** The value-prop bullets, tailored. */
  benefits: string[];
  /** 2–3 trade-specific FAQ entries. */
  faq: Array<{ q: string; a: string }>;
}

export const TRADES: readonly Trade[] = [
  {
    slug: 'plumbers',
    plural: 'Plumbers',
    business: 'plumbing company',
    metaTitle: 'AI Answering Service for Plumbers — Never Miss a Call',
    metaDescription:
      'KeeprSteady texts back plumbing customers the second you miss a call, books the job, and adds it to your calendar. Burst pipes, water heaters, drains — booked while you’re under a sink. Free 7-day trial.',
    h1: 'The AI dispatcher that books plumbing jobs while you’re on the tools',
    intro: [
      'When you’re elbow-deep under a sink, you can’t answer the phone — and a homeowner with a burst pipe calls the next plumber on Google in under a minute. That missed call is a missed job, often an emergency job worth hundreds.',
      `${BRAND.name} answers for you. The moment a call goes unanswered, it texts the caller back in seconds, asks the right plumbing questions, checks your calendar, and books the visit — so you keep the job without stopping work.`,
    ],
    jobTypes: [
      'Burst and leaking pipes',
      'Water heater repair & replacement',
      'Clogged & backed-up drains',
      'Faucet, toilet & fixture installs',
      'Sump pump & sewer line issues',
      'Repiping & remodels',
    ],
    emergencies: [
      'Burst pipe flooding a basement',
      'No hot water / leaking water heater',
      'Sewage backing up into the home',
      'Main line break',
    ],
    benefits: [
      'Captures emergency calls after hours and on jobs — when plumbing emergencies actually happen',
      'Asks plumbing-specific questions (leak location, water shut off, fixture type) before booking',
      'Collects a deposit on the booking so no-shows cost you nothing',
      'Every confirmed job lands on your Google Calendar with the address and job details',
    ],
    faq: [
      {
        q: 'Can it handle after-hours plumbing emergencies?',
        a: 'Yes. Most plumbing emergencies — burst pipes, no hot water, sewage backups — happen nights and weekends. KeeprSteady responds instantly, flags the emergency to you, and books the soonest available slot (or a life-safety situation is handed straight to a human).',
      },
      {
        q: 'Will it know the difference between a leaky faucet and a flooded basement?',
        a: 'It asks. The AI is scoped to plumbing and asks about the issue, whether water is shut off, and urgency — so a true emergency is prioritized and a routine fixture swap is scheduled normally.',
      },
    ],
  },
  {
    slug: 'hvac',
    plural: 'HVAC Contractors',
    business: 'HVAC company',
    metaTitle: 'AI Answering Service for HVAC Contractors — Book More Calls',
    metaDescription:
      'KeeprSteady answers missed HVAC calls by text in seconds — no heat, no AC, system installs — books the job and adds it to your calendar. Capture peak-season demand you’re too busy to answer. Free 7-day trial.',
    h1: 'Book every no-heat and no-AC call — even at peak season',
    intro: [
      'On the first 95° day of summer or the first hard freeze, your phone rings off the hook and your techs are slammed. The calls you can’t pick up go straight to the competitor who answered — right when demand (and ticket size) is highest.',
      `${BRAND.name} catches those calls. It texts the homeowner back instantly, asks whether it’s heating or cooling, how old the system is, and books the diagnostic — so peak-season demand turns into booked revenue instead of voicemail.`,
    ],
    jobTypes: [
      'No-heat & no-cool service calls',
      'AC & furnace repair',
      'System replacement & installs',
      'Seasonal tune-ups & maintenance',
      'Thermostat & ductwork issues',
      'Heat pump service',
    ],
    emergencies: [
      'No heat in freezing weather',
      'No AC during a heat wave (with elderly or infants at home)',
      'Furnace short-cycling or smell of burning',
      'Frozen or leaking system',
    ],
    benefits: [
      'Absorbs peak-season call spikes your office can’t answer fast enough',
      'Qualifies the call (heating vs cooling, system age, symptoms) before it hits your schedule',
      'Prioritizes true comfort emergencies — no heat in a freeze, no AC with an infant at home',
      'Deposits reduce no-shows on diagnostics; every job syncs to your calendar',
    ],
    faq: [
      {
        q: 'Can it keep up when every call comes in on the same hot day?',
        a: 'That’s exactly when it earns its keep. KeeprSteady answers every missed call in parallel by text, so a heat-wave rush that would overflow your office instead becomes a full schedule.',
      },
      {
        q: 'Does it understand HVAC-specific questions?',
        a: 'Yes — it’s configured for your trade and asks whether the issue is heating or cooling, the system’s age, and the symptoms, so your tech rolls up already knowing the job.',
      },
    ],
  },
  {
    slug: 'electricians',
    plural: 'Electricians',
    business: 'electrical company',
    metaTitle: 'AI Answering Service for Electricians — Never Miss a Job',
    metaDescription:
      'KeeprSteady texts back electrical customers the moment you miss a call, screens for safety issues, and books the job to your calendar. Panels, outages, EV chargers — captured while you’re on a ladder. Free 7-day trial.',
    h1: 'Book electrical jobs without stopping to answer the phone',
    intro: [
      'You can’t take a call with your hands in a panel — and a homeowner with a dead circuit or a burning smell isn’t going to leave a voicemail. They call the next licensed electrician who picks up.',
      `${BRAND.name} answers for you. It texts the caller back in seconds, screens for safety (sparks, burning smell, exposed wiring), and books the visit — while handing genuine hazards straight to a human so nothing dangerous waits on a bot.`,
    ],
    jobTypes: [
      'Panel upgrades & replacements',
      'Dead outlets & circuits',
      'Lighting & fixture installs',
      'EV charger installation',
      'Rewiring & code corrections',
      'Generator & surge protection',
    ],
    emergencies: [
      'Burning smell or sparks from an outlet or panel',
      'Exposed or arcing wiring',
      'Partial power loss / repeated breaker trips',
      'Storm or water damage to electrical',
    ],
    benefits: [
      'Screens every call for electrical safety hazards before scheduling',
      'Hands true dangers (sparks, burning smell, exposed wire) to a human immediately',
      'Books routine work — panels, outlets, EV chargers — straight to your calendar',
      'Deposits on booking cut no-shows on quotes and installs',
    ],
    faq: [
      {
        q: 'What happens if a caller reports something dangerous?',
        a: 'The AI is built to recognize electrical hazards — sparks, a burning smell, exposed or arcing wiring — give the caller a safety instruction, and escalate straight to a person. It never tries to “book away” a life-safety issue.',
      },
      {
        q: 'Can it book EV charger and panel-upgrade quotes?',
        a: 'Yes. It captures the job details, checks your availability, and books the site visit or quote, syncing it to your Google Calendar with the address.',
      },
    ],
  },
  {
    slug: 'roofers',
    plural: 'Roofers',
    business: 'roofing company',
    metaTitle: 'AI Answering Service for Roofers — Capture Storm Calls',
    metaDescription:
      'KeeprSteady texts back roofing leads instantly — leaks, storm damage, replacements — books the inspection and adds it to your calendar. Never lose a post-storm call to a competitor again. Free 7-day trial.',
    h1: 'Turn every storm call into a booked roof inspection',
    intro: [
      'After a storm, the phones light up — and whoever books the inspection first usually wins the job. If your crew is on a roof and the office is swamped, those high-intent leads go to the competitor who answered.',
      `${BRAND.name} answers every one. It texts the homeowner back in seconds, asks whether it’s a leak, storm damage, or a full replacement, and books the inspection — so a storm surge becomes a booked pipeline instead of missed calls.`,
    ],
    jobTypes: [
      'Storm & hail damage inspections',
      'Roof leak repairs',
      'Full roof replacement',
      'Emergency tarping',
      'Gutter & flashing repair',
      'Insurance claim inspections',
    ],
    emergencies: [
      'Active roof leak during a storm',
      'Storm-torn or missing roof sections',
      'Tree or debris through the roof',
      'Water coming through the ceiling',
    ],
    benefits: [
      'Captures the post-storm call rush when demand spikes and timing wins the job',
      'Qualifies the lead (leak vs storm damage vs replacement) before booking',
      'Books inspections straight to your calendar with the property address',
      'Deposits filter tire-kickers and cut no-shows on inspections',
    ],
    faq: [
      {
        q: 'Can it handle a flood of calls after a hailstorm?',
        a: 'Yes — that’s the point. Every missed call gets an instant text back and a booked inspection, so a storm that overwhelms your office becomes a full inspection schedule instead of lost leads.',
      },
      {
        q: 'Does it work for insurance-claim inspections?',
        a: 'It books the inspection and captures the details; your team handles the claim itself. Every booking lands on your calendar with the address so nothing slips.',
      },
    ],
  },
  {
    slug: 'garage-door',
    plural: 'Garage Door Companies',
    business: 'garage door company',
    metaTitle: 'AI Answering Service for Garage Door Companies',
    metaDescription:
      'KeeprSteady texts back garage-door customers instantly — broken springs, stuck doors, openers — books the repair and adds it to your calendar. Capture the same-day urgency you can’t answer on a job. Free 7-day trial.',
    h1: 'Book garage-door repairs while your techs are on calls',
    intro: [
      'A stuck garage door is a same-day problem — the customer can’t get their car out, or the house isn’t secure — so they call down the list until someone picks up. Miss that call and the job is gone in minutes.',
      `${BRAND.name} answers instantly. It texts the customer back, asks what’s wrong (broken spring, stuck door, opener issue), and books the repair — capturing the same-day urgency your techs are too busy to answer.`,
    ],
    jobTypes: [
      'Broken spring replacement',
      'Door off-track / stuck doors',
      'Opener repair & installation',
      'Cable & roller replacement',
      'New door installation',
      'Safety sensor issues',
    ],
    emergencies: [
      'Door stuck open — home not secure',
      'Car trapped inside the garage',
      'Door fell or came off its track',
      'Broken spring blocking access',
    ],
    benefits: [
      'Captures same-day urgency — stuck doors and security concerns can’t wait for a callback',
      'Asks the right questions (spring, opener, off-track) so the tech brings the right parts',
      'Books the repair straight to your calendar with the address',
      'Deposits cut no-shows on service calls',
    ],
    faq: [
      {
        q: 'Can it book same-day garage-door repairs?',
        a: 'Yes. It recognizes the urgency of a stuck or insecure door, checks your soonest availability, and books the repair — often before the customer would have reached a competitor’s voicemail.',
      },
      {
        q: 'Will the tech know what parts to bring?',
        a: 'The AI asks whether it’s a spring, opener, cable, or off-track issue and includes it in the booking, so your tech arrives prepared.',
      },
    ],
  },
] as const;

export function tradeBySlug(slug: string): Trade | undefined {
  return TRADES.find((t) => t.slug === slug);
}
