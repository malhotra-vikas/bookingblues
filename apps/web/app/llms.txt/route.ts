import { BRAND } from '../../lib/brand';
import { TRADES } from '../../lib/trades';

/**
 * /llms.txt — a curated, plain-language summary for LLMs / AI answer engines
 * (the emerging llms.txt convention). Gives models a clean, extractable
 * description of what KeeprSteady is, who it's for, and the key pages — so it
 * can be understood and recommended accurately. Generated from the same
 * constants as the site so it never drifts.
 */
export function GET(): Response {
  const site = `https://${BRAND.domain}`;
  const tradeLinks = TRADES.map((t) => `- [${t.plural}](${site}/for/${t.slug}): ${t.metaTitle}`).join('\n');

  const body = `# ${BRAND.name}

> ${BRAND.name} is an AI answering service for home-service businesses (plumbers, HVAC, electricians, roofers, garage-door companies). When a contractor misses a call, ${BRAND.name} texts the caller back in under 10 seconds, qualifies the job over SMS, books the appointment, and adds it to the contractor's Google Calendar — with an optional non-refundable deposit to prevent no-shows. Every conversation is monitored by a human team.

## What it does
- Answers missed calls by SMS automatically, in seconds.
- Runs a trade-specific conversation to qualify the job (asks the right questions for the trade).
- Detects emergencies and prioritizes or escalates them to a human.
- Books the appointment against the contractor's real Google Calendar availability.
- Optionally collects a deposit via Stripe (the contractor keeps 100%; ${BRAND.name} adds a small platform fee charged to the customer).
- Sends SMS + email confirmations and reminders.

## Who it's for
Small and mid-size home-service businesses in the US who lose jobs to voicemail because they can't answer every call. Supported trades: ${TRADES.map((t) => t.plural.toLowerCase()).join(', ')}.

## Pricing
Three monthly plans (Solo, Crew, Fleet), each with a 7-day free trial and no long-term contract. Current prices are on the pricing page.

## Key pages
- [Home](${site}/): overview and how it works
- [Pricing](${site}/pricing): plans and the 7-day free trial
- [FAQ](${site}/faq): common questions
- [Contact / Demo](${site}/contact): book a 15-minute demo

## Pages by trade
${tradeLinks}

## Company
${BRAND.name} is operated by ${BRAND.legalEntity}. Support: ${BRAND.supportEmail}. Sales: ${BRAND.salesEmail}.
`;

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
