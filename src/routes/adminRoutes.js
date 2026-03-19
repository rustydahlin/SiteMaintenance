'use strict';

const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const { isAdmin } = require('../middleware/auth');
const lookupModel   = require('../models/lookupModel');
const userModel     = require('../models/userModel');
const settingsModel = require('../models/settingsModel');
const { getAuditLog } = require('../models/auditModel');
const passportConfig  = require('../config/passport');
const { body, validationResult } = require('express-validator');
const XLSX = require('xlsx');
const router = express.Router();

const logDir = process.env.LOG_DIR
  ? path.resolve(process.env.LOG_DIR)
  : path.join(__dirname, '..', 'logs');

// All admin routes require Admin role
router.use(isAdmin);

// ── Admin Index ───────────────────────────────────────────────────────────────
router.get('/', (_req, res) => {
  res.render('admin/index', { title: 'Administration' });
});

// ── Site Types ────────────────────────────────────────────────────────────────
router.get('/site-types', async (_req, res, next) => {
  try {
    const siteTypes = await lookupModel.getSiteTypes(false);
    res.render('admin/siteTypes', { title: 'Site Types', siteTypes });
  } catch (err) { next(err); }
});

router.post('/site-types', async (req, res, next) => {
  try {
    const { id, typeName, description, action } = req.body;
    if (action === 'toggle') {
      await lookupModel.toggleSiteType(parseInt(id));
    } else {
      if (!typeName?.trim()) { req.flash('error', 'Type name is required.'); return res.redirect('/admin/site-types'); }
      await lookupModel.upsertSiteType(id ? parseInt(id) : null, typeName.trim(), description);
    }
    req.flash('success', 'Site type saved.');
    res.redirect('/admin/site-types');
  } catch (err) { next(err); }
});

// ── Log Types ─────────────────────────────────────────────────────────────────
router.get('/log-types', async (_req, res, next) => {
  try {
    const logTypes = await lookupModel.getLogTypes(false);
    res.render('admin/logTypes', { title: 'Log Types', logTypes });
  } catch (err) { next(err); }
});

router.post('/log-types', async (req, res, next) => {
  try {
    const { id, typeName, action } = req.body;
    if (action === 'toggle') {
      await lookupModel.toggleLogType(parseInt(id));
    } else {
      if (!typeName?.trim()) { req.flash('error', 'Type name is required.'); return res.redirect('/admin/log-types'); }
      await lookupModel.upsertLogType(id ? parseInt(id) : null, typeName.trim(), 0);
    }
    req.flash('success', 'Log type saved.');
    res.redirect('/admin/log-types');
  } catch (err) { next(err); }
});

// ── Inventory Categories ──────────────────────────────────────────────────────
router.get('/categories', async (_req, res, next) => {
  try {
    const categories = await lookupModel.getInventoryCategories(false);
    res.render('admin/categories', { title: 'Inventory Categories', categories });
  } catch (err) { next(err); }
});

router.post('/categories', async (req, res, next) => {
  try {
    const { id, categoryName, description, action } = req.body;
    if (action === 'toggle') {
      await lookupModel.toggleInventoryCategory(parseInt(id));
    } else {
      if (!categoryName?.trim()) { req.flash('error', 'Category name is required.'); return res.redirect('/admin/categories'); }
      await lookupModel.upsertInventoryCategory(id ? parseInt(id) : null, categoryName.trim(), description);
    }
    req.flash('success', 'Category saved.');
    res.redirect('/admin/categories');
  } catch (err) { next(err); }
});

// ── Stock Locations ───────────────────────────────────────────────────────────
router.get('/stock-locations', async (_req, res, next) => {
  try {
    const locations = await lookupModel.getStockLocations(false);
    res.render('admin/stockLocations', { title: 'Stock Locations', locations });
  } catch (err) { next(err); }
});

router.post('/stock-locations', async (req, res, next) => {
  try {
    const { id, locationName, description, action } = req.body;
    if (action === 'toggle') {
      await lookupModel.toggleStockLocation(parseInt(id));
    } else {
      if (!locationName?.trim()) { req.flash('error', 'Location name is required.'); return res.redirect('/admin/stock-locations'); }
      await lookupModel.upsertStockLocation(id ? parseInt(id) : null, locationName.trim(), description);
    }
    req.flash('success', 'Stock location saved.');
    res.redirect('/admin/stock-locations');
  } catch (err) { next(err); }
});

// ── Key Manufacturers ─────────────────────────────────────────────────────────
router.get('/key-manufacturers', async (_req, res, next) => {
  try {
    const manufacturers = await lookupModel.getKeyManufacturers(false);
    res.render('admin/keyManufacturers', { title: 'Key Manufacturers', manufacturers });
  } catch (err) { next(err); }
});

router.post('/key-manufacturers', async (req, res, next) => {
  try {
    const { id, manufacturerName, description, action } = req.body;
    if (action === 'toggle') {
      await lookupModel.toggleKeyManufacturer(parseInt(id));
    } else {
      if (!manufacturerName?.trim()) { req.flash('error', 'Manufacturer name is required.'); return res.redirect('/admin/key-manufacturers'); }
      await lookupModel.upsertKeyManufacturer(id ? parseInt(id) : null, manufacturerName.trim(), description);
    }
    req.flash('success', 'Key manufacturer saved.');
    res.redirect('/admin/key-manufacturers');
  } catch (err) { next(err); }
});

// ── Inventory Lookups hub ─────────────────────────────────────────────────────
router.get('/inventory', (_req, res) => {
  res.render('admin/inventoryLookups', { title: 'Inventory Lookups' });
});

// helper: single-field upsert pattern for the three simple pick-list tables
function simplePicklistRoute(routePath, label, getFn, upsertFn, toggleFn, viewName) {
  router.get(routePath, async (_req, res, next) => {
    try {
      const items = await getFn(false);
      res.render(`admin/${viewName}`, { title: label, items });
    } catch (err) { next(err); }
  });
  router.post(routePath, async (req, res, next) => {
    try {
      const { id, name, action } = req.body;
      if (action === 'toggle') {
        await toggleFn(parseInt(id));
      } else {
        if (!name?.trim()) { req.flash('error', `${label} name is required.`); return res.redirect(`/admin${routePath}`); }
        await upsertFn(id ? parseInt(id) : null, name.trim());
      }
      req.flash('success', `${label} saved.`);
      res.redirect(`/admin${routePath}`);
    } catch (err) { next(err); }
  });
}

simplePicklistRoute('/inventory/common-names',   'Common Names',   lookupModel.getInventoryCommonNames,   lookupModel.upsertInventoryCommonName,   lookupModel.toggleInventoryCommonName,   'inventoryCommonNames');
simplePicklistRoute('/inventory/model-numbers',  'Model Numbers',  lookupModel.getInventoryModelNumbers,  lookupModel.upsertInventoryModelNumber,  lookupModel.toggleInventoryModelNumber,  'inventoryModelNumbers');
simplePicklistRoute('/inventory/manufacturers',  'Manufacturers',  lookupModel.getInventoryManufacturers, lookupModel.upsertInventoryManufacturer, lookupModel.toggleInventoryManufacturer, 'inventoryManufacturers');

// ── Maintenance Types ─────────────────────────────────────────────────────────
simplePicklistRoute('/maintenance-types', 'Maintenance Types', lookupModel.getMaintenanceTypes, lookupModel.upsertMaintenanceType, lookupModel.toggleMaintenanceType, 'maintenanceTypes');

// ── Users ─────────────────────────────────────────────────────────────────────
router.get('/users', async (req, res, next) => {
  try {
    const { sort = 'displayName', dir = 'asc' } = req.query;
    const users = await userModel.getAll({ includeInactive: true, includeDeleted: true, sort, dir });
    res.render('admin/users/index', { title: 'Users', users, sort, dir });
  } catch (err) { next(err); }
});

router.get('/users/new', async (_req, res, next) => {
  try {
    const [roles, ldapEnabled, oidcEnabled] = await Promise.all([
      lookupModel.getRoles(),
      settingsModel.getSettingsBool('ldap.enabled', 'LDAP_ENABLED'),
      settingsModel.getSettingsBool('oidc.enabled', 'OIDC_ENABLED'),
    ]);
    const authProviders = [{ value: 'local', label: 'Local (username + password)' }];
    if (ldapEnabled) authProviders.push({ value: 'ldap', label: 'Active Directory (LDAP)' });
    if (oidcEnabled) authProviders.push({ value: 'oidc', label: 'OIDC / Entra ID' });
    res.render('admin/users/form', { title: 'New User', editUser: null, roles, authProviders });
  } catch (err) { next(err); }
});

router.post('/users', [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('displayName').trim().notEmpty().withMessage('Display name is required'),
  body('password').if(body('authProvider').equals('local')).notEmpty().withMessage('Password is required for local accounts'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg));
      return res.redirect('/admin/users/new');
    }
    const { username, displayName, email, organization, password, authProvider, roles: roleNames } = req.body;

    // Check if a deleted user with this username already exists — offer restore instead
    const allUsers = await userModel.getAll({ includeDeleted: true });
    const deletedMatch = allUsers.find(u => u.DeletedAt && u.Username.toLowerCase() === username.trim().toLowerCase());
    if (deletedMatch) {
      req.flash('error', `A deleted user with username "${username.trim()}" already exists (${deletedMatch.DisplayName}). Use the Restore button on the Users list to reactivate them.`);
      return res.redirect('/admin/users/new');
    }

    const user = await userModel.create({ username, displayName, email, organization: organization || null, password, authProvider: authProvider || 'local' }, req.auditContext);
    const selectedRoles = Array.isArray(roleNames) ? roleNames : (roleNames ? [roleNames] : ['Viewer']);
    await userModel.setRoles(user.UserID, selectedRoles, req.auditContext);
    req.flash('success', `User "${displayName}" created.`);
    res.redirect('/admin/users');
  } catch (err) {
    if (err.message?.includes('UNIQUE') || err.number === 2627) {
      req.flash('error', 'Username or email already exists.');
      return res.redirect('/admin/users/new');
    }
    next(err);
  }
});

router.get('/users/:id/edit', async (req, res, next) => {
  try {
    const [editUser, roles] = await Promise.all([
      userModel.findByID(parseInt(req.params.id)),
      lookupModel.getRoles(),
    ]);
    if (!editUser) { req.flash('error', 'User not found.'); return res.redirect('/admin/users'); }
    res.render('admin/users/form', { title: 'Edit User', editUser, roles });
  } catch (err) { next(err); }
});

router.post('/users/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { displayName, email, organization, roles: roleNames, newPassword } = req.body;
    await userModel.update(id, { displayName, email, organization: organization || null, isActive: 1 }, req.auditContext);
    const selectedRoles = Array.isArray(roleNames) ? roleNames : (roleNames ? [roleNames] : []);
    if (selectedRoles.length) await userModel.setRoles(id, selectedRoles, req.auditContext);
    if (newPassword?.trim()) await userModel.updatePassword(id, newPassword.trim(), req.auditContext);
    req.flash('success', 'User updated.');
    res.redirect('/admin/users');
  } catch (err) { next(err); }
});

router.post('/users/:id/toggle', async (req, res, next) => {
  try {
    await userModel.toggleActive(parseInt(req.params.id), req.auditContext);
    req.flash('success', 'User status updated.');
    res.redirect('/admin/users');
  } catch (err) { next(err); }
});

router.post('/users/:id/delete', async (req, res, next) => {
  try {
    const result = await userModel.deleteUser(parseInt(req.params.id), req.auditContext);
    if (result.method === 'hard') {
      req.flash('success', 'User permanently deleted.');
    } else {
      req.flash('success', `User deleted. Their name is preserved in ${result.refsFound} historical record(s).`);
    }
    res.redirect('/admin/users');
  } catch (err) { next(err); }
});

router.post('/users/:id/restore', async (req, res, next) => {
  try {
    const u = await userModel.restoreUser(parseInt(req.params.id), req.auditContext);
    req.flash('success', `User "${u.DisplayName}" restored. Set a new password if needed.`);
    res.redirect('/admin/users');
  } catch (err) { next(err); }
});

// ── Settings ──────────────────────────────────────────────────────────────────
router.get('/settings', async (_req, res, next) => {
  try {
    const settings = await settingsModel.getAllSettings();
    res.render('admin/settings', { title: 'Settings', settings });
  } catch (err) { next(err); }
});

router.post('/settings', async (req, res, next) => {
  try {
    // Checkbox fields: if absent from body they were unchecked — save '0' explicitly
    const checkboxKeys = ['ldap.enabled', 'ldap.starttls', 'ldap.rejectUnauthorized', 'oidc.enabled', 'email.enabled', 'systemKeys.enabled', 'vendors.enabled', 'maintenance.enabled'];
    for (const ck of checkboxKeys) {
      if (!(ck in req.body)) req.body[ck] = '0';
    }

    // Password/secret fields: skip saving if left blank (preserve existing stored value)
    const secretKeys = ['ldap.bindCredentials', 'oidc.clientSecret', 'email.password'];
    const keys = Object.keys(req.body).filter(k => k !== '_csrf');
    for (const key of keys) {
      if (secretKeys.includes(key) && !req.body[key]) continue;
      await settingsModel.upsert(key, req.body[key] || '', req.user.UserID, req.auditContext);
    }
    // Re-initialize SSO strategies with new settings
    await passportConfig.reinitSSO();
    req.flash('success', 'Settings saved. SSO strategies re-initialized.');
    res.redirect('/admin/settings');
  } catch (err) { next(err); }
});

// ── Email Settings ────────────────────────────────────────────────────────────
router.get('/email-settings', async (_req, res, next) => {
  try {
    const settings = await settingsModel.getAllSettings();
    res.render('admin/emailSettings', { title: 'Email Settings', settings });
  } catch (err) { next(err); }
});

router.post('/email-settings', async (req, res, next) => {
  try {
    const secretKeys = ['email.password'];
    const keys = Object.keys(req.body).filter(k => k !== '_csrf');
    for (const key of keys) {
      if (secretKeys.includes(key) && !req.body[key]) continue;
      await settingsModel.upsert(key, req.body[key] || '', req.user.UserID, req.auditContext);
    }
    req.flash('success', 'Email settings saved.');
    res.redirect('/admin/email-settings');
  } catch (err) { next(err); }
});

// ── Email Templates ───────────────────────────────────────────────────────────
const EMAIL_TEMPLATE_KEYS = [
  { key: 'maintenance.assigned',  label: 'Maintenance Assigned',        vars: '{{siteName}}, {{typeName}}, {{dueDate}}, {{reference}}, {{workToComplete}}, {{url}}' },
  { key: 'maintenance.reminder',  label: 'Maintenance Reminder',         vars: '{{siteName}}, {{typeName}}, {{dueDate}}, {{daysUntilDue}}, {{reference}}, {{workToComplete}}, {{url}}' },
  { key: 'maintenance.overdue',   label: 'Maintenance Overdue',          vars: '{{siteName}}, {{typeName}}, {{dueDate}}, {{daysOverdue}}, {{reference}}, {{url}}' },
  { key: 'pm.reminder',           label: 'PM Reminder',                  vars: '{{siteName}}, {{taskTitle}}, {{daysUntilDue}}, {{assignedTo}}, {{url}}' },
  { key: 'repair.overdue',        label: 'Repair Overdue',               vars: '{{serialNumber}}, {{modelNumber}}, {{expectedReturn}}, {{daysSinceSent}}, {{assignedTo}}, {{url}}' },
  { key: 'repair.unsent',         label: 'Unsent RMA Reminder',          vars: '{{itemLabel}}, {{rmaNumber}}, {{manufacturer}}, {{daysSinceCreated}}, {{contact}}, {{url}}' },
  { key: 'warranty.expiring',     label: 'Warranty Expiring',            vars: '{{label}}, {{expiresDate}}, {{daysLeft}}, {{url}}' },
  { key: 'systemKey.expiring',    label: 'System Key Expiring',          vars: '{{issuedTo}}, {{organization}}, {{serialNumber}}, {{keyCode}}, {{expiresDate}}, {{daysLeft}}, {{url}}' },
  { key: 'log.new',               label: 'New Log Entry',                vars: '{{siteName}}, {{logType}}, {{subject}}, {{date}}, {{url}}' },
  { key: 'welcome',               label: 'Welcome / New Account',        vars: '{{displayName}}, {{username}}, {{temporaryPassword}}, {{loginUrl}}' },
  { key: 'site.statusChange',     label: 'Site Status Change',           vars: '{{siteName}}, {{oldStatus}}, {{newStatus}}, {{url}}' },
];

const EMAIL_TEMPLATE_DEFAULTS = {
  'emailTemplate.maintenance.assigned': `<h3>Maintenance Item Assigned to You</h3>
<p><strong>Site:</strong> {{siteName}}</p>
<p><strong>Type:</strong> {{typeName}}</p>
<p><strong>Due:</strong> {{dueDate}}</p>
<p><strong>Reference #:</strong> {{reference}}</p>
<p><strong>Work to Complete:</strong><br/>{{workToComplete}}</p>
<p><a href="{{url}}">View Item</a></p>`,

  'emailTemplate.maintenance.reminder': `<h3>Maintenance Reminder</h3>
<p><strong>Site:</strong> {{siteName}}</p>
<p><strong>Type:</strong> {{typeName}}</p>
<p><strong>Due:</strong> {{dueDate}} ({{daysUntilDue}})</p>
<p><strong>Reference #:</strong> {{reference}}</p>
<p><strong>Work to Complete:</strong><br/>{{workToComplete}}</p>
<p><a href="{{url}}">View Item</a></p>`,

  'emailTemplate.maintenance.overdue': `<h3>Maintenance Item Overdue</h3>
<p><strong>Site:</strong> {{siteName}}</p>
<p><strong>Type:</strong> {{typeName}}</p>
<p><strong>Due Date:</strong> <span style="color:red">{{dueDate}} ({{daysOverdue}} day(s) overdue)</span></p>
<p><strong>Reference #:</strong> {{reference}}</p>
<p><a href="{{url}}">View Item</a></p>`,

  'emailTemplate.pm.reminder': `<h3>Preventive Maintenance Reminder</h3>
<p><strong>Site:</strong> {{siteName}}</p>
<p><strong>Task:</strong> {{taskTitle}}</p>
<p><strong>Due:</strong> {{daysUntilDue}}</p>
<p><strong>Assigned To:</strong> {{assignedTo}}</p>
<p><a href="{{url}}">View Site</a></p>`,

  'emailTemplate.repair.overdue': `<h3>Repair Return Overdue</h3>
<p><strong>Item:</strong> {{serialNumber}} — {{modelNumber}}</p>
<p><strong>Expected Return:</strong> <span style="color:red">{{expectedReturn}}</span></p>
<p><strong>Days Since Sent:</strong> {{daysSinceSent}}</p>
<p><strong>Assigned To:</strong> {{assignedTo}}</p>
<p><a href="{{url}}">View Repair</a></p>`,

  'emailTemplate.repair.unsent': `<h3>Unsent RMA — Action Required</h3>
<p>The following repair/RMA was created but the item has not been shipped yet. Please ship the item and update the Sent Date to stop these reminders.</p>
<p><strong>Item:</strong> {{itemLabel}}</p>
<p><strong>RMA #:</strong> {{rmaNumber}}</p>
<p><strong>Manufacturer:</strong> {{manufacturer}}</p>
<p><strong>Created:</strong> {{daysSinceCreated}} day(s) ago</p>
<p><strong>Contact:</strong> {{contact}}</p>
<p><a href="{{url}}">View &amp; Update Repair</a></p>`,

  'emailTemplate.warranty.expiring': `<h3>Warranty Expiring Soon</h3>
<p><strong>{{label}}</strong></p>
<p><strong>Expires:</strong> {{expiresDate}} ({{daysLeft}} day(s) remaining)</p>
<p><a href="{{url}}">View Details</a></p>`,

  'emailTemplate.systemKey.expiring': `<h3>System Key Expiring Soon</h3>
<p><strong>Issued To:</strong> {{issuedTo}} ({{organization}})</p>
<p><strong>Serial #:</strong> {{serialNumber}}</p>
<p><strong>Key Code:</strong> {{keyCode}}</p>
<p><strong>Expires:</strong> {{expiresDate}} ({{daysLeft}} day(s) remaining)</p>
<p><a href="{{url}}">View Key</a></p>`,

  'emailTemplate.log.new': `<h3>New Log Entry</h3>
<p><strong>Site:</strong> {{siteName}}</p>
<p><strong>Type:</strong> {{logType}}</p>
<p><strong>Subject:</strong> {{subject}}</p>
<p><strong>Date:</strong> {{date}}</p>
<p><a href="{{url}}">View Log Entry</a></p>`,

  'emailTemplate.welcome': `<h3>Welcome, {{displayName}}!</h3>
<p>Your account has been created.</p>
<p><strong>Username:</strong> {{username}}</p>
<p><strong>Temporary Password:</strong> {{temporaryPassword}}<br/><em>Please change it after your first login.</em></p>
<p><a href="{{loginUrl}}">Log In</a></p>`,

  'emailTemplate.site.statusChange': `<h3>Site Status Change</h3>
<p><strong>Site:</strong> {{siteName}}</p>
<p><strong>Status:</strong> {{oldStatus}} → <strong>{{newStatus}}</strong></p>
<p><a href="{{url}}">View Site</a></p>`,

};

router.get('/email-templates', async (_req, res, next) => {
  try {
    const settings  = await settingsModel.getAllSettings();
    res.render('admin/emailTemplates', {
      title: 'Email Templates',
      settings,
      templates: EMAIL_TEMPLATE_KEYS,
      defaults: EMAIL_TEMPLATE_DEFAULTS,
    });
  } catch (err) { next(err); }
});

router.post('/email-templates', async (req, res, next) => {
  try {
    const keys = Object.keys(req.body).filter(k => k !== '_csrf');
    for (const key of keys) {
      await settingsModel.upsert(key, req.body[key] || '', req.user.UserID, req.auditContext);
    }
    req.flash('success', 'Email templates saved.');
    res.redirect('/admin/email-templates');
  } catch (err) { next(err); }
});

// Sample variable values used when sending a test email for a given template key
const EMAIL_TEMPLATE_SAMPLES = {
  'maintenance.assigned':  { siteName: 'Test Site', typeName: 'Inspection', dueDate: '2026-04-01', reference: 'REF-001', workToComplete: 'Check all equipment.', url: '#' },
  'maintenance.reminder':  { siteName: 'Test Site', typeName: 'Inspection', dueDate: '2026-04-01', daysUntilDue: 'in 7 day(s)', reference: 'REF-001', workToComplete: 'Check all equipment.', url: '#' },
  'maintenance.overdue':   { siteName: 'Test Site', typeName: 'Inspection', dueDate: '2026-03-10', daysOverdue: '8 day(s) overdue', reference: 'REF-001', url: '#' },
  'pm.reminder':           { siteName: 'Test Site', taskTitle: 'Annual HVAC Service', daysUntilDue: 'in 14 day(s)', assignedTo: 'Jane Smith', url: '#' },
  'repair.overdue':        { serialNumber: 'SN-12345', modelNumber: 'MX-500', expectedReturn: '2026-03-01', daysSinceSent: '25', assignedTo: 'John Doe', url: '#' },
  'repair.unsent':         { itemLabel: 'SN-12345', rmaNumber: 'RMA-9876', manufacturer: 'Acme Corp', daysSinceCreated: '2026-03-01 (5 day(s) ago)', contact: 'support@acme.com', url: '#' },
  'warranty.expiring':     { label: 'Site: Test Site', expiresDate: '2026-04-15', daysLeft: '28', url: '#' },
  'systemKey.expiring':    { issuedTo: 'Jane Smith', organization: 'Acme Corp', serialNumber: 'KEY-001', keyCode: 'ABC-123', expiresDate: '2026-04-15 (28 day(s) remaining)', daysLeft: '28', url: '#' },
  'log.new':               { siteName: 'Test Site', logType: 'Incident', subject: 'Power outage', date: '2026-03-18', url: '#' },
  'welcome':               { displayName: 'Jane Smith', username: 'jsmith', temporaryPassword: 'Temp@1234', loginUrl: '#' },
  'site.statusChange':     { siteName: 'Test Site', oldStatus: 'Current', newStatus: 'Past-Due', url: '#' },
};

router.post('/email-templates/test', async (req, res) => {
  try {
    const { renderTemplate, sendMail } = require('../services/emailService');
    const to = req.user?.Email;
    if (!to) return res.json({ success: false, message: 'Your account has no email address set.' });

    const { key, html } = req.body;
    if (!html) return res.json({ success: false, message: 'No template content provided.' });

    // Strip 'emailTemplate.' prefix if present to look up samples
    const shortKey = key.replace(/^emailTemplate\./, '');
    const vars = EMAIL_TEMPLATE_SAMPLES[shortKey] || {};
    const rendered = renderTemplate(html, vars);

    const tplEntry = EMAIL_TEMPLATE_KEYS.find(t => t.key === shortKey);
    const label = tplEntry ? tplEntry.label : shortKey;

    await sendMail({ to, subject: `[Test] ${label}`, html: rendered });
    res.json({ success: true, message: `Test sent to ${to}.` });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

router.post('/settings/email/test', async (req, res) => {
  try {
    const { sendMail } = require('../services/emailService');
    const to = req.user?.Email;
    if (!to) {
      return res.json({ success: false, message: 'Your account has no email address set.' });
    }
    await sendMail({
      to,
      subject: 'SiteMaintenance — Test Email',
      html: '<p>This is a test email from SiteMaintenance. If you received this, your SMTP settings are working correctly.</p>',
    });
    res.json({ success: true, message: `Test email sent to ${to}.` });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

router.post('/settings/ldap/test', async (req, res) => {
  const settingsModel = require('../models/settingsModel');
  const rawUrl        = await settingsModel.getSetting('ldap.url',             'LDAP_URL');
  const bindDN        = await settingsModel.getSetting('ldap.bindDn',          'LDAP_BIND_DN');
  const bindCreds     = await settingsModel.getSetting('ldap.bindCredentials', 'LDAP_BIND_CREDENTIALS');
  const searchBase    = await settingsModel.getSetting('ldap.searchBase',      'LDAP_SEARCH_BASE');
  const searchFilter  = await settingsModel.getSetting('ldap.searchFilter',    'LDAP_SEARCH_FILTER');
  const testUsername  = (req.body.username || '').trim();

  if (!rawUrl || !bindDN) {
    return res.json({ success: false, message: 'LDAP URL and Bind DN are required.' });
  }

  const ldapUrl = /^ldaps?:\/\//i.test(rawUrl) ? rawUrl : `ldap://${rawUrl}`;
  const ldap    = require('ldapjs');
  let responded = false;

  const client = ldap.createClient({
    url: ldapUrl,
    tlsOptions: { rejectUnauthorized: false },
    connectTimeout: 5000,
    timeout: 5000,
  });

  function respond(result) {
    if (!responded) {
      responded = true;
      try { client.destroy(); } catch (_) {}
      res.json(result);
    }
  }

  client.on('error', (err) => {
    respond({ success: false, message: `Cannot reach LDAP server: ${err.message}` });
  });

  client.bind(bindDN, bindCreds || '', (bindErr) => {
    if (bindErr) {
      return respond({ success: false, message: `Bind failed: ${bindErr.message}` });
    }

    if (!testUsername || !searchBase) {
      return respond({ success: true, message: 'LDAP connection and bind successful.' });
    }

    // Escape special chars in username before inserting into filter
    const escaped = testUsername.replace(/[*()\\\x00]/g, c => '\\' + c.charCodeAt(0).toString(16).padStart(2, '0'));
    const filter  = (searchFilter || '(sAMAccountName={{username}})').replace('{{username}}', escaped);

    client.search(searchBase, { filter, scope: 'sub', attributes: ['dn', 'displayName', 'mail', 'userPrincipalName'] }, (searchErr, searchRes) => {
      if (searchErr) {
        return respond({ success: false, message: `Search failed: ${searchErr.message}` });
      }

      let found = false;
      let foundDn = '';

      searchRes.on('searchEntry', (entry) => {
        found = true;
        foundDn = entry.objectName || '';
      });

      searchRes.on('error', (err) => {
        if (found) {
          respond({ success: true, message: `Bind OK. User "${testUsername}" found.${foundDn ? ' DN: ' + foundDn : ''}` });
        } else {
          respond({ success: false, message: `Search error: ${err.message}` });
        }
      });

      searchRes.on('end', () => {
        if (found) {
          respond({ success: true, message: `Bind OK. User "${testUsername}" found.${foundDn ? ' DN: ' + foundDn : ''}` });
        } else {
          respond({ success: false, message: `Bind OK, but user "${testUsername}" was not found in ${searchBase}.` });
        }
      });
    });
  });
});

// ── Audit Log ─────────────────────────────────────────────────────────────────
router.get('/audit', async (req, res, next) => {
  try {
    const { tableName, userID, action, dateFrom, dateTo, page = 1 } = req.query;
    const result = await getAuditLog({
      tableName, userID: userID ? parseInt(userID) : null,
      action, dateFrom, dateTo,
      page: parseInt(page), pageSize: 50,
    });
    const users = await userModel.getAll();
    res.render('admin/audit', {
      title: 'Audit Log', ...result, users, filters: req.query,
      pagination: { page: result.page, totalPages: result.totalPages, queryString: new URLSearchParams({ ...req.query, page: undefined }).toString() },
    });
  } catch (err) { next(err); }
});

router.get('/audit/export', async (req, res, next) => {
  try {
    const { tableName, userID, action, dateFrom, dateTo } = req.query;
    const result = await getAuditLog({
      tableName, userID: userID ? parseInt(userID) : null,
      action, dateFrom, dateTo,
      page: 1, pageSize: 100000,
    });

    const rows = result.rows.map(r => ({
      Timestamp:  r.ChangedAt ? new Date(r.ChangedAt).toLocaleString() : '',
      Table:      r.TableName || '',
      RecordID:   r.RecordID  || '',
      Action:     r.Action    || '',
      User:       r.ChangedByName || 'System',
      IPAddress:  r.IPAddress || '',
      Notes:      r.Notes     || '',
      Before:     r.OldValues || '',
      After:      r.NewValues || '',
    }));

    const wb  = XLSX.utils.book_new();
    const ws  = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'AuditLog');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="audit-log-${dateStr}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) { next(err); }
});

// ── Log File Browser ───────────────────────────────────────────────────────────
router.get('/logs', (_req, res, next) => {
  try {
    let files = [];
    if (fs.existsSync(logDir)) {
      files = fs.readdirSync(logDir)
        .filter(f => f.endsWith('.log'))
        .map(f => {
          const stat = fs.statSync(path.join(logDir, f));
          return { name: f, size: stat.size, mtime: stat.mtime };
        })
        .sort((a, b) => b.mtime - a.mtime);
    }
    res.render('admin/logs', { title: 'Log Files', files });
  } catch (err) { next(err); }
});

router.get('/logs/download', (req, res, next) => {
  try {
    const filename = path.basename(req.query.file || '');
    if (!filename || !/^(app|error)-\d{4}-\d{2}-\d{2}\.log$/.test(filename)) {
      return res.status(400).send('Invalid filename.');
    }
    const filePath = path.join(logDir, filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('File not found.');
    res.download(filePath, filename);
  } catch (err) { next(err); }
});

module.exports = router;
