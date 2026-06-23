-- 20260623000001_sms_consents_nullable_name.sql
--
-- Verbal (inbound-call/IVR) opt-ins are now recorded in public.sms_consents
-- alongside web-form opt-ins (source = 'voice_ivr'). A verbal opt-in has no
-- name — the caller affirms by pressing 1 or saying "yes" — so `name` must be
-- nullable. Web-form rows still always carry a name (enforced by the API DTO).

alter table public.sms_consents alter column name drop not null;
