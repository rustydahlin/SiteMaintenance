'use strict';

const express           = require('express');
const router            = express.Router();
const multer            = require('multer');
const XLSX              = require('xlsx');
const siteModel              = require('../models/siteModel');
const lookupModel            = require('../models/lookupModel');
const networkResourceModel   = require('../models/networkResourceModel');
const logModel               = require('../models/logModel');
const documentModel      = require('../models/documentModel');
const siteInventoryModel = require('../models/siteInventoryModel');
const inventoryModel     = require('../models/inventoryModel');
const pmModel            = require('../models/pmModel');
const repairModel        = require('../models/repairModel');
const userModel          = require('../models/userModel');
const vendorModel        = require('../models/vendorModel');
const { isAuthenticated, isAdmin, canWrite, canImportExport, canManageNetworkMap } = require('../middleware/auth');

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.csv$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Only .csv files are accepted'));
  },
});

const equipmentImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.(csv|xlsx)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Only .xlsx or .csv files are accepted'));
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

// ── GET /export — download all matching sites as CSV ─────────────────────────
router.get('/export', canImportExport, async (req, res, next) => {
  try {
    const { typeID, statusID, search, pmDue, sort = 'siteName', dir = 'asc' } = req.query;
    const { rows } = await siteModel.getAll({ typeID, statusID, search, pmDue, page: 1, pageSize: 100000, sort, dir, includeSubsites: true });

    const sheetData = rows.map(s => ({
      SiteID:        s.SiteID,
      ParentSiteID:     s.ParentSiteID     || '',
      ParentSiteName:   s.ParentSiteName   || '',
      ParentSiteNumber: s.ParentSiteNumber || '',
      SiteNumber:             s.SiteNumber                  || '',
      SiteName:               s.SiteName                    || '',
      SiteType:               s.SiteTypeName                || '',
      MonitoringLocationType: s.MonitoringLocationTypeName  || '',
      ContractNumber:         s.ContractNumber              || '',
      Address:                s.Address                     || '',
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
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'csv' });

    const date = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="sites-export-${date}.csv"`);
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

// ── GET /import/template — download blank CSV template ───────────────────────
router.get('/import/template', canImportExport, (_req, res) => {
  const headers = [
    'SiteName', 'SiteNumber', 'ContractNumber', 'SiteType', 'MonitoringLocationType',
    'Address', 'City', 'State', 'ZipCode',
    'Latitude', 'Longitude', 'WarrantyExpires', 'Description',
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers]), 'Sites');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'csv' });
  res.setHeader('Content-Disposition', 'attachment; filename="sites_import_template.csv"');
  res.setHeader('Content-Type', 'text/csv');
  res.send(buf);
});

// ── GET /import — upload form ─────────────────────────────────────────────────
router.get('/import', canImportExport, (_req, res) => {
  res.render('sites/import', { title: 'Import Sites', results: null });
});

// ── POST /import — dry-run: parse file and show preview ───────────────────────
router.post('/import', canImportExport, importUpload.single('importFile'), async (req, res, next) => {
  try {
    if (!req.file) {
      req.flash('error', 'Please select a file to upload.');
      return res.redirect('/sites/import');
    }

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (rows.length === 0) {
      req.flash('error', 'The file appears to be empty.');
      return res.redirect('/sites/import');
    }

    const [siteTypes, monitoringLocationTypes] = await Promise.all([
      lookupModel.getSiteTypes(),
      lookupModel.getMonitoringLocationTypes(),
    ]);
    const typeMap = Object.fromEntries(siteTypes.map(t => [t.TypeName.toLowerCase(), t.SiteTypeID]));
    const mltMap  = Object.fromEntries(monitoringLocationTypes.map(t => [t.TypeName.toLowerCase(), t.LocationTypeID]));

    const plan    = [];
    const summary = { total: rows.length, created: 0, updated: 0, skipped: 0, removed: 0, errors: 0 };
    const norm    = v => (v == null || v === '') ? null : String(v).trim();
    const fmtDate = v => {
      if (!v && v !== 0) return null;
      const d = typeof v === 'number'
        ? new Date((Math.round(v) - 25569) * 86400 * 1000)  // Excel serial — round serial, not ms
        : (v instanceof Date ? v : new Date(String(v).trim()));
      return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
    };

    for (let i = 0; i < rows.length; i++) {
      const row        = rows[i];
      const rowNum     = i + 2;
      const siteName         = (row['SiteName']        || '').toString().trim();
      const siteNumber       = (row['SiteNumber']      || '').toString().trim() || null;
      const parentSiteNumber = (row['ParentSiteNumber'] || '').toString().trim();
      const parentSiteName   = (row['ParentSiteName']   || '').toString().trim();
      const csvSiteID        = parseInt(row['SiteID']       || '', 10) || null;
      const csvParentSiteID  = parseInt(row['ParentSiteID'] || '', 10) || null;

      if (!siteName) {
        summary.skipped++;
        plan.push({ action: 'skip', rowNum, display: { siteName: '', siteNumber }, message: 'SiteName is blank' });
        continue;
      }

      const siteTypeName = (row['SiteType'] || '').toString().trim();
      const siteTypeID   = siteTypeName ? (typeMap[siteTypeName.toLowerCase()] || null) : null;

      if (siteTypeName && !siteTypeID) {
        summary.errors++;
        plan.push({ action: 'error', rowNum, display: { siteName, siteNumber, siteType: siteTypeName }, message: `Site Type "${siteTypeName}" not found` });
        continue;
      }

      const mltName                = (row['MonitoringLocationType'] || '').toString().trim();
      const monitoringLocationTypeID = mltName ? (mltMap[mltName.toLowerCase()] || null) : null;

      const latRaw = row['Latitude']  !== '' ? parseFloat(row['Latitude'])  : null;
      const lonRaw = row['Longitude'] !== '' ? parseFloat(row['Longitude']) : null;

      const siteData = {
        siteName,
        siteNumber,
        contractNumber:  norm(row['ContractNumber']),
        siteTypeID,
        address:         norm(row['Address']),
        city:            norm(row['City']),
        state:           norm(row['State']),
        zipCode:         norm(row['ZipCode']),
        latitude:        isNaN(latRaw)  ? null : latRaw,
        longitude:       isNaN(lonRaw) ? null : lonRaw,
        warrantyExpires:            fmtDate(row['WarrantyExpires']),
        description:                norm(row['Description']),
        parentSiteID:               csvParentSiteID,
        monitoringLocationTypeID,
      };

      // Match by SiteID (from export) first; fall back to name/number matching for new rows
      const existingID = csvSiteID || await siteModel.findByImportKey(siteNumber, siteName, parentSiteNumber);
      const existing = existingID ? await siteModel.getByID(existingID) : null;
      if (existing) {
        const diff = [
          ['Site Name',    norm(existing.SiteName),        norm(siteData.siteName)],
          ['Site #',       norm(existing.SiteNumber),       norm(siteData.siteNumber)],
          ['Contract #',   norm(existing.ContractNumber),   norm(siteData.contractNumber)],
          ['Type',         norm(existing.SiteTypeName),     norm(siteTypeName) || null],
          ['Address',      norm(existing.Address),          norm(siteData.address)],
          ['City',         norm(existing.City),             norm(siteData.city)],
          ['State',        norm(existing.State),            norm(siteData.state)],
          ['Zip',          norm(existing.ZipCode),          norm(siteData.zipCode)],
          ['Latitude',     existing.Latitude  != null ? String(existing.Latitude)  : null, siteData.latitude  != null ? String(siteData.latitude)  : null],
          ['Longitude',    existing.Longitude != null ? String(existing.Longitude) : null, siteData.longitude != null ? String(siteData.longitude) : null],
          ['Warranty',              fmtDate(existing.WarrantyExpires),            siteData.warrantyExpires],
          ['Monitoring Loc Type',   norm(existing.MonitoringLocationTypeName),    norm(mltName) || null],
          ['Description',           norm(existing.Description),                  norm(siteData.description)],
        ].filter(([, from, to]) => from !== to)
         .map(([field, from, to]) => ({ field, from, to }));

        if (diff.length === 0) {
          summary.skipped++;
          plan.push({ action: 'skip', rowNum, display: { siteName, siteNumber, siteType: siteTypeName }, existingID: existingID, message: 'No changes' });
        } else {
          summary.updated++;
          plan.push({ action: 'update', rowNum, display: { siteName, siteNumber, siteType: siteTypeName }, existingID, data: siteData, diff });
        }
      } else {
        summary.created++;
        plan.push({ action: 'create', rowNum, display: { siteName, siteNumber, siteType: siteTypeName }, data: siteData, parentSiteNumber, parentSiteName });
      }
    }

    // Detect removed sites: active DB sites not matched by any CSV row
    const seenIDs  = new Set(plan.filter(e => e.existingID).map(e => e.existingID));
    const allSites = await siteModel.getAllForImportDiff();
    for (const site of allSites) {
      if (!seenIDs.has(site.SiteID)) {
        summary.removed++;
        plan.push({
          action: 'remove',
          display: {
            siteName:         site.SiteName,
            siteNumber:       site.SiteNumber,
            siteType:         site.SiteTypeName,
            parentSiteNumber: site.ParentSiteNumber,
            parentSiteName:   site.ParentSiteName,
          },
        });
      }
    }

    res.render('sites/import-preview', { title: 'Import Sites — Preview', summary, plan, importPlan: JSON.stringify(plan) });
  } catch (err) {
    next(err);
  }
});

// ── POST /import/confirm — execute confirmed plan ─────────────────────────────
router.post('/import/confirm', canImportExport, async (req, res, next) => {
  try {
    const plan = JSON.parse(req.body.importPlan || '[]');
    const results = { total: plan.length, created: 0, updated: 0, skipped: 0, errors: 0, rows: [] };

    // Track newly created sites by their site number so subsites can resolve parent IDs
    // even when the parent was also created in this same import batch.
    const createdByNumber = new Map();

    // Process in two passes: top-level creates first, then subsites.
    // This ensures parents exist before children regardless of CSV row order.
    const passes = [
      plan.filter(e => e.action === 'create' && !e.parentSiteNumber),
      plan.filter(e => e.action !== 'create' || e.parentSiteNumber),
    ];

    for (const entries of passes) {
      for (const entry of entries) {
        if (entry.action === 'skip' || entry.action === 'remove') {
          results.skipped++;
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
            // Always re-resolve parent so stale CSV IDs never reach the DB.
            // Priority: site number (new exports) → site name (old exports) → null.
            if (entry.parentSiteNumber) {
              entry.data.parentSiteID = createdByNumber.get(entry.parentSiteNumber)
                ?? await siteModel.findBySiteNumber(entry.parentSiteNumber)
                ?? null;
            } else if (entry.parentSiteName) {
              entry.data.parentSiteID = createdByNumber.get(entry.parentSiteName + '_name')
                ?? await siteModel.findTopLevelBySiteName(entry.parentSiteName)
                ?? null;
            } else {
              entry.data.parentSiteID = null;
            }
            const site = await siteModel.create(entry.data, req.auditContext);
            if (entry.data.siteNumber) createdByNumber.set(entry.data.siteNumber, site.SiteID);
            if (!entry.data.parentSiteID) createdByNumber.set(entry.display.siteName + '_name', site.SiteID);
            results.created++;
            results.rows.push({ rowNum: entry.rowNum, ...entry.display, result: 'created', siteID: site.SiteID });
          }
        } catch (err) {
          results.errors++;
          const msg = err.number === 2627 ? 'Duplicate site name' : (err.message || 'Database error');
          results.rows.push({ rowNum: entry.rowNum, ...entry.display, result: 'error', message: msg });
        }
      }
    }

    res.render('sites/import', { title: 'Import Sites', results });
  } catch (err) {
    next(err);
  }
});

// ── GET /new — create form ────────────────────────────────────────────────────
router.get('/new', canManageNetworkMap, async (req, res, next) => {
  try {
    const parentSiteID = req.query.parentSiteID ? parseInt(req.query.parentSiteID, 10) : null;

    const [siteTypes, monitoringLocationTypes] = await Promise.all([
      lookupModel.getSiteTypes(),
      lookupModel.getMonitoringLocationTypes(),
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
      monitoringLocationTypes,
      parentSiteID: parentSiteID || null,
      parentSiteName: parentSite ? parentSite.SiteName : null,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST / — create site ──────────────────────────────────────────────────────
router.post('/', canManageNetworkMap, async (req, res, next) => {
  try {
    const { siteName } = req.body;
    if (!siteName || !siteName.trim()) {
      req.flash('error', 'Site Name is required.');
      return res.redirect('/sites/new');
    }

    const site = await siteModel.create({
      siteName:                 siteName.trim(),
      siteNumber:               req.body.siteNumber              || null,
      contractNumber:           req.body.contractNumber          || null,
      siteTypeID:               req.body.siteTypeID              || null,
      address:                  req.body.address                 || null,
      city:                     req.body.city                    || null,
      state:                    req.body.state                   || null,
      zipCode:                  req.body.zipCode                 || null,
      latitude:                 req.body.latitude                || null,
      longitude:                req.body.longitude               || null,
      description:              req.body.description             || null,
      warrantyExpires:          req.body.warrantyExpires         || null,
      parentSiteID:             req.body.parentSiteID            || null,
      monitoringLocationTypeID: req.body.monitoringLocationTypeID || null,
    }, req.auditContext);

    req.flash('success', `Site "${site.SiteName}" created successfully.`);
    res.redirect(`/sites/${site.SiteID}`);
  } catch (err) {
    next(err);
  }
});

// ── GET /equipment/export — download all sites + installed equipment as XLSX ──
router.get('/equipment/export', canImportExport, async (req, res, next) => {
  try {
    const [allSites, installations] = await Promise.all([
      siteModel.getAll({ page: 1, pageSize: 100000, includeSubsites: true }).then(r => r.rows),
      siteInventoryModel.getAllInstallations(),
    ]);

    // Index installations by SiteID for quick lookup
    const installsBySite = new Map();
    for (const row of installations) {
      if (!installsBySite.has(row.SiteID)) installsBySite.set(row.SiteID, []);
      installsBySite.get(row.SiteID).push(row);
    }

    const sheetData = [];
    for (const site of allSites) {
      const items = installsBySite.get(site.SiteID) || [];
      if (items.length === 0) {
        // Site with no equipment — one blank row so it appears as a template
        sheetData.push({
          SiteInventoryID: '',
          SiteID:          site.SiteID,
          SiteName:        site.SiteName        || '',
          SiteNumber:      site.SiteNumber      || '',
          ItemID:          '',
          TrackingType:    '',
          SerialNumber:    '',
          CommonName:      '',
          ModelNumber:     '',
          Manufacturer:    '',
          Category:        '',
          Quantity:        '',
          InstallNotes:    '',
        });
      } else {
        for (const inst of items) {
          sheetData.push({
            SiteInventoryID: inst.SiteInventoryID,
            SiteID:          site.SiteID,
            SiteName:        site.SiteName        || '',
            SiteNumber:      site.SiteNumber      || '',
            ItemID:          inst.ItemID,
            TrackingType:    inst.TrackingType    || '',
            SerialNumber:    inst.SerialNumber    || '',
            CommonName:      inst.CommonName      || '',
            ModelNumber:     inst.ModelNumber     || '',
            Manufacturer:    inst.Manufacturer    || '',
            Category:        inst.CategoryName    || '',
            Quantity:        inst.TrackingType === 'bulk' ? (inst.Quantity ?? '') : '',
            InstallNotes:    inst.InstallNotes    || '',
          });
        }
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetData), 'SiteEquipment');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const date = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="site-equipment-export-${date}.xlsx"`);
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

// ── GET /equipment/import/template — blank XLSX template ─────────────────────
router.get('/equipment/import/template', canImportExport, (_req, res) => {
  const headers = [
    'SiteID', 'SiteName', 'SiteNumber',
    'ItemID', 'TrackingType', 'SerialNumber', 'CommonName', 'ModelNumber', 'Manufacturer',
    'Category', 'Quantity', 'InstallNotes',
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers]), 'SiteEquipment');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="site-equipment-import-template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ── GET /equipment/import — upload form ───────────────────────────────────────
router.get('/equipment/import', canImportExport, (_req, res) => {
  res.render('sites/equipment-import', { title: 'Import Site Equipment', results: null });
});

// ── POST /equipment/import — dry-run preview ──────────────────────────────────
router.post('/equipment/import', canImportExport, equipmentImportUpload.single('importFile'), async (req, res, next) => {
  try {
    if (!req.file) {
      req.flash('error', 'Please select a file to upload.');
      return res.redirect('/sites/equipment/import');
    }

    const wb   = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (rows.length === 0) {
      req.flash('error', 'The file appears to be empty.');
      return res.redirect('/sites/equipment/import');
    }

    const norm = v => (v == null || v === '') ? null : String(v).trim();

    const plan    = [];
    const summary = { total: 0, created: 0, updated: 0, skipped: 0, errors: 0 };

    for (let i = 0; i < rows.length; i++) {
      const row    = rows[i];
      const rowNum = i + 2;

      // Resolve site — prefer SiteID, fall back to SiteNumber then SiteName
      const csvSiteID   = parseInt(row['SiteID']   || '', 10) || null;
      const csvSiteName = norm(row['SiteName']);
      const csvSiteNum  = norm(row['SiteNumber']);

      let site = null;
      if (csvSiteID) site = await siteModel.getByID(csvSiteID);
      if (!site && csvSiteNum) {
        const found = await siteModel.findByImportKey(csvSiteNum, csvSiteName || csvSiteNum, '');
        if (found) site = await siteModel.getByID(found);
      }
      if (!site && csvSiteName) {
        const found = await siteModel.findByImportKey(null, csvSiteName, '');
        if (found) site = await siteModel.getByID(found);
      }

      if (!site) {
        // Row with no site info at all — template blank row, skip silently
        if (!csvSiteID && !csvSiteName && !csvSiteNum) { summary.skipped++; continue; }
        summary.errors++;
        plan.push({ action: 'error', rowNum, display: { siteName: csvSiteName || csvSiteNum || String(csvSiteID) }, message: 'Site not found' });
        continue;
      }

      // Rows with no item info are template placeholders — skip silently
      const csvItemID      = parseInt(row['ItemID']       || '', 10) || null;
      const csvSerial      = norm(row['SerialNumber']);
      const csvCommonName  = norm(row['CommonName']);
      const csvModelNumber = norm(row['ModelNumber']);
      const csvTrackingRaw = norm(row['TrackingType']);
      const trackingType   = csvTrackingRaw ? csvTrackingRaw.toLowerCase() : (csvSerial ? 'serialized' : (csvCommonName ? 'bulk' : null));

      if (!csvItemID && !csvSerial && !csvCommonName) {
        summary.skipped++;
        continue;
      }

      summary.total++;

      // Resolve inventory item
      let item = null;
      if (csvItemID) item = await inventoryModel.getByID(csvItemID);
      if (!item) item = await inventoryModel.findByImportKey(trackingType, csvSerial, csvCommonName, csvModelNumber)
        .then(id => id ? inventoryModel.getByID(id) : null);

      if (!item) {
        summary.errors++;
        plan.push({ action: 'error', rowNum, display: { siteName: site.SiteName, siteNumber: site.SiteNumber, serialNumber: csvSerial, commonName: csvCommonName }, message: 'Inventory item not found' });
        continue;
      }

      const csvNotes    = norm(row['InstallNotes']);
      const csvQuantity = parseInt(row['Quantity'] || '', 10) || (item.TrackingType === 'bulk' ? 1 : null);

      // Check if already installed at this site
      const existingSiID = await siteInventoryModel.findBySiteAndItem(site.SiteID, item.ItemID);

      if (existingSiID) {
        // Compare notes and quantity for bulk
        const existing = await siteInventoryModel.getByID(existingSiID);
        const diff = [];
        if (norm(existing.InstallNotes) !== csvNotes) diff.push({ field: 'Install Notes', from: existing.InstallNotes, to: csvNotes });
        if (item.TrackingType === 'bulk' && existing.Quantity !== csvQuantity) diff.push({ field: 'Quantity', from: existing.Quantity, to: csvQuantity });

        if (diff.length === 0) {
          summary.skipped++;
          plan.push({ action: 'skip', rowNum, display: { siteName: site.SiteName, siteNumber: site.SiteNumber, label: item.SerialNumber || item.CommonName }, message: 'No changes' });
        } else {
          summary.updated++;
          plan.push({ action: 'update', rowNum, display: { siteName: site.SiteName, siteNumber: site.SiteNumber, label: item.SerialNumber || item.CommonName }, existingSiID, data: { installNotes: csvNotes, quantity: csvQuantity }, diff });
        }
      } else {
        summary.created++;
        plan.push({ action: 'create', rowNum, display: { siteName: site.SiteName, siteNumber: site.SiteNumber, label: item.SerialNumber || item.CommonName }, siteID: site.SiteID, itemID: item.ItemID, data: { installNotes: csvNotes, quantity: csvQuantity } });
      }
    }

    res.render('sites/equipment-import-preview', { title: 'Import Site Equipment — Preview', summary, plan, importPlan: JSON.stringify(plan) });
  } catch (err) {
    next(err);
  }
});

// ── POST /equipment/import/confirm — execute plan ─────────────────────────────
router.post('/equipment/import/confirm', canImportExport, async (req, res, next) => {
  try {
    const plan    = JSON.parse(req.body.importPlan || '[]');
    const results = { total: 0, created: 0, updated: 0, skipped: 0, errors: 0, rows: [] };

    for (const entry of plan) {
      if (entry.action === 'skip') { results.skipped++; continue; }
      if (entry.action === 'error') {
        results.errors++;
        results.rows.push({ rowNum: entry.rowNum, ...entry.display, result: 'error', message: entry.message });
        continue;
      }
      results.total++;
      try {
        if (entry.action === 'update') {
          await siteInventoryModel.updateInstallation(entry.existingSiID, entry.data, req.auditContext);
          results.updated++;
          results.rows.push({ rowNum: entry.rowNum, ...entry.display, result: 'updated' });
        } else {
          await siteInventoryModel.createInstallRecord(entry.siteID, entry.itemID, entry.data, req.auditContext);
          results.created++;
          results.rows.push({ rowNum: entry.rowNum, ...entry.display, result: 'created' });
        }
      } catch (err) {
        results.errors++;
        results.rows.push({ rowNum: entry.rowNum, ...entry.display, result: 'error', message: err.message || 'Database error' });
      }
    }

    res.render('sites/equipment-import', { title: 'Import Site Equipment', results });
  } catch (err) {
    next(err);
  }
});

// ── GET /:id — site detail ────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.id, 10);

    const [site, inventory, recentLogs, documents, pmSchedules, inStockItems, categories, stockLocations, allUsers, pmVendors, networkResources, networkDeviceTypes, circuitTypes, commonNames, modelNumbers, manufacturers, inventoryStatuses, installableSystems] = await Promise.all([
      siteModel.getByID(siteID),
      siteInventoryModel.getCurrentItems(siteID),
      logModel.getBySite(siteID, { pageSize: 10 }).then(r => r.rows),
      documentModel.getBySite(siteID),
      pmModel.getBySite(siteID),
      inventoryModel.getInStock(),
      lookupModel.getInventoryCategories(),
      lookupModel.getStockLocations(),
      userModel.getAll(),
      vendorModel.getPMEnabled(),
      networkResourceModel.getBySite(siteID),
      lookupModel.getNetworkDeviceTypes(),
      lookupModel.getCircuitTypes(),
      lookupModel.getInventoryCommonNames(),
      lookupModel.getInventoryModelNumbers(),
      lookupModel.getInventoryManufacturers(),
      lookupModel.getInventoryStatuses(),
      inventoryModel.getSystemsList(),
    ]);

    // Fetch subsites for parent sites; subsites themselves get an empty array
    const subsites = (site && !site.ParentSiteID)
      ? await siteModel.getSubsites(siteID)
      : [];

    // For parent sites, also fetch each subsite's installed equipment and network resources
    const [subsiteInventory, subsiteNetworkResources] = subsites.length
      ? await Promise.all([
          Promise.all(subsites.map(sub =>
            siteInventoryModel.getCurrentItems(sub.SiteID).then(items => ({ sub, items }))
          )),
          Promise.all(subsites.map(sub =>
            networkResourceModel.getBySite(sub.SiteID).then(resources => ({ sub, resources }))
          )),
        ])
      : [[], []];

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

    const roles = req.user?.roles || [];
    const isAdmin = roles.includes('Admin');
    const isNetworkMapUpdater = !isAdmin && roles.includes('NetworkMapUpdater');
    const canWriteFlag = isAdmin || roles.includes('Technician') || roles.includes('Contractor') || isNetworkMapUpdater;

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
      pmVendors,
      networkResources,
      subsiteNetworkResources,
      networkDeviceTypes,
      circuitTypes,
      commonNames,
      modelNumbers,
      manufacturers,
      inventoryStatuses,
      installableSystems,
      isAdminUser:          isAdmin,
      isNetworkMapUpdater:  isNetworkMapUpdater,
      canWrite:             canWriteFlag,
      uploadUrl:   `/documents/upload`,
      canUpload:   canWriteFlag,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /:id/edit — edit form ─────────────────────────────────────────────────
router.get('/:id/edit', canManageNetworkMap, async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.id, 10);
    const [site, siteTypes, monitoringLocationTypes] = await Promise.all([
      siteModel.getByID(siteID),
      lookupModel.getSiteTypes(),
      lookupModel.getMonitoringLocationTypes(),
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
      monitoringLocationTypes,
      parentSiteID:   site.ParentSiteID   || null,
      parentSiteName: site.ParentSiteName || null,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /:id — update site ───────────────────────────────────────────────────
router.post('/:id', canManageNetworkMap, async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.id, 10);
    const { siteName } = req.body;

    if (!siteName || !siteName.trim()) {
      req.flash('error', 'Site Name is required.');
      return res.redirect(`/sites/${siteID}/edit`);
    }

    const site = await siteModel.update(siteID, {
      siteName:                 siteName.trim(),
      siteNumber:               req.body.siteNumber              || null,
      contractNumber:           req.body.contractNumber          || null,
      siteTypeID:               req.body.siteTypeID              || null,
      address:                  req.body.address                 || null,
      city:                     req.body.city                    || null,
      state:                    req.body.state                   || null,
      zipCode:                  req.body.zipCode                 || null,
      latitude:                 req.body.latitude                || null,
      longitude:                req.body.longitude               || null,
      description:              req.body.description             || null,
      warrantyExpires:          req.body.warrantyExpires         || null,
      parentSiteID:             req.body.parentSiteID            || null,
      monitoringLocationTypeID: req.body.monitoringLocationTypeID || null,
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
    const { mode, itemID, installNotes, quantity, pulledFrom, trackingType, serialNumber, assetTag, partNumber, commonName, modelNumber, manufacturer, categoryID, statusID, purchaseDate, warrantyExpires, description, notes, relatedSystemID } = req.body;

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
      const isBulk = trackingType === 'bulk';
      if (!isBulk && !serialNumber?.trim()) {
        req.flash('error', 'Serial number is required.');
        return res.redirect(`/sites/${siteID}#equipment`);
      }
      if (isBulk && !commonName?.trim()) {
        req.flash('error', 'Common name is required for bulk items.');
        return res.redirect(`/sites/${siteID}#equipment`);
      }
      const deployedStatus = await lookupModel.getInventoryStatusByName('Deployed');
      const resolvedStatusID = statusID || deployedStatus?.StatusID || null;
      const newItem = await inventoryModel.create({
        trackingType:    isBulk ? 'bulk' : 'serialized',
        commonName:      commonName      || null,
        serialNumber:    isBulk ? null : serialNumber.trim(),
        assetTag:        assetTag        || null,
        partNumber:      partNumber      || null,
        modelNumber:     modelNumber     || null,
        manufacturer:    manufacturer    || null,
        categoryID:      categoryID      || null,
        statusID:        resolvedStatusID,
        purchaseDate:    purchaseDate    || null,
        warrantyExpires: warrantyExpires || null,
        description:     description     || null,
        notes:           notes           || null,
        relatedSystemID: relatedSystemID || null,
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

    // Remove the old item (skip its own log — the install will write a single "Replaced" entry)
    await siteInventoryModel.removeItem(siID, { removedByUserID: req.user?.UserID, skipLog: true }, req.auditContext);

    // Install the replacement with a combined "Replaced" log entry
    await siteInventoryModel.installItem(
      siteID,
      parseInt(replacementItemID, 10),
      {
        installedAt:      new Date(),
        installedByUserID: req.user?.UserID,
        installNotes:     installNotes || null,
        isReplacement:    true,
        replacedItemID:   oldSI.ItemID,
      },
      req.auditContext,
    );

    // Optionally start an RMA for the removed item
    if (startRepair === '1' || startRepair === 'on') {
      const repair = await repairModel.create({
        itemID:          oldSI.ItemID,
        siteInventoryID: siID,
        reason:          repairReason || 'Replaced at site',
        sentByUserID:    req.user?.UserID,
        assignedUserID:  req.user?.UserID,
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

    // Remove the faulty units (skip their own logs — one combined "Replaced" entry follows)
    // Also remove them from the total (markReceived will add them back if RMA received)
    await siteInventoryModel.removeBulkQuantity(siteID, itemID, replaceQty,
      { removedByUserID: req.user?.UserID, skipLog: true }, req.auditContext);
    await inventoryModel.adjustQuantityTotal(itemID, -replaceQty);

    // Install replacement units with a combined "Replaced" log entry
    await siteInventoryModel.installItem(siteID, itemID, {
      installedAt:          new Date(),
      installedByUserID:    req.user?.UserID,
      installNotes:         installNotes || null,
      pulledFromLocationID,
      pulledFromUserID,
      isReplacement:        true,
      replacedQty:          replaceQty,
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
          reason:        repairReason.trim(),
          sentByUserID:  req.user?.UserID,
          assignedUserID: req.user?.UserID,
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
    const disposition = req.body.disposition === 'delete' ? 'delete' : 'return';
    await siteInventoryModel.removeBulkQuantity(siteID, itemID, quantity, { removedByUserID: req.user?.UserID, disposition }, req.auditContext);
    if (req.body.disposition === 'delete') {
      await inventoryModel.adjustQuantityTotal(itemID, -quantity);
      req.flash('success', `${quantity} unit(s) removed from site and deleted from inventory.`);
    } else {
      req.flash('success', `${quantity} unit(s) removed from site and returned to inventory.`);
    }
    res.redirect(`/sites/${siteID}#equipment`);
  } catch (err) {
    if (err.userMessage) {
      req.flash('error', err.userMessage);
      return res.redirect(`/sites/${req.params.id}#equipment`);
    }
    next(err);
  }
});

// ── Network Resources sub-routes ──────────────────────────────────────────────

// GET /:id/network-resources — list as JSON (consumed by detail page JS)
router.get('/:id/network-resources', async (req, res, next) => {
  try {
    const siteID    = parseInt(req.params.id, 10);
    const resources = await networkResourceModel.getBySite(siteID);
    res.json(resources);
  } catch (err) { next(err); }
});

// POST /:id/network-resources — create
router.post('/:id/network-resources', canManageNetworkMap, async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.id, 10);
    const { hostname, ipAddress, deviceTypeID, alertStatus,
            solarwindsNodeId, circuitTypeID, circuitID, notes, sortOrder } = req.body;

    if (!hostname?.trim()) {
      return res.status(400).json({ error: 'Hostname is required.' });
    }
    if (!deviceTypeID) {
      return res.status(400).json({ error: 'Device Type is required.' });
    }

    const resource = await networkResourceModel.create(siteID, {
      hostname:         hostname.trim(),
      ipAddress:        ipAddress        || null,
      deviceTypeID:     parseInt(deviceTypeID, 10),
      alertStatus:      alertStatus !== '0' && alertStatus !== 'false',
      solarwindsNodeId: solarwindsNodeId || null,
      circuitTypeID:    circuitTypeID    || null,
      circuitID:        circuitID        || null,
      notes:            notes            || null,
      sortOrder:        sortOrder        || 0,
    }, req.auditContext);

    res.status(201).json(resource);
  } catch (err) { next(err); }
});

// POST /:id/network-resources/:resID — update
router.post('/:id/network-resources/:resID', canManageNetworkMap, async (req, res, next) => {
  try {
    const siteID  = parseInt(req.params.id,    10);
    const resID   = parseInt(req.params.resID, 10);
    const { hostname, ipAddress, deviceTypeID, alertStatus,
            solarwindsNodeId, circuitTypeID, circuitID, notes, sortOrder } = req.body;

    const existing = await networkResourceModel.getByID(resID);
    if (!existing || existing.SiteID !== siteID) {
      return res.status(404).json({ error: 'Network resource not found.' });
    }
    if (!hostname?.trim()) {
      return res.status(400).json({ error: 'Hostname is required.' });
    }
    if (!deviceTypeID) {
      return res.status(400).json({ error: 'Device Type is required.' });
    }

    const resource = await networkResourceModel.update(resID, {
      hostname:         hostname.trim(),
      ipAddress:        ipAddress        || null,
      deviceTypeID:     parseInt(deviceTypeID, 10),
      alertStatus:      alertStatus !== '0' && alertStatus !== 'false',
      solarwindsNodeId: solarwindsNodeId || null,
      circuitTypeID:    circuitTypeID    || null,
      circuitID:        circuitID        || null,
      notes:            notes            || null,
      sortOrder:        sortOrder        || 0,
    }, req.auditContext);

    res.json(resource);
  } catch (err) { next(err); }
});

// POST /:id/network-resources/:resID/delete — soft delete
router.post('/:id/network-resources/:resID/delete', canManageNetworkMap, async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.id,    10);
    const resID  = parseInt(req.params.resID, 10);

    const existing = await networkResourceModel.getByID(resID);
    if (!existing || existing.SiteID !== siteID) {
      return res.status(404).json({ error: 'Network resource not found.' });
    }

    await networkResourceModel.softDelete(resID, req.auditContext);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
