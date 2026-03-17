'use strict';

const { getPool, sql } = require('../config/database');
const { writeAudit }   = require('./auditModel');

async function getAll({ categoryID, statusID, search, locationID, assignedUserID, page = 1, pageSize = 25 } = {}) {
  const pool = await getPool();
  const request = pool.request();
  const conditions = ['i.IsActive = 1'];

  if (categoryID) {
    conditions.push('i.CategoryID = @CategoryID');
    request.input('CategoryID', sql.Int, categoryID);
  }
  if (statusID) {
    conditions.push('i.StatusID = @StatusID');
    request.input('StatusID', sql.Int, statusID);
  }
  if (search) {
    conditions.push('(i.SerialNumber LIKE @Search OR i.ModelNumber LIKE @Search OR i.Manufacturer LIKE @Search)');
    request.input('Search', sql.NVarChar(200), `%${search}%`);
  }
  if (locationID) {
    conditions.push('i.StockLocationID = @LocationID');
    request.input('LocationID', sql.Int, locationID);
  }
  if (assignedUserID) {
    conditions.push('i.AssignedToUserID = @AssignedUserID');
    request.input('AssignedUserID', sql.Int, assignedUserID);
  }

  const where = conditions.join(' AND ');
  const offset = (page - 1) * pageSize;
  request.input('Offset',   sql.Int, offset);
  request.input('PageSize', sql.Int, pageSize);

  const countReq = pool.request();
  if (categoryID)    countReq.input('CategoryID',    sql.Int,           categoryID);
  if (statusID)      countReq.input('StatusID',      sql.Int,           statusID);
  if (search)        countReq.input('Search',        sql.NVarChar(200), `%${search}%`);
  if (locationID)    countReq.input('LocationID',    sql.Int,           locationID);
  if (assignedUserID) countReq.input('AssignedUserID', sql.Int,         assignedUserID);

  const countResult = await countReq.query(`SELECT COUNT(*) AS Total FROM Inventory i WHERE ${where}`);
  const total = countResult.recordset[0].Total;

  const result = await request.query(`
    SELECT
      i.ItemID, i.TrackingType, i.SerialNumber, i.ModelNumber, i.Manufacturer,
      i.CategoryID, i.StatusID, i.StockLocationID, i.AssignedToUserID,
      i.QuantityTotal,
      i.QuantityTotal - ISNULL((
        SELECT SUM(si.Quantity) FROM SiteInventory si
        WHERE si.ItemID = i.ItemID AND si.RemovedAt IS NULL
      ), 0) AS QuantityAvailable,
      i.Description, i.PurchaseDate, i.WarrantyExpires, i.Notes,
      i.IsActive, i.CreatedAt,
      c.CategoryName,
      s.StatusName,
      l.LocationName AS StockLocationName,
      u.DisplayName  AS AssignedToUserName
    FROM Inventory i
    LEFT JOIN InventoryCategories c  ON c.CategoryID      = i.CategoryID
    LEFT JOIN InventoryStatuses   s  ON s.StatusID        = i.StatusID
    LEFT JOIN StockLocations      l  ON l.LocationID      = i.StockLocationID
    LEFT JOIN Users               u  ON u.UserID          = i.AssignedToUserID
    WHERE ${where}
    ORDER BY i.Manufacturer, i.ModelNumber, i.SerialNumber
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
  `);

  return { rows: result.recordset, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

async function getByID(itemID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('ItemID', sql.Int, itemID)
    .query(`
      SELECT
        i.ItemID, i.TrackingType, i.SerialNumber, i.ModelNumber, i.Manufacturer,
        i.CategoryID, i.StatusID, i.StockLocationID, i.AssignedToUserID,
        i.QuantityTotal,
        i.QuantityTotal - ISNULL((
          SELECT SUM(si.Quantity) FROM SiteInventory si
          WHERE si.ItemID = i.ItemID AND si.RemovedAt IS NULL
        ), 0) AS QuantityAvailable,
        i.Description, i.PurchaseDate, i.WarrantyExpires, i.Notes,
        i.IsActive, i.CreatedAt, i.CreatedByUserID,
        c.CategoryName,
        s.StatusName,
        l.LocationName AS StockLocationName,
        u.DisplayName  AS AssignedToUserName,
        cb.DisplayName AS CreatedByName
      FROM Inventory i
      LEFT JOIN InventoryCategories c  ON c.CategoryID  = i.CategoryID
      LEFT JOIN InventoryStatuses   s  ON s.StatusID    = i.StatusID
      LEFT JOIN StockLocations      l  ON l.LocationID  = i.StockLocationID
      LEFT JOIN Users               u  ON u.UserID      = i.AssignedToUserID
      LEFT JOIN Users               cb ON cb.UserID     = i.CreatedByUserID
      WHERE i.ItemID = @ItemID
    `);
  return result.recordset[0] || null;
}

async function create(data, auditContext = {}) {
  const {
    trackingType, serialNumber, modelNumber, manufacturer, categoryID, statusID,
    stockLocationID, quantityTotal, description, purchaseDate, warrantyExpires, notes,
  } = data;

  const isBulk = trackingType === 'bulk';
  const pool = await getPool();
  const result = await pool.request()
    .input('TrackingType',    sql.NVarChar(20),    isBulk ? 'bulk' : 'serialized')
    .input('SerialNumber',    sql.NVarChar(100),   serialNumber    || null)
    .input('ModelNumber',     sql.NVarChar(100),   modelNumber     || null)
    .input('Manufacturer',    sql.NVarChar(150),   manufacturer    || null)
    .input('CategoryID',      sql.Int,             categoryID      || null)
    .input('StatusID',        sql.Int,             statusID        || null)
    .input('StockLocationID', sql.Int,             isBulk ? null : (stockLocationID || null))
    .input('QuantityTotal',   sql.Int,             isBulk ? (parseInt(quantityTotal, 10) || 1) : 1)
    .input('Description',     sql.NVarChar(sql.MAX), description   || null)
    .input('PurchaseDate',    sql.Date,            purchaseDate    ? new Date(purchaseDate)    : null)
    .input('WarrantyExpires', sql.Date,            warrantyExpires ? new Date(warrantyExpires) : null)
    .input('Notes',           sql.NVarChar(sql.MAX), notes         || null)
    .input('CreatedByUserID', sql.Int,             auditContext.userID || null)
    .query(`
      INSERT INTO Inventory
        (TrackingType, SerialNumber, ModelNumber, Manufacturer, CategoryID, StatusID, StockLocationID,
         QuantityTotal, Description, PurchaseDate, WarrantyExpires, Notes, CreatedByUserID)
      VALUES
        (@TrackingType, @SerialNumber, @ModelNumber, @Manufacturer, @CategoryID, @StatusID, @StockLocationID,
         @QuantityTotal, @Description, @PurchaseDate, @WarrantyExpires, @Notes, @CreatedByUserID);
      SELECT SCOPE_IDENTITY() AS NewID
    `);

  const newID = result.recordset[0].NewID;
  await writeAudit({
    tableName: 'Inventory', recordID: newID, action: 'INSERT',
    newValues: data,
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
  return getByID(newID);
}

async function update(itemID, data, auditContext = {}) {
  const {
    serialNumber, modelNumber, manufacturer, categoryID, statusID,
    stockLocationID, quantityTotal, description, purchaseDate, warrantyExpires, notes,
  } = data;

  const pool = await getPool();
  const old  = await getByID(itemID);
  const isBulk = old && old.TrackingType === 'bulk';

  await pool.request()
    .input('ItemID',          sql.Int,             itemID)
    .input('SerialNumber',    sql.NVarChar(100),   isBulk ? null : (serialNumber || null))
    .input('ModelNumber',     sql.NVarChar(100),   modelNumber     || null)
    .input('Manufacturer',    sql.NVarChar(150),   manufacturer    || null)
    .input('CategoryID',      sql.Int,             categoryID      || null)
    .input('StatusID',        sql.Int,             statusID        || null)
    .input('StockLocationID', sql.Int,             isBulk ? null : (stockLocationID || null))
    .input('QuantityTotal',   sql.Int,             isBulk ? (parseInt(quantityTotal, 10) || old.QuantityTotal) : 1)
    .input('Description',     sql.NVarChar(sql.MAX), description   || null)
    .input('PurchaseDate',    sql.Date,            purchaseDate    ? new Date(purchaseDate)    : null)
    .input('WarrantyExpires', sql.Date,            warrantyExpires ? new Date(warrantyExpires) : null)
    .input('Notes',           sql.NVarChar(sql.MAX), notes         || null)
    .query(`
      UPDATE Inventory SET
        SerialNumber    = @SerialNumber,
        ModelNumber     = @ModelNumber,
        Manufacturer    = @Manufacturer,
        CategoryID      = @CategoryID,
        StatusID        = @StatusID,
        StockLocationID = @StockLocationID,
        QuantityTotal   = @QuantityTotal,
        Description     = @Description,
        PurchaseDate    = @PurchaseDate,
        WarrantyExpires = @WarrantyExpires,
        Notes           = @Notes
      WHERE ItemID = @ItemID
    `);

  await writeAudit({
    tableName: 'Inventory', recordID: itemID, action: 'UPDATE',
    oldValues: old, newValues: data,
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
  return getByID(itemID);
}

async function softDelete(itemID, auditContext = {}) {
  const pool = await getPool();
  await pool.request()
    .input('ItemID', sql.Int, itemID)
    .query('UPDATE Inventory SET IsActive = 0 WHERE ItemID = @ItemID');

  await writeAudit({
    tableName: 'Inventory', recordID: itemID, action: 'DELETE',
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
}

async function updateStatus(itemID, statusName, { stockLocationID = null, assignedToUserID = null } = {}, auditContext = {}) {
  const pool = await getPool();

  // Resolve StatusID by name
  const statusResult = await pool.request()
    .input('StatusName', sql.NVarChar(50), statusName)
    .query('SELECT StatusID FROM InventoryStatuses WHERE StatusName = @StatusName');

  if (!statusResult.recordset.length) {
    throw new Error(`Unknown inventory status: ${statusName}`);
  }
  const statusID = statusResult.recordset[0].StatusID;

  await pool.request()
    .input('ItemID',           sql.Int, itemID)
    .input('StatusID',         sql.Int, statusID)
    .input('StockLocationID',  sql.Int, stockLocationID  ?? null)
    .input('AssignedToUserID', sql.Int, assignedToUserID ?? null)
    .query(`
      UPDATE Inventory SET
        StatusID         = @StatusID,
        StockLocationID  = @StockLocationID,
        AssignedToUserID = @AssignedToUserID
      WHERE ItemID = @ItemID
    `);

  await writeAudit({
    tableName: 'Inventory', recordID: itemID, action: 'STATUS_CHANGE',
    newValues: { statusName, stockLocationID, assignedToUserID },
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
}

async function checkOut(itemID, userID, pulledFromLocationID, notes, auditContext = {}) {
  const pool = await getPool();

  // Update Inventory status atomically
  await updateStatus(itemID, 'Checked-Out', { stockLocationID: null, assignedToUserID: userID }, auditContext);

  // Insert open possession record
  await pool.request()
    .input('ItemID',               sql.Int,              itemID)
    .input('UserID',               sql.Int,              userID)
    .input('PulledFromLocationID', sql.Int,              pulledFromLocationID ?? null)
    .input('Notes',                sql.NVarChar(sql.MAX), notes               || null)
    .query(`
      INSERT INTO UserInventoryPossession (ItemID, UserID, PulledFromLocationID, Notes, CheckedOutAt)
      VALUES (@ItemID, @UserID, @PulledFromLocationID, @Notes, GETUTCDATE())
    `);

  await writeAudit({
    tableName: 'UserInventoryPossession', recordID: itemID, action: 'CHECK_OUT',
    newValues: { itemID, userID, pulledFromLocationID, notes },
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
}

async function checkIn(itemID, stockLocationID, notes, auditContext = {}) {
  const pool = await getPool();

  // Close the open possession record
  await pool.request()
    .input('ItemID', sql.Int,              itemID)
    .input('Notes',  sql.NVarChar(sql.MAX), notes || null)
    .query(`
      UPDATE UserInventoryPossession
      SET CheckedInAt = GETUTCDATE(),
          Notes       = COALESCE(@Notes, Notes)
      WHERE ItemID = @ItemID
        AND CheckedInAt IS NULL
    `);

  // Update Inventory status
  await updateStatus(itemID, 'In-Stock', { stockLocationID, assignedToUserID: null }, auditContext);

  await writeAudit({
    tableName: 'UserInventoryPossession', recordID: itemID, action: 'CHECK_IN',
    newValues: { itemID, stockLocationID, notes },
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
}

async function getPossessionHistory(itemID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('ItemID', sql.Int, itemID)
    .query(`
      SELECT
        p.PossessionID, p.ItemID, p.UserID, p.CheckedOutAt, p.CheckedInAt,
        p.PulledFromLocationID, p.Notes,
        u.DisplayName AS UserName,
        l.LocationName AS PulledFromLocationName
      FROM UserInventoryPossession p
      LEFT JOIN Users         u ON u.UserID     = p.UserID
      LEFT JOIN StockLocations l ON l.LocationID = p.PulledFromLocationID
      WHERE p.ItemID = @ItemID
      ORDER BY p.CheckedOutAt DESC
    `);
  return result.recordset;
}

async function getCurrentHolder(itemID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('ItemID', sql.Int, itemID)
    .query(`
      SELECT
        p.PossessionID, p.ItemID, p.UserID, p.CheckedOutAt,
        p.PulledFromLocationID, p.Notes,
        u.DisplayName AS UserName,
        l.LocationName AS PulledFromLocationName
      FROM UserInventoryPossession p
      LEFT JOIN Users         u ON u.UserID     = p.UserID
      LEFT JOIN StockLocations l ON l.LocationID = p.PulledFromLocationID
      WHERE p.ItemID = @ItemID
        AND p.CheckedInAt IS NULL
    `);
  return result.recordset[0] || null;
}

// ── InventoryStock helpers (bulk quantity distribution) ───────────────────────

async function getStock(itemID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('ItemID', sql.Int, itemID)
    .query(`
      SELECT s.StockID, s.ItemID, s.LocationID, s.UserID, s.Quantity, s.Notes,
             l.LocationName, u.DisplayName AS UserDisplayName
      FROM InventoryStock s
      LEFT JOIN StockLocations l ON l.LocationID = s.LocationID
      LEFT JOIN Users          u ON u.UserID     = s.UserID
      WHERE s.ItemID = @ItemID AND s.Quantity > 0
      ORDER BY l.LocationName, u.DisplayName
    `);
  return result.recordset;
}

async function upsertStock(itemID, { locationID, userID, quantity, notes } = {}) {
  const pool = await getPool();
  const qty  = parseInt(quantity, 10) || 0;

  // Validate: sum of all other rows + this qty must not exceed QuantityTotal
  const itemRow = await pool.request()
    .input('ItemID', sql.Int, itemID)
    .query('SELECT QuantityTotal FROM Inventory WHERE ItemID = @ItemID');
  const quantityTotal = itemRow.recordset[0]?.QuantityTotal ?? 0;

  // Sum existing stock rows, excluding the row we're about to update
  const chkReq = pool.request().input('ItemID', sql.Int, itemID);
  let excludeClause = '';
  if (locationID) {
    chkReq.input('ExcludeLocationID', sql.Int, parseInt(locationID, 10));
    excludeClause = 'AND (LocationID != @ExcludeLocationID OR LocationID IS NULL)';
  } else if (userID) {
    chkReq.input('ExcludeUserID', sql.Int, parseInt(userID, 10));
    excludeClause = 'AND (UserID != @ExcludeUserID OR UserID IS NULL)';
  }
  const chkResult = await chkReq.query(
    `SELECT ISNULL(SUM(Quantity), 0) AS OtherTotal FROM InventoryStock WHERE ItemID = @ItemID ${excludeClause}`
  );
  const otherTotal = chkResult.recordset[0].OtherTotal;

  if (otherTotal + qty > quantityTotal) {
    const err = new Error(
      `Cannot distribute ${qty} unit(s) here — ${otherTotal} already distributed elsewhere, ` +
      `leaving only ${quantityTotal - otherTotal} of ${quantityTotal} total available.`
    );
    err.userMessage = err.message;
    throw err;
  }

  const req = pool.request()
    .input('ItemID',   sql.Int,           itemID)
    .input('Quantity', sql.Int,           qty)
    .input('Notes',    sql.NVarChar(255), notes || null);

  if (locationID) {
    req.input('LocationID', sql.Int, parseInt(locationID, 10));
    await req.query(`
      IF EXISTS (SELECT 1 FROM InventoryStock WHERE ItemID = @ItemID AND LocationID = @LocationID)
        UPDATE InventoryStock SET Quantity = @Quantity, Notes = @Notes, UpdatedAt = GETUTCDATE()
        WHERE  ItemID = @ItemID AND LocationID = @LocationID
      ELSE
        INSERT INTO InventoryStock (ItemID, LocationID, Quantity, Notes)
        VALUES (@ItemID, @LocationID, @Quantity, @Notes)
    `);
  } else if (userID) {
    req.input('UserID', sql.Int, parseInt(userID, 10));
    await req.query(`
      IF EXISTS (SELECT 1 FROM InventoryStock WHERE ItemID = @ItemID AND UserID = @UserID)
        UPDATE InventoryStock SET Quantity = @Quantity, Notes = @Notes, UpdatedAt = GETUTCDATE()
        WHERE  ItemID = @ItemID AND UserID = @UserID
      ELSE
        INSERT INTO InventoryStock (ItemID, UserID, Quantity, Notes)
        VALUES (@ItemID, @UserID, @Quantity, @Notes)
    `);
  }
}

async function removeStock(stockID) {
  const pool = await getPool();
  await pool.request()
    .input('StockID', sql.Int, stockID)
    .query('DELETE FROM InventoryStock WHERE StockID = @StockID');
}

async function adjustStock(itemID, locationID, userID, delta) {
  if (!locationID && !userID) return;
  const pool = await getPool();
  const req  = pool.request()
    .input('ItemID', sql.Int, itemID)
    .input('Delta',  sql.Int, delta);

  if (locationID) {
    req.input('LocationID', sql.Int, locationID);
    await req.query(`
      UPDATE InventoryStock
      SET Quantity = Quantity + @Delta, UpdatedAt = GETUTCDATE()
      WHERE ItemID = @ItemID AND LocationID = @LocationID
    `);
  } else {
    req.input('UserID', sql.Int, userID);
    await req.query(`
      UPDATE InventoryStock
      SET Quantity = Quantity + @Delta, UpdatedAt = GETUTCDATE()
      WHERE ItemID = @ItemID AND UserID = @UserID
    `);
  }
}

async function getInStock() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      i.ItemID, i.TrackingType, i.SerialNumber, i.ModelNumber, i.Manufacturer,
      i.QuantityTotal,
      i.QuantityTotal - ISNULL((
        SELECT SUM(si.Quantity) FROM SiteInventory si
        WHERE si.ItemID = i.ItemID AND si.RemovedAt IS NULL
      ), 0) AS QuantityAvailable,
      i.StockLocationID, c.CategoryName, l.LocationName AS StockLocationName
    FROM Inventory i
    LEFT JOIN InventoryCategories c  ON c.CategoryID  = i.CategoryID
    LEFT JOIN StockLocations      l  ON l.LocationID  = i.StockLocationID
    JOIN  InventoryStatuses       s  ON s.StatusID    = i.StatusID
    WHERE i.IsActive = 1
      AND (
        -- Serialized: must have In-Stock status
        (i.TrackingType = 'serialized' AND s.StatusName = 'In-Stock')
        OR
        -- Bulk: available quantity must be > 0
        (i.TrackingType = 'bulk' AND
          i.QuantityTotal - ISNULL((
            SELECT SUM(si2.Quantity) FROM SiteInventory si2
            WHERE si2.ItemID = i.ItemID AND si2.RemovedAt IS NULL
          ), 0) > 0)
      )
    ORDER BY i.TrackingType DESC, i.Manufacturer, i.ModelNumber, i.SerialNumber
  `);
  return result.recordset;
}

module.exports = {
  getAll, getByID, create, update, softDelete,
  updateStatus, checkOut, checkIn,
  getPossessionHistory, getCurrentHolder,
  getInStock,
  getStock, upsertStock, removeStock, adjustStock,
};
