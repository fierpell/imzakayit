import { apiFetch, formatDateTr, renderFormattedContractText } from './common.js';
import { fbStore, isFirebaseHosting, triggerArchiveDownload } from './firebase-store.js';

const token = window.location.pathname.split('/').filter(Boolean).pop();

const els = {
  loadingCard: document.getElementById('loading-card'),
  errorCard: document.getElementById('error-card'),
  errorMessage: document.getElementById('error-message'),
  archiveContainer: document.getElementById('archive-container'),
  verifyNavLink: document.getElementById('verify-nav-link'),
  printPdfBtn: document.getElementById('print-pdf-btn'),
  downloadHtmlBtn: document.getElementById('download-html-btn'),
  downloadJsonBtn: document.getElementById('download-json-btn'),
  aTitle: document.getElementById('a-title'),
  aId: document.getElementById('a-id'),
  aCreator: document.getElementById('a-creator'),
  aSigner: document.getElementById('a-signer'),
  aSignedAt: document.getElementById('a-signed-at'),
  aBody: document.getElementById('a-body'),
  aSigName: document.getElementById('a-sig-name'),
  aSigContactWrap: document.getElementById('a-sig-contact-wrap'),
  aSigContact: document.getElementById('a-sig-contact'),
  aSigMethod: document.getElementById('a-sig-method'),
  aSigVisual: document.getElementById('a-sig-visual'),
  aCreatedAt: document.getElementById('a-created-at'),
  aViewedAt: document.getElementById('a-viewed-at'),
  aAuditSignedAt: document.getElementById('a-audit-signed-at'),
  aIp: document.getElementById('a-ip'),
  aUa: document.getElementById('a-ua'),
  aContentHash: document.getElementById('a-content-hash'),
  aDocHash: document.getElementById('a-doc-hash')
};

function renderArchive(doc) {
  const sig = doc.signature || {};
  els.loadingCard.classList.add('hidden');
  els.archiveContainer.classList.remove('hidden');

  document.title = `${doc.title} — İmzalı Belge Arşivi`;
  els.aTitle.textContent = doc.title;
  els.aId.textContent = `Belge No: ${doc.id}`;
  els.aCreator.textContent = doc.creatorName;
  els.aSigner.textContent = sig.signerName || doc.recipientName || '—';
  els.aSignedAt.textContent = formatDateTr(sig.signedAt);

  renderFormattedContractText(els.aBody, doc.body);

  els.aSigName.textContent = sig.signerName || '—';
  if (sig.signerContact) {
    els.aSigContact.textContent = sig.signerContact;
    els.aSigContactWrap.classList.remove('hidden');
  }
  els.aSigMethod.textContent = sig.pinVerified
    ? '6 Haneli Onay Kodu + Dijital İmza'
    : 'Bağlantı + Dijital İmza';

  els.aSigVisual.replaceChildren();
  if (
    typeof sig.imageDataUrl === 'string' &&
    /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig.imageDataUrl)
  ) {
    const img = document.createElement('img');
    img.src = sig.imageDataUrl;
    img.alt = 'Dijital İmza';
    img.style.maxWidth = '100%';
    img.style.maxHeight = '105px';
    img.style.objectFit = 'contain';
    els.aSigVisual.appendChild(img);
  } else {
    const typed = document.createElement('span');
    typed.style.fontFamily = 'Georgia, "Times New Roman", serif';
    typed.style.fontStyle = 'italic';
    typed.style.fontSize = '26px';
    typed.textContent = sig.typedSignature || sig.signerName || '';
    els.aSigVisual.appendChild(typed);
  }

  els.aCreatedAt.textContent = formatDateTr(doc.createdAt);
  els.aViewedAt.textContent = formatDateTr(doc.firstViewedAt);
  els.aAuditSignedAt.textContent = formatDateTr(sig.signedAt);
  els.aIp.textContent = sig.ipAddress || '—';
  els.aUa.textContent = sig.userAgent || '—';
  els.aContentHash.textContent = sig.contentHash || '—';
  els.aDocHash.textContent = sig.documentHash || '—';

  if (isFirebaseHosting()) {
    els.downloadHtmlBtn.addEventListener('click', (e) => {
      e.preventDefault();
      triggerArchiveDownload(doc);
    });
  } else {
    els.downloadHtmlBtn.href = `/api/archive/${encodeURIComponent(token)}/download`;
  }
  els.verifyNavLink.href = `/dogrula?id=${encodeURIComponent(doc.id)}&hash=${encodeURIComponent(sig.documentHash || '')}`;

  els.printPdfBtn.addEventListener('click', () => window.print());
  els.downloadJsonBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.id}-kanit-kaydi.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

(async function init() {
  try {
    const archive = isFirebaseHosting()
      ? await fbStore.getArchive(token)
      : (await apiFetch(`/api/archive/${encodeURIComponent(token)}`)).archive;
    renderArchive(archive);
  } catch (err) {
    els.loadingCard.classList.add('hidden');
    els.errorMessage.textContent = err.message;
    els.errorCard.classList.remove('hidden');
  }
})();

