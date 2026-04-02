'use strict';

const { getPool, sql } = require('../config/database');
const { writeAudit }   = require('./auditModel');
const inventoryModel   = require('./inventoryModel');

async function getCurrentItems(siteID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('SiteID', sql.Int, siteID)
    .query(`
      SELECT
        si.SiteInventoryID, si.SiteID, si.ItemID, si.Quantity,
        si.InstalledAt, si.InstalledByUserID, si.InstallNotes, si.PulledFromLocationID,
        si.RemovedAt,   si.RemovedByUserID,   si.RemovalNotes,
        si.InstallLogEntryID, si.RemovalLogEntryID,
        i.TrackingType, i.SerialNumber, i.CommonName, i.ModelNumber, i.Manufacturer,
        c.CategoryName,
        s.StatusName,
        ib.DisplayName AS InstalledByName,
        pl.LocationName AS PulledFromLocationName
      FROM SiteInventory si
      JOIN Inventory           i  ON i.ItemID      = si.ItemID
      LEFT JOIN InventoryCategories c  ON c.CategoryID  = i.CategoryID
      LEFT JOIN InventoryStatuses   s  ON s.StatusID    = i.StatusID
      LEFT JOIN Users               ib ON ib.UserID     = si.InstalledByUserID
      LEFT JOIN StockLocations      pl ON pl.LocationID = si.PulledFromLocationID
      WHERE si.SiteID    = @SiteID
        AND si.RemovedAt IS NULL
      ORDER BY si.InstalledAt DESC
    `);

  // Combine multiple install records for the same bulk item into one display row
  const rows = result.recordset;
  const serialized = rows.filter(r => r.TrackingType !== 'bulk');
  const bulkMap = new Map();
  rows.filter(r => r.TrackingType === 'bulk').forEach(r => {
    if (bulkMap.has(r.ItemID)) {
      bulkMap.get(r.ItemID).Quantity += r.Quantity;
    } else {
      bulkMap.set(r.ItemID, { ...r });
    }
  });

  return [...serialized, ...bulkMap.values()]
    .sort((a, b) => new Date(b.InstalledAt) - new Date(a.InstalledAt));
}

async function getHistory(siteID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('SiteID', sql.Int, siteID)
    .query(`
      SELECT
        si.SiteInventoryID, si.SiteID, si.ItemID,
        si.InstalledAt, si.InstalledByUserID, si.InstallNotes, si.PulledFromLocationID,
        si.RemovedAt,   si.RemovedByUserID,   si.RemovalNotes,
        si.InstallLogEntryID, si.RemovalLogEntryID,
        i.SerialNumber, i.ModelNumber, i.Manufacturer,
        c.CategoryName,
        ib.DisplayName AS InstalledByName,
        rb.DisplayName AS RemovedByName,
        pl.LocationName AS PulledFromLocationName
      FROM SiteInventory si
      JOIN Inventory           i  ON i.ItemID      = si.ItemID
      LEFT JOIN InventoryCategories c  ON c.CategoryID  = i.CategoryID
      LEFT JOIN Users               ib ON ib.UserID     = si.InstalledByUserID
      LEFT JOIN Users               rb ON rb.UserID     = si.RemovedByUserID
      LEFT JOIN StockLocations      pl ON pl.LocationID = si.PulledFromLocationID
      WHERE si.SiteID = @SiteID
      ORDER BY si.InstalledAt DESC
    `);
  return result.recordset;
}

async function installItem(siteID, itemID, { installedAt, installedByUserID, installNotes, pulledFromLocationID, pulledFromUserID, quantity, isReplacement = false, replacedQty, replacedItemID } = {}, auditContext = {}) {
  const pool = await getPool();

  // Resolve item details for auto-generated log subject and bulk check
  const itemResult = await pool.request()
    .input('ItemID', sql.Int, itemID)
    .query('SELECT SerialNumber, CommonName, ModelNumber, TrackingType FROM Inventory WHERE ItemID = @ItemID');
  const itemRow     = itemResult.recordset[0] || {};
  const isBulk      = itemRow.TrackingType === 'bulk';
  const installQty  = isBulk ? (parseInt(quantity, 10) || 1) : 1;
  const itemLabel   = itemRow.CommonName || itemRow.SerialNumber || itemRow.ModelNumber || String(itemID);

  // Resolve pulled-from label (location or user)
  let pulledFromLabel = null;
  if (pulledFromLocationID) {
    const r = await pool.request().input('ID', sql.Int, pulledFromLocationID)
      .query('SELECT LocationName FROM StockLocations WHERE LocationID = @ID');
    pulledFromLabel = r.recordset[0]?.LocationName || null;
  } else if (pulledFromUserID) {
    const r = await pool.request().input('ID', sql.Int, pulledFromUserID)
      .query('SELECT DisplayName FROM Users WHERE UserID = @ID');
    pulledFromLabel = r.recordset[0]?.DisplayName || null;
  }

  // Resolve installer name
  let installerName = null;
  if (installedByUserID) {
    const r = await pool.request().input('ID', sql.Int, installedByUserID)
      .query('SELECT DisplayName FROM Users WHERE UserID = @ID');
    installerName = r.recordset[0]?.DisplayName || null;
  }

  // Resolve replaced item label (for serialized replace)
  let replacedItemLabel = null;
  if (replacedItemID) {
    const r = await pool.request().input('ID', sql.Int, replacedItemID)
      .query('SELECT CommonName, SerialNumber, ModelNumber FROM Inventory WHERE ItemID = @ID');
    const ri = r.recordset[0] || {};
    replacedItemLabel = ri.CommonName || ri.SerialNumber || ri.ModelNumber || null;
  }

  // Resolve the LogTypeID for 'Inventory Change'
  const logTypeResult = await pool.request()
    .input('TypeName', sql.NVarChar(100), 'Inventory Change')
    .query('SELECT LogTypeID FROM LogTypes WHERE TypeName = @TypeName');
  const logTypeID = logTypeResult.recordset[0] ? logTypeResult.recordset[0].LogTypeID : null;

  const installDate = installedAt ? new Date(installedAt) : new Date();

  // Build log subject and description
  let logSubject, logDescription;
  if (isReplacement) {
    const qty = replacedQty || installQty;
    logSubject = isBulk
      ? `Item replaced: ${itemLabel} (${qty} unit${qty !== 1 ? 's' : ''})`
      : `Item replaced: ${replacedItemLabel || itemLabel} → ${itemLabel}`;
    const parts = [];
    if (installerName)    parts.push(`Replaced by: ${installerName}`);
    if (isBulk && qty)    parts.push(`Units replaced: ${qty}`);
    if (pulledFromLabel)  parts.push(`Replacement pulled from: ${pulledFromLabel}`);
    else                  parts.push('Replacement pulled from: General stock (unallocated)');
    if (installNotes)     parts.push(`Notes: ${installNotes}`);
    logDescription = parts.join('\n');
  } else {
    logSubject = isBulk
      ? `Item installed: ${itemLabel} (${installQty} unit${installQty !== 1 ? 's' : ''})`
      : `Item installed: ${itemLabel}`;
    const parts = [];
    if (installerName)   parts.push(`Installed by: ${installerName}`);
    if (pulledFromLabel) parts.push(`Pulled from: ${pulledFromLabel}`);
    else if (isBulk)     parts.push('Pulled from: General stock (unallocated)');
    if (installNotes)    parts.push(`Notes: ${installNotes}`);
    logDescription = parts.length ? parts.join('\n') : null;
  }

  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    // 1. Insert LogEntry
    const logResult = await new sql.Request(tx)
      .input('SiteID',          sql.Int,              siteID)
      .input('LogTypeID',       sql.Int,              logTypeID    || null)
      .input('EntryDate',       sql.Date,             installDate)
      .input('Subject',         sql.NVarChar(500),    logSubject)
      .input('Description',     sql.NVarChar(sql.MAX), logDescription || null)
      .input('PerformedByUserID', sql.Int,            installedByUserID || auditContext.userID || null)
      .input('IsAutoGenerated', sql.Bit,              1)
      .input('CreatedByUserID', sql.Int,              installedByUserID || auditContext.userID || null)
      .query(`
        INSERT INTO LogEntries
          (SiteID, LogTypeID, EntryDate, Subject, Description, PerformedByUserID, IsAutoGenerated, CreatedByUserID)
        VALUES
          (@SiteID, @LogTypeID, @EntryDate, @Subject, @Description, @PerformedByUserID, @IsAutoGenerated, @CreatedByUserID);
        SELECT SCOPE_IDENTITY() AS NewLogID
      `);
    const installLogEntryID = logResult.recordset[0].NewLogID;

    // 2. Insert SiteInventory
    const siResult = await new sql.Request(tx)
      .input('SiteID',              sql.Int,            siteID)
      .input('ItemID',              sql.Int,            itemID)
      .input('Quantity',            sql.Int,            installQty)
      .input('InstalledAt',         sql.DateTime2,      installDate)
      .input('InstalledByUserID',   sql.Int,            installedByUserID   || null)
      .input('InstallNotes',        sql.NVarChar(sql.MAX), installNotes     || null)
      .input('PulledFromLocationID', sql.Int,            pulledFromLocationID || null)
      .input('PulledFromUserID',     sql.Int,            pulledFromUserID     || null)
      .input('InstallLogEntryID',    sql.Int,            installLogEntryID)
      .query(`
        INSERT INTO SiteInventory
          (SiteID, ItemID, Quantity, InstalledAt, InstalledByUserID, InstallNotes,
           PulledFromLocationID, PulledFromUserID, InstallLogEntryID)
        VALUES
          (@SiteID, @ItemID, @Quantity, @InstalledAt, @InstalledByUserID, @InstallNotes,
           @PulledFromLocationID, @PulledFromUserID, @InstallLogEntryID);
        SELECT SCOPE_IDENTITY() AS NewSIID
      `);
    const newSiteInventoryID = siResult.recordset[0].NewSIID;

    // 3. For serialized items: mark as Deployed, clear location.
    //    For bulk items: leave status alone (tracked by quantity math).
    if (!isBulk) {
      const statusResult = await new sql.Request(tx)
        .input('StatusName', sql.NVarChar(50), 'Deployed')
        .query('SELECT StatusID FROM InventoryStatuses WHERE StatusName = @StatusName');
      const deployedStatusID = statusResult.recordset[0] ? statusResult.recordset[0].StatusID : null;

      await new sql.Request(tx)
        .input('ItemID',   sql.Int, itemID)
        .input('StatusID', sql.Int, deployedStatusID || null)
        .query(`
          UPDATE Inventory SET
            StatusID         = @StatusID,
            StockLocationID  = NULL,
            AssignedToUserID = NULL
          WHERE ItemID = @ItemID
        `);
    }

    await tx.commit();

    // For bulk items, decrease the stock pool the units came from
    if (isBulk && (pulledFromLocationID || pulledFromUserID)) {
      await inventoryModel.adjustStock(itemID, pulledFromLocationID || null, pulledFromUserID || null, -installQty);
    }

    await writeAudit({
      tableName: 'SiteInventory', recordID: newSiteInventoryID, action: 'INSTALL',
      newValues: { siteID, itemID, installedAt, installedByUserID, installNotes, pulledFromLocationID, pulledFromUserID },
      userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
    });

    return newSiteInventoryID;
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

async function removeItem(siteInventoryID, { removedAt, removedByUserID, removalNotes, skipLog = false, disposition = null } = {}, auditContext = {}) {
  const pool = await getPool();

  // Fetch the SiteInventory row to get SiteID, ItemID, and serial number
  const siResult = await pool.request()
    .input('SiteInventoryID', sql.Int, siteInventoryID)
    .query(`
      SELECT si.SiteID, si.ItemID, i.SerialNumber, i.CommonName, i.ModelNumber, i.TrackingType
      FROM SiteInventory si
      JOIN Inventory i ON i.ItemID = si.ItemID
      WHERE si.SiteInventoryID = @SiteInventoryID
    `);

  if (!siResult.recordset.length) {
    throw new Error(`SiteInventory record not found: ${siteInventoryID}`);
  }

  const { SiteID: siteID, ItemID: itemID, SerialNumber: serialNumber, CommonName: commonName, ModelNumber: modelNumber, TrackingType: trackingType } = siResult.recordset[0];

  // Resolve LogTypeID for 'Inventory Change'
  const logTypeResult = await pool.request()
    .input('TypeName', sql.NVarChar(100), 'Inventory Change')
    .query('SELECT LogTypeID FROM LogTypes WHERE TypeName = @TypeName');
  const logTypeID = logTypeResult.recordset[0] ? logTypeResult.recordset[0].LogTypeID : null;

  const removalDate = removedAt ? new Date(removedAt) : new Date();

  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    // 1. Insert removal LogEntry (skipped when part of a replace — the install will log it)
    let removalLogEntryID = null;
    if (!skipLog) {
      const removerName = removedByUserID
        ? (await pool.request().input('ID', sql.Int, removedByUserID).query('SELECT DisplayName FROM Users WHERE UserID = @ID')).recordset[0]?.DisplayName
        : null;
      const itemLabel = commonName || serialNumber || modelNumber || (`Item #${itemID}`);
      const descParts = [];
      if (removerName)  descParts.push(`Removed by: ${removerName}`);
      if (disposition === 'delete')  descParts.push('Disposition: Deleted from inventory');
      else if (disposition === 'return' || disposition)  descParts.push('Disposition: Returned to inventory');
      if (removalNotes) descParts.push(`Notes: ${removalNotes}`);
      const logResult = await new sql.Request(tx)
        .input('SiteID',            sql.Int,              siteID)
        .input('LogTypeID',         sql.Int,              logTypeID || null)
        .input('EntryDate',         sql.Date,             removalDate)
        .input('Subject',           sql.NVarChar(500),    `Item removed: ${itemLabel}`)
        .input('Description',       sql.NVarChar(sql.MAX), descParts.length ? descParts.join('\n') : null)
        .input('PerformedByUserID', sql.Int,              removedByUserID || auditContext.userID || null)
        .input('IsAutoGenerated',   sql.Bit,              1)
        .input('CreatedByUserID',   sql.Int,              removedByUserID || auditContext.userID || null)
        .query(`
          INSERT INTO LogEntries
            (SiteID, LogTypeID, EntryDate, Subject, Description, PerformedByUserID, IsAutoGenerated, CreatedByUserID)
          VALUES
            (@SiteID, @LogTypeID, @EntryDate, @Subject, @Description, @PerformedByUserID, @IsAutoGenerated, @CreatedByUserID);
          SELECT SCOPE_IDENTITY() AS NewLogID
        `);
      removalLogEntryID = logResult.recordset[0].NewLogID;
    }

    // 2. Update SiteInventory
    await new sql.Request(tx)
      .input('SiteInventoryID',  sql.Int,            siteInventoryID)
      .input('RemovedAt',        sql.DateTime2,      removalDate)
      .input('RemovedByUserID',  sql.Int,            removedByUserID  || null)
      .input('RemovalNotes',     sql.NVarChar(sql.MAX), removalNotes  || null)
      .input('RemovalLogEntryID',sql.Int,            removalLogEntryID || null)
      .query(`
        UPDATE SiteInventory SET
          RemovedAt         = @RemovedAt,
          RemovedByUserID   = @RemovedByUserID,
          RemovalNotes      = @RemovalNotes,
          RemovalLogEntryID = @RemovalLogEntryID
        WHERE SiteInventoryID = @SiteInventoryID
      `);

    // 3. For serialized items: revert to In-Stock.
    //    For bulk items: leave status alone (tracked by quantity math).
    if (trackingType !== 'bulk') {
      const statusResult = await new sql.Request(tx)
        .input('StatusName', sql.NVarChar(50), 'In-Stock')
        .query('SELECT StatusID FROM InventoryStatuses WHERE StatusName = @StatusName');
      const inStockStatusID = statusResult.recordset[0] ? statusResult.recordset[0].StatusID : null;

      await new sql.Request(tx)
        .input('ItemID',   sql.Int, itemID)
        .input('StatusID', sql.Int, inStockStatusID || null)
        .query(`
          UPDATE Inventory SET
            StatusID        = @StatusID,
            StockLocationID = NULL
          WHERE ItemID = @ItemID
        `);
    }

    await tx.commit();

    await writeAudit({
      tableName: 'SiteInventory', recordID: siteInventoryID, action: 'REMOVE',
      newValues: { siteInventoryID, removedAt, removedByUserID, removalNotes },
      userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
    });
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

async function getItemHistory(itemID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('ItemID', sql.Int, itemID)
    .query(`
      SELECT
        si.SiteInventoryID, si.SiteID, si.ItemID,
        si.InstalledAt, si.RemovedAt, si.InstallNotes, si.RemovalNotes,
        si.InstalledByUserID, si.RemovedByUserID,
        s.SiteName,
        ib.DisplayName AS InstalledByName,
        rb.DisplayName AS RemovedByName
      FROM SiteInventory si
      JOIN Sites s ON s.SiteID = si.SiteID
      LEFT JOIN Users ib ON ib.UserID = si.InstalledByUserID
      LEFT JOIN Users rb ON rb.UserID = si.RemovedByUserID
      WHERE si.ItemID = @ItemID
      ORDER BY si.InstalledAt DESC
    `);
  return result.recordset;
}

// Removes a specific quantity of a bulk item from a site.
// Consumes rows newest-first; fully soft-deletes rows where qty is exhausted,
// partially reduces the quantity on rows where only some units are removed.
// Always creates a single consolidated log entry for the total quantity (unless skipLog).
async function removeBulkQuantity(siteID, itemID, removeQty, { removedByUserID, skipLog = false, disposition = null } = {}, auditContext = {}) {
  const pool = await getPool();

  const siRows = await pool.request()
    .input('SiteID', sql.Int, siteID)
    .input('ItemID', sql.Int, itemID)
    .query(`
      SELECT si.SiteInventoryID, si.Quantity
      FROM SiteInventory si
      WHERE si.SiteID = @SiteID AND si.ItemID = @ItemID AND si.RemovedAt IS NULL
      ORDER BY si.InstalledAt DESC
    `);

  const totalInstalled = siRows.recordset.reduce((sum, r) => sum + r.Quantity, 0);
  if (removeQty > totalInstalled) {
    const err = new Error(`Cannot remove ${removeQty} — only ${totalInstalled} currently installed.`);
    err.userMessage = err.message;
    throw err;
  }

  // Create one consolidated log entry for the whole operation (unless this is part of a replace)
  if (!skipLog) {
    const itemResult = await pool.request()
      .input('ItemID', sql.Int, itemID)
      .query('SELECT CommonName, ModelNumber, SerialNumber FROM Inventory WHERE ItemID = @ItemID');
    const ir = itemResult.recordset[0] || {};
    const itemLabel = ir.CommonName || ir.SerialNumber || ir.ModelNumber || `Item #${itemID}`;

    const logTypeResult = await pool.request()
      .input('TypeName', sql.NVarChar(100), 'Inventory Change')
      .query('SELECT LogTypeID FROM LogTypes WHERE TypeName = @TypeName');
    const logTypeID = logTypeResult.recordset[0]?.LogTypeID || null;

    const removerName = removedByUserID
      ? (await pool.request().input('ID', sql.Int, removedByUserID).query('SELECT DisplayName FROM Users WHERE UserID = @ID')).recordset[0]?.DisplayName
      : null;

    const descParts = [];
    if (removerName)               descParts.push(`Removed by: ${removerName}`);
    if (disposition === 'delete')  descParts.push('Disposition: Deleted from inventory');
    else                           descParts.push('Disposition: Returned to inventory');

    await pool.request()
      .input('SiteID',            sql.Int,               siteID)
      .input('LogTypeID',         sql.Int,               logTypeID)
      .input('EntryDate',         sql.Date,              new Date())
      .input('Subject',           sql.NVarChar(500),     `Item removed: ${itemLabel} (${removeQty} unit${removeQty !== 1 ? 's' : ''})`)
      .input('Description',       sql.NVarChar(sql.MAX), descParts.join('\n'))
      .input('PerformedByUserID', sql.Int,               removedByUserID || auditContext.userID || null)
      .input('IsAutoGenerated',   sql.Bit,               1)
      .input('CreatedByUserID',   sql.Int,               removedByUserID || auditContext.userID || null)
      .query(`
        INSERT INTO LogEntries
          (SiteID, LogTypeID, EntryDate, Subject, Description, PerformedByUserID, IsAutoGenerated, CreatedByUserID)
        VALUES
          (@SiteID, @LogTypeID, @EntryDate, @Subject, @Description, @PerformedByUserID, @IsAutoGenerated, @CreatedByUserID)
      `);
  }

  let remaining = removeQty;
  for (const row of siRows.recordset) {
    if (remaining <= 0) break;
    if (row.Quantity <= remaining) {
      // Always skip per-row logs — we already created one consolidated entry above
      await removeItem(row.SiteInventoryID, { removedByUserID, skipLog: true }, auditContext);
      remaining -= row.Quantity;
    } else {
      // Partial reduction — just lower the quantity, no full removal
      await pool.request()
        .input('SiteInventoryID', sql.Int, row.SiteInventoryID)
        .input('NewQuantity',     sql.Int, row.Quantity - remaining)
        .query('UPDATE SiteInventory SET Quantity = @NewQuantity WHERE SiteInventoryID = @SiteInventoryID');
      remaining = 0;
    }
  }
}

async function getByID(siteInventoryID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('SiteInventoryID', sql.Int, siteInventoryID)
    .query(`
      SELECT si.SiteInventoryID, si.SiteID, si.ItemID, si.Quantity,
             i.SerialNumber, i.ModelNumber, i.Manufacturer, i.TrackingType
      FROM SiteInventory si
      JOIN Inventory i ON i.ItemID = si.ItemID
      WHERE si.SiteInventoryID = @SiteInventoryID
    `);
  return result.recordset[0] || null;
}

// All active installations across all sites, joined to site + item info (for export)
async function getAllInstallations() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      si.SiteInventoryID, si.SiteID, si.ItemID, si.Quantity,
      si.InstalledAt, si.InstallNotes,
      s.SiteName, s.SiteNumber,
      i.TrackingType, i.SerialNumber, i.CommonName, i.ModelNumber, i.Manufacturer,
      c.CategoryName
    FROM SiteInventory si
    JOIN Sites s ON s.SiteID = si.SiteID
    JOIN Inventory i ON i.ItemID = si.ItemID
    LEFT JOIN InventoryCategories c ON c.CategoryID = i.CategoryID
    WHERE si.RemovedAt IS NULL
    ORDER BY s.SiteName, si.InstalledAt DESC
  `);
  return result.recordset;
}

async function findBySiteAndItem(siteID, itemID) {
  const pool = await getPool();
  const r = await pool.request()
    .input('SiteID', sql.Int, siteID)
    .input('ItemID', sql.Int, itemID)
    .query(`SELECT TOP 1 SiteInventoryID FROM SiteInventory WHERE SiteID = @SiteID AND ItemID = @ItemID AND RemovedAt IS NULL`);
  return r.recordset.length ? r.recordset[0].SiteInventoryID : null;
}

// Lightweight install for import — inserts the record and marks serialized items Deployed.
// Does NOT deduct bulk stock (import is a data-restore scenario, not a live pull).
async function createInstallRecord(siteID, itemID, { installNotes, quantity, installedByUserID } = {}, auditContext = {}) {
  const pool = await getPool();
  const result = await pool.request()
    .input('SiteID',            sql.Int,               siteID)
    .input('ItemID',            sql.Int,               itemID)
    .input('Quantity',          sql.Int,               quantity || 1)
    .input('InstalledByUserID', sql.Int,               installedByUserID || null)
    .input('InstallNotes',      sql.NVarChar(sql.MAX), installNotes || null)
    .query(`
      INSERT INTO SiteInventory (SiteID, ItemID, Quantity, InstalledAt, InstalledByUserID, InstallNotes)
      VALUES (@SiteID, @ItemID, @Quantity, GETUTCDATE(), @InstalledByUserID, @InstallNotes);
      SELECT SCOPE_IDENTITY() AS NewID
    `);
  const newID = result.recordset[0].NewID;

  const item = await inventoryModel.getByID(itemID);
  if (item && item.TrackingType !== 'bulk') {
    const sr = await pool.request().query(`SELECT TOP 1 StatusID FROM InventoryStatuses WHERE StatusName = 'Deployed'`);
    if (sr.recordset.length) {
      await pool.request()
        .input('StatusID', sql.Int, sr.recordset[0].StatusID)
        .input('ItemID',   sql.Int, itemID)
        .query(`UPDATE Inventory SET StatusID = @StatusID, StockLocationID = NULL, AssignedToUserID = NULL WHERE ItemID = @ItemID`);
    }
  }

  await writeAudit({
    tableName: 'SiteInventory', recordID: newID, action: 'INSERT',
    newValues: { siteID, itemID, quantity, installNotes },
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
  return newID;
}

async function updateInstallation(siID, { installNotes, quantity } = {}, auditContext = {}) {
  const pool = await getPool();
  await pool.request()
    .input('SiteInventoryID', sql.Int,               siID)
    .input('InstallNotes',    sql.NVarChar(sql.MAX), installNotes ?? null)
    .input('Quantity',        sql.Int,               quantity || 1)
    .query(`UPDATE SiteInventory SET InstallNotes = @InstallNotes, Quantity = @Quantity WHERE SiteInventoryID = @SiteInventoryID`);
  await writeAudit({
    tableName: 'SiteInventory', recordID: siID, action: 'UPDATE',
    newValues: { installNotes, quantity },
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
}

module.exports = { getCurrentItems, getHistory, getItemHistory, getByID, getAllInstallations, findBySiteAndItem, createInstallRecord, updateInstallation, installItem, removeItem, removeBulkQuantity };
