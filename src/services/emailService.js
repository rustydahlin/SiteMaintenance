'use strict';

const nodemailer    = require('nodemailer');
const settingsModel = require('../models/settingsModel');
const { writeAudit } = require('../models/auditModel');
const logger         = require('../utils/logger');

let _transporter = null;

async function getTransporter() {
  const enabled = await settingsModel.getSettingsBool('email.enabled', 'EMAIL_ENABLED');
  if (!enabled) return null;

  const host        = await settingsModel.getSetting('email.host',     'EMAIL_HOST');
  const port        = parseInt(await settingsModel.getSetting('email.port', 'EMAIL_PORT') || '587', 10);
  const secureValue = await settingsModel.getSetting('email.secure', 'EMAIL_SECURE');
  const user        = await settingsModel.getSetting('email.user',     'EMAIL_USER');
  const password    = await settingsModel.getSetting('email.password', 'EMAIL_PASSWORD');

  if (!host) return null;

  // secureValue: 'none' = plain SMTP, '0' = STARTTLS, '1' = TLS/SSL
  const tlsOptions = secureValue === 'none'
    ? { secure: false, ignoreTLS: true }
    : secureValue === '1'
      ? { secure: true }
      : { secure: false };

  // Re-create transporter each call (settings may have changed)
  _transporter = nodemailer.createTransport({
    host, port, ...tlsOptions,
    auth: user ? { user, pass: password } : undefined,
  });

  return _transporter;
}

async function getFromAddress() {
  const address = await settingsModel.getSetting('email.fromAddress', 'EMAIL_FROM_ADDRESS');
  const name    = await settingsModel.getSetting('email.fromName',    'EMAIL_FROM_NAME') || 'SiteMaintenance';
  return `"${name}" <${address}>`;
}

// Users who opted in to a given notification type
async function getOptedInEmails(notificationType) {
  const userModel = require('../models/userModel');
  return userModel.getOptedInEmails(notificationType);
}

/**
 * Send a single email.
 * @param {{ to: string|string[], subject: string, html: string, text?: string }} opts
 */
async function sendMail({ to, subject, html, text }) {
  const transporter = await getTransporter();
  if (!transporter) {
    logger.debug(`Email skipped (disabled): ${subject}`);
    return;
  }

  const from = await getFromAddress();
  const recipients = Array.isArray(to) ? to.join(', ') : to;

  try {
    const info = await transporter.sendMail({ from, to: recipients, subject, html, text: text || '' });
    logger.info(`Email sent: "${subject}" → ${recipients} (${info.messageId})`);
    await writeAudit({ tableName: 'Email', action: 'SENT', notes: `subject="${subject}" to="${recipients}"` });
  } catch (err) {
    logger.error(`Email failed: "${subject}" → ${recipients}: ${err.message}`);
  }
}

// ── Notification helpers ──────────────────────────────────────────────────────

async function sendPMReminder(site, schedule, daysUntilDue) {
  const vendorModel = require('../models/vendorModel');

  // Primary recipients: assigned user email (if set) or vendor contact emails
  const assignedEmails = [];
  if (schedule.AssignedUserEmail) {
    assignedEmails.push(schedule.AssignedUserEmail);
  } else if (schedule.AssignedVendorID) {
    const vendorEmails = await vendorModel.getVendorEmailRecipients(schedule.AssignedVendorID);
    assignedEmails.push(...vendorEmails);
  }

  // Opted-in subscribers
  const optedIn = await getOptedInEmails('pm.reminder');

  const allTo = [...new Set([...assignedEmails, ...optedIn])].filter(Boolean);
  if (!allTo.length) return;

  const assignedLabel = schedule.AssignedUserName || schedule.AssignedVendorName || null;
  const subject = `PM Reminder: ${schedule.Title} at ${site.SiteName}`;
  const html    = `
    <h3>Preventive Maintenance Reminder</h3>
    <p><strong>Site:</strong> ${site.SiteName}</p>
    <p><strong>Task:</strong> ${schedule.Title}</p>
    <p><strong>Due:</strong> ${daysUntilDue <= 0 ? `<span style="color:red">OVERDUE by ${Math.abs(daysUntilDue)} day(s)</span>` : `in ${daysUntilDue} day(s)`}</p>
    ${assignedLabel ? `<p><strong>Assigned To:</strong> ${assignedLabel}</p>` : ''}
    <p><a href="${process.env.APP_BASE_URL || ''}/sites/${site.SiteID}">View Site</a></p>
  `;
  await sendMail({ to: allTo, subject, html });
}

async function sendRepairFollowUp(repair) {
  const to = await getOptedInEmails('repair.followup');
  if (!to.length) return;

  const subject = `Repair Follow-Up Due: ${repair.SerialNumber}`;
  const html    = `
    <h3>Repair Follow-Up Reminder</h3>
    <p><strong>Item:</strong> ${repair.SerialNumber} — ${repair.ModelNumber || ''}</p>
    <p><strong>Sent:</strong> ${new Date(repair.SentDate).toLocaleDateString()}</p>
    ${repair.RMANumber ? `<p><strong>RMA#:</strong> ${repair.RMANumber}</p>` : ''}
    ${repair.ManufacturerContact ? `<p><strong>Contact:</strong> ${repair.ManufacturerContact}</p>` : ''}
    <p><strong>Follow-Up Date:</strong> ${new Date(repair.FollowUpDate).toLocaleDateString()}</p>
    <p><a href="${process.env.APP_BASE_URL || ''}/repairs/${repair.RepairID}">View Repair</a></p>
  `;
  await sendMail({ to, subject, html });
}

async function sendRepairOverdue(repair) {
  const optedIn = await getOptedInEmails('repair.overdue');
  // Always notify the assigned user; merge with opted-in list, dedupe
  const toSet = new Set(optedIn);
  if (repair.AssignedUserEmail) toSet.add(repair.AssignedUserEmail);
  const to = [...toSet];
  if (!to.length) return;

  const daysSinceSent = Math.floor((Date.now() - new Date(repair.SentDate).getTime()) / 86400000);
  const subject = `Repair OVERDUE: ${repair.SerialNumber} (${daysSinceSent} days)`;
  const html    = `
    <h3>Repair Return Overdue</h3>
    <p><strong>Item:</strong> ${repair.SerialNumber} — ${repair.ModelNumber || ''}</p>
    <p><strong>Expected Return:</strong> <span style="color:red">${new Date(repair.ExpectedReturnDate).toLocaleDateString()}</span></p>
    <p><strong>Days Since Sent:</strong> ${daysSinceSent}</p>
    ${repair.AssignedUserName ? `<p><strong>Assigned To:</strong> ${repair.AssignedUserName}</p>` : ''}
    ${repair.ManufacturerContact ? `<p><strong>Contact:</strong> ${repair.ManufacturerContact}</p>` : ''}
    <p><a href="${process.env.APP_BASE_URL || ''}/repairs/${repair.RepairID}">View Repair</a></p>
  `;
  await sendMail({ to, subject, html });
}

async function sendUnsentRmaReminder(repair) {
  if (!repair.AssignedUserEmail) return;
  const daysSinceCreated = Math.floor((Date.now() - new Date(repair.CreatedAt).getTime()) / 86400000);
  const itemLabel = repair.SerialNumber || repair.CommonName || repair.ModelNumber || `Item #${repair.ItemID}`;
  const subject = `Unsent RMA Reminder: ${itemLabel} (created ${daysSinceCreated} day(s) ago)`;
  const html = `
    <h3>Unsent RMA — Action Required</h3>
    <p>The following repair/RMA record was created but the item has not been shipped yet.
       Please ship the item and update the <strong>Sent Date</strong> in the system to stop these reminders.</p>
    <p><strong>Item:</strong> ${itemLabel}</p>
    ${repair.RMANumber ? `<p><strong>RMA #:</strong> ${repair.RMANumber}</p>` : ''}
    ${repair.Manufacturer ? `<p><strong>Manufacturer:</strong> ${repair.Manufacturer}</p>` : ''}
    <p><strong>Created:</strong> ${new Date(repair.CreatedAt).toLocaleDateString()} (${daysSinceCreated} day(s) ago)</p>
    ${repair.ManufacturerContact ? `<p><strong>Mfr. Contact:</strong> ${repair.ManufacturerContact}</p>` : ''}
    <p><a href="${process.env.APP_BASE_URL || ''}/repairs/${repair.RepairID}">View &amp; Update Repair</a></p>
  `;
  await sendMail({ to: repair.AssignedUserEmail, subject, html });
}

async function sendWarrantyExpiring(type, item, daysLeft) {
  const to = await getOptedInEmails('warranty.expiring');
  if (!to.length) return;

  const label   = type === 'site' ? `Site: ${item.SiteName}` : `Item: ${item.SerialNumber} — ${item.ModelNumber || ''}`;
  const subject = `Warranty Expiring: ${label}`;
  const url     = type === 'site' ? `/sites/${item.SiteID}` : `/inventory/${item.ItemID}`;
  const html    = `
    <h3>Warranty Expiring Soon</h3>
    <p><strong>${label}</strong></p>
    <p><strong>Expires:</strong> ${new Date(item.WarrantyExpires).toLocaleDateString()} (${daysLeft} day(s) remaining)</p>
    <p><a href="${process.env.APP_BASE_URL || ''}${url}">View Details</a></p>
  `;
  await sendMail({ to, subject, html });
}

async function sendCheckoutReminder(item, user) {
  const to = await getOptedInEmails('checkout.reminder');
  if (!to.length) return;

  const subject = `Long-Term Checkout: ${item.SerialNumber}`;
  const html    = `
    <h3>Item Checked Out for Extended Period</h3>
    <p><strong>Item:</strong> ${item.SerialNumber} — ${item.ModelNumber || ''}</p>
    <p><strong>Checked Out To:</strong> ${user.DisplayName}</p>
    <p><strong>Checked Out Since:</strong> ${new Date(item.CheckedOutAt).toLocaleDateString()}</p>
    <p><a href="${process.env.APP_BASE_URL || ''}/inventory/${item.ItemID}">View Item</a></p>
  `;
  await sendMail({ to, subject, html });
}

async function sendSiteStatusChange(site, oldStatus, newStatus) {
  const to = await getOptedInEmails('site.statusChange');
  if (!to.length) return;

  const subject = `Site Status Changed: ${site.SiteName} → ${newStatus}`;
  const html    = `
    <h3>Site Status Change</h3>
    <p><strong>Site:</strong> ${site.SiteName}</p>
    <p><strong>Status:</strong> ${oldStatus} → <strong>${newStatus}</strong></p>
    <p><a href="${process.env.APP_BASE_URL || ''}/sites/${site.SiteID}">View Site</a></p>
  `;
  await sendMail({ to, subject, html });
}

async function sendWelcomeEmail(user, temporaryPassword) {
  if (!user.Email) return;
  const subject = 'Welcome to SiteMaintenance — Your Account';
  const html    = `
    <h3>Welcome, ${user.DisplayName}!</h3>
    <p>Your account has been created.</p>
    <p><strong>Username:</strong> ${user.Username}</p>
    ${temporaryPassword ? `<p><strong>Temporary Password:</strong> ${temporaryPassword}<br/><em>Please change it after your first login.</em></p>` : ''}
    <p><a href="${process.env.APP_BASE_URL || ''}/auth/login">Log In</a></p>
  `;
  await sendMail({ to: user.Email, subject, html });
}

async function sendSystemKeyExpiring(key, daysLeft) {
  // Primary: the key holder
  const directEmails = key.IssuedToEmail ? [key.IssuedToEmail] : [];
  // Opted-in subscribers
  const optedIn = await getOptedInEmails('systemKey.expiring');
  const allTo = [...new Set([...directEmails, ...optedIn])].filter(Boolean);
  if (!allTo.length) return;

  const expired = daysLeft !== undefined && daysLeft <= 0;
  const subject = expired
    ? `System Key EXPIRED: ${key.SerialNumber || key.KeyCode || key.KeyID}`
    : `System Key Expiring Soon: ${key.SerialNumber || key.KeyCode || key.KeyID}`;
  const html = `
    <h3>System Key ${expired ? 'Expired' : 'Expiring Soon'}</h3>
    <p><strong>Issued To:</strong> ${key.IssuedToName || '—'} (${key.Organization || '—'})</p>
    ${key.SerialNumber ? `<p><strong>Serial #:</strong> ${key.SerialNumber}</p>` : ''}
    ${key.KeyCode      ? `<p><strong>Key Code:</strong> ${key.KeyCode}</p>`      : ''}
    <p><strong>Expires:</strong> ${new Date(key.ExpirationDate).toLocaleDateString()}
       ${expired ? '<span style="color:red">(EXPIRED)</span>' : `(${daysLeft} day(s) remaining)`}</p>
    ${key.ManufacturerName ? `<p><strong>Manufacturer:</strong> ${key.ManufacturerName}</p>` : ''}
    <p><a href="${process.env.APP_BASE_URL || ''}/system-keys/${key.KeyID}">View Key</a></p>
  `;
  await sendMail({ to: allTo, subject, html });
}

async function notifyNewLogEntry({ site, log }) {
  const to = await getOptedInEmails('log.new');
  if (!to.length) return;

  const subject = `New Log Entry: ${site.SiteName} — ${log.Subject || 'No Subject'}`;
  const html = `
    <p>A new log entry has been created.</p>
    <p><strong>Site:</strong> ${site.SiteName}</p>
    <p><strong>Type:</strong> ${log.LogTypeName || ''}</p>
    <p><strong>Subject:</strong> ${log.Subject || '(no subject)'}</p>
    <p><strong>Date:</strong> ${new Date(log.EntryDate).toLocaleDateString()}</p>
    <p><a href="${process.env.APP_BASE_URL || ''}/sites/${site.SiteID}/logs/${log.LogEntryID}">View Log Entry</a></p>
  `;
  await sendMail({ to, subject, html });
}

module.exports = {
  sendMail,
  sendPMReminder,
  sendRepairFollowUp,
  sendRepairOverdue,
  sendUnsentRmaReminder,
  sendWarrantyExpiring,
  sendCheckoutReminder,
  sendSiteStatusChange,
  sendWelcomeEmail,
  notifyNewLogEntry,
  sendSystemKeyExpiring,
  getOptedInEmails,
};
