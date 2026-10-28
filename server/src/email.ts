/**
 * Email delivery boundary.
 *
 * ReadyForge never claims an email was sent unless a provider actually
 * accepted it. This module is the single place a real provider (SMTP, SES,
 * Postmark, …) must be wired in; until then every call reports
 * `delivered: false` with a reason, and the API surfaces an explicit
 * development-only fallback (returning the link to the caller) instead of
 * pretending delivery happened.
 *
 * Configuration (documented in docs/AI_PROVIDERS.md and docs/SECURITY.md):
 *   EMAIL_PROVIDER=   — reserved for a future provider id (smtp, …)
 *   SMTP_URL=         — reserved; no provider is bundled yet (no extra deps)
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface DeliveryResult {
  delivered: boolean;
  /** Why delivery did not happen — safe to show to developers. */
  reason?: string;
  provider: 'none';
}

export function isEmailConfigured(): boolean {
  // No provider adapter ships yet; keep the check explicit so flipping it on
  // is a one-line change in exactly one place.
  return Boolean(process.env.EMAIL_PROVIDER && process.env.SMTP_URL);
}

export async function sendEmail(message: EmailMessage): Promise<DeliveryResult> {
  if (!isEmailConfigured()) {
    return {
      delivered: false,
      provider: 'none',
      reason: 'No email provider configured (set EMAIL_PROVIDER and SMTP_URL).',
    };
  }
  // A real provider adapter would send here. We never report success without
  // performing the send.
  void message;
  return { delivered: false, provider: 'none', reason: 'Email provider adapter not implemented.' };
}