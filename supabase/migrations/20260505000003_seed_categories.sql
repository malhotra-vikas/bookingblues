-- Seed the 5 launch categories per CLAUDE.md §16.
-- system_prompt_template is intentionally a placeholder — Slice 7
-- (AI + conversations) replaces these with production-grade prompts.

insert into categories (slug, display_name, vetting_questions, system_prompt_template) values
  (
    'plumbing',
    'Plumbing',
    '[
      {"id": "issue_type", "label": "What kind of plumbing issue is it?", "options": ["Leak", "Clog/Drain", "Water heater", "Fixture install", "Other"]},
      {"id": "urgency", "label": "Is water actively leaking right now?"},
      {"id": "address", "label": "Service address?"}
    ]'::jsonb,
    '[PLACEHOLDER plumbing system prompt — replaced in Slice 7]'
  ),
  (
    'hvac',
    'HVAC',
    '[
      {"id": "issue_type", "label": "Heating, cooling, or both?", "options": ["Heating", "Cooling", "Both"]},
      {"id": "system_age", "label": "How old is the system?"},
      {"id": "address", "label": "Service address?"}
    ]'::jsonb,
    '[PLACEHOLDER hvac system prompt — replaced in Slice 7]'
  ),
  (
    'electrical',
    'Electrical',
    '[
      {"id": "issue_type", "label": "What''s the electrical issue?", "options": ["Outlet/switch", "Panel/breaker", "Lighting", "New install", "Other"]},
      {"id": "safety", "label": "Any sparks, smell of burning, or no power to whole home?"},
      {"id": "address", "label": "Service address?"}
    ]'::jsonb,
    '[PLACEHOLDER electrical system prompt — replaced in Slice 7]'
  ),
  (
    'roofing',
    'Roofing',
    '[
      {"id": "issue_type", "label": "Repair, inspection, or replacement?", "options": ["Repair", "Inspection", "Replacement"]},
      {"id": "leak_active", "label": "Is there an active leak?"},
      {"id": "address", "label": "Service address?"}
    ]'::jsonb,
    '[PLACEHOLDER roofing system prompt — replaced in Slice 7]'
  ),
  (
    'garage_door',
    'Garage Door',
    '[
      {"id": "issue_type", "label": "What''s wrong with the garage door?", "options": ["Won''t open/close", "Spring/cable", "Opener motor", "New install", "Other"]},
      {"id": "stuck", "label": "Is the door currently stuck open or closed?"},
      {"id": "address", "label": "Service address?"}
    ]'::jsonb,
    '[PLACEHOLDER garage_door system prompt — replaced in Slice 7]'
  );
