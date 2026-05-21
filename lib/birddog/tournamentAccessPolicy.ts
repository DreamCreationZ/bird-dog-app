const BLOCKED_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com"
]);

export function emailDomainFromAddress(value: string | null | undefined) {
  const clean = String(value || "").trim().toLowerCase();
  const at = clean.lastIndexOf("@");
  if (at <= 0 || at === clean.length - 1) return "";
  return clean.slice(at + 1);
}

export function isGmailDomain(value: string | null | undefined) {
  const domain = emailDomainFromAddress(value);
  return BLOCKED_EMAIL_DOMAINS.has(domain);
}

export function isTournamentUnlockBlockedEmail(value: string | null | undefined) {
  return isGmailDomain(value);
}

