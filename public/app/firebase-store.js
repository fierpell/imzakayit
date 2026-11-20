import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

let fbInitPromise = null;

async function loadFirebaseConfig() {
  try {
    const mod = await import('./firebase-config.js');
    const cfg = mod?.firebaseConfig;
    if (cfg?.apiKey && !String(cfg.apiKey).startsWith('YOUR_') && cfg?.projectId) {
      return cfg;
    }
  } catch {
    // Yerel firebase-config.js yoksa Firebase Hosting'in /__/firebase/init.json dosyasını dene
  }

  try {
    const res = await fetch('/__/firebase/init.json', { cache: 'no-store' });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg?.apiKey && cfg?.projectId) return cfg;
    }
  } catch {
    // Yerel sunucuda /__/firebase/init.json bulunmaz
  }

  throw new Error(
    'Firebase yapılandırması bulunamadı. public/app/firebase-config.example.js dosyasını public/app/firebase-config.js olarak kopyalayıp kendi Firebase bilgilerinizi girin.'
  );
}

async function ensureFirebase() {
  if (!fbInitPromise) {
    fbInitPromise = (async () => {
      const cfg = await loadFirebaseConfig();
      const app = initializeApp(cfg);
      return {
        app,
        auth: getAuth(app),
        db: getFirestore(app)
      };
    })();
  }
  return fbInitPromise;
}

export function isFirebaseHosting() {
  const host = window.location.hostname;
  return host !== 'localhost' && host !== '127.0.0.1';
}

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(bytes = 24) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function randomPin() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(100000 + (arr[0] % 900000));
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDateTr(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return escapeHtml(isoString);
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'long',
    timeStyle: 'medium',
    timeZone: 'Europe/Istanbul'
  }).format(d);
}

function formatTextToHtml(rawText) {
  const safe = escapeHtml(rawText || '');
  const lines = safe.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inList = false;
  const fmt = (l) => l.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      continue;
    }
    if (/^#{1,3}\s+/.test(trimmed)) {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      const tag = trimmed.startsWith('### ') ? 'h4' : trimmed.startsWith('## ') ? 'h3' : 'h2';
      out.push(`<${tag} class="doc-heading">${fmt(trimmed.replace(/^#{1,3}\s+/, ''))}</${tag}>`);
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      if (!inList) {
        out.push('<ul class="doc-list">');
        inList = true;
      }
      out.push(`<li>${fmt(trimmed.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
    out.push(`<p class="doc-paragraph">${fmt(trimmed)}</p>`);
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

export function buildArchiveHtmlClient(contract) {
  const sig = contract.signature || {};
  const safeSigImg =
    typeof sig.imageDataUrl === 'string' &&
    /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig.imageDataUrl)
      ? sig.imageDataUrl
      : null;

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>İmzalı Belge Arşivi — ${escapeHtml(contract.title)}</title>
  <style>
    body { margin: 0; padding: 32px 16px; background: #f8fafc; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.65; }
    .sheet { max-width: 820px; margin: 0 auto; background: #fff; border: 1px solid #cbd5e1; border-radius: 12px; padding: 40px 44px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 16px; margin-bottom: 22px; }
    .badge { padding: 6px 12px; border-radius: 999px; font-size: 13px; font-weight: 700; background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
    .parties { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px; margin-bottom: 22px; font-size: 14px; }
    .sig-box { border: 1px solid #cbd5e1; border-radius: 10px; padding: 18px; margin: 24px 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; align-items: center; }
    .sig-visual { border: 1px dashed #94a3b8; border-radius: 8px; min-height: 110px; display: flex; align-items: center; justify-content: center; padding: 10px; }
    .sig-visual img { max-width: 100%; max-height: 105px; object-fit: contain; }
    .audit { background: #f1f5f9; border-radius: 8px; padding: 14px 16px; font-size: 12.5px; color: #475569; }
    .mono { font-family: ui-monospace, Menlo, Consolas, monospace; word-break: break-all; }
    @media print { body { background: #fff; padding: 0; } .sheet { border: none; padding: 10mm; } }
  </style>
</head>
<body>
  <article class="sheet">
    <header class="header">
      <div>
        <h1 style="margin:0 0 4px 0;font-size:23px;">${escapeHtml(contract.title)}</h1>
        <div class="mono" style="font-size:12.5px;color:#475569;">Belge No: ${escapeHtml(contract.id)}</div>
      </div>
      <div class="badge">&#10003; Dijital Onaylı Belge</div>
    </header>
    <section class="parties">
      <div><strong>Düzenleyen:</strong><br/>${escapeHtml(contract.creatorName)}</div>
      <div><strong>İmzalayan:</strong><br/>${escapeHtml(sig.signerName || contract.recipientName || '—')}</div>
      <div><strong>İmza Tarihi:</strong><br/>${escapeHtml(formatDateTr(sig.signedAt))}</div>
    </section>
    <section>${formatTextToHtml(contract.body)}</section>
    <section class="sig-box">
      <div>
        <p style="margin:0 0 6px 0;"><strong>İmzalayan:</strong> ${escapeHtml(sig.signerName)}</p>
        ${sig.signerContact ? `<p style="margin:0 0 6px 0;"><strong>İletişim:</strong> ${escapeHtml(sig.signerContact)}</p>` : ''}
        <p style="margin:0;color:#065f46;">&#10003; Okundu ve özgür iradeyle onaylandı.</p>
      </div>
      <div class="sig-visual">
        ${safeSigImg ? `<img src="${safeSigImg}" alt="İmza" />` : `<span style="font-family:Georgia,serif;font-style:italic;font-size:26px;">${escapeHtml(sig.typedSignature || sig.signerName)}</span>`}
      </div>
    </section>
    <section class="audit">
      <div><strong>Oluşturma:</strong> ${escapeHtml(formatDateTr(contract.createdAt))}</div>
      <div><strong>İmza Zamanı:</strong> ${escapeHtml(formatDateTr(sig.signedAt))}</div>
      <div><strong>Belge Bütünlük SHA-256:</strong> <span class="mono">${escapeHtml(sig.documentHash || '—')}</span></div>
    </section>
  </article>
</body>
</html>`;
}

export function triggerArchiveDownload(contract) {
  const html = buildArchiveHtmlClient(contract);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${contract.id}-imzali-belge.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function dispatchExternalNotifications(settings, message, contract) {
  const tasks = [];
  if (settings?.webhookUrl) {
    tasks.push(
      fetch(settings.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: contract?.status === 'signed' ? 'contract.signed' : 'contract.opened',
          text: message,
          content: message
        })
      }).catch(() => {})
    );
  }
  if (settings?.telegramBotToken && settings?.telegramChatId) {
    const endpoint = `https://api.telegram.org/bot${encodeURIComponent(settings.telegramBotToken)}/sendMessage`;
    tasks.push(
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: settings.telegramChatId,
          text: message,
          disable_web_page_preview: true
        })
      }).catch(() => {})
    );
  }
  await Promise.allSettled(tasks);
}

async function waitForAuthReady() {
  const { auth } = await ensureFirebase();
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

export const fbStore = {
  async getAdminStatus() {
    const { db } = await ensureFirebase();
    const user = await waitForAuthReady();
    const snap = await getDoc(doc(db, 'config', 'admin'));
    const initialized = snap.exists() && Boolean(snap.data()?.adminUid);
    const authenticated = Boolean(initialized && user && user.uid === snap.data().adminUid);
    return { initialized, authenticated };
  },

  async setupAdmin(email, password) {
    const cleanEmail = String(email || '').trim();
    if (!cleanEmail) throw new Error('Geçerli bir e-posta adresi girin.');
    const { auth, db } = await ensureFirebase();
    const ref = doc(db, 'config', 'admin');
    const snap = await getDoc(ref);
    if (snap.exists() && snap.data()?.adminUid) {
      throw new Error('Yönetici hesabı zaten oluşturulmuş.');
    }
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
    } catch (err) {
      if (err?.code === 'auth/email-already-in-use') {
        cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
      } else {
        throw err;
      }
    }
    await setDoc(ref, {
      adminUid: cred.user.uid,
      initializedAt: new Date().toISOString()
    });
  },

  async loginAdmin(email, password) {
    const cleanEmail = String(email || '').trim();
    if (!cleanEmail) throw new Error('E-posta adresinizi girin.');
    const { auth, db } = await ensureFirebase();
    const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
    const snap = await getDoc(doc(db, 'config', 'admin'));
    if (!snap.exists() || snap.data().adminUid !== cred.user.uid) {
      await signOut(auth);
      throw new Error('Bu hesap yönetici yetkisine sahip değil.');
    }
  },

  async logoutAdmin() {
    const { auth } = await ensureFirebase();
    await signOut(auth);
  },

  async getSettings() {
    const { db } = await ensureFirebase();
    const snap = await getDoc(doc(db, 'config', 'settings'));
    if (!snap.exists()) {
      return { webhookUrl: '', telegramBotToken: '', telegramChatId: '', notifyOnOpen: true, notifyOnSign: true };
    }
    return snap.data();
  },

  async updateSettings(settings) {
    const { db } = await ensureFirebase();
    const clean = {
      webhookUrl: String(settings.webhookUrl || '').trim(),
      telegramBotToken: String(settings.telegramBotToken || '').trim(),
      telegramChatId: String(settings.telegramChatId || '').trim(),
      notifyOnOpen: Boolean(settings.notifyOnOpen),
      notifyOnSign: settings.notifyOnSign !== false
    };
    await setDoc(doc(db, 'config', 'settings'), clean);
    return clean;
  },

  async sendTestNotification() {
    const settings = await this.getSettings();
    const message = 'Test bildirimi başarılı: İmzaKayıt Firebase bildirim kanallarınız aktif.';
    await dispatchExternalNotifications(settings, message, null);
    return { results: { webhook: settings.webhookUrl ? 'sent' : 'skipped', telegram: settings.telegramBotToken ? 'sent' : 'skipped' } };
  },

  async listContracts() {
    const { db } = await ensureFirebase();
    const q = query(collection(db, 'contracts'), orderBy('updatedAt', 'desc'));
    const [snap, secretsSnap] = await Promise.all([
      getDocs(q),
      getDocs(collection(db, 'admin_secrets'))
    ]);
    const pinsByToken = new Map();
    secretsSnap.docs.forEach((d) => {
      pinsByToken.set(d.id, d.data()?.pinCode || null);
    });
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        ...data,
        pinCode: pinsByToken.get(data.token) || null
      };
    });
  },

  async listNotifications() {
    const { db } = await ensureFirebase();
    const q = query(collection(db, 'notifications'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.slice(0, 30).map((d) => d.data());
  },

  subscribeAdmin(onContractsChange, onNewNotification) {
    let active = true;
    let unsubC = null;
    ensureFirebase()
      .then(({ db }) => {
        if (!active) return;
        const qContracts = query(collection(db, 'contracts'), orderBy('updatedAt', 'desc'));
        let firstLoad = true;
        unsubC = onSnapshot(qContracts, async (snap) => {
          const secretsSnap = await getDocs(collection(db, 'admin_secrets')).catch(() => ({ docs: [] }));
          const pinsByToken = new Map();
          secretsSnap.docs.forEach((d) => pinsByToken.set(d.id, d.data()?.pinCode || null));

          const contracts = snap.docs.map((d) => {
            const data = d.data();
            return { ...data, pinCode: pinsByToken.get(data.token) || null };
          });
          onContractsChange(contracts);
          if (!firstLoad) {
            snap.docChanges().forEach((change) => {
              if (change.type === 'modified') {
                const c = change.doc.data();
                if (c.status === 'signed') {
                  onNewNotification({
                    type: 'contract.signed',
                    contractId: c.id,
                    contractToken: c.token,
                    contract: c,
                    message: `"${c.title}" (${c.id}) ${c.signature?.signerName || 'karşı taraf'} tarafından imzalandı!`
                  });
                }
              }
            });
          }
          firstLoad = false;
        });
      })
      .catch(() => {});
    return () => {
      active = false;
      if (unsubC) unsubC();
    };
  },

  async createContract({ title, creatorName, recipientName, body, requirePin, autoBurnAfterSign }) {
    const { db } = await ensureFirebase();
    const now = new Date().toISOString();
    const token = randomToken(24);
    const id = `SZL-${new Date().getFullYear()}-${randomHex(3).toUpperCase()}`;
    const pinCode = requirePin ? randomPin() : null;
    const pinHash = pinCode ? await sha256Hex(`${token}:${pinCode}`) : null;

    const contract = {
      id,
      token,
      title: title.trim(),
      creatorName: creatorName.trim(),
      recipientName: (recipientName || '').trim(),
      body: body.trim(),
      requirePin: Boolean(requirePin),
      autoBurnAfterSign: autoBurnAfterSign !== false,
      pinHash,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      firstViewedAt: null,
      viewCount: 0,
      signature: null
    };
    await setDoc(doc(db, 'contracts', token), contract);
    if (pinCode) {
      await setDoc(doc(db, 'admin_secrets', token), { pinCode });
    }
    return { ...contract, pinCode };
  },

  async updateContract(id, { title, creatorName, recipientName, body, requirePin, regeneratePin, autoBurnAfterSign }) {
    const { db } = await ensureFirebase();
    const q = query(collection(db, 'contracts'), where('id', '==', id));
    const snap = await getDocs(q);
    if (snap.empty) throw new Error('Sözleşme bulunamadı.');
    const docRef = snap.docs[0].ref;
    const existing = snap.docs[0].data();
    if (existing.status === 'signed') throw new Error('İmzalanmış belgeler sonradan değiştirilemez.');

    const secretRef = doc(db, 'admin_secrets', existing.token);
    const secretSnap = await getDoc(secretRef);
    let pinCode = secretSnap.exists() ? secretSnap.data()?.pinCode : null;

    if (requirePin) {
      if (!pinCode || regeneratePin) pinCode = randomPin();
      await setDoc(secretRef, { pinCode });
    } else {
      pinCode = null;
      await deleteDoc(secretRef).catch(() => {});
    }
    const pinHash = pinCode ? await sha256Hex(`${existing.token}:${pinCode}`) : null;

    const updated = {
      ...existing,
      title: title.trim(),
      creatorName: creatorName.trim(),
      recipientName: (recipientName || '').trim(),
      body: body.trim(),
      requirePin: Boolean(requirePin),
      autoBurnAfterSign: autoBurnAfterSign !== undefined ? Boolean(autoBurnAfterSign) : (existing.autoBurnAfterSign !== false),
      pinHash,
      updatedAt: new Date().toISOString()
    };
    await setDoc(docRef, updated);
    return { ...updated, pinCode };
  },

  async revokeContract(id) {
    const { db } = await ensureFirebase();
    const q = query(collection(db, 'contracts'), where('id', '==', id));
    const snap = await getDocs(q);
    if (snap.empty) throw new Error('Sözleşme bulunamadı.');
    const existing = snap.docs[0].data();
    if (existing.status === 'signed') throw new Error('İmzalanmış sözleşme iptal edilemez.');
    await updateDoc(snap.docs[0].ref, { status: 'revoked', updatedAt: new Date().toISOString() });
  },

  async deleteContract(id) {
    const { db } = await ensureFirebase();
    const q = query(collection(db, 'contracts'), where('id', '==', id));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const token = snap.docs[0].id;
      await Promise.all([
        deleteDoc(snap.docs[0].ref),
        deleteDoc(doc(db, 'admin_secrets', token)).catch(() => {})
      ]);
    }
  },

  async getPublicContractForSign(token) {
    const { db } = await ensureFirebase();
    const ref = doc(db, 'contracts', token);
    let snap;
    try {
      snap = await getDoc(ref);
    } catch (err) {
      if (err?.code === 'permission-denied') {
        return {
          id: 'Kilitli Belge',
          token,
          title: 'İmzalanmış ve Kapatılmış Belge',
          creatorName: '—',
          status: 'signed',
          burned: true,
          signedAt: null
        };
      }
      throw err;
    }
    if (!snap.exists()) throw new Error('Geçersiz veya silinmiş imza bağlantısı.');
    const c = snap.data();

    if (c.status === 'pending' || c.status === 'viewed') {
      const now = new Date().toISOString();
      const isFirst = !c.firstViewedAt;
      await updateDoc(ref, {
        status: 'viewed',
        firstViewedAt: c.firstViewedAt || now,
        viewCount: (c.viewCount || 0) + 1,
        updatedAt: now
      }).catch(() => {});

      if (isFirst) {
        const ntfId = `ntf_${randomHex(6)}`;
        const msg = `"${c.title}" (${c.id}) bağlantısı görüntülendi.`;
        await setDoc(doc(db, 'notifications', ntfId), {
          id: ntfId,
          createdAt: now,
          type: 'contract.opened',
          contractId: c.id,
          contractToken: c.token,
          title: c.title,
          message: msg
        }).catch(() => {});
      }
    }

    if (c.status === 'signed' && c.autoBurnAfterSign !== false) {
      return {
        id: c.id,
        token: c.token,
        title: c.title,
        creatorName: c.creatorName,
        status: 'signed',
        burned: true,
        signedAt: c.signature?.signedAt || null
      };
    }

    return {
      id: c.id,
      token: c.token,
      title: c.title,
      creatorName: c.creatorName,
      recipientName: c.recipientName,
      body: c.body,
      requirePin: c.requirePin,
      autoBurnAfterSign: c.autoBurnAfterSign !== false,
      status: c.status,
      createdAt: c.createdAt,
      signedAt: c.signature?.signedAt || null,
      signerName: c.signature?.signerName || null,
      documentHash: c.signature?.documentHash || null
    };
  },

  async submitSignature(token, { signerName, signerContact, pinCode, signatureType, imageDataUrl, typedSignature, consentChecked }) {
    const { db } = await ensureFirebase();
    const ref = doc(db, 'contracts', token);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Sözleşme bulunamadı.');
    const c = snap.data();
    if (c.status === 'revoked') throw new Error('Bu imza bağlantısı iptal edilmiştir.');
    if (c.status === 'signed') throw new Error('Bu sözleşme daha önce imzalanmıştır.');
    if (!consentChecked) throw new Error('Devam etmek için onay kutucuğunu işaretlemelisiniz.');

    const pinHashAttempt = c.requirePin ? await sha256Hex(`${token}:${String(pinCode || '').trim()}`) : null;
    if (c.requirePin && pinHashAttempt !== c.pinHash) {
      throw new Error('6 haneli onay kodu hatalı.');
    }

    const cleanName = String(signerName || '').trim();
    if (cleanName.length < 2) throw new Error('Lütfen geçerli bir Ad Soyad girin.');

    const signedAt = new Date().toISOString();
    const contentHash = await sha256Hex(JSON.stringify({ title: c.title, creatorName: c.creatorName, body: c.body }));
    const sigPayload = signatureType === 'typed' ? String(typedSignature || cleanName).trim() : imageDataUrl;
    const signatureDigest = await sha256Hex(sigPayload);
    const documentHash = await sha256Hex(
      JSON.stringify({
        id: c.id,
        contentHash,
        signerName: cleanName,
        signerContact: String(signerContact || '').trim(),
        signedAt,
        signatureDigest
      })
    );

    const signature = {
      signerName: cleanName,
      signerContact: String(signerContact || '').trim(),
      signatureType: signatureType === 'typed' ? 'typed' : 'drawn',
      imageDataUrl: signatureType === 'typed' ? null : imageDataUrl,
      typedSignature: signatureType === 'typed' ? sigPayload : null,
      pinVerified: Boolean(c.requirePin),
      pinHashAttempt,
      consentAccepted: true,
      signedAt,
      ipAddress: 'Firebase Cloud',
      userAgent: navigator.userAgent.slice(0, 200),
      contentHash,
      signatureDigest,
      documentHash
    };

    await updateDoc(ref, {
      status: 'signed',
      updatedAt: signedAt,
      firstViewedAt: c.firstViewedAt || signedAt,
      signature
    });

    const ntfId = `ntf_${randomHex(6)}`;
    const msg = `"${c.title}" (${c.id}) ${cleanName} tarafından imzalandı.`;
    await setDoc(doc(db, 'notifications', ntfId), {
      id: ntfId,
      createdAt: signedAt,
      type: 'contract.signed',
      contractId: c.id,
      contractToken: c.token,
      title: c.title,
      message: msg
    }).catch(() => {});

    return { ok: true, signedAt, documentHash };
  },

  async getArchive(token) {
    const { db } = await ensureFirebase();
    const snap = await getDoc(doc(db, 'contracts', token));
    if (!snap.exists()) throw new Error('Belge bulunamadı.');
    const c = snap.data();
    if (c.status !== 'signed') throw new Error('Belge henüz imzalanmamış.');
    return c;
  },

  async verifyDocument({ documentId, hash }) {
    const { db } = await ensureFirebase();
    const qId = String(documentId || '').trim().toUpperCase();
    const qHash = String(hash || '').trim().toLowerCase();
    const snap = await getDocs(collection(db, 'contracts'));
    const all = snap.docs.map((d) => d.data()).filter((c) => c.status === 'signed');

    const match = all.find((c) => {
      const idOk = !qId || c.id.toUpperCase() === qId;
      const hashOk = !qHash || c.signature?.documentHash === qHash || c.signature?.contentHash === qHash;
      return idOk && hashOk;
    });

    if (!match) return { valid: false };
    return {
      valid: true,
      document: {
        id: match.id,
        title: match.title,
        creatorName: match.creatorName,
        signerName: match.signature.signerName,
        signedAt: match.signature.signedAt,
        contentHash: match.signature.contentHash,
        documentHash: match.signature.documentHash
      }
    };
  }
};
