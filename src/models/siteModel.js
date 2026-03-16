'use strict';

const { getPool, sql } = require('../config/database');
const { writeAudit }   = require('./auditModel');

async function getAll({ typeID, statusID, search, pmDue, page = 1, pageSize = 25 } = {}) {
  const pool = await getPool();
  const request = pool.request();
  const conditions = ['s.IsActive = 1'];

  if (typeID) {
    conditions.push('s.SiteTypeID = @TypeID');
    request.input('TypeID', sql.Int, typeID);
  }
  if (statusID) {
    conditions.push('s.SiteStatusID = @StatusID');
    request.input('StatusID', sql.Int, statusID);
  }
  if (search) {
    conditions.push('(s.SiteName LIKE @Search OR s.City LIKE @Search OR s.Address LIKE @Search)');
    request.input('Search', sql.NVarChar(200), `%${search}%`);
  }
  if (pmDue == 1 || pmDue === true) {
    conditions.push(`EXISTS (
      SELECT 1 FROM PMSchedules pm
      WHERE pm.SiteID = s.SiteID
        AND DATEADD(DAY, pm.FrequencyDays, pm.LastPerformedAt) <= GETUTCDATE()
    )`);
  }

  const where = conditions.join(' AND ');
  const offset = (page - 1) * pageSize;
  request.input('Offset',   sql.Int, offset);
  request.input('PageSize', sql.Int, pageSize);

  const countReq = pool.request();
  if (typeID)  countReq.input('TypeID',  sql.Int,           typeID);
  if (statusID) countReq.input('StatusID', sql.Int,          statusID);
  if (search)  countReq.input('Search',  sql.NVarChar(200), `%${search}%`);

  const countResult = await countReq.query(`
    SELECT COUNT(*) AS Total
    FROM Sites s
    WHERE ${where}
  `);
  const total = countResult.recordset[0].Total;

  const result = await request.query(`
    SELECT
      s.SiteID, s.SiteName, s.Address, s.City, s.State, s.ZipCode,
      s.Latitude, s.Longitude, s.Description, s.WarrantyExpires,
      s.IsActive, s.CreatedAt,
      t.TypeName   AS SiteTypeName,
      ss.StatusName AS SiteStatusName
    FROM Sites s
    LEFT JOIN SiteTypes    t  ON t.SiteTypeID   = s.SiteTypeID
    LEFT JOIN SiteStatuses ss ON ss.SiteStatusID = s.SiteStatusID
    WHERE ${where}
    ORDER BY s.SiteName
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

async function getByID(siteID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('SiteID', sql.Int, siteID)
    .query(`
      SELECT
        s.SiteID, s.SiteName, s.SiteTypeID, s.SiteStatusID,
        s.Address, s.City, s.State, s.ZipCode,
        s.Latitude, s.Longitude, s.Description, s.WarrantyExpires,
        s.IsActive, s.CreatedAt, s.CreatedByUserID,
        t.TypeName    AS SiteTypeName,
        ss.StatusName AS SiteStatusName,
        u.DisplayName AS CreatedByName
      FROM Sites s
      LEFT JOIN SiteTypes    t  ON t.SiteTypeID   = s.SiteTypeID
      LEFT JOIN SiteStatuses ss ON ss.SiteStatusID = s.SiteStatusID
      LEFT JOIN Users        u  ON u.UserID        = s.CreatedByUserID
      WHERE s.SiteID = @SiteID
    `);
  return result.recordset[0] || null;
}

async function create(data, auditContext = {}) {
  const {
    siteName, siteTypeID, siteStatusID, address, city, state, zipCode,
    latitude, longitude, description, warrantyExpires,
  } = data;

  const pool = await getPool();
  const result = await pool.request()
    .input('SiteName',       sql.NVarChar(200),  siteName)
    .input('SiteTypeID',     sql.Int,             siteTypeID   || null)
    .input('SiteStatusID',   sql.Int,             siteStatusID || null)
    .input('Address',        sql.NVarChar(255),   address      || null)
    .input('City',           sql.NVarChar(100),   city         || null)
    .input('State',          sql.NVarChar(50),    state        || null)
    .input('ZipCode',        sql.NVarChar(20),    zipCode      || null)
    .input('Latitude',       sql.Decimal(10, 7),  latitude     ?? null)
    .input('Longitude',      sql.Decimal(10, 7),  longitude    ?? null)
    .input('Description',    sql.NVarChar(sql.MAX), description || null)
    .input('WarrantyExpires',sql.Date,            warrantyExpires ? new Date(warrantyExpires) : null)
    .input('CreatedByUserID',sql.Int,             auditContext.userID || null)
    .query(`
      INSERT INTO Sites
        (SiteName, SiteTypeID, SiteStatusID, Address, City, State, ZipCode,
         Latitude, Longitude, Description, WarrantyExpires, CreatedByUserID)
      VALUES
        (@SiteName, @SiteTypeID, @SiteStatusID, @Address, @City, @State, @ZipCode,
         @Latitude, @Longitude, @Description, @WarrantyExpires, @CreatedByUserID);
      SELECT SCOPE_IDENTITY() AS NewID
    `);

  const newID = result.recordset[0].NewID;
  await writeAudit({
    tableName: 'Sites', recordID: newID, action: 'INSERT',
    newValues: data,
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
  return getByID(newID);
}

async function update(siteID, data, auditContext = {}) {
  const {
    siteName, siteTypeID, siteStatusID, address, city, state, zipCode,
    latitude, longitude, description, warrantyExpires,
  } = data;

  const pool = await getPool();
  const old  = await getByID(siteID);

  await pool.request()
    .input('SiteID',         sql.Int,             siteID)
    .input('SiteName',       sql.NVarChar(200),   siteName)
    .input('SiteTypeID',     sql.Int,             siteTypeID   || null)
    .input('SiteStatusID',   sql.Int,             siteStatusID || null)
    .input('Address',        sql.NVarChar(255),   address      || null)
    .input('City',           sql.NVarChar(100),   city         || null)
    .input('State',          sql.NVarChar(50),    state        || null)
    .input('ZipCode',        sql.NVarChar(20),    zipCode      || null)
    .input('Latitude',       sql.Decimal(10, 7),  latitude     ?? null)
    .input('Longitude',      sql.Decimal(10, 7),  longitude    ?? null)
    .input('Description',    sql.NVarChar(sql.MAX), description || null)
    .input('WarrantyExpires',sql.Date,            warrantyExpires ? new Date(warrantyExpires) : null)
    .query(`
      UPDATE Sites SET
        SiteName       = @SiteName,
        SiteTypeID     = @SiteTypeID,
        SiteStatusID   = @SiteStatusID,
        Address        = @Address,
        City           = @City,
        State          = @State,
        ZipCode        = @ZipCode,
        Latitude       = @Latitude,
        Longitude      = @Longitude,
        Description    = @Description,
        WarrantyExpires = @WarrantyExpires
      WHERE SiteID = @SiteID
    `);

  await writeAudit({
    tableName: 'Sites', recordID: siteID, action: 'UPDATE',
    oldValues: old, newValues: data,
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
  return getByID(siteID);
}

async function softDelete(siteID, auditContext = {}) {
  const pool = await getPool();
  await pool.request()
    .input('SiteID', sql.Int, siteID)
    .query('UPDATE Sites SET IsActive = 0 WHERE SiteID = @SiteID');

  await writeAudit({
    tableName: 'Sites', recordID: siteID, action: 'DELETE',
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
}

module.exports = { getAll, getByID, create, update, softDelete };
