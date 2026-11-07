export type SessionUser = { id: string; name: string };

export const SESSION_COOKIE = 'ld_session';
export const SESSION_TTL = 30 * 24 * 3600;

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(str)) return null;
  try {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const hmacKey = (secret: string, usage: 'sign' | 'verify') =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);

export async function signSession(data: SessionUser, secret: string, ttlSec = SESSION_TTL): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = b64urlEncode(enc.encode(JSON.stringify({ id: data.id, name: data.name, exp })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(payload));
  return `${payload}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifySession(token: string, secret: string): Promise<SessionUser | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sigStr] = parts;
  const sig = b64urlDecode(sigStr);
  if (!sig) return null;
  // crypto.subtle.verify compares the MAC in constant time.
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), sig, enc.encode(payload));
  if (!ok) return null;
  const raw = b64urlDecode(payload);
  if (!raw) return null;
  try {
    const d = JSON.parse(new TextDecoder().decode(raw));
    if (typeof d.id !== 'string' || typeof d.name !== 'string' || typeof d.exp !== 'number') return null;
    if (d.exp <= Math.floor(Date.now() / 1000)) return null;
    return { id: d.id, name: d.name };
  } catch {
    return null;
  }
}
