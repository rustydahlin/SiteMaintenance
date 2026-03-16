'use strict';

const { getPool, sql } = require('../config/database');
const { writeAudit }   = require('./auditModel');
const logger           = require('../utils/logger');

// In-memory cache with TTL to avoid hammering DB on every auth check
let _cache     = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

async function getAllSettings() {
  const now = Date.now();
  if (_cache && (now - _cacheTime) < CACHE_TTL_MS) return _cache;

  const pool   = await getPool();
  const result = await pool.request().query('SELECT SettingKey, SettingValue FROM AppSettings');

  const map = {};
  for (const row of result.recordset) {
    map[row.SettingKey] = row.SettingValue;
  }

  _cache     = map;
  _cacheTime = now;
  return map;
}

/**
 * Get a single setting value, falling back to env var if DB value is empty.
 * envKey is optional; pass it to enable the .env fallback.
 */
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
  const pool = await getPool();

  // Mask sensitive keys in audit log
  const SENSITIVE = ['clientSecret', 'bindCredentials', 'password', 'Password'];
  const isSensitive = SENSITIVE.some(s => key.toLowerCase().includes(s.toLowerCase()));
  const auditValue  = isSensitive ? '••••••' : value;

  await pool.request()
    .input('Key',    sql.NVarChar(100), key)
    .input('Value',  sql.NVarChar(sql.MAX), value)
    .input('UserID', sql.Int, userID || null)
    .query(`
      IF EXISTS (SELECT 1 FROM AppSettings WHERE SettingKey = @Key)
        UPDATE AppSettings SET SettingValue = @Value, UpdatedAt = GETUTCDATE(), UpdatedByUserID = @UserID
        WHERE SettingKey = @Key
      ELSE
        INSERT INTO AppSettings (SettingKey, SettingValue, UpdatedByUserID)
        VALUES (@Key, @Value, @UserID)
    `);

  // Bust cache
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
