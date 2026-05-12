import { vanitySlugs } from './vanity-slugs';

describe('vanitySlugs', () => {
  it('picks the first distinctive token from a multi-word name', () => {
    expect(vanitySlugs({ businessName: 'Zeus Electrical', category: 'electrical' })).toEqual([
      'ZEUS',
      'ELECTRI', // full first 7 of "electrical"
      'ELEC',    // 4-char prefix of "electrical" + category fallback collide; dedup keeps one
      'AMP',
    ]);
  });

  it('drops stopwords ("The") and suffixes ("LLC", "Inc")', () => {
    const slugs = vanitySlugs({
      businessName: 'The Best Plumbing, LLC',
      category: 'plumbing',
    });
    expect(slugs).toContain('BEST');
    expect(slugs).not.toContain('THE');
    expect(slugs).not.toContain('LLC');
    expect(slugs).toContain('PLUMB');
  });

  it('falls back to category-only when business name is missing', () => {
    expect(vanitySlugs({ businessName: null, category: 'hvac' })).toEqual([
      'HVAC',
      'COOL',
      'HEAT',
      'FAST',
    ]);
  });

  it('returns empty when both inputs are absent', () => {
    expect(vanitySlugs({ businessName: null, category: null })).toEqual([]);
    expect(vanitySlugs({ businessName: '', category: undefined })).toEqual([]);
  });

  it('strips non-alpha (apostrophes, ampersands, digits)', () => {
    const slugs = vanitySlugs({
      businessName: "Joe's 24/7 Plumb & Drain",
      category: 'plumbing',
    });
    // "joe" is 3 chars (MIN_LEN), so kept; "s" alone drops below min.
    expect(slugs).toContain('JOE');
    // We don't want bare digits in the slug list.
    expect(slugs.every((s) => /^[A-Z]+$/.test(s))).toBe(true);
  });

  it('respects the max parameter', () => {
    const slugs = vanitySlugs({
      businessName: 'Acme Garage Door and Repair',
      category: 'garage_door',
      max: 2,
    });
    expect(slugs).toHaveLength(2);
  });

  it('caps each slug at 7 chars (Twilio Contains limit)', () => {
    const slugs = vanitySlugs({
      businessName: 'Northwestern Plumbing Specialists',
      category: 'plumbing',
    });
    for (const s of slugs) {
      expect(s.length).toBeLessThanOrEqual(7);
      expect(s.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('deduplicates when business and category produce the same slug', () => {
    const slugs = vanitySlugs({ businessName: 'Plumb Pros', category: 'plumbing' });
    const counts = new Map<string, number>();
    for (const s of slugs) counts.set(s, (counts.get(s) ?? 0) + 1);
    for (const [, n] of counts) expect(n).toBe(1);
  });

  it('handles a single-word business name', () => {
    expect(vanitySlugs({ businessName: 'Speedwrench', category: null })).toEqual([
      'SPEEDWR', // first 7
      'SPEE',    // 4-char prefix
    ]);
  });
});
