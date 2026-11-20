import { apiFetch, formatDateTr, renderFormattedContractText, showToast } from './common.js';
import { fbStore, isFirebaseHosting, triggerArchiveDownload } from './firebase-store.js';

const TEMPLATES = {
  general: {
    title: 'Genel Mutabakat ve İşbirliği Protokolü',
    body: `## 1. Taraflar ve Amaç
İşbu mutabakat metni, aşağıda bilgileri yer alan taraflar arasında belirlenen ortak çalışma, görev paylaşımı ve iletişim esaslarını kayıt altına almak amacıyla düzenlenmiştir.

## 2. Temel İlkeler
- Taraflar, kararlaştırılan sorumlulukları iyi niyet ve şeffaflık çerçevesinde yerine getirmeyi kabul eder.
- İşbu metindeki herhangi bir madde, her iki tarafın yazılı onayı ile her zaman güncellenebilir veya sonlandırılabilir.
- Taraflardan biri mutabakatı sonlandırmak istediğinde diğer tarafa makul süre önceden bildirimde bulunur.

## 3. Yürürlük ve Saklama
Bu belge dijital onay ile kayıt altına alınır ve her iki tarafça arşivlenebilir.`
  },
  service: {
    title: 'Serbest Çalışma (Freelance) Hizmet Sözleşmesi',
    body: `## MADDE 1 — Konu
İşbu sözleşmenin konusu, Yüklenici tarafından İşveren için hazırlanacak dijital/danışmanlık işinin kapsamı, teslim tarihi ve ödeme koşullarının belirlenmesidir.

## MADDE 2 — Kapsam ve Teslim
- Projenin belirlenen aşamaları üzerinde taraflar mutabık kalmıştır.
- Revizyon talepleri yazılı olarak iletilir.

## MADDE 3 — Ücret ve Ödeme
Kararlaştırılan hizmet bedeli, iş teslimini takiben tarafların belirttiği banka hesabına aktarılır.`
  },
  nda: {
    title: 'Karşılıklı Gizlilik Sözleşmesi (NDA)',
    body: `## 1. Gizli Bilginin Tanımı
Tarafların görüşmeler ve ortak çalışma süresince paylaştığı ticari, teknik, finansal ve kişisel veriler **Gizli Bilgi** sayılır.

## 2. Gizlilik Yükümlülüğü
- Taraflar, diğer tarafa ait gizli bilgileri üçüncü kişilerle paylaşmayacağını taahhüt eder.
- Gizli bilgiler yalnızca kararlaştırılan işbirliği amacı doğrultusunda kullanılabilir.

## 3. Süre
İşbu gizlilik yükümlülüğü belgenin onaylanmasından itibaren 2 (iki) yıl süreyle geçerlidir.`
  },
  home: {
    title: 'Ortak Yaşam ve Ev Düzeni Mutabakatı',
    body: `## 1. Amaç
Bu metin, ortak yaşam alanında huzurlu, adil ve düzenli bir iş bölümü sağlamak amacıyla gönüllü olarak hazırlanmıştır.

## 2. Sorumluluk Paylaşımı
- Günlük düzen, mutfak ve ortak alan temizliği sırayla ve adil biçimde paylaşılır.
- Ortak giderler ay sonunda şeffaf şekilde hesaplanır.
- Önemli kararlar her iki tarafın ortak onayıyla alınır.

## 3. Güncelleme
İhtiyaç duyulduğunda maddeler karşılıklı rıza ile değiştirilebilir.`
  },
  blank: {
    title: '',
    body: ''
  }
};

const state = {
  initialized: false,
  authenticated: false,
  contracts: [],
  notifications: [],
  eventSource: null,
  previewVisible: false
};

const els = {
  authView: document.getElementById('auth-view'),
  appView: document.getElementById('app-view'),
  authTitle: document.getElementById('auth-title'),
  authSubtitle: document.getElementById('auth-subtitle'),
  authError: document.getElementById('auth-error'),
  authForm: document.getElementById('auth-form'),
  authEmailGroup: document.getElementById('auth-email-group'),
  authEmail: document.getElementById('auth-email'),
  authPassword: document.getElementById('auth-password'),
  authConfirmGroup: document.getElementById('auth-confirm-group'),
  authPasswordConfirm: document.getElementById('auth-password-confirm'),
  authSubmitBtn: document.getElementById('auth-submit-btn'),
  logoutBtn: document.getElementById('logout-btn'),
  enableBrowserNotifBtn: document.getElementById('enable-browser-notif-btn'),
  statTotal: document.getElementById('stat-total'),
  statPending: document.getElementById('stat-pending'),
  statViewed: document.getElementById('stat-viewed'),
  statSigned: document.getElementById('stat-signed'),
  editorHeading: document.getElementById('editor-heading'),
  cancelEditBtn: document.getElementById('cancel-edit-btn'),
  contractForm: document.getElementById('contract-form'),
  editingId: document.getElementById('editing-id'),
  cTitle: document.getElementById('c-title'),
  cCreator: document.getElementById('c-creator'),
  cRecipient: document.getElementById('c-recipient'),
  cBody: document.getElementById('c-body'),
  cRequirePin: document.getElementById('c-require-pin'),
  cAutoburn: document.getElementById('c-autoburn'),
  regeneratePinWrap: document.getElementById('regenerate-pin-wrap'),
  cRegeneratePin: document.getElementById('c-regenerate-pin'),
  saveContractBtn: document.getElementById('save-contract-btn'),
  togglePreviewBtn: document.getElementById('toggle-preview-btn'),
  bodyPreview: document.getElementById('body-preview'),
  contractsList: document.getElementById('contracts-list'),
  notificationsList: document.getElementById('notifications-list'),
  notifBadge: document.getElementById('notif-badge'),
  settingsForm: document.getElementById('settings-form'),
  sWebhook: document.getElementById('s-webhook'),
  sTgToken: document.getElementById('s-tg-token'),
  sTgChat: document.getElementById('s-tg-chat'),
  sNotifyOpen: document.getElementById('s-notify-open'),
  sNotifySign: document.getElementById('s-notify-sign'),
  testNotifBtn: document.getElementById('test-notif-btn')
};

function statusMeta(status) {
  switch (status) {
    case 'signed':
      return { label: 'İmzalandı', cls: 'badge-signed' };
    case 'viewed':
      return { label: 'Görüntülendi', cls: 'badge-viewed' };
    case 'revoked':
      return { label: 'İptal Edildi', cls: 'badge-revoked' };
    default:
      return { label: 'İmza Bekliyor', cls: 'badge-pending' };
  }
}

function renderAuthView() {
  els.appView.classList.add('hidden');
  els.authView.classList.remove('hidden');
  els.authError.classList.add('hidden');

  if (isFirebaseHosting()) {
    els.authEmailGroup.classList.remove('hidden');
    els.authEmail.required = true;
  } else {
    els.authEmailGroup.classList.add('hidden');
    els.authEmail.required = false;
  }

  if (!state.initialized) {
    els.authTitle.textContent = isFirebaseHosting() ? 'İlk Kurulum: Yönetici Hesabı' : 'İlk Kurulum: Yönetici Şifresi';
    els.authSubtitle.textContent = isFirebaseHosting()
      ? 'Sadece sizin erişebileceğiniz yönetici e-posta ve şifrenizi belirleyin.'
      : 'Sözleşme panelinizi korumak için bir yönetici şifresi belirleyin.';
    els.authConfirmGroup.classList.remove('hidden');
    els.authPasswordConfirm.required = true;
    els.authSubmitBtn.textContent = 'Hesabı Oluştur ve Başla';
  } else {
    els.authTitle.textContent = 'Yönetici Girişi';
    els.authSubtitle.textContent = 'Sözleşmelerinizi yönetmek için giriş yapın.';
    els.authConfirmGroup.classList.add('hidden');
    els.authPasswordConfirm.required = false;
    els.authSubmitBtn.textContent = 'Giriş Yap';
  }
}

function renderStats() {
  const total = state.contracts.length;
  const pending = state.contracts.filter((c) => c.status === 'pending').length;
  const viewed = state.contracts.filter((c) => c.status === 'viewed').length;
  const signed = state.contracts.filter((c) => c.status === 'signed').length;
  els.statTotal.textContent = String(total);
  els.statPending.textContent = String(pending);
  els.statViewed.textContent = String(viewed);
  els.statSigned.textContent = String(signed);
}

function renderContracts() {
  els.contractsList.replaceChildren();
  if (state.contracts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'alert alert-info';
    empty.textContent = 'Henüz sözleşme oluşturulmadı. Soldaki düzenleyiciden ilk sözleşmenizi oluşturabilirsiniz.';
    els.contractsList.appendChild(empty);
    return;
  }

  for (const c of state.contracts) {
    const card = document.createElement('article');
    card.className = 'contract-item';

    const top = document.createElement('div');
    top.className = 'contract-top';

    const titleWrap = document.createElement('div');
    const title = document.createElement('h3');
    title.className = 'contract-title';
    title.textContent = c.title;

    const idSpan = document.createElement('div');
    idSpan.className = 'muted mono';
    idSpan.style.fontSize = '12px';
    idSpan.textContent = `${c.id} • Düzenleyen: ${c.creatorName}${c.recipientName ? ` → ${c.recipientName}` : ''}`;

    titleWrap.append(title, idSpan);

    const meta = statusMeta(c.status);
    const badge = document.createElement('span');
    badge.className = `badge ${meta.cls}`;
    badge.textContent = meta.label;

    top.append(titleWrap, badge);

    const details = document.createElement('div');
    details.className = 'contract-meta';
    details.style.marginTop = '8px';

    const createdItem = document.createElement('span');
    createdItem.textContent = `Oluşturma: ${formatDateTr(c.createdAt)}`;
    details.appendChild(createdItem);

    if (c.firstViewedAt) {
      const viewedItem = document.createElement('span');
      viewedItem.textContent = `İlk Açılış: ${formatDateTr(c.firstViewedAt)} (${c.viewCount || 1}x)`;
      details.appendChild(viewedItem);
    }

    if (c.requirePin && c.pinCode && c.status !== 'signed' && c.status !== 'revoked') {
      const pinBadge = document.createElement('span');
      pinBadge.className = 'pin-pill mono';
      pinBadge.textContent = `Onay Kodu: ${c.pinCode}`;
      details.appendChild(pinBadge);
    }

    if (c.status === 'signed' && c.signature) {
      const signedInfo = document.createElement('div');
      signedInfo.className = 'alert alert-ok';
      signedInfo.style.padding = '8px 10px';
      signedInfo.style.marginBottom = '10px';
      signedInfo.textContent = `İmzalayan: ${c.signature.signerName} • Tarih: ${formatDateTr(c.signature.signedAt)}`;
      card.append(top, details, signedInfo);
    } else {
      card.append(top, details);
    }

    const actions = document.createElement('div');
    actions.className = 'btn-group';

    const signUrl = `${window.location.origin}/imza/${c.token}`;

    if (c.status === 'signed') {
      const viewArchive = document.createElement('a');
      viewArchive.className = 'btn btn-success btn-sm';
      viewArchive.href = `/arsiv/${c.token}`;
      viewArchive.target = '_blank';
      viewArchive.rel = 'noopener';
      viewArchive.textContent = 'İmzalı Belgeyi Gör / PDF';

      let downloadHtml;
      if (isFirebaseHosting()) {
        downloadHtml = document.createElement('button');
        downloadHtml.type = 'button';
        downloadHtml.className = 'btn btn-secondary btn-sm';
        downloadHtml.textContent = 'HTML Arşivi İndir';
        downloadHtml.addEventListener('click', () => triggerArchiveDownload(c));
      } else {
        downloadHtml = document.createElement('a');
        downloadHtml.className = 'btn btn-secondary btn-sm';
        downloadHtml.href = `/api/archive/${c.token}/download`;
        downloadHtml.textContent = 'HTML Arşivi İndir';
      }

      actions.append(viewArchive, downloadHtml);
    } else if (c.status !== 'revoked') {
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn btn-primary btn-sm';
      copyBtn.textContent = 'İmza Linkini Kopyala';
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(signUrl);
          showToast('İmza linki panoya kopyalandı!', 'ok');
        } catch {
          window.prompt('Bağlantıyı kopyalayın:', signUrl);
        }
      });

      const openLink = document.createElement('a');
      openLink.className = 'btn btn-secondary btn-sm';
      openLink.href = signUrl;
      openLink.target = '_blank';
      openLink.rel = 'noopener';
      openLink.textContent = 'Linki Aç';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-secondary btn-sm';
      editBtn.textContent = 'Düzenle';
      editBtn.addEventListener('click', () => startEditing(c));

      const revokeBtn = document.createElement('button');
      revokeBtn.type = 'button';
      revokeBtn.className = 'btn btn-danger btn-sm';
      revokeBtn.textContent = 'İptal Et';
      revokeBtn.addEventListener('click', async () => {
        if (!window.confirm('Bu imza bağlantısını iptal etmek istediğinize emin misiniz?')) return;
        try {
          if (isFirebaseHosting()) {
            await fbStore.revokeContract(c.id);
          } else {
            await apiFetch(`/api/admin/contracts/${encodeURIComponent(c.id)}/revoke`, { method: 'POST' });
          }
          showToast('Sözleşme bağlantısı iptal edildi.');
          await loadDashboardData();
        } catch (err) {
          showToast(err.message, 'danger');
        }
      });

      actions.append(copyBtn, openLink, editBtn, revokeBtn);
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-danger btn-sm';
    deleteBtn.textContent = 'Sil';
    deleteBtn.addEventListener('click', async () => {
      if (!window.confirm('Bu kaydı kalıcı olarak silmek istediğinize emin misiniz?')) return;
      try {
        if (isFirebaseHosting()) {
          await fbStore.deleteContract(c.id);
        } else {
          await apiFetch(`/api/admin/contracts/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
        }
        if (els.editingId.value === c.id) resetEditor();
        showToast('Sözleşme silindi.');
        await loadDashboardData();
      } catch (err) {
        showToast(err.message, 'danger');
      }
    });

    actions.appendChild(deleteBtn);
    card.appendChild(actions);
    els.contractsList.appendChild(card);
  }
}

function renderNotifications() {
  els.notifBadge.textContent = String(state.notifications.length);
  els.notificationsList.replaceChildren();
  if (state.notifications.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'alert alert-info';
    empty.textContent = 'Henüz bildirim kaydı yok.';
    els.notificationsList.appendChild(empty);
    return;
  }

  for (const n of state.notifications) {
    const row = document.createElement('div');
    row.className = 'notif-item';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.marginBottom = '4px';

    const kind = document.createElement('strong');
    kind.textContent =
      n.type === 'contract.signed'
        ? 'Sözleşme İmzalandı'
        : n.type === 'contract.opened'
          ? 'Link Görüntülendi'
          : 'Sistem Bildirimi';

    const time = document.createElement('span');
    time.className = 'muted';
    time.style.fontSize = '12px';
    time.textContent = formatDateTr(n.createdAt);

    header.append(kind, time);

    const msg = document.createElement('div');
    msg.textContent = n.message;

    row.append(header, msg);
    els.notificationsList.appendChild(row);
  }
}

function startEditing(contract) {
  els.editingId.value = contract.id;
  els.cTitle.value = contract.title;
  els.cCreator.value = contract.creatorName;
  els.cRecipient.value = contract.recipientName || '';
  els.cBody.value = contract.body;
  els.cRequirePin.checked = Boolean(contract.requirePin);
  els.cAutoburn.checked = contract.autoBurnAfterSign !== false;
  els.cRegeneratePin.checked = false;
  els.regeneratePinWrap.classList.toggle('hidden', !contract.requirePin);
  els.editorHeading.textContent = `Sözleşmeyi Düzenle (${contract.id})`;
  els.saveContractBtn.textContent = 'Değişiklikleri Kaydet';
  els.cancelEditBtn.classList.remove('hidden');
  if (state.previewVisible) {
    renderFormattedContractText(els.bodyPreview, els.cBody.value);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetEditor() {
  els.editingId.value = '';
  els.contractForm.reset();
  els.cRequirePin.checked = true;
  els.cAutoburn.checked = true;
  els.cRegeneratePin.checked = false;
  els.regeneratePinWrap.classList.add('hidden');
  els.editorHeading.textContent = 'Yeni Sözleşme Oluştur';
  els.saveContractBtn.textContent = 'Sözleşmeyi Kaydet & Link Oluştur';
  els.cancelEditBtn.classList.add('hidden');
  if (state.previewVisible) {
    renderFormattedContractText(els.bodyPreview, '');
  }
}

async function loadDashboardData() {
  if (isFirebaseHosting()) {
    const [contracts, notifications, settings] = await Promise.all([
      fbStore.listContracts(),
      fbStore.listNotifications(),
      fbStore.getSettings()
    ]);
    state.contracts = contracts;
    state.notifications = notifications;
    renderStats();
    renderContracts();
    renderNotifications();

    els.sWebhook.value = settings.webhookUrl || '';
    els.sTgToken.value = settings.telegramBotToken || '';
    els.sTgChat.value = settings.telegramChatId || '';
    els.sNotifyOpen.checked = settings.notifyOnOpen !== false;
    els.sNotifySign.checked = settings.notifyOnSign !== false;
    return;
  }

  const [listData, settingsData] = await Promise.all([
    apiFetch('/api/admin/contracts'),
    apiFetch('/api/admin/settings')
  ]);
  state.contracts = listData.contracts || [];
  state.notifications = listData.notifications || [];
  renderStats();
  renderContracts();
  renderNotifications();

  const s = settingsData.settings || {};
  els.sWebhook.value = s.webhookUrl || '';
  els.sTgToken.value = s.telegramBotToken || '';
  els.sTgChat.value = s.telegramChatId || '';
  els.sNotifyOpen.checked = s.notifyOnOpen !== false;
  els.sNotifySign.checked = s.notifyOnSign !== false;
}

function connectEventStream() {
  if (state.unsubFb) {
    state.unsubFb();
    state.unsubFb = null;
  }
  if (isFirebaseHosting()) {
    state.unsubFb = fbStore.subscribeAdmin(
      (contracts) => {
        state.contracts = contracts;
        renderStats();
        renderContracts();
      },
      (payload) => {
        showToast(payload.message, 'ok');
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('Sözleşme İmzalandı!', { body: payload.message });
        }
        if (payload.contract) {
          triggerArchiveDownload(payload.contract);
          showToast('📥 İmzalı sözleşme otomatik olarak İndirilenler klasörünüze kaydedildi!', 'ok');
        }
      }
    );
    return;
  }

  if (state.eventSource) {
    state.eventSource.close();
  }
  const es = new EventSource('/api/admin/events');
  es.addEventListener('notification', async (event) => {
    try {
      const payload = JSON.parse(event.data);
      const isSigned = payload.type === 'contract.signed';
      showToast(payload.message, isSigned ? 'ok' : 'info');

      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(isSigned ? 'Sözleşme İmzalandı!' : 'Sözleşme Görüntülendi', {
          body: payload.message
        });
      }

      if (isSigned && payload.contractToken) {
        // İmzalı sözleşmeyi anında kullanıcının bilgisayarına indir
        const dlLink = document.createElement('a');
        dlLink.href = `/api/archive/${encodeURIComponent(payload.contractToken)}/download`;
        dlLink.download = `${payload.contractId || 'sozlesme'}-imzali.html`;
        document.body.appendChild(dlLink);
        dlLink.click();
        dlLink.remove();
        showToast('📥 İmzalı sözleşme otomatik olarak İndirilenler klasörünüze kaydedildi!', 'ok');
      }

      await loadDashboardData();
    } catch {
      // yoksay
    }
  });
  state.eventSource = es;
}

async function enterDashboard() {
  els.authView.classList.add('hidden');
  els.appView.classList.remove('hidden');
  if (!els.cBody.value.trim()) {
    applyTemplate('general');
  }
  await loadDashboardData();
  connectEventStream();
}

function applyTemplate(key) {
  const tpl = TEMPLATES[key];
  if (!tpl) return;
  els.cTitle.value = tpl.title;
  els.cBody.value = tpl.body;
  if (state.previewVisible) {
    renderFormattedContractText(els.bodyPreview, tpl.body);
  }
}

// --- Olay Dinleyicileri ---
els.authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.authError.classList.add('hidden');
  const password = els.authPassword.value;

  try {
    if (!state.initialized) {
      if (password !== els.authPasswordConfirm.value) {
        throw new Error('Girdiğiniz şifreler eşleşmiyor.');
      }
      if (isFirebaseHosting()) {
        await fbStore.setupAdmin(els.authEmail.value, password);
      } else {
        await apiFetch('/api/admin/setup', {
          method: 'POST',
          body: JSON.stringify({ password })
        });
      }
      state.initialized = true;
      state.authenticated = true;
    } else {
      if (isFirebaseHosting()) {
        await fbStore.loginAdmin(els.authEmail.value, password);
      } else {
        await apiFetch('/api/admin/login', {
          method: 'POST',
          body: JSON.stringify({ password })
        });
      }
      state.authenticated = true;
    }
    els.authPassword.value = '';
    els.authPasswordConfirm.value = '';
    await enterDashboard();
  } catch (err) {
    els.authError.textContent = err.message;
    els.authError.classList.remove('hidden');
  }
});

els.logoutBtn.addEventListener('click', async () => {
  if (state.unsubFb) {
    state.unsubFb();
    state.unsubFb = null;
  }
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  if (isFirebaseHosting()) {
    await fbStore.logoutAdmin();
  } else {
    await apiFetch('/api/admin/logout', { method: 'POST' });
  }
  state.authenticated = false;
  renderAuthView();
});

els.enableBrowserNotifBtn.addEventListener('click', async () => {
  if (!('Notification' in window)) {
    showToast('Tarayıcınız masaüstü bildirimlerini desteklemiyor.', 'danger');
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    showToast('Masaüstü bildirimleri etkinleştirildi!', 'ok');
    els.enableBrowserNotifBtn.textContent = 'Masaüstü Bildirimi Aktif';
  } else {
    showToast('Bildirim izni verilmedi.', 'danger');
  }
});

document.querySelectorAll('[data-template]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (els.editingId.value && !window.confirm('Mevcut düzenleme alanındaki metin şablonla değiştirilsin mi?')) {
      return;
    }
    applyTemplate(btn.dataset.template);
  });
});

els.togglePreviewBtn.addEventListener('click', () => {
  state.previewVisible = !state.previewVisible;
  els.bodyPreview.classList.toggle('hidden', !state.previewVisible);
  els.togglePreviewBtn.textContent = state.previewVisible ? 'Önizlemeyi Gizle' : 'Önizleme Göster';
  if (state.previewVisible) {
    renderFormattedContractText(els.bodyPreview, els.cBody.value);
  }
});

els.cBody.addEventListener('input', () => {
  if (state.previewVisible) {
    renderFormattedContractText(els.bodyPreview, els.cBody.value);
  }
});

els.cRequirePin.addEventListener('change', () => {
  if (els.editingId.value) {
    els.regeneratePinWrap.classList.toggle('hidden', !els.cRequirePin.checked);
  }
});

els.cancelEditBtn.addEventListener('click', resetEditor);

els.contractForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    title: els.cTitle.value,
    creatorName: els.cCreator.value,
    recipientName: els.cRecipient.value,
    body: els.cBody.value,
    requirePin: els.cRequirePin.checked,
    autoBurnAfterSign: els.cAutoburn.checked,
    regeneratePin: els.cRegeneratePin.checked
  };

  try {
    const editingId = els.editingId.value;
    if (editingId) {
      if (isFirebaseHosting()) {
        await fbStore.updateContract(editingId, payload);
      } else {
        await apiFetch(`/api/admin/contracts/${encodeURIComponent(editingId)}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      }
      showToast('Sözleşme güncellendi.', 'ok');
    } else {
      const created = isFirebaseHosting()
        ? await fbStore.createContract(payload)
        : (await apiFetch('/api/admin/contracts', { method: 'POST', body: JSON.stringify(payload) })).contract;
      const link = `${window.location.origin}/imza/${created.token}`;
      try {
        await navigator.clipboard.writeText(link);
        showToast('Sözleşme oluşturuldu ve imza linki panoya kopyalandı!', 'ok');
      } catch {
        showToast('Sözleşme oluşturuldu!', 'ok');
      }
    }
    resetEditor();
    await loadDashboardData();
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('tab-contracts').classList.toggle('hidden', tab !== 'contracts');
    document.getElementById('tab-notifications').classList.toggle('hidden', tab !== 'notifications');
    document.getElementById('tab-settings').classList.toggle('hidden', tab !== 'settings');
  });
});

els.settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nextSettings = {
    webhookUrl: els.sWebhook.value,
    telegramBotToken: els.sTgToken.value,
    telegramChatId: els.sTgChat.value,
    notifyOnOpen: els.sNotifyOpen.checked,
    notifyOnSign: els.sNotifySign.checked
  };
  try {
    if (isFirebaseHosting()) {
      await fbStore.updateSettings(nextSettings);
    } else {
      await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(nextSettings)
      });
    }
    showToast('Bildirim ayarları kaydedildi.', 'ok');
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

els.testNotifBtn.addEventListener('click', async () => {
  try {
    const res = isFirebaseHosting()
      ? await fbStore.sendTestNotification()
      : await apiFetch('/api/admin/settings/test', { method: 'POST' });
    showToast(`Test gönderildi (Webhook: ${res.results.webhook}, Telegram: ${res.results.telegram})`, 'ok');
    await loadDashboardData();
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

// Başlangıç kontrolü
(async function init() {
  try {
    const status = isFirebaseHosting()
      ? await fbStore.getAdminStatus()
      : await apiFetch('/api/admin/status');
    state.initialized = status.initialized;
    state.authenticated = status.authenticated;
    if (state.authenticated) {
      await enterDashboard();
    } else {
      renderAuthView();
    }
  } catch (err) {
    renderAuthView();
    showToast(err.message, 'danger');
  }
})();

