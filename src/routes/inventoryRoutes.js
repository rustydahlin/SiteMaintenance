'use strict';

const express            = require('express');
const router             = express.Router();
const inventoryModel     = require('../models/inventoryModel');
const lookupModel        = require('../models/lookupModel');
const documentModel      = require('../models/documentModel');
const siteInventoryModel = require('../models/siteInventoryModel');
const siteModel          = require('../models/siteModel');
const userModel          = require('../models/userModel');
const repairModel        = require('../models/repairModel');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

// All routes require authentication
router.use(isAuthenticated);

// ── GET / — list inventory ────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { categoryID, statusID, search, locationID, page = 1, sort = 'commonName', dir = 'asc' } = req.query;

    const [result, categories, statuses, locations] = await Promise.all([
      inventoryModel.getAll({ categoryID, statusID, search, locationID, page: parseInt(page, 10), sort, dir }),
      lookupModel.getInventoryCategories(),
      lookupModel.getInventoryStatuses(),
      lookupModel.getStockLocations(),
    ]);

    const queryParts = [];
    if (categoryID) queryParts.push(`categoryID=${encodeURIComponent(categoryID)}`);
    if (statusID)   queryParts.push(`statusID=${encodeURIComponent(statusID)}`);
    if (search)     queryParts.push(`search=${encodeURIComponent(search)}`);
    if (locationID) queryParts.push(`locationID=${encodeURIComponent(locationID)}`);
    if (sort && sort !== 'commonName') queryParts.push(`sort=${encodeURIComponent(sort)}`);
    if (dir  && dir  !== 'asc')        queryParts.push(`dir=${encodeURIComponent(dir)}`);

    res.render('inventory/index', {
      title:      'Inventory',
      items:      result.rows,
      categories,
      statuses,
      locations,
      filters:    { categoryID, statusID, search, locationID },
      sort,
      dir,
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
    const [categories, statuses, locations, systems] = await Promise.all([
      lookupModel.getInventoryCategories(),
      lookupModel.getInventoryStatuses(),
      lookupModel.getStockLocations(),
      inventoryModel.getSystemsList(),
    ]);
    res.render('inventory/form', {
      title:          'Add Inventory Item',
      item:           null,
      action:         '/inventory',
      categories,
      statuses,
      locations,
      systems,
      presetSystemID: req.query.relatedSystemID ? parseInt(req.query.relatedSystemID, 10) : null,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST / — create item ──────────────────────────────────────────────────────
router.post('/', isAdmin, async (req, res, next) => {
  try {
    const { trackingType, serialNumber, categoryID, statusID } = req.body;
    const isBulk = trackingType === 'bulk';

    if (!req.body.commonName || !req.body.commonName.trim()) {
      req.flash('error', 'Common Name is required.');
      return res.redirect('/inventory/new');
    }
    if (!categoryID) {
      req.flash('error', 'Category is required.');
      return res.redirect('/inventory/new');
    }
    if (!statusID) {
      req.flash('error', 'Status is required.');
      return res.redirect('/inventory/new');
    }

    const item = await inventoryModel.create({
      trackingType:    isBulk ? 'bulk' : 'serialized',
      serialNumber:    isBulk ? null : serialNumber.trim(),
      assetTag:        isBulk ? null : (req.body.assetTag || null),
      commonName:      req.body.commonName      || null,
      partNumber:      req.body.partNumber      || null,
      modelNumber:     req.body.modelNumber     || null,
      manufacturer:    req.body.manufacturer    || null,
      categoryID:      categoryID,
      statusID:        statusID,
      stockLocationID: isBulk ? null : (req.body.stockLocationID || null),
      quantityTotal:   isBulk ? (parseInt(req.body.quantityTotal, 10) || 1) : 1,
      relatedSystemID: req.body.relatedSystemID || null,
      description:     req.body.description     || null,
      purchaseDate:    req.body.purchaseDate     || null,
      warrantyExpires: req.body.warrantyExpires  || null,
      notes:           req.body.notes           || null,
    }, req.auditContext);

    req.flash('success', `Item "${item.ModelNumber || item.SerialNumber || item.ItemID}" added successfully.`);
    res.redirect(`/inventory/${item.ItemID}`);
  } catch (err) {
    next(err);
  }
});

// ── GET /:id — item detail ────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const itemID = parseInt(req.params.id, 10);

    const [item, possessionHistory, documents, siteHistory, repairResult,
           stockLocations, allUsers, sites, relatedParts] = await Promise.all([
      inventoryModel.getByID(itemID),
      inventoryModel.getPossessionHistory(itemID),
      documentModel.getByItem(itemID),
      siteInventoryModel.getItemHistory(itemID),
      repairModel.getAll({ itemID }),
      lookupModel.getStockLocations(),
      userModel.getAll(),
      siteModel.getSimpleList(),
      inventoryModel.getRelatedParts(itemID),
    ]);

    if (!item) {
      req.flash('error', 'Inventory item not found.');
      return res.redirect('/inventory');
    }

    const stockDistribution = item.TrackingType === 'bulk'
      ? await inventoryModel.getStock(itemID)
      : [];

    const isAdminUser = req.user && req.user.roles && req.user.roles.includes('Admin');
    const canWriteFlag = req.user && req.user.roles &&
      (req.user.roles.includes('Admin') || req.user.roles.includes('Technician') || req.user.roles.includes('Contractor'));

    res.render('inventory/detail', {
      title:          item.CommonName || (item.TrackingType === 'bulk' ? (item.ModelNumber || 'Bulk Item') : item.SerialNumber),
      item,
      possessionHistory,
      siteHistory,
      documents,
      stockDistribution,
      stockLocations,
      allUsers,
      sites,
      repairs: repairResult.rows,
      relatedParts,
      isAdminUser,
      canWrite:        canWriteFlag,
      uploadUrl:       `/documents/upload`,
      canUpload:       canWriteFlag,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /:id/edit — edit form ─────────────────────────────────────────────────
router.get('/:id/edit', isAdmin, async (req, res, next) => {
  try {
    const itemID = parseInt(req.params.id, 10);
    const [item, categories, statuses, locations, systems] = await Promise.all([
      inventoryModel.getByID(itemID),
      lookupModel.getInventoryCategories(),
      lookupModel.getInventoryStatuses(),
      lookupModel.getStockLocations(),
      inventoryModel.getSystemsList(itemID),
    ]);

    if (!item) {
      req.flash('error', 'Inventory item not found.');
      return res.redirect('/inventory');
    }

    res.render('inventory/form', {
      title:      `Edit — ${item.SerialNumber || item.CommonName || item.ModelNumber}`,
      item,
      action:     `/inventory/${itemID}`,
      categories,
      statuses,
      locations,
      systems,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /:id — update item ───────────────────────────────────────────────────
router.post('/:id', isAdmin, async (req, res, next) => {
  try {
    const itemID = parseInt(req.params.id, 10);
    const existing = await inventoryModel.getByID(itemID);
    const isBulk = existing && existing.TrackingType === 'bulk';
    const { serialNumber, categoryID, statusID } = req.body;

    if (!req.body.commonName || !req.body.commonName.trim()) {
      req.flash('error', 'Common Name is required.');
      return res.redirect(`/inventory/${itemID}/edit`);
    }

    const item = await inventoryModel.update(itemID, {
      serialNumber:    isBulk ? null : (serialNumber?.trim() || null),
      assetTag:        isBulk ? null : (req.body.assetTag || null),
      commonName:      req.body.commonName      || null,
      partNumber:      req.body.partNumber      || null,
      modelNumber:     req.body.modelNumber     || null,
      manufacturer:    req.body.manufacturer    || null,
      categoryID:      categoryID               || null,
      statusID:        statusID                 || null,
      stockLocationID: isBulk ? null : (req.body.stockLocationID || null),
      quantityTotal:   isBulk ? (parseInt(req.body.quantityTotal, 10) || 1) : 1,
      relatedSystemID: req.body.relatedSystemID || null,
      description:     req.body.description     || null,
      purchaseDate:    req.body.purchaseDate     || null,
      warrantyExpires: req.body.warrantyExpires  || null,
      notes:           req.body.notes           || null,
    }, req.auditContext);

    req.flash('success', `Item "${item.ModelNumber || item.SerialNumber || item.ItemID}" updated successfully.`);
    res.redirect(`/inventory/${itemID}`);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/delete — soft delete ────────────────────────────────────────────
router.post('/:id/delete', isAdmin, async (req, res, next) => {
  try {
    const itemID = parseInt(req.params.id, 10);
    const item = await inventoryModel.getByID(itemID);
    if (!item) {
      req.flash('error', 'Inventory item not found.');
      return res.redirect('/inventory');
    }

    await inventoryModel.softDelete(itemID, req.auditContext);
    req.flash('success', `Item "${item.SerialNumber}" has been removed.`);
    res.redirect('/inventory');
  } catch (err) {
    next(err);
  }
});

// ── GET /:id/checkout — checkout form ─────────────────────────────────────────
router.get('/:id/checkout', isAdmin, async (req, res, next) => {
  try {
    const itemID = parseInt(req.params.id, 10);
    const [item, users, locations] = await Promise.all([
      inventoryModel.getByID(itemID),
      userModel.getAll(),
      lookupModel.getStockLocations(),
    ]);

    if (!item) {
      req.flash('error', 'Inventory item not found.');
      return res.redirect('/inventory');
    }

    res.render('inventory/checkout', {
      title:     `Check Out — ${item.SerialNumber}`,
      item,
      users,
      locations,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/checkout — check out to user ────────────────────────────────────
router.post('/:id/checkout', isAdmin, async (req, res, next) => {
  try {
    const itemID = parseInt(req.params.id, 10);
    const { userID, checkoutDate, notes } = req.body;

    if (!userID) {
      req.flash('error', 'A user must be selected for checkout.');
      return res.redirect(`/inventory/${itemID}/checkout`);
    }

    await inventoryModel.checkOut(
      itemID,
      parseInt(userID, 10),
      req.body.pulledFromLocationID ? parseInt(req.body.pulledFromLocationID, 10) : null,
      notes || null,
      req.auditContext,
    );

    req.flash('success', 'Item checked out successfully.');
    res.redirect(`/inventory/${itemID}`);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/checkin — check in item ────────────────────────────────────────
router.post('/:id/checkin', isAdmin, async (req, res, next) => {
  try {
    const itemID = parseInt(req.params.id, 10);
    const { stockLocationID, notes } = req.body;

    await inventoryModel.checkIn(
      itemID,
      stockLocationID ? parseInt(stockLocationID, 10) : null,
      notes || null,
      req.auditContext,
    );

    req.flash('success', 'Item checked in successfully.');
    res.redirect(`/inventory/${itemID}`);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/deploy — deploy item to a site (replaces old checkout-to-user) ──
router.post('/:id/deploy', isAdmin, async (req, res, next) => {
  try {
    const itemID  = parseInt(req.params.id, 10);
    const siteID  = parseInt(req.body.siteID, 10);
    const quantity = parseInt(req.body.quantity, 10) || 1;
    const { pulledFrom, installNotes } = req.body;

    if (!siteID) {
      req.flash('error', 'Please select a site.');
      return res.redirect(`/inventory/${itemID}`);
    }

    let pulledFromLocationID = null;
    let pulledFromUserID     = null;
    if (pulledFrom && pulledFrom.startsWith('location:')) {
      pulledFromLocationID = parseInt(pulledFrom.split(':')[1], 10) || null;
    } else if (pulledFrom && pulledFrom.startsWith('user:')) {
      pulledFromUserID = parseInt(pulledFrom.split(':')[1], 10) || null;
    }

    await siteInventoryModel.installItem(
      siteID,
      itemID,
      {
        installedAt:          new Date(),
        installedByUserID:    req.user?.UserID,
        installNotes:         installNotes || null,
        pulledFromLocationID,
        pulledFromUserID,
        quantity,
      },
      req.auditContext,
    );

    req.flash('success', 'Item deployed to site successfully.');
    res.redirect(`/inventory/${itemID}`);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/stock — upsert a stock distribution row (bulk items only) ───────
router.post('/:id/stock', isAdmin, async (req, res, next) => {
  try {
    const itemID = parseInt(req.params.id, 10);
    const { holderType, locationID, userID, quantity, notes } = req.body;
    await inventoryModel.upsertStock(itemID, {
      locationID: holderType === 'location' ? locationID : null,
      userID:     holderType === 'user'     ? userID     : null,
      quantity, notes,
    });
    req.flash('success', 'Stock distribution updated.');
    res.redirect(`/inventory/${itemID}#overview`);
  } catch (err) {
    if (err.userMessage) {
      req.flash('error', err.userMessage);
      return res.redirect(`/inventory/${req.params.id}#overview`);
    }
    next(err);
  }
});

// ── POST /:id/stock/:stockId/delete — remove a stock row ─────────────────────
router.post('/:id/stock/:stockId/delete', isAdmin, async (req, res, next) => {
  try {
    const itemID  = parseInt(req.params.id, 10);
    await inventoryModel.removeStock(parseInt(req.params.stockId, 10));
    req.flash('success', 'Stock entry removed.');
    res.redirect(`/inventory/${itemID}#overview`);
  } catch (err) { next(err); }
});

module.exports = router;
