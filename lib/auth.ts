/**
 * HTTP Basic Auth for the single-tenant admin. Pure + runtime-agnostic so it
 * works in both the Edge middleware and Node route handlers.
 */
export function checkBasicAuth(authHeader: string | null | undefined): boolean {
  const user = process.env.ADMIN_USERNAME;
  const pass = process.env.ADMIN_PASSWORD;
  if (!user || !pass) return false;
  if (!authHeader || !authHeader.startsWith("Basic ")) return false;

  let decoded: string;
  try {
    decoded = atob(authHeader.slice(6).trim());
  } catch {
    return false;
  }

  const sep = decoded.indexOf(":");
  if (sep === -1) return false;
  const u = decoded.slice(0, sep);
  const p = decoded.slice(sep + 1);
  return safeEqual(u, user) && safeEqual(p, pass);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
