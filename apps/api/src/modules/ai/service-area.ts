import zipcodes from 'zipcodes';
import type { Tables } from '@bookingblues/db-types';

type OperatorRow = Tables<'operators'>;

export interface RadiusZone {
  readonly center_zip: string;
  readonly radius_miles: number;
}

/**
 * Expand the operator's service-area config (explicit ZIPs + radius zones)
 * into a single deduped, sorted list of US ZIP codes the AI should treat as
 * "in service".
 *
 * Empty result = no service area configured = open coverage (the prompt
 * formatter renders "not configured — accept any address" in that case).
 *
 * `zipcodes.radius()` returns a string array of US ZIPs whose centroids fall
 * within `miles` of the center ZIP's centroid, computed via haversine. Stale
 * data (the package's last release was 2017) is acceptable for "in this
 * metro?" gating; revisit if we see real coverage misses in production.
 */
export function expandServiceArea(operator: OperatorRow): string[] {
  const explicit = (operator.service_zip_codes ?? []) as string[];
  const zones = parseRadiusZones(operator.service_radius_zones);
  const radiusZips = zones.flatMap((zone) => {
    try {
      const result = zipcodes.radius(zone.center_zip, zone.radius_miles);
      return Array.isArray(result)
        ? result.filter((z): z is string => typeof z === 'string')
        : [];
    } catch {
      // Unknown center ZIP — skip the zone rather than fail the prompt.
      return [];
    }
  });
  return [...new Set([...explicit, ...radiusZips])].sort();
}

/**
 * Deterministic membership test for a single caller ZIP — the source of truth
 * for the service-area gate. Avoids dumping (and truncating) the full expanded
 * ZIP list into the prompt, which caused false "out of area" rejections for
 * radius zones (QA 2026-06-29: 08821 is 18mi from 08820 yet was rejected
 * because it fell in the truncated tail of a 680-ZIP list).
 *
 * `configured=false` means no service area set → treat as open coverage.
 */
export function isZipInServiceArea(
  operator: OperatorRow,
  zip: string,
): { configured: boolean; inArea: boolean } {
  const normalized = zip.trim().slice(0, 5);
  const explicit = (operator.service_zip_codes ?? []) as string[];
  const zones = parseRadiusZones(operator.service_radius_zones);
  const configured = explicit.length > 0 || zones.length > 0;
  if (!configured) return { configured: false, inArea: true };

  if (explicit.includes(normalized)) return { configured: true, inArea: true };
  const inRadius = zones.some((zone) => {
    try {
      const d = zipcodes.distance(zone.center_zip, normalized);
      return typeof d === 'number' && Number.isFinite(d) && d <= zone.radius_miles;
    } catch {
      return false;
    }
  });
  return { configured: true, inArea: inRadius };
}

/**
 * Human-readable service-area summary for the system prompt — semantic, not a
 * giant ZIP dump. e.g. "within 30 mi of 08820; plus ZIPs: 08820".
 */
export function describeServiceArea(operator: OperatorRow): string {
  const explicit = (operator.service_zip_codes ?? []) as string[];
  const zones = parseRadiusZones(operator.service_radius_zones);
  if (explicit.length === 0 && zones.length === 0) {
    return 'not configured — accept any address.';
  }
  const parts: string[] = [];
  if (zones.length > 0) {
    parts.push(zones.map((z) => `within ${z.radius_miles} mi of ${z.center_zip}`).join(' or '));
  }
  if (explicit.length > 0) {
    const list = explicit.length <= 12 ? explicit.join(', ') : `${explicit.slice(0, 12).join(', ')} +${explicit.length - 12} more`;
    parts.push(`ZIPs: ${list}`);
  }
  return parts.join('; ');
}

export function parseRadiusZones(raw: unknown): RadiusZone[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (
      entry == null ||
      typeof entry !== 'object' ||
      typeof (entry as { center_zip?: unknown }).center_zip !== 'string' ||
      typeof (entry as { radius_miles?: unknown }).radius_miles !== 'number'
    ) {
      return [];
    }
    const e = entry as { center_zip: string; radius_miles: number };
    return [{ center_zip: e.center_zip, radius_miles: e.radius_miles }];
  });
}
