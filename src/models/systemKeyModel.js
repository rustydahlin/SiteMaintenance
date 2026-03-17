'use strict';

const { getPool, sql } = require('../config/database');
const { writeAudit }   = require('./auditModel');

// ── Base SELECT used by getAll and getByID ─────────────────────────────────────
const BASE_SELECT = `
  SELECT
    sk.KeyID, sk.KeyCode, sk.SerialNumber, sk.KeyType,
    sk.DateIssued, sk.ExpirationDate, sk.LastRenewalDate,
    sk.Notes, sk.IsActive, sk.UpdatedAt, sk.CreatedAt,
    sk.IssuedToUserID, sk.IssuedToContactID, sk.ManufacturerID, sk.LastUpdatedByUserID,
    COALESCE(u.DisplayName,
             LTRIM(RTRIM(vc.FirstName + ' ' + ISNULL(vc.LastName, ''))))  AS IssuedToName,
    CASE WHEN sk.IssuedToUserID IS NOT NULL THEN 'System'
         ELSE v.VendorName END                                             AS Organization,
    COALESCE(u.Email, vc.Email)                                           AS IssuedToEmail,
    km.ManufacturerName,
    ub.DisplayName                                                        AS LastUpdatedByName
  FROM SystemKeys sk
  LEFT JOIN Users            u  ON u.UserID       = sk.IssuedToUserID
  LEFT JOIN VendorContacts   vc ON vc.ContactID   = sk.IssuedToContactID
  LEFT JOIN Vendors          v  ON v.VendorID     = vc.VendorID
  LEFT JOIN KeyManufacturers km ON km.ManufacturerID = sk.ManufacturerID
  LEFT JOIN Users            ub ON ub.UserID      = sk.LastUpdatedByUserID
`;

// ── List ───────────────────────────────────────────────────────────────────────
const SORT_MAP = {
  issuedTo:       'IssuedToName',
  organization:   'Organization',
  dateIssued:     'sk.DateIssued',
  manufacturer:   'km.ManufacturerName',
  expiration:     'sk.ExpirationDate',
  keyCode:        'sk.KeyCode',
  serialNumber:   'sk.SerialNumber',
  keyType:        'sk.KeyType',
  lastUpdatedBy:  'LastUpdatedByName',
};

async function getAll({ search = '', includeInactive = false, sort = 'issuedTo', dir = 'asc',
                        keyType = '', expiryStatus = '', manufacturerID = null } = {}) {
  const orderCol = SORT_MAP[sort] || 'IssuedToName';
  const orderDir = dir === 'desc' ? 'DESC' : 'ASC';

  // expiryStatus: 'expired' | 'expiring' (within 30d) | 'ok' | '' (all)
  const expiryClause =
    expiryStatus === 'expired'  ? `AND sk.ExpirationDate IS NOT NULL AND sk.ExpirationDate < CAST(GETUTCDATE() AS DATE)` :
    expiryStatus === 'expiring' ? `AND sk.ExpirationDate IS NOT NULL AND sk.ExpirationDate >= CAST(GETUTCDATE() AS DATE) AND sk.ExpirationDate <= DATEADD(DAY,30,CAST(GETUTCDATE() AS DATE))` :
    expiryStatus === 'ok'       ? `AND (sk.ExpirationDate IS NULL OR sk.ExpirationDate > DATEADD(DAY,30,CAST(GETUTCDATE() AS DATE)))` :
    '';

  const pool = await getPool();
  const r = await pool.request()
    .input('IncludeInactive',  sql.Bit,         includeInactive ? 1 : 0)
    .input('Search',           sql.NVarChar(200), search ? `%${search}%` : null)
    .input('KeyType',          sql.NVarChar(20),  keyType || null)
    .input('ManufacturerID',   sql.Int,           manufacturerID || null)
    .query(`
      ${BASE_SELECT}
      WHERE (@IncludeInactive = 1 OR sk.IsActive = 1)
        AND (@Search IS NULL OR
             sk.SerialNumber LIKE @Search OR
             sk.KeyCode LIKE @Search OR
             COALESCE(u.DisplayName,
               LTRIM(RTRIM(vc.FirstName + ' ' + ISNULL(vc.LastName, '')))) LIKE @Search OR
             v.VendorName LIKE @Search OR
             km.ManufacturerName LIKE @Search)
        AND (@KeyType       IS NULL OR sk.KeyType        = @KeyType)
        AND (@ManufacturerID IS NULL OR sk.ManufacturerID = @ManufacturerID)
        ${expiryClause}
      ORDER BY ${orderCol} ${orderDir}, sk.KeyID ASC
    `);
  return r.recordset;
}

// ── Single record ──────────────────────────────────────────────────────────────
async function getByID(keyID) {
  const pool = await getPool();
  const r = await pool.request()
    .input('KeyID', sql.Int, keyID)
    .query(`${BASE_SELECT} WHERE sk.KeyID = @KeyID`);
  return r.recordset[0] || null;
}

// ── Find by serial (for import) ───────────────────────────────────────────────
async function findBySerial(serialNumber) {
  const pool = await getPool();
  const r = await pool.request()
    .input('Serial', sql.NVarChar(100), serialNumber)
    .query(`${BASE_SELECT} WHERE sk.SerialNumber = @Serial`);
  return r.recordset[0] || null;
}

// ── Create ─────────────────────────────────────────────────────────────────────
async function create(data, auditContext = {}) {
  const pool = await getPool();
  const r = await pool.request()
    .input('IssuedToUserID',      sql.Int,          data.issuedToUserID      || null)
    .input('IssuedToContactID',   sql.Int,          data.issuedToContactID   || null)
    .input('ManufacturerID',      sql.Int,          data.manufacturerID      || null)
    .input('DateIssued',          sql.Date,         data.dateIssued          || null)
    .input('ExpirationDate',      sql.Date,         data.expirationDate      || null)
    .input('KeyCode',             sql.NVarChar(100), data.keyCode            || null)
    .input('SerialNumber',        sql.NVarChar(100), data.serialNumber       || null)
    .input('KeyType',             sql.NVarChar(20),  data.keyType            || 'Unlimited')
    .input('Notes',               sql.NVarChar(sql.MAX), data.notes          || null)
    .input('LastUpdatedByUserID', sql.Int,          auditContext.userID      || null)
    .query(`
      INSERT INTO SystemKeys
        (IssuedToUserID, IssuedToContactID, ManufacturerID, DateIssued, ExpirationDate,
         KeyCode, SerialNumber, KeyType, Notes, LastUpdatedByUserID)
      OUTPUT INSERTED.KeyID
      VALUES
        (@IssuedToUserID, @IssuedToContactID, @ManufacturerID, @DateIssued, @ExpirationDate,
         @KeyCode, @SerialNumber, @KeyType, @Notes, @LastUpdatedByUserID)
    `);
  const keyID = r.recordset[0].KeyID;
  await writeAudit({ ...auditContext, tableName: 'SystemKeys', recordID: keyID, action: 'INSERT', newValues: data });
  return keyID;
}

// ── Update ─────────────────────────────────────────────────────────────────────
async function update(keyID, data, auditContext = {}) {
  const pool   = await getPool();
  const before = await getByID(keyID);
  await pool.request()
    .input('KeyID',               sql.Int,          keyID)
    .input('IssuedToUserID',      sql.Int,          data.issuedToUserID      || null)
    .input('IssuedToContactID',   sql.Int,          data.issuedToContactID   || null)
    .input('ManufacturerID',      sql.Int,          data.manufacturerID      || null)
    .input('DateIssued',          sql.Date,         data.dateIssued          || null)
    .input('ExpirationDate',      sql.Date,         data.expirationDate      || null)
    .input('KeyCode',             sql.NVarChar(100), data.keyCode            || null)
    .input('SerialNumber',        sql.NVarChar(100), data.serialNumber       || null)
    .input('KeyType',             sql.NVarChar(20),  data.keyType            || 'Unlimited')
    .input('Notes',               sql.NVarChar(sql.MAX), data.notes          || null)
    .input('LastUpdatedByUserID', sql.Int,          auditContext.userID      || null)
    .query(`
      UPDATE SystemKeys SET
        IssuedToUserID      = @IssuedToUserID,
        IssuedToContactID   = @IssuedToContactID,
        ManufacturerID      = @ManufacturerID,
        DateIssued          = @DateIssued,
        ExpirationDate      = @ExpirationDate,
        KeyCode             = @KeyCode,
        SerialNumber        = @SerialNumber,
        KeyType             = @KeyType,
        Notes               = @Notes,
        LastUpdatedByUserID = @LastUpdatedByUserID,
        UpdatedAt           = GETUTCDATE()
      WHERE KeyID = @KeyID
    `);
  await writeAudit({ ...auditContext, tableName: 'SystemKeys', recordID: keyID, action: 'UPDATE', oldValues: before, newValues: data });
}

// ── Renew ──────────────────────────────────────────────────────────────────────
async function renew(keyID, { lastRenewalDate, expirationDate, notes }, auditContext = {}) {
  const pool = await getPool();
  await pool.request()
    .input('KeyID',               sql.Int,  keyID)
    .input('LastRenewalDate',     sql.Date, lastRenewalDate  || null)
    .input('ExpirationDate',      sql.Date, expirationDate   || null)
    .input('Notes',               sql.NVarChar(sql.MAX), notes || null)
    .input('LastUpdatedByUserID', sql.Int,  auditContext.userID || null)
    .query(`
      UPDATE SystemKeys SET
        LastRenewalDate     = @LastRenewalDate,
        ExpirationDate      = @ExpirationDate,
        Notes               = CASE WHEN @Notes IS NOT NULL THEN @Notes ELSE Notes END,
        LastUpdatedByUserID = @LastUpdatedByUserID,
        UpdatedAt           = GETUTCDATE()
      WHERE KeyID = @KeyID
    `);
  await writeAudit({ ...auditContext, tableName: 'SystemKeys', recordID: keyID, action: 'RENEW',
    newValues: { lastRenewalDate, expirationDate } });
}

// ── Soft delete ────────────────────────────────────────────────────────────────
async function softDelete(keyID, auditContext = {}) {
  const pool = await getPool();
  await pool.request()
    .input('KeyID',               sql.Int, keyID)
    .input('LastUpdatedByUserID', sql.Int, auditContext.userID || null)
    .query(`
      UPDATE SystemKeys SET
        IsActive            = 0,
        LastUpdatedByUserID = @LastUpdatedByUserID,
        UpdatedAt           = GETUTCDATE()
      WHERE KeyID = @KeyID
    `);
  await writeAudit({ ...auditContext, tableName: 'SystemKeys', recordID: keyID, action: 'DELETE' });
}

// ── Expiring soon (for cron + dashboard) ──────────────────────────────────────
async function getExpiringSoon(daysAhead = 30) {
  const pool = await getPool();
  const r = await pool.request()
    .input('DaysAhead', sql.Int, daysAhead)
    .query(`
      ${BASE_SELECT}
      WHERE sk.IsActive = 1
        AND sk.ExpirationDate IS NOT NULL
        AND sk.ExpirationDate >= CAST(GETUTCDATE() AS DATE)
        AND sk.ExpirationDate <= DATEADD(DAY, @DaysAhead, CAST(GETUTCDATE() AS DATE))
      ORDER BY sk.ExpirationDate ASC
    `);
  // Attach DaysLeft
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return r.recordset.map(k => ({
    ...k,
    DaysLeft: Math.ceil((new Date(k.ExpirationDate) - today) / 86400000),
  }));
}

// ── Expired (for dashboard) ────────────────────────────────────────────────────
async function getExpired() {
  const pool = await getPool();
  const r = await pool.request().query(`
    ${BASE_SELECT}
    WHERE sk.IsActive = 1
      AND sk.ExpirationDate IS NOT NULL
      AND sk.ExpirationDate < CAST(GETUTCDATE() AS DATE)
    ORDER BY sk.ExpirationDate ASC
  `);
  return r.recordset;
}

module.exports = {
  getAll,
  getByID,
  findBySerial,
  create,
  update,
  renew,
  softDelete,
  getExpiringSoon,
  getExpired,
};
