'use strict';

const sql = require('mssql');
const logger = require('../utils/logger');

// Select DB vars by environment: NODE_ENV=production uses PROD_DB_* prefix, everything else uses DEV_DB_*.
// Falls back to unprefixed DB_* if the prefixed var is absent (backwards-compatible with existing .env).
const isProd = (process.env.NODE_ENV || '').trim() === 'production';
const dbPrefix = isProd ? 'PROD_DB_' : 'DEV_DB_';
const dbVar = (name) => process.env[dbPrefix + name] ?? process.env['DB_' + name];

const config = {
  server:   dbVar('SERVER')   || 'localhost',
  database: dbVar('DATABASE') || 'SiteMaintenance',
  user:     dbVar('USER'),
  password: dbVar('PASSWORD'),
  port:     parseInt(dbVar('PORT') || '1433', 10),
  options: {
    encrypt:                dbVar('ENCRYPT') === 'true',
    trustServerCertificate: dbVar('TRUST_SERVER_CERT') === 'true',
    enableArithAbort:       true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
  connectionTimeout: 15000,
  requestTimeout:    30000,
};

let pool = null;
let poolConnecting = false;
let connectPromise = null;

async function getPool() {
  if (pool && pool.connected) return pool;

  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    try {
      poolConnecting = true;
      logger.info('Connecting to SQL Server...');
      pool = await new sql.ConnectionPool(config).connect();
      logger.info(`Connected to SQL Server: ${config.server}/${config.database}`);

      pool.on('error', (err) => {
        logger.error('SQL Server pool error:', err);
        pool = null;
        connectPromise = null;
      });

      return pool;
    } catch (err) {
      pool = null;
      connectPromise = null;
      logger.error('SQL Server connection failed:', err.message);
      throw err;
    } finally {
      poolConnecting = false;
    }
  })();

  return connectPromise;
}

async function closePool() {
  if (pool) {
    await pool.close();
    pool = null;
    connectPromise = null;
    logger.info('SQL Server pool closed');
  }
}

module.exports = { getPool, closePool, sql, dbVar };
