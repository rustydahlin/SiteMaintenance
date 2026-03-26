'use strict';

const { getPool, sql } = require('../config/database');
const { writeAudit }   = require('./auditModel');

async function getBySite(siteID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('SiteID', sql.Int, siteID)
    .query(`
      SELECT
        r.ResourceID, r.SiteID, r.Hostname, r.IPAddress,
        r.DeviceTypeID, dt.TypeName AS DeviceTypeName,
        r.AlertStatus, r.SolarwindsNodeId,
        r.CircuitTypeID, ct.TypeName AS CircuitTypeName,
        r.CircuitID, r.Notes,
        r.SortOrder, r.IsActive, r.CreatedAt, r.UpdatedAt
      FROM   NetworkResources r
      JOIN   NetworkDeviceTypes dt ON dt.DeviceTypeID  = r.DeviceTypeID
      LEFT JOIN CircuitTypes    ct ON ct.CircuitTypeID = r.CircuitTypeID
      WHERE  r.SiteID   = @SiteID
        AND  r.IsActive = 1
      ORDER  BY r.SortOrder, r.ResourceID
    `);
  return result.recordset;
}

async function getByID(resourceID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('ResourceID', sql.Int, resourceID)
    .query(`
      SELECT
        r.ResourceID, r.SiteID, r.Hostname, r.IPAddress,
        r.DeviceTypeID, dt.TypeName AS DeviceTypeName,
        r.AlertStatus, r.SolarwindsNodeId,
        r.CircuitTypeID, ct.TypeName AS CircuitTypeName,
        r.CircuitID, r.Notes,
        r.SortOrder, r.IsActive, r.CreatedAt, r.UpdatedAt,
        r.CreatedByUserID, r.UpdatedByUserID
      FROM   NetworkResources r
      JOIN   NetworkDeviceTypes dt ON dt.DeviceTypeID  = r.DeviceTypeID
      LEFT JOIN CircuitTypes    ct ON ct.CircuitTypeID = r.CircuitTypeID
      WHERE  r.ResourceID = @ResourceID
    `);
  return result.recordset[0] || null;
}

// Shifts all active resources for a site with SortOrder >= position up by 1
async function shiftSortOrderUp(pool, siteID, fromPosition) {
  await pool.request()
    .input('SiteID',    sql.Int, siteID)
    .input('FromPos',   sql.Int, fromPosition)
    .query(`
      UPDATE NetworkResources
      SET SortOrder = SortOrder + 1
      WHERE SiteID = @SiteID AND IsActive = 1 AND SortOrder >= @FromPos
    `);
}

async function create(siteID, data, auditContext = {}) {
  const {
    hostname, ipAddress, deviceTypeID, alertStatus,
    solarwindsNodeId, circuitTypeID, circuitID, notes, sortOrder,
  } = data;

  const pool   = await getPool();

  // Shift existing records at >= sortOrder down to make room
  await shiftSortOrderUp(pool, siteID, sortOrder ?? 0);

  const result = await pool.request()
    .input('SiteID',           sql.Int,           siteID)
    .input('Hostname',         sql.NVarChar(150),  hostname)
    .input('IPAddress',        sql.NVarChar(45),   ipAddress        || null)
    .input('DeviceTypeID',     sql.Int,            deviceTypeID)
    .input('AlertStatus',      sql.Bit,            alertStatus !== false && alertStatus !== '0' ? 1 : 0)
    .input('SolarwindsNodeId', sql.Int,            solarwindsNodeId ? parseInt(solarwindsNodeId, 10) : null)
    .input('CircuitTypeID',    sql.Int,            circuitTypeID    ? parseInt(circuitTypeID, 10)    : null)
    .input('CircuitID',        sql.NVarChar(150),  circuitID        || null)
    .input('Notes',            sql.NVarChar(sql.MAX), notes         || null)
    .input('SortOrder',        sql.Int,            sortOrder        ? parseInt(sortOrder, 10)        : 0)
    .input('CreatedByUserID',  sql.Int,            auditContext.userID || null)
    .query(`
      INSERT INTO NetworkResources
        (SiteID, Hostname, IPAddress, DeviceTypeID, AlertStatus,
         SolarwindsNodeId, CircuitTypeID, CircuitID, Notes,
         SortOrder, CreatedByUserID, UpdatedByUserID)
      VALUES
        (@SiteID, @Hostname, @IPAddress, @DeviceTypeID, @AlertStatus,
         @SolarwindsNodeId, @CircuitTypeID, @CircuitID, @Notes,
         @SortOrder, @CreatedByUserID, @CreatedByUserID);
      SELECT SCOPE_IDENTITY() AS NewID
    `);

  const newID = result.recordset[0].NewID;
  await writeAudit({
    tableName: 'NetworkResources', recordID: newID, action: 'INSERT',
    newValues: { siteID, ...data },
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
  return getByID(newID);
}

async function update(resourceID, data, auditContext = {}) {
  const {
    hostname, ipAddress, deviceTypeID, alertStatus,
    solarwindsNodeId, circuitTypeID, circuitID, notes, sortOrder,
  } = data;

  const pool = await getPool();
  const old  = await getByID(resourceID);

  // Shift surrounding records if sort order changed
  const newPos = sortOrder ?? 0;
  const oldPos = old?.SortOrder ?? 0;
  if (newPos !== oldPos) {
    if (newPos < oldPos) {
      // Moving up: shift items in [newPos, oldPos-1] down by 1
      await pool.request()
        .input('SiteID',  sql.Int, old.SiteID)
        .input('FromPos', sql.Int, newPos)
        .input('ToPos',   sql.Int, oldPos - 1)
        .query(`
          UPDATE NetworkResources
          SET SortOrder = SortOrder + 1
          WHERE SiteID = @SiteID AND IsActive = 1
            AND SortOrder >= @FromPos AND SortOrder <= @ToPos
            AND ResourceID <> ${resourceID}
        `);
    } else {
      // Moving down: shift items in [oldPos+1, newPos] up by 1
      await pool.request()
        .input('SiteID',  sql.Int, old.SiteID)
        .input('FromPos', sql.Int, oldPos + 1)
        .input('ToPos',   sql.Int, newPos)
        .query(`
          UPDATE NetworkResources
          SET SortOrder = SortOrder - 1
          WHERE SiteID = @SiteID AND IsActive = 1
            AND SortOrder >= @FromPos AND SortOrder <= @ToPos
            AND ResourceID <> ${resourceID}
        `);
    }
  }

  await pool.request()
    .input('ResourceID',       sql.Int,           resourceID)
    .input('Hostname',         sql.NVarChar(150),  hostname)
    .input('IPAddress',        sql.NVarChar(45),   ipAddress        || null)
    .input('DeviceTypeID',     sql.Int,            deviceTypeID)
    .input('AlertStatus',      sql.Bit,            alertStatus !== false && alertStatus !== '0' ? 1 : 0)
    .input('SolarwindsNodeId', sql.Int,            solarwindsNodeId ? parseInt(solarwindsNodeId, 10) : null)
    .input('CircuitTypeID',    sql.Int,            circuitTypeID    ? parseInt(circuitTypeID, 10)    : null)
    .input('CircuitID',        sql.NVarChar(150),  circuitID        || null)
    .input('Notes',            sql.NVarChar(sql.MAX), notes         || null)
    .input('SortOrder',        sql.Int,            sortOrder        ? parseInt(sortOrder, 10)        : 0)
    .input('UpdatedByUserID',  sql.Int,            auditContext.userID || null)
    .query(`
      UPDATE NetworkResources SET
        Hostname         = @Hostname,
        IPAddress        = @IPAddress,
        DeviceTypeID     = @DeviceTypeID,
        AlertStatus      = @AlertStatus,
        SolarwindsNodeId = @SolarwindsNodeId,
        CircuitTypeID    = @CircuitTypeID,
        CircuitID        = @CircuitID,
        Notes            = @Notes,
        SortOrder        = @SortOrder,
        UpdatedAt        = GETUTCDATE(),
        UpdatedByUserID  = @UpdatedByUserID
      WHERE ResourceID = @ResourceID
    `);

  await writeAudit({
    tableName: 'NetworkResources', recordID: resourceID, action: 'UPDATE',
    oldValues: old, newValues: data,
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
  return getByID(resourceID);
}

async function softDelete(resourceID, auditContext = {}) {
  const pool = await getPool();
  const old  = await getByID(resourceID);

  // Hard delete — no reason to retain network resource records
  await pool.request()
    .input('ResourceID', sql.Int, resourceID)
    .query(`DELETE FROM NetworkResources WHERE ResourceID = @ResourceID`);

  // Close the gap: shift all active records above the deleted position down by 1
  if (old) {
    await pool.request()
      .input('SiteID',  sql.Int, old.SiteID)
      .input('FromPos', sql.Int, old.SortOrder + 1)
      .query(`
        UPDATE NetworkResources
        SET SortOrder = SortOrder - 1
        WHERE SiteID = @SiteID AND IsActive = 1 AND SortOrder >= @FromPos
      `);
  }

  await writeAudit({
    tableName: 'NetworkResources', recordID: resourceID, action: 'DELETE',
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
}

// Returns data in the exact devices.json format consumed by the network map app.
// Only returns sites that have MonitoringLocationTypeID set AND have at least one
// active NetworkResource (INNER JOIN ensures both conditions).
async function getNetworkMapData() {
  const pool   = await getPool();
  const result = await pool.request().query(`
    SELECT
      s.SiteID,
      CASE
        WHEN s.ParentSiteID IS NOT NULL
          THEN ISNULL(parent.SiteNumber + '-', '') + ISNULL(s.SiteNumber + ' ', '') + s.SiteName
        ELSE ISNULL(s.SiteNumber + ' ', '') + s.SiteName
      END                                          AS name,
      CAST(s.Latitude  AS FLOAT)                   AS lat,
      CAST(s.Longitude AS FLOAT)                   AS lng,
      mlt.TypeName                                  AS locType,
      r.ResourceID,
      r.Hostname,
      r.IPAddress,
      dt.TypeName  AS deviceType,
      r.AlertStatus,
      r.SolarwindsNodeId,
      r.SortOrder
    FROM   Sites s
    LEFT JOIN Sites                parent ON parent.SiteID      = s.ParentSiteID
    JOIN   MonitoringLocationTypes mlt    ON mlt.LocationTypeID = s.MonitoringLocationTypeID
    JOIN   NetworkResources        r      ON r.SiteID           = s.SiteID AND r.IsActive = 1
    JOIN   NetworkDeviceTypes      dt     ON dt.DeviceTypeID    = r.DeviceTypeID
    WHERE  s.IsActive   = 1
      AND  s.Latitude   IS NOT NULL
      AND  s.Longitude  IS NOT NULL
    ORDER  BY name, r.SortOrder, r.ResourceID
  `);

  // Reshape flat rows into nested devices.json structure
  const siteMap = new Map();
  for (const row of result.recordset) {
    if (!siteMap.has(row.SiteID)) {
      siteMap.set(row.SiteID, {
        name:    row.name,
        lat:     row.lat,
        lng:     row.lng,
        locType: row.locType,
        devices: [],
      });
    }
    siteMap.get(row.SiteID).devices.push({
      name:             row.Hostname,
      ip:               row.IPAddress,
      type:             row.deviceType,
      affectsStatus:    row.AlertStatus === true || row.AlertStatus === 1,
      solarwindsNodeId: row.SolarwindsNodeId || null,
    });
  }
  return Array.from(siteMap.values());
}

// Returns all active NetworkResources with all fields, for CSV export.
async function getAllForCsvExport() {
  const pool   = await getPool();
  const result = await pool.request().query(`
    SELECT
      s.SiteID,
      ISNULL(parent.SiteNumber, '') AS ParentSiteNumber,
      ISNULL(parent.SiteName,   '') AS ParentSiteName,
      s.SiteNumber,
      s.SiteName,
      r.Hostname,
      r.IPAddress,
      dt.TypeName   AS DeviceType,
      r.AlertStatus,
      r.SolarwindsNodeId,
      ct.TypeName   AS CircuitType,
      r.CircuitID,
      r.Notes,
      r.SortOrder
    FROM   NetworkResources    r
    JOIN   Sites               s      ON s.SiteID        = r.SiteID
    LEFT JOIN Sites            parent ON parent.SiteID   = s.ParentSiteID
    JOIN   NetworkDeviceTypes  dt     ON dt.DeviceTypeID  = r.DeviceTypeID
    LEFT JOIN CircuitTypes     ct     ON ct.CircuitTypeID = r.CircuitTypeID
    WHERE  r.IsActive = 1
    ORDER  BY parent.SiteNumber, s.SiteNumber, s.SiteName, r.SortOrder, r.Hostname
  `);
  return result.recordset;
}

module.exports = {
  getBySite,
  getByID,
  create,
  update,
  softDelete,
  getNetworkMapData,
  getAllForCsvExport,
};
