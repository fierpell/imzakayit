import { apiFetch, formatDateTr, renderFormattedContractText, showToast } from './common.js';
import { fbStore, isFirebaseHosting } from './firebase-store.js';

const token = window.location.pathname.split('/').filter(Boolean).pop();

const state = {
  contract: null,
  signatureType: 'drawn',
  strokes: [],
  currentStroke: null,
  drawing: false
};

const els = {
  loadingCard: document.getElementById('loading-card'),
  errorCard: document.getElementById('error-card'),
  errorMessage: document.getElementById('error-message'),
  signContainer: document.getElementById('sign-container'),
  docTitle: document.getElementById('doc-title'),
  docMeta: document.getElementById('doc-meta'),
  docStatusBadge: document.getElementById('doc-status-badge'),
  docBody: document.getElementById('doc-body'),
  alreadySignedCard: document.getElementById('already-signed-card'),
  signedSummaryText: document.getElementById('signed-summary-text'),
  archiveViewLink: document.getElementById('archive-view-link'),
  archiveDownloadLink: document.getElementById('archive-download-link'),
  revokedCard: document.getElementById('revoked-card'),
  signFormCard: document.getElementById('sign-form-card'),
  signForm: document.getElementById('sign-form'),
  formError: document.getElementById('form-error'),
  signerName: document.getElementById('signer-name'),
  signerContact: document.getElementById('signer-contact'),
  pinGroup: document.getElementById('pin-group'),
  pinCode: document.getElementById('pin-code'),
  modeDrawBtn: document.getElementById('mode-draw-btn'),
  modeTypeBtn: document.getElementById('mode-type-btn'),
  drawBox: document.getElementById('draw-signature-box'),
  typedBox: document.getElementById('typed-signature-box'),
  sigCanvas: document.getElementById('sig-canvas'),
  sigPlaceholder: document.getElementById('sig-placeholder'),
  sigUndoBtn: document.getElementById('sig-undo-btn'),
  sigClearBtn: document.getElementById('sig-clear-btn'),
  typedInput: document.getElementById('typed-signature-input'),
  typedPreview: document.getElementById('typed-signature-preview'),
  consentCheckbox: document.getElementById('consent-checkbox'),
  submitBtn: document.getElementById('submit-sign-btn')
};

// --- HiDPI İmza Kanvası ---
function resizeCanvas() {
  const canvas = els.sigCanvas;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  redrawCanvas();
}

function redrawCanvas() {
  const canvas = els.sigCanvas;
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);

  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const stroke of state.strokes) {
    if (stroke.length === 0) continue;
    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);
    if (stroke.length === 1) {
      ctx.lineTo(stroke[0].x + 0.1, stroke[0].y + 0.1);
    } else {
      for (let i = 1; i < stroke.length; i += 1) {
        ctx.lineTo(stroke[i].x, stroke[i].y);
      }
    }
    ctx.stroke();
  }

  els.sigPlaceholder.classList.toggle('hidden', state.strokes.length > 0);
}

function pointerPos(event) {
  const rect = els.sigCanvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function initSignaturePad() {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  els.sigCanvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    els.sigCanvas.setPointerCapture(e.pointerId);
    state.drawing = true;
    const pt = pointerPos(e);
    state.currentStroke = [pt];
    state.strokes.push(state.currentStroke);
    redrawCanvas();
  });

  els.sigCanvas.addEventListener('pointermove', (e) => {
    if (!state.drawing || !state.currentStroke) return;
    e.preventDefault();
    state.currentStroke.push(pointerPos(e));
    redrawCanvas();
  });

  const endStroke = () => {
    state.drawing = false;
    state.currentStroke = null;
  };
  els.sigCanvas.addEventListener('pointerup', endStroke);
  els.sigCanvas.addEventListener('pointercancel', endStroke);

  els.sigUndoBtn.addEventListener('click', () => {
    state.strokes.pop();
    redrawCanvas();
  });

  els.sigClearBtn.addEventListener('click', () => {
    state.strokes = [];
    redrawCanvas();
  });
}

function setSignatureMode(mode) {
  state.signatureType = mode;
  const isDraw = mode === 'drawn';
  els.drawBox.classList.toggle('hidden', !isDraw);
  els.typedBox.classList.toggle('hidden', isDraw);
  els.modeDrawBtn.className = `btn btn-sm ${isDraw ? 'btn-primary' : 'btn-secondary'}`;
  els.modeTypeBtn.className = `btn btn-sm ${!isDraw ? 'btn-primary' : 'btn-secondary'}`;
  if (isDraw) {
    resizeCanvas();
  } else {
    const fallbackName = els.typedInput.value.trim() || els.signerName.value.trim() || 'Ad Soyad';
    if (!els.typedInput.value.trim() && els.signerName.value.trim()) {
      els.typedInput.value = els.signerName.value.trim();
    }
    els.typedPreview.textContent = fallbackName;
  }
}

function renderContractState(contract) {
  state.contract = contract;
  els.loadingCard.classList.add('hidden');
  els.signContainer.classList.remove('hidden');

  els.docTitle.textContent = contract.title;
  els.docMeta.textContent = `Belge No: ${contract.id} • Düzenleyen: ${contract.creatorName} • Oluşturulma: ${formatDateTr(contract.createdAt)}`;
  renderFormattedContractText(els.docBody, contract.body);

  els.alreadySignedCard.classList.add('hidden');
  els.revokedCard.classList.add('hidden');
  els.signFormCard.classList.add('hidden');

  if (contract.burned || (contract.status === 'signed' && contract.autoBurnAfterSign)) {
    els.docStatusBadge.className = 'badge badge-signed';
    els.docStatusBadge.textContent = 'İmzalandı & Kapatıldı';
    els.docBody.innerHTML = '<div class="alert alert-info" style="margin:12px 0;">🔒 <strong>Bu sözleşme başarıyla imzalanmış ve güvenlik amacıyla internet erişimine kapatılmıştır.</strong><br><span style="font-size:13px;color:var(--muted);">Belge tarafların yerel arşivine kaydedilmiştir.</span></div>';
    els.alreadySignedCard.classList.remove('hidden');
    els.signedSummaryText.textContent = `İmza Zamanı: ${formatDateTr(contract.signedAt)} • Güvenliğiniz için web erişimi sonlandırılmıştır.`;
    els.archiveViewLink.classList.add('hidden');
    els.archiveDownloadLink.classList.add('hidden');
    return;
  }

  if (contract.status === 'signed') {
    els.docStatusBadge.className = 'badge badge-signed';
    els.docStatusBadge.textContent = 'İmzalandı';
    els.signedSummaryText.textContent = `İmzalayan: ${contract.signerName || '—'} • Tarih: ${formatDateTr(contract.signedAt)} • Belge Özeti: ${contract.documentHash || '—'}`;
    els.archiveViewLink.classList.remove('hidden');
    els.archiveDownloadLink.classList.remove('hidden');
    els.archiveViewLink.href = `/arsiv/${contract.token}`;
    els.archiveDownloadLink.href = `/api/archive/${contract.token}/download`;
    els.alreadySignedCard.classList.remove('hidden');
    return;
  }

  if (contract.status === 'revoked') {
    els.docStatusBadge.className = 'badge badge-revoked';
    els.docStatusBadge.textContent = 'İptal Edildi';
    els.revokedCard.classList.remove('hidden');
    return;
  }

  els.docStatusBadge.className = 'badge badge-pending';
  els.docStatusBadge.textContent = 'İmza Bekliyor';
  els.signFormCard.classList.remove('hidden');

  if (contract.recipientName && !els.signerName.value) {
    els.signerName.value = contract.recipientName;
    els.typedPreview.textContent = contract.recipientName;
  }

  if (contract.requirePin) {
    els.pinGroup.classList.remove('hidden');
    els.pinCode.required = true;
  } else {
    els.pinGroup.classList.add('hidden');
    els.pinCode.required = false;
  }

  requestAnimationFrame(() => resizeCanvas());
}

els.modeDrawBtn.addEventListener('click', () => setSignatureMode('drawn'));
els.modeTypeBtn.addEventListener('click', () => setSignatureMode('typed'));

els.typedInput.addEventListener('input', () => {
  els.typedPreview.textContent = els.typedInput.value.trim() || 'Ad Soyad';
});

els.signerName.addEventListener('input', () => {
  if (!els.typedInput.value.trim()) {
    els.typedPreview.textContent = els.signerName.value.trim() || 'Ad Soyad';
  }
});

els.signForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.formError.classList.add('hidden');

  if (state.signatureType === 'drawn' && state.strokes.length === 0) {
    els.formError.textContent = 'Lütfen imza alanına parmağınızla veya farenizle imza çizin.';
    els.formError.classList.remove('hidden');
    return;
  }

  const typedVal = els.typedInput.value.trim() || els.signerName.value.trim();
  if (state.signatureType === 'typed' && typedVal.length < 2) {
    els.formError.textContent = 'Lütfen geçerli bir yazılı imza adı girin.';
    els.formError.classList.remove('hidden');
    return;
  }

  const payload = {
    signerName: els.signerName.value.trim(),
    signerContact: els.signerContact.value.trim(),
    pinCode: els.pinCode.value.trim(),
    signatureType: state.signatureType,
    imageDataUrl: state.signatureType === 'drawn' ? els.sigCanvas.toDataURL('image/png') : null,
    typedSignature: state.signatureType === 'typed' ? typedVal : null,
    consentChecked: els.consentCheckbox.checked
  };

  els.submitBtn.disabled = true;
  els.submitBtn.textContent = 'Kaydediliyor...';

  try {
    const result = isFirebaseHosting()
      ? await fbStore.submitSignature(token, payload)
      : await apiFetch(`/api/sign/${encodeURIComponent(token)}/submit`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
    showToast('Sözleşme başarıyla imzalandı!', 'ok');
    renderContractState({
      ...state.contract,
      status: 'signed',
      burned: state.contract.autoBurnAfterSign !== false,
      signerName: payload.signerName,
      signedAt: result.signedAt,
      documentHash: result.documentHash
    });
  } catch (err) {
    els.formError.textContent = err.message;
    els.formError.classList.remove('hidden');
  } finally {
    els.submitBtn.disabled = false;
    els.submitBtn.textContent = 'Dijital Olarak İmzala ve Gönder';
  }
});

(async function init() {
  initSignaturePad();
  try {
    const contract = isFirebaseHosting()
      ? await fbStore.getPublicContractForSign(token)
      : (await apiFetch(`/api/sign/${encodeURIComponent(token)}`)).contract;
    renderContractState(contract);
  } catch (err) {
    els.loadingCard.classList.add('hidden');
    els.errorMessage.textContent = err.message;
    els.errorCard.classList.remove('hidden');
  }
})();

