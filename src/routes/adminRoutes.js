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

// ── Users ─────────────────────────────────────────────────────────────────────
router.get('/users', async (req, res, next) => {
  try {
    const { sort = 'displayName', dir = 'asc' } = req.query;
    const users = await userModel.getAll({ includeInactive: true, sort, dir });
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
    const { username, displayName, email, password, authProvider, roles: roleNames } = req.body;
    const user = await userModel.create({ username, displayName, email, password, authProvider: authProvider || 'local' }, req.auditContext);
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
    const { displayName, email, roles: roleNames, newPassword } = req.body;
    await userModel.update(id, { displayName, email, isActive: 1 }, req.auditContext);
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
    const checkboxKeys = ['ldap.enabled', 'ldap.starttls', 'ldap.rejectUnauthorized', 'oidc.enabled', 'email.enabled'];
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
