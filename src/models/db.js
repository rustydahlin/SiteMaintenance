'use strict';

// Thin wrapper around the mssql pool for parameterized queries.
// Usage:
//   const { query, transaction } = require('./db');
//   const rows = await query('SELECT * FROM Sites WHERE SiteID = @id', { id: [sql.Int, 5] });

const { getPool, sql } = require('../config/database');

/**
 * Execute a parameterized query and return the recordset.
 * @param {string} queryText
 * @param {Object} params  — { paramName: [sqlType, value], ... }
 * @returns {Array}
 */
async function query(queryText, params = {}) {
  const pool = await getPool();
  const request = pool.request();
  for (const [name, [type, value]] of Object.entries(params)) {
    request.input(name, type, value);
  }
  const result = await request.query(queryText);
  return result.recordset;
}

/**
 * Execute a query and return the first row (or null).
 */
async function queryOne(queryText, params = {}) {
  const rows = await query(queryText, params);
  return rows[0] || null;
}

/**
 * Execute an INSERT and return the new identity value.
 */
async function insert(queryText, params = {}) {
  const pool = await getPool();
  const request = pool.request();
  for (const [name, [type, value]] of Object.entries(params)) {
    request.input(name, type, value);
  }
  const result = await request.query(queryText + '; SELECT SCOPE_IDENTITY() AS NewID');
  return result.recordset[0].NewID;
}

/**
 * Get a transaction object. Caller must call t.begin(), t.commit(), t.rollback().
 * Use t.request() to create parameterized requests within the transaction.
 */
async function getTransaction() {
  const pool = await getPool();
  return new sql.Transaction(pool);
}

module.exports = { query, queryOne, insert, getTransaction, sql };
