'use strict';

const express      = require('express');
const multer       = require('multer');
const XLSX         = require('xlsx');
const router       = express.Router();
const vendorModel  = require('../models/vendorModel');
const { isAuthenticated, isAdmin, canImportExport } = require('../middleware/auth');

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.(xlsx|xls)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Only .xlsx and .xls files are accepted'));
  },
});

router.use((_req, res, next) => {
  if (!res.locals.vendorsEnabled) return res.status(404).render('errors/404', { title: 'Not Found' });
  next();
});

router.use(isAuthenticated);

// ── GET / — list ──────────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { search = '', includeInactive = '' } = req.query;
    const vendors = await vendorModel.getAll({ search, includeInactive: includeInactive === '1' });
    res.render('vendors/index', { title: 'Vendors / Contractors', vendors, search, includeInactive: includeInactive === '1' });
  } catch (err) { next(err); }
});

// ── GET /export — download Excel ──────────────────────────────────────────────
router.get('/export', canImportExport, async (req, res, next) => {
  try {
    const vendors = await vendorModel.getAll({ includeInactive: true });

    const vendorRows = vendors.map(v => ({
      VendorName: v.VendorName || '',
      Phone:      v.Phone      || '',
      Email:      v.Email      || '',
      Address:    v.Address    || '',
      City:       v.City       || '',
      State:      v.State      || '',
      Zip:        v.Zip        || '',
      Website:    v.Website    || '',
      DoesPMWork: v.DoesPMWork ? 'Yes' : 'No',
      IsActive:   v.IsActive   ? 'Yes' : 'No',
    }));

    // Collect all contacts with vendor name for reference
    const contactRows = [];
    for (const v of vendors) {
      const full = await vendorModel.getByID(v.VendorID);
      for (const c of full.contacts) {
        contactRows.push({
          VendorName:      v.VendorName,
          FirstName:       c.FirstName       || '',
          LastName:        c.LastName        || '',
          Title:           c.Title           || '',
          Phone:           c.Phone           || '',
          Email:           c.Email           || '',
          ReceivePMEmails: c.ReceivePMEmails ? 'Yes' : 'No',
          Notes:           c.Notes           || '',
        });
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(vendorRows),  'Vendors');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(contactRows), 'Contacts');
    const buf  = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const date = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="vendors-export-${date}.xlsx"`);
    res.send(buf);
  } catch (err) { next(err); }
});

// ── GET /import/template ──────────────────────────────────────────────────────
router.get('/import/template', canImportExport, (_req, res) => {
  const wb = XLSX.utils.book_new();

  const vendorHeaders   = ['VendorName', 'Phone', 'Email', 'Address', 'City', 'State', 'Zip', 'Website', 'DoesPMWork', 'Notes'];
  const contactHeaders  = ['VendorName', 'FirstName', 'LastName', 'Title', 'Phone', 'Email', 'ReceivePMEmails', 'Notes'];

  const wsV = XLSX.utils.aoa_to_sheet([vendorHeaders]);
  wsV['!cols'] = vendorHeaders.map(h => ({ wch: Math.max(h.length + 4, 16) }));

  const wsC = XLSX.utils.aoa_to_sheet([contactHeaders]);
  wsC['!cols'] = contactHeaders.map(h => ({ wch: Math.max(h.length + 4, 16) }));

  XLSX.utils.book_append_sheet(wb, wsV, 'Vendors');
  XLSX.utils.book_append_sheet(wb, wsC, 'Contacts');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="vendors_import_template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ── GET /import ───────────────────────────────────────────────────────────────
router.get('/import', canImportExport, (_req, res) => {
  res.render('vendors/import', { title: 'Import Vendors', results: null });
});

// ── POST /import — dry-run preview ────────────────────────────────────────────
router.post('/import', canImportExport, importUpload.single('importFile'), async (req, res, next) => {
  try {
    if (!req.file) {
      req.flash('error', 'Please select a file to upload.');
      return res.redirect('/vendors/import');
    }

    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets['Vendors'] || wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (rows.length === 0) {
      req.flash('error', 'The Vendors sheet appears to be empty.');
      return res.redirect('/vendors/import');
    }

    const norm = v => (v == null || v === '') ? null : String(v).trim();

    const plan    = [];
    const summary = { total: rows.length, created: 0, updated: 0, skipped: 0, removed: 0, errors: 0 };

    for (let i = 0; i < rows.length; i++) {
      const row        = rows[i];
      const rowNum     = i + 2;
      const vendorName = (row['VendorName'] || '').toString().trim();

      if (!vendorName) {
        summary.skipped++;
        plan.push({ action: 'skip', rowNum, display: { vendorName: '' }, message: 'VendorName is blank' });
        continue;
      }

      const doesPMWork = (row['DoesPMWork'] || '').toString().toLowerCase();
      const data = {
        vendorName,
        phone:      norm(row['Phone']),
        email:      norm(row['Email']),
        address:    norm(row['Address']),
        city:       norm(row['City']),
        state:      norm(row['State']),
        zip:        norm(row['Zip']),
        website:    norm(row['Website']),
        notes:      norm(row['Notes']),
        doesPMWork: doesPMWork === 'yes' || doesPMWork === '1' || doesPMWork === 'true',
      };

      const existingID = await vendorModel.findByName(vendorName);
      if (existingID) {
        const existing = await vendorModel.getByID(existingID);
        const diff = [
          ['Vendor Name', norm(existing.VendorName), data.vendorName],
          ['Phone',       norm(existing.Phone),       data.phone],
          ['Email',       norm(existing.Email),       data.email],
          ['Address',     norm(existing.Address),     data.address],
          ['City',        norm(existing.City),        data.city],
          ['State',       norm(existing.State),       data.state],
          ['Zip',         norm(existing.Zip),         data.zip],
          ['Website',     norm(existing.Website),     data.website],
          ['Does PM',     existing.DoesPMWork ? 'Yes' : 'No', data.doesPMWork ? 'Yes' : 'No'],
        ].filter(([, from, to]) => from !== to)
         .map(([field, from, to]) => ({ field, from, to }));

        if (diff.length === 0) {
          summary.skipped++;
          plan.push({ action: 'skip', rowNum, display: { vendorName }, existingID, message: 'No changes' });
        } else {
          summary.updated++;
          plan.push({ action: 'update', rowNum, display: { vendorName }, existingID, data, diff });
        }
      } else {
        summary.created++;
        plan.push({ action: 'create', rowNum, display: { vendorName }, data });
      }
    }

    // Detect vendors in DB not matched by any CSV row
    const seenIDs   = new Set(plan.filter(e => e.existingID).map(e => e.existingID));
    const allVendors = await vendorModel.getAll({ includeInactive: false });
    for (const v of allVendors) {
      if (!seenIDs.has(v.VendorID)) {
        summary.removed++;
        plan.push({ action: 'remove', display: { vendorName: v.VendorName, city: v.City, state: v.State } });
      }
    }

    // ── Process Contacts sheet ────────────────────────────────────────────────
    const wsContacts = wb.Sheets['Contacts'];
    if (wsContacts) {
      const contactRows = XLSX.utils.sheet_to_json(wsContacts, { defval: '' });

      // Build vendorName → vendorID map from DB (active vendors only)
      const vendorNameMap = Object.fromEntries(
        allVendors.map(v => [v.VendorName.toLowerCase(), v.VendorID])
      );

      for (let i = 0; i < contactRows.length; i++) {
        const crow      = contactRows[i];
        const rowNum    = i + 2;
        const firstName  = (crow['FirstName']  || '').toString().trim();
        const vendorName = (crow['VendorName'] || '').toString().trim();

        if (!firstName || !vendorName) continue;

        const vendorID = vendorNameMap[vendorName.toLowerCase()];
        // Also check if a new vendor with this name is being created in this same import
        const isPendingVendor = !vendorID && plan.some(
          e => !e.entity && e.action === 'create' && e.data.vendorName.toLowerCase() === vendorName.toLowerCase()
        );

        if (!vendorID && !isPendingVendor) {
          summary.errors++;
          plan.push({ entity: 'contact', action: 'error', rowNum, display: { vendorName, firstName }, message: `Vendor "${vendorName}" not found` });
          continue;
        }

        const lastName   = norm(crow['LastName']);
        const contactData = {
          firstName,
          lastName,
          title:           norm(crow['Title']),
          phone:           norm(crow['Phone']),
          email:           norm(crow['Email']),
          receivePMEmails: (crow['ReceivePMEmails'] || '').toString().toLowerCase() === 'yes',
          notes:           norm(crow['Notes']),
        };

        const existingContactID = vendorID
          ? await vendorModel.findContact(vendorID, firstName, lastName)
          : null;

        if (existingContactID) {
          const existing = await vendorModel.getContactByID(existingContactID);
          const diff = [
            ['Last Name', norm(existing.LastName),  contactData.lastName],
            ['Title',     norm(existing.Title),      contactData.title],
            ['Phone',     norm(existing.Phone),      contactData.phone],
            ['Email',     norm(existing.Email),      contactData.email],
            ['PM Emails', existing.ReceivePMEmails ? 'Yes' : 'No', contactData.receivePMEmails ? 'Yes' : 'No'],
            ['Notes',     norm(existing.Notes),      contactData.notes],
          ].filter(([, from, to]) => from !== to)
           .map(([field, from, to]) => ({ field, from, to }));

          if (diff.length === 0) {
            plan.push({ entity: 'contact', action: 'skip', rowNum, display: { vendorName, firstName, lastName }, existingID: existingContactID, vendorID, message: 'No changes' });
          } else {
            summary.updated++;
            plan.push({ entity: 'contact', action: 'update', rowNum, display: { vendorName, firstName, lastName }, existingID: existingContactID, vendorID, data: contactData, diff });
          }
        } else {
          summary.created++;
          // vendorID is null when vendor is new in this same import — resolved at confirm time via pendingVendorName
          plan.push({ entity: 'contact', action: 'create', rowNum, display: { vendorName, firstName, lastName }, vendorID: vendorID || null, pendingVendorName: vendorID ? null : vendorName, data: contactData });
        }
      }
    }

    res.render('vendors/import-preview', {
      title: 'Import Vendors — Preview',
      summary, plan, importPlan: JSON.stringify(plan),
    });
  } catch (err) { next(err); }
});

// ── POST /import/confirm ──────────────────────────────────────────────────────
router.post('/import/confirm', canImportExport, async (req, res, next) => {
  try {
    const plan = JSON.parse(req.body.importPlan || '[]');
    const results = { total: plan.length, created: 0, updated: 0, skipped: 0, errors: 0, rows: [] };

    // Pass 1: create new vendors first, collecting their new IDs so contacts can reference them
    const newVendorIDMap = {}; // vendorName.lower → new VendorID
    for (const entry of plan) {
      if (entry.entity || entry.action !== 'create') continue;
      try {
        const vendor = await vendorModel.create(entry.data, req.auditContext);
        results.created++;
        newVendorIDMap[entry.data.vendorName.toLowerCase()] = vendor.VendorID;
        results.rows.push({ rowNum: entry.rowNum, ...entry.display, result: 'created', vendorID: vendor.VendorID });
      } catch (err) {
        results.errors++;
        results.rows.push({ rowNum: entry.rowNum, ...entry.display, result: 'error', message: err.message || 'Database error' });
      }
    }

    // Pass 2: vendor updates + all contacts (contacts for new vendors resolve via newVendorIDMap)
    for (const entry of plan) {
      if (entry.action === 'skip' || entry.action === 'remove') { results.skipped++; continue; }
      if (entry.action === 'error') { results.errors++; continue; }
      if (!entry.entity && entry.action === 'create') continue; // already done in pass 1
      try {
        if (entry.entity === 'contact') {
          const vendorID = entry.vendorID || newVendorIDMap[entry.pendingVendorName?.toLowerCase()];
          if (!vendorID) { results.errors++; continue; }
          if (entry.action === 'update') {
            await vendorModel.updateContact(entry.existingID, entry.data, req.auditContext);
          } else {
            await vendorModel.createContact(vendorID, entry.data, req.auditContext);
          }
          entry.action === 'update' ? results.updated++ : results.created++;
        } else {
          await vendorModel.update(entry.existingID, entry.data, req.auditContext);
          results.updated++;
          results.rows.push({ rowNum: entry.rowNum, ...entry.display, result: 'updated', vendorID: entry.existingID });
        }
      } catch (err) {
        results.errors++;
        results.rows.push({ rowNum: entry.rowNum, ...entry.display, result: 'error', message: err.message || 'Database error' });
      }
    }

    res.render('vendors/import', { title: 'Import Vendors', results });
  } catch (err) { next(err); }
});

// ── GET /new ──────────────────────────────────────────────────────────────────
router.get('/new', isAdmin, (_req, res) => {
  res.render('vendors/form', { title: 'New Vendor', vendor: null, action: '/vendors' });
});

// ── POST / — create ───────────────────────────────────────────────────────────
router.post('/', isAdmin, async (req, res, next) => {
  try {
    const { vendorName } = req.body;
    if (!vendorName?.trim()) {
      req.flash('error', 'Vendor Name is required.');
      return res.redirect('/vendors/new');
    }
    const vendor = await vendorModel.create({
      vendorName:  vendorName.trim(),
      phone:       req.body.phone      || null,
      email:       req.body.email      || null,
      address:     req.body.address    || null,
      city:        req.body.city       || null,
      state:       req.body.state      || null,
      zip:         req.body.zip        || null,
      website:     req.body.website    || null,
      notes:       req.body.notes      || null,
      doesPMWork:  req.body.doesPMWork === '1',
    }, req.auditContext);
    req.flash('success', `Vendor "${vendor.VendorName}" created.`);
    res.redirect(`/vendors/${vendor.VendorID}`);
  } catch (err) { next(err); }
});

// ── GET /:id — detail ─────────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const vendorID = parseInt(req.params.id, 10);
    const documentModel = require('../models/documentModel');
    const [vendor, documents] = await Promise.all([
      vendorModel.getByID(vendorID),
      documentModel.getByVendor(vendorID),
    ]);
    if (!vendor) {
      req.flash('error', 'Vendor not found.');
      return res.redirect('/vendors');
    }
    res.render('vendors/detail', { title: vendor.VendorName, vendor, documents });
  } catch (err) { next(err); }
});

// ── GET /:id/edit ─────────────────────────────────────────────────────────────
router.get('/:id/edit', isAdmin, async (req, res, next) => {
  try {
    const vendor = await vendorModel.getByID(parseInt(req.params.id, 10));
    if (!vendor) {
      req.flash('error', 'Vendor not found.');
      return res.redirect('/vendors');
    }
    res.render('vendors/form', { title: `Edit — ${vendor.VendorName}`, vendor, action: `/vendors/${vendor.VendorID}` });
  } catch (err) { next(err); }
});

// ── POST /:id — update ────────────────────────────────────────────────────────
router.post('/:id', isAdmin, async (req, res, next) => {
  try {
    const vendorID = parseInt(req.params.id, 10);
    const { vendorName } = req.body;
    if (!vendorName?.trim()) {
      req.flash('error', 'Vendor Name is required.');
      return res.redirect(`/vendors/${vendorID}/edit`);
    }
    const vendor = await vendorModel.update(vendorID, {
      vendorName:  vendorName.trim(),
      phone:       req.body.phone      || null,
      email:       req.body.email      || null,
      address:     req.body.address    || null,
      city:        req.body.city       || null,
      state:       req.body.state      || null,
      zip:         req.body.zip        || null,
      website:     req.body.website    || null,
      notes:       req.body.notes      || null,
      doesPMWork:  req.body.doesPMWork === '1',
    }, req.auditContext);
    req.flash('success', 'Vendor updated.');
    res.redirect(`/vendors/${vendor.VendorID}`);
  } catch (err) { next(err); }
});

// ── POST /:id/delete ──────────────────────────────────────────────────────────
router.post('/:id/delete', isAdmin, async (req, res, next) => {
  try {
    const vendorID = parseInt(req.params.id, 10);
    const vendor = await vendorModel.getByID(vendorID);
    if (!vendor) {
      req.flash('error', 'Vendor not found.');
      return res.redirect('/vendors');
    }
    await vendorModel.softDelete(vendorID, req.auditContext);
    req.flash('success', `Vendor "${vendor.VendorName}" deleted.`);
    res.redirect('/vendors');
  } catch (err) { next(err); }
});

// ── POST /:id/toggle-pm ───────────────────────────────────────────────────────
router.post('/:id/toggle-pm', isAdmin, async (req, res, next) => {
  try {
    await vendorModel.togglePMWork(parseInt(req.params.id, 10), req.auditContext);
    res.redirect(`/vendors/${req.params.id}`);
  } catch (err) { next(err); }
});

// ── POST /:id/contacts — create contact ───────────────────────────────────────
router.post('/:id/contacts', isAdmin, async (req, res, next) => {
  try {
    const vendorID = parseInt(req.params.id, 10);
    const { firstName } = req.body;
    if (!firstName?.trim()) {
      req.flash('error', 'First name is required.');
      return res.redirect(`/vendors/${vendorID}`);
    }
    await vendorModel.createContact(vendorID, {
      firstName:      firstName.trim(),
      lastName:       req.body.lastName       || null,
      title:          req.body.title          || null,
      phone:          req.body.phone          || null,
      email:          req.body.email          || null,
      receivePMEmails: req.body.receivePMEmails === '1',
      notes:          req.body.notes          || null,
    }, req.auditContext);
    req.flash('success', 'Contact added.');
    res.redirect(`/vendors/${vendorID}`);
  } catch (err) { next(err); }
});

// ── POST /:id/contacts/:cid — update contact ──────────────────────────────────
router.post('/:id/contacts/:cid', isAdmin, async (req, res, next) => {
  try {
    const vendorID  = parseInt(req.params.id, 10);
    const contactID = parseInt(req.params.cid, 10);
    const { firstName } = req.body;
    if (!firstName?.trim()) {
      req.flash('error', 'First name is required.');
      return res.redirect(`/vendors/${vendorID}`);
    }
    await vendorModel.updateContact(contactID, {
      firstName:      firstName.trim(),
      lastName:       req.body.lastName       || null,
      title:          req.body.title          || null,
      phone:          req.body.phone          || null,
      email:          req.body.email          || null,
      receivePMEmails: req.body.receivePMEmails === '1',
      notes:          req.body.notes          || null,
    }, req.auditContext);
    req.flash('success', 'Contact updated.');
    res.redirect(`/vendors/${vendorID}`);
  } catch (err) { next(err); }
});

// ── POST /:id/contacts/:cid/delete ───────────────────────────────────────────
router.post('/:id/contacts/:cid/delete', isAdmin, async (req, res, next) => {
  try {
    const vendorID  = parseInt(req.params.id, 10);
    const contactID = parseInt(req.params.cid, 10);
    await vendorModel.deleteContact(contactID, req.auditContext);
    req.flash('success', 'Contact removed.');
    res.redirect(`/vendors/${vendorID}`);
  } catch (err) { next(err); }
});

// ── POST /:id/contacts/:cid/toggle-email ─────────────────────────────────────
router.post('/:id/contacts/:cid/toggle-email', isAdmin, async (req, res, next) => {
  try {
    const vendorID  = parseInt(req.params.id, 10);
    const contactID = parseInt(req.params.cid, 10);
    await vendorModel.toggleContactEmail(contactID, req.auditContext);
    res.redirect(`/vendors/${vendorID}`);
  } catch (err) { next(err); }
});

module.exports = router;
