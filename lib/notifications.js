import { formatDateTr } from './render.js';

export class NotificationCenter {
  constructor(storage) {
    this.storage = storage;
    this.sseClients = new Set();
  }

  addClient(res) {
    this.sseClients.add(res);
    const keepAlive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(keepAlive);
        this.sseClients.delete(res);
      }
    }, 25_000);

    res.on('close', () => {
      clearInterval(keepAlive);
      this.sseClients.delete(res);
    });
  }

  broadcast(eventName, payload) {
    const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of this.sseClients) {
      try {
        res.write(data);
      } catch {
        this.sseClients.delete(res);
      }
    }
  }

  async notify({ type, contract, baseUrl, extra = {} }) {
    const settings = this.storage.getSettings();
    const shouldPushExternal =
      (type === 'contract.opened' && settings.notifyOnOpen) ||
      (type === 'contract.signed' && settings.notifyOnSign) ||
      type === 'notification.test';

    const message = this.#buildMessage({ type, contract, baseUrl, extra });

    const saved = await this.storage.addNotification({
      type,
      contractId: contract?.id || null,
      contractToken: contract?.token || null,
      localFileName: contract?.localFileName || null,
      title: contract?.title || 'Test Bildirimi',
      message
    });

    this.broadcast('notification', saved);
    if (contract) {
      this.broadcast('contract_updated', { id: contract.id, status: contract.status });
    }

    if (shouldPushExternal) {
      this.#dispatchExternal(settings, { type, message, contract, baseUrl, extra }).catch(() => {});
    }

    return saved;
  }

  async sendTest(baseUrl) {
    const settings = this.storage.getSettings();
    const message = 'Test bildirimi başarılı: Sözleşme imza bildirim kanallarınız aktif.';
    const results = { webhook: 'skipped', telegram: 'skipped' };

    if (settings.webhookUrl) {
      results.webhook = await this.#postWebhook(settings.webhookUrl, {
        event: 'notification.test',
        message,
        timestamp: new Date().toISOString(),
        baseUrl
      });
    }

    if (settings.telegramBotToken && settings.telegramChatId) {
      results.telegram = await this.#postTelegram(
        settings.telegramBotToken,
        settings.telegramChatId,
        message
      );
    }

    const saved = await this.storage.addNotification({
      type: 'notification.test',
      contractId: null,
      title: 'Test Bildirimi',
      message
    });
    this.broadcast('notification', saved);

    return { saved, results };
  }

  #buildMessage({ type, contract, baseUrl }) {
    if (type === 'contract.opened') {
      return `"${contract.title}" (${contract.id}) bağlantısı görüntülendi.`;
    }
    if (type === 'contract.signed') {
      const signer = contract.signature?.signerName || 'İmzalayan';
      const time = formatDateTr(contract.signature?.signedAt);
      const archiveUrl = baseUrl ? `${baseUrl}/arsiv/${contract.token}` : '';
      return `"${contract.title}" (${contract.id}) ${signer} tarafından imzalandı (${time}).${archiveUrl ? ` Arşiv: ${archiveUrl}` : ''}`;
    }
    return 'Sistem bildirimi';
  }

  async #dispatchExternal(settings, { type, message, contract, baseUrl }) {
    const tasks = [];

    if (settings.webhookUrl) {
      const payload = {
        event: type,
        text: message,
        content: message,
        timestamp: new Date().toISOString(),
        contract: contract
          ? {
              id: contract.id,
              title: contract.title,
              status: contract.status,
              signerName: contract.signature?.signerName || null,
              signedAt: contract.signature?.signedAt || null,
              documentHash: contract.signature?.documentHash || null,
              archiveUrl: baseUrl ? `${baseUrl}/arsiv/${contract.token}` : null
            }
          : null
      };
      tasks.push(this.#postWebhook(settings.webhookUrl, payload));
    }

    if (settings.telegramBotToken && settings.telegramChatId) {
      tasks.push(this.#postTelegram(settings.telegramBotToken, settings.telegramChatId, message));
    }

    await Promise.allSettled(tasks);
  }

  async #postWebhook(rawUrl, payload) {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return 'invalid_url';
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return 'invalid_protocol';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(parsed.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      return res.ok ? 'ok' : `http_${res.status}`;
    } catch {
      return 'network_error';
    } finally {
      clearTimeout(timer);
    }
  }

  async #postTelegram(botToken, chatId, text) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const endpoint = `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true
        }),
        signal: controller.signal
      });
      return res.ok ? 'ok' : `http_${res.status}`;
    } catch {
      return 'network_error';
    } finally {
      clearTimeout(timer);
    }
  }
}

