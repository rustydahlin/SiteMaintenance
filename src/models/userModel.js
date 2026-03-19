'use strict';

const bcrypt  = require('bcryptjs');
const { getPool, sql } = require('../config/database');
const { writeAudit }   = require('./auditModel');

const USER_COLS = `
  u.UserID, u.Username, u.DisplayName, u.Email, u.Organization,
  u.PasswordHash, u.AuthProvider, u.ExternalID,
  u.IsActive, u.DeletedAt, u.CreatedAt, u.LastLoginAt
`;

const ROLES_JSON = `
  (
    SELECT STRING_AGG(r.RoleName, ',')
    FROM UserRoles ur
    JOIN Roles r ON r.RoleID = ur.RoleID
    WHERE ur.UserID = u.UserID
  ) AS RolesCSV
`;

async function _attachRoles(user) {
  if (!user) return null;
  user.roles = user.RolesCSV ? user.RolesCSV.split(',') : [];
  delete user.RolesCSV;
  return user;
}

async function findByID(userID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('UserID', sql.Int, userID)
    .query(`SELECT ${USER_COLS}, ${ROLES_JSON} FROM Users u WHERE u.UserID = @UserID`);
  return _attachRoles(result.recordset[0] || null);
}

async function findByUsername(username) {
  const pool = await getPool();
  const result = await pool.request()
    .input('Username', sql.NVarChar(100), username)
    .query(`SELECT ${USER_COLS}, ${ROLES_JSON} FROM Users u WHERE u.Username = @Username`);
  return _attachRoles(result.recordset[0] || null);
}

async function findByEmail(email) {
  const pool = await getPool();
  const result = await pool.request()
    .input('Email', sql.NVarChar(255), email)
    .query(`SELECT ${USER_COLS}, ${ROLES_JSON} FROM Users u WHERE u.Email = @Email AND u.IsActive = 1`);
  return _attachRoles(result.recordset[0] || null);
}

async function findByExternalID(externalID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('ExternalID', sql.NVarChar(255), externalID)
    .query(`SELECT ${USER_COLS}, ${ROLES_JSON} FROM Users u WHERE u.ExternalID = @ExternalID AND u.IsActive = 1`);
  return _attachRoles(result.recordset[0] || null);
}

const USER_SORT_COLUMNS = {
  displayName: 'u.DisplayName',
  username:    'u.Username',
  email:       'u.Email',
  auth:        'u.AuthProvider',
  status:      'u.IsActive',
  lastLogin:   'u.LastLoginAt',
};

async function getAll({ includeInactive = false, includeDeleted = false, sort = 'displayName', dir = 'asc' } = {}) {
  const pool = await getPool();
  let where;
  if (includeDeleted) {
    where = '';  // all rows including deleted
  } else if (includeInactive) {
    where = 'WHERE u.DeletedAt IS NULL';  // active + inactive, but not deleted
  } else {
    where = 'WHERE u.IsActive = 1 AND u.DeletedAt IS NULL';
  }
  const orderCol = USER_SORT_COLUMNS[sort] || 'u.DisplayName';
  const orderDir = dir === 'desc' ? 'DESC' : 'ASC';
  const result = await pool.request()
    .query(`SELECT ${USER_COLS}, ${ROLES_JSON} FROM Users u ${where} ORDER BY ${orderCol} ${orderDir}`);
  return Promise.all(result.recordset.map(_attachRoles));
}

async function create({ username, displayName, email, organization = null, password, authProvider = 'local', externalID = null, createdByUserID = null }, auditContext = {}) {
  const pool = await getPool();
  const passwordHash = password ? await bcrypt.hash(password, 12) : null;

  const result = await pool.request()
    .input('Username',        sql.NVarChar(100), username)
    .input('DisplayName',     sql.NVarChar(150), displayName)
    .input('Email',           sql.NVarChar(255), email || null)
    .input('Organization',    sql.NVarChar(150), organization || null)
    .input('PasswordHash',    sql.NVarChar(255), passwordHash)
    .input('AuthProvider',    sql.NVarChar(20),  authProvider)
    .input('ExternalID',      sql.NVarChar(255), externalID)
    .input('CreatedByUserID', sql.Int,           createdByUserID || null)
    .query(`
      INSERT INTO Users (Username, DisplayName, Email, Organization, PasswordHash, AuthProvider, ExternalID, CreatedByUserID)
      VALUES (@Username, @DisplayName, @Email, @Organization, @PasswordHash, @AuthProvider, @ExternalID, @CreatedByUserID);
      SELECT SCOPE_IDENTITY() AS NewID
    `);

  const newID = result.recordset[0].NewID;
  await writeAudit({ tableName: 'Users', recordID: newID, action: 'INSERT',
    newValues: { username, displayName, email, organization, authProvider },
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent });
  return findByID(newID);
}

async function update(userID, { displayName, email, organization = null, isActive }, auditContext = {}) {
  const pool  = await getPool();
  const old   = await findByID(userID);
  await pool.request()
    .input('UserID',       sql.Int,           userID)
    .input('DisplayName',  sql.NVarChar(150), displayName)
    .input('Email',        sql.NVarChar(255), email || null)
    .input('Organization', sql.NVarChar(150), organization || null)
    .input('IsActive',     sql.Bit,           isActive !== undefined ? isActive : 1)
    .query(`
      UPDATE Users SET DisplayName = @DisplayName, Email = @Email, Organization = @Organization, IsActive = @IsActive
      WHERE UserID = @UserID
    `);
  await writeAudit({ tableName: 'Users', recordID: userID, action: 'UPDATE',
    oldValues: { displayName: old.DisplayName, email: old.Email, organization: old.Organization, isActive: old.IsActive },
    newValues: { displayName, email, organization, isActive },
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent });
  return findByID(userID);
}

async function updatePassword(userID, newPassword, auditContext = {}) {
  const pool = await getPool();
  const hash = await bcrypt.hash(newPassword, 12);
  await pool.request()
    .input('UserID',       sql.Int,           userID)
    .input('PasswordHash', sql.NVarChar(255), hash)
    .query('UPDATE Users SET PasswordHash = @PasswordHash WHERE UserID = @UserID');
  await writeAudit({ tableName: 'Users', recordID: userID, action: 'PASSWORD_CHANGE',
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent });
}

async function updateLastLogin(userID) {
  const pool = await getPool();
  await pool.request()
    .input('UserID', sql.Int, userID)
    .query('UPDATE Users SET LastLoginAt = GETUTCDATE() WHERE UserID = @UserID');
}

async function setRoles(userID, roleNames, auditContext = {}) {
  const pool = await getPool();
  // Get role IDs
  const roleResult = await pool.request()
    .query(`SELECT RoleID, RoleName FROM Roles WHERE RoleName IN (${roleNames.map((_, i) => `'${roleNames[i]}'`).join(',')})`);
  const roleIDs = roleResult.recordset.map(r => r.RoleID);

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await new sql.Request(tx).input('UserID', sql.Int, userID)
      .query('DELETE FROM UserRoles WHERE UserID = @UserID');
    for (const roleID of roleIDs) {
      await new sql.Request(tx)
        .input('UserID', sql.Int, userID)
        .input('RoleID', sql.Int, roleID)
        .input('AssignedByUserID', sql.Int, auditContext.userID || null)
        .query('INSERT INTO UserRoles (UserID, RoleID, AssignedByUserID) VALUES (@UserID, @RoleID, @AssignedByUserID)');
    }
    await tx.commit();
    await writeAudit({ tableName: 'UserRoles', recordID: userID, action: 'SET_ROLES',
      newValues: { roles: roleNames },
      userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent });
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

async function verifyPassword(user, plaintext) {
  if (!user.PasswordHash) return false;
  return bcrypt.compare(plaintext, user.PasswordHash);
}

async function toggleActive(userID, auditContext = {}) {
  const pool = await getPool();
  const user = await findByID(userID);
  const newState = user.IsActive ? 0 : 1;
  await pool.request()
    .input('UserID',   sql.Int, userID)
    .input('IsActive', sql.Bit, newState)
    .query('UPDATE Users SET IsActive = @IsActive WHERE UserID = @UserID');
  await writeAudit({ tableName: 'Users', recordID: userID, action: newState ? 'ACTIVATE' : 'DEACTIVATE',
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent });
  return findByID(userID);
}

async function deleteUser(userID, auditContext = {}) {
  const pool = await getPool();

  // Count all historical references to this user
  const refResult = await pool.request()
    .input('UserID', sql.Int, userID)
    .query(`
      SELECT (
        (SELECT COUNT(*) FROM LogEntries         WHERE PerformedByUserID = @UserID OR CreatedByUserID = @UserID) +
        (SELECT COUNT(*) FROM SiteInventory      WHERE InstalledByUserID = @UserID OR RemovedByUserID = @UserID OR PulledFromUserID = @UserID) +
        (SELECT COUNT(*) FROM Inventory          WHERE AssignedToUserID  = @UserID OR CreatedByUserID = @UserID) +
        (SELECT COUNT(*) FROM InventoryStock     WHERE UserID            = @UserID) +
        (SELECT COUNT(*) FROM RepairTracking     WHERE SentByUserID      = @UserID OR ReceivedByUserID = @UserID OR AssignedUserID = @UserID) +
        (SELECT COUNT(*) FROM PMSchedules        WHERE AssignedUserID    = @UserID) +
        (SELECT COUNT(*) FROM MaintenanceItems   WHERE AssignedToUserID  = @UserID OR ClosedByUserID = @UserID OR CreatedByUserID = @UserID) +
        (SELECT COUNT(*) FROM SystemKeys         WHERE IssuedToUserID    = @UserID OR LastUpdatedByUserID = @UserID) +
        (SELECT COUNT(*) FROM Documents          WHERE UploadedByUserID  = @UserID) +
        (SELECT COUNT(*) FROM Sites              WHERE CreatedByUserID   = @UserID) +
        (SELECT COUNT(*) FROM UserInventoryPossession WHERE UserID       = @UserID)
      ) AS TotalRefs
    `);

  const totalRefs = refResult.recordset[0].TotalRefs;

  if (totalRefs === 0) {
    // No history — hard delete is safe
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await new sql.Request(tx).input('UserID', sql.Int, userID).query('DELETE FROM UserNotifications   WHERE UserID = @UserID');
      await new sql.Request(tx).input('UserID', sql.Int, userID).query('DELETE FROM UserRoles           WHERE UserID = @UserID');
      await new sql.Request(tx).input('UserID', sql.Int, userID).query('DELETE FROM Users               WHERE UserID = @UserID');
      await tx.commit();
    } catch (err) { await tx.rollback(); throw err; }
    await writeAudit({ tableName: 'Users', recordID: userID, action: 'DELETE',
      userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent });
    return { method: 'hard' };
  }

  // Has references — soft delete: preserve name/ID, block all login paths
  await pool.request()
    .input('UserID',    sql.Int,          userID)
    .input('DeletedAt', sql.DateTime2,    new Date())
    .query(`
      UPDATE Users SET
        IsActive     = 0,
        DeletedAt    = @DeletedAt,
        PasswordHash = NULL,
        ExternalID   = NULL
      WHERE UserID = @UserID
    `);
  await writeAudit({ tableName: 'Users', recordID: userID, action: 'DELETE',
    newValues: { softDelete: true, refsFound: totalRefs },
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent });
  return { method: 'soft', refsFound: totalRefs };
}

async function restoreUser(userID, auditContext = {}) {
  const pool = await getPool();
  await pool.request()
    .input('UserID', sql.Int, userID)
    .query('UPDATE Users SET IsActive = 1, DeletedAt = NULL WHERE UserID = @UserID');
  await writeAudit({ tableName: 'Users', recordID: userID, action: 'RESTORE',
    userID: auditContext.userID, ip: auditContext.ip, userAgent: auditContext.userAgent });
  return findByID(userID);
}

// ── Notification preferences ──────────────────────────────────────────────────

// Returns { 'pm.reminder': true, 'repair.overdue': false, ... } for a user
async function getNotificationPrefs(userID) {
  const pool = await getPool();
  const r = await pool.request()
    .input('UserID', sql.Int, userID)
    .query(`SELECT NotificationType, IsEnabled FROM UserNotifications WHERE UserID = @UserID`);
  const map = {};
  for (const row of r.recordset) map[row.NotificationType] = !!row.IsEnabled;
  return map;
}

// Upserts the full set of notification prefs for a user
// prefs: { 'pm.reminder': true, 'repair.overdue': false, ... }
async function setNotificationPrefs(userID, prefs) {
  const pool = await getPool();
  for (const [type, enabled] of Object.entries(prefs)) {
    await pool.request()
      .input('UserID',  sql.Int,         userID)
      .input('Type',    sql.NVarChar(50), type)
      .input('Enabled', sql.Bit,         enabled ? 1 : 0)
      .query(`
        MERGE UserNotifications AS target
        USING (SELECT @UserID AS UserID, @Type AS NotificationType) AS src
          ON target.UserID = src.UserID AND target.NotificationType = src.NotificationType
        WHEN MATCHED    THEN UPDATE SET IsEnabled = @Enabled, UpdatedAt = GETUTCDATE()
        WHEN NOT MATCHED THEN INSERT (UserID, NotificationType, IsEnabled)
                              VALUES (@UserID, @Type, @Enabled);
      `);
  }
}

// Returns email addresses of all active users who have opted in to a notification type
async function getOptedInEmails(notificationType) {
  const pool = await getPool();
  const r = await pool.request()
    .input('Type', sql.NVarChar(50), notificationType)
    .query(`
      SELECT u.Email
      FROM UserNotifications un
      JOIN Users u ON u.UserID = un.UserID
      WHERE un.NotificationType = @Type
        AND un.IsEnabled = 1
        AND u.IsActive = 1
        AND u.Email IS NOT NULL
    `);
  return r.recordset.map(row => row.Email);
}

module.exports = {
  findByID, findByUsername, findByEmail, findByExternalID,
  getAll, create, update, updatePassword, updateLastLogin,
  setRoles, verifyPassword, toggleActive, deleteUser, restoreUser,
  getNotificationPrefs, setNotificationPrefs, getOptedInEmails,
};
