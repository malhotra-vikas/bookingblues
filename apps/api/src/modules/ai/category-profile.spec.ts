import type { Tables } from '@bookingblues/db-types';

import { collectsIntakeAnswers, isOfficeAppointmentCategory } from './category-profile';
import { assembleSystemPrompt, isBookingFeeCollectible } from './prompts';
import { TOOL_DEFINITIONS, toolDefinitionsFor } from './tool-definitions';

const toolNames = (category: string | null): string[] =>
  toolDefinitionsFor(category).flatMap((t) => (t.type === 'function' ? [t.function.name] : []));

describe('category profile', () => {
  it('only insurance is an office-appointment / intake category', () => {
    expect(isOfficeAppointmentCategory('insurance')).toBe(true);
    expect(collectsIntakeAnswers('insurance')).toBe(true);
    for (const trade of ['plumbing', 'hvac', 'electrical', 'roofing', 'garage_door', null]) {
      expect(isOfficeAppointmentCategory(trade)).toBe(false);
      expect(collectsIntakeAnswers(trade)).toBe(false);
    }
  });
});

describe('toolDefinitionsFor', () => {
  it('leaves the trades tool list untouched', () => {
    expect(toolDefinitionsFor('plumbing')).toBe(TOOL_DEFINITIONS);
    expect(toolDefinitionsFor(null)).toBe(TOOL_DEFINITIONS);
  });

  it('gives insurance intake + booking tools, without address/service-area tools', () => {
    const names = toolNames('insurance');
    expect(names).toContain('save_intake_answers');
    expect(names).toContain('book_appointment');
    expect(names).not.toContain('collect_service_address');
    expect(names).not.toContain('check_service_area');
    const book = toolDefinitionsFor('insurance').find(
      (t) => t.type === 'function' && t.function.name === 'book_appointment',
    );
    const props = (book as unknown as { function: { parameters: { properties: Record<string, unknown> } } }).function
      .parameters.properties;
    expect(props).not.toHaveProperty('urgency');
    expect(props).not.toHaveProperty('immediate_danger');
    expect(props).toHaveProperty('job_summary');
  });
});

describe('insurance prompt + fees', () => {
  const operator = {
    id: 'op',
    business_name: 'Jamal Insurance',
    category: 'insurance',
    timezone: 'America/New_York',
    visit_duration_min: 60,
    business_hours: {},
    service_zip_codes: ['02139'],
    service_radius_zones: [],
    booking_fee_enabled: true,
    booking_fee_cents: 2500,
    subscription_status: 'active',
    stripe_connect_charges_enabled: true,
    stripe_connect_payouts_enabled: true,
  } as unknown as Tables<'operators'>;

  it('never collects a booking fee, even with every fee gate on', () => {
    expect(isBookingFeeCollectible(operator)).toBe(false);
    expect(isBookingFeeCollectible({ ...operator, category: 'plumbing' })).toBe(true);
  });

  it('uses the office frame: no address, service area or emergency rules', () => {
    const prompt = assembleSystemPrompt({ operator, category: null, nowIso: '2026-11-03T15:00:00Z' });
    expect(prompt).toContain('appointment assistant for a small professional office');
    expect(prompt).toContain('save_intake_answers');
    expect(prompt).not.toContain('blue-collar');
    expect(prompt).not.toContain('Service area:');
    expect(prompt).not.toContain('collect_service_address');
    expect(prompt).not.toContain('MODE 2');
  });
});
