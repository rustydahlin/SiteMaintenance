'use strict';

const sql = require('mssql');
const logger = require('../utils/logger');

const config = {
  server:   process.env.DB_SERVER   || 'localhost',
  database: process.env.DB_DATABASE || 'SiteMaintenance',
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port:     parseInt(process.env.DB_PORT || '1433', 10),
  options: {
    encrypt:              process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === 'true',
    enableArithAbort:     true,
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

module.exports = { getPool, closePool, sql };
