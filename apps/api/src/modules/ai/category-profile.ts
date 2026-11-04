/**
 * Category booking styles. Most categories are home-services trades: a tech
 * drives to the caller's property (address, service area, travel buffer,
 * emergencies, deposits). Office-appointment categories (Insurance Agencies)
 * book a meeting with the operator instead, and collect structured intake
 * answers that land on the appointment.
 *
 * Single source of truth so the prompt, tools, booking pipeline, Slack and
 * emergency detection all agree.
 */

/** Categories that book an office/phone appointment rather than a field visit. */
const OFFICE_APPOINTMENT_CATEGORIES: ReadonlySet<string> = new Set(['insurance']);

/** True for categories like Insurance Agencies (no address, travel, emergencies or deposit). */
export function isOfficeAppointmentCategory(category: string | null | undefined): boolean {
  return category != null && OFFICE_APPOINTMENT_CATEGORIES.has(category);
}

/**
 * Categories whose bot collects intake answers (save_intake_answers). These hold
 * health information (date of birth, doctor, prescriptions): stored encrypted,
 * kept out of Slack, the public calendar link and the generic job summary.
 */
export function collectsIntakeAnswers(category: string | null | undefined): boolean {
  return category === 'insurance';
}
