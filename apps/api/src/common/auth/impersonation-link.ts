/**
 * Build the "Login as" link for an admin-generated magic link (impersonation,
 * #4 + admin §8). We point at the web app's /auth/confirm route — which calls
 * `verifyOtp({ token_hash })` to establish the session — rather than handing back
 * Supabase's raw action_link, whose redirect lands on the app WITHOUT exchanging
 * the session (the app uses PKCE, and these links carry no browser code_verifier).
 *
 * @param appUrl     Public web app URL (`Env.APP_URL`).
 * @param hashedToken `data.properties.hashed_token` from `generateLink`.
 */
export function impersonationConfirmLink(appUrl: string, hashedToken: string): string {
  const next = encodeURIComponent('/dashboard?impersonating=1');
  return `${appUrl}/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}&type=magiclink&next=${next}`;
}
