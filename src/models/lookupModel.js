'use strict';

const { getPool, sql } = require('../config/database');

// ── Generic helpers ───────────────────────────────────────────────────────────

async function _getAll(table, orderBy = 'ID') {
  const pool = await getPool();
  const r = await pool.request().query(`SELECT * FROM ${table} ORDER BY ${orderBy}`);
  return r.recordset;
}

// ── Roles ─────────────────────────────────────────────────────────────────────
async function getRoles() {
  return _getAll('Roles', 'RoleName');
}

// ── Site Types ────────────────────────────────────────────────────────────────
async function getSiteTypes(activeOnly = true) {
  const pool = await getPool();
  const r = await pool.request()
    .input('ActiveOnly', sql.Bit, activeOnly ? 1 : 0)
    .query(`SELECT * FROM SiteTypes WHERE (@ActiveOnly = 0 OR IsActive = 1) ORDER BY TypeName`);
  return r.recordset;
}

async function upsertSiteType(id, typeName, description, auditContext = {}) {
  const pool = await getPool();
  if (id) {
    await pool.request()
      .input('ID', sql.Int, id)
      .input('TypeName', sql.NVarChar(100), typeName)
      .input('Description', sql.NVarChar(255), description || null)
      .query('UPDATE SiteTypes SET TypeName = @TypeName, Description = @Description WHERE SiteTypeID = @ID');
  } else {
    await pool.request()
      .input('TypeName', sql.NVarChar(100), typeName)
      .input('Description', sql.NVarChar(255), description || null)
      .query('INSERT INTO SiteTypes (TypeName, Description) VALUES (@TypeName, @Description)');
  }
}

async function toggleSiteType(id) {
  const pool = await getPool();
  await pool.request().input('ID', sql.Int, id)
    .query('UPDATE SiteTypes SET IsActive = 1 - IsActive WHERE SiteTypeID = @ID');
}

// ── Site Statuses ─────────────────────────────────────────────────────────────
async function getSiteStatuses(activeOnly = true) {
  const pool = await getPool();
  const r = await pool.request()
    .input('ActiveOnly', sql.Bit, activeOnly ? 1 : 0)
    .query(`SELECT * FROM SiteStatuses WHERE (@ActiveOnly = 0 OR IsActive = 1) ORDER BY StatusName`);
  return r.recordset;
}

// ── Log Types ─────────────────────────────────────────────────────────────────
async function getLogTypes(activeOnly = true) {
  const pool = await getPool();
  const r = await pool.request()
    .input('ActiveOnly', sql.Bit, activeOnly ? 1 : 0)
    .query(`SELECT * FROM LogTypes WHERE (@ActiveOnly = 0 OR IsActive = 1) ORDER BY TypeName`);
  return r.recordset;
}

async function getLogTypeByName(name) {
  const pool = await getPool();
  const r = await pool.request()
    .input('Name', sql.NVarChar(100), name)
    .query('SELECT * FROM LogTypes WHERE TypeName = @Name');
  return r.recordset[0] || null;
}

async function upsertLogType(id, typeName, isAutomatic = 0) {
  const pool = await getPool();
  if (id) {
    await pool.request()
      .input('ID', sql.Int, id)
      .input('TypeName', sql.NVarChar(100), typeName)
      .query('UPDATE LogTypes SET TypeName = @TypeName WHERE LogTypeID = @ID');
  } else {
    await pool.request()
      .input('TypeName', sql.NVarChar(100), typeName)
      .input('IsAutomatic', sql.Bit, isAutomatic)
      .query('INSERT INTO LogTypes (TypeName, IsAutomatic) VALUES (@TypeName, @IsAutomatic)');
  }
}

async function toggleLogType(id) {
  const pool = await getPool();
  await pool.request().input('ID', sql.Int, id)
    .query('UPDATE LogTypes SET IsActive = 1 - IsActive WHERE LogTypeID = @ID');
}

// ── Inventory Categories ──────────────────────────────────────────────────────
async function getInventoryCategories(activeOnly = true) {
  const pool = await getPool();
  const r = await pool.request()
    .input('ActiveOnly', sql.Bit, activeOnly ? 1 : 0)
    .query(`SELECT * FROM InventoryCategories WHERE (@ActiveOnly = 0 OR IsActive = 1) ORDER BY CategoryName`);
  return r.recordset;
}

async function upsertInventoryCategory(id, categoryName, description) {
  const pool = await getPool();
  if (id) {
    await pool.request()
      .input('ID', sql.Int, id)
      .input('CategoryName', sql.NVarChar(100), categoryName)
      .input('Description',  sql.NVarChar(255), description || null)
      .query('UPDATE InventoryCategories SET CategoryName = @CategoryName, Description = @Description WHERE CategoryID = @ID');
  } else {
    await pool.request()
      .input('CategoryName', sql.NVarChar(100), categoryName)
      .input('Description',  sql.NVarChar(255), description || null)
      .query('INSERT INTO InventoryCategories (CategoryName, Description) VALUES (@CategoryName, @Description)');
  }
}

async function toggleInventoryCategory(id) {
  const pool = await getPool();
  await pool.request().input('ID', sql.Int, id)
    .query('UPDATE InventoryCategories SET IsActive = 1 - IsActive WHERE CategoryID = @ID');
}

// ── Inventory Statuses ────────────────────────────────────────────────────────
async function getInventoryStatuses() {
  return _getAll('InventoryStatuses', 'StatusName');
}

async function getInventoryStatusByName(name) {
  const pool = await getPool();
  const r = await pool.request()
    .input('Name', sql.NVarChar(50), name)
    .query('SELECT * FROM InventoryStatuses WHERE StatusName = @Name');
  return r.recordset[0] || null;
}

// ── Stock Locations ───────────────────────────────────────────────────────────
async function getStockLocations(activeOnly = true) {
  const pool = await getPool();
  const r = await pool.request()
    .input('ActiveOnly', sql.Bit, activeOnly ? 1 : 0)
    .query(`SELECT * FROM StockLocations WHERE (@ActiveOnly = 0 OR IsActive = 1) ORDER BY LocationName`);
  return r.recordset;
}

async function upsertStockLocation(id, locationName, description) {
  const pool = await getPool();
  if (id) {
    await pool.request()
      .input('ID', sql.Int, id)
      .input('LocationName', sql.NVarChar(150), locationName)
      .input('Description',  sql.NVarChar(500), description || null)
      .query('UPDATE StockLocations SET LocationName = @LocationName, Description = @Description WHERE LocationID = @ID');
  } else {
    await pool.request()
      .input('LocationName', sql.NVarChar(150), locationName)
      .input('Description',  sql.NVarChar(500), description || null)
      .query('INSERT INTO StockLocations (LocationName, Description) VALUES (@LocationName, @Description)');
  }
}

async function toggleStockLocation(id) {
  const pool = await getPool();
  await pool.request().input('ID', sql.Int, id)
    .query('UPDATE StockLocations SET IsActive = 1 - IsActive WHERE LocationID = @ID');
}

// ── Inventory Common Names ────────────────────────────────────────────────────
async function getInventoryCommonNames(activeOnly = true) {
  const pool = await getPool();
  const r = await pool.request()
    .input('ActiveOnly', sql.Bit, activeOnly ? 1 : 0)
    .query(`SELECT * FROM InventoryCommonNames WHERE (@ActiveOnly = 0 OR IsActive = 1) ORDER BY Name`);
  return r.recordset;
}

async function upsertInventoryCommonName(id, name) {
  const pool = await getPool();
  if (id) {
    await pool.request()
      .input('ID', sql.Int, id)
      .input('Name', sql.NVarChar(150), name)
      .query('UPDATE InventoryCommonNames SET Name = @Name WHERE CommonNameID = @ID');
  } else {
    await pool.request()
      .input('Name', sql.NVarChar(150), name)
      .query('INSERT INTO InventoryCommonNames (Name) VALUES (@Name)');
  }
}

async function toggleInventoryCommonName(id) {
  const pool = await getPool();
  await pool.request().input('ID', sql.Int, id)
    .query('UPDATE InventoryCommonNames SET IsActive = 1 - IsActive WHERE CommonNameID = @ID');
}

// ── Inventory Model Numbers ───────────────────────────────────────────────────
async function getInventoryModelNumbers(activeOnly = true) {
  const pool = await getPool();
  const r = await pool.request()
    .input('ActiveOnly', sql.Bit, activeOnly ? 1 : 0)
    .query(`SELECT * FROM InventoryModelNumbers WHERE (@ActiveOnly = 0 OR IsActive = 1) ORDER BY Name`);
  return r.recordset;
}

async function upsertInventoryModelNumber(id, name) {
  const pool = await getPool();
  if (id) {
    await pool.request()
      .input('ID', sql.Int, id)
      .input('Name', sql.NVarChar(150), name)
      .query('UPDATE InventoryModelNumbers SET Name = @Name WHERE ModelNumberID = @ID');
  } else {
    await pool.request()
      .input('Name', sql.NVarChar(150), name)
      .query('INSERT INTO InventoryModelNumbers (Name) VALUES (@Name)');
  }
}

async function toggleInventoryModelNumber(id) {
  const pool = await getPool();
  await pool.request().input('ID', sql.Int, id)
    .query('UPDATE InventoryModelNumbers SET IsActive = 1 - IsActive WHERE ModelNumberID = @ID');
}

// ── Inventory Manufacturers ───────────────────────────────────────────────────
async function getInventoryManufacturers(activeOnly = true) {
  const pool = await getPool();
  const r = await pool.request()
    .input('ActiveOnly', sql.Bit, activeOnly ? 1 : 0)
    .query(`SELECT * FROM InventoryManufacturers WHERE (@ActiveOnly = 0 OR IsActive = 1) ORDER BY Name`);
  return r.recordset;
}

async function upsertInventoryManufacturer(id, name) {
  const pool = await getPool();
  if (id) {
    await pool.request()
      .input('ID', sql.Int, id)
      .input('Name', sql.NVarChar(150), name)
      .query('UPDATE InventoryManufacturers SET Name = @Name WHERE ManufacturerID = @ID');
  } else {
    await pool.request()
      .input('Name', sql.NVarChar(150), name)
      .query('INSERT INTO InventoryManufacturers (Name) VALUES (@Name)');
  }
}

async function toggleInventoryManufacturer(id) {
  const pool = await getPool();
  await pool.request().input('ID', sql.Int, id)
    .query('UPDATE InventoryManufacturers SET IsActive = 1 - IsActive WHERE ManufacturerID = @ID');
}

// ── Maintenance Types ─────────────────────────────────────────────────────────
async function getMaintenanceTypes(activeOnly = true) {
  const pool = await getPool();
  const r = await pool.request()
    .input('ActiveOnly', sql.Bit, activeOnly ? 1 : 0)
    .query(`SELECT * FROM MaintenanceTypes WHERE (@ActiveOnly = 0 OR IsActive = 1) ORDER BY TypeName`);
  return r.recordset;
}

async function upsertMaintenanceType(id, typeName) {
  const pool = await getPool();
  if (id) {
    await pool.request()
      .input('ID',       sql.Int,          id)
      .input('TypeName', sql.NVarChar(100), typeName)
      .query('UPDATE MaintenanceTypes SET TypeName = @TypeName WHERE MaintenanceTypeID = @ID');
  } else {
    await pool.request()
      .input('TypeName', sql.NVarChar(100), typeName)
      .query('INSERT INTO MaintenanceTypes (TypeName) VALUES (@TypeName)');
  }
}

async function toggleMaintenanceType(id) {
  const pool = await getPool();
  await pool.request().input('ID', sql.Int, id)
    .query('UPDATE MaintenanceTypes SET IsActive = 1 - IsActive WHERE MaintenanceTypeID = @ID');
}

// ── Key Manufacturers ─────────────────────────────────────────────────────────
async function getKeyManufacturers(activeOnly = true) {
  const pool = await getPool();
  const r = await pool.request()
    .input('ActiveOnly', sql.Bit, activeOnly ? 1 : 0)
    .query(`SELECT * FROM KeyManufacturers WHERE (@ActiveOnly = 0 OR IsActive = 1) ORDER BY ManufacturerName`);
  return r.recordset;
}

async function upsertKeyManufacturer(id, manufacturerName, description) {
  const pool = await getPool();
  if (id) {
    await pool.request()
      .input('ID',              sql.Int,          id)
      .input('ManufacturerName', sql.NVarChar(200), manufacturerName)
      .input('Description',     sql.NVarChar(500), description || null)
      .query('UPDATE KeyManufacturers SET ManufacturerName = @ManufacturerName, Description = @Description WHERE ManufacturerID = @ID');
  } else {
    await pool.request()
      .input('ManufacturerName', sql.NVarChar(200), manufacturerName)
      .input('Description',     sql.NVarChar(500), description || null)
      .query('INSERT INTO KeyManufacturers (ManufacturerName, Description) VALUES (@ManufacturerName, @Description)');
  }
}

async function toggleKeyManufacturer(id) {
  const pool = await getPool();
  await pool.request().input('ID', sql.Int, id)
    .query('UPDATE KeyManufacturers SET IsActive = 1 - IsActive WHERE ManufacturerID = @ID');
}

module.exports = {
  getRoles,
  getSiteTypes, upsertSiteType, toggleSiteType,
  getSiteStatuses,
  getLogTypes, getLogTypeByName, upsertLogType, toggleLogType,
  getInventoryCategories, upsertInventoryCategory, toggleInventoryCategory,
  getInventoryStatuses, getInventoryStatusByName,
  getStockLocations, upsertStockLocation, toggleStockLocation,
  getMaintenanceTypes, upsertMaintenanceType, toggleMaintenanceType,
  getKeyManufacturers, upsertKeyManufacturer, toggleKeyManufacturer,
  getInventoryCommonNames, upsertInventoryCommonName, toggleInventoryCommonName,
  getInventoryModelNumbers, upsertInventoryModelNumber, toggleInventoryModelNumber,
  getInventoryManufacturers, upsertInventoryManufacturer, toggleInventoryManufacturer,
};
