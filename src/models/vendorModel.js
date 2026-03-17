'use strict';

const { getPool, sql } = require('../config/database');
const { writeAudit }   = require('./auditModel');

// ── Vendor CRUD ───────────────────────────────────────────────────────────────

async function getAll({ includeInactive = false, search = '' } = {}) {
  const pool = await getPool();
  const req  = pool.request();
  let where  = includeInactive ? '' : 'WHERE v.IsActive = 1';
  if (search) {
    req.input('Search', sql.NVarChar(200), `%${search}%`);
    where = where
      ? `${where} AND v.VendorName LIKE @Search`
      : 'WHERE v.VendorName LIKE @Search';
  }
  const result = await req.query(`
    SELECT v.VendorID, v.VendorName, v.Phone, v.Email, v.City, v.State,
           v.Website, v.DoesPMWork, v.IsActive, v.CreatedAt, v.UpdatedAt,
           (SELECT COUNT(*) FROM VendorContacts vc WHERE vc.VendorID = v.VendorID AND vc.IsActive = 1) AS ContactCount
    FROM Vendors v
    ${where}
    ORDER BY v.VendorName
  `);
  return result.recordset;
}

async function getByID(vendorID) {
  const pool = await getPool();
  const [vRes, cRes] = await Promise.all([
    pool.request()
      .input('VendorID', sql.Int, vendorID)
      .query(`SELECT * FROM Vendors WHERE VendorID = @VendorID`),
    pool.request()
      .input('VendorID', sql.Int, vendorID)
      .query(`SELECT * FROM VendorContacts WHERE VendorID = @VendorID ORDER BY FirstName, LastName`),
  ]);
  const vendor = vRes.recordset[0] || null;
  if (vendor) vendor.contacts = cRes.recordset;
  return vendor;
}

async function create(data, auditContext = {}) {
  const { vendorName, phone, email, address, city, state, zip, website, notes, doesPMWork } = data;
  const pool = await getPool();
  const result = await pool.request()
    .input('VendorName', sql.NVarChar(200),  vendorName)
    .input('Phone',      sql.NVarChar(50),   phone      || null)
    .input('Email',      sql.NVarChar(255),  email      || null)
    .input('Address',    sql.NVarChar(500),  address    || null)
    .input('City',       sql.NVarChar(100),  city       || null)
    .input('State',      sql.NVarChar(50),   state      || null)
    .input('Zip',        sql.NVarChar(20),   zip        || null)
    .input('Website',    sql.NVarChar(255),  website    || null)
    .input('Notes',      sql.NVarChar(sql.MAX), notes   || null)
    .input('DoesPMWork', sql.Bit,            doesPMWork ? 1 : 0)
    .query(`
      INSERT INTO Vendors (VendorName, Phone, Email, Address, City, State, Zip, Website, Notes, DoesPMWork)
      VALUES (@VendorName, @Phone, @Email, @Address, @City, @State, @Zip, @Website, @Notes, @DoesPMWork);
      SELECT SCOPE_IDENTITY() AS NewID
    `);
  const newID = result.recordset[0].NewID;
  await writeAudit({
    tableName: 'Vendors', recordID: newID, action: 'INSERT',
    newValues: data,
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
  return getByID(newID);
}

async function update(vendorID, data, auditContext = {}) {
  const { vendorName, phone, email, address, city, state, zip, website, notes, doesPMWork } = data;
  const pool = await getPool();
  const old  = await getByID(vendorID);
  await pool.request()
    .input('VendorID',   sql.Int,            vendorID)
    .input('VendorName', sql.NVarChar(200),  vendorName)
    .input('Phone',      sql.NVarChar(50),   phone      || null)
    .input('Email',      sql.NVarChar(255),  email      || null)
    .input('Address',    sql.NVarChar(500),  address    || null)
    .input('City',       sql.NVarChar(100),  city       || null)
    .input('State',      sql.NVarChar(50),   state      || null)
    .input('Zip',        sql.NVarChar(20),   zip        || null)
    .input('Website',    sql.NVarChar(255),  website    || null)
    .input('Notes',      sql.NVarChar(sql.MAX), notes   || null)
    .input('DoesPMWork', sql.Bit,            doesPMWork ? 1 : 0)
    .query(`
      UPDATE Vendors SET
        VendorName = @VendorName,
        Phone      = @Phone,
        Email      = @Email,
        Address    = @Address,
        City       = @City,
        State      = @State,
        Zip        = @Zip,
        Website    = @Website,
        Notes      = @Notes,
        DoesPMWork = @DoesPMWork,
        UpdatedAt  = GETUTCDATE()
      WHERE VendorID = @VendorID
    `);
  await writeAudit({
    tableName: 'Vendors', recordID: vendorID, action: 'UPDATE',
    oldValues: old, newValues: data,
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
  return getByID(vendorID);
}

async function softDelete(vendorID, auditContext = {}) {
  const pool = await getPool();
  const old  = await getByID(vendorID);
  await pool.request()
    .input('VendorID', sql.Int, vendorID)
    .query(`UPDATE Vendors SET IsActive = 0, UpdatedAt = GETUTCDATE() WHERE VendorID = @VendorID`);
  await writeAudit({
    tableName: 'Vendors', recordID: vendorID, action: 'DELETE',
    oldValues: old,
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
}

async function togglePMWork(vendorID, auditContext = {}) {
  const pool = await getPool();
  const old  = await getByID(vendorID);
  await pool.request()
    .input('VendorID', sql.Int, vendorID)
    .query(`UPDATE Vendors SET DoesPMWork = 1 - DoesPMWork, UpdatedAt = GETUTCDATE() WHERE VendorID = @VendorID`);
  await writeAudit({
    tableName: 'Vendors', recordID: vendorID, action: 'UPDATE',
    oldValues: { doesPMWork: old.DoesPMWork }, newValues: { doesPMWork: !old.DoesPMWork },
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
  return getByID(vendorID);
}

async function getPMEnabled() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT VendorID, VendorName FROM Vendors
    WHERE IsActive = 1 AND DoesPMWork = 1
    ORDER BY VendorName
  `);
  return result.recordset;
}

async function findByName(vendorName) {
  const pool = await getPool();
  const result = await pool.request()
    .input('VendorName', sql.NVarChar(200), vendorName)
    .query(`SELECT VendorID FROM Vendors WHERE LOWER(VendorName) = LOWER(@VendorName)`);
  return result.recordset[0]?.VendorID || null;
}

// ── Contact CRUD ──────────────────────────────────────────────────────────────

async function getContactByID(contactID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('ContactID', sql.Int, contactID)
    .query(`SELECT * FROM VendorContacts WHERE ContactID = @ContactID`);
  return result.recordset[0] || null;
}

async function createContact(vendorID, data, auditContext = {}) {
  const { firstName, lastName, title, phone, email, receivePMEmails, notes } = data;
  const pool = await getPool();
  const result = await pool.request()
    .input('VendorID',        sql.Int,             vendorID)
    .input('FirstName',       sql.NVarChar(100),   firstName)
    .input('LastName',        sql.NVarChar(100),   lastName  || null)
    .input('Title',           sql.NVarChar(150),   title     || null)
    .input('Phone',           sql.NVarChar(50),    phone     || null)
    .input('Email',           sql.NVarChar(255),   email     || null)
    .input('ReceivePMEmails', sql.Bit,             receivePMEmails ? 1 : 0)
    .input('Notes',           sql.NVarChar(sql.MAX), notes   || null)
    .query(`
      INSERT INTO VendorContacts (VendorID, FirstName, LastName, Title, Phone, Email, ReceivePMEmails, Notes)
      VALUES (@VendorID, @FirstName, @LastName, @Title, @Phone, @Email, @ReceivePMEmails, @Notes);
      SELECT SCOPE_IDENTITY() AS NewID
    `);
  const newID = result.recordset[0].NewID;
  await writeAudit({
    tableName: 'VendorContacts', recordID: newID, action: 'INSERT',
    newValues: { vendorID, ...data },
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
  return getContactByID(newID);
}

async function updateContact(contactID, data, auditContext = {}) {
  const { firstName, lastName, title, phone, email, receivePMEmails, notes } = data;
  const pool = await getPool();
  const old  = await getContactByID(contactID);
  await pool.request()
    .input('ContactID',       sql.Int,             contactID)
    .input('FirstName',       sql.NVarChar(100),   firstName)
    .input('LastName',        sql.NVarChar(100),   lastName  || null)
    .input('Title',           sql.NVarChar(150),   title     || null)
    .input('Phone',           sql.NVarChar(50),    phone     || null)
    .input('Email',           sql.NVarChar(255),   email     || null)
    .input('ReceivePMEmails', sql.Bit,             receivePMEmails ? 1 : 0)
    .input('Notes',           sql.NVarChar(sql.MAX), notes   || null)
    .query(`
      UPDATE VendorContacts SET
        FirstName       = @FirstName,
        LastName        = @LastName,
        Title           = @Title,
        Phone           = @Phone,
        Email           = @Email,
        ReceivePMEmails = @ReceivePMEmails,
        Notes           = @Notes
      WHERE ContactID = @ContactID
    `);
  await writeAudit({
    tableName: 'VendorContacts', recordID: contactID, action: 'UPDATE',
    oldValues: old, newValues: data,
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
  return getContactByID(contactID);
}

async function deleteContact(contactID, auditContext = {}) {
  const pool = await getPool();
  const old  = await getContactByID(contactID);
  await pool.request()
    .input('ContactID', sql.Int, contactID)
    .query(`DELETE FROM VendorContacts WHERE ContactID = @ContactID`);
  await writeAudit({
    tableName: 'VendorContacts', recordID: contactID, action: 'DELETE',
    oldValues: old,
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
}

async function toggleContactEmail(contactID, auditContext = {}) {
  const pool = await getPool();
  const old  = await getContactByID(contactID);
  await pool.request()
    .input('ContactID', sql.Int, contactID)
    .query(`UPDATE VendorContacts SET ReceivePMEmails = 1 - ReceivePMEmails WHERE ContactID = @ContactID`);
  await writeAudit({
    tableName: 'VendorContacts', recordID: contactID, action: 'UPDATE',
    oldValues: { receivePMEmails: old.ReceivePMEmails },
    newValues: { receivePMEmails: !old.ReceivePMEmails },
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent,
  });
  return getContactByID(contactID);
}

async function getVendorEmailRecipients(vendorID) {
  const pool = await getPool();
  const [vRes, cRes] = await Promise.all([
    pool.request()
      .input('VendorID', sql.Int, vendorID)
      .query(`SELECT Email FROM Vendors WHERE VendorID = @VendorID AND IsActive = 1`),
    pool.request()
      .input('VendorID', sql.Int, vendorID)
      .query(`SELECT Email FROM VendorContacts WHERE VendorID = @VendorID AND IsActive = 1 AND ReceivePMEmails = 1 AND Email IS NOT NULL`),
  ]);
  const emails = [];
  if (vRes.recordset[0]?.Email) emails.push(vRes.recordset[0].Email);
  cRes.recordset.forEach(r => { if (r.Email) emails.push(r.Email); });
  return emails;
}

// Returns all active contacts across all vendors (for System Keys issued-to dropdown)
async function getAllContacts() {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT vc.ContactID, vc.FirstName, vc.LastName, vc.Email, v.VendorName
    FROM VendorContacts vc
    JOIN Vendors v ON v.VendorID = vc.VendorID
    WHERE vc.IsActive = 1 AND v.IsActive = 1
    ORDER BY v.VendorName, vc.FirstName, vc.LastName
  `);
  return r.recordset;
}

module.exports = {
  getAll, getByID, create, update, softDelete, togglePMWork, getPMEnabled, findByName,
  getContactByID, createContact, updateContact, deleteContact, toggleContactEmail,
  getVendorEmailRecipients, getAllContacts,
};
