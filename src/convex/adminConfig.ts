/**
 * Administrative identity for Royalmarket.
 *
 * One mailbox owns the marketplace administration: it is the address shown as
 * the public contact, the address allowed to claim the first admin seat, and
 * the only address that may keep admin authority after a desk transfer.
 *
 * `RETIRED_ADMIN_EMAILS` lists addresses that used to own the seat. They are
 * explicitly rejected by `claimAdmin` and ignored by `requireAdmin`, so a stale
 * `role: "admin"` on an old mailbox cannot act even if it survives in the
 * database. `admin:enforceAdminEmail` clears those rows for good.
 */

export const ADMIN_EMAIL = "royalmarketbusiness@gmail.com";

export const RETIRED_ADMIN_EMAILS: readonly string[] = ["myrayalmarket@gmail.com"];

/** Emails are compared case-insensitively and without surrounding space. */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** True only for the mailbox that owns marketplace administration. */
export function isAdminEmail(email: string | null | undefined): boolean {
  return normalizeEmail(email) === ADMIN_EMAIL;
}

/** True for addresses that are no longer allowed to administer the site. */
export function isRetiredAdminEmail(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  return normalized !== "" && RETIRED_ADMIN_EMAILS.includes(normalized);
}
