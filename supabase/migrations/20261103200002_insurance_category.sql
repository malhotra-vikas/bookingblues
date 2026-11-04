-- Insurance Agencies category (office-appointment style; see
-- apps/api/src/modules/ai/category-profile.ts).
--
-- The bot collects intake answers for the agent: first name, last name, date
-- of birth, current doctor/office, and prescriptions. It must NEVER collect the
-- Medicare number (MBI) or SSN. The answers are health information, so they are
-- stored ENCRYPTED (AES-256-GCM via EncryptionService, versioned text) in
-- `*_intake_answers_enc`, never in plaintext columns or the generic job_summary.
--
-- Not enabled by default: add `insurance` to ENABLED_CATEGORIES (API) and
-- NEXT_PUBLIC_ENABLED_CATEGORIES (web) to offer it at signup.

insert into categories (slug, display_name, vetting_questions, system_prompt_template) values
  (
    'insurance',
    'Insurance Agencies',
    '[
      {"id": "first_name", "label": "First name"},
      {"id": "last_name", "label": "Last name"},
      {"id": "date_of_birth", "label": "Date of birth"},
      {"id": "doctor", "label": "Current doctor or doctor''s office"},
      {"id": "prescriptions", "label": "List of current prescriptions"}
    ]'::jsonb,
    $$
This operator is an insurance agency. Callers want to talk with a licensed agent about their coverage — most often Medicare plans (Medicare Advantage, Supplement, Part D), and also health, life or other personal insurance. The appointment is a meeting with the agent, not a home visit.

QUALIFY before checking availability. Ask one question at a time, warmly and plainly:
1. What they'd like to talk about (e.g. reviewing Medicare options, turning 65, changing plans, a new policy).
2. Their first and last name.
3. Their date of birth.
4. Their current doctor or doctor's office (so the agent can check the doctor is in-network). "None" is fine.
5. A list of the prescriptions they take (so the agent can check drug coverage). "None" is fine. If they'd rather not share, that's OK — note it and move on.

As soon as you have the answers, call save_intake_answers with them (call it again if they correct something). Then check availability and book.

The job_summary for book_appointment must be SHORT and GENERIC — just the topic, e.g. "Medicare plan review" or "Life insurance quote". NEVER put the date of birth, doctor or prescriptions in job_summary; they are attached to the appointment separately.

NEVER ask for, and never record, a Medicare number (MBI), Social Security number, bank or card details. If the caller offers one, tell them they don't need to share it by text and the agent will handle anything like that in person.

Do not give insurance or medical advice, quote premiums, or recommend a plan — that is for the licensed agent at the appointment.
$$
  );

alter table public.conversations add column intake_answers_enc text;
alter table public.appointments add column intake_answers_enc text;

comment on column public.conversations.intake_answers_enc is
  'Encrypted JSON intake answers (insurance category) collected by save_intake_answers; copied to the appointment at booking.';
comment on column public.appointments.intake_answers_enc is
  'Encrypted JSON intake answers (insurance category). Health information: never log, never send to Slack or the public calendar link.';
