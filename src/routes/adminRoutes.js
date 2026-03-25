'use strict';

const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const multer     = require('multer');
const lookupModel            = require('../models/lookupModel');
const userModel              = require('../models/userModel');
const settingsModel          = require('../models/settingsModel');
const networkResourceModel   = require('../models/networkResourceModel');
const { getAuditLog } = require('../models/auditModel');
const passportConfig  = require('../config/passport');
const { body, validationResult } = require('express-validator');
const XLSX = require('xlsx');
const router = express.Router();

const jsonUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.json$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Only .json files are accepted'));
  },
});

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.csv$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Only .csv files are accepted'));
  },
});

// RFC 4180 CSV parser (handles quoted fields with commas, newlines, escaped quotes)
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
      else { field += ch; }
    }
  }
  if (field || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  return (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r'))
    ? '"' + str.replace(/"/g, '""') + '"'
    : str;
}

const CSV_HEADERS = ['SiteNumber','SiteName','Hostname','IPAddress','DeviceType',
  'AlertStatus','SolarwindsNodeId','CircuitType','CircuitID','Notes','SortOrder'];

const logDir = process.env.LOG_DIR
  ? path.resolve(process.env.LOG_DIR)
  : path.join(__dirname, '..', 'logs');

// Paths that NetworkMapUpdater may access (in addition to Admin)
const NM_UPDATER_PATHS = [
  '/',
  '/network-resources-import',
  '/network-resources-export',
  '/network-resources-csv-import',
  '/network-resources-csv-export',
  '/monitoring-location-types',
  '/network-device-types',
  '/circuit-types',
];

// Admin gate — NetworkMapUpdater is allowed through for NM-specific paths
router.use((req, res, next) => {
  if (!req.isAuthenticated()) {
    req.flash('error', 'Please log in to access that page.');
    return res.redirect('/auth/login');
  }
  const roles = req.user.roles || [];
  if (roles.includes('Admin')) return next();
  const basePath = req.path === '/' ? '/' : '/' + req.path.split('/').filter(Boolean)[0];
  if (roles.includes('NetworkMapUpdater') && NM_UPDATER_PATHS.includes(basePath)) return next();
  res.status(403).render('errors/403', { title: 'Access Denied' });
});

// ── Admin Index ───────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const roles = req.user?.roles || [];
  const isNetworkMapUpdater = !roles.includes('Admin') && roles.includes('NetworkMapUpdater');
  res.render('admin/index', { title: 'Administration', isNetworkMapUpdater });
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

// ── Network / Tower Map Lookups ───────────────────────────────────────────────
simplePicklistRoute('/monitoring-location-types', 'Monitoring Location Types', lookupModel.getMonitoringLocationTypes, lookupModel.upsertMonitoringLocationType, lookupModel.toggleMonitoringLocationType, 'monitoringLocationTypes');
simplePicklistRoute('/network-device-types',      'Network Device Types',      lookupModel.getNetworkDeviceTypes,      lookupModel.upsertNetworkDeviceType,      lookupModel.toggleNetworkDeviceType,      'networkDeviceTypes');
simplePicklistRoute('/circuit-types',             'Circuit Types',             lookupModel.getCircuitTypes,             lookupModel.upsertCircuitType,             lookupModel.toggleCircuitType,             'circuitTypes');

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
    const secretKeys = ['ldap.bindCredentials', 'oidc.clientSecret', 'email.password', 'towerMap.apiKey'];
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

// ── Network Resources Export ──────────────────────────────────────────────────
router.get('/network-resources-export', async (_req, res, next) => {
  try {
    const data = await networkResourceModel.getTowerMapData();
    const json = JSON.stringify(data, null, 2);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="devices.json"');
    res.send(json);
  } catch (err) { next(err); }
});

// ── Network Resources CSV Export ──────────────────────────────────────────────
router.get('/network-resources-csv-export', async (_req, res, next) => {
  try {
    const rows  = await networkResourceModel.getAllForCsvExport();
    const lines = [CSV_HEADERS.join(',')];
    for (const r of rows) {
      lines.push([
        csvEscape(r.SiteNumber),
        csvEscape(r.SiteName),
        csvEscape(r.Hostname),
        csvEscape(r.IPAddress),
        csvEscape(r.DeviceType),
        csvEscape(r.AlertStatus ? 1 : 0),
        csvEscape(r.SolarwindsNodeId),
        csvEscape(r.CircuitType),
        csvEscape(r.CircuitID),
        csvEscape(r.Notes),
        csvEscape(r.SortOrder),
      ].join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="network-resources.csv"');
    res.send(lines.join('\r\n'));
  } catch (err) { next(err); }
});

// ── Network Resources CSV Import — preview ────────────────────────────────────
router.post('/network-resources-csv-import', csvUpload.single('networkResourcesCsv'), async (req, res, next) => {
  const render = (preview, error) =>
    res.render('admin/networkResourcesImport', { title: 'Network Resources Import / Export', preview, csvPreview: null, error });

  try {
    if (!req.file) return render(null, 'Please select a CSV file.');

    let csvRows;
    try {
      csvRows = parseCsv(req.file.buffer.toString('utf-8'));
    } catch (e) {
      return render(null, `Could not parse CSV: ${e.message}`);
    }

    if (csvRows.length < 2) return render(null, 'CSV has no data rows.');
    const headers = csvRows[0].map(h => h.trim());
    const required = ['SiteNumber','SiteName','Hostname','DeviceType'];
    for (const h of required) {
      if (!headers.includes(h)) return render(null, `Missing required column: ${h}`);
    }
    const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

    // Load lookups
    const { getPool } = require('../config/database');
    const pool = await getPool();
    const [sitesResult, deviceTypesResult, circuitTypesResult] = await Promise.all([
      pool.request().query(`SELECT SiteID, ISNULL(SiteNumber,'') AS SiteNumber, SiteName FROM Sites WHERE IsActive = 1`),
      pool.request().query(`SELECT DeviceTypeID, TypeName FROM NetworkDeviceTypes`),
      pool.request().query(`SELECT CircuitTypeID, TypeName FROM CircuitTypes`),
    ]);

    const siteMap      = new Map(sitesResult.recordset.map(r =>
      [`${(r.SiteNumber||'').trim().toLowerCase()}|${r.SiteName.trim().toLowerCase()}`, r.SiteID]));
    const siteByID     = new Map(sitesResult.recordset.map(r => [r.SiteID, r]));
    const devTypeMap   = new Map(deviceTypesResult.recordset.map(r => [r.TypeName.toLowerCase(), r.DeviceTypeID]));
    const devTypeByID  = new Map(deviceTypesResult.recordset.map(r => [r.DeviceTypeID, r.TypeName]));
    const circTypeMap  = new Map(circuitTypesResult.recordset.map(r => [r.TypeName.toLowerCase(), r.CircuitTypeID]));

    // Load existing resources with full field set for diff comparison
    const existingResult = await pool.request().query(`
      SELECT r.ResourceID, r.SiteID, r.Hostname, r.IPAddress,
             r.DeviceTypeID, r.AlertStatus, r.SolarwindsNodeId,
             r.CircuitTypeID, r.CircuitID, r.Notes, r.SortOrder, r.IsActive
      FROM NetworkResources r
    `);
    const existingMap = new Map(existingResult.recordset.map(r =>
      [`${r.SiteID}|${r.Hostname.toLowerCase()}`, r]));

    const toInsert = [], toUpdate = [], unchanged = [], skipped = [];
    const seenHostnames = new Map(); // siteID → Set of lowercase hostnames seen in CSV

    // Helper: normalise a value for comparison (null/''/undefined → null, numbers as numbers)
    const norm = v => (v === null || v === undefined || v === '') ? null : v;

    for (let i = 1; i < csvRows.length; i++) {
      const cols = csvRows[i];
      if (cols.every(c => !c.trim())) continue; // blank row
      const get = key => (idx[key] !== undefined ? (cols[idx[key]] || '').trim() : '');

      const siteKey   = `${get('SiteNumber').toLowerCase()}|${get('SiteName').toLowerCase()}`;
      const siteID    = siteMap.get(siteKey);
      const hostname  = get('Hostname');
      const devTypeID = devTypeMap.get(get('DeviceType').toLowerCase());

      if (!siteID)    { skipped.push({ row: i + 1, name: `${get('SiteNumber')} ${get('SiteName')}`, reason: 'Site not found' }); continue; }
      if (!hostname)  { skipped.push({ row: i + 1, name: `${get('SiteNumber')} ${get('SiteName')}`, reason: 'Hostname blank' }); continue; }
      if (!devTypeID) { skipped.push({ row: i + 1, name: hostname, reason: `Device type "${get('DeviceType')}" not found` }); continue; }

      const circTypeID     = circTypeMap.get(get('CircuitType').toLowerCase()) || null;
      const alertStatus    = get('AlertStatus') === '0' ? 0 : 1;
      const solarwindsNodeId = get('SolarwindsNodeId') ? parseInt(get('SolarwindsNodeId'), 10) : null;
      const sortOrder      = get('SortOrder') ? parseInt(get('SortOrder'), 10) : 0;
      const ipAddress      = get('IPAddress') || null;
      const circuitID      = get('CircuitID') || null;
      const notes          = get('Notes') || null;

      const siteNumber = get('SiteNumber');
      const siteName   = get('SiteName');
      const devTypeName = get('DeviceType');
      const resourceData = {
        siteID, siteNumber, siteName, hostname, devTypeID, devTypeName, circTypeID,
        ipAddress, alertStatus, solarwindsNodeId, circuitID, notes, sortOrder,
      };

      // Track which hostnames were seen per site (for deletion detection)
      if (!seenHostnames.has(siteID)) seenHostnames.set(siteID, new Set());
      seenHostnames.get(siteID).add(hostname.toLowerCase());

      const existing = existingMap.get(`${siteID}|${hostname.toLowerCase()}`);
      if (!existing) {
        toInsert.push(resourceData);
      } else {
        // Compare every updatable field — only flag as update if something changed
        const changed =
          norm(existing.IPAddress)         !== norm(ipAddress)       ||
          existing.DeviceTypeID            !== devTypeID             ||
          (existing.AlertStatus ? 1 : 0)  !== alertStatus           ||
          norm(existing.SolarwindsNodeId)  !== norm(solarwindsNodeId)||
          norm(existing.CircuitTypeID)     !== norm(circTypeID)      ||
          norm(existing.CircuitID)         !== norm(circuitID)       ||
          norm(existing.Notes)             !== norm(notes)           ||
          existing.SortOrder               !== sortOrder;

        if (changed) {
          toUpdate.push({ resourceID: existing.ResourceID, ...resourceData });
        } else {
          unchanged.push(hostname);
        }
      }
    }

    // Detect deletions: existing resources for CSV-mentioned sites not present in CSV
    const toDelete = [];
    for (const [siteID, hostnamesInCsv] of seenHostnames) {
      for (const existing of existingResult.recordset.filter(r => r.SiteID === siteID)) {
        if (!hostnamesInCsv.has(existing.Hostname.toLowerCase())) {
          const site = siteByID.get(existing.SiteID);
          toDelete.push({
            resourceID:  existing.ResourceID,
            siteID:      existing.SiteID,
            siteNumber:  site?.SiteNumber || '',
            siteName:    site?.SiteName   || '',
            hostname:    existing.Hostname,
            ipAddress:   existing.IPAddress,
            devTypeName: devTypeByID.get(existing.DeviceTypeID) || '',
            alertStatus: existing.AlertStatus ? 1 : 0,
          });
        }
      }
    }

    const payloadJson = JSON.stringify({ toInsert, toUpdate, toDelete });
    res.render('admin/networkResourcesImport', {
      title: 'Network Resources Import / Export',
      preview: null,
      csvPreview: { toInsert, toUpdate, toDelete, unchanged, skipped, payloadJson },
      error: null,
    });
  } catch (err) {
    if (err instanceof multer.MulterError || err.message?.includes('Only .csv')) {
      return res.render('admin/networkResourcesImport', {
        title: 'Network Resources Import / Export', preview: null, csvPreview: null, error: err.message,
      });
    }
    next(err);
  }
});

// ── Network Resources CSV Import — confirm ────────────────────────────────────
router.post('/network-resources-csv-import/confirm', express.urlencoded({ extended: true, limit: '20mb' }), async (req, res, next) => {
  try {
    const { toInsert, toUpdate, toDelete = [] } = JSON.parse(req.body.payload || '{"toInsert":[],"toUpdate":[],"toDelete":[]}');
    const { getPool, sql } = require('../config/database');
    const pool = await getPool();

    let inserted = 0, updated = 0, deleted = 0;

    for (const r of toInsert) {
      await networkResourceModel.create(r.siteID, {
        hostname: r.hostname, ipAddress: r.ipAddress,
        deviceTypeID: r.devTypeID, alertStatus: r.alertStatus,
        solarwindsNodeId: r.solarwindsNodeId, circuitTypeID: r.circTypeID,
        circuitID: r.circuitID, notes: r.notes, sortOrder: r.sortOrder,
      }, req.auditContext);
      inserted++;
    }

    for (const r of toUpdate) {
      await pool.request()
        .input('ResourceID',       sql.Int,               r.resourceID)
        .input('IPAddress',        sql.NVarChar(45),       r.ipAddress)
        .input('DeviceTypeID',     sql.Int,                r.devTypeID)
        .input('AlertStatus',      sql.Bit,                r.alertStatus)
        .input('SolarwindsNodeId', sql.Int,                r.solarwindsNodeId)
        .input('CircuitTypeID',    sql.Int,                r.circTypeID)
        .input('CircuitID',        sql.NVarChar(150),      r.circuitID)
        .input('Notes',            sql.NVarChar(sql.MAX),  r.notes)
        .input('SortOrder',        sql.Int,                r.sortOrder)
        .input('UserID',           sql.Int,                req.auditContext?.userID || null)
        .query(`
          UPDATE NetworkResources SET
            IPAddress = @IPAddress, DeviceTypeID = @DeviceTypeID,
            AlertStatus = @AlertStatus, SolarwindsNodeId = @SolarwindsNodeId,
            CircuitTypeID = @CircuitTypeID, CircuitID = @CircuitID,
            Notes = @Notes, SortOrder = @SortOrder,
            UpdatedAt = GETUTCDATE(), UpdatedByUserID = @UserID
          WHERE ResourceID = @ResourceID
        `);
      updated++;
    }

    for (const r of toDelete) {
      await networkResourceModel.softDelete(r.resourceID, req.auditContext);
      deleted++;
    }

    req.flash('success', `CSV import complete: ${inserted} added, ${updated} updated, ${deleted} deleted.`);
    res.redirect('/admin/network-resources-import');
  } catch (err) { next(err); }
});

// ── Network Resources Import ──────────────────────────────────────────────────
router.get('/network-resources-import', (_req, res) => {
  res.render('admin/networkResourcesImport', { title: 'Network Resources Import / Export', preview: null, csvPreview: null, error: null });
});

router.post('/network-resources-import', jsonUpload.single('devicesJson'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.render('admin/networkResourcesImport', { title: 'Network Resources Import', preview: null, error: 'Please select a devices.json file.' });
    }

    let entries;
    try {
      entries = JSON.parse(req.file.buffer.toString('utf-8'));
      if (!Array.isArray(entries)) throw new Error('Root element must be an array.');
    } catch (parseErr) {
      return res.render('admin/networkResourcesImport', { title: 'Network Resources Import / Export', preview: null, csvPreview: null, error: `Invalid JSON: ${parseErr.message}` });
    }

    // Load all sites for matching
    const { getPool } = require('../config/database');
    const pool = await getPool();
    const sitesResult = await pool.request().query(
      `SELECT SiteID, LOWER(ISNULL(SiteNumber + ' ', '') + SiteName) AS MatchKey FROM Sites WHERE IsActive = 1`
    );
    const siteMap = new Map(sitesResult.recordset.map(r => [r.MatchKey.trim(), r.SiteID]));

    const matched   = [];
    const unmatched = [];

    for (const entry of entries) {
      if (!entry || typeof entry.name !== 'string') continue;
      const key    = entry.name.trim().toLowerCase();
      const siteID = siteMap.get(key);
      if (siteID) {
        matched.push({ entry, siteID });
      } else {
        unmatched.push(entry.name);
      }
    }

    // Serialize for confirm form
    const payloadJson = JSON.stringify(matched.map(m => ({ siteID: m.siteID, entry: m.entry })));

    res.render('admin/networkResourcesImport', {
      title:      'Network Resources Import / Export',
      preview:    { matched, unmatched, payloadJson },
      csvPreview: null,
      error:      null,
    });
  } catch (err) {
    if (err instanceof multer.MulterError || err.message?.includes('Only .json')) {
      return res.render('admin/networkResourcesImport', { title: 'Network Resources Import / Export', preview: null, csvPreview: null, error: err.message });
    }
    next(err);
  }
});

router.post('/network-resources-import/confirm', express.urlencoded({ extended: true, limit: '20mb' }), async (req, res, next) => {
  try {
    const rows = JSON.parse(req.body.payload || '[]');

    // Load lookup maps
    const [monitoringTypes, deviceTypes] = await Promise.all([
      lookupModel.getMonitoringLocationTypes(false),
      lookupModel.getNetworkDeviceTypes(false),
    ]);
    const monTypeMap = new Map(monitoringTypes.map(t => [t.TypeName.toLowerCase(), t.LocationTypeID]));
    const devTypeMap = new Map(deviceTypes.map(t => [t.TypeName.toLowerCase(), t.DeviceTypeID]));

    const { getPool, sql } = require('../config/database');
    const pool = await getPool();

    let sitesUpdated = 0;
    let devicesAdded = 0;
    let devicesSkipped = 0;

    for (const { siteID, entry } of rows) {
      // Set MonitoringLocationTypeID on the site
      const locTypeID = entry.locType ? monTypeMap.get(entry.locType.toLowerCase()) : null;
      if (locTypeID) {
        await pool.request()
          .input('SiteID',    sql.Int, siteID)
          .input('LocTypeID', sql.Int, locTypeID)
          .query('UPDATE Sites SET MonitoringLocationTypeID = @LocTypeID WHERE SiteID = @SiteID');
        sitesUpdated++;
      }

      // Insert devices
      const devices = Array.isArray(entry.devices) ? entry.devices : [];
      for (const dev of devices) {
        const devTypeID = dev.type ? devTypeMap.get(dev.type.toLowerCase()) : null;
        if (!devTypeID || !dev.name) { devicesSkipped++; continue; }

        // Skip if Hostname+SiteID already exists
        const exists = await pool.request()
          .input('SiteID',   sql.Int,          siteID)
          .input('Hostname', sql.NVarChar(150), dev.name)
          .query('SELECT 1 AS n FROM NetworkResources WHERE SiteID = @SiteID AND Hostname = @Hostname AND IsActive = 1');
        if (exists.recordset.length > 0) { devicesSkipped++; continue; }

        await networkResourceModel.create(siteID, {
          hostname:         dev.name,
          ipAddress:        dev.ip             || null,
          deviceTypeID:     devTypeID,
          alertStatus:      dev.affectsStatus  !== false,
          solarwindsNodeId: dev.solarwindsNodeId || null,
          circuitTypeID:    null,
          circuitID:        null,
          notes:            null,
          sortOrder:        0,
        }, req.auditContext);
        devicesAdded++;
      }
    }

    req.flash('success', `Import complete: ${sitesUpdated} site(s) updated, ${devicesAdded} device(s) added, ${devicesSkipped} skipped.`);
    res.redirect('/admin/network-resources-import');
  } catch (err) { next(err); }
});

module.exports = router;
