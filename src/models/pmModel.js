'use strict';

const { getPool, sql } = require('../config/database');
const { writeAudit }   = require('./auditModel');

// NextDueDate: DATEADD(day, FrequencyDays, LastPerformedAt)
// When LastPerformedAt IS NULL the schedule is immediately overdue — use GETUTCDATE() as the base.
const NEXT_DUE_EXPR = `
  DATEADD(day, pm.FrequencyDays,
    ISNULL(pm.LastPerformedAt, GETUTCDATE()))
`;

const DAYS_UNTIL_DUE_EXPR = `
  DATEDIFF(day, GETUTCDATE(),
    DATEADD(day, pm.FrequencyDays,
      ISNULL(pm.LastPerformedAt, GETUTCDATE())))
`;

async function getBySite(siteID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('SiteID', sql.Int, siteID)
    .query(`
      SELECT
        pm.ScheduleID, pm.SiteID, pm.Title, pm.FrequencyDays,
        pm.LastPerformedAt, pm.AssignedUserID, pm.AssignedVendorID, pm.Notes, pm.CreatedAt,
        u.DisplayName AS AssignedUserName,
        v.VendorName  AS AssignedVendorName,
        ${NEXT_DUE_EXPR}      AS NextDueDate,
        ${DAYS_UNTIL_DUE_EXPR} AS DaysUntilDue
      FROM PMSchedules pm
      LEFT JOIN Users   u ON u.UserID   = pm.AssignedUserID
      LEFT JOIN Vendors v ON v.VendorID = pm.AssignedVendorID
      WHERE pm.SiteID = @SiteID
      ORDER BY NextDueDate
    `);
  return result.recordset;
}

async function getByID(scheduleID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('ScheduleID', sql.Int, scheduleID)
    .query(`
      SELECT
        pm.ScheduleID, pm.SiteID, pm.Title, pm.FrequencyDays,
        pm.LastPerformedAt, pm.AssignedUserID, pm.AssignedVendorID, pm.Notes, pm.CreatedAt,
        u.DisplayName AS AssignedUserName,
        v.VendorName  AS AssignedVendorName,
        ${NEXT_DUE_EXPR}      AS NextDueDate,
        ${DAYS_UNTIL_DUE_EXPR} AS DaysUntilDue
      FROM PMSchedules pm
      LEFT JOIN Users   u ON u.UserID   = pm.AssignedUserID
      LEFT JOIN Vendors v ON v.VendorID = pm.AssignedVendorID
      WHERE pm.ScheduleID = @ScheduleID
    `);
  return result.recordset[0] || null;
}

async function create(data, auditContext = {}) {
  const { siteID, title, frequencyDays, lastPerformedAt, assignedUserID, assignedVendorID, notes } = data;

  const pool = await getPool();
  const result = await pool.request()
    .input('SiteID',            sql.Int,            siteID)
    .input('Title',             sql.NVarChar(300),  title)
    .input('FrequencyDays',     sql.Int,            frequencyDays)
    .input('LastPerformedAt',   sql.DateTime2,      lastPerformedAt ? new Date(lastPerformedAt) : null)
    .input('AssignedUserID',    sql.Int,            assignedUserID   || null)
    .input('AssignedVendorID',  sql.Int,            assignedVendorID || null)
    .input('Notes',             sql.NVarChar(sql.MAX), notes         || null)
    .query(`
      INSERT INTO PMSchedules (SiteID, Title, FrequencyDays, LastPerformedAt, AssignedUserID, AssignedVendorID, Notes)
      VALUES (@SiteID, @Title, @FrequencyDays, @LastPerformedAt, @AssignedUserID, @AssignedVendorID, @Notes);
      SELECT SCOPE_IDENTITY() AS NewID
    `);

  const newID = result.recordset[0].NewID;
  await writeAudit({
    tableName: 'PMSchedules', recordID: newID, action: 'INSERT',
    newValues: data,
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
  return getByID(newID);
}

async function update(scheduleID, data, auditContext = {}) {
  const { siteID, title, frequencyDays, lastPerformedAt, assignedUserID, assignedVendorID, notes } = data;

  const pool = await getPool();
  const old  = await getByID(scheduleID);

  const req = pool.request()
    .input('ScheduleID',       sql.Int,               scheduleID)
    .input('Title',            sql.NVarChar(300),     title)
    .input('FrequencyDays',    sql.Int,               frequencyDays)
    .input('AssignedUserID',   sql.Int,               assignedUserID   || null)
    .input('AssignedVendorID', sql.Int,               assignedVendorID || null)
    .input('Notes',            sql.NVarChar(sql.MAX), notes            || null);

  // Only overwrite LastPerformedAt if a new next PM date was explicitly provided;
  // undefined means "leave it unchanged".
  let lastPerformedCol = 'LastPerformedAt';
  if (lastPerformedAt !== undefined) {
    req.input('LastPerformedAt', sql.DateTime2, lastPerformedAt ? new Date(lastPerformedAt) : null);
    lastPerformedCol = '@LastPerformedAt';
  }

  await req.query(`
      UPDATE PMSchedules SET
        Title            = @Title,
        FrequencyDays    = @FrequencyDays,
        LastPerformedAt  = ${lastPerformedCol},
        AssignedUserID   = @AssignedUserID,
        AssignedVendorID = @AssignedVendorID,
        Notes            = @Notes
      WHERE ScheduleID = @ScheduleID
    `);

  await writeAudit({
    tableName: 'PMSchedules', recordID: scheduleID, action: 'UPDATE',
    oldValues: old, newValues: data,
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
  return getByID(scheduleID);
}

async function markCompleted(scheduleID, performedDate, auditContext = {}) {
  const pool = await getPool();
  const old  = await getByID(scheduleID);
  const date = performedDate ? new Date(performedDate) : new Date();

  await pool.request()
    .input('ScheduleID',      sql.Int,       scheduleID)
    .input('LastPerformedAt', sql.DateTime2, date)
    .query('UPDATE PMSchedules SET LastPerformedAt = @LastPerformedAt WHERE ScheduleID = @ScheduleID');

  await writeAudit({
    tableName: 'PMSchedules', recordID: scheduleID, action: 'COMPLETED',
    oldValues: { lastPerformedAt: old ? old.LastPerformedAt : null },
    newValues: { lastPerformedAt: date },
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
  return getByID(scheduleID);
}

async function hardDelete(scheduleID, auditContext = {}) {
  const pool = await getPool();
  const old  = await getByID(scheduleID);

  await pool.request()
    .input('ScheduleID', sql.Int, scheduleID)
    .query('DELETE FROM PMSchedules WHERE ScheduleID = @ScheduleID');

  await writeAudit({
    tableName: 'PMSchedules', recordID: scheduleID, action: 'DELETE',
    oldValues: old,
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
}

async function getUpcomingDue(daysAhead = 7) {
  const pool = await getPool();
  const result = await pool.request()
    .input('DaysAhead', sql.Int, daysAhead)
    .query(`
      SELECT
        pm.ScheduleID, pm.SiteID, pm.Title, pm.FrequencyDays,
        pm.LastPerformedAt, pm.AssignedUserID, pm.AssignedVendorID, pm.Notes,
        s.SiteName, s.City, s.State,
        u.DisplayName AS AssignedUserName,
        u.Email       AS AssignedUserEmail,
        v.VendorName  AS AssignedVendorName,
        ${NEXT_DUE_EXPR}      AS NextDueDate,
        ${DAYS_UNTIL_DUE_EXPR} AS DaysUntilDue
      FROM PMSchedules pm
      LEFT JOIN Sites   s ON s.SiteID   = pm.SiteID
      LEFT JOIN Users   u ON u.UserID   = pm.AssignedUserID
      LEFT JOIN Vendors v ON v.VendorID = pm.AssignedVendorID
      WHERE ${NEXT_DUE_EXPR} <= DATEADD(day, @DaysAhead, GETUTCDATE())
      ORDER BY NextDueDate
    `);
  return result.recordset;
}

async function getOverdueForReminders(intervalDays = 1) {
  if (intervalDays <= 0) return [];
  const pool = await getPool();
  const result = await pool.request()
    .input('IntervalDays', sql.Int, Math.max(1, intervalDays))
    .query(`
      SELECT
        pm.ScheduleID, pm.SiteID, pm.Title, pm.FrequencyDays,
        pm.AssignedUserID, pm.Notes,
        s.SiteName,
        u.DisplayName AS AssignedUserName,
        u.Email       AS AssignedUserEmail,
        ${NEXT_DUE_EXPR}                       AS NextDueDate,
        ABS(${DAYS_UNTIL_DUE_EXPR})            AS DaysOverdue
      FROM PMSchedules pm
      LEFT JOIN Sites   s ON s.SiteID   = pm.SiteID
      LEFT JOIN Users   u ON u.UserID   = pm.AssignedUserID
      WHERE pm.AssignedUserID IS NOT NULL
        AND ${NEXT_DUE_EXPR} < CAST(GETUTCDATE() AS DATE)
        AND (ABS(${DAYS_UNTIL_DUE_EXPR}) % @IntervalDays) = 0
    `);
  return result.recordset;
}

module.exports = {
  getBySite, getByID, create, update,
  markCompleted, delete: hardDelete,
  getUpcomingDue, getOverdueForReminders,
};
