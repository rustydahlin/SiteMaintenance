'use strict';

const { getPool, sql } = require('../config/database');
const { writeAudit }   = require('./auditModel');

async function getByLogEntry(logEntryID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('LogEntryID', sql.Int, logEntryID)
    .query(`
      SELECT
        d.DocumentID, d.OriginalFilename, d.MimeType, d.FileSizeBytes,
        d.Description, d.UploadedByUserID, d.UploadedAt,
        d.LogEntryID, d.SiteID, d.ItemID,
        u.DisplayName AS UploadedByName
      FROM Documents d
      LEFT JOIN Users u ON u.UserID = d.UploadedByUserID
      WHERE d.LogEntryID = @LogEntryID
      ORDER BY d.UploadedAt DESC
    `);
  return result.recordset;
}

async function getBySite(siteID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('SiteID', sql.Int, siteID)
    .query(`
      SELECT
        d.DocumentID, d.OriginalFilename, d.MimeType, d.FileSizeBytes,
        d.Description, d.UploadedByUserID, d.UploadedAt,
        d.LogEntryID, d.SiteID, d.ItemID,
        u.DisplayName AS UploadedByName
      FROM Documents d
      LEFT JOIN Users u ON u.UserID = d.UploadedByUserID
      WHERE d.SiteID = @SiteID
        AND d.LogEntryID IS NULL
        AND d.ItemID     IS NULL
      ORDER BY d.UploadedAt DESC
    `);
  return result.recordset;
}

async function getByVendor(vendorID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('VendorID', sql.Int, vendorID)
    .query(`
      SELECT
        d.DocumentID, d.OriginalFilename, d.MimeType, d.FileSizeBytes,
        d.Description, d.UploadedByUserID, d.UploadedAt,
        d.LogEntryID, d.SiteID, d.ItemID, d.VendorID,
        u.DisplayName AS UploadedByName
      FROM Documents d
      LEFT JOIN Users u ON u.UserID = d.UploadedByUserID
      WHERE d.VendorID = @VendorID
      ORDER BY d.UploadedAt DESC
    `);
  return result.recordset;
}

async function getByItem(itemID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('ItemID', sql.Int, itemID)
    .query(`
      SELECT
        d.DocumentID, d.OriginalFilename, d.MimeType, d.FileSizeBytes,
        d.Description, d.UploadedByUserID, d.UploadedAt,
        d.LogEntryID, d.SiteID, d.ItemID,
        u.DisplayName AS UploadedByName
      FROM Documents d
      LEFT JOIN Users u ON u.UserID = d.UploadedByUserID
      WHERE d.ItemID = @ItemID
      ORDER BY d.UploadedAt DESC
    `);
  return result.recordset;
}

async function getMetadata(documentID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('DocumentID', sql.Int, documentID)
    .query(`
      SELECT
        d.DocumentID, d.OriginalFilename, d.MimeType, d.FileSizeBytes,
        d.Description, d.UploadedByUserID, d.UploadedAt,
        d.LogEntryID, d.SiteID, d.ItemID,
        u.DisplayName AS UploadedByName
      FROM Documents d
      LEFT JOIN Users u ON u.UserID = d.UploadedByUserID
      WHERE d.DocumentID = @DocumentID
    `);
  return result.recordset[0] || null;
}

async function getFileData(documentID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('DocumentID', sql.Int, documentID)
    .query(`
      SELECT d.MimeType, d.OriginalFilename, dd.FileData
      FROM Documents    d
      JOIN DocumentData dd ON dd.DocumentID = d.DocumentID
      WHERE d.DocumentID = @DocumentID
    `);

  if (!result.recordset.length) return null;
  const row = result.recordset[0];
  return {
    mimeType: row.MimeType,
    filename: row.OriginalFilename,
    buffer:   row.FileData,
  };
}

async function create({
  originalFilename, mimeType, fileSizeBytes, uploadedByUserID,
  description, logEntryID, siteID, itemID, vendorID, fileBuffer,
}, auditContext = {}) {
  const pool = await getPool();
  const tx   = new sql.Transaction(pool);
  await tx.begin();

  try {
    const docResult = await new sql.Request(tx)
      .input('OriginalFilename',  sql.NVarChar(500),  originalFilename)
      .input('MimeType',          sql.NVarChar(200),  mimeType          || null)
      .input('FileSizeBytes',     sql.Int,            fileSizeBytes     ?? null)
      .input('UploadedByUserID',  sql.Int,            uploadedByUserID  || null)
      .input('Description',       sql.NVarChar(500),  description       || null)
      .input('LogEntryID',        sql.Int,            logEntryID        || null)
      .input('SiteID',            sql.Int,            siteID            || null)
      .input('ItemID',            sql.Int,            itemID            || null)
      .input('VendorID',          sql.Int,            vendorID          || null)
      .query(`
        INSERT INTO Documents
          (OriginalFilename, MimeType, FileSizeBytes, UploadedByUserID, Description,
           LogEntryID, SiteID, ItemID, VendorID)
        VALUES
          (@OriginalFilename, @MimeType, @FileSizeBytes, @UploadedByUserID, @Description,
           @LogEntryID, @SiteID, @ItemID, @VendorID);
        SELECT SCOPE_IDENTITY() AS NewID
      `);

    const newID = docResult.recordset[0].NewID;

    await new sql.Request(tx)
      .input('DocumentID', sql.Int,            newID)
      .input('FileData',   sql.VarBinary(sql.MAX), fileBuffer)
      .query(`
        INSERT INTO DocumentData (DocumentID, FileData)
        VALUES (@DocumentID, @FileData)
      `);

    await tx.commit();

    await writeAudit({
      tableName: 'Documents', recordID: newID, action: 'INSERT',
      newValues: { originalFilename, mimeType, fileSizeBytes, uploadedByUserID, logEntryID, siteID, itemID },
      userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
    });

    return newID;
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

async function hardDelete(documentID, auditContext = {}) {
  const pool = await getPool();
  const old  = await getMetadata(documentID);

  // DocumentData cascades on FK delete
  await pool.request()
    .input('DocumentID', sql.Int, documentID)
    .query('DELETE FROM Documents WHERE DocumentID = @DocumentID');

  await writeAudit({
    tableName: 'Documents', recordID: documentID, action: 'DELETE',
    oldValues: old,
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
}

module.exports = {
  getByLogEntry, getBySite, getByItem, getByVendor,
  getMetadata, getFileData,
  create, delete: hardDelete,
};
