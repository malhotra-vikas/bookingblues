-- Full property/service address, collected from the caller AFTER the booking is
-- confirmed (post-payment) so the tech can actually find the job. Stored on the
-- appointment and patched onto the Google Calendar event's location.
alter table appointments
  add column if not exists service_address text;
