'use strict';

const express            = require('express');
const router             = express.Router();
const siteModel             = require('../models/siteModel');
const siteInventoryModel    = require('../models/siteInventoryModel');
const networkResourceModel  = require('../models/networkResourceModel');
const repairModel           = require('../models/repairModel');
const maintenanceModel      = require('../models/maintenanceModel');
const inventoryModel        = require('../models/inventoryModel');
const { isAuthenticated } = require('../middleware/auth');

// All mobile routes require login
router.use(isAuthenticated);

// Use mobile layout instead of main layout
router.use((req, res, next) => {
  res.locals.layout = 'mobile/layout';
  next();
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const today = new Date();
    const [sitesResult, repairsResult, maintenanceResult] = await Promise.all([
      siteModel.getAll({ page: 1, pageSize: 1 }),
      repairModel.getAll({ status: 'open', page: 1, pageSize: 1 }),
      maintenanceModel.getAll({ open: true, page: 1, pageSize: 200 }),
    ]);

    const siteCount   = sitesResult.total;
    const openRepairs = repairsResult.total;
    const allOpen     = maintenanceResult.rows;
    const overdueCount = allOpen.filter(m => m.DueDate && new Date(m.DueDate) < today).length;
    const dueCount     = allOpen.filter(m => m.DueDate && new Date(m.DueDate) >= today).length;

    res.render('mobile/dashboard', {
      title: 'Dashboard',
      siteCount,
      openRepairs,
      overdueCount,
      dueCount,
    });
  } catch (err) {
    next(err);
  }
});

// ── Sites list ────────────────────────────────────────────────────────────────
router.get('/sites', async (req, res, next) => {
  try {
    const { q = '', page = 1 } = req.query;
    const result = await siteModel.getAll({
      search: q || undefined,
      page: parseInt(page, 10),
      pageSize: 20,
    });

    res.render('mobile/sites', {
      title: 'Sites',
      sites: result.rows,
      total: result.total,
      page: result.page,
      totalPages: result.totalPages,
      q,
    });
  } catch (err) {
    next(err);
  }
});

// ── Site detail ───────────────────────────────────────────────────────────────
router.get('/sites/:id', async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.id, 10);
    const [site, inventory, subsites, networkResources] = await Promise.all([
      siteModel.getByID(siteID),
      siteInventoryModel.getCurrentItems(siteID),
      siteModel.getSubsites(siteID),
      networkResourceModel.getBySite(siteID),
    ]);

    if (!site) return res.status(404).render('errors/404', { title: 'Not Found' });

    res.render('mobile/site-detail', {
      title: site.SiteName,
      site,
      inventory,
      subsites,
      networkResources,
    });
  } catch (err) {
    next(err);
  }
});

// ── Repairs ───────────────────────────────────────────────────────────────────
router.get('/repairs', async (req, res, next) => {
  try {
    const { status = 'open' } = req.query;
    const result = await repairModel.getAll({
      status: status === 'all' ? undefined : status,
      page: 1,
      pageSize: 50,
      sort: 'sentDate',
      dir: 'desc',
    });

    res.render('mobile/repairs', {
      title: 'Repairs',
      repairs: result.rows,
      status,
    });
  } catch (err) {
    next(err);
  }
});

// ── Maintenance ───────────────────────────────────────────────────────────────
router.get('/maintenance', async (req, res, next) => {
  try {
    const { filter = 'overdue' } = req.query;
    const opts = { page: 1, pageSize: 100, sort: 'dueDate', dir: 'asc' };

    if (filter === 'overdue')      { opts.open = true; opts.overdueOnly = true; }
    else if (filter === 'open')    { opts.open = true; }
    // 'all' — no filter

    const result = await maintenanceModel.getAll(opts);

    res.render('mobile/maintenance', {
      title: 'Maintenance',
      items: result.rows,
      filter,
    });
  } catch (err) {
    next(err);
  }
});

// ── Inventory ─────────────────────────────────────────────────────────────────
router.get('/inventory', async (req, res, next) => {
  try {
    const { q = '' } = req.query;
    let items = [];
    let total = 0;

    if (q.trim()) {
      const result = await inventoryModel.getAll({ search: q, page: 1, pageSize: 30 });
      items = result.rows;
      total = result.total;
    }

    res.render('mobile/inventory', {
      title: 'Inventory',
      items,
      total,
      q,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
