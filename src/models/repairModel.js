'use strict';

const { getPool, sql }    = require('../config/database');
const { writeAudit }      = require('./auditModel');
const inventoryModel      = require('./inventoryModel');

const REPAIR_SELECT = `
  rt.RepairID, rt.ItemID, rt.SiteInventoryID, rt.SentDate, rt.RMANumber,
  rt.ManufacturerContact, rt.Reason, rt.ExpectedReturnDate,
  rt.ReceivedDate, rt.ReturnCondition, rt.ReturnNotes, rt.RepairStatus,
  rt.SentByUserID, rt.ReceivedByUserID, rt.AssignedUserID, rt.CreatedAt,
  i.CommonName, i.SerialNumber, i.ModelNumber, i.Manufacturer, i.TrackingType AS ItemTrackingType,
  sb.DisplayName AS SentByName,
  rb.DisplayName AS ReceivedByName,
  au.DisplayName AS AssignedUserName,
  au.Email       AS AssignedUserEmail
`;

const REPAIR_SORT_COLUMNS = {
  item:           'COALESCE(i.CommonName, i.SerialNumber, i.ModelNumber)',
  manufacturer:   'i.Manufacturer',
  createdAt:      'rt.CreatedAt',
  sentDate:       'rt.SentDate',
  expectedReturn: 'rt.ExpectedReturnDate',
  assignedUser:   'au.DisplayName',
};

const REPAIR_JOINS = `
  FROM RepairTracking rt
  LEFT JOIN Inventory i  ON i.ItemID  = rt.ItemID
  LEFT JOIN Users    sb  ON sb.UserID = rt.SentByUserID
  LEFT JOIN Users    rb  ON rb.UserID = rt.ReceivedByUserID
  LEFT JOIN Users    au  ON au.UserID = rt.AssignedUserID
`;

async function getAll({ status, itemID, search, assignedUserID, manufacturer, page = 1, pageSize = 25, sort = 'sentDate', dir = 'desc' } = {}) {
  const pool = await getPool();
  const request = pool.request();
  const conditions = ['1=1'];

  if (status === 'open') {
    conditions.push('rt.ReceivedDate IS NULL');
  } else if (status === 'closed') {
    conditions.push('rt.ReceivedDate IS NOT NULL');
  } else if (status === 'notsent') {
    conditions.push('rt.SentDate IS NULL AND rt.ReceivedDate IS NULL');
  }
  // status === 'all' — no filter
  // status === 'all' — no filter, return everything
  if (itemID) {
    conditions.push('rt.ItemID = @ItemID');
    request.input('ItemID', sql.Int, itemID);
  }
  if (search) {
    conditions.push('(i.CommonName LIKE @Search OR i.SerialNumber LIKE @Search OR i.ModelNumber LIKE @Search OR rt.RMANumber LIKE @Search OR i.Manufacturer LIKE @Search)');
    request.input('Search', sql.NVarChar(200), `%${search}%`);
  }
  if (assignedUserID) {
    conditions.push('rt.AssignedUserID = @AssignedUserID');
    request.input('AssignedUserID', sql.Int, assignedUserID);
  }
  if (manufacturer) {
    conditions.push('i.Manufacturer = @Manufacturer');
    request.input('Manufacturer', sql.NVarChar(200), manufacturer);
  }

  const orderCol = REPAIR_SORT_COLUMNS[sort] || 'rt.SentDate';
  const orderDir = dir === 'asc' ? 'ASC' : 'DESC';

  const where = conditions.join(' AND ');
  const offset = (page - 1) * pageSize;
  request.input('Offset',   sql.Int, offset);
  request.input('PageSize', sql.Int, pageSize);

  const countReq = pool.request();
  if (itemID) countReq.input('ItemID', sql.Int, itemID);
  if (search) countReq.input('Search', sql.NVarChar(200), `%${search}%`);
  if (assignedUserID) countReq.input('AssignedUserID', sql.Int, assignedUserID);
  if (manufacturer) countReq.input('Manufacturer', sql.NVarChar(200), manufacturer);

  const countResult = await countReq.query(`SELECT COUNT(*) AS Total ${REPAIR_JOINS} WHERE ${where}`);
  const total = countResult.recordset[0].Total;

  const result = await request.query(`
    SELECT ${REPAIR_SELECT}
    ${REPAIR_JOINS}
    WHERE ${where}
    ORDER BY ${orderCol} ${orderDir}
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
  `);

  return { rows: result.recordset, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

async function getByID(repairID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('RepairID', sql.Int, repairID)
    .query(`
      SELECT ${REPAIR_SELECT}
      ${REPAIR_JOINS}
      WHERE rt.RepairID = @RepairID
    `);
  return result.recordset[0] || null;
}

async function create(data, auditContext = {}) {
  const {
    itemID, siteInventoryID, sentDate, rmaNumber, manufacturerContact,
    reason, expectedReturnDate, followUpDate, sentByUserID, assignedUserID,
  } = data;

  // Default assigned user to the sender if not explicitly set
  const resolvedAssignedUserID = assignedUserID || sentByUserID || null;

  const pool = await getPool();
  const result = await pool.request()
    .input('ItemID',              sql.Int,            itemID)
    .input('SiteInventoryID',     sql.Int,            siteInventoryID     || null)
    .input('SentDate',            sql.Date,           sentDate ? new Date(sentDate) : null)
    .input('RMANumber',           sql.NVarChar(100),  rmaNumber           || null)
    .input('ManufacturerContact', sql.NVarChar(500),  manufacturerContact || null)
    .input('Reason',              sql.NVarChar(sql.MAX), reason            || null)
    .input('ExpectedReturnDate',  sql.Date,           expectedReturnDate ? new Date(expectedReturnDate) : null)
    .input('SentByUserID',        sql.Int,            sentByUserID        || null)
    .input('AssignedUserID',      sql.Int,            resolvedAssignedUserID)
    .input('RepairStatus',        sql.NVarChar(50),   'Sent')
    .query(`
      INSERT INTO RepairTracking
        (ItemID, SiteInventoryID, SentDate, RMANumber, ManufacturerContact, Reason,
         ExpectedReturnDate, SentByUserID, AssignedUserID, RepairStatus)
      VALUES
        (@ItemID, @SiteInventoryID, @SentDate, @RMANumber, @ManufacturerContact, @Reason,
         @ExpectedReturnDate, @SentByUserID, @AssignedUserID, @RepairStatus);
      SELECT SCOPE_IDENTITY() AS NewID
    `);

  const newID = result.recordset[0].NewID;

  // Move inventory item to In-Repair status
  await inventoryModel.updateStatus(itemID, 'In-Repair', {}, auditContext);

  await writeAudit({
    tableName: 'RepairTracking', recordID: newID, action: 'INSERT',
    newValues: data,
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
  return getByID(newID);
}

async function update(repairID, data, auditContext = {}) {
  const {
    itemID, siteInventoryID, sentDate, rmaNumber, manufacturerContact,
    reason, expectedReturnDate, sentByUserID, assignedUserID,
  } = data;

  const pool = await getPool();
  const old  = await getByID(repairID);

  await pool.request()
    .input('RepairID',            sql.Int,            repairID)
    .input('ItemID',              sql.Int,            itemID              || null)
    .input('SiteInventoryID',     sql.Int,            siteInventoryID     || null)
    .input('SentDate',            sql.Date,           sentDate ? new Date(sentDate) : null)
    .input('RMANumber',           sql.NVarChar(100),  rmaNumber           || null)
    .input('ManufacturerContact', sql.NVarChar(500),  manufacturerContact || null)
    .input('Reason',              sql.NVarChar(sql.MAX), reason            || null)
    .input('ExpectedReturnDate',  sql.Date,           expectedReturnDate ? new Date(expectedReturnDate) : null)
    .input('SentByUserID',        sql.Int,            sentByUserID        || null)
    .input('AssignedUserID',      sql.Int,            assignedUserID      || null)
    .query(`
      UPDATE RepairTracking SET
        ItemID              = @ItemID,
        SiteInventoryID     = @SiteInventoryID,
        SentDate            = @SentDate,
        RMANumber           = @RMANumber,
        ManufacturerContact = @ManufacturerContact,
        Reason              = @Reason,
        ExpectedReturnDate  = @ExpectedReturnDate,
        SentByUserID        = @SentByUserID,
        AssignedUserID      = @AssignedUserID
      WHERE RepairID = @RepairID
    `);

  await writeAudit({
    tableName: 'RepairTracking', recordID: repairID, action: 'UPDATE',
    oldValues: old, newValues: data,
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
  return getByID(repairID);
}

async function markReceived(repairID, { receivedDate, returnCondition, returnNotes, stockLocationID, receivedByUserID }, auditContext = {}) {
  const pool = await getPool();
  const old  = await getByID(repairID);
  if (!old) throw new Error(`RepairTracking record not found: ${repairID}`);

  await pool.request()
    .input('RepairID',         sql.Int,            repairID)
    .input('ReceivedDate',     sql.Date,           receivedDate ? new Date(receivedDate) : new Date())
    .input('ReturnCondition',  sql.NVarChar(100),  returnCondition  || null)
    .input('ReturnNotes',      sql.NVarChar(sql.MAX), returnNotes   || null)
    .input('RepairStatus',     sql.NVarChar(50),   'Returned-to-Inventory')
    .input('ReceivedByUserID', sql.Int,            receivedByUserID || null)
    .query(`
      UPDATE RepairTracking SET
        ReceivedDate     = @ReceivedDate,
        ReturnCondition  = @ReturnCondition,
        ReturnNotes      = @ReturnNotes,
        RepairStatus     = @RepairStatus,
        ReceivedByUserID = @ReceivedByUserID
      WHERE RepairID = @RepairID
    `);

  // Move item back to In-Stock at the specified location
  await inventoryModel.updateStatus(
    old.ItemID,
    'In-Stock',
    { stockLocationID: stockLocationID || null, assignedToUserID: null },
    auditContext,
  );

  await writeAudit({
    tableName: 'RepairTracking', recordID: repairID, action: 'RECEIVED',
    oldValues: old,
    newValues: { receivedDate, returnCondition, returnNotes, stockLocationID, receivedByUserID },
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
  return getByID(repairID);
}

// Returns overdue repairs where today falls on a reminder interval boundary.
// e.g. intervalDays=3 → sends on day 0, 3, 6, 9... after ExpectedReturnDate.
async function getOverdueExpected(intervalDays = 3) {
  const pool = await getPool();
  const result = await pool.request()
    .input('IntervalDays', sql.Int, Math.max(1, intervalDays))
    .query(`
      SELECT ${REPAIR_SELECT}
      ${REPAIR_JOINS}
      WHERE rt.SentDate IS NOT NULL
        AND rt.ExpectedReturnDate IS NOT NULL
        AND rt.ExpectedReturnDate < CAST(GETUTCDATE() AS DATE)
        AND rt.ReceivedDate IS NULL
        AND DATEDIFF(day, rt.ExpectedReturnDate, CAST(GETUTCDATE() AS DATE)) % @IntervalDays = 0
      ORDER BY rt.ExpectedReturnDate
    `);
  return result.recordset;
}

// Returns open RMAs with no SentDate where today falls on a reminder interval
// boundary counted from CreatedAt (e.g. every 3 days after creation).
async function getUnsentReminders(intervalDays = 3) {
  const pool = await getPool();
  const result = await pool.request()
    .input('IntervalDays', sql.Int, Math.max(1, intervalDays))
    .query(`
      SELECT ${REPAIR_SELECT}
      ${REPAIR_JOINS}
      WHERE rt.SentDate IS NULL
        AND rt.ReceivedDate IS NULL
        AND DATEDIFF(day, CAST(rt.CreatedAt AS DATE), CAST(GETUTCDATE() AS DATE)) > 0
        AND DATEDIFF(day, CAST(rt.CreatedAt AS DATE), CAST(GETUTCDATE() AS DATE)) % @IntervalDays = 0
      ORDER BY rt.CreatedAt
    `);
  return result.recordset;
}

async function deleteRepair(repairID, auditContext = {}) {
  const pool = await getPool();
  const old  = await getByID(repairID);
  if (!old) throw new Error(`RepairTracking record not found: ${repairID}`);

  await pool.request()
    .input('RepairID', sql.Int, repairID)
    .query('DELETE FROM RepairTracking WHERE RepairID = @RepairID');

  // Restore the item to In-Stock since the repair was cancelled, not received
  await inventoryModel.updateStatus(old.ItemID, 'In-Stock', {}, auditContext);

  await writeAudit({
    tableName: 'RepairTracking', recordID: repairID, action: 'DELETE',
    oldValues: old,
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
}

async function getManufacturers() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT DISTINCT i.Manufacturer
    FROM RepairTracking rt
    JOIN Inventory i ON i.ItemID = rt.ItemID
    WHERE i.Manufacturer IS NOT NULL
    ORDER BY i.Manufacturer
  `);
  return result.recordset.map(r => r.Manufacturer);
}

module.exports = {
  getAll, getByID, create, update,
  markReceived, getOverdueExpected, getUnsentReminders, deleteRepair,
  getManufacturers,
};
