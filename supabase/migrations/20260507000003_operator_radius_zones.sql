-- Service-area radius zones. Operator can express coverage as
--   "within X miles of center ZIP Y"
-- alongside (or instead of) the explicit operators.service_zip_codes list.
--
-- Stored as jsonb because the structure is small and bounded
-- (max ~20 zones per operator). Each entry:
--   { "center_zip": "90210", "radius_miles": 30 }
--
-- Expansion to the implied set of ZIPs happens at prompt-assembly time
-- (apps/api/src/modules/ai/prompts.ts) using the `zipcodes` npm package.
-- Keeps zone editing intuitive (operator can change the radius on a single
-- zone without re-saving the whole expanded list).
--
-- Future: when we add Slice 13.5-followup geocoding (option C), entries can
-- carry { "center_kind": "city", "center_value": "Pasadena, CA", "radius_miles": 30 }
-- alongside the ZIP form. Today only ZIP centers are supported.

alter table operators
  add column service_radius_zones jsonb not null default '[]'::jsonb;
