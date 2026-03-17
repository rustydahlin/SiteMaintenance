'use strict';

const cron    = require('node-cron');
const logger  = require('../utils/logger');
const email   = require('../services/emailService');
const settingsModel = require('../models/settingsModel');

// Runs daily at 07:00 server time
const SCHEDULE = '0 7 * * *';

async function runDailyChecks() {
  logger.info('Daily cron: starting checks');

  const emailEnabled = await settingsModel.getSettingsBool('email.enabled', 'EMAIL_ENABLED');
  if (!emailEnabled) {
    logger.info('Daily cron: email disabled, skipping notifications');
    return;
  }

  try { await checkPMsDue();        } catch (e) { logger.error('Cron PM check failed:', e.message); }
  try { await checkRepairOverdue(); } catch (e) { logger.error('Cron repair overdue failed:', e.message); }
  try { await checkWarranties();    } catch (e) { logger.error('Cron warranty check failed:', e.message); }
  try { await checkLongCheckouts(); } catch (e) { logger.error('Cron checkout check failed:', e.message); }

  logger.info('Daily cron: completed');
}

async function checkPMsDue() {
  const pmModel     = require('../models/pmModel');
  const reminderDays = parseInt(await settingsModel.getSetting('email.pmReminderDays') || '14', 10);
  const schedules   = await pmModel.getUpcomingDue(reminderDays);

  for (const s of schedules) {
    const daysUntilDue = s.DaysUntilDue !== undefined ? s.DaysUntilDue : 0;
    await email.sendPMReminder({ SiteID: s.SiteID, SiteName: s.SiteName }, s, daysUntilDue);
  }
  if (schedules.length) logger.info(`Daily cron: sent ${schedules.length} PM reminder(s)`);
}

async function checkRepairOverdue() {
  const repairModel  = require('../models/repairModel');
  const intervalDays = parseInt(await settingsModel.getSetting('email.repairReminderIntervalDays') || '3', 10);
  const repairs = await repairModel.getOverdueExpected(intervalDays);
  for (const r of repairs) {
    await email.sendRepairOverdue(r);
  }
  if (repairs.length) logger.info(`Daily cron: sent ${repairs.length} repair overdue alert(s) (interval: every ${intervalDays}d)`);
}

async function checkWarranties() {
  const { getPool, sql } = require('../config/database');
  const reminderDays = parseInt(await settingsModel.getSetting('email.warrantyReminderDays') || '30', 10);

  const pool = await getPool();

  // Sites with expiring warranty
  const siteResult = await pool.request()
    .input('Days', sql.Int, reminderDays)
    .query(`
      SELECT SiteID, SiteName, WarrantyExpires,
             DATEDIFF(day, GETUTCDATE(), WarrantyExpires) AS DaysLeft
      FROM Sites
      WHERE IsActive = 1
        AND WarrantyExpires IS NOT NULL
        AND DATEDIFF(day, GETUTCDATE(), WarrantyExpires) BETWEEN 0 AND @Days
    `);
  for (const site of siteResult.recordset) {
    await email.sendWarrantyExpiring('site', site, site.DaysLeft);
  }

  // Inventory with expiring warranty
  const invResult = await pool.request()
    .input('Days', sql.Int, reminderDays)
    .query(`
      SELECT ItemID, SerialNumber, ModelNumber, WarrantyExpires,
             DATEDIFF(day, GETUTCDATE(), WarrantyExpires) AS DaysLeft
      FROM Inventory
      WHERE IsActive = 1
        AND WarrantyExpires IS NOT NULL
        AND DATEDIFF(day, GETUTCDATE(), WarrantyExpires) BETWEEN 0 AND @Days
    `);
  for (const item of invResult.recordset) {
    await email.sendWarrantyExpiring('inventory', item, item.DaysLeft);
  }

  const total = siteResult.recordset.length + invResult.recordset.length;
  if (total) logger.info(`Daily cron: sent ${total} warranty expiry notice(s)`);
}

async function checkLongCheckouts() {
  const { getPool, sql } = require('../config/database');
  const reminderDays = parseInt(await settingsModel.getSetting('email.checkoutReminderDays') || '30', 10);

  const pool = await getPool();
  const result = await pool.request()
    .input('Days', sql.Int, reminderDays)
    .query(`
      SELECT i.ItemID, i.SerialNumber, i.ModelNumber,
             u.DisplayName, u.Email,
             uip.CheckedOutAt
      FROM UserInventoryPossession uip
      JOIN Inventory i ON i.ItemID = uip.ItemID
      JOIN Users u ON u.UserID = uip.UserID
      WHERE uip.CheckedInAt IS NULL
        AND DATEDIFF(day, uip.CheckedOutAt, GETUTCDATE()) >= @Days
    `);

  for (const row of result.recordset) {
    await email.sendCheckoutReminder(row, { DisplayName: row.DisplayName });
  }
  if (result.recordset.length) logger.info(`Daily cron: sent ${result.recordset.length} checkout reminder(s)`);
}

function start() {
  cron.schedule(SCHEDULE, runDailyChecks, { timezone: 'America/Chicago' });
  logger.info(`Daily cron scheduled: ${SCHEDULE}`);

  // Run immediately on startup in development to verify it works
  if (process.env.NODE_ENV === 'development' && process.env.RUN_CRON_ON_START === 'true') {
    setTimeout(runDailyChecks, 5000);
  }
}

module.exports = { start, runDailyChecks };
