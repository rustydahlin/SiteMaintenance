'use strict';

const { getPool, sql } = require('../config/database');
const { writeAudit }   = require('./auditModel');
const logger           = require('../utils/logger');
const crypto           = require('crypto');

// ── Encryption ────────────────────────────────────────────────────────────────
// Keys that are encrypted at rest in AppSettings (IsEncrypted = 1)
const ENCRYPTED_KEYS = new Set(['ldap.bindCredentials', 'oidc.clientSecret', 'email.password', 'towerMap.apiKey']);

// Derive a 32-byte key from SETTINGS_ENCRYPTION_KEY env var (or fall back to SESSION_SECRET).
// Using SHA-256 so any-length passphrase becomes a valid AES-256 key.
function getEncryptionKey() {
  const passphrase = process.env.SETTINGS_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!passphrase) throw new Error('SETTINGS_ENCRYPTION_KEY (or SESSION_SECRET) must be set to encrypt sensitive settings.');
  return crypto.createHash('sha256').update(passphrase).digest(); // 32 bytes
}

function encrypt(plaintext) {
  const key = getEncryptionKey();
  const iv  = crypto.randomBytes(12); // 96-bit IV for AES-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store as hex: iv:tag:ciphertext
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(stored) {
  try {
    const parts = stored.split(':');
    if (parts.length !== 3) return stored; // not encrypted format — return as-is
    const [ivHex, tagHex, dataHex] = parts;
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(Buffer.from(dataHex, 'hex')) + decipher.final('utf8');
  } catch {
    // Decryption failed (wrong key, or value was stored before encryption was enabled)
    logger.warn('settingsModel: failed to decrypt a setting — returning raw value');
    return stored;
  }
}

// ── Cache ─────────────────────────────────────────────────────────────────────
let _cache     = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 60 * 1000;

async function getAllSettings() {
  const now = Date.now();
  if (_cache && (now - _cacheTime) < CACHE_TTL_MS) return _cache;

  const pool   = await getPool();
  const result = await pool.request().query('SELECT SettingKey, SettingValue, IsEncrypted FROM AppSettings');

  const map = {};
  for (const row of result.recordset) {
    const val = (row.IsEncrypted && row.SettingValue) ? decrypt(row.SettingValue) : row.SettingValue;
    map[row.SettingKey] = val;
  }

  _cache     = map;
  _cacheTime = now;
  return map;
}

async function getSetting(key, envKey = null) {
  const settings = await getAllSettings();
  const dbVal    = settings[key];
  if (dbVal !== null && dbVal !== undefined && dbVal !== '') return dbVal;
  return envKey ? (process.env[envKey] || null) : null;
}

async function getSettingsBool(key, envKey = null) {
  const val = await getSetting(key, envKey);
  return val === '1' || val === 'true';
}

async function upsert(key, value, userID = null, auditContext = {}) {
  const pool        = await getPool();
  const shouldEncrypt = ENCRYPTED_KEYS.has(key) && value !== '';
  const storedValue   = shouldEncrypt ? encrypt(value) : value;
  const isEncrypted   = shouldEncrypt ? 1 : 0;

  // Mask sensitive keys in audit log
  const SENSITIVE  = ['clientSecret', 'bindCredentials', 'password', 'Password', 'apiKey'];
  const isSensitive = SENSITIVE.some(s => key.toLowerCase().includes(s.toLowerCase()));
  const auditValue  = isSensitive ? '••••••' : value;

  await pool.request()
    .input('Key',         sql.NVarChar(100), key)
    .input('Value',       sql.NVarChar(sql.MAX), storedValue)
    .input('IsEncrypted', sql.Bit, isEncrypted)
    .input('UserID',      sql.Int, userID || null)
    .query(`
      IF EXISTS (SELECT 1 FROM AppSettings WHERE SettingKey = @Key)
        UPDATE AppSettings
        SET SettingValue = @Value, IsEncrypted = @IsEncrypted,
            UpdatedAt = GETUTCDATE(), UpdatedByUserID = @UserID
        WHERE SettingKey = @Key
      ELSE
        INSERT INTO AppSettings (SettingKey, SettingValue, IsEncrypted, UpdatedByUserID)
        VALUES (@Key, @Value, @IsEncrypted, @UserID)
    `);

  _cache     = null;
  _cacheTime = 0;

  await writeAudit({ tableName: 'AppSettings', action: 'UPDATE',
    newValues: { key, value: auditValue },
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent });

  logger.info(`AppSetting updated: ${key} by userID=${userID}`);
}

function bustCache() {
  _cache     = null;
  _cacheTime = 0;
}

module.exports = { getAllSettings, getSetting, getSettingsBool, upsert, bustCache };
