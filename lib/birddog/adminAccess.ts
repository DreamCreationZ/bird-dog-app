const PRIMARY_ADMIN_EMAIL = "admin@apointscout.com";
const SECONDARY_ADMIN_EMAIL = "ajay@apointscout.com";
const PRIVILEGED_ADMIN_EMAILS = [PRIMARY_ADMIN_EMAIL, SECONDARY_ADMIN_EMAIL] as const;

export function normalizeAdminEmail(value: string) {
  return String(value || "").trim().toLowerCase();
}

export function privilegedAdminEmails() {
  return PRIVILEGED_ADMIN_EMAILS;
}

export function isPrivilegedAdminEmail(value: string) {
  const normalized = normalizeAdminEmail(value);
  return PRIVILEGED_ADMIN_EMAILS.includes(normalized as (typeof PRIVILEGED_ADMIN_EMAILS)[number]);
}

export function adminUserIdFromEmail(value: string) {
  const normalized = normalizeAdminEmail(value);
  if (normalized === PRIMARY_ADMIN_EMAIL) {
    return "u_admin_apointscout";
  }
  const safe = normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `u_admin_${safe || "user"}`;
}

export const AJAY_ADMIN_EMAIL = SECONDARY_ADMIN_EMAIL;
