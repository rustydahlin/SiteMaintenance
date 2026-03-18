'use strict';

const express  = require('express');
const router   = express.Router();
const { canAccessMaintenance, canManageMaintenance, isAuthenticated } = require('../middleware/auth');
const maintenanceModel = require('../models/maintenanceModel');
const siteModel        = require('../models/siteModel');
const lookupModel      = require('../models/lookupModel');
const userModel        = require('../models/userModel');
const email            = require('../services/emailService');

// All maintenance routes require at minimum canAccessMaintenance
router.use(isAuthenticated);

// ── Helpers ───────────────────────────────────────────────────────────────────

function isMaintenanceClose(user) {
  return user && user.roles &&
    user.roles.includes('Maintenance-Close') &&
    !user.roles.includes('Admin') &&
    !user.roles.includes('Maintenance');
}

function isMaintenanceManager(user) {
  return user && user.roles &&
    (user.roles.includes('Admin') || user.roles.includes('Maintenance'));
}

// ── GET / — list ──────────────────────────────────────────────────────────────
router.get('/', canAccessMaintenance, async (req, res, next) => {
  try {
    const page   = parseInt(req.query.page, 10) || 1;
    const siteID = req.query.siteID ? parseInt(req.query.siteID, 10) : null;
    const status = req.query.status || 'open';  // 'open' | 'closed' | 'all'
    const search = req.query.search || '';
    const sort   = req.query.sort   || 'dueDate';
    const dir    = req.query.dir    || 'asc';

    // Maintenance-Close users can only see their own items
    const assignedFilter = isMaintenanceClose(req.user) ? req.user.id : null;

    const { rows, total, totalPages } = await maintenanceModel.getAll({
      siteID,
      assignedToUserID: assignedFilter,
      open:   status === 'open'   ? true : undefined,
      closed: status === 'closed' ? true : undefined,
      sort, dir,
      page,
      pageSize: 25,
    });

    let items = rows;
    if (search) {
      const term = search.toLowerCase();
      items = rows.filter(r =>
        (r.SiteName || '').toLowerCase().includes(term) ||
        (r.ExternalReference || '').toLowerCase().includes(term) ||
        (r.MaintenanceTypeName || '').toLowerCase().includes(term) ||
        (r.AssignedToUserName || '').toLowerCase().includes(term)
      );
    }

    const sites = await siteModel.getSimpleList();

    const queryString = [
      siteID ? `siteID=${siteID}` : '',
      status ? `status=${status}` : '',
      search ? `search=${encodeURIComponent(search)}` : '',
      `sort=${sort}`,
      `dir=${dir}`,
    ].filter(Boolean).join('&');

    res.render('maintenance/index', {
      title: 'Maintenance',
      items,
      sites,
      filters: { siteID, status, search },
      sort, dir,
      pagination: { page, totalPages, total, queryString },
      canManage: isMaintenanceManager(req.user),
    });
  } catch (err) { next(err); }
});

// ── GET /new ──────────────────────────────────────────────────────────────────
router.get('/new', canManageMaintenance, async (req, res, next) => {
  try {
    const presetSiteID = req.query.siteID ? parseInt(req.query.siteID, 10) : null;
    const [sites, maintenanceTypes, allUsers] = await Promise.all([
      siteModel.getSimpleList(),
      lookupModel.getMaintenanceTypes(),
      userModel.getAll(),
    ]);
    res.render('maintenance/form', {
      title: 'New Maintenance Item',
      item:  null,
      action: '/maintenance',
      sites, maintenanceTypes, allUsers,
      presetSiteID,
    });
  } catch (err) { next(err); }
});

// ── POST / — create ───────────────────────────────────────────────────────────
router.post('/', canManageMaintenance, async (req, res, next) => {
  try {
    const { siteID, assignedToUserID, maintenanceTypeID, dueDate, externalReference, workToComplete } = req.body;

    if (!siteID) {
      req.flash('error', 'Site is required.');
      return res.redirect('/maintenance/new');
    }

    const item = await maintenanceModel.create({
      siteID:            parseInt(siteID, 10),
      assignedToUserID:  assignedToUserID  ? parseInt(assignedToUserID, 10)  : null,
      maintenanceTypeID: maintenanceTypeID ? parseInt(maintenanceTypeID, 10) : null,
      dueDate:           dueDate           || null,
      externalReference: externalReference || null,
      workToComplete:    workToComplete    || null,
    }, req.auditContext);

    // Update site status
    await siteModel.updateSiteStatus(item.SiteID);

    // Email the assigned user
    if (item.AssignedToUserEmail) {
      await email.sendMaintenanceAssigned(item);
    }

    req.flash('success', 'Maintenance item created.');
    res.redirect(`/maintenance/${item.MaintenanceID}`);
  } catch (err) { next(err); }
});

// ── GET /:id ──────────────────────────────────────────────────────────────────
router.get('/:id', canAccessMaintenance, async (req, res, next) => {
  try {
    const maintenanceID = parseInt(req.params.id, 10);
    const item = await maintenanceModel.getByID(maintenanceID);

    if (!item || !item.IsActive) {
      req.flash('error', 'Maintenance item not found.');
      return res.redirect('/maintenance');
    }

    // Maintenance-Close users can only view their own items
    if (isMaintenanceClose(req.user) && item.AssignedToUserID !== req.user.id) {
      return res.status(403).render('errors/403', { title: 'Access Denied' });
    }

    res.render('maintenance/detail', {
      title:     `Maintenance — ${item.SiteName}`,
      item,
      canManage: isMaintenanceManager(req.user),
      canClose:  item.ClosedAt === null && (
        isMaintenanceManager(req.user) ||
        (isMaintenanceClose(req.user) && item.AssignedToUserID === req.user.id)
      ),
    });
  } catch (err) { next(err); }
});

// ── GET /:id/edit ─────────────────────────────────────────────────────────────
router.get('/:id/edit', canManageMaintenance, async (req, res, next) => {
  try {
    const maintenanceID = parseInt(req.params.id, 10);
    const [item, sites, maintenanceTypes, allUsers] = await Promise.all([
      maintenanceModel.getByID(maintenanceID),
      siteModel.getSimpleList(),
      lookupModel.getMaintenanceTypes(),
      userModel.getAll(),
    ]);

    if (!item || !item.IsActive) {
      req.flash('error', 'Maintenance item not found.');
      return res.redirect('/maintenance');
    }

    res.render('maintenance/form', {
      title:  `Edit Maintenance — ${item.SiteName}`,
      item,
      action: `/maintenance/${maintenanceID}`,
      sites, maintenanceTypes, allUsers,
      presetSiteID: null,
    });
  } catch (err) { next(err); }
});

// ── POST /:id — update ────────────────────────────────────────────────────────
router.post('/:id', canManageMaintenance, async (req, res, next) => {
  try {
    const maintenanceID = parseInt(req.params.id, 10);
    const { siteID, assignedToUserID, maintenanceTypeID, dueDate, externalReference, workToComplete } = req.body;

    if (!siteID) {
      req.flash('error', 'Site is required.');
      return res.redirect(`/maintenance/${maintenanceID}/edit`);
    }

    const item = await maintenanceModel.update(maintenanceID, {
      siteID:            parseInt(siteID, 10),
      assignedToUserID:  assignedToUserID  ? parseInt(assignedToUserID, 10)  : null,
      maintenanceTypeID: maintenanceTypeID ? parseInt(maintenanceTypeID, 10) : null,
      dueDate:           dueDate           || null,
      externalReference: externalReference || null,
      workToComplete:    workToComplete    || null,
    }, req.auditContext);

    await siteModel.updateSiteStatus(item.SiteID);

    req.flash('success', 'Maintenance item updated.');
    res.redirect(`/maintenance/${maintenanceID}`);
  } catch (err) { next(err); }
});

// ── POST /:id/close — close item ──────────────────────────────────────────────
router.post('/:id/close', canAccessMaintenance, async (req, res, next) => {
  try {
    const maintenanceID = parseInt(req.params.id, 10);
    const existing = await maintenanceModel.getByID(maintenanceID);

    if (!existing || !existing.IsActive) {
      req.flash('error', 'Maintenance item not found.');
      return res.redirect('/maintenance');
    }

    // Maintenance-Close: only their own items
    if (isMaintenanceClose(req.user) && existing.AssignedToUserID !== req.user.id) {
      return res.status(403).render('errors/403', { title: 'Access Denied' });
    }

    if (existing.ClosedAt) {
      req.flash('error', 'Item is already closed.');
      return res.redirect(`/maintenance/${maintenanceID}`);
    }

    const item = await maintenanceModel.close(maintenanceID, req.body.closureNotes || null, req.auditContext);
    await siteModel.updateSiteStatus(item.SiteID);

    req.flash('success', 'Maintenance item closed.');
    res.redirect(`/maintenance/${maintenanceID}`);
  } catch (err) { next(err); }
});

// ── POST /:id/delete ──────────────────────────────────────────────────────────
router.post('/:id/delete', canManageMaintenance, async (req, res, next) => {
  try {
    const maintenanceID = parseInt(req.params.id, 10);
    const item = await maintenanceModel.getByID(maintenanceID);

    if (!item || !item.IsActive) {
      req.flash('error', 'Maintenance item not found.');
      return res.redirect('/maintenance');
    }

    const siteID = item.SiteID;
    await maintenanceModel.softDelete(maintenanceID, req.auditContext);
    await siteModel.updateSiteStatus(siteID);

    req.flash('success', 'Maintenance item deleted.');
    res.redirect('/maintenance');
  } catch (err) { next(err); }
});

module.exports = router;
