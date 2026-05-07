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
