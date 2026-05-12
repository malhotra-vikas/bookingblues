# Supabase Auth — branded email templates

Where these go: **Supabase Dashboard → Authentication → Email Templates**.
Each template has a Subject + HTML body. Variables like `{{ .ConfirmationURL }}`
are substituted server-side by Supabase Auth — leave them as-is.

The default templates look like Supabase signed the user up, not BookingBlues
(see screenshot 2026-05-12). That kills first-impression trust. These
replacements use the BookingBlues brand and explain the next step in plain
contractor-friendly English.

> **Heads-up:** the default `noreply@mail.app.supabase.io` sender is what most
> tells users this isn't BookingBlues. To fix it properly, also configure
> **Custom SMTP** in **Project Settings → Auth → SMTP Settings** with
> Resend (we already have a `RESEND_API_KEY`). Until that's done, the
> templates below land from the Supabase sender — copy is improved but the
> address still reads `noreply@mail.app.supabase.io`. See "Custom SMTP" at
> the bottom.

---

## 1. Confirm signup

**Subject:**
```
Confirm your BookingBlues account — last step
```

**Body (HTML):**
```html
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f8fafc;padding:32px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <tr>
    <td align="center">
      <table width="540" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;padding:36px 32px;">
        <tr>
          <td style="font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#0b5cd6;padding-bottom:14px;">
            BookingBlues
          </td>
        </tr>
        <tr>
          <td style="font-size:22px;font-weight:600;color:#0f172a;line-height:1.3;padding-bottom:14px;">
            One last click to start your free trial
          </td>
        </tr>
        <tr>
          <td style="font-size:15px;color:#475569;line-height:1.6;padding-bottom:24px;">
            Hey — thanks for signing up for BookingBlues. Click the button below to confirm your email and start your 7-day free trial. You won't be charged until day 8.
          </td>
        </tr>
        <tr>
          <td align="center" style="padding-bottom:26px;">
            <a href="{{ .ConfirmationURL }}"
               style="background:#0b5cd6;color:#ffffff;text-decoration:none;display:inline-block;padding:14px 28px;border-radius:8px;font-weight:500;font-size:15px;">
              Confirm email & start trial
            </a>
          </td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#64748b;line-height:1.6;padding-bottom:20px;border-top:1px solid #e2e8f0;padding-top:20px;">
            <strong style="color:#0f172a;">What's next:</strong>
            <ol style="padding-left:18px;margin:8px 0;">
              <li>Pick your trade (plumbing, HVAC, electrical, roofing, garage door)</li>
              <li>Get your BookingBlues phone number</li>
              <li>Connect Google Calendar</li>
              <li>Forward your missed calls — we handle the rest</li>
            </ol>
            Most contractors finish setup in under 10 minutes.
          </td>
        </tr>
        <tr>
          <td style="font-size:12px;color:#94a3b8;line-height:1.5;padding-top:6px;">
            Didn't sign up? You can safely ignore this — no account will be created without your confirmation. Questions? Reply to this email.
          </td>
        </tr>
      </table>
      <table width="540" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:16px;">
        <tr>
          <td align="center" style="font-size:11px;color:#94a3b8;">
            BookingBlues · We text back missed calls so you stop losing jobs to voicemail.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

---

## 2. Magic Link (used by admin impersonation in Slice 15)

**Subject:**
```
Your BookingBlues sign-in link
```

**Body:**
```html
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f8fafc;padding:32px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <tr><td align="center">
    <table width="540" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;padding:36px 32px;">
      <tr><td style="font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#0b5cd6;padding-bottom:14px;">BookingBlues</td></tr>
      <tr><td style="font-size:22px;font-weight:600;color:#0f172a;line-height:1.3;padding-bottom:14px;">Your sign-in link</td></tr>
      <tr><td style="font-size:15px;color:#475569;line-height:1.6;padding-bottom:24px;">
        Click below to sign in. Link expires in 60 minutes and can only be used once.
      </td></tr>
      <tr><td align="center" style="padding-bottom:24px;">
        <a href="{{ .ConfirmationURL }}" style="background:#0b5cd6;color:#ffffff;text-decoration:none;display:inline-block;padding:14px 28px;border-radius:8px;font-weight:500;font-size:15px;">Sign me in</a>
      </td></tr>
      <tr><td style="font-size:12px;color:#94a3b8;line-height:1.5;padding-top:6px;border-top:1px solid #e2e8f0;padding-top:18px;">
        Didn't request this? Ignore the email. Anyone with the link can sign in as you, so don't share it.
      </td></tr>
    </table>
  </td></tr>
</table>
```

---

## 3. Reset Password

**Subject:**
```
Reset your BookingBlues password
```

Same shell as the magic link template — swap headline to "Reset your password" and body copy to "We got a request to reset your BookingBlues password. Click below to choose a new one. If you didn't request this, you can safely ignore this email."

---

## Custom SMTP (Resend)

Default Supabase Auth sender = `noreply@mail.app.supabase.io`. To send from
`hello@bookingblues.com` (or whatever brand mailbox you own):

1. **Dashboard → Project Settings → Auth → SMTP Settings → "Enable Custom SMTP"**
2. Fill in:
   - **Host**: `smtp.resend.com`
   - **Port**: `465` (SSL) or `587` (TLS)
   - **Username**: `resend`
   - **Password**: a Resend API key — same value as `RESEND_API_KEY` in our
     env. Generate at https://resend.com/api-keys with at-least `Sending`
     scope.
   - **Sender name**: `BookingBlues`
   - **Sender email**: an address on a domain you've verified in Resend
     (e.g. `hello@bookingblues.com`). Don't use a `@gmail.com` address —
     deliverability will tank.
3. Hit **Save**.
4. Send a test signup. The "From" header should now read
   `BookingBlues <hello@bookingblues.com>`, the footer line about
   "powered by Supabase" disappears, and the templates above render with
   the new sender.

Failure mode to watch for: if Resend rejects your sender (unverified domain),
Supabase silently retries with the default sender and the user sees the old
Supabase-branded email. Verify the domain in Resend *first*.
