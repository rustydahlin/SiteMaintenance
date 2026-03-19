'use strict';

const express          = require('express');
const multer           = require('multer');
const XLSX             = require('xlsx');
const router           = express.Router();
const systemKeyModel   = require('../models/systemKeyModel');
const lookupModel      = require('../models/lookupModel');
const userModel        = require('../models/userModel');
const vendorModel      = require('../models/vendorModel');
const { canAccessSystemKeys, canImportExport } = require('../middleware/auth');

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.csv$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Only .csv files are accepted'));
  },
});

router.use((_req, res, next) => {
  if (!res.locals.systemKeysEnabled) return res.status(404).render('errors/404', { title: 'Not Found' });
  next();
});

router.use(canAccessSystemKeys);

// Normalizes any date value to 'YYYY-MM-DD' string or null.
// Handles: ISO strings, locale strings (e.g. "3/14/2026"), Excel serial numbers.
function parseDate(v) {
  if (!v && v !== 0) return null;
  let d;
  if (typeof v === 'number') {
    // Excel date serial: days since 1900-01-01 (with Excel leap-year bug offset)
    d = new Date(Math.round((v - 25569) * 86400 * 1000));
  } else {
    d = new Date(String(v).trim());
  }
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

// ── GET / — list ───────────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { search = '', sort = 'issuedTo', dir = 'asc',
            keyType = '', expiryStatus = '', manufacturerID = '' } = req.query;
    const [keys, manufacturers] = await Promise.all([
      systemKeyModel.getAll({
        search, sort, dir,
        keyType, expiryStatus, manufacturerID: manufacturerID ? parseInt(manufacturerID) : null,
      }),
      lookupModel.getKeyManufacturers(),
    ]);
    const filters = { search, sort, dir, keyType, expiryStatus, manufacturerID };
    res.render('system-keys/index', {
      title: 'System Keys', keys, manufacturers, filters, sort, dir,
    });
  } catch (err) { next(err); }
});

// ── GET /export — download CSV ─────────────────────────────────────────────────
router.get('/export', canImportExport, async (req, res, next) => {
  try {
    const keys = await systemKeyModel.getAll({});
    const rows = keys.map(k => ({
      SerialNumber:    k.SerialNumber      || '',
      IssuedTo:        k.IssuedToName      || '',
      IssuedToType:    k.IssuedToContactID ? 'contact' : 'user',
      Organization:    k.Organization      || '',
      DateIssued:      k.DateIssued        ? new Date(k.DateIssued).toISOString().split('T')[0]        : '',
      Manufacturer:    k.ManufacturerName  || '',
      ExpirationDate:  k.ExpirationDate    ? new Date(k.ExpirationDate).toISOString().split('T')[0]    : '',
      LastRenewalDate: k.LastRenewalDate   ? new Date(k.LastRenewalDate).toISOString().split('T')[0]   : '',
      KeyCode:         k.KeyCode           || '',
      KeyType:         k.KeyType           || '',
      Notes:           k.Notes             || '',
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'SystemKeys');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'csv' });

    res.setHeader('Content-Disposition', 'attachment; filename="system-keys.csv"');
    res.setHeader('Content-Type', 'text/csv');
    res.send(buf);
  } catch (err) { next(err); }
});

// ── GET /import/template ───────────────────────────────────────────────────────
router.get('/import/template', canImportExport, async (req, res, next) => {
  try {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
      SerialNumber: '', IssuedTo: '', IssuedToType: 'user', DateIssued: '',
      Manufacturer: '', ExpirationDate: '', KeyCode: '', KeyType: 'Unlimited', Notes: '',
    }]), 'SystemKeys');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'csv' });

    res.setHeader('Content-Disposition', 'attachment; filename="system-keys-import-template.csv"');
    res.setHeader('Content-Type', 'text/csv');
    res.send(buf);
  } catch (err) { next(err); }
});

// ── GET /import — upload form ──────────────────────────────────────────────────
router.get('/import', canImportExport, async (req, res, next) => {
  try {
    res.render('system-keys/import', { title: 'Import System Keys', result: null });
  } catch (err) { next(err); }
});

// ── POST /import — dry-run preview ────────────────────────────────────────────
router.post('/import', canImportExport, importUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      req.flash('error', 'No file uploaded.');
      return res.redirect('/system-keys/import');
    }

    const wb   = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws   = wb.Sheets['SystemKeys'] || wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    const manufacturers = await lookupModel.getKeyManufacturers(false);
    const mfgMap = Object.fromEntries(manufacturers.map(m => [m.ManufacturerName.toLowerCase(), m.ManufacturerID]));
    const users = await userModel.getAll({ includeInactive: false });
    const userMap = Object.fromEntries(users.map(u => [u.DisplayName.toLowerCase(), u.UserID]));
    const contacts = await vendorModel.getAllContacts();
    const contactMap = Object.fromEntries(contacts.map(c => {
      const name = `${c.FirstName} ${c.LastName || ''}`.trim().toLowerCase();
      return [name, c.ContactID];
    }));

    const plan = [];
    for (const row of rows) {
      const serial = String(row.SerialNumber || '').trim();
      if (!serial) { plan.push({ row, action: 'skip', reason: 'Missing SerialNumber' }); continue; }

      const existing      = await systemKeyModel.findBySerial(serial);
      const issuedToType  = String(row.IssuedToType || 'user').trim().toLowerCase();
      const issuedToName  = String(row.IssuedTo     || '').trim().toLowerCase();
      const mfgName       = String(row.Manufacturer || '').trim().toLowerCase();

      let issuedToUserID    = null;
      let issuedToContactID = null;
      if (issuedToName) {
        if (issuedToType === 'contact') {
          issuedToContactID = contactMap[issuedToName] || null;
        } else {
          issuedToUserID = userMap[issuedToName] || null;
        }
      }

      const data = {
        serialNumber:      serial,
        issuedToUserID,
        issuedToContactID,
        manufacturerID:    mfgName ? (mfgMap[mfgName] || null) : null,
        dateIssued:        parseDate(row.DateIssued),
        expirationDate:    parseDate(row.ExpirationDate),
        keyCode:           String(row.KeyCode  || '').trim() || null,
        keyType:           String(row.KeyType  || 'Unlimited').trim(),
        notes:             String(row.Notes    || '').trim() || null,
      };

      if (existing) {
        const diffs = [];
        if (existing.SerialNumber !== data.serialNumber)    diffs.push(`SerialNumber: "${existing.SerialNumber}" → "${data.serialNumber}"`);
        if (existing.KeyCode      !== data.keyCode)         diffs.push(`KeyCode: "${existing.KeyCode || ''}" → "${data.keyCode || ''}"`);
        if (existing.KeyType      !== data.keyType)         diffs.push(`KeyType: "${existing.KeyType}" → "${data.keyType}"`);
        plan.push({ row, action: 'update', keyID: existing.KeyID, serial, diffs, data });
      } else {
        plan.push({ row, action: 'create', serial, data });
      }
    }

    req.session.systemKeyImportPlan = plan;
    res.render('system-keys/import-preview', { title: 'Import Preview — System Keys', plan });
  } catch (err) { next(err); }
});

// ── POST /import/confirm — execute import ─────────────────────────────────────
router.post('/import/confirm', canImportExport, async (req, res, next) => {
  try {
    const plan = req.session.systemKeyImportPlan || [];
    const auditContext = { userID: req.user.UserID, username: req.user.Username };
    let created = 0, updated = 0, skipped = 0;

    for (const item of plan) {
      if (item.action === 'create') {
        await systemKeyModel.create(item.data, auditContext);
        created++;
      } else if (item.action === 'update') {
        await systemKeyModel.update(item.keyID, item.data, auditContext);
        updated++;
      } else {
        skipped++;
      }
    }

    delete req.session.systemKeyImportPlan;
    req.flash('success', `Import complete: ${created} created, ${updated} updated, ${skipped} skipped.`);
    res.redirect('/system-keys');
  } catch (err) { next(err); }
});

// ── GET /new — create form ─────────────────────────────────────────────────────
router.get('/new', async (req, res, next) => {
  try {
    const [manufacturers, users, contacts] = await Promise.all([
      lookupModel.getKeyManufacturers(),
      userModel.getAll({ includeInactive: false }),
      vendorModel.getAllContacts(),
    ]);
    res.render('system-keys/form', {
      title: 'New System Key', key: null, manufacturers, users, contacts,
    });
  } catch (err) { next(err); }
});

// ── POST / — create ────────────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const data = buildData(req.body);
    const auditContext = { userID: req.user.UserID, username: req.user.Username };
    const keyID = await systemKeyModel.create(data, auditContext);
    req.flash('success', 'System key created.');
    res.redirect(`/system-keys/${keyID}`);
  } catch (err) { next(err); }
});

// ── GET /:id — detail ──────────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const key = await systemKeyModel.getByID(parseInt(req.params.id));
    if (!key) return res.status(404).render('errors/404', { title: 'Not Found' });
    res.render('system-keys/detail', { title: `System Key — ${key.SerialNumber || key.KeyCode || key.KeyID}`, key });
  } catch (err) { next(err); }
});

// ── GET /:id/edit — edit form ──────────────────────────────────────────────────
router.get('/:id/edit', async (req, res, next) => {
  try {
    const [key, manufacturers, users, contacts] = await Promise.all([
      systemKeyModel.getByID(parseInt(req.params.id)),
      lookupModel.getKeyManufacturers(),
      userModel.getAll({ includeInactive: false }),
      vendorModel.getAllContacts(),
    ]);
    if (!key) return res.status(404).render('errors/404', { title: 'Not Found' });
    res.render('system-keys/form', { title: 'Edit System Key', key, manufacturers, users, contacts });
  } catch (err) { next(err); }
});

// ── POST /:id — update ─────────────────────────────────────────────────────────
router.post('/:id', async (req, res, next) => {
  try {
    const keyID = parseInt(req.params.id);
    const data  = buildData(req.body);
    const auditContext = { userID: req.user.UserID, username: req.user.Username };
    await systemKeyModel.update(keyID, data, auditContext);
    req.flash('success', 'System key updated.');
    res.redirect(`/system-keys/${keyID}`);
  } catch (err) { next(err); }
});

// ── POST /:id/delete — hard delete ────────────────────────────────────────────
router.post('/:id/delete', async (req, res, next) => {
  try {
    const keyID = parseInt(req.params.id);
    const auditContext = { userID: req.user.UserID, username: req.user.Username };
    await systemKeyModel.deleteKey(keyID, auditContext);
    req.flash('success', 'System key deleted.');
    res.redirect('/system-keys');
  } catch (err) { next(err); }
});

// ── POST /:id/renew ────────────────────────────────────────────────────────────
router.post('/:id/renew', async (req, res, next) => {
  try {
    const keyID = parseInt(req.params.id);
    const { lastRenewalDate, expirationDate, notes } = req.body;
    const auditContext = { userID: req.user.UserID, username: req.user.Username };
    await systemKeyModel.renew(keyID, { lastRenewalDate, expirationDate, notes }, auditContext);
    req.flash('success', 'Key renewed successfully.');
    res.redirect(`/system-keys/${keyID}`);
  } catch (err) { next(err); }
});

// ── Helpers ────────────────────────────────────────────────────────────────────
function buildData(body) {
  const issuedToType    = body.issuedToType || 'user';
  const issuedToID      = parseInt(body.issuedToID) || null;
  return {
    issuedToUserID:      issuedToType === 'user'    ? issuedToID : null,
    issuedToContactID:   issuedToType === 'contact' ? issuedToID : null,
    manufacturerID:      parseInt(body.manufacturerID) || null,
    dateIssued:          body.dateIssued     || null,
    expirationDate:      body.expirationDate || null,
    keyCode:             body.keyCode        || null,
    serialNumber:        body.serialNumber   || null,
    keyType:             body.keyType        || 'Unlimited',
    notes:               body.notes          || null,
  };
}

module.exports = router;
