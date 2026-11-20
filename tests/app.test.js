import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createApp } from '../server.js';

const SAMPLE_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function startTestServer() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sozlesme-test-'));
  const { server, storage } = await createApp({ dataDir: tempDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    tempDir,
    storage,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

test('Sözleşme oluşturma, düzenleme, 2 adımlı imza, bildirim, arşiv ve doğrulama akışı', async () => {
  const app = await startTestServer();

  // Sahte webhook alıcısı
  const webhookEvents = [];
  const webhookServer = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      webhookEvents.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.writeHead(200);
      res.end('ok');
    });
  });
  await new Promise((resolve) => webhookServer.listen(0, '127.0.0.1', resolve));
  const webhookUrl = `http://127.0.0.1:${webhookServer.address().port}/hook`;

  try {
    // 1. Yetkisiz erişim engellenmeli
    const unauthRes = await fetch(`${app.baseUrl}/api/admin/contracts`);
    assert.equal(unauthRes.status, 401);

    // 2. İlk kurulum ve oturum açma
    const statusBefore = await fetch(`${app.baseUrl}/api/admin/status`).then((r) => r.json());
    assert.equal(statusBefore.initialized, false);
    assert.equal(statusBefore.authenticated, false);

    const setupRes = await fetch(`${app.baseUrl}/api/admin/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-parola-123' })
    });
    assert.equal(setupRes.status, 201);
    const cookieHeader = setupRes.headers.get('set-cookie').split(';')[0];

    const authHeaders = {
      'Content-Type': 'application/json',
      Cookie: cookieHeader
    };

    // 3. Webhook ayarını kaydet
    const settingsRes = await fetch(`${app.baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        webhookUrl,
        notifyOnOpen: true,
        notifyOnSign: true
      })
    });
    assert.equal(settingsRes.status, 200);

    // 4. Sözleşme oluştur (PIN korumalı)
    const createRes = await fetch(`${app.baseUrl}/api/admin/contracts`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        title: 'Deneme Sözleşmesi',
        creatorName: 'Ahmet Yılmaz',
        recipientName: 'Ayşe Demir',
        body: '## Madde 1\nİlk metin içeriği.\n<script>alert("xss")</script>',
        requirePin: true
      })
    });
    assert.equal(createRes.status, 201);
    const { contract: created } = await createRes.json();
    assert.ok(created.token);
    assert.match(created.pinCode, /^\d{6}$/);

    // 5. İmzalanmadan önce içeriği güncelle
    const editRes = await fetch(`${app.baseUrl}/api/admin/contracts/${created.id}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        title: 'Güncellenmiş Protokol',
        creatorName: 'Ahmet Yılmaz',
        recipientName: 'Ayşe Demir',
        body: '## Madde 1\nGüncel metin ve <script>alert(1)</script> koruması.',
        requirePin: true,
        regeneratePin: false
      })
    });
    assert.equal(editRes.status, 200);
    const { contract: updated } = await editRes.json();
    assert.equal(updated.title, 'Güncellenmiş Protokol');
    assert.equal(updated.pinCode, created.pinCode);

    // 6. Karşı taraf linki açar — PIN sızdırılmamalı!
    const publicViewRes = await fetch(`${app.baseUrl}/api/sign/${created.token}`);
    assert.equal(publicViewRes.status, 200);
    const { contract: publicView } = await publicViewRes.json();
    assert.equal(publicView.requirePin, true);
    assert.equal(publicView.pinCode, undefined);
    assert.equal(publicView.status, 'viewed');

    // 7. Hatalı PIN ile imza reddedilmeli
    const wrongPinRes = await fetch(`${app.baseUrl}/api/sign/${created.token}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signerName: 'Ayşe Demir',
        pinCode: '000000',
        signatureType: 'drawn',
        imageDataUrl: SAMPLE_PNG_DATA_URL,
        consentChecked: true
      })
    });
    assert.equal(wrongPinRes.status, 403);

    // 8. Onay kutucuğu olmadan imza reddedilmeli
    const noConsentRes = await fetch(`${app.baseUrl}/api/sign/${created.token}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signerName: 'Ayşe Demir',
        pinCode: created.pinCode,
        signatureType: 'drawn',
        imageDataUrl: SAMPLE_PNG_DATA_URL,
        consentChecked: false
      })
    });
    assert.equal(noConsentRes.status, 400);

    // 9. Geçerli imza gönderimi
    const signRes = await fetch(`${app.baseUrl}/api/sign/${created.token}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signerName: 'Ayşe Demir',
        signerContact: 'ayse@example.com',
        pinCode: created.pinCode,
        signatureType: 'drawn',
        imageDataUrl: SAMPLE_PNG_DATA_URL,
        consentChecked: true
      })
    });
    assert.equal(signRes.status, 200);
    const signResult = await signRes.json();
    assert.equal(signResult.ok, true);
    assert.match(signResult.documentHash, /^[a-f0-9]{64}$/);

    // 10. İmzalanmış belge düzenlenemez ve tekrar imzalanamaz
    const editAfterSign = await fetch(`${app.baseUrl}/api/admin/contracts/${created.id}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        title: 'Değişmeye Çalışan Başlık',
        creatorName: 'Ahmet Yılmaz',
        recipientName: 'Ayşe Demir',
        body: 'Değiştirilmiş metin denemesi',
        requirePin: false
      })
    });
    assert.equal(editAfterSign.status, 409);

    const resignRes = await fetch(`${app.baseUrl}/api/sign/${created.token}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signerName: 'Ayşe Demir',
        pinCode: created.pinCode,
        signatureType: 'drawn',
        imageDataUrl: SAMPLE_PNG_DATA_URL,
        consentChecked: true
      })
    });
    assert.equal(resignRes.status, 409);

    // 10.b. İnternet linki otomatik imha edildi (burned) kontrolü
    const burnedViewRes = await fetch(`${app.baseUrl}/api/sign/${created.token}`).then((r) => r.json());
    assert.equal(burnedViewRes.contract.status, 'signed');
    assert.equal(burnedViewRes.contract.burned, true);
    assert.equal(burnedViewRes.contract.body, undefined);

    // 10.c. Lokal klasöre doğrudan dosya indi mi kontrolü
    const localFiles = await fs.readdir(app.storage.localExportDir);
    assert.ok(localFiles.some((f) => f.startsWith(created.id) && f.endsWith('.html')));

    // 11. Arşiv HTML indirme & XSS kaçışı kontrolü
    const archiveHtmlRes = await fetch(`${app.baseUrl}/api/archive/${created.token}/download`);
    assert.equal(archiveHtmlRes.status, 200);
    const archiveHtml = await archiveHtmlRes.text();
    assert.ok(archiveHtml.includes('Güncellenmiş Protokol'));
    assert.ok(archiveHtml.includes(signResult.documentHash));
    assert.ok(!archiveHtml.includes('<script>alert(1)</script>'));
    assert.ok(archiveHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));

    // 12. Belge bütünlük doğrulama
    const verifyOk = await fetch(`${app.baseUrl}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documentId: created.id,
        hash: signResult.documentHash
      })
    }).then((r) => r.json());
    assert.equal(verifyOk.valid, true);
    assert.equal(verifyOk.document.signerName, 'Ayşe Demir');

    const verifyBad = await fetch(`${app.baseUrl}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documentId: created.id,
        hash: 'f'.repeat(64)
      })
    }).then((r) => r.json());
    assert.equal(verifyBad.valid, false);

    // 13. Yönetici bildirim geçmişi ve webhook teslimi kontrolü
    await new Promise((r) => setTimeout(r, 120));
    const listData = await fetch(`${app.baseUrl}/api/admin/contracts`, {
      headers: authHeaders
    }).then((r) => r.json());
    assert.equal(listData.contracts[0].status, 'signed');
    assert.ok(listData.notifications.some((n) => n.type === 'contract.opened'));
    assert.ok(listData.notifications.some((n) => n.type === 'contract.signed'));
    assert.ok(webhookEvents.some((w) => w.event === 'contract.signed'));
  } finally {
    await new Promise((resolve) => webhookServer.close(resolve));
    await app.close();
  }
});

test('Bağlantı iptal edildiğinde imza engellenir', async () => {
  const app = await startTestServer();
  try {
    const setupRes = await fetch(`${app.baseUrl}/api/admin/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'admin-password' })
    });
    const cookieHeader = setupRes.headers.get('set-cookie').split(';')[0];
    const headers = { 'Content-Type': 'application/json', Cookie: cookieHeader };

    const { contract } = await fetch(`${app.baseUrl}/api/admin/contracts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: 'İptal Test Sözleşmesi',
        creatorName: 'Test Düzenleyen',
        body: 'İptal edilecek metin maddeleri.',
        requirePin: false
      })
    }).then((r) => r.json());

    const revokeRes = await fetch(`${app.baseUrl}/api/admin/contracts/${contract.id}/revoke`, {
      method: 'POST',
      headers
    });
    assert.equal(revokeRes.status, 200);

    const signAttempt = await fetch(`${app.baseUrl}/api/sign/${contract.token}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signerName: 'Test İmzalayan',
        signatureType: 'typed',
        typedSignature: 'Test İmzalayan',
        consentChecked: true
      })
    });
    assert.equal(signAttempt.status, 410);
  } finally {
    await app.close();
  }
});

test('Sayfa rotaları, statik dosyalar ve yol geçişi koruması', async () => {
  const app = await startTestServer();
  try {
    const routes = [
      '/',
      '/imza/ornekToken123',
      '/arsiv/ornekToken123',
      '/dogrula',
      '/styles.css',
      '/app/common.js',
      '/app/admin.js',
      '/app/sign.js',
      '/app/archive.js',
      '/app/verify.js'
    ];
    for (const route of routes) {
      const res = await fetch(`${app.baseUrl}${route}`);
      assert.equal(res.status, 200, `Beklenen 200, gelen ${res.status}: ${route}`);
    }

    const traversal = await fetch(`${app.baseUrl}/../server.js`);
    assert.notEqual(traversal.status, 200);
  } finally {
    await app.close();
  }
});

