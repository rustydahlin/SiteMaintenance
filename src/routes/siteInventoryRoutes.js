'use strict';

const express    = require('express');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const siteInventoryModel = require('../models/siteInventoryModel');
const inventoryModel     = require('../models/inventoryModel');
const lookupModel        = require('../models/lookupModel');
const router = express.Router();

router.use(isAuthenticated);

// POST /sites/:siteID/inventory/install
router.post('/sites/:siteID/inventory/install', isAdmin, async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.siteID);
    const { itemID, installedAt, installNotes, pulledFromLocationID } = req.body;

    if (!itemID) { req.flash('error', 'Please select an item to install.'); return res.redirect(`/sites/${siteID}?tab=inventory`); }

    await siteInventoryModel.installItem(siteID, parseInt(itemID), {
      installedAt:         installedAt ? new Date(installedAt) : new Date(),
      installedByUserID:   req.user.UserID,
      installNotes:        installNotes || null,
      pulledFromLocationID: pulledFromLocationID ? parseInt(pulledFromLocationID) : null,
    }, req.auditContext);

    req.flash('success', 'Item installed at site.');
    res.redirect(`/sites/${siteID}?tab=inventory`);
  } catch (err) { next(err); }
});

// POST /sites/:siteID/inventory/:siID/remove
router.post('/sites/:siteID/inventory/:siID/remove', isAdmin, async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.siteID);
    const siID   = parseInt(req.params.siID);
    const { removedAt, removalNotes } = req.body;

    await siteInventoryModel.removeItem(siID, {
      removedAt:       removedAt ? new Date(removedAt) : new Date(),
      removedByUserID: req.user.UserID,
      removalNotes:    removalNotes || null,
    }, req.auditContext);

    req.flash('success', 'Item removed from site.');
    res.redirect(`/sites/${siteID}?tab=inventory`);
  } catch (err) { next(err); }
});

// GET /sites/:siteID/inventory/available — JSON: items available to install (In-Stock or Checked-Out)
router.get('/sites/:siteID/inventory/available', isAdmin, async (req, res, next) => {
  try {
    const { getPool, sql } = require('../config/database');
    const pool = await getPool();
    const result = await pool.request()
      .input('SiteID', sql.Int, parseInt(req.params.siteID))
      .query(`
        SELECT i.ItemID, i.SerialNumber, i.ModelNumber, i.Manufacturer,
               c.CategoryName, s.StatusName
        FROM Inventory i
        JOIN InventoryCategories c  ON c.CategoryID = i.CategoryID
        JOIN InventoryStatuses   s  ON s.StatusID   = i.StatusID
        WHERE i.IsActive = 1
          AND s.StatusName IN ('In-Stock', 'Checked-Out')
          AND i.ItemID NOT IN (
            SELECT ItemID FROM SiteInventory
            WHERE SiteID = @SiteID AND RemovedAt IS NULL
          )
        ORDER BY i.SerialNumber
      `);
    res.json(result.recordset);
  } catch (err) { next(err); }
});

module.exports = router;
