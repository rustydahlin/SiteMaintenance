'use strict';

const { getPool, sql } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Write an audit log record.
 * @param {Object} opts
 * @param {string} opts.tableName
 * @param {number|null} opts.recordID
 * @param {string} opts.action   — e.g. 'INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT'
 * @param {number|null} opts.userID
 * @param {Object|null} opts.oldValues
 * @param {Object|null} opts.newValues
 * @param {string|null} opts.ip
 * @param {string|null} opts.userAgent
 * @param {string|null} opts.notes
 * @param {sql.Transaction|null} opts.transaction — pass open transaction to include in same tx
 */
async function writeAudit({
  tableName, recordID = null, action,
  userID = null, oldValues = null, newValues = null,
  ip = null, userAgent = null, notes = null,
  transaction = null,
}) {
  try {
    const pool = await getPool();
    const request = transaction
      ? new sql.Request(transaction)
      : pool.request();

    request.input('TableName',  sql.NVarChar(100), tableName);
    request.input('RecordID',   sql.Int,            recordID);
    request.input('Action',     sql.NVarChar(50),   action);
    request.input('UserID',     sql.Int,            userID);
    request.input('OldValues',  sql.NVarChar(sql.MAX), oldValues ? JSON.stringify(oldValues) : null);
    request.input('NewValues',  sql.NVarChar(sql.MAX), newValues ? JSON.stringify(newValues) : null);
    request.input('IPAddress',  sql.NVarChar(45),   ip);
    request.input('UserAgent',  sql.NVarChar(500),  userAgent);
    request.input('Notes',      sql.NVarChar(500),  notes);

    await request.query(`
      INSERT INTO AuditLog
        (TableName, RecordID, Action, ChangedByUserID, OldValues, NewValues, IPAddress, UserAgent, Notes)
      VALUES
        (@TableName, @RecordID, @Action, @UserID, @OldValues, @NewValues, @IPAddress, @UserAgent, @Notes)
    `);
  } catch (err) {
    // Never throw — audit failures must not break the main operation
    logger.error('AuditLog write failed:', err.message);
  }
}

/**
 * Get audit log entries with optional filters, paginated.
 */
async function getAuditLog({ tableName, userID, action, dateFrom, dateTo, page = 1, pageSize = 50 } = {}) {
  const pool = await getPool();
  const request = pool.request();
  const conditions = ['1=1'];

  if (tableName) {
    conditions.push('a.TableName = @TableName');
    request.input('TableName', sql.NVarChar(100), tableName);
  }
  if (userID) {
    conditions.push('a.ChangedByUserID = @UserID');
    request.input('UserID', sql.Int, userID);
  }
  if (action) {
    conditions.push('a.Action = @Action');
    request.input('Action', sql.NVarChar(50), action);
  }
  if (dateFrom) {
    conditions.push('a.ChangedAt >= @DateFrom');
    request.input('DateFrom', sql.DateTime2, new Date(dateFrom));
  }
  if (dateTo) {
    conditions.push('a.ChangedAt <= @DateTo');
    request.input('DateTo', sql.DateTime2, new Date(dateTo + 'T23:59:59'));
  }

  const offset = (page - 1) * pageSize;
  request.input('Offset',   sql.Int, offset);
  request.input('PageSize', sql.Int, pageSize);

  const where = conditions.join(' AND ');

  const countResult = await pool.request().query(
    `SELECT COUNT(*) AS Total FROM AuditLog a WHERE ${where}`
  );
  const total = countResult.recordset[0].Total;

  const rows = await request.query(`
    SELECT a.AuditID, a.TableName, a.RecordID, a.Action,
           a.ChangedAt, a.OldValues, a.NewValues, a.IPAddress, a.Notes,
           u.DisplayName AS ChangedByName
    FROM AuditLog a
    LEFT JOIN Users u ON u.UserID = a.ChangedByUserID
    WHERE ${where}
    ORDER BY a.ChangedAt DESC
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
  `);

  return { rows: rows.recordset, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

module.exports = { writeAudit, getAuditLog };
