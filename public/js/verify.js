import { apiFetch, formatDateTr } from './common.js';

const form = document.getElementById('verify-form');
const vId = document.getElementById('v-id');
const vHash = document.getElementById('v-hash');
const resultBox = document.getElementById('verify-result');

async function runVerify(documentId, hash) {
  resultBox.classList.add('hidden');
  resultBox.replaceChildren();

  try {
    const res = await apiFetch('/api/verify', {
      method: 'POST',
      body: JSON.stringify({ documentId, hash })
    });

    const alert = document.createElement('div');
    if (res.valid && res.document) {
      alert.className = 'alert alert-ok';
      const title = document.createElement('strong');
      title.textContent = 'Doğrulama Başarılı: Belge geçerli ve bütünlüğü korunmuştur.';
      alert.appendChild(title);

      const details = document.createElement('div');
      details.className = 'audit-box';
      details.style.marginTop = '12px';

      const rows = [
        ['Belge No', res.document.id],
        ['Başlık', res.document.title],
        ['Düzenleyen', res.document.creatorName],
        ['İmzalayan', res.document.signerName],
        ['İmzalanma Zamanı', formatDateTr(res.document.signedAt)],
        ['Metin SHA-256', res.document.contentHash],
        ['Belge Bütünlük SHA-256', res.document.documentHash]
      ];
      for (const [k, v] of rows) {
        const row = document.createElement('div');
        row.className = 'audit-row';
        const label = document.createElement('span');
        label.textContent = k;
        const val = document.createElement('span');
        val.className = k.includes('SHA-256') || k === 'Belge No' ? 'mono' : '';
        val.textContent = v;
        row.append(label, val);
        details.appendChild(row);
      }
      resultBox.append(alert, details);
    } else {
      alert.className = 'alert alert-danger';
      alert.textContent = 'Eşleşen geçerli bir imzalı belge bulunamadı veya belge bütünlüğü doğrulanamadı.';
      resultBox.appendChild(alert);
    }
    resultBox.classList.remove('hidden');
  } catch (err) {
    const alert = document.createElement('div');
    alert.className = 'alert alert-danger';
    alert.textContent = err.message;
    resultBox.appendChild(alert);
    resultBox.classList.remove('hidden');
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  runVerify(vId.value.trim(), vHash.value.trim());
});

const params = new URLSearchParams(window.location.search);
if (params.get('id') || params.get('hash')) {
  vId.value = params.get('id') || '';
  vHash.value = params.get('hash') || '';
  runVerify(vId.value.trim(), vHash.value.trim());
}

