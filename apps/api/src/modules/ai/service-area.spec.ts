import type { Tables } from '@bookingblues/db-types';

import { describeServiceArea, isZipInServiceArea } from './service-area';

function op(partial: Partial<Tables<'operators'>>): Tables<'operators'> {
  return { service_zip_codes: null, service_radius_zones: null, ...partial } as Tables<'operators'>;
}

describe('isZipInServiceArea', () => {
  it('treats a ZIP within a radius zone as in-area (the QA bug: 08821 in 30mi of 08820)', () => {
    const r = isZipInServiceArea(
      op({ service_radius_zones: [{ center_zip: '08820', radius_miles: 30 }] }),
      '08821',
    );
    expect(r).toEqual({ configured: true, inArea: true });
  });

  it('rejects a ZIP outside every radius zone', () => {
    // 90210 (Beverly Hills) is nowhere near Edison NJ.
    const r = isZipInServiceArea(
      op({ service_radius_zones: [{ center_zip: '08820', radius_miles: 30 }] }),
      '90210',
    );
    expect(r).toEqual({ configured: true, inArea: false });
  });

  it('matches an explicit ZIP', () => {
    const r = isZipInServiceArea(op({ service_zip_codes: ['08820'] }), '08820');
    expect(r).toEqual({ configured: true, inArea: true });
  });

  it('reports unconfigured as open coverage', () => {
    const r = isZipInServiceArea(op({}), '99999');
    expect(r).toEqual({ configured: false, inArea: true });
  });

  it('normalizes ZIP+4 to the 5-digit prefix', () => {
    const r = isZipInServiceArea(op({ service_zip_codes: ['08820'] }), '08820-1234');
    expect(r.inArea).toBe(true);
  });
});

describe('describeServiceArea', () => {
  it('describes a radius zone semantically', () => {
    expect(
      describeServiceArea(op({ service_radius_zones: [{ center_zip: '08820', radius_miles: 30 }] })),
    ).toMatch(/within 30 mi of 08820/);
  });
  it('reports not configured', () => {
    expect(describeServiceArea(op({}))).toMatch(/not configured/);
  });
});
