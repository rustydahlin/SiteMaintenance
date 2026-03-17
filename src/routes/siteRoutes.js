'use strict';

const express           = require('express');
const router            = express.Router();
const multer            = require('multer');
const XLSX              = require('xlsx');
const siteModel          = require('../models/siteModel');
const lookupModel        = require('../models/lookupModel');
const logModel           = require('../models/logModel');
const documentModel      = require('../models/documentModel');
const siteInventoryModel = require('../models/siteInventoryModel');
const inventoryModel     = require('../models/inventoryModel');
const pmModel            = require('../models/pmModel');
const repairModel        = require('../models/repairModel');
const userModel          = require('../models/userModel');
const { isAuthenticated, isAdmin, canWrite } = require('../middleware/auth');

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.(xlsx|xls)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Only .xlsx and .xls files are accepted'));
  },
});

// All routes require authentication
router.use(isAuthenticated);

// ── GET / — list sites ────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { typeID, statusID, search, pmDue, page = 1, sort = 'siteName', dir = 'asc' } = req.query;

    const [result, siteTypes, siteStatuses] = await Promise.all([
      siteModel.getAll({ typeID, statusID, search, pmDue, page: parseInt(page, 10), sort, dir }),
      lookupModel.getSiteTypes(),
      lookupModel.getSiteStatuses(),
    ]);

    const queryParts = [];
    if (typeID)   queryParts.push(`typeID=${encodeURIComponent(typeID)}`);
    if (statusID) queryParts.push(`statusID=${encodeURIComponent(statusID)}`);
    if (search)   queryParts.push(`search=${encodeURIComponent(search)}`);
    if (pmDue)    queryParts.push(`pmDue=${encodeURIComponent(pmDue)}`);
    if (sort && sort !== 'siteName') queryParts.push(`sort=${encodeURIComponent(sort)}`);
    if (dir  && dir  !== 'asc')     queryParts.push(`dir=${encodeURIComponent(dir)}`);

    res.render('sites/index', {
      title: 'Sites',
      sites: result.rows,
      siteTypes,
      siteStatuses,
      filters: { typeID, statusID, search, pmDue },
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

// ── GET /export — download all matching sites as Excel ───────────────────────
router.get('/export', async (req, res, next) => {
  try {
    const { typeID, statusID, search, pmDue, sort = 'siteName', dir = 'asc' } = req.query;
    const { rows } = await siteModel.getAll({ typeID, statusID, search, pmDue, page: 1, pageSize: 100000, sort, dir });

    const sheetData = rows.map(s => ({
      SiteNumber:      s.SiteNumber      || '',
      SiteName:        s.SiteName        || '',
      SiteType:        s.SiteTypeName    || '',
      Status:          s.SiteStatusName  || '',
      Address:         s.Address         || '',
      City:            s.City            || '',
      State:           s.State           || '',
      ZipCode:         s.ZipCode         || '',
      Latitude:        s.Latitude        != null ? s.Latitude  : '',
      Longitude:       s.Longitude       != null ? s.Longitude : '',
      WarrantyExpires: s.WarrantyExpires  ? new Date(s.WarrantyExpires).toISOString().split('T')[0]  : '',
      NextPMDate:      s.NextPMDate       ? new Date(s.NextPMDate).toISOString().split('T')[0]       : '',
      Description:     s.Description     || '',
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetData), 'Sites');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const date = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="sites-export-${date}.xlsx"`);
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

// ── GET /import/template — download blank Excel template ─────────────────────
router.get('/import/template', isAdmin, (_req, res) => {
  const wb = XLSX.utils.book_new();
  const headers = [
    'SiteName', 'SiteNumber', 'ContractNumber', 'SiteType', 'Status',
    'Address', 'City', 'State', 'ZipCode',
    'Latitude', 'Longitude', 'WarrantyExpires', 'Description',
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  // Set column widths
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length + 4, 16) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Sites');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="sites_import_template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ── GET /import — upload form ─────────────────────────────────────────────────
router.get('/import', isAdmin, (_req, res) => {
  res.render('sites/import', { title: 'Import Sites', results: null });
});

// ── POST /import — dry-run: parse file and show preview ───────────────────────
router.post('/import', isAdmin, importUpload.single('importFile'), async (req, res, next) => {
  try {
    if (!req.file) {
      req.flash('error', 'Please select a file to upload.');
      return res.redirect('/sites/import');
    }

    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (rows.length === 0) {
      req.flash('error', 'The file appears to be empty.');
      return res.redirect('/sites/import');
    }

    const [siteTypes, siteStatuses] = await Promise.all([
      lookupModel.getSiteTypes(),
      lookupModel.getSiteStatuses(),
    ]);
    const typeMap   = Object.fromEntries(siteTypes.map(t => [t.TypeName.toLowerCase(),   t.SiteTypeID]));
    const statusMap = Object.fromEntries(siteStatuses.map(s => [s.StatusName.toLowerCase(), s.SiteStatusID]));

    const plan    = [];
    const summary = { total: rows.length, created: 0, updated: 0, skipped: 0, errors: 0 };
    const norm    = v => (v == null || v === '') ? null : String(v).trim();
    const fmtDate = v => { if (!v) return null; const d = v instanceof Date ? v : new Date(v); return isNaN(d) ? null : d.toISOString().split('T')[0]; };

    for (let i = 0; i < rows.length; i++) {
      const row        = rows[i];
      const rowNum     = i + 2;
      const siteName   = (row['SiteName']   || '').toString().trim();
      const siteNumber = (row['SiteNumber'] || '').toString().trim() || null;

      if (!siteName) {
        summary.skipped++;
        plan.push({ action: 'skip', rowNum, display: { siteName: '', siteNumber }, message: 'SiteName is blank' });
        continue;
      }

      const siteTypeName = (row['SiteType'] || '').toString().trim();
      const statusName   = (row['Status']   || '').toString().trim();
      const siteTypeID   = siteTypeName ? (typeMap[siteTypeName.toLowerCase()]   || null) : null;
      const siteStatusID = statusName   ? (statusMap[statusName.toLowerCase()] || null) : null;

      if (siteTypeName && !siteTypeID) {
        summary.errors++;
        plan.push({ action: 'error', rowNum, display: { siteName, siteNumber, siteType: siteTypeName, status: statusName }, message: `Site Type "${siteTypeName}" not found` });
        continue;
      }
      if (statusName && !siteStatusID) {
        summary.errors++;
        plan.push({ action: 'error', rowNum, display: { siteName, siteNumber, siteType: siteTypeName, status: statusName }, message: `Status "${statusName}" not found` });
        continue;
      }

      const latRaw = row['Latitude']  !== '' ? parseFloat(row['Latitude'])  : null;
      const lonRaw = row['Longitude'] !== '' ? parseFloat(row['Longitude']) : null;

      const siteData = {
        siteName,
        siteNumber,
        contractNumber:  norm(row['ContractNumber']),
        siteTypeID,
        siteStatusID,
        address:         norm(row['Address']),
        city:            norm(row['City']),
        state:           norm(row['State']),
        zipCode:         norm(row['ZipCode']),
        latitude:        isNaN(latRaw)  ? null : latRaw,
        longitude:       isNaN(lonRaw) ? null : lonRaw,
        warrantyExpires: fmtDate(row['WarrantyExpires']),
        description:     norm(row['Description']),
      };

      const existingID = await siteModel.findByImportKey(siteNumber, siteName);
      if (existingID) {
        const existing = await siteModel.getByID(existingID);
        const diff = [
          ['Site Name',    norm(existing.SiteName),        norm(siteData.siteName)],
          ['Site #',       norm(existing.SiteNumber),       norm(siteData.siteNumber)],
          ['Contract #',   norm(existing.ContractNumber),   norm(siteData.contractNumber)],
          ['Type',         norm(existing.SiteTypeName),     norm(siteTypeName) || null],
          ['Status',       norm(existing.SiteStatusName),   norm(statusName)   || null],
          ['Address',      norm(existing.Address),          norm(siteData.address)],
          ['City',         norm(existing.City),             norm(siteData.city)],
          ['State',        norm(existing.State),            norm(siteData.state)],
          ['Zip',          norm(existing.ZipCode),          norm(siteData.zipCode)],
          ['Latitude',     existing.Latitude  != null ? String(existing.Latitude)  : null, siteData.latitude  != null ? String(siteData.latitude)  : null],
          ['Longitude',    existing.Longitude != null ? String(existing.Longitude) : null, siteData.longitude != null ? String(siteData.longitude) : null],
          ['Warranty',     fmtDate(existing.WarrantyExpires), siteData.warrantyExpires],
          ['Description',  norm(existing.Description),     norm(siteData.description)],
        ].filter(([, from, to]) => from !== to)
         .map(([field, from, to]) => ({ field, from, to }));

        summary.updated++;
        plan.push({ action: 'update', rowNum, display: { siteName, siteNumber, siteType: siteTypeName, status: statusName }, existingID, data: siteData, diff });
      } else {
        summary.created++;
        plan.push({ action: 'create', rowNum, display: { siteName, siteNumber, siteType: siteTypeName, status: statusName }, data: siteData });
      }
    }

    res.render('sites/import-preview', { title: 'Import Sites — Preview', summary, plan, importPlan: JSON.stringify(plan) });
  } catch (err) {
    next(err);
  }
});

// ── POST /import/confirm — execute confirmed plan ─────────────────────────────
router.post('/import/confirm', isAdmin, async (req, res, next) => {
  try {
    const plan = JSON.parse(req.body.importPlan || '[]');
    const results = { total: plan.length, created: 0, updated: 0, skipped: 0, errors: 0, rows: [] };

    for (const entry of plan) {
      if (entry.action === 'skip') {
        results.skipped++;
        results.rows.push({ rowNum: entry.rowNum, ...entry.display, result: 'skipped', message: entry.message });
        continue;
      }
      if (entry.action === 'error') {
        results.errors++;
        results.rows.push({ rowNum: entry.rowNum, ...entry.display, result: 'error', message: entry.message });
        continue;
      }
      try {
        if (entry.action === 'update') {
          await siteModel.update(entry.existingID, entry.data, req.auditContext);
          results.updated++;
          results.rows.push({ rowNum: entry.rowNum, ...entry.display, result: 'updated', siteID: entry.existingID });
        } else {
          const site = await siteModel.create(entry.data, req.auditContext);
          results.created++;
          results.rows.push({ rowNum: entry.rowNum, ...entry.display, result: 'created', siteID: site.SiteID });
        }
      } catch (err) {
        results.errors++;
        const msg = err.number === 2627 ? 'Duplicate site name' : (err.message || 'Database error');
        results.rows.push({ rowNum: entry.rowNum, ...entry.display, result: 'error', message: msg });
      }
    }

    res.render('sites/import', { title: 'Import Sites', results });
  } catch (err) {
    next(err);
  }
});

// ── GET /new — create form ────────────────────────────────────────────────────
router.get('/new', isAdmin, async (req, res, next) => {
  try {
    const parentSiteID = req.query.parentSiteID ? parseInt(req.query.parentSiteID, 10) : null;

    const [siteTypes, siteStatuses] = await Promise.all([
      lookupModel.getSiteTypes(),
      lookupModel.getSiteStatuses(),
    ]);

    let parentSite = null;
    if (parentSiteID) {
      parentSite = await siteModel.getByID(parentSiteID);
    }

    res.render('sites/form', {
      title:       'New Site',
      site:        null,
      action:      '/sites',
      siteTypes,
      siteStatuses,
      parentSiteID: parentSiteID || null,
      parentSiteName: parentSite ? parentSite.SiteName : null,
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
      siteNumber:      req.body.siteNumber     || null,
      contractNumber:  req.body.contractNumber || null,
      siteTypeID:      req.body.siteTypeID     || null,
      siteStatusID:    req.body.siteStatusID   || null,
      address:         req.body.address        || null,
      city:            req.body.city           || null,
      state:           req.body.state          || null,
      zipCode:         req.body.zipCode        || null,
      latitude:        req.body.latitude       || null,
      longitude:       req.body.longitude      || null,
      description:     req.body.description    || null,
      warrantyExpires: req.body.warrantyExpires || null,
      parentSiteID:    req.body.parentSiteID   || null,
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

    const [site, inventory, recentLogs, documents, pmSchedules, inStockItems, categories, stockLocations, allUsers] = await Promise.all([
      siteModel.getByID(siteID),
      siteInventoryModel.getCurrentItems(siteID),
      logModel.getBySite(siteID, { pageSize: 10 }).then(r => r.rows),
      documentModel.getBySite(siteID),
      pmModel.getBySite(siteID),
      inventoryModel.getInStock(),
      lookupModel.getInventoryCategories(),
      lookupModel.getStockLocations(),
      userModel.getAll(),
    ]);

    // Fetch subsites for parent sites; subsites themselves get an empty array
    const subsites = (site && !site.ParentSiteID)
      ? await siteModel.getSubsites(siteID)
      : [];

    // For parent sites, also fetch each subsite's installed equipment
    const subsiteInventory = subsites.length
      ? await Promise.all(subsites.map(sub =>
          siteInventoryModel.getCurrentItems(sub.SiteID).then(items => ({ sub, items }))
        ))
      : [];

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
      subsites,
      subsiteInventory,
      inStockItems,
      stockByItem,
      categories,
      stockLocations,
      allUsers,
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
      parentSiteID:   site.ParentSiteID   || null,
      parentSiteName: site.ParentSiteName || null,
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
      siteNumber:      req.body.siteNumber     || null,
      contractNumber:  req.body.contractNumber || null,
      siteTypeID:      req.body.siteTypeID     || null,
      siteStatusID:    req.body.siteStatusID   || null,
      address:         req.body.address        || null,
      city:            req.body.city           || null,
      state:           req.body.state          || null,
      zipCode:         req.body.zipCode        || null,
      latitude:        req.body.latitude       || null,
      longitude:       req.body.longitude      || null,
      description:     req.body.description    || null,
      warrantyExpires: req.body.warrantyExpires || null,
      parentSiteID:    req.body.parentSiteID   || null,
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
      const deployedStatus = await lookupModel.getInventoryStatusByName('Deployed');
      const newItem = await inventoryModel.create({
        serialNumber:    serialNumber.trim(),
        modelNumber:     modelNumber     || null,
        manufacturer:    manufacturer    || null,
        categoryID:      categoryID      || null,
        statusID:        deployedStatus?.StatusID || null,
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

// ── POST /:id/inventory/:siID/replace ────────────────────────────────────────
router.post('/:id/inventory/:siID/replace', isAdmin, async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.id, 10);
    const siID   = parseInt(req.params.siID, 10);
    const { replacementItemID, installNotes, startRepair, repairReason } = req.body;

    if (!replacementItemID) {
      req.flash('error', 'Please select a replacement item.');
      return res.redirect(`/sites/${siteID}#equipment`);
    }

    // Fetch the old SiteInventory row before removing it
    const oldSI = await siteInventoryModel.getByID(siID);
    if (!oldSI) {
      req.flash('error', 'Equipment record not found.');
      return res.redirect(`/sites/${siteID}#equipment`);
    }

    // Remove the old item from the site
    await siteInventoryModel.removeItem(siID, { removedByUserID: req.user?.UserID }, req.auditContext);

    // Install the replacement
    await siteInventoryModel.installItem(
      siteID,
      parseInt(replacementItemID, 10),
      { installedAt: new Date(), installedByUserID: req.user?.UserID, installNotes: installNotes || null },
      req.auditContext,
    );

    // Optionally start an RMA for the removed item
    if (startRepair === '1' || startRepair === 'on') {
      const repair = await repairModel.create({
        itemID:          oldSI.ItemID,
        siteInventoryID: siID,
        sentDate:        new Date(),
        reason:          repairReason || 'Replaced at site',
        sentByUserID:    req.user?.UserID,
      }, req.auditContext);

      req.flash('success', 'Item replaced. RMA started — please finish filling out the repair details.');
      return res.redirect(`/repairs/${repair.RepairID}`);
    }

    req.flash('success', 'Item replaced successfully.');
    res.redirect(`/sites/${siteID}#equipment`);
  } catch (err) { next(err); }
});

// ── POST /:id/inventory/:itemID/replace-bulk ─────────────────────────────────
router.post('/:id/inventory/:itemID/replace-bulk', isAdmin, async (req, res, next) => {
  try {
    const siteID  = parseInt(req.params.id, 10);
    const itemID  = parseInt(req.params.itemID, 10);
    const replaceQty  = parseInt(req.body.replaceQty, 10);
    const installQty  = parseInt(req.body.installQty, 10) || replaceQty;
    const { installNotes, startRepair, repairReason, pulledFrom } = req.body;

    if (!replaceQty || replaceQty < 1) {
      req.flash('error', 'Please enter a valid quantity to replace.');
      return res.redirect(`/sites/${siteID}#equipment`);
    }

    // Parse pulledFrom: "location:123" | "user:456" | ""
    let pulledFromLocationID = null;
    let pulledFromUserID     = null;
    if (pulledFrom && pulledFrom.startsWith('location:')) {
      pulledFromLocationID = parseInt(pulledFrom.split(':')[1], 10) || null;
    } else if (pulledFrom && pulledFrom.startsWith('user:')) {
      pulledFromUserID = parseInt(pulledFrom.split(':')[1], 10) || null;
    }

    // Remove the faulty units from the site
    await siteInventoryModel.removeBulkQuantity(siteID, itemID, replaceQty,
      { removedByUserID: req.user?.UserID }, req.auditContext);

    // Install replacement units (same item, from chosen stock source)
    await siteInventoryModel.installItem(siteID, itemID, {
      installedAt:          new Date(),
      installedByUserID:    req.user?.UserID,
      installNotes:         installNotes || null,
      pulledFromLocationID,
      pulledFromUserID,
      quantity:             installQty,
    }, req.auditContext);

    // Optionally create one RMA per replaced unit
    if (startRepair === '1' || startRepair === 'on') {
      if (!repairReason || !repairReason.trim()) {
        req.flash('error', 'A repair reason is required when starting an RMA.');
        return res.redirect(`/sites/${siteID}#equipment`);
      }
      let firstRepairID = null;
      for (let i = 0; i < replaceQty; i++) {
        const repair = await repairModel.create({
          itemID,
          sentDate:     new Date(),
          reason:       repairReason.trim(),
          sentByUserID: req.user?.UserID,
        }, req.auditContext);
        if (i === 0) firstRepairID = repair.RepairID;
      }
      const msg = replaceQty === 1
        ? 'Item replaced. RMA started — please finish filling out the repair details.'
        : `Item replaced. ${replaceQty} RMA records created — finishing the first one now.`;
      req.flash('success', msg);
      return res.redirect(`/repairs/${firstRepairID}`);
    }

    req.flash('success', `${replaceQty} unit(s) replaced successfully.`);
    res.redirect(`/sites/${siteID}#equipment`);
  } catch (err) {
    if (err.userMessage) {
      req.flash('error', err.userMessage);
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

// ── POST /:id/inventory/:itemID/remove-bulk ───────────────────────────────────
router.post('/:id/inventory/:itemID/remove-bulk', isAdmin, async (req, res, next) => {
  try {
    const siteID   = parseInt(req.params.id, 10);
    const itemID   = parseInt(req.params.itemID, 10);
    const quantity = parseInt(req.body.quantity, 10);
    if (!quantity || quantity < 1) {
      req.flash('error', 'Please enter a valid quantity to remove.');
      return res.redirect(`/sites/${siteID}#equipment`);
    }
    await siteInventoryModel.removeBulkQuantity(siteID, itemID, quantity, { removedByUserID: req.user?.UserID }, req.auditContext);
    req.flash('success', `${quantity} unit(s) removed from site.`);
    res.redirect(`/sites/${siteID}#equipment`);
  } catch (err) {
    if (err.userMessage) {
      req.flash('error', err.userMessage);
      return res.redirect(`/sites/${req.params.id}#equipment`);
    }
    next(err);
  }
});

module.exports = router;
