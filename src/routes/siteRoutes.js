'use strict';

const express           = require('express');
const router            = express.Router();
const siteModel          = require('../models/siteModel');
const lookupModel        = require('../models/lookupModel');
const logModel           = require('../models/logModel');
const documentModel      = require('../models/documentModel');
const siteInventoryModel = require('../models/siteInventoryModel');
const inventoryModel     = require('../models/inventoryModel');
const pmModel            = require('../models/pmModel');
const { isAuthenticated, isAdmin, canWrite } = require('../middleware/auth');

// All routes require authentication
router.use(isAuthenticated);

// ── GET / — list sites ────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { typeID, statusID, search, pmDue, page = 1 } = req.query;

    const [result, siteTypes, siteStatuses] = await Promise.all([
      siteModel.getAll({ typeID, statusID, search, pmDue, page: parseInt(page, 10) }),
      lookupModel.getSiteTypes(),
      lookupModel.getSiteStatuses(),
    ]);

    const queryParts = [];
    if (typeID)   queryParts.push(`typeID=${encodeURIComponent(typeID)}`);
    if (statusID) queryParts.push(`statusID=${encodeURIComponent(statusID)}`);
    if (search)   queryParts.push(`search=${encodeURIComponent(search)}`);
    if (pmDue)    queryParts.push(`pmDue=${encodeURIComponent(pmDue)}`);

    res.render('sites/index', {
      title: 'Sites',
      sites: result.rows,
      siteTypes,
      siteStatuses,
      filters: { typeID, statusID, search, pmDue },
      pagination: {
        page:        result.page,
        totalPages:  result.totalPages,
        total:       result.total,
        queryString: queryParts.join('&'),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /new — create form ────────────────────────────────────────────────────
router.get('/new', isAdmin, async (req, res, next) => {
  try {
    const [siteTypes, siteStatuses] = await Promise.all([
      lookupModel.getSiteTypes(),
      lookupModel.getSiteStatuses(),
    ]);
    res.render('sites/form', {
      title:       'New Site',
      site:        null,
      action:      '/sites',
      siteTypes,
      siteStatuses,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST / — create site ──────────────────────────────────────────────────────
router.post('/', isAdmin, async (req, res, next) => {
  try {
    const { siteName } = req.body;
    if (!siteName || !siteName.trim()) {
      req.flash('error', 'Site Name is required.');
      return res.redirect('/sites/new');
    }

    const site = await siteModel.create({
      siteName:        siteName.trim(),
      siteTypeID:      req.body.siteTypeID   || null,
      siteStatusID:    req.body.siteStatusID  || null,
      address:         req.body.address       || null,
      city:            req.body.city          || null,
      state:           req.body.state         || null,
      zipCode:         req.body.zipCode       || null,
      latitude:        req.body.latitude      || null,
      longitude:       req.body.longitude     || null,
      description:     req.body.description   || null,
      warrantyExpires: req.body.warrantyExpires || null,
    }, req.auditContext);

    req.flash('success', `Site "${site.SiteName}" created successfully.`);
    res.redirect(`/sites/${site.SiteID}`);
  } catch (err) {
    next(err);
  }
});

// ── GET /:id — site detail ────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.id, 10);

    const [site, inventory, recentLogs, documents, pmSchedules, inStockItems, categories, stockLocations] = await Promise.all([
      siteModel.getByID(siteID),
      siteInventoryModel.getCurrentItems(siteID),
      logModel.getBySite(siteID, { pageSize: 10 }).then(r => r.rows),
      documentModel.getBySite(siteID),
      pmModel.getBySite(siteID),
      inventoryModel.getInStock(),
      lookupModel.getInventoryCategories(),
      lookupModel.getStockLocations(),
    ]);

    // Load stock distribution for each bulk item so the install modal can show pull-from options
    const bulkItemIDs = inStockItems.filter(i => i.TrackingType === 'bulk').map(i => i.ItemID);
    const stockRows   = bulkItemIDs.length
      ? await Promise.all(bulkItemIDs.map(id => inventoryModel.getStock(id).then(rows => ({ id, rows }))))
      : [];
    const stockByItem = {};
    stockRows.forEach(({ id, rows }) => { stockByItem[id] = rows; });

    if (!site) {
      req.flash('error', 'Site not found.');
      return res.redirect('/sites');
    }

    const isAdmin = req.user && req.user.roles && req.user.roles.includes('Admin');
    const canWriteFlag = req.user && req.user.roles &&
      (req.user.roles.includes('Admin') || req.user.roles.includes('Technician') || req.user.roles.includes('Contractor'));

    res.render('sites/detail', {
      title:      site.SiteName,
      site,
      inventory,
      recentLogs,
      documents,
      pmSchedules,
      inStockItems,
      stockByItem,
      categories,
      stockLocations,
      isAdminUser: isAdmin,
      canWrite:    canWriteFlag,
      uploadUrl:   `/documents/upload`,
      canUpload:   canWriteFlag,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /:id/edit — edit form ─────────────────────────────────────────────────
router.get('/:id/edit', isAdmin, async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.id, 10);
    const [site, siteTypes, siteStatuses] = await Promise.all([
      siteModel.getByID(siteID),
      lookupModel.getSiteTypes(),
      lookupModel.getSiteStatuses(),
    ]);

    if (!site) {
      req.flash('error', 'Site not found.');
      return res.redirect('/sites');
    }

    res.render('sites/form', {
      title:       `Edit — ${site.SiteName}`,
      site,
      action:      `/sites/${siteID}`,
      siteTypes,
      siteStatuses,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /:id — update site ───────────────────────────────────────────────────
router.post('/:id', isAdmin, async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.id, 10);
    const { siteName } = req.body;

    if (!siteName || !siteName.trim()) {
      req.flash('error', 'Site Name is required.');
      return res.redirect(`/sites/${siteID}/edit`);
    }

    const site = await siteModel.update(siteID, {
      siteName:        siteName.trim(),
      siteTypeID:      req.body.siteTypeID   || null,
      siteStatusID:    req.body.siteStatusID  || null,
      address:         req.body.address       || null,
      city:            req.body.city          || null,
      state:           req.body.state         || null,
      zipCode:         req.body.zipCode       || null,
      latitude:        req.body.latitude      || null,
      longitude:       req.body.longitude     || null,
      description:     req.body.description   || null,
      warrantyExpires: req.body.warrantyExpires || null,
    }, req.auditContext);

    req.flash('success', `Site "${site.SiteName}" updated successfully.`);
    res.redirect(`/sites/${siteID}`);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/delete — soft delete ────────────────────────────────────────────
router.post('/:id/delete', isAdmin, async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.id, 10);
    const site = await siteModel.getByID(siteID);
    if (!site) {
      req.flash('error', 'Site not found.');
      return res.redirect('/sites');
    }

    await siteModel.softDelete(siteID, req.auditContext);
    req.flash('success', `Site "${site.SiteName}" has been deleted.`);
    res.redirect('/sites');
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/inventory/install ───────────────────────────────────────────────
router.post('/:id/inventory/install', isAdmin, async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.id, 10);
    const { mode, itemID, installNotes, quantity, pulledFrom, serialNumber, modelNumber, manufacturer, categoryID, purchaseDate, warrantyExpires } = req.body;

    // Parse pulledFrom: "location:123" | "user:456" | "" (unallocated)
    let pulledFromLocationID = null;
    let pulledFromUserID     = null;
    if (pulledFrom && pulledFrom.startsWith('location:')) {
      pulledFromLocationID = parseInt(pulledFrom.split(':')[1], 10) || null;
    } else if (pulledFrom && pulledFrom.startsWith('user:')) {
      pulledFromUserID = parseInt(pulledFrom.split(':')[1], 10) || null;
    }

    let targetItemID;

    if (mode === 'new') {
      if (!serialNumber?.trim()) {
        req.flash('error', 'Serial number is required.');
        return res.redirect(`/sites/${siteID}#equipment`);
      }
      const newItem = await inventoryModel.create({
        serialNumber:    serialNumber.trim(),
        modelNumber:     modelNumber     || null,
        manufacturer:    manufacturer    || null,
        categoryID:      categoryID      || null,
        statusID:        null,
        purchaseDate:    purchaseDate    || null,
        warrantyExpires: warrantyExpires || null,
      }, req.auditContext);
      targetItemID = newItem.ItemID;
    } else {
      targetItemID = parseInt(itemID, 10);
      if (!targetItemID) {
        req.flash('error', 'Please select an item to install.');
        return res.redirect(`/sites/${siteID}#equipment`);
      }
    }

    await siteInventoryModel.installItem(
      siteID,
      targetItemID,
      {
        installedAt:          new Date(),
        installedByUserID:    req.user?.UserID,
        installNotes:         installNotes || null,
        pulledFromLocationID,
        pulledFromUserID,
        quantity:             quantity ? parseInt(quantity, 10) : 1,
      },
      req.auditContext
    );

    req.flash('success', 'Item installed successfully.');
    res.redirect(`/sites/${siteID}#equipment`);
  } catch (err) {
    if (err.number === 2627 || err.message?.includes('UNIQUE')) {
      req.flash('error', 'An item with that serial number already exists.');
      return res.redirect(`/sites/${req.params.id}#equipment`);
    }
    next(err);
  }
});

// ── POST /:id/inventory/:siID/remove ─────────────────────────────────────────
router.post('/:id/inventory/:siID/remove', isAdmin, async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.id, 10);
    const siID   = parseInt(req.params.siID, 10);
    await siteInventoryModel.removeItem(siID, { removedByUserID: req.user?.UserID }, req.auditContext);
    req.flash('success', 'Item removed from site.');
    res.redirect(`/sites/${siteID}#equipment`);
  } catch (err) { next(err); }
});

module.exports = router;
