'use strict';

const { getPool, sql } = require('../config/database');
const { writeAudit }   = require('./auditModel');

const SORT_COLUMNS = {
  site:       's.SiteName',
  type:       't.TypeName',
  assignedTo: 'u.DisplayName',
  dueDate:    'm.DueDate',
  createdAt:  'm.CreatedAt',
  status:     'm.ClosedAt',
};

async function getAll({ siteID, assignedToUserID, open, closed, overdueOnly, sort = 'dueDate', dir = 'asc', page = 1, pageSize = 50 } = {}) {
  const pool = await getPool();
  const req  = pool.request();
  const conditions = ['m.IsActive = 1'];

  if (siteID) {
    conditions.push('m.SiteID = @SiteID');
    req.input('SiteID', sql.Int, siteID);
  }
  if (assignedToUserID) {
    conditions.push('m.AssignedToUserID = @AssignedToUserID');
    req.input('AssignedToUserID', sql.Int, assignedToUserID);
  }
  if (open === true || open === 1) {
    conditions.push('m.ClosedAt IS NULL');
  }
  if (closed === true || closed === 1) {
    conditions.push('m.ClosedAt IS NOT NULL');
  }
  if (overdueOnly) {
    conditions.push('m.ClosedAt IS NULL AND m.DueDate IS NOT NULL AND m.DueDate < CAST(GETUTCDATE() AS DATE)');
  }

  const orderCol = SORT_COLUMNS[sort] || 'm.DueDate';
  const orderDir = dir === 'desc' ? 'DESC' : 'ASC';

  const where  = conditions.join(' AND ');
  const offset = (page - 1) * pageSize;
  req.input('Offset',   sql.Int, offset);
  req.input('PageSize', sql.Int, pageSize);

  const countReq = pool.request();
  if (siteID)           countReq.input('SiteID',           sql.Int, siteID);
  if (assignedToUserID) countReq.input('AssignedToUserID', sql.Int, assignedToUserID);

  const countResult = await countReq.query(`
    SELECT COUNT(*) AS Total
    FROM MaintenanceItems m
    WHERE ${where}
  `);
  const total = countResult.recordset[0].Total;

  const result = await req.query(`
    SELECT
      m.MaintenanceID, m.SiteID, m.AssignedToUserID, m.MaintenanceTypeID,
      m.DueDate, m.ExternalReference, m.WorkToComplete,
      m.ClosedAt, m.ClosedByUserID, m.ClosureNotes,
      m.IsActive, m.CreatedAt, m.CreatedByUserID,
      s.SiteName,
      t.TypeName    AS MaintenanceTypeName,
      u.DisplayName AS AssignedToUserName,
      u.Email       AS AssignedToUserEmail,
      cb.DisplayName AS ClosedByUserName,
      cr.DisplayName AS CreatedByUserName
    FROM MaintenanceItems m
    JOIN Sites            s  ON s.SiteID              = m.SiteID
    LEFT JOIN MaintenanceTypes t  ON t.MaintenanceTypeID = m.MaintenanceTypeID
    LEFT JOIN Users        u  ON u.UserID              = m.AssignedToUserID
    LEFT JOIN Users        cb ON cb.UserID             = m.ClosedByUserID
    LEFT JOIN Users        cr ON cr.UserID             = m.CreatedByUserID
    WHERE ${where}
    ORDER BY ${orderCol} ${orderDir}, m.CreatedAt DESC
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
  `);

  return {
    rows: result.recordset,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

async function getByID(maintenanceID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('MaintenanceID', sql.Int, maintenanceID)
    .query(`
      SELECT
        m.MaintenanceID, m.SiteID, m.AssignedToUserID, m.MaintenanceTypeID,
        m.DueDate, m.ExternalReference, m.WorkToComplete,
        m.ClosedAt, m.ClosedByUserID, m.ClosureNotes,
        m.IsActive, m.CreatedAt, m.CreatedByUserID,
        CASE WHEN m.ClosedAt IS NULL AND m.DueDate IS NOT NULL
             THEN DATEDIFF(day, CAST(m.DueDate AS DATE), CAST(GETUTCDATE() AS DATE))
             ELSE 0 END AS DaysOverdue,
        s.SiteName,
        t.TypeName    AS MaintenanceTypeName,
        u.DisplayName AS AssignedToUserName,
        u.Email       AS AssignedToUserEmail,
        cb.DisplayName AS ClosedByUserName,
        cr.DisplayName AS CreatedByUserName
      FROM MaintenanceItems m
      JOIN Sites            s  ON s.SiteID              = m.SiteID
      LEFT JOIN MaintenanceTypes t  ON t.MaintenanceTypeID = m.MaintenanceTypeID
      LEFT JOIN Users        u  ON u.UserID              = m.AssignedToUserID
      LEFT JOIN Users        cb ON cb.UserID             = m.ClosedByUserID
      LEFT JOIN Users        cr ON cr.UserID             = m.CreatedByUserID
      WHERE m.MaintenanceID = @MaintenanceID
    `);
  return result.recordset[0] || null;
}

async function create(data, auditContext = {}) {
  const { siteID, assignedToUserID, maintenanceTypeID, dueDate, externalReference, workToComplete } = data;

  const pool = await getPool();
  const result = await pool.request()
    .input('SiteID',            sql.Int,             siteID)
    .input('AssignedToUserID',  sql.Int,             assignedToUserID   || null)
    .input('MaintenanceTypeID', sql.Int,             maintenanceTypeID  || null)
    .input('DueDate',           sql.Date,            dueDate ? new Date(dueDate) : null)
    .input('ExternalReference', sql.NVarChar(100),   externalReference  || null)
    .input('WorkToComplete',    sql.NVarChar(sql.MAX), workToComplete   || null)
    .input('CreatedByUserID',   sql.Int,             auditContext.userID || null)
    .query(`
      INSERT INTO MaintenanceItems
        (SiteID, AssignedToUserID, MaintenanceTypeID, DueDate,
         ExternalReference, WorkToComplete, CreatedByUserID)
      VALUES
        (@SiteID, @AssignedToUserID, @MaintenanceTypeID, @DueDate,
         @ExternalReference, @WorkToComplete, @CreatedByUserID);
      SELECT SCOPE_IDENTITY() AS NewID
    `);

  const newID = result.recordset[0].NewID;
  await writeAudit({
    tableName: 'MaintenanceItems', recordID: newID, action: 'INSERT',
    newValues: data,
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
  return getByID(newID);
}

async function update(maintenanceID, data, auditContext = {}) {
  const { siteID, assignedToUserID, maintenanceTypeID, dueDate, externalReference, workToComplete } = data;

  const pool = await getPool();
  const old  = await getByID(maintenanceID);

  await pool.request()
    .input('MaintenanceID',    sql.Int,             maintenanceID)
    .input('SiteID',           sql.Int,             siteID)
    .input('AssignedToUserID', sql.Int,             assignedToUserID   || null)
    .input('MaintenanceTypeID',sql.Int,             maintenanceTypeID  || null)
    .input('DueDate',          sql.Date,            dueDate ? new Date(dueDate) : null)
    .input('ExternalReference',sql.NVarChar(100),   externalReference  || null)
    .input('WorkToComplete',   sql.NVarChar(sql.MAX), workToComplete   || null)
    .query(`
      UPDATE MaintenanceItems SET
        SiteID            = @SiteID,
        AssignedToUserID  = @AssignedToUserID,
        MaintenanceTypeID = @MaintenanceTypeID,
        DueDate           = @DueDate,
        ExternalReference = @ExternalReference,
        WorkToComplete    = @WorkToComplete
      WHERE MaintenanceID = @MaintenanceID
    `);

  await writeAudit({
    tableName: 'MaintenanceItems', recordID: maintenanceID, action: 'UPDATE',
    oldValues: old, newValues: data,
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
  return getByID(maintenanceID);
}

async function close(maintenanceID, closureNotes, auditContext = {}) {
  const pool = await getPool();
  await pool.request()
    .input('MaintenanceID',  sql.Int,             maintenanceID)
    .input('ClosedByUserID', sql.Int,             auditContext.userID || null)
    .input('ClosureNotes',   sql.NVarChar(sql.MAX), closureNotes || null)
    .query(`
      UPDATE MaintenanceItems SET
        ClosedAt        = GETUTCDATE(),
        ClosedByUserID  = @ClosedByUserID,
        ClosureNotes    = @ClosureNotes
      WHERE MaintenanceID = @MaintenanceID
    `);

  await writeAudit({
    tableName: 'MaintenanceItems', recordID: maintenanceID, action: 'CLOSE',
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
  return getByID(maintenanceID);
}

async function softDelete(maintenanceID, auditContext = {}) {
  const pool = await getPool();
  await pool.request()
    .input('MaintenanceID', sql.Int, maintenanceID)
    .query('UPDATE MaintenanceItems SET IsActive = 0 WHERE MaintenanceID = @MaintenanceID');

  await writeAudit({
    tableName: 'MaintenanceItems', recordID: maintenanceID, action: 'DELETE',
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
}

// Returns open items due within the next N days (for reminder emails).
// Also returns items that are already past due where LastReminderAt is null or
// >= intervalDays days ago, so we don't flood the assigned user.
async function getOpenForReminders(intervalDays) {
  const pool = await getPool();
  const result = await pool.request()
    .input('IntervalDays', sql.Int, intervalDays)
    .query(`
      SELECT
        m.MaintenanceID, m.SiteID, m.DueDate, m.ExternalReference, m.WorkToComplete,
        s.SiteName,
        t.TypeName    AS MaintenanceTypeName,
        u.DisplayName AS AssignedToUserName,
        u.Email       AS AssignedToUserEmail,
        DATEDIFF(day, CAST(GETUTCDATE() AS DATE), m.DueDate) AS DaysUntilDue
      FROM MaintenanceItems m
      JOIN Sites            s ON s.SiteID             = m.SiteID
      LEFT JOIN MaintenanceTypes t ON t.MaintenanceTypeID = m.MaintenanceTypeID
      LEFT JOIN Users        u ON u.UserID             = m.AssignedToUserID
      WHERE m.IsActive = 1
        AND m.ClosedAt IS NULL
        AND m.DueDate IS NOT NULL
        AND m.AssignedToUserID IS NOT NULL
        AND u.Email IS NOT NULL
        AND DATEDIFF(day, CAST(GETUTCDATE() AS DATE), m.DueDate) <= @IntervalDays
    `);
  return result.recordset;
}

// Returns open items past their due date (for overdue reminder emails).
async function getOverdueForReminders(intervalDays) {
  if (intervalDays <= 0) return [];
  const pool = await getPool();
  const result = await pool.request()
    .input('IntervalDays', sql.Int, intervalDays)
    .query(`
      SELECT
        m.MaintenanceID, m.SiteID, m.DueDate, m.ExternalReference, m.WorkToComplete,
        s.SiteName,
        t.TypeName    AS MaintenanceTypeName,
        u.DisplayName AS AssignedToUserName,
        u.Email       AS AssignedToUserEmail,
        ABS(DATEDIFF(day, CAST(GETUTCDATE() AS DATE), m.DueDate)) AS DaysOverdue
      FROM MaintenanceItems m
      JOIN Sites            s ON s.SiteID             = m.SiteID
      LEFT JOIN MaintenanceTypes t ON t.MaintenanceTypeID = m.MaintenanceTypeID
      LEFT JOIN Users        u ON u.UserID             = m.AssignedToUserID
      WHERE m.IsActive = 1
        AND m.ClosedAt IS NULL
        AND m.DueDate IS NOT NULL
        AND m.AssignedToUserID IS NOT NULL
        AND u.Email IS NOT NULL
        AND m.DueDate < CAST(GETUTCDATE() AS DATE)
        AND (ABS(DATEDIFF(day, CAST(GETUTCDATE() AS DATE), m.DueDate)) % @IntervalDays) = 0
    `);
  return result.recordset;
}

module.exports = {
  getAll,
  getByID,
  create,
  update,
  close,
  softDelete,
  getOpenForReminders,
  getOverdueForReminders,
};
