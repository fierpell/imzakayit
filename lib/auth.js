import crypto from 'node:crypto';

const SESSION_COOKIE_NAME = 'sozlesme_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 gün

/**
 * Üst düzey kriptografik olarak güvenli rastgele token üretir.
 * @param {number} byteLength
 * @returns {string}
 */
export function generateToken(byteLength = 24) {
  return crypto.randomBytes(byteLength).toString('base64url');
}

/**
 * 6 haneli tek kullanımlık/doğrulama PIN kodu üretir.
 * @returns {string}
 */
export function generatePin() {
  return String(crypto.randomInt(100000, 1000000));
}

/**
 * İki metni zamanlama saldırılarına karşı sabit sürede karşılaştırır.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Parolayı tuzlanmış scrypt ile özetler.
 * @param {string} password
 * @returns {string}
 */
export function hashSecret(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

/**
 * Parolayı saklanan scrypt özetiyle doğrular.
 * @param {string} password
 * @param {string} stored
 * @returns {boolean}
 */
export function verifySecret(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const derivedHex = crypto.scryptSync(password, salt, 64).toString('hex');
  return safeCompare(derivedHex, expectedHex);
}

/**
 * Cookie başlığını ayrıştırır.
 * @param {string|undefined} cookieHeader
 * @returns {Record<string, string>}
 */
export function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(val);
    } catch {
      cookies[key] = val;
    }
  }
  return cookies;
}

/**
 * HMAC-SHA256 imzalı oturum tokeni oluşturur.
 * @param {string} secret
 * @returns {string}
 */
export function signSessionToken(secret) {
  const payload = {
    role: 'admin',
    exp: Date.now() + SESSION_TTL_MS,
    jti: crypto.randomBytes(8).toString('hex')
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

/**
 * İstek çerezindeki oturumu doğrular.
 * @param {import('node:http').IncomingMessage} req
 * @param {string} secret
 * @returns {boolean}
 */
export function isAdminAuthenticated(req, secret) {
  if (!secret) return false;
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[SESSION_COOKIE_NAME];
  if (!raw) return false;
  const dotIdx = raw.indexOf('.');
  if (dotIdx === -1) return false;
  const encoded = raw.slice(0, dotIdx);
  const sig = raw.slice(dotIdx + 1);
  if (!encoded || !sig) return false;

  const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  if (!safeCompare(sig, expectedSig)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (payload?.role !== 'admin') return false;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Set-Cookie başlık değerini oluşturur.
 * @param {import('node:http').IncomingMessage} req
 * @param {string} token
 * @returns {string}
 */
export function buildSessionCookie(req, token) {
  const isHttps = req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket?.encrypted);
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`
  ];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Oturum temizleme çerezi döndürür.
 * @returns {string}
 */
export function buildClearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/**
 * Basit kayan pencere hız sınırlayıcı (rate limiter).
 */
export class RateLimiter {
  constructor(windowMs = 60_000, maxAttempts = 15) {
    this.windowMs = windowMs;
    this.maxAttempts = maxAttempts;
    this.buckets = new Map();
  }

  /**
   * @param {string} key
   * @returns {{ allowed: boolean, retryAfterSec: number }}
   */
  check(key) {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const entries = (this.buckets.get(key) || []).filter((ts) => ts > cutoff);

    if (entries.length >= this.maxAttempts) {
      const oldest = entries[0];
      const retryAfterSec = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      this.buckets.set(key, entries);
      return { allowed: false, retryAfterSec };
    }

    entries.push(now);
    this.buckets.set(key, entries);

    // Bellek sızıntısını önlemek için periyodik temizlik
    if (this.buckets.size > 2000) {
      for (const [k, times] of this.buckets.entries()) {
        const active = times.filter((ts) => ts > cutoff);
        if (active.length === 0) this.buckets.delete(k);
        else this.buckets.set(k, active);
      }
    }

    return { allowed: true, retryAfterSec: 0 };
  }
}

