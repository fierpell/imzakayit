import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RateLimiter,
  buildClearSessionCookie,
  buildSessionCookie,
  isAdminAuthenticated,
  signSessionToken
} from './lib/auth.js';
import { NotificationCenter } from './lib/notifications.js';
import { Storage } from './lib/storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 1_200_000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  setSecurityHeaders(res);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('PAYLOAD_TOO_LARGE'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error('INVALID_JSON'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

async function serveFile(res, filePath, method = 'GET') {
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    setSecurityHeaders(res);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300'
    });
    if (method === 'HEAD') {
      return res.end();
    }
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      sendJson(res, 404, { error: 'Sayfa veya dosya bulunamadı.' });
    } else {
      sendJson(res, 500, { error: 'Dosya okunurken hata oluştu.' });
    }
  }
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'bilinmiyor';
}

function getBaseUrl(req) {
  const protoHeader = req.headers['x-forwarded-proto'];
  const proto = protoHeader === 'https' || req.socket?.encrypted ? 'https' : 'http';
  const rawHost = String(req.headers.host || 'localhost:3000').trim();
  const safeHost = /^[a-zA-Z0-9.-]+(:\d+)?$/.test(rawHost) ? rawHost : 'localhost:3000';
  return `${proto}://${safeHost}`;
}

function validateContractPayload(body) {
  const title = String(body.title || '').trim();
  const creatorName = String(body.creatorName || '').trim();
  const recipientName = String(body.recipientName || '').trim();
  const text = String(body.body || '').trim();

  if (title.length < 3 || title.length > 200) {
    return 'Sözleşme başlığı 3 ile 200 karakter arasında olmalıdır.';
  }
  if (creatorName.length < 2 || creatorName.length > 120) {
    return 'Düzenleyen taraf adı 2 ile 120 karakter arasında olmalıdır.';
  }
  if (recipientName.length > 120) {
    return 'Karşı taraf adı en fazla 120 karakter olabilir.';
  }
  if (text.length < 10 || text.length > 50_000) {
    return 'Sözleşme metni 10 ile 50.000 karakter arasında olmalıdır.';
  }
  return null;
}

/**
 * Uygulamayı başlatır ve HTTP sunucusu ile servisleri döndürür.
 * @param {{ dataDir?: string }} options
 */
export async function createApp(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(__dirname, 'data');
  const storage = new Storage(dataDir);
  await storage.init();

  const notifications = new NotificationCenter(storage);
  const authLimiter = new RateLimiter(60_000, 12);
  const signLimiter = new RateLimiter(60_000, 10);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const pathname = url.pathname;
      const method = req.method || 'GET';

      // --- Sayfa Rotaları ---
      const isGetOrHead = method === 'GET' || method === 'HEAD';
      if (isGetOrHead && pathname === '/') {
        return await serveFile(res, path.join(PUBLIC_DIR, 'index.html'), method);
      }
      if (isGetOrHead && /^\/imza\/[A-Za-z0-9_-]+$/.test(pathname)) {
        return await serveFile(res, path.join(PUBLIC_DIR, 'sign.html'), method);
      }
      if (isGetOrHead && /^\/arsiv\/[A-Za-z0-9_-]+$/.test(pathname)) {
        return await serveFile(res, path.join(PUBLIC_DIR, 'archive.html'), method);
      }
      if (isGetOrHead && pathname === '/dogrula') {
        return await serveFile(res, path.join(PUBLIC_DIR, 'verify.html'), method);
      }

      // --- Statik Dosyalar ---
      if (isGetOrHead && !pathname.startsWith('/api/')) {
        const safeRel = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
        const resolved = path.resolve(PUBLIC_DIR, `.${safeRel.startsWith(path.sep) ? '' : path.sep}${safeRel}`);
        if (resolved.startsWith(PUBLIC_DIR + path.sep)) {
          return await serveFile(res, resolved, method);
        }
        return sendJson(res, 403, { error: 'Erişim reddedildi.' });
      }

      // --- Kimlik Doğrulama & Kurulum API'leri ---
      if (method === 'GET' && pathname === '/api/admin/status') {
        const initialized = storage.isInitialized();
        const authenticated = initialized && isAdminAuthenticated(req, storage.getSessionSecret());
        return sendJson(res, 200, { initialized, authenticated });
      }

      if (method === 'POST' && pathname === '/api/admin/setup') {
        if (storage.isInitialized()) {
          return sendJson(res, 409, { error: 'Yönetici şifresi zaten oluşturulmuş.' });
        }
        const body = await readJsonBody(req);
        const password = String(body.password || '');
        if (password.length < 4 || password.length > 128) {
          return sendJson(res, 400, { error: 'Şifre en az 4 karakter olmalıdır.' });
        }
        await storage.setupAdminPassword(password);
        const token = signSessionToken(storage.getSessionSecret());
        return sendJson(
          res,
          201,
          { ok: true },
          { 'Set-Cookie': buildSessionCookie(req, token) }
        );
      }

      if (method === 'POST' && pathname === '/api/admin/login') {
        const ip = getClientIp(req);
        const limit = authLimiter.check(`login:${ip}`);
        if (!limit.allowed) {
          return sendJson(res, 429, {
            error: `Çok fazla deneme yapıldı. ${limit.retryAfterSec} saniye sonra tekrar deneyin.`
          });
        }
        if (!storage.isInitialized()) {
          return sendJson(res, 400, { error: 'Önce yönetici şifresi belirlemelisiniz.' });
        }
        const body = await readJsonBody(req);
        const password = String(body.password || '');
        if (!storage.verifyAdminPassword(password)) {
          return sendJson(res, 401, { error: 'Hatalı yönetici şifresi.' });
        }
        const token = signSessionToken(storage.getSessionSecret());
        return sendJson(
          res,
          200,
          { ok: true },
          { 'Set-Cookie': buildSessionCookie(req, token) }
        );
      }

      if (method === 'POST' && pathname === '/api/admin/logout') {
        return sendJson(
          res,
          200,
          { ok: true },
          { 'Set-Cookie': buildClearSessionCookie() }
        );
      }

      // --- Korumalı Yönetici API'leri ---
      if (pathname.startsWith('/api/admin/')) {
        if (!storage.isInitialized() || !isAdminAuthenticated(req, storage.getSessionSecret())) {
          return sendJson(res, 401, { error: 'Oturum açmanız gerekiyor.' });
        }

        if (method === 'GET' && pathname === '/api/admin/events') {
          setSecurityHeaders(res);
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive'
          });
          res.write('event: ready\ndata: {"ok":true}\n\n');
          notifications.addClient(res);
          return;
        }

        if (method === 'GET' && pathname === '/api/admin/contracts') {
          return sendJson(res, 200, {
            contracts: storage.listContracts(),
            notifications: storage.listNotifications()
          });
        }

        if (method === 'POST' && pathname === '/api/admin/contracts') {
          const body = await readJsonBody(req);
          const validationError = validateContractPayload(body);
          if (validationError) return sendJson(res, 400, { error: validationError });

          const contract = await storage.createContract({
            title: body.title,
            creatorName: body.creatorName,
            recipientName: body.recipientName,
            body: body.body,
            requirePin: Boolean(body.requirePin),
            autoBurnAfterSign: body.autoBurnAfterSign !== false
          });
          return sendJson(res, 201, { contract });
        }

        const contractIdMatch = pathname.match(/^\/api\/admin\/contracts\/([^/]+)$/);
        if (contractIdMatch) {
          const id = decodeURIComponent(contractIdMatch[1]);
          if (method === 'PUT') {
            const body = await readJsonBody(req);
            const validationError = validateContractPayload(body);
            if (validationError) return sendJson(res, 400, { error: validationError });

            const result = await storage.updateContract(id, {
              title: body.title,
              creatorName: body.creatorName,
              recipientName: body.recipientName,
              body: body.body,
              requirePin: Boolean(body.requirePin),
              regeneratePin: Boolean(body.regeneratePin),
              autoBurnAfterSign: body.autoBurnAfterSign !== false
            });
            if (result.error === 'NOT_FOUND') {
              return sendJson(res, 404, { error: 'Sözleşme bulunamadı.' });
            }
            if (result.error === 'IMMUTABLE_SIGNED') {
              return sendJson(res, 409, { error: 'İmzalanmış belgeler sonradan değiştirilemez.' });
            }
            return sendJson(res, 200, { contract: result.contract });
          }

          if (method === 'DELETE') {
            const result = await storage.deleteContract(id);
            if (result.error === 'NOT_FOUND') {
              return sendJson(res, 404, { error: 'Sözleşme bulunamadı.' });
            }
            return sendJson(res, 200, { ok: true });
          }
        }

        const revokeMatch = pathname.match(/^\/api\/admin\/contracts\/([^/]+)\/revoke$/);
        if (method === 'POST' && revokeMatch) {
          const id = decodeURIComponent(revokeMatch[1]);
          const result = await storage.revokeContract(id);
          if (result.error === 'NOT_FOUND') {
            return sendJson(res, 404, { error: 'Sözleşme bulunamadı.' });
          }
          if (result.error === 'IMMUTABLE_SIGNED') {
            return sendJson(res, 409, { error: 'İmzalanmış sözleşme iptal edilemez.' });
          }
          return sendJson(res, 200, { contract: result.contract });
        }

        if (method === 'GET' && pathname === '/api/admin/settings') {
          return sendJson(res, 200, { settings: storage.getSettings() });
        }

        if (method === 'PUT' && pathname === '/api/admin/settings') {
          const body = await readJsonBody(req);
          if (body.webhookUrl) {
            try {
              const parsed = new URL(String(body.webhookUrl).trim());
              if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return sendJson(res, 400, { error: 'Webhook URL http:// veya https:// ile başlamalıdır.' });
              }
            } catch {
              return sendJson(res, 400, { error: 'Geçerli bir Webhook URL girin.' });
            }
          }
          const settings = await storage.updateSettings(body);
          return sendJson(res, 200, { settings });
        }

        if (method === 'POST' && pathname === '/api/admin/settings/test') {
          const testResult = await notifications.sendTest(getBaseUrl(req));
          return sendJson(res, 200, testResult);
        }

        return sendJson(res, 404, { error: 'Yönetici API uç noktası bulunamadı.' });
      }

      // --- Genel İmzalama API'leri ---
      const signGetMatch = pathname.match(/^\/api\/sign\/([A-Za-z0-9_-]+)$/);
      if (method === 'GET' && signGetMatch) {
        const token = signGetMatch[1];
        const existing = storage.findByToken(token);
        if (!existing) {
          return sendJson(res, 404, { error: 'Geçersiz veya silinmiş imza bağlantısı.' });
        }

        let contract = existing;
        if (existing.status === 'pending' || existing.status === 'viewed') {
          const viewRes = await storage.recordView(token);
          if (viewRes.contract) {
            contract = viewRes.contract;
            if (viewRes.isFirstOpen) {
              notifications
                .notify({
                  type: 'contract.opened',
                  contract,
                  baseUrl: getBaseUrl(req)
                })
                .catch(() => {});
            }
          }
        }

        if (contract.status === 'signed' && contract.autoBurnAfterSign !== false) {
          return sendJson(res, 200, {
            contract: {
              id: contract.id,
              token: contract.token,
              title: contract.title,
              creatorName: contract.creatorName,
              status: 'signed',
              burned: true,
              signedAt: contract.signature?.signedAt || null
            }
          });
        }

        return sendJson(res, 200, {
          contract: {
            id: contract.id,
            token: contract.token,
            title: contract.title,
            creatorName: contract.creatorName,
            recipientName: contract.recipientName,
            body: contract.body,
            requirePin: contract.requirePin,
            autoBurnAfterSign: contract.autoBurnAfterSign !== false,
            status: contract.status,
            createdAt: contract.createdAt,
            signedAt: contract.signature?.signedAt || null,
            signerName: contract.signature?.signerName || null,
            documentHash: contract.signature?.documentHash || null
          }
        });
      }

      const signSubmitMatch = pathname.match(/^\/api\/sign\/([A-Za-z0-9_-]+)\/submit$/);
      if (method === 'POST' && signSubmitMatch) {
        const token = signSubmitMatch[1];
        const ip = getClientIp(req);
        const limit = signLimiter.check(`sign:${ip}:${token}`);
        if (!limit.allowed) {
          return sendJson(res, 429, {
            error: `Çok fazla deneme yapıldı. ${limit.retryAfterSec} saniye sonra tekrar deneyin.`
          });
        }

        const body = await readJsonBody(req);
        const result = await storage.signContract(token, {
          signerName: body.signerName,
          signerContact: body.signerContact,
          pinInput: body.pinCode,
          signatureType: body.signatureType,
          imageDataUrl: body.imageDataUrl,
          typedSignature: body.typedSignature,
          consentChecked: Boolean(body.consentChecked),
          ipAddress: ip,
          userAgent: req.headers['user-agent'] || ''
        });

        if (result.error === 'NOT_FOUND') {
          return sendJson(res, 404, { error: 'Sözleşme bulunamadı.' });
        }
        if (result.error === 'REVOKED') {
          return sendJson(res, 410, { error: 'Bu imza bağlantısı iptal edilmiştir.' });
        }
        if (result.error === 'ALREADY_SIGNED') {
          return sendJson(res, 409, { error: 'Bu sözleşme daha önce imzalanmıştır.' });
        }
        if (result.error === 'CONSENT_REQUIRED') {
          return sendJson(res, 400, { error: 'Devam etmek için onay kutucuğunu işaretlemelisiniz.' });
        }
        if (result.error === 'INVALID_PIN') {
          return sendJson(res, 403, { error: '6 haneli onay kodu hatalı.' });
        }
        if (result.error === 'INVALID_NAME') {
          return sendJson(res, 400, { error: 'Lütfen geçerli bir Ad Soyad girin.' });
        }
        if (result.error === 'INVALID_SIGNATURE') {
          return sendJson(res, 400, { error: 'Lütfen imza alanına geçerli bir imza atın.' });
        }

        const contract = result.contract;
        await notifications.notify({
          type: 'contract.signed',
          contract,
          baseUrl: getBaseUrl(req)
        });

        return sendJson(res, 200, {
          ok: true,
          archiveUrl: `/arsiv/${contract.token}`,
          documentHash: contract.signature.documentHash,
          signedAt: contract.signature.signedAt
        });
      }

      // --- Arşiv API'leri ---
      const archiveDownloadMatch = pathname.match(/^\/api\/archive\/([A-Za-z0-9_-]+)\/download$/);
      if (method === 'GET' && archiveDownloadMatch) {
        const token = archiveDownloadMatch[1];
        const contract = storage.findByToken(token);
        if (!contract) return sendJson(res, 404, { error: 'Belge bulunamadı.' });
        if (contract.status !== 'signed') {
          return sendJson(res, 409, { error: 'Belge henüz imzalanmamış.' });
        }
        const html = await storage.readArchiveHtml(token);
        setSecurityHeaders(res);
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="${contract.id}-imzali-belge.html"`,
          'Cache-Control': 'no-store'
        });
        return res.end(html);
      }

      const archiveJsonMatch = pathname.match(/^\/api\/archive\/([A-Za-z0-9_-]+)$/);
      if (method === 'GET' && archiveJsonMatch) {
        const token = archiveJsonMatch[1];
        const contract = storage.findByToken(token);
        if (!contract) return sendJson(res, 404, { error: 'Belge bulunamadı.' });
        if (contract.status !== 'signed') {
          return sendJson(res, 409, { error: 'Belge henüz imzalanmamış.' });
        }
        return sendJson(res, 200, {
          archive: {
            id: contract.id,
            token: contract.token,
            title: contract.title,
            creatorName: contract.creatorName,
            recipientName: contract.recipientName,
            body: contract.body,
            createdAt: contract.createdAt,
            firstViewedAt: contract.firstViewedAt,
            signature: contract.signature
          }
        });
      }

      // --- Doğrulama API ---
      if (method === 'POST' && pathname === '/api/verify') {
        const body = await readJsonBody(req);
        if (!body.documentId && !body.hash) {
          return sendJson(res, 400, { error: 'Belge No veya SHA-256 özeti girin.' });
        }
        const result = storage.verifyDocument({
          documentId: body.documentId,
          hash: body.hash
        });
        return sendJson(res, 200, result);
      }

      return sendJson(res, 404, { error: 'Bulunamadı.' });
    } catch (err) {
      if (err?.statusCode === 413) {
        return sendJson(res, 413, { error: 'Gönderilen veri boyutu sınırı aşıyor.' });
      }
      if (err?.statusCode === 400) {
        return sendJson(res, 400, { error: 'Geçersiz JSON verisi.' });
      }
      return sendJson(res, 500, { error: 'Beklenmeyen bir sunucu hatası oluştu.' });
    }
  });

  return { server, storage, notifications };
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const { server } = await createApp();
  server.listen(port, host, () => {
    console.log(`Sözleşme & Dijital Onay Sunucusu çalışıyor: http://localhost:${port}`);
  });
}

