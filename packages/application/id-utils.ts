/**
 * UUID coercion for the `uuid` columns.
 *
 * This used to be a private helper in `server.ts`, so the rule for turning a
 * caller-supplied id into a uuid was only reachable by booting the whole server
 * and could not be shared with the application layer. It is here now, moved
 * verbatim, so the HTTP routes and the conversation service derive ids the
 * same way instead of each having their own idea of what a valid uuid is.
 *
 * Non-UUID input is md5-hashed into a *stable* uuid rather than rejected, so an
 * in-memory id such as `th-tw-1732567890000` keeps resolving to the same row
 * after a restart instead of quietly becoming a different customer.
 */
import crypto from 'crypto';

// UUID validation and deterministic mapping helper for Postgres UUID fields
function isValidUuid(id: any): boolean {
  if (typeof id !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export function toUuid(input: string): string {
  if (!input) return crypto.randomUUID ? crypto.randomUUID() : '00000000-0000-0000-0000-000000000000';
  if (isValidUuid(input)) return input;
  const hash = crypto.createHash('md5').update('ridgeline:' + String(input)).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}
