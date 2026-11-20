/**
 * Güvenli HTML kaçış fonksiyonu (XSS koruması).
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Tarih dizgesini Türkçe yerel biçime çevirir.
 * @param {string|null|undefined} isoString
 * @returns {string}
 */
export function formatDateTr(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return escapeHtml(isoString);
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'long',
    timeStyle: 'medium',
    timeZone: 'Europe/Istanbul'
  }).format(d);
}

/**
 * Güvenli biçimde sözleşme metnini yapılandırılmış HTML'e dönüştürür.
 * Önce tüm metin escape edilir, ardından yalnızca satır içi **kalın** ve başlık/liste biçimleri uygulanır.
 * @param {string} rawText
 * @returns {string}
 */
export function formatContractTextToHtml(rawText) {
  const safe = escapeHtml(rawText || '');
  const lines = safe.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inList = false;

  const formatInline = (line) =>
    line.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
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
      const level = trimmed.startsWith('### ') ? 'h4' : trimmed.startsWith('## ') ? 'h3' : 'h2';
      const content = trimmed.replace(/^#{1,3}\s+/, '');
      out.push(`<${level} class="doc-heading">${formatInline(content)}</${level}>`);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      if (!inList) {
        out.push('<ul class="doc-list">');
        inList = true;
      }
      const item = trimmed.replace(/^[-*]\s+/, '');
      out.push(`<li>${formatInline(item)}</li>`);
      continue;
    }

    if (inList) {
      out.push('</ul>');
      inList = false;
    }

    if (/^(MADDE\s+\d+|Madde\s+\d+|\d+\.)/.test(trimmed)) {
      out.push(`<p class="doc-clause">${formatInline(trimmed)}</p>`);
    } else {
      out.push(`<p class="doc-paragraph">${formatInline(trimmed)}</p>`);
    }
  }

  if (inList) {
    out.push('</ul>');
  }

  return out.join('\n');
}

/**
 * Yalnızca güvenli PNG/JPEG data URL imzalarını kabul eder.
 * @param {string|null|undefined} dataUrl
 * @returns {string|null}
 */
export function sanitizeSignatureDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const trimmed = dataUrl.trim();
  if (/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length <= 600_000) {
    return trimmed;
  }
  return null;
}

/**
 * Çevrimdışı saklanabilen, tek dosya (self-contained) imzalı belge HTML arşivi üretir.
 * @param {object} contract
 * @returns {string}
 */
export function buildArchiveHtml(contract) {
  const sig = contract.signature || {};
  const safeSigImg = sanitizeSignatureDataUrl(sig.imageDataUrl);
  const bodyHtml = formatContractTextToHtml(contract.body);

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>İmzalı Belge Arşivi — ${escapeHtml(contract.title)}</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #0f172a;
      --muted: #475569;
      --border: #cbd5e1;
      --bg: #f8fafc;
      --accent: #1d4ed8;
      --ok-bg: #ecfdf5;
      --ok-ink: #065f46;
      --ok-border: #a7f3d0;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 32px 16px;
      background: var(--bg);
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.65;
    }
    .sheet {
      max-width: 820px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 40px 44px;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      border-bottom: 2px solid var(--ink);
      padding-bottom: 18px;
      margin-bottom: 24px;
    }
    .header h1 {
      margin: 0 0 6px 0;
      font-size: 24px;
      line-height: 1.25;
    }
    .doc-id {
      font-size: 13px;
      color: var(--muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 700;
      background: var(--ok-bg);
      color: var(--ok-ink);
      border: 1px solid var(--ok-border);
      white-space: nowrap;
    }
    .parties {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      background: #f8fafc;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 16px;
      margin-bottom: 24px;
      font-size: 14px;
    }
    .parties strong { display: block; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
    .content {
      margin-bottom: 32px;
      font-size: 15px;
    }
    .doc-heading { margin: 20px 0 8px; font-size: 17px; color: var(--ink); }
    .doc-clause { margin: 12px 0; }
    .doc-paragraph { margin: 10px 0; }
    .doc-list { margin: 8px 0 12px 20px; padding: 0; }
    .doc-list li { margin: 4px 0; }
    .signature-box {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 20px;
      background: #ffffff;
      margin-bottom: 24px;
    }
    .signature-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 20px;
      align-items: center;
    }
    .sig-visual {
      border: 1px dashed #94a3b8;
      border-radius: 8px;
      padding: 12px;
      min-height: 120px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #fcfcfd;
    }
    .sig-visual img {
      max-width: 100%;
      max-height: 110px;
      object-fit: contain;
    }
    .sig-typed {
      font-family: Georgia, "Times New Roman", serif;
      font-style: italic;
      font-size: 26px;
      color: #1e293b;
    }
    .audit {
      background: #f1f5f9;
      border-radius: 8px;
      padding: 16px 18px;
      font-size: 12.5px;
      color: var(--muted);
    }
    .audit h3 {
      margin: 0 0 10px 0;
      font-size: 13px;
      color: var(--ink);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .audit-row {
      display: grid;
      grid-template-columns: 165px 1fr;
      gap: 8px;
      padding: 4px 0;
      border-bottom: 1px solid #e2e8f0;
      word-break: break-word;
    }
    .audit-row:last-child { border-bottom: none; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .disclaimer {
      margin-top: 18px;
      font-size: 11.5px;
      color: #64748b;
      text-align: center;
    }
    @media print {
      body { background: #ffffff; padding: 0; }
      .sheet { border: none; box-shadow: none; padding: 12mm; max-width: none; }
    }
  </style>
</head>
<body>
  <article class="sheet">
    <header class="header">
      <div>
        <h1>${escapeHtml(contract.title)}</h1>
        <div class="doc-id">Belge No: ${escapeHtml(contract.id)}</div>
      </div>
      <div class="badge">&#10003; Dijital Onaylı Belge</div>
    </header>

    <section class="parties">
      <div>
        <strong>Düzenleyen / Gönderen</strong>
        <span>${escapeHtml(contract.creatorName)}</span>
      </div>
      <div>
        <strong>İmzalayan Taraf</strong>
        <span>${escapeHtml(sig.signerName || contract.recipientName || '—')}</span>
      </div>
      <div>
        <strong>İmza Tarihi</strong>
        <span>${escapeHtml(formatDateTr(sig.signedAt))}</span>
      </div>
    </section>

    <section class="content">
      ${bodyHtml}
    </section>

    <section class="signature-box">
      <div class="signature-grid">
        <div>
          <p style="margin:0 0 6px 0;"><strong>İmzalayan:</strong> ${escapeHtml(sig.signerName)}</p>
          ${sig.signerContact ? `<p style="margin:0 0 6px 0;"><strong>İletişim:</strong> ${escapeHtml(sig.signerContact)}</p>` : ''}
          <p style="margin:0 0 6px 0;"><strong>Doğrulama:</strong> ${sig.pinVerified ? '6 Haneli Onay Kodu + Dijital İmza' : 'Bağlantı + Dijital İmza'}</p>
          <p style="margin:0;color:#065f46;font-size:13px;">&#10003; "Okudum, anladım ve onaylıyorum" beyanı işaretlendi.</p>
        </div>
        <div class="sig-visual">
          ${safeSigImg
            ? `<img src="${safeSigImg}" alt="Dijital İmza" />`
            : `<span class="sig-typed">${escapeHtml(sig.typedSignature || sig.signerName)}</span>`}
        </div>
      </div>
    </section>

    <section class="audit">
      <h3>Denetim İzi ve Bütünlük Kanıtı</h3>
      <div class="audit-row"><span>Belge Oluşturulma</span><span>${escapeHtml(formatDateTr(contract.createdAt))}</span></div>
      <div class="audit-row"><span>İlk Görüntülenme</span><span>${escapeHtml(formatDateTr(contract.firstViewedAt))}</span></div>
      <div class="audit-row"><span>İmzalanma Zamanı</span><span>${escapeHtml(formatDateTr(sig.signedAt))}</span></div>
      <div class="audit-row"><span>İmzalayan IP</span><span class="mono">${escapeHtml(sig.ipAddress || '—')}</span></div>
      <div class="audit-row"><span>Tarayıcı / Cihaz</span><span>${escapeHtml(sig.userAgent || '—')}</span></div>
      <div class="audit-row"><span>Metin SHA-256</span><span class="mono">${escapeHtml(sig.contentHash || '—')}</span></div>
      <div class="audit-row"><span>Belge Bütünlük SHA-256</span><span class="mono">${escapeHtml(sig.documentHash || '—')}</span></div>
    </section>

    <p class="disclaimer">
      Bu arşiv dosyası dijital onay ve zaman damgası kaydı içerir. 5070 sayılı Elektronik İmza Kanunu kapsamındaki nitelikli elektronik imza (e-İmza / Mobil İmza) yerine geçmez.
    </p>
  </article>
</body>
</html>`;
}

