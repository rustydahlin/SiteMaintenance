'use strict';

const express              = require('express');
const router               = express.Router();
const repairModel          = require('../models/repairModel');
const inventoryModel       = require('../models/inventoryModel');
const siteInventoryModel   = require('../models/siteInventoryModel');
const lookupModel          = require('../models/lookupModel');
const userModel            = require('../models/userModel');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

// All routes require authentication
router.use(isAuthenticated);

// ── GET / — list repairs ──────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { status = 'open', itemID, page = 1, sort = 'sentDate', dir = 'desc' } = req.query;

    const result = await repairModel.getAll({
      status,
      itemID: itemID ? parseInt(itemID, 10) : undefined,
      page: parseInt(page, 10),
      sort,
      dir,
    });

    const queryParts = [`status=${encodeURIComponent(status)}`];
    if (itemID) queryParts.push(`itemID=${encodeURIComponent(itemID)}`);
    if (sort && sort !== 'sentDate') queryParts.push(`sort=${encodeURIComponent(sort)}`);
    if (dir  && dir  !== 'desc')     queryParts.push(`dir=${encodeURIComponent(dir)}`);

    res.render('repairs/index', {
      title:   'Repairs & RMAs',
      repairs: result.rows,
      filters: { status },
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

// ── GET /inventory-search — JSON picker for serialized item lookup ─────────────
router.get('/inventory-search', isAdmin, async (req, res, next) => {
  try {
    const items = await inventoryModel.searchForPicker(
      req.query.q || '',
      { inStockOnly: req.query.inStock === '1' },
    );
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// ── GET /bulk-inventory-search — JSON picker for bulk items with available stock
router.get('/bulk-inventory-search', isAdmin, async (req, res, next) => {
  try {
    const items = await inventoryModel.searchBulkForPicker(req.query.q || '');
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// ── GET /new — create form ────────────────────────────────────────────────────
router.get('/new', isAdmin, async (req, res, next) => {
  try {
    const { itemID } = req.query;
    let prefilledItem = null;

    if (itemID) {
      prefilledItem = await inventoryModel.getByID(parseInt(itemID, 10));
    }

    const users = await userModel.getAll();

    res.render('repairs/form', {
      title:         'New Repair / RMA',
      repair:        null,
      prefilledItem,
      action:        '/repairs',
      isEdit:        false,
      users,
      currentUserID: req.user.UserID,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST / — create repair ────────────────────────────────────────────────────
router.post('/', isAdmin, async (req, res, next) => {
  try {
    const { itemID, sentDate, reason } = req.body;

    const errors = [];
    if (!itemID)                   errors.push('An inventory item must be selected.');
    if (!reason || !reason.trim()) errors.push('Reason is required.');

    if (errors.length) {
      const [prefilledItem, users] = await Promise.all([
        itemID ? inventoryModel.getByID(parseInt(itemID, 10)) : Promise.resolve(null),
        userModel.getAll(),
      ]);
      return res.render('repairs/form', {
        title:         'New Repair / RMA',
        formErrors:    errors,
        repair: {
          SentDate:            sentDate,
          RMANumber:           req.body.rmaNumber           || null,
          ManufacturerContact: req.body.manufacturerContact || null,
          Reason:              reason                       || null,
          ExpectedReturnDate:  req.body.expectedReturnDate  || null,
          SentByUserID:        req.body.sentByUserID        || null,
          AssignedUserID:      req.body.assignedUserID      || null,
        },
        prefilledItem,
        bulkStockLabel: req.body.bulkStockLabel || null,
        action:        '/repairs',
        isEdit:        false,
        users,
        currentUserID: req.user.UserID,
      });
    }

    // If the item is deployed to a site, remove it first
    const siteInventoryID = req.body.siteInventoryID ? parseInt(req.body.siteInventoryID, 10) : null;
    let removedSI = null;
    if (siteInventoryID) {
      removedSI = await siteInventoryModel.getByID(siteInventoryID);
      if (removedSI) {
        await siteInventoryModel.removeItem(siteInventoryID, {
          removedByUserID: req.user.UserID,
          removalNotes: 'Removed for repair/RMA',
        }, req.auditContext);

        // Install replacement at the same site if one was chosen
        const replacementItemID = req.body.replacementItemID ? parseInt(req.body.replacementItemID, 10) : null;
        if (replacementItemID) {
          await siteInventoryModel.installItem(
            removedSI.SiteID,
            replacementItemID,
            { installedAt: new Date(), installedByUserID: req.user.UserID },
            req.auditContext,
          );
        }
      }
    }

    // For bulk items: decrement QuantityTotal; also decrement the specific stock entry if one was chosen
    const bulkStockID  = req.body.bulkStockID ? parseInt(req.body.bulkStockID, 10) : null;
    const pickedItem   = await inventoryModel.getByID(parseInt(itemID, 10));
    if (pickedItem && pickedItem.TrackingType === 'bulk') {
      if (bulkStockID) {
        await inventoryModel.adjustStockByStockID(bulkStockID, -1);
      }
      await inventoryModel.adjustQuantityTotal(parseInt(itemID, 10), -1);
    }

    const repair = await repairModel.create({
      itemID,
      siteInventoryID: removedSI ? siteInventoryID : null,
      sentDate,
      rmaNumber:            req.body.rmaNumber            || null,
      manufacturerContact:  req.body.manufacturerContact  || null,
      reason:               reason.trim(),
      expectedReturnDate:   req.body.expectedReturnDate   || null,
      sentByUserID:         req.body.sentByUserID         || null,
      assignedUserID:       req.body.assignedUserID       || req.body.sentByUserID || req.user.UserID,
    }, req.auditContext);

    req.flash('success', 'Repair record created successfully.');
    res.redirect(`/repairs/${repair.RepairID}`);
  } catch (err) {
    next(err);
  }
});

// ── GET /:id — repair detail ──────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const repairID = parseInt(req.params.id, 10);
    const [repair, locations] = await Promise.all([
      repairModel.getByID(repairID),
      lookupModel.getStockLocations(),
    ]);

    if (!repair) {
      req.flash('error', 'Repair record not found.');
      return res.redirect('/repairs');
    }

    const isAdminUser = req.user && req.user.roles && req.user.roles.includes('Admin');

    const detailLabel = repair.SerialNumber || repair.CommonName || repair.ModelNumber || `Item #${repair.ItemID}`;
    res.render('repairs/detail', {
      title:      `Repair — ${detailLabel}`,
      repair,
      locations,
      isAdminUser,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /:id/edit — edit form ─────────────────────────────────────────────────
router.get('/:id/edit', isAdmin, async (req, res, next) => {
  try {
    const repairID = parseInt(req.params.id, 10);
    const [repair, users] = await Promise.all([
      repairModel.getByID(repairID),
      userModel.getAll(),
    ]);

    if (!repair) {
      req.flash('error', 'Repair record not found.');
      return res.redirect('/repairs');
    }

    const itemLabel = repair.SerialNumber || repair.CommonName || repair.ModelNumber || `Item #${repair.ItemID}`;
    res.render('repairs/form', {
      title:         `Edit Repair — ${itemLabel}`,
      repair,
      prefilledItem: {
        ItemID:       repair.ItemID,
        SerialNumber: repair.SerialNumber,
        CommonName:   repair.CommonName,
        ModelNumber:  repair.ModelNumber,
        TrackingType: repair.ItemTrackingType,
      },
      action:        `/repairs/${repairID}`,
      isEdit:        true,
      users,
      currentUserID: req.user.UserID,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /:id — update repair ─────────────────────────────────────────────────
router.post('/:id', isAdmin, async (req, res, next) => {
  try {
    const repairID = parseInt(req.params.id, 10);
    const { sentDate, reason } = req.body;

    if (!sentDate) {
      req.flash('error', 'Sent Date is required.');
      return res.redirect(`/repairs/${repairID}/edit`);
    }

    await repairModel.update(repairID, {
      itemID:              req.body.itemID              || null,
      sentDate,
      rmaNumber:           req.body.rmaNumber           || null,
      manufacturerContact: req.body.manufacturerContact || null,
      reason:              reason                       || null,
      expectedReturnDate:  req.body.expectedReturnDate  || null,
      sentByUserID:        req.body.sentByUserID        || null,
      assignedUserID:      req.body.assignedUserID      || null,
    }, req.auditContext);

    req.flash('success', 'Repair record updated successfully.');
    res.redirect(`/repairs/${repairID}`);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/receive — mark item received ────────────────────────────────────
router.post('/:id/receive', isAdmin, async (req, res, next) => {
  try {
    const repairID = parseInt(req.params.id, 10);
    const { receivedDate, returnCondition, returnNotes, stockLocationID } = req.body;

    if (!receivedDate) {
      req.flash('error', 'Received Date is required.');
      return res.redirect(`/repairs/${repairID}`);
    }

    const repair = await repairModel.getByID(repairID);

    await repairModel.markReceived(repairID, {
      receivedDate,
      returnCondition:  returnCondition  || null,
      returnNotes:      returnNotes      || null,
      stockLocationID:  stockLocationID  || null,
    }, req.auditContext);

    // For bulk items: restore QuantityTotal and credit the return location
    if (repair && repair.ItemTrackingType === 'bulk') {
      await inventoryModel.adjustQuantityTotal(repair.ItemID, +1);
      if (stockLocationID) {
        await inventoryModel.adjustStock(repair.ItemID, parseInt(stockLocationID, 10), null, +1);
      }
    }

    req.flash('success', 'Item marked as received.');
    res.redirect(`/repairs/${repairID}`);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/delete — delete repair record (Admin only) ──────────────────────
router.post('/:id/delete', isAdmin, async (req, res, next) => {
  try {
    const repairID = parseInt(req.params.id, 10);
    await repairModel.deleteRepair(repairID, req.auditContext);
    req.flash('success', 'Repair record deleted.');
    res.redirect('/repairs');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
