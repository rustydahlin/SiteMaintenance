'use strict';

const express    = require('express');
const { isAdmin } = require('../middleware/auth');
const lookupModel   = require('../models/lookupModel');
const userModel     = require('../models/userModel');
const settingsModel = require('../models/settingsModel');
const { getAuditLog } = require('../models/auditModel');
const passportConfig  = require('../config/passport');
const { body, validationResult } = require('express-validator');
const router = express.Router();

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
router.get('/users', async (_req, res, next) => {
  try {
    const users = await userModel.getAll({ includeInactive: true });
    res.render('admin/users/index', { title: 'Users', users });
  } catch (err) { next(err); }
});

router.get('/users/new', async (_req, res, next) => {
  try {
    const roles = await lookupModel.getRoles();
    res.render('admin/users/form', { title: 'New User', editUser: null, roles });
  } catch (err) { next(err); }
});

router.post('/users', [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('displayName').trim().notEmpty().withMessage('Display name is required'),
  body('password').notEmpty().withMessage('Password is required for local accounts').if(body('authProvider').equals('local')),
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
    const keys = Object.keys(req.body).filter(k => k !== '_csrf');
    for (const key of keys) {
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

router.post('/settings/ldap/test', async (req, res, next) => {
  try {
    const settingsModel = require('../models/settingsModel');
    const ldapUrl    = await settingsModel.getSetting('ldap.url',          'LDAP_URL');
    const bindDN     = await settingsModel.getSetting('ldap.bindDn',       'LDAP_BIND_DN');
    const bindCreds  = await settingsModel.getSetting('ldap.bindCredentials', 'LDAP_BIND_CREDENTIALS');
    const searchBase = await settingsModel.getSetting('ldap.searchBase',   'LDAP_SEARCH_BASE');

    if (!ldapUrl || !bindDN) {
      return res.json({ success: false, message: 'LDAP URL and Bind DN are required.' });
    }

    const ldap   = require('ldapjs');
    const client = ldap.createClient({ url: ldapUrl });
    await new Promise((resolve, reject) => {
      client.bind(bindDN, bindCreds || '', (err) => {
        client.destroy();
        if (err) reject(err); else resolve();
      });
    });
    res.json({ success: true, message: 'LDAP connection and bind successful.' });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
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

module.exports = router;
