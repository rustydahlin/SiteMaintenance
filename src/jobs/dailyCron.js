'use strict';

const cron    = require('node-cron');
const path    = require('path');
const fs      = require('fs');
const logger  = require('../utils/logger');
const email   = require('../services/emailService');
const push    = require('../services/pushService');
const settingsModel = require('../models/settingsModel');

const logDir = process.env.LOG_DIR
  ? path.resolve(process.env.LOG_DIR)
  : path.join(__dirname, '..', 'logs');

// Runs daily at 07:00 server time
const SCHEDULE = '0 7 * * *';

async function runDailyChecks() {
  logger.info('Daily cron: starting checks');

  // Retention cleanup runs regardless of email setting
  try { await cleanAuditLog();    } catch (e) { logger.error('Cron audit cleanup failed:', e.message); }
  try { await cleanOldLogFiles(); } catch (e) { logger.error('Cron log cleanup failed:', e.message); }

  const emailEnabled = await settingsModel.getSettingsBool('email.enabled', 'EMAIL_ENABLED');
  if (!emailEnabled) {
    logger.info('Daily cron: email disabled, skipping notifications');
    return;
  }

  try { await checkPMsDue();             } catch (e) { logger.error('Cron PM check failed:', e.message); }
  try { await checkUnsentRmas();         } catch (e) { logger.error('Cron unsent RMA check failed:', e.message); }
  try { await checkRepairOverdue();      } catch (e) { logger.error('Cron repair overdue failed:', e.message); }
  try { await checkWarranties();         } catch (e) { logger.error('Cron warranty check failed:', e.message); }
  try { await checkSystemKeyExpiry();    } catch (e) { logger.error('Cron system key expiry failed:', e.message); }
  try { await checkMaintenanceDue();     } catch (e) { logger.error('Cron maintenance due check failed:', e.message); }
  try { await checkMaintenanceOverdue(); } catch (e) { logger.error('Cron maintenance overdue check failed:', e.message); }
  try { await checkPMsOverdue();         } catch (e) { logger.error('Cron PM overdue push failed:', e.message); }

  logger.info('Daily cron: completed');
}

async function cleanAuditLog() {
  const retentionDays = parseInt(await settingsModel.getSetting('audit.retentionDays') || '365', 10);
  if (retentionDays <= 0) return; // 0 = keep forever

  const { getPool, sql } = require('../config/database');
  const pool = await getPool();
  const result = await pool.request()
    .input('Days', sql.Int, retentionDays)
    .query(`DELETE FROM AuditLog WHERE ChangedAt < DATEADD(DAY, -@Days, GETUTCDATE())`);
  const deleted = result.rowsAffected[0];
  if (deleted > 0) logger.info(`Daily cron: purged ${deleted} audit record(s) older than ${retentionDays} days`);
}

async function cleanOldLogFiles() {
  if (!fs.existsSync(logDir)) return;

  const appDays   = parseInt(await settingsModel.getSetting('logs.appRetentionDays')   || '30', 10);
  const errorDays = parseInt(await settingsModel.getSetting('logs.errorRetentionDays') || '90', 10);

  const now = Date.now();
  let deleted = 0;

  for (const file of fs.readdirSync(logDir)) {
    if (!file.endsWith('.log')) continue;
    const filePath = path.join(logDir, file);
    const stat = fs.statSync(filePath);
    const ageDays = (now - stat.mtimeMs) / (1000 * 60 * 60 * 24);
    const limit = file.startsWith('error-') ? errorDays : appDays;
    if (ageDays > limit) {
      fs.unlinkSync(filePath);
      deleted++;
    }
  }
  if (deleted > 0) logger.info(`Daily cron: deleted ${deleted} old log file(s)`);
}

async function checkPMsDue() {
  const pmModel     = require('../models/pmModel');
  const reminderDays = parseInt(await settingsModel.getSetting('email.pmReminderDays') || '14', 10);
  const schedules   = await pmModel.getUpcomingDue(reminderDays);

  for (const s of schedules) {
    const daysUntilDue = s.DaysUntilDue !== undefined ? s.DaysUntilDue : 0;
    await email.sendPMReminder({ SiteID: s.SiteID, SiteName: s.SiteName }, s, daysUntilDue);
    if (s.AssignedUserID && daysUntilDue === 0) {
      push.sendToUser(s.AssignedUserID, {
        title: 'PM Due Today',
        body: `${s.Title} at ${s.SiteName}`,
        url: `/mobile/sites/${s.SiteID}?tab=pm`,
      }).catch(() => {});
    }
  }
  if (schedules.length) logger.info(`Daily cron: sent ${schedules.length} PM reminder(s)`);
  return schedules.length;
}

async function checkUnsentRmas() {
  const repairModel  = require('../models/repairModel');
  const intervalDays = parseInt(await settingsModel.getSetting('email.unsentRmaReminderDays') || '3', 10);
  const repairs = await repairModel.getUnsentReminders(intervalDays);
  for (const r of repairs) {
    await email.sendUnsentRmaReminder(r);
  }
  if (repairs.length) logger.info(`Daily cron: sent ${repairs.length} unsent RMA reminder(s) (interval: every ${intervalDays}d)`);
}

async function checkRepairOverdue() {
  const repairModel  = require('../models/repairModel');
  const intervalDays = parseInt(await settingsModel.getSetting('email.repairReminderIntervalDays') || '3', 10);
  const repairs = await repairModel.getOverdueExpected(intervalDays);
  for (const r of repairs) {
    await email.sendRepairOverdue(r);
    if (r.AssignedUserID) {
      push.sendToUser(r.AssignedUserID, {
        title: 'Repair Overdue',
        body: `Repair #${r.RepairID} — ${r.CommonName || r.ModelNumber || 'Item'} is past expected return`,
        url: `/mobile/repairs/${r.RepairID}`,
      }).catch(() => {});
    }
  }
  if (repairs.length) logger.info(`Daily cron: sent ${repairs.length} repair overdue alert(s) (interval: every ${intervalDays}d)`);
  return repairs.length;
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


async function checkSystemKeyExpiry() {
  const systemKeyModel = require('../models/systemKeyModel');
  const systemKeysEnabled = (await settingsModel.getSetting('systemKeys.enabled', null)) === '1';
  if (!systemKeysEnabled) return;

  const reminderDays = parseInt(await settingsModel.getSetting('email.systemKeyReminderDays') || '30', 10);
  const keys = await systemKeyModel.getExpiringSoon(reminderDays);
  for (const key of keys) {
    await email.sendSystemKeyExpiring(key, key.DaysLeft);
  }
  if (keys.length) logger.info(`Daily cron: sent ${keys.length} system key expiry notice(s)`);
}

async function checkMaintenanceDue() {
  const maintenanceModel = require('../models/maintenanceModel');
  const intervalDays = parseInt(await settingsModel.getSetting('email.maintenanceReminderDays') || '3', 10);
  const items = await maintenanceModel.getOpenForReminders(intervalDays);
  for (const item of items) {
    await email.sendMaintenanceReminder(item);
    if (item.AssignedToUserID && item.DaysUntilDue === 0) {
      push.sendToUser(item.AssignedToUserID, {
        title: 'Maintenance Due Today',
        body: `${item.SiteName}${item.WorkToComplete ? ' — ' + item.WorkToComplete.substring(0, 60) : ''}`,
        url: `/mobile/maintenance/${item.MaintenanceID}`,
      }).catch(() => {});
    }
  }
  if (items.length) logger.info(`Daily cron: sent ${items.length} maintenance reminder(s) (interval: every ${intervalDays}d)`);
  return items.length;
}

async function checkMaintenanceOverdue() {
  const maintenanceModel = require('../models/maintenanceModel');
  const intervalDays = parseInt(await settingsModel.getSetting('email.maintenanceOverdueDays') || '1', 10);
  if (intervalDays <= 0) return 0;
  const items = await maintenanceModel.getOverdueForReminders(intervalDays);
  for (const item of items) {
    await email.sendMaintenanceOverdue(item);
    if (item.AssignedToUserID) {
      push.sendToUser(item.AssignedToUserID, {
        title: 'Maintenance Overdue',
        body: `${item.SiteName} — ${item.DaysOverdue} day${item.DaysOverdue !== 1 ? 's' : ''} overdue`,
        url: `/mobile/maintenance/${item.MaintenanceID}`,
      }).catch(() => {});
    }
  }
  if (items.length) logger.info(`Daily cron: sent ${items.length} maintenance overdue alert(s) (interval: every ${intervalDays}d)`);
  return items.length;
}

async function checkPMsOverdue() {
  const pmModel      = require('../models/pmModel');
  const intervalDays = parseInt(await settingsModel.getSetting('email.pmOverdueIntervalDays') || '1', 10);
  if (intervalDays <= 0) return;
  const items = await pmModel.getOverdueForReminders(intervalDays);
  for (const pm of items) {
    if (pm.AssignedUserID) {
      push.sendToUser(pm.AssignedUserID, {
        title: 'PM Overdue',
        body: `${pm.Title} at ${pm.SiteName} — ${pm.DaysOverdue} day${pm.DaysOverdue !== 1 ? 's' : ''} overdue`,
        url: `/mobile/sites/${pm.SiteID}?tab=pm`,
      }).catch(() => {});
    }
  }
  if (items.length) logger.info(`Daily cron: sent ${items.length} PM overdue push(es) (interval: every ${intervalDays}d)`);
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
