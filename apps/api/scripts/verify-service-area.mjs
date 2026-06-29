import { createClient } from '@supabase/supabase-js';
import zipcodes from 'zipcodes';

/**
 * Service-area diagnostic. Read-only.
 *   node scripts/verify-service-area.mjs <operator-email> [testZip]
 *
 * Shows the operator's explicit ZIPs + radius zones, the expanded coverage
 * count, and whether testZip is actually in range. Reads SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY from env.
 */
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const email = process.argv[2];
const testZip = process.argv[3] ?? null;
if (!email) {
  console.error('Usage: node scripts/verify-service-area.mjs <operator-email> [testZip]');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
const user = users?.users?.find((u) => u.email === email);
if (!user) {
  console.error(`No auth user for ${email}`);
  process.exit(1);
}
const { data: op } = await db
  .from('operators')
  .select('business_name, service_zip_codes, service_radius_zones')
  .eq('user_id', user.id)
  .maybeSingle();
if (!op) {
  console.error('No operator row');
  process.exit(1);
}

console.log(`\n${op.business_name}`);
console.log('service_zip_codes   :', JSON.stringify(op.service_zip_codes));
console.log('service_radius_zones:', JSON.stringify(op.service_radius_zones));

const explicit = op.service_zip_codes ?? [];
const zones = Array.isArray(op.service_radius_zones) ? op.service_radius_zones : [];
const radiusZips = zones.flatMap((z) => {
  try {
    const r = zipcodes.radius(z.center_zip, z.radius_miles);
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
});
const expanded = [...new Set([...explicit, ...radiusZips])];
console.log(`\nexpanded coverage: ${expanded.length} ZIPs`);

if (testZip) {
  const inExplicit = explicit.includes(testZip);
  const inRadius = zones.some((z) => {
    const d = zipcodes.distance(z.center_zip, testZip);
    return typeof d === 'number' && d <= z.radius_miles;
  });
  console.log(`\nZIP ${testZip}: ${inExplicit || inRadius ? '\x1b[32mIN AREA\x1b[0m' : '\x1b[31mOUT\x1b[0m'}` +
    ` (explicit=${inExplicit}, radius=${inRadius})`);
  for (const z of zones) {
    console.log(`  distance to ${z.center_zip}: ${zipcodes.distance(z.center_zip, testZip)} mi (zone ${z.radius_miles} mi)`);
  }
}
console.log('');
