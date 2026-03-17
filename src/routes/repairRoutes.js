'use strict';

const express        = require('express');
const router         = express.Router();
const repairModel    = require('../models/repairModel');
const inventoryModel = require('../models/inventoryModel');
const lookupModel    = require('../models/lookupModel');
const userModel      = require('../models/userModel');
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
      users,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST / — create repair ────────────────────────────────────────────────────
router.post('/', isAdmin, async (req, res, next) => {
  try {
    const { itemID, sentDate, reason } = req.body;

    if (!itemID) {
      req.flash('error', 'An inventory item must be selected.');
      return res.redirect('/repairs/new');
    }
    if (!sentDate) {
      req.flash('error', 'Sent Date is required.');
      return res.redirect('/repairs/new');
    }
    if (!reason || !reason.trim()) {
      req.flash('error', 'Reason is required.');
      return res.redirect('/repairs/new');
    }

    const repair = await repairModel.create({
      itemID,
      sentDate,
      rmaNumber:            req.body.rmaNumber            || null,
      manufacturerContact:  req.body.manufacturerContact  || null,
      reason:               reason.trim(),
      expectedReturnDate:   req.body.expectedReturnDate   || null,
      followUpDate:         req.body.followUpDate         || null,
      sentByUserID:         req.body.sentByUserID         || null,
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

    res.render('repairs/detail', {
      title:      `Repair — ${repair.SerialNumber}`,
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

    res.render('repairs/form', {
      title:         `Edit Repair — ${repair.SerialNumber}`,
      repair,
      prefilledItem: { ItemID: repair.ItemID, SerialNumber: repair.SerialNumber },
      action:        `/repairs/${repairID}`,
      users,
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
      followUpDate:        req.body.followUpDate        || null,
      sentByUserID:        req.body.sentByUserID        || null,
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

    await repairModel.markReceived(repairID, {
      receivedDate,
      returnCondition:  returnCondition  || null,
      returnNotes:      returnNotes      || null,
      stockLocationID:  stockLocationID  || null,
    }, req.auditContext);

    req.flash('success', 'Item marked as received.');
    res.redirect(`/repairs/${repairID}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
