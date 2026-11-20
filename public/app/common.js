export function formatDateTr(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return String(isoString);
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(d);
}

/**
 * Metni güvenli DOM düğümlerine dönüştürür (XSS riski olmadan başlık, madde, liste ve **kalın** desteği).
 * @param {HTMLElement} container
 * @param {string} rawText
 */
export function renderFormattedContractText(container, rawText) {
  container.replaceChildren();
  const lines = String(rawText || '').replace(/\r\n/g, '\n').split('\n');
  let currentList = null;

  const appendInline = (parent, text) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    for (const part of parts) {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        const strong = document.createElement('strong');
        strong.textContent = part.slice(2, -2);
        parent.appendChild(strong);
      } else if (part) {
        parent.appendChild(document.createTextNode(part));
      }
    }
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      currentList = null;
      continue;
    }

    if (/^#{1,3}\s+/.test(trimmed)) {
      currentList = null;
      const tag = trimmed.startsWith('### ') ? 'h4' : trimmed.startsWith('## ') ? 'h3' : 'h2';
      const el = document.createElement(tag);
      el.className = 'doc-heading';
      appendInline(el, trimmed.replace(/^#{1,3}\s+/, ''));
      container.appendChild(el);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      if (!currentList) {
        currentList = document.createElement('ul');
        currentList.className = 'doc-list';
        container.appendChild(currentList);
      }
      const li = document.createElement('li');
      appendInline(li, trimmed.replace(/^[-*]\s+/, ''));
      currentList.appendChild(li);
      continue;
    }

    currentList = null;
    const p = document.createElement('p');
    p.className = /^(MADDE\s+\d+|Madde\s+\d+|\d+\.)/.test(trimmed) ? 'doc-clause' : 'doc-paragraph';
    appendInline(p, trimmed);
    container.appendChild(p);
  }
}

export function showToast(message, variant = 'info') {
  let stack = document.getElementById('toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toast-stack';
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${variant === 'ok' ? 'toast-ok' : variant === 'danger' ? 'toast-danger' : ''}`;
  toast.textContent = message;
  stack.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 5000);
}

export async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `İstek başarısız (${res.status})`);
  }
  return data;
}

