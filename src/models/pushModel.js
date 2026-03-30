'use strict';

const { getPool, sql } = require('../config/database');

async function upsertSubscription(userID, { endpoint, p256dh, auth }) {
  const pool = await getPool();
  // If endpoint already exists for this user, just return. If it belongs to another user, replace it.
  await pool.request()
    .input('UserID',   sql.Int,           userID)
    .input('Endpoint', sql.NVarChar(500), endpoint)
    .input('P256dh',   sql.NVarChar(200), p256dh)
    .input('Auth',     sql.NVarChar(100), auth)
    .query(`
      MERGE PushSubscriptions AS target
      USING (SELECT @Endpoint AS Endpoint) AS source ON target.Endpoint = source.Endpoint
      WHEN MATCHED THEN
        UPDATE SET UserID = @UserID, P256dh = @P256dh, Auth = @Auth
      WHEN NOT MATCHED THEN
        INSERT (UserID, Endpoint, P256dh, Auth)
        VALUES (@UserID, @Endpoint, @P256dh, @Auth);
    `);
}

async function deleteSubscription(endpoint) {
  const pool = await getPool();
  await pool.request()
    .input('Endpoint', sql.NVarChar(500), endpoint)
    .query('DELETE FROM PushSubscriptions WHERE Endpoint = @Endpoint');
}

async function getByUserID(userID) {
  const pool = await getPool();
  const result = await pool.request()
    .input('UserID', sql.Int, userID)
    .query('SELECT Id, Endpoint, P256dh, Auth FROM PushSubscriptions WHERE UserID = @UserID');
  return result.recordset;
}

async function getAll() {
  const pool = await getPool();
  const result = await pool.request()
    .query('SELECT Id, UserID, Endpoint, P256dh, Auth FROM PushSubscriptions');
  return result.recordset;
}

async function deleteByEndpoint(endpoint) {
  return deleteSubscription(endpoint);
}

module.exports = { upsertSubscription, deleteSubscription, getByUserID, getAll, deleteByEndpoint };
