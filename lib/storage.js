import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { generatePin, generateToken, hashSecret, safeCompare, verifySecret } from './auth.js';
import { buildArchiveHtml, sanitizeSignatureDataUrl } from './render.js';

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalContentHash(contract) {
  return sha256Hex(
    JSON.stringify({
      title: contract.title,
      creatorName: contract.creatorName,
      body: contract.body
    })
  );
}

function canonicalDocumentHash({ id, contentHash, signerName, signerContact, signedAt, signatureDigest }) {
  return sha256Hex(
    JSON.stringify({
      id,
      contentHash,
      signerName,
      signerContact: signerContact || '',
      signedAt,
      signatureDigest
    })
  );
}

export class Storage {
  /**
   * @param {string} dataDir
   */
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir);
    this.archivesDir = path.join(this.dataDir, 'archives');
    this.localExportDir = path.join(path.dirname(this.dataDir), 'imzalanan_sozlesmeler');
    this.configPath = path.join(this.dataDir, 'config.json');
    this.dbPath = path.join(this.dataDir, 'db.json');
    this.writeQueue = Promise.resolve();
    this.config = null;
    this.db = null;
  }

  async init() {
    await fs.mkdir(this.archivesDir, { recursive: true });
    await fs.mkdir(this.localExportDir, { recursive: true });

    try {
      const rawCfg = await fs.readFile(this.configPath, 'utf8');
      this.config = JSON.parse(rawCfg);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.config = {
        sessionSecret: crypto.randomBytes(32).toString('hex'),
        adminPasswordHash: null,
        settings: {
          webhookUrl: '',
          telegramBotToken: '',
          telegramChatId: '',
          notifyOnOpen: true,
          notifyOnSign: true
        }
      };
      await this.#atomicWriteJson(this.configPath, this.config);
    }

    // Ortam değişkeni ile yönetici parolası verilmişse başlangıç kurulumunu otomatik yap
    if (!this.config.adminPasswordHash && process.env.ADMIN_PASSWORD) {
      this.config.adminPasswordHash = hashSecret(process.env.ADMIN_PASSWORD);
      await this.#atomicWriteJson(this.configPath, this.config);
    }

    if (!this.config.settings) {
      this.config.settings = {
        webhookUrl: '',
        telegramBotToken: '',
        telegramChatId: '',
        notifyOnOpen: true,
        notifyOnSign: true
      };
    }

    try {
      const rawDb = await fs.readFile(this.dbPath, 'utf8');
      this.db = JSON.parse(rawDb);
      if (!Array.isArray(this.db.contracts)) this.db.contracts = [];
      if (!Array.isArray(this.db.notifications)) this.db.notifications = [];
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.db = { contracts: [], notifications: [] };
      await this.#atomicWriteJson(this.dbPath, this.db);
    }
  }

  #enqueue(fn) {
    const next = this.writeQueue.then(fn, fn);
    this.writeQueue = next.catch(() => {});
    return next;
  }

  async #atomicWriteJson(targetPath, data) {
    const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmpPath, targetPath);
  }

  isInitialized() {
    return Boolean(this.config?.adminPasswordHash);
  }

  getSessionSecret() {
    return this.config.sessionSecret;
  }

  async setupAdminPassword(password) {
    return this.#enqueue(async () => {
      if (this.config.adminPasswordHash) {
        throw new Error('ALREADY_INITIALIZED');
      }
      this.config.adminPasswordHash = hashSecret(password);
      await this.#atomicWriteJson(this.configPath, this.config);
    });
  }

  verifyAdminPassword(password) {
    if (!this.config?.adminPasswordHash) return false;
    return verifySecret(password, this.config.adminPasswordHash);
  }

  getSettings() {
    const s = this.config.settings || {};
    return {
      webhookUrl: s.webhookUrl || '',
      telegramBotToken: s.telegramBotToken || '',
      telegramChatId: s.telegramChatId || '',
      notifyOnOpen: s.notifyOnOpen !== false,
      notifyOnSign: s.notifyOnSign !== false
    };
  }

  async updateSettings(nextSettings) {
    return this.#enqueue(async () => {
      this.config.settings = {
        webhookUrl: String(nextSettings.webhookUrl || '').trim(),
        telegramBotToken: String(nextSettings.telegramBotToken || '').trim(),
        telegramChatId: String(nextSettings.telegramChatId || '').trim(),
        notifyOnOpen: Boolean(nextSettings.notifyOnOpen),
        notifyOnSign: nextSettings.notifyOnSign !== false
      };
      await this.#atomicWriteJson(this.configPath, this.config);
      return this.getSettings();
    });
  }

  listContracts() {
    return [...this.db.contracts].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  listNotifications(limit = 30) {
    return [...this.db.notifications]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  async addNotification(entry) {
    return this.#enqueue(async () => {
      const record = {
        id: `ntf_${crypto.randomBytes(6).toString('hex')}`,
        createdAt: new Date().toISOString(),
        ...entry
      };
      this.db.notifications.unshift(record);
      if (this.db.notifications.length > 100) {
        this.db.notifications = this.db.notifications.slice(0, 100);
      }
      await this.#atomicWriteJson(this.dbPath, this.db);
      return record;
    });
  }

  findById(id) {
    return this.db.contracts.find((c) => c.id === id) || null;
  }

  findByToken(token) {
    return this.db.contracts.find((c) => safeCompare(c.token, token)) || null;
  }

  async createContract({ title, creatorName, recipientName, body, requirePin, autoBurnAfterSign }) {
    return this.#enqueue(async () => {
      const now = new Date().toISOString();
      const pinCode = requirePin ? generatePin() : null;
      const contract = {
        id: `SZL-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
        token: generateToken(24),
        title: title.trim(),
        creatorName: creatorName.trim(),
        recipientName: (recipientName || '').trim(),
        body: body.trim(),
        requirePin: Boolean(requirePin),
        autoBurnAfterSign: autoBurnAfterSign !== false,
        pinCode,
        status: 'pending', // pending | viewed | signed | revoked
        createdAt: now,
        updatedAt: now,
        firstViewedAt: null,
        viewCount: 0,
        signature: null,
        archiveFile: null
      };
      this.db.contracts.push(contract);
      await this.#atomicWriteJson(this.dbPath, this.db);
      return contract;
    });
  }

  async updateContract(id, { title, creatorName, recipientName, body, requirePin, regeneratePin, autoBurnAfterSign }) {
    return this.#enqueue(async () => {
      const idx = this.db.contracts.findIndex((c) => c.id === id);
      if (idx === -1) return { error: 'NOT_FOUND' };
      const existing = this.db.contracts[idx];
      if (existing.status === 'signed') {
        return { error: 'IMMUTABLE_SIGNED' };
      }

      let pinCode = existing.pinCode;
      if (requirePin) {
        if (!pinCode || regeneratePin) {
          pinCode = generatePin();
        }
      } else {
        pinCode = null;
      }

      const updated = {
        ...existing,
        title: title.trim(),
        creatorName: creatorName.trim(),
        recipientName: (recipientName || '').trim(),
        body: body.trim(),
        requirePin: Boolean(requirePin),
        autoBurnAfterSign: autoBurnAfterSign !== undefined ? Boolean(autoBurnAfterSign) : (existing.autoBurnAfterSign !== false),
        pinCode,
        updatedAt: new Date().toISOString()
      };
      this.db.contracts[idx] = updated;
      await this.#atomicWriteJson(this.dbPath, this.db);
      return { contract: updated };
    });
  }

  async revokeContract(id) {
    return this.#enqueue(async () => {
      const idx = this.db.contracts.findIndex((c) => c.id === id);
      if (idx === -1) return { error: 'NOT_FOUND' };
      if (this.db.contracts[idx].status === 'signed') {
        return { error: 'IMMUTABLE_SIGNED' };
      }
      this.db.contracts[idx].status = 'revoked';
      this.db.contracts[idx].updatedAt = new Date().toISOString();
      await this.#atomicWriteJson(this.dbPath, this.db);
      return { contract: this.db.contracts[idx] };
    });
  }

  async deleteContract(id) {
    return this.#enqueue(async () => {
      const idx = this.db.contracts.findIndex((c) => c.id === id);
      if (idx === -1) return { error: 'NOT_FOUND' };
      const [removed] = this.db.contracts.splice(idx, 1);
      if (removed.archiveFile) {
        const archivePath = path.join(this.archivesDir, removed.archiveFile);
        await fs.unlink(archivePath).catch(() => {});
      }
      await this.#atomicWriteJson(this.dbPath, this.db);
      return { deleted: removed };
    });
  }

  async recordView(token) {
    return this.#enqueue(async () => {
      const contract = this.findByToken(token);
      if (!contract) return { error: 'NOT_FOUND' };
      const isFirstOpen = !contract.firstViewedAt;
      if (isFirstOpen) {
        contract.firstViewedAt = new Date().toISOString();
      }
      contract.viewCount = (contract.viewCount || 0) + 1;
      if (contract.status === 'pending') {
        contract.status = 'viewed';
      }
      contract.updatedAt = new Date().toISOString();
      await this.#atomicWriteJson(this.dbPath, this.db);
      return { contract, isFirstOpen };
    });
  }

  async signContract(token, { signerName, signerContact, pinInput, signatureType, imageDataUrl, typedSignature, consentChecked, ipAddress, userAgent }) {
    return this.#enqueue(async () => {
      const contract = this.findByToken(token);
      if (!contract) return { error: 'NOT_FOUND' };
      if (contract.status === 'revoked') return { error: 'REVOKED' };
      if (contract.status === 'signed') return { error: 'ALREADY_SIGNED' };
      if (!consentChecked) return { error: 'CONSENT_REQUIRED' };

      if (contract.requirePin) {
        if (!pinInput || !safeCompare(String(pinInput).trim(), String(contract.pinCode || ''))) {
          return { error: 'INVALID_PIN' };
        }
      }

      const cleanName = String(signerName || '').trim();
      if (cleanName.length < 2) return { error: 'INVALID_NAME' };

      let cleanImage = null;
      let cleanTyped = null;

      if (signatureType === 'typed') {
        cleanTyped = String(typedSignature || cleanName).trim();
        if (cleanTyped.length < 2) return { error: 'INVALID_SIGNATURE' };
      } else {
        cleanImage = sanitizeSignatureDataUrl(imageDataUrl);
        if (!cleanImage) return { error: 'INVALID_SIGNATURE' };
      }

      const signedAt = new Date().toISOString();
      const contentHash = canonicalContentHash(contract);
      const signatureDigest = sha256Hex(cleanImage || cleanTyped);
      const documentHash = canonicalDocumentHash({
        id: contract.id,
        contentHash,
        signerName: cleanName,
        signerContact: String(signerContact || '').trim(),
        signedAt,
        signatureDigest
      });

      contract.status = 'signed';
      contract.updatedAt = signedAt;
      if (!contract.firstViewedAt) {
        contract.firstViewedAt = signedAt;
      }
      contract.signature = {
        signerName: cleanName,
        signerContact: String(signerContact || '').trim(),
        signatureType: cleanImage ? 'drawn' : 'typed',
        imageDataUrl: cleanImage,
        typedSignature: cleanTyped,
        pinVerified: Boolean(contract.requirePin),
        consentAccepted: true,
        signedAt,
        ipAddress: ipAddress || 'bilinmiyor',
        userAgent: String(userAgent || '').slice(0, 300),
        contentHash,
        signatureDigest,
        documentHash
      };

      const archiveFile = `${contract.id}.html`;
      const archiveHtml = buildArchiveHtml(contract);
      const archivePath = path.join(this.archivesDir, archiveFile);
      const tmpArchive = `${archivePath}.${process.pid}.tmp`;
      await fs.writeFile(tmpArchive, archiveHtml, 'utf8');
      await fs.rename(tmpArchive, archivePath);

      // Kullanıcının masaüstündeki "imzalanan_sozlesmeler" klasörüne de doğrudan kaydet
      const safeTitle = (contract.title || 'sozlesme')
        .replace(/[^a-zA-Z0-9çÇğĞıİöÖşŞüÜ_-]/g, '_')
        .slice(0, 40);
      const localFileName = `${contract.id}_${safeTitle}.html`;
      const localFilePath = path.join(this.localExportDir, localFileName);
      await fs.writeFile(localFilePath, archiveHtml, 'utf8').catch(() => {});

      contract.archiveFile = archiveFile;
      contract.localFileName = localFileName;
      await this.#atomicWriteJson(this.dbPath, this.db);
      return { contract };
    });
  }

  async readArchiveHtml(token) {
    const contract = this.findByToken(token);
    if (!contract || contract.status !== 'signed') return null;
    if (contract.archiveFile) {
      try {
        return await fs.readFile(path.join(this.archivesDir, contract.archiveFile), 'utf8');
      } catch {
        // Dosya elle silindiyse yeniden üret
      }
    }
    return buildArchiveHtml(contract);
  }

  verifyDocument({ documentId, hash }) {
    const queryId = String(documentId || '').trim().toUpperCase();
    const queryHash = String(hash || '').trim().toLowerCase();

    let match = null;
    if (queryId && queryHash) {
      match = this.db.contracts.find(
        (c) =>
          c.status === 'signed' &&
          c.id.toUpperCase() === queryId &&
          (c.signature?.documentHash === queryHash || c.signature?.contentHash === queryHash)
      );
    } else if (queryHash) {
      match = this.db.contracts.find(
        (c) =>
          c.status === 'signed' &&
          (c.signature?.documentHash === queryHash || c.signature?.contentHash === queryHash)
      );
    } else if (queryId) {
      match = this.db.contracts.find(
        (c) => c.status === 'signed' && c.id.toUpperCase() === queryId
      );
    }

    if (!match) return { valid: false };

    const recomputedContentHash = canonicalContentHash(match);
    const sigPayload = match.signature.imageDataUrl || match.signature.typedSignature;
    const recomputedSigDigest = sha256Hex(sigPayload);
    const recomputedDocHash = canonicalDocumentHash({
      id: match.id,
      contentHash: recomputedContentHash,
      signerName: match.signature.signerName,
      signerContact: match.signature.signerContact,
      signedAt: match.signature.signedAt,
      signatureDigest: recomputedSigDigest
    });

    const integrityOk =
      recomputedContentHash === match.signature.contentHash &&
      recomputedDocHash === match.signature.documentHash;

    return {
      valid: integrityOk,
      integrityOk,
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
}

