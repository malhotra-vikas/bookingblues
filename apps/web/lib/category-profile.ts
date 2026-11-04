/**
 * Office-appointment categories (mirrors apps/api/src/modules/ai/category-profile.ts):
 * clients meet the operator at the office or by phone, so there's no service
 * area, no trucks/crews, and no booking fee or payouts.
 */
const OFFICE_CATEGORIES: ReadonlySet<string> = new Set(['insurance']);

export function isOfficeCategory(category: string | null | undefined): boolean {
  return OFFICE_CATEGORIES.has(category ?? '');
}
