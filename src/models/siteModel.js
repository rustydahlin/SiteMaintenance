'use strict';

const { getPool, sql } = require('../config/database');
const { writeAudit }   = require('./auditModel');

const SORT_COLUMNS = {
  siteNumber: 's.SiteNumber',
  siteName:   's.SiteName',
  type:       't.TypeName',
  status:     'ss.StatusName',
  city:       's.City',
  warranty:   's.WarrantyExpires',
  nextPM:     'NextPMDate',
};

async function getAll({ typeID, statusID, search, pmDue, page = 1, pageSize = 25, sort = 'siteName', dir = 'asc' } = {}) {
  const pool = await getPool();
  const request = pool.request();
  const conditions = ['s.IsActive = 1', 's.ParentSiteID IS NULL'];

  if (typeID) {
    conditions.push('s.SiteTypeID = @TypeID');
    request.input('TypeID', sql.Int, typeID);
  }
  if (statusID) {
    conditions.push('s.SiteStatusID = @StatusID');
    request.input('StatusID', sql.Int, statusID);
  }
  if (search) {
    conditions.push('(s.SiteName LIKE @Search OR s.City LIKE @Search OR s.Address LIKE @Search OR s.SiteNumber LIKE @Search)');
    request.input('Search', sql.NVarChar(200), `%${search}%`);
  }
  if (pmDue == 1 || pmDue === true) {
    conditions.push(`EXISTS (
      SELECT 1 FROM PMSchedules pm
      WHERE pm.SiteID = s.SiteID
        AND pm.IsActive = 1
        AND (pm.LastPerformedAt IS NULL
          OR DATEADD(DAY, pm.FrequencyDays, pm.LastPerformedAt) <= DATEADD(DAY, 14, GETUTCDATE()))
    )`);
  }

  const orderCol = SORT_COLUMNS[sort] || 's.SiteName';
  const orderDir = dir === 'desc' ? 'DESC' : 'ASC';

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
      s.SiteID, s.SiteName, s.SiteNumber, s.Address, s.City, s.State, s.ZipCode,
      s.Latitude, s.Longitude, s.Description, s.WarrantyExpires,
      s.IsActive, s.CreatedAt,
      t.TypeName    AS SiteTypeName,
      ss.StatusName AS SiteStatusName,
      (SELECT MIN(DATEADD(DAY, pm.FrequencyDays, pm.LastPerformedAt))
       FROM PMSchedules pm
       WHERE pm.SiteID = s.SiteID AND pm.IsActive = 1 AND pm.LastPerformedAt IS NOT NULL
      ) AS NextPMDate
    FROM Sites s
    LEFT JOIN SiteTypes    t  ON t.SiteTypeID   = s.SiteTypeID
    LEFT JOIN SiteStatuses ss ON ss.SiteStatusID = s.SiteStatusID
    WHERE ${where}
    ORDER BY ${orderCol} ${orderDir}
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
        s.SiteID, s.SiteName, s.SiteNumber, s.ContractNumber,
        s.SiteTypeID, s.SiteStatusID,
        s.Address, s.City, s.State, s.ZipCode,
        s.Latitude, s.Longitude, s.Description, s.WarrantyExpires,
        s.IsActive, s.CreatedAt, s.CreatedByUserID,
        s.ParentSiteID,
        p.SiteName    AS ParentSiteName,
        t.TypeName    AS SiteTypeName,
        ss.StatusName AS SiteStatusName,
        u.DisplayName AS CreatedByName
      FROM Sites s
      LEFT JOIN Sites         p  ON p.SiteID       = s.ParentSiteID
      LEFT JOIN SiteTypes    t  ON t.SiteTypeID   = s.SiteTypeID
      LEFT JOIN SiteStatuses ss ON ss.SiteStatusID = s.SiteStatusID
      LEFT JOIN Users        u  ON u.UserID        = s.CreatedByUserID
      WHERE s.SiteID = @SiteID
    `);
  return result.recordset[0] || null;
}

async function create(data, auditContext = {}) {
  const {
    siteName, siteNumber, contractNumber, siteTypeID,
    address, city, state, zipCode, latitude, longitude, description,
    warrantyExpires, parentSiteID,
  } = data;

  const pool = await getPool();
  const result = await pool.request()
    .input('SiteName',        sql.NVarChar(200),   siteName)
    .input('SiteNumber',      sql.NVarChar(100),   siteNumber      || null)
    .input('ContractNumber',  sql.NVarChar(100),   contractNumber  || null)
    .input('SiteTypeID',      sql.Int,             siteTypeID      || null)
    .input('Address',         sql.NVarChar(255),   address         || null)
    .input('City',            sql.NVarChar(100),   city            || null)
    .input('State',           sql.NVarChar(50),    state           || null)
    .input('ZipCode',         sql.NVarChar(20),    zipCode         || null)
    .input('Latitude',        sql.Decimal(10, 7),  latitude        ?? null)
    .input('Longitude',       sql.Decimal(10, 7),  longitude       ?? null)
    .input('Description',     sql.NVarChar(sql.MAX), description   || null)
    .input('WarrantyExpires', sql.Date,            warrantyExpires ? new Date(warrantyExpires) : null)
    .input('CreatedByUserID', sql.Int,             auditContext.userID || null)
    .input('ParentSiteID',    sql.Int,             parentSiteID    || null)
    .query(`
      INSERT INTO Sites
        (SiteName, SiteNumber, ContractNumber, SiteTypeID,
         SiteStatusID,
         Address, City, State, ZipCode, Latitude, Longitude, Description,
         WarrantyExpires, CreatedByUserID, ParentSiteID)
      VALUES
        (@SiteName, @SiteNumber, @ContractNumber, @SiteTypeID,
         (SELECT TOP 1 SiteStatusID FROM SiteStatuses WHERE StatusName = 'Current' AND IsActive = 1),
         @Address, @City, @State, @ZipCode, @Latitude, @Longitude, @Description,
         @WarrantyExpires, @CreatedByUserID, @ParentSiteID);
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
    siteName, siteNumber, contractNumber, siteTypeID,
    address, city, state, zipCode, latitude, longitude, description,
    warrantyExpires, parentSiteID,
  } = data;

  const pool = await getPool();
  const old  = await getByID(siteID);

  await pool.request()
    .input('SiteID',          sql.Int,             siteID)
    .input('SiteName',        sql.NVarChar(200),   siteName)
    .input('SiteNumber',      sql.NVarChar(100),   siteNumber      || null)
    .input('ContractNumber',  sql.NVarChar(100),   contractNumber  || null)
    .input('SiteTypeID',      sql.Int,             siteTypeID      || null)
    .input('Address',         sql.NVarChar(255),   address         || null)
    .input('City',            sql.NVarChar(100),   city            || null)
    .input('State',           sql.NVarChar(50),    state           || null)
    .input('ZipCode',         sql.NVarChar(20),    zipCode         || null)
    .input('Latitude',        sql.Decimal(10, 7),  latitude        ?? null)
    .input('Longitude',       sql.Decimal(10, 7),  longitude       ?? null)
    .input('Description',     sql.NVarChar(sql.MAX), description   || null)
    .input('WarrantyExpires', sql.Date,            warrantyExpires ? new Date(warrantyExpires) : null)
    .input('ParentSiteID',    sql.Int,             parentSiteID    || null)
    .query(`
      UPDATE Sites SET
        SiteName        = @SiteName,
        SiteNumber      = @SiteNumber,
        ContractNumber  = @ContractNumber,
        SiteTypeID      = @SiteTypeID,
        Address         = @Address,
        City            = @City,
        State           = @State,
        ZipCode         = @ZipCode,
        Latitude        = @Latitude,
        Longitude       = @Longitude,
        Description     = @Description,
        WarrantyExpires = @WarrantyExpires,
        ParentSiteID    = @ParentSiteID
      WHERE SiteID = @SiteID
    `);

  await writeAudit({
    tableName: 'Sites', recordID: siteID, action: 'UPDATE',
    oldValues: old, newValues: data,
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
  return getByID(siteID);
}

async function getSubsites(parentSiteID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('ParentSiteID', sql.Int, parentSiteID)
    .query(`
      SELECT
        s.SiteID, s.SiteName, s.SiteStatusID, s.SiteTypeID, s.IsActive,
        ss.StatusName,
        t.TypeName AS SiteTypeName
      FROM Sites s
      LEFT JOIN SiteStatuses ss ON ss.SiteStatusID = s.SiteStatusID
      LEFT JOIN SiteTypes    t  ON t.SiteTypeID    = s.SiteTypeID
      WHERE s.ParentSiteID = @ParentSiteID
      ORDER BY s.SiteName
    `);
  return result.recordset;
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

async function getSimpleList() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT s.SiteID, s.SiteName,
           p.SiteName AS ParentSiteName
    FROM Sites s
    LEFT JOIN Sites p ON p.SiteID = s.ParentSiteID
    WHERE s.IsActive = 1
    ORDER BY p.SiteName, s.SiteName
  `);
  return result.recordset;
}

async function findByImportKey(siteNumber, siteName) {
  const pool = await getPool();
  if (siteNumber) {
    const r = await pool.request()
      .input('SiteNumber', sql.NVarChar(100), siteNumber)
      .query('SELECT SiteID FROM Sites WHERE SiteNumber = @SiteNumber AND IsActive = 1');
    if (r.recordset.length) return r.recordset[0].SiteID;
  }
  const r = await pool.request()
    .input('SiteName', sql.NVarChar(200), siteName)
    .query('SELECT SiteID FROM Sites WHERE SiteName = @SiteName AND IsActive = 1');
  return r.recordset.length ? r.recordset[0].SiteID : null;
}

// Recomputes and sets SiteStatusID based on open MaintenanceItems.
// Call after any maintenance item is created, closed, or deleted.
async function updateSiteStatus(siteID) {
  const pool = await getPool();
  await pool.request()
    .input('SiteID', sql.Int, siteID)
    .query(`
      DECLARE @OpenCount    INT;
      DECLARE @OverdueCount INT;
      DECLARE @CurrentID    INT;
      DECLARE @MaintID      INT;
      DECLARE @PastDueID    INT;

      SELECT @OpenCount = COUNT(*)
      FROM MaintenanceItems
      WHERE SiteID = @SiteID AND ClosedAt IS NULL AND IsActive = 1;

      SELECT @OverdueCount = COUNT(*)
      FROM MaintenanceItems
      WHERE SiteID = @SiteID AND ClosedAt IS NULL AND IsActive = 1
        AND DueDate IS NOT NULL AND DueDate < CAST(GETUTCDATE() AS DATE);

      SELECT @CurrentID  = SiteStatusID FROM SiteStatuses WHERE StatusName = 'Current'  AND IsActive = 1;
      SELECT @MaintID    = SiteStatusID FROM SiteStatuses WHERE StatusName = 'Maintenance' AND IsActive = 1;
      SELECT @PastDueID  = SiteStatusID FROM SiteStatuses WHERE StatusName = 'Past-Due'  AND IsActive = 1;

      UPDATE Sites SET SiteStatusID =
        CASE
          WHEN @OverdueCount > 0 THEN @PastDueID
          WHEN @OpenCount    > 0 THEN @MaintID
          ELSE                        @CurrentID
        END
      WHERE SiteID = @SiteID;
    `);
}

module.exports = { getAll, getByID, getSubsites, getSimpleList, create, update, softDelete, findByImportKey, updateSiteStatus };
