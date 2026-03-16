'use strict';

const { getPool, sql }    = require('../config/database');
const { writeAudit }      = require('./auditModel');
const inventoryModel      = require('./inventoryModel');

const REPAIR_SELECT = `
  rt.RepairID, rt.ItemID, rt.SiteInventoryID, rt.SentDate, rt.RMANumber,
  rt.ManufacturerContact, rt.Reason, rt.ExpectedReturnDate, rt.FollowUpDate,
  rt.ReceivedDate, rt.ReturnCondition, rt.ReturnNotes, rt.RepairStatus,
  rt.SentByUserID, rt.ReceivedByUserID, rt.CreatedAt,
  i.SerialNumber, i.ModelNumber, i.Manufacturer,
  sb.DisplayName AS SentByName,
  rb.DisplayName AS ReceivedByName
`;

const REPAIR_JOINS = `
  FROM RepairTracking rt
  LEFT JOIN Inventory i  ON i.ItemID  = rt.ItemID
  LEFT JOIN Users    sb  ON sb.UserID = rt.SentByUserID
  LEFT JOIN Users    rb  ON rb.UserID = rt.ReceivedByUserID
`;

async function getAll({ status, itemID, page = 1, pageSize = 25 } = {}) {
  const pool = await getPool();
  const request = pool.request();
  const conditions = ['1=1'];

  if (status === 'open') {
    conditions.push('rt.ReceivedDate IS NULL');
  } else if (status) {
    conditions.push('rt.RepairStatus = @Status');
    request.input('Status', sql.NVarChar(50), status);
  }
  if (itemID) {
    conditions.push('rt.ItemID = @ItemID');
    request.input('ItemID', sql.Int, itemID);
  }

  const where = conditions.join(' AND ');
  const offset = (page - 1) * pageSize;
  request.input('Offset',   sql.Int, offset);
  request.input('PageSize', sql.Int, pageSize);

  const countReq = pool.request();
  if (status && status !== 'open') countReq.input('Status', sql.NVarChar(50), status);
  if (itemID)                       countReq.input('ItemID', sql.Int,          itemID);

  const countResult = await countReq.query(`SELECT COUNT(*) AS Total ${REPAIR_JOINS} WHERE ${where}`);
  const total = countResult.recordset[0].Total;

  const result = await request.query(`
    SELECT ${REPAIR_SELECT}
    ${REPAIR_JOINS}
    WHERE ${where}
    ORDER BY rt.SentDate DESC
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
    reason, expectedReturnDate, followUpDate, sentByUserID,
  } = data;

  const pool = await getPool();
  const result = await pool.request()
    .input('ItemID',              sql.Int,            itemID)
    .input('SiteInventoryID',     sql.Int,            siteInventoryID     || null)
    .input('SentDate',            sql.Date,           sentDate ? new Date(sentDate) : new Date())
    .input('RMANumber',           sql.NVarChar(100),  rmaNumber           || null)
    .input('ManufacturerContact', sql.NVarChar(500),  manufacturerContact || null)
    .input('Reason',              sql.NVarChar(sql.MAX), reason            || null)
    .input('ExpectedReturnDate',  sql.Date,           expectedReturnDate ? new Date(expectedReturnDate) : null)
    .input('FollowUpDate',        sql.Date,           followUpDate       ? new Date(followUpDate)       : null)
    .input('SentByUserID',        sql.Int,            sentByUserID        || null)
    .input('RepairStatus',        sql.NVarChar(50),   'Sent')
    .query(`
      INSERT INTO RepairTracking
        (ItemID, SiteInventoryID, SentDate, RMANumber, ManufacturerContact, Reason,
         ExpectedReturnDate, FollowUpDate, SentByUserID, RepairStatus)
      VALUES
        (@ItemID, @SiteInventoryID, @SentDate, @RMANumber, @ManufacturerContact, @Reason,
         @ExpectedReturnDate, @FollowUpDate, @SentByUserID, @RepairStatus);
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
    reason, expectedReturnDate, followUpDate, sentByUserID,
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
    .input('FollowUpDate',        sql.Date,           followUpDate       ? new Date(followUpDate)       : null)
    .input('SentByUserID',        sql.Int,            sentByUserID        || null)
    .query(`
      UPDATE RepairTracking SET
        ItemID              = @ItemID,
        SiteInventoryID     = @SiteInventoryID,
        SentDate            = @SentDate,
        RMANumber           = @RMANumber,
        ManufacturerContact = @ManufacturerContact,
        Reason              = @Reason,
        ExpectedReturnDate  = @ExpectedReturnDate,
        FollowUpDate        = @FollowUpDate,
        SentByUserID        = @SentByUserID
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

async function getOverdueFollowUps() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT ${REPAIR_SELECT}
    ${REPAIR_JOINS}
    WHERE rt.FollowUpDate <= CAST(GETUTCDATE() AS DATE)
      AND rt.ReceivedDate IS NULL
    ORDER BY rt.FollowUpDate
  `);
  return result.recordset;
}

async function getOverdueExpected() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT ${REPAIR_SELECT}
    ${REPAIR_JOINS}
    WHERE rt.ExpectedReturnDate < CAST(GETUTCDATE() AS DATE)
      AND rt.ReceivedDate IS NULL
    ORDER BY rt.ExpectedReturnDate
  `);
  return result.recordset;
}

module.exports = {
  getAll, getByID, create, update,
  markReceived, getOverdueFollowUps, getOverdueExpected,
};
