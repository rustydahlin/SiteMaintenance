'use strict';

const express            = require('express');
const router             = express.Router();
const siteModel             = require('../models/siteModel');
const siteInventoryModel    = require('../models/siteInventoryModel');
const networkResourceModel  = require('../models/networkResourceModel');
const repairModel           = require('../models/repairModel');
const maintenanceModel      = require('../models/maintenanceModel');
const inventoryModel        = require('../models/inventoryModel');
const { getPool, sql }    = require('../config/database');
const lookupModel           = require('../models/lookupModel');
const userModel             = require('../models/userModel');
const vendorModel           = require('../models/vendorModel');
const pmModel               = require('../models/pmModel');
const logModel              = require('../models/logModel');
const { isAuthenticated, isAdmin, canManageNetworkMap } = require('../middleware/auth');

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
    const uid   = req.user.UserID;

    const myPMsPromise = (async () => {
      const pool = await getPool();
      const r = await pool.request()
        .input('UserID', sql.Int, uid)
        .query(`
          SELECT pm.ScheduleID, pm.SiteID, pm.Title, pm.FrequencyDays,
                 pm.LastPerformedAt, pm.AssignedUserID, pm.AssignedVendorID,
                 s.SiteName,
                 u.DisplayName AS AssignedUserName,
                 v.VendorName  AS AssignedVendorName,
                 DATEADD(day, pm.FrequencyDays, ISNULL(pm.LastPerformedAt, GETUTCDATE())) AS NextDueDate,
                 DATEDIFF(day, GETUTCDATE(),
                   DATEADD(day, pm.FrequencyDays, ISNULL(pm.LastPerformedAt, GETUTCDATE()))) AS DaysUntilDue
          FROM PMSchedules pm
          LEFT JOIN Sites   s ON s.SiteID   = pm.SiteID
          LEFT JOIN Users   u ON u.UserID   = pm.AssignedUserID
          LEFT JOIN Vendors v ON v.VendorID = pm.AssignedVendorID
          WHERE pm.AssignedUserID = @UserID
            AND DATEDIFF(day, GETUTCDATE(),
                  DATEADD(day, pm.FrequencyDays, ISNULL(pm.LastPerformedAt, GETUTCDATE()))) <= 60
          ORDER BY NextDueDate
        `);
      return r.recordset;
    })();

    const [sitesResult, repairsResult, maintenanceResult, myRepairsResult, myMaintenanceResult, myPMs] = await Promise.all([
      siteModel.getAll({ page: 1, pageSize: 1 }),
      repairModel.getAll({ status: 'open', page: 1, pageSize: 1 }),
      maintenanceModel.getAll({ open: true, page: 1, pageSize: 200 }),
      repairModel.getAll({ status: 'open', assignedUserID: uid, page: 1, pageSize: 50 }),
      maintenanceModel.getAll({ open: true, assignedToUserID: uid, page: 1, pageSize: 200 }),
      myPMsPromise,
    ]);

    const siteCount    = sitesResult.total;
    const openRepairs  = repairsResult.total;
    const allOpen      = maintenanceResult.rows;
    const overdueCount = allOpen.filter(m => m.DueDate && new Date(m.DueDate) < today).length;
    const dueCount     = allOpen.filter(m => m.DueDate && new Date(m.DueDate) >= today).length;

    const myRepairs     = myRepairsResult.rows;
    const myMaintenance = myMaintenanceResult.rows;
    const myOverdue     = myMaintenance.filter(m => m.DueDate && new Date(m.DueDate) < today);

    res.render('mobile/dashboard', {
      title: 'Dashboard',
      siteCount,
      openRepairs,
      overdueCount,
      dueCount,
      myRepairs,
      myMaintenance,
      myOverdue,
      myPMs,
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
    const [site, inventory, subsites, networkResources, pmSchedules] = await Promise.all([
      siteModel.getByID(siteID),
      siteInventoryModel.getCurrentItems(siteID),
      siteModel.getSubsites(siteID),
      networkResourceModel.getBySite(siteID),
      pmModel.getBySite(siteID),
    ]);

    if (!site) return res.status(404).render('errors/404', { title: 'Not Found' });

    res.render('mobile/site-detail', {
      title: site.SiteName,
      site,
      inventory,
      subsites,
      networkResources,
      pmSchedules,
    });
  } catch (err) {
    next(err);
  }
});

// ── Site: complete PM schedule from site view ──────────────────────────────────
router.post('/sites/:id/pm/:scheduleID/complete', async (req, res, next) => {
  try {
    const siteID     = parseInt(req.params.id, 10);
    const scheduleID = parseInt(req.params.scheduleID, 10);
    const { performedDate } = req.body;

    const date = performedDate ? new Date(performedDate) : new Date();
    await pmModel.markCompleted(scheduleID, date, req.auditContext);

    // Create log entry matching desktop behaviour
    const logTypeID = (await lookupModel.getLogTypeByName('Preventive Maintenance'))?.LogTypeID;
    if (logTypeID) {
      const schedule = await pmModel.getByID(scheduleID);
      await logModel.create({
        siteID, logTypeID,
        entryDate:         date,
        subject:           `PM Completed: ${schedule.Title}`,
        performedByUserID: req.user.UserID,
        performedBy:       req.user.DisplayName,
        createdByUserID:   req.user.UserID,
      }, req.auditContext);
    }

    req.flash('success', 'PM marked complete.');
    res.redirect(`/mobile/sites/${siteID}`);
  } catch (err) { next(err); }
});

// ── Repairs list ──────────────────────────────────────────────────────────────
router.get('/repairs', async (req, res, next) => {
  try {
    const { filter = 'inprogress', scope = 'mine' } = req.query;
    let statusParam;
    if (filter === 'unsent')                     statusParam = 'notsent';
    else if (filter === 'closed')                statusParam = 'closed';
    else if (filter === 'overdue' || filter === 'inprogress') statusParam = 'open';
    // 'all' → statusParam stays undefined

    const opts = { status: statusParam, page: 1, pageSize: 100, sort: 'sentDate', dir: 'desc' };
    if (scope === 'mine') opts.assignedUserID = req.user.UserID;
    const result = await repairModel.getAll(opts);

    let repairs = result.rows;
    const now = new Date();
    if (filter === 'overdue') {
      repairs = repairs.filter(r => r.SentDate && r.ExpectedReturnDate && new Date(r.ExpectedReturnDate) < now);
    } else if (filter === 'inprogress') {
      repairs = repairs.filter(r => r.SentDate && (!r.ExpectedReturnDate || new Date(r.ExpectedReturnDate) >= now));
    }

    res.render('mobile/repairs', {
      title: 'Repairs',
      repairs,
      filter,
      scope,
    });
  } catch (err) {
    next(err);
  }
});

// ── Repair detail ─────────────────────────────────────────────────────────────
router.get('/repairs/:id', async (req, res, next) => {
  try {
    const repairID = parseInt(req.params.id, 10);
    const repair = await repairModel.getByID(repairID);
    if (!repair) return res.status(404).render('errors/404', { title: 'Not Found' });

    res.render('mobile/repair-detail', {
      title: `Repair #${repairID}`,
      repair,
    });
  } catch (err) { next(err); }
});

// ── Repair edit form ──────────────────────────────────────────────────────────
router.get('/repairs/:id/edit', async (req, res, next) => {
  try {
    const repairID = parseInt(req.params.id, 10);
    const [repair, users] = await Promise.all([
      repairModel.getByID(repairID),
      userModel.getAll(),
    ]);
    if (!repair) return res.status(404).render('errors/404', { title: 'Not Found' });

    res.render('mobile/repair-edit', {
      title: `Edit Repair #${repairID}`,
      repair,
      users,
    });
  } catch (err) { next(err); }
});

// ── Repair update ─────────────────────────────────────────────────────────────
router.post('/repairs/:id/edit', async (req, res, next) => {
  try {
    const repairID = parseInt(req.params.id, 10);
    const repair   = await repairModel.getByID(repairID);
    if (!repair) return res.status(404).render('errors/404', { title: 'Not Found' });

    const { rmaNumber, manufacturerContact, reason, expectedReturnDate, sentDate, assignedUserID } = req.body;
    await repairModel.update(repairID, {
      itemID:              repair.ItemID,
      siteInventoryID:     repair.SiteInventoryID     || null,
      sentDate:            sentDate            || null,
      rmaNumber:           rmaNumber           || null,
      manufacturerContact: manufacturerContact || null,
      reason:              reason              || null,
      expectedReturnDate:  expectedReturnDate  || null,
      sentByUserID:        repair.SentByUserID || null,
      assignedUserID:      assignedUserID      ? parseInt(assignedUserID, 10) : null,
    }, req.auditContext);

    req.flash('success', 'Repair updated.');
    res.redirect(`/mobile/repairs/${repairID}`);
  } catch (err) { next(err); }
});

// ── Repair mark received form ─────────────────────────────────────────────────
router.get('/repairs/:id/receive', async (req, res, next) => {
  try {
    const repairID = parseInt(req.params.id, 10);
    const repair = await repairModel.getByID(repairID);
    if (!repair) return res.status(404).render('errors/404', { title: 'Not Found' });

    res.render('mobile/repair-receive', {
      title: `Receive Repair #${repairID}`,
      repair,
    });
  } catch (err) { next(err); }
});

// ── Repair mark received submit ───────────────────────────────────────────────
router.post('/repairs/:id/receive', async (req, res, next) => {
  try {
    const repairID = parseInt(req.params.id, 10);
    const { receivedDate, returnCondition, returnNotes } = req.body;

    await repairModel.markReceived(repairID, {
      receivedDate:     receivedDate     || null,
      returnCondition:  returnCondition  || null,
      returnNotes:      returnNotes      || null,
      receivedByUserID: req.user.UserID,
    }, req.auditContext);

    req.flash('success', 'Repair marked as received.');
    res.redirect(`/mobile/repairs/${repairID}`);
  } catch (err) { next(err); }
});

// ── Maintenance list ──────────────────────────────────────────────────────────
router.get('/maintenance', async (req, res, next) => {
  try {
    const { filter = 'overdue', scope = 'mine' } = req.query;
    const opts = { page: 1, pageSize: 100, sort: 'dueDate', dir: 'asc' };

    if (filter === 'overdue')   { opts.open = true; opts.overdueOnly = true; }
    else if (filter === 'open') { opts.open = true; }
    // 'all' — no filter

    if (scope === 'mine') opts.assignedToUserID = req.user.UserID;

    const result = await maintenanceModel.getAll(opts);

    res.render('mobile/maintenance', {
      title: 'Maintenance',
      items: result.rows,
      filter,
      scope,
    });
  } catch (err) {
    next(err);
  }
});

// ── Maintenance detail ────────────────────────────────────────────────────────
router.get('/maintenance/:id', async (req, res, next) => {
  try {
    const maintenanceID = parseInt(req.params.id, 10);
    const item = await maintenanceModel.getByID(maintenanceID);
    if (!item) return res.status(404).render('errors/404', { title: 'Not Found' });

    res.render('mobile/maintenance-detail', {
      title: `Maintenance #${maintenanceID}`,
      item,
    });
  } catch (err) { next(err); }
});

// ── Maintenance edit form ─────────────────────────────────────────────────────
router.get('/maintenance/:id/edit', async (req, res, next) => {
  try {
    const maintenanceID = parseInt(req.params.id, 10);
    const [item, users, maintenanceTypes, sites] = await Promise.all([
      maintenanceModel.getByID(maintenanceID),
      userModel.getAll(),
      lookupModel.getMaintenanceTypes(),
      siteModel.getAll({ page: 1, pageSize: 500 }),
    ]);
    if (!item) return res.status(404).render('errors/404', { title: 'Not Found' });

    res.render('mobile/maintenance-edit', {
      title: `Edit Maintenance #${maintenanceID}`,
      item,
      users,
      maintenanceTypes,
      sites: sites.rows,
    });
  } catch (err) { next(err); }
});

// ── Maintenance update ────────────────────────────────────────────────────────
router.post('/maintenance/:id/edit', async (req, res, next) => {
  try {
    const maintenanceID = parseInt(req.params.id, 10);
    const item = await maintenanceModel.getByID(maintenanceID);
    if (!item) return res.status(404).render('errors/404', { title: 'Not Found' });

    const { siteID, assignedToUserID, maintenanceTypeID, dueDate, externalReference, workToComplete } = req.body;
    await maintenanceModel.update(maintenanceID, {
      siteID:            siteID            ? parseInt(siteID, 10)            : item.SiteID,
      assignedToUserID:  assignedToUserID  ? parseInt(assignedToUserID, 10)  : null,
      maintenanceTypeID: maintenanceTypeID ? parseInt(maintenanceTypeID, 10) : null,
      dueDate:           dueDate           || null,
      externalReference: externalReference || null,
      workToComplete:    workToComplete    || null,
    }, req.auditContext);

    req.flash('success', 'Maintenance item updated.');
    res.redirect(`/mobile/maintenance/${maintenanceID}`);
  } catch (err) { next(err); }
});

// ── Maintenance close ─────────────────────────────────────────────────────────
router.post('/maintenance/:id/close', async (req, res, next) => {
  try {
    const maintenanceID = parseInt(req.params.id, 10);
    const { closureNotes } = req.body;

    await maintenanceModel.close(maintenanceID, closureNotes || null, req.auditContext);

    req.flash('success', 'Maintenance item closed.');
    res.redirect(`/mobile/maintenance/${maintenanceID}`);
  } catch (err) { next(err); }
});

// ── Inventory list ────────────────────────────────────────────────────────────
router.get('/inventory', async (req, res, next) => {
  try {
    const { q = '' } = req.query;
    const result = await inventoryModel.getAll({
      search: q.trim() || undefined,
      page: 1,
      pageSize: 500,
    });

    // Split bulk (shown individually) from serialized (grouped by display name)
    const bulkItems = [];
    const serializedMap = new Map(); // key → { name, manufacturer, modelNumber, category, statuses, count }

    for (const item of result.rows) {
      if (item.TrackingType === 'bulk') {
        bulkItems.push(item);
      } else {
        const key = item.CommonName || item.ModelNumber || item.SerialNumber || 'Unknown';
        if (!serializedMap.has(key)) {
          serializedMap.set(key, {
            name:         key,
            manufacturer: item.Manufacturer,
            modelNumber:  item.ModelNumber,
            category:     item.CategoryName,
            statuses:     {},
            count:        0,
          });
        }
        const group = serializedMap.get(key);
        group.count++;
        if (item.StatusName) group.statuses[item.StatusName] = (group.statuses[item.StatusName] || 0) + 1;
      }
    }

    const serializedGroups = [...serializedMap.values()];

    res.render('mobile/inventory', {
      title: 'Inventory',
      bulkItems,
      serializedGroups,
      total: result.total,
      q,
    });
  } catch (err) {
    next(err);
  }
});

// ── Inventory: serialized group detail ───────────────────────────────────────
router.get('/inventory/serialized', async (req, res, next) => {
  try {
    const { name = '' } = req.query;
    if (!name.trim()) return res.redirect('/mobile/inventory');

    const result = await inventoryModel.getAll({ search: name, page: 1, pageSize: 200 });
    // Filter to exact CommonName match (search is LIKE so may return broader results)
    const items = result.rows.filter(i =>
      i.TrackingType !== 'bulk' &&
      (i.CommonName || i.ModelNumber || i.SerialNumber || 'Unknown') === name
    );

    res.render('mobile/inventory-serialized-group', {
      title: name,
      name,
      items,
    });
  } catch (err) { next(err); }
});

// ── Inventory: item detail ────────────────────────────────────────────────────
router.get('/inventory/:itemID', async (req, res, next) => {
  try {
    const itemID = parseInt(req.params.itemID, 10);
    const item = await inventoryModel.getByID(itemID);
    if (!item) return res.status(404).render('errors/404', { title: 'Not Found' });

    let stock = [];
    let deployed = [];
    let unallocated = 0;

    if (item.TrackingType === 'bulk') {
      const [stockRows, deployedResult] = await Promise.all([
        inventoryModel.getStock(itemID),
        (async () => {
          const pool = await getPool();
          return pool.request()
            .input('ItemID', sql.Int, itemID)
            .query(`
              SELECT s.SiteID,
                     CASE WHEN s.ParentSiteID IS NOT NULL
                          THEN ps.SiteName + ' / ' + s.SiteName
                          ELSE s.SiteName END AS SiteName,
                     SUM(si.Quantity) AS Quantity
              FROM SiteInventory si
              JOIN Sites s  ON s.SiteID = si.SiteID
              LEFT JOIN Sites ps ON ps.SiteID = s.ParentSiteID
              WHERE si.ItemID = @ItemID AND si.RemovedAt IS NULL
              GROUP BY s.SiteID, s.SiteName, s.ParentSiteID, ps.SiteName
              ORDER BY SiteName
            `);
        })(),
      ]);

      stock = stockRows;
      deployed = deployedResult.recordset;
      const totalDeployed  = deployed.reduce((sum, r) => sum + r.Quantity, 0);
      const totalAllocated = stock.reduce((sum, r) => sum + r.Quantity, 0);
      unallocated = item.QuantityTotal - totalDeployed - totalAllocated;
    }

    res.render('mobile/inventory-detail', {
      title: item.CommonName || item.ModelNumber || item.SerialNumber || 'Item',
      item,
      stock,
      deployed,
      unallocated,
    });
  } catch (err) { next(err); }
});

// ── Inventory: bulk stock breakdown (JSON) ────────────────────────────────────
router.get('/inventory/:itemID/stock', isAdmin, async (req, res, next) => {
  try {
    const itemID = parseInt(req.params.itemID, 10);
    const [stockRows, itemRow] = await Promise.all([
      inventoryModel.getStock(itemID),
      (async () => {
        const pool = await getPool();
        const r = await pool.request()
          .input('ItemID', sql.Int, itemID)
          .query(`
            SELECT i.QuantityTotal,
              ISNULL((SELECT SUM(si.Quantity) FROM SiteInventory si
                      WHERE si.ItemID = i.ItemID AND si.RemovedAt IS NULL), 0) AS Deployed,
              ISNULL((SELECT SUM(s.Quantity) FROM InventoryStock s
                      WHERE s.ItemID = i.ItemID), 0) AS Allocated
            FROM Inventory i WHERE i.ItemID = @ItemID
          `);
        return r.recordset[0];
      })(),
    ]);

    const unallocated = (itemRow?.QuantityTotal || 0) - (itemRow?.Deployed || 0) - (itemRow?.Allocated || 0);

    const sources = [];
    if (unallocated > 0) {
      sources.push({ type: 'unallocated', label: 'Unallocated', qty: unallocated });
    }
    for (const row of stockRows) {
      sources.push({
        type:       row.LocationID ? 'location' : 'user',
        id:         row.LocationID || row.UserID,
        label:      row.LocationName || row.UserDisplayName,
        qty:        row.Quantity,
        locationID: row.LocationID || null,
        userID:     row.UserID     || null,
      });
    }

    res.json(sources);
  } catch (err) { next(err); }
});

// ── Inventory: install form ───────────────────────────────────────────────────
router.get('/sites/:id/inventory/install', isAdmin, async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.id, 10);
    const site   = await siteModel.getByID(siteID);
    if (!site) return res.status(404).render('errors/404', { title: 'Not Found' });

    const allInStock = await inventoryModel.getInStock();
    // For serialized items, exclude those already installed at this site
    const pool = await getPool();
    const installedResult = await pool.request()
      .input('SiteID', sql.Int, siteID)
      .query('SELECT DISTINCT ItemID FROM SiteInventory WHERE SiteID = @SiteID AND RemovedAt IS NULL');
    const installedIDs = new Set(installedResult.recordset.map(r => r.ItemID));
    const items = allInStock.filter(i => i.TrackingType === 'bulk' || !installedIDs.has(i.ItemID));

    res.render('mobile/site-inventory-install', {
      title: 'Install Equipment',
      siteID,
      siteName: site.SiteName,
      items,
    });
  } catch (err) { next(err); }
});

// ── Inventory: do install ─────────────────────────────────────────────────────
router.post('/sites/:id/inventory/install', isAdmin, async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.id, 10);
    const { itemID, installedAt, installNotes, quantity, pulledFromLocationID, pulledFromUserID } = req.body;

    if (!itemID) {
      req.flash('error', 'Please select an item.');
      return res.redirect(`/mobile/sites/${siteID}/inventory/install`);
    }

    await siteInventoryModel.installItem(siteID, parseInt(itemID, 10), {
      installedAt:          installedAt ? new Date(installedAt) : new Date(),
      installedByUserID:    req.user.UserID,
      installNotes:         installNotes         || null,
      quantity:             quantity             ? parseInt(quantity, 10)             : null,
      pulledFromLocationID: pulledFromLocationID ? parseInt(pulledFromLocationID, 10) : null,
      pulledFromUserID:     pulledFromUserID     ? parseInt(pulledFromUserID, 10)     : null,
    }, req.auditContext);

    req.flash('success', 'Item installed at site.');
    res.redirect(`/mobile/sites/${siteID}`);
  } catch (err) { next(err); }
});

// ── Inventory: swap form ──────────────────────────────────────────────────────
router.get('/sites/:id/inventory/:siID/swap', isAdmin, async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.id, 10);
    const siID   = parseInt(req.params.siID, 10);

    const pool = await getPool();
    const [site, siResult] = await Promise.all([
      siteModel.getByID(siteID),
      pool.request()
        .input('SiteInventoryID', sql.Int, siID)
        .query(`
          SELECT si.SiteInventoryID, si.ItemID, si.Quantity,
                 i.CommonName, i.ModelNumber, i.SerialNumber, i.TrackingType
          FROM SiteInventory si
          JOIN Inventory i ON i.ItemID = si.ItemID
          WHERE si.SiteInventoryID = @SiteInventoryID AND si.RemovedAt IS NULL
        `),
    ]);

    if (!site || !siResult.recordset.length) {
      return res.status(404).render('errors/404', { title: 'Not Found' });
    }

    const currentItem = siResult.recordset[0];

    // Available items — exclude the item being replaced (for serialized)
    const allInStock = await inventoryModel.getInStock();
    const items = allInStock.filter(i =>
      i.TrackingType === 'bulk' || i.ItemID !== currentItem.ItemID
    );

    res.render('mobile/site-inventory-swap', {
      title: 'Swap Equipment',
      siteID,
      siteName: site.SiteName,
      siID,
      currentItem,
      items,
    });
  } catch (err) { next(err); }
});

// ── Inventory: do swap ────────────────────────────────────────────────────────
router.post('/sites/:id/inventory/:siID/swap', isAdmin, async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.id, 10);
    const siID   = parseInt(req.params.siID, 10);
    const { itemID, installedAt, installNotes, quantity, pulledFromLocationID, pulledFromUserID,
            createRma, rmaNumber, rmaReason, manufacturerContact, expectedReturnDate } = req.body;

    if (!itemID) {
      req.flash('error', 'Please select a replacement item.');
      return res.redirect(`/mobile/sites/${siteID}/inventory/${siID}/swap`);
    }

    // Get the current item details for replacedItemID
    const pool = await getPool();
    const siResult = await pool.request()
      .input('SiteInventoryID', sql.Int, siID)
      .query('SELECT ItemID, Quantity FROM SiteInventory WHERE SiteInventoryID = @SiteInventoryID');

    if (!siResult.recordset.length) {
      req.flash('error', 'Item not found.');
      return res.redirect(`/mobile/sites/${siteID}`);
    }

    const { ItemID: replacedItemID, Quantity: replacedQty } = siResult.recordset[0];

    // Remove old item (skipLog — installItem will create the replacement log)
    await siteInventoryModel.removeItem(siID, {
      removedAt:       installedAt ? new Date(installedAt) : new Date(),
      removedByUserID: req.user.UserID,
      skipLog:         true,
    }, req.auditContext);

    // Install new item as replacement
    await siteInventoryModel.installItem(siteID, parseInt(itemID, 10), {
      installedAt:          installedAt ? new Date(installedAt) : new Date(),
      installedByUserID:    req.user.UserID,
      installNotes:         installNotes         || null,
      quantity:             quantity             ? parseInt(quantity, 10)             : replacedQty,
      pulledFromLocationID: pulledFromLocationID ? parseInt(pulledFromLocationID, 10) : null,
      pulledFromUserID:     pulledFromUserID     ? parseInt(pulledFromUserID, 10)     : null,
      isReplacement:        true,
      replacedItemID,
      replacedQty,
    }, req.auditContext);

    // Optionally create RMA for the removed item
    if (createRma === '1') {
      await repairModel.create({
        itemID:               replacedItemID,
        sentDate:             installedAt || null,
        rmaNumber:            rmaNumber            || null,
        reason:               rmaReason            || null,
        manufacturerContact:  manufacturerContact  || null,
        expectedReturnDate:   expectedReturnDate   || null,
        sentByUserID:         req.user.UserID,
        assignedUserID:       req.user.UserID,
      }, req.auditContext);
      req.flash('success', 'Equipment swapped and RMA created.');
    } else {
      req.flash('success', 'Equipment swapped successfully.');
    }

    res.redirect(`/mobile/sites/${siteID}`);
  } catch (err) { next(err); }
});

// ── Inventory: remove ─────────────────────────────────────────────────────────
router.post('/sites/:id/inventory/:siID/remove', isAdmin, async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.id, 10);
    const siID   = parseInt(req.params.siID, 10);
    const { removalNotes } = req.body;

    await siteInventoryModel.removeItem(siID, {
      removedAt:       new Date(),
      removedByUserID: req.user.UserID,
      removalNotes:    removalNotes || null,
    }, req.auditContext);

    req.flash('success', 'Item removed from site.');
    res.redirect(`/mobile/sites/${siteID}`);
  } catch (err) { next(err); }
});

// ── Network resources: add form ───────────────────────────────────────────────
router.get('/sites/:id/network-resources/new', canManageNetworkMap, async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.id, 10);
    const [site, deviceTypes, circuitTypes] = await Promise.all([
      siteModel.getByID(siteID),
      lookupModel.getNetworkDeviceTypes(),
      lookupModel.getCircuitTypes(),
    ]);
    if (!site) return res.status(404).render('errors/404', { title: 'Not Found' });

    res.render('mobile/site-network-resource-form', {
      title: 'Add Network Resource',
      siteID,
      siteName: site.SiteName,
      resource: null,
      deviceTypes,
      circuitTypes,
    });
  } catch (err) { next(err); }
});

// ── Network resources: create ─────────────────────────────────────────────────
router.post('/sites/:id/network-resources', canManageNetworkMap, async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.id, 10);
    const { hostname, ipAddress, deviceTypeID, alertStatus, solarwindsNodeId, circuitTypeID, circuitID, notes, sortOrder } = req.body;

    if (!hostname || !deviceTypeID) {
      req.flash('error', 'Hostname and device type are required.');
      return res.redirect(`/mobile/sites/${siteID}/network-resources/new`);
    }

    await networkResourceModel.create(siteID, {
      hostname,
      ipAddress:        ipAddress        || null,
      deviceTypeID:     parseInt(deviceTypeID, 10),
      alertStatus:      alertStatus === '1',
      solarwindsNodeId: solarwindsNodeId || null,
      circuitTypeID:    circuitTypeID    ? parseInt(circuitTypeID, 10) : null,
      circuitID:        circuitID        || null,
      notes:            notes            || null,
      sortOrder:        sortOrder        ? parseInt(sortOrder, 10) : 0,
    }, req.auditContext);

    req.flash('success', 'Network resource added.');
    res.redirect(`/mobile/sites/${siteID}`);
  } catch (err) { next(err); }
});

// ── Network resources: edit form ──────────────────────────────────────────────
router.get('/sites/:id/network-resources/:resID/edit', canManageNetworkMap, async (req, res, next) => {
  try {
    const siteID  = parseInt(req.params.id, 10);
    const resID   = parseInt(req.params.resID, 10);
    const [site, resource, deviceTypes, circuitTypes] = await Promise.all([
      siteModel.getByID(siteID),
      networkResourceModel.getByID(resID),
      lookupModel.getNetworkDeviceTypes(),
      lookupModel.getCircuitTypes(),
    ]);

    if (!site || !resource || resource.SiteID !== siteID) {
      return res.status(404).render('errors/404', { title: 'Not Found' });
    }

    res.render('mobile/site-network-resource-form', {
      title: 'Edit Network Resource',
      siteID,
      siteName: site.SiteName,
      resource,
      deviceTypes,
      circuitTypes,
    });
  } catch (err) { next(err); }
});

// ── Network resources: update ─────────────────────────────────────────────────
router.post('/sites/:id/network-resources/:resID', canManageNetworkMap, async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.id, 10);
    const resID  = parseInt(req.params.resID, 10);
    const { hostname, ipAddress, deviceTypeID, alertStatus, solarwindsNodeId, circuitTypeID, circuitID, notes, sortOrder } = req.body;

    if (!hostname || !deviceTypeID) {
      req.flash('error', 'Hostname and device type are required.');
      return res.redirect(`/mobile/sites/${siteID}/network-resources/${resID}/edit`);
    }

    await networkResourceModel.update(resID, {
      hostname,
      ipAddress:        ipAddress        || null,
      deviceTypeID:     parseInt(deviceTypeID, 10),
      alertStatus:      alertStatus === '1',
      solarwindsNodeId: solarwindsNodeId || null,
      circuitTypeID:    circuitTypeID    ? parseInt(circuitTypeID, 10) : null,
      circuitID:        circuitID        || null,
      notes:            notes            || null,
      sortOrder:        sortOrder        ? parseInt(sortOrder, 10) : 0,
    }, req.auditContext);

    req.flash('success', 'Network resource updated.');
    res.redirect(`/mobile/sites/${siteID}`);
  } catch (err) { next(err); }
});

// ── Network resources: delete ─────────────────────────────────────────────────
router.post('/sites/:id/network-resources/:resID/delete', canManageNetworkMap, async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.id, 10);
    const resID  = parseInt(req.params.resID, 10);

    await networkResourceModel.softDelete(resID, req.auditContext);

    req.flash('success', 'Network resource deleted.');
    res.redirect(`/mobile/sites/${siteID}`);
  } catch (err) { next(err); }
});

// ── Vendors list ──────────────────────────────────────────────────────────────
router.get('/vendors', async (req, res, next) => {
  try {
    const { q = '' } = req.query;
    const vendors = await vendorModel.getAll({ search: q.trim() || '' });

    res.render('mobile/vendors', {
      title: 'Vendors',
      vendors,
      q,
    });
  } catch (err) { next(err); }
});

// ── Vendor detail ─────────────────────────────────────────────────────────────
router.get('/vendors/:id', async (req, res, next) => {
  try {
    const vendorID = parseInt(req.params.id, 10);
    const vendor = await vendorModel.getByID(vendorID);
    if (!vendor) return res.status(404).render('errors/404', { title: 'Not Found' });

    res.render('mobile/vendor-detail', {
      title: vendor.VendorName,
      vendor,
    });
  } catch (err) { next(err); }
});

module.exports = router;
