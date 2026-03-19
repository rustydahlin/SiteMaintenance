'use strict';

const express            = require('express');
const router             = express.Router();
const multer             = require('multer');
const XLSX               = require('xlsx');
const inventoryModel     = require('../models/inventoryModel');

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.csv$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Only .csv files are accepted'));
  },
});
const lookupModel        = require('../models/lookupModel');
const documentModel      = require('../models/documentModel');
const siteInventoryModel = require('../models/siteInventoryModel');
const siteModel          = require('../models/siteModel');
const userModel          = require('../models/userModel');
const repairModel        = require('../models/repairModel');
const { isAuthenticated, isAdmin, canImportExport } = require('../middleware/auth');

// All routes require authentication
router.use(isAuthenticated);

// ── GET / — list inventory ────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { categoryID, statusID, search, locationID, page = 1, sort = 'commonName', dir = 'asc' } = req.query;

    const [{ rows }, categories, statuses, locations] = await Promise.all([
      inventoryModel.getAll({ categoryID, statusID, search, locationID, page: 1, pageSize: 10000, sort, dir }),
      lookupModel.getInventoryCategories(),
      lookupModel.getInventoryStatuses(),
      lookupModel.getStockLocations(),
    ]);

    // Build display rows: serialized items with a CommonName are collapsed into one group row
    const displayRows = [];
    const seenGroups  = new Set();
    for (const item of rows) {
      if (item.TrackingType === 'bulk') {
        displayRows.push(item);
      } else if (item.CommonName) {
        if (!seenGroups.has(item.CommonName)) {
          seenGroups.add(item.CommonName);
          const groupItems     = rows.filter(r => r.TrackingType !== 'bulk' && r.CommonName === item.CommonName);
          const inStockItems   = groupItems.filter(r => r.StatusName === 'In-Stock');
          const deployedItems  = groupItems.filter(r => r.StatusName === 'Deployed');
          const inRepairItems  = groupItems.filter(r => r.StatusName === 'In-Repair');
          const knownCount     = inStockItems.length + deployedItems.length + inRepairItems.length;
          // Primary in-stock location: most common among in-stock units
          const locCounts = {};
          inStockItems.forEach(r => { if (r.StockLocationName) locCounts[r.StockLocationName] = (locCounts[r.StockLocationName] || 0) + 1; });
          const primaryLocation = Object.keys(locCounts).sort((a, b) => locCounts[b] - locCounts[a])[0] || null;
          displayRows.push({
            _displayType:   'group',
            commonName:     item.CommonName,
            CategoryName:   item.CategoryName,
            ModelNumber:    item.ModelNumber,
            Manufacturer:   item.Manufacturer,
            totalCount:     groupItems.length,
            inStockCount:   inStockItems.length,
            deployedCount:  deployedItems.length,
            inRepairCount:  inRepairItems.length,
            otherCount:     groupItems.length - knownCount,
            primaryLocation,
            locationCount:  Object.keys(locCounts).length,
          });
        }
      } else {
        displayRows.push(item);
      }
    }

    // Paginate display rows
    const pageSize = 25;
    const pageNum  = parseInt(page, 10) || 1;
    const total    = displayRows.length;
    const pagedRows = displayRows.slice((pageNum - 1) * pageSize, pageNum * pageSize);

    const queryParts = [];
    if (categoryID) queryParts.push(`categoryID=${encodeURIComponent(categoryID)}`);
    if (statusID)   queryParts.push(`statusID=${encodeURIComponent(statusID)}`);
    if (search)     queryParts.push(`search=${encodeURIComponent(search)}`);
    if (locationID) queryParts.push(`locationID=${encodeURIComponent(locationID)}`);
    if (sort && sort !== 'commonName') queryParts.push(`sort=${encodeURIComponent(sort)}`);
    if (dir  && dir  !== 'asc')        queryParts.push(`dir=${encodeURIComponent(dir)}`);

    res.render('inventory/index', {
      title:      'Inventory',
      items:      pagedRows,
      categories,
      statuses,
      locations,
      filters:    { categoryID, statusID, search, locationID },
      sort,
      dir,
      pagination: {
        page:        pageNum,
        totalPages:  Math.ceil(total / pageSize),
        total,
        queryString: queryParts.join('&'),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /export — download all matching inventory as CSV ─────────────────────
router.get('/export', canImportExport, async (req, res, next) => {
  try {
    const { categoryID, statusID, search, locationID, sort = 'commonName', dir = 'asc' } = req.query;
    const { rows } = await inventoryModel.getAll({ categoryID, statusID, search, locationID, page: 1, pageSize: 100000, sort, dir });

    const sheetData = rows.map(i => ({
      TrackingType:    i.TrackingType    || '',
      CommonName:      i.CommonName      || '',
      SerialNumber:    i.SerialNumber    || '',
      AssetTag:        i.AssetTag        || '',
      PartNumber:      i.PartNumber      || '',
      ModelNumber:     i.ModelNumber     || '',
      Manufacturer:    i.Manufacturer    || '',
      Category:        i.CategoryName    || '',
      Status:          i.StatusName      || '',
      StockLocation:   i.TrackingType === 'bulk' ? (i.BulkPrimaryLocation || '') : (i.StockLocationName || ''),
      QuantityTotal:   i.TrackingType === 'bulk' ? (i.QuantityTotal   ?? '') : '',
      QuantityAvailable: i.TrackingType === 'bulk' ? (i.QuantityAvailable ?? '') : '',
      CurrentSite:     i.CurrentSiteName || '',
      AssignedTo:      i.AssignedToUserName || '',
      PurchaseDate:    i.PurchaseDate    ? new Date(i.PurchaseDate).toISOString().split('T')[0]    : '',
      WarrantyExpires: i.WarrantyExpires ? new Date(i.WarrantyExpires).toISOString().split('T')[0] : '',
      Description:     i.Description    || '',
      Notes:           i.Notes          || '',
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetData), 'Inventory');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'csv' });

    const date = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="inventory-export-${date}.csv"`);
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

// ── GET /import/template — download blank CSV template ───────────────────────
router.get('/import/template', canImportExport, (_req, res) => {
  const headers = [
    'TrackingType', 'CommonName', 'SerialNumber', 'AssetTag', 'PartNumber',
    'ModelNumber', 'Manufacturer', 'Category', 'Status', 'StockLocation',
    'QuantityTotal', 'PurchaseDate', 'WarrantyExpires', 'Description', 'Notes',
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers]), 'Inventory');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'csv' });
  res.setHeader('Content-Disposition', 'attachment; filename="inventory_import_template.csv"');
  res.setHeader('Content-Type', 'text/csv');
  res.send(buf);
});

// ── GET /import — upload form ─────────────────────────────────────────────────
router.get('/import', canImportExport, (_req, res) => {
  res.render('inventory/import', { title: 'Import Inventory', results: null });
});

// ── POST /import — dry-run: parse file and show preview ───────────────────────
router.post('/import', canImportExport, importUpload.single('importFile'), async (req, res, next) => {
  try {
    if (!req.file) {
      req.flash('error', 'Please select a file to upload.');
      return res.redirect('/inventory/import');
    }

    const wb   = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (rows.length === 0) {
      req.flash('error', 'The file appears to be empty.');
      return res.redirect('/inventory/import');
    }

    const [categories, statuses, locations] = await Promise.all([
      lookupModel.getInventoryCategories(),
      lookupModel.getInventoryStatuses(),
      lookupModel.getStockLocations(),
    ]);
    const categoryMap     = Object.fromEntries(categories.map(c => [c.CategoryName.toLowerCase(), c.CategoryID]));
    const statusMap       = Object.fromEntries(statuses.map(s => [s.StatusName.toLowerCase(), s.StatusID]));
    const locationMap     = Object.fromEntries(locations.map(l => [l.LocationName.toLowerCase(), l.LocationID]));
    const inStockStatusID = statuses.find(s => s.StatusName === 'In-Stock')?.StatusID || null;

    const plan    = [];
    const summary = { total: rows.length, created: 0, updated: 0, skipped: 0, errors: 0 };
    const norm    = v => (v == null || v === '') ? null : String(v).trim();
    const fmtDate = v => {
      if (!v && v !== 0) return null;
      const d = typeof v === 'number'
        ? new Date(Math.round((v - 25569) * 86400 * 1000))  // Excel serial
        : (v instanceof Date ? v : new Date(String(v).trim()));
      return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
    };

    for (let i = 0; i < rows.length; i++) {
      const row         = rows[i];
      const rowNum      = i + 2;
      const commonName  = (row['CommonName']   || '').toString().trim();
      const trackingRaw = (row['TrackingType'] || '').toString().trim().toLowerCase();

      if (!commonName) {
        summary.skipped++;
        plan.push({ action: 'skip', rowNum, display: { commonName: '', trackingType: '' }, message: 'CommonName is blank' });
        continue;
      }

      const trackingType = trackingRaw === 'bulk' ? 'bulk' : 'serialized';
      const serialNumber = trackingType === 'serialized' ? norm(row['SerialNumber']) : null;
      const modelNumber  = norm(row['ModelNumber']);

      const categoryName = (row['Category']     || '').toString().trim();
      const statusName   = (row['Status']        || '').toString().trim();
      const locationName = (row['StockLocation'] || '').toString().trim();

      const categoryID = categoryName ? (categoryMap[categoryName.toLowerCase()] || null) : null;
      const locationID = locationName ? (locationMap[locationName.toLowerCase()] || null) : null;
      const statusID   = statusName   ? (statusMap[statusName.toLowerCase()]     || null) : inStockStatusID;

      if (categoryName && !categoryID) {
        summary.errors++;
        plan.push({ action: 'error', rowNum, display: { commonName, serialNumber, trackingType, category: categoryName }, message: `Category "${categoryName}" not found` });
        continue;
      }
      if (statusName && !statusID) {
        summary.errors++;
        plan.push({ action: 'error', rowNum, display: { commonName, serialNumber, trackingType, category: categoryName }, message: `Status "${statusName}" not found` });
        continue;
      }
      if (locationName && !locationID) {
        summary.errors++;
        plan.push({ action: 'error', rowNum, display: { commonName, serialNumber, trackingType, category: categoryName }, message: `Stock Location "${locationName}" not found` });
        continue;
      }

      const quantityTotal = trackingType === 'bulk' ? (parseInt(row['QuantityTotal'], 10) || 1) : 1;

      const itemData = {
        commonName,
        serialNumber,
        assetTag:        trackingType === 'serialized' ? norm(row['AssetTag']) : null,
        partNumber:      norm(row['PartNumber']),
        modelNumber,
        manufacturer:    norm(row['Manufacturer']),
        categoryID,
        statusID,
        stockLocationID: trackingType === 'serialized' ? locationID : null,
        quantityTotal,
        description:     norm(row['Description']),
        notes:           norm(row['Notes']),
        purchaseDate:    fmtDate(row['PurchaseDate']),
        warrantyExpires: fmtDate(row['WarrantyExpires']),
      };

      const existingID = await inventoryModel.findByImportKey(trackingType, serialNumber, commonName, modelNumber);
      if (existingID) {
        const existing = await inventoryModel.getByID(existingID);
        const diff = [
          ['Common Name',    norm(existing.CommonName),       norm(itemData.commonName)],
          ['Serial #',       norm(existing.SerialNumber),     norm(itemData.serialNumber)],
          ['Asset Tag',      norm(existing.AssetTag),         norm(itemData.assetTag)],
          ['Part #',         norm(existing.PartNumber),       norm(itemData.partNumber)],
          ['Model #',        norm(existing.ModelNumber),      norm(itemData.modelNumber)],
          ['Manufacturer',   norm(existing.Manufacturer),     norm(itemData.manufacturer)],
          ['Category',       norm(existing.CategoryName),     norm(categoryName) || null],
          ['Status',         norm(existing.StatusName),       norm(statusName)   || null],
          ['Stock Location', norm(existing.StockLocationName), norm(locationName) || null],
          ['Qty Total',      existing.QuantityTotal != null ? String(existing.QuantityTotal) : null, String(itemData.quantityTotal)],
          ['Purchase Date',  fmtDate(existing.PurchaseDate),  itemData.purchaseDate],
          ['Warranty',       fmtDate(existing.WarrantyExpires), itemData.warrantyExpires],
          ['Description',    norm(existing.Description),      norm(itemData.description)],
          ['Notes',          norm(existing.Notes),            norm(itemData.notes)],
        ].filter(([, from, to]) => from !== to)
         .map(([field, from, to]) => ({ field, from, to }));

        summary.updated++;
        plan.push({ action: 'update', rowNum, display: { commonName, serialNumber, trackingType, category: categoryName }, existingID, data: itemData, diff });
      } else {
        summary.created++;
        plan.push({ action: 'create', rowNum, display: { commonName, serialNumber, trackingType, category: categoryName }, data: { trackingType, ...itemData } });
      }
    }

    res.render('inventory/import-preview', { title: 'Import Inventory — Preview', summary, plan, importPlan: JSON.stringify(plan) });
  } catch (err) {
    next(err);
  }
});

// ── POST /import/confirm — execute confirmed plan ─────────────────────────────
router.post('/import/confirm', canImportExport, async (req, res, next) => {
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
          await inventoryModel.update(entry.existingID, entry.data, req.auditContext);
          results.updated++;
          results.rows.push({ rowNum: entry.rowNum, ...entry.display, result: 'updated', itemID: entry.existingID });
        } else {
          const item = await inventoryModel.create(entry.data, req.auditContext);
          results.created++;
          results.rows.push({ rowNum: entry.rowNum, ...entry.display, result: 'created', itemID: item.ItemID });
        }
      } catch (err) {
        results.errors++;
        const msg = err.number === 2627 ? 'Duplicate serial number' : (err.message || 'Database error');
        results.rows.push({ rowNum: entry.rowNum, ...entry.display, result: 'error', message: msg });
      }
    }

    res.render('inventory/import', { title: 'Import Inventory', results });
  } catch (err) {
    next(err);
  }
});

// ── GET /new — create form ────────────────────────────────────────────────────
router.get('/new', isAdmin, async (req, res, next) => {
  try {
    const [categories, statuses, locations, systems, commonNames, modelNumbers, manufacturers, allUsers] = await Promise.all([
      lookupModel.getInventoryCategories(),
      lookupModel.getInventoryStatuses(),
      lookupModel.getStockLocations(),
      inventoryModel.getSystemsList(),
      lookupModel.getInventoryCommonNames(),
      lookupModel.getInventoryModelNumbers(),
      lookupModel.getInventoryManufacturers(),
      userModel.getAll(),
    ]);
    res.render('inventory/form', {
      title:          'Add Inventory Item',
      item:           null,
      action:         '/inventory',
      categories,
      statuses,
      locations,
      systems,
      commonNames,
      modelNumbers,
      manufacturers,
      allUsers,
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

    const holderType = req.body.holderType; // 'location' or 'user'
    const item = await inventoryModel.create({
      trackingType:      isBulk ? 'bulk' : 'serialized',
      serialNumber:      isBulk ? null : serialNumber.trim(),
      assetTag:          isBulk ? null : (req.body.assetTag || null),
      commonName:        req.body.commonName      || null,
      partNumber:        req.body.partNumber      || null,
      modelNumber:       req.body.modelNumber     || null,
      manufacturer:      req.body.manufacturer    || null,
      categoryID:        categoryID,
      statusID:          statusID,
      stockLocationID:   isBulk ? null : (holderType !== 'user' ? (req.body.stockLocationID || null) : null),
      assignedToUserID:  isBulk ? null : (holderType === 'user' ? (req.body.assignedToUserID || null) : null),
      quantityTotal:     isBulk ? (parseInt(req.body.quantityTotal, 10) || 1) : 1,
      relatedSystemID:   req.body.relatedSystemID || null,
      description:       req.body.description     || null,
      purchaseDate:      req.body.purchaseDate     || null,
      warrantyExpires:   req.body.warrantyExpires  || null,
      notes:             req.body.notes           || null,
    }, req.auditContext);

    req.flash('success', `Item "${item.ModelNumber || item.SerialNumber || item.ItemID}" added successfully.`);
    res.redirect(`/inventory/${item.ItemID}`);
  } catch (err) {
    next(err);
  }
});

// ── GET /group/:name — serialized items grouped by Common Name ────────────────
router.get('/group/:name', async (req, res, next) => {
  try {
    const commonName = req.params.name;
    const items      = await inventoryModel.getByCommonName(commonName);

    const inStock  = items.filter(i => i.StatusName === 'In-Stock');
    const deployed = items.filter(i => i.StatusName === 'Deployed');
    const other    = items.filter(i => i.StatusName !== 'In-Stock' && i.StatusName !== 'Deployed');

    res.render('inventory/byCommonName', {
      title: commonName,
      commonName,
      items,
      inStock,
      deployed,
      other,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /:id — item detail ────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const itemID = parseInt(req.params.id, 10);

    const [item, documents, siteHistory, repairResult,
           stockLocations, allUsers, sites, relatedParts] = await Promise.all([
      inventoryModel.getByID(itemID),
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
    const [item, categories, statuses, locations, systems, commonNames, modelNumbers, manufacturers, allUsers] = await Promise.all([
      inventoryModel.getByID(itemID),
      lookupModel.getInventoryCategories(),
      lookupModel.getInventoryStatuses(),
      lookupModel.getStockLocations(),
      inventoryModel.getSystemsList(itemID),
      lookupModel.getInventoryCommonNames(),
      lookupModel.getInventoryModelNumbers(),
      lookupModel.getInventoryManufacturers(),
      userModel.getAll(),
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
      commonNames,
      modelNumbers,
      manufacturers,
      allUsers,
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

    const holderType = req.body.holderType;
    const item = await inventoryModel.update(itemID, {
      serialNumber:     isBulk ? null : (serialNumber?.trim() || null),
      assetTag:         isBulk ? null : (req.body.assetTag || null),
      commonName:       req.body.commonName      || null,
      partNumber:       req.body.partNumber      || null,
      modelNumber:      req.body.modelNumber     || null,
      manufacturer:     req.body.manufacturer    || null,
      categoryID:       categoryID               || null,
      statusID:         statusID                 || null,
      stockLocationID:  isBulk ? null : (holderType !== 'user' ? (req.body.stockLocationID || null) : null),
      assignedToUserID: isBulk ? null : (holderType === 'user' ? (req.body.assignedToUserID || null) : null),
      quantityTotal:    isBulk ? (parseInt(req.body.quantityTotal, 10) || 1) : 1,
      relatedSystemID:  req.body.relatedSystemID || null,
      description:      req.body.description     || null,
      purchaseDate:     req.body.purchaseDate     || null,
      warrantyExpires:  req.body.warrantyExpires  || null,
      notes:            req.body.notes           || null,
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

    if (holderType === 'unallocated') {
      await inventoryModel.setUnallocated(itemID, parseInt(quantity, 10) || 0);
    } else {
      await inventoryModel.upsertStock(itemID, {
        locationID: holderType === 'location' ? locationID : null,
        userID:     holderType === 'user'     ? userID     : null,
        quantity, notes,
      });
    }
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
