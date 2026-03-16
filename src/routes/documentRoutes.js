'use strict';

const express   = require('express');
const multer    = require('multer');
const { isAuthenticated, canWrite } = require('../middleware/auth');
const documentModel = require('../models/documentModel');
const logger    = require('../utils/logger');
const router    = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },  // 50 MB
  fileFilter: (_req, file, cb) => {
    // Allow images and common document types
    const allowed = /image\/|application\/pdf|application\/msword|application\/vnd\.|text\/plain/;
    if (allowed.test(file.mimetype)) return cb(null, true);
    cb(new Error('File type not allowed. Allowed: images, PDF, Word, text files.'));
  },
});

router.use(isAuthenticated);

// ── POST /documents/upload ────────────────────────────────────────────────────
router.post('/upload', canWrite, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      req.flash('error', 'No file uploaded.');
      return res.redirect('back');
    }

    const { entityType, entityId, description } = req.body;
    const id = parseInt(entityId);

    let logEntryID = null, siteID = null, itemID = null;
    if      (entityType === 'log')  logEntryID = id;
    else if (entityType === 'site') siteID     = id;
    else if (entityType === 'item') itemID     = id;
    else {
      req.flash('error', 'Invalid entity type.');
      return res.redirect('back');
    }

    await documentModel.create({
      originalFilename: req.file.originalname,
      mimeType:         req.file.mimetype,
      fileSizeBytes:    req.file.size,
      uploadedByUserID: req.user.UserID,
      description:      description || null,
      logEntryID, siteID, itemID,
      fileBuffer:       req.file.buffer,
    }, req.auditContext);

    req.flash('success', 'File uploaded successfully.');
    res.redirect('back');
  } catch (err) {
    if (err instanceof multer.MulterError || err.message?.includes('File type not allowed')) {
      req.flash('error', err.message);
      return res.redirect('back');
    }
    next(err);
  }
});

// ── GET /documents/:id/download ───────────────────────────────────────────────
router.get('/:id/download', async (req, res, next) => {
  try {
    const docID  = parseInt(req.params.id);
    const result = await documentModel.getFileData(docID);
    if (!result) return res.status(404).send('File not found.');

    // Audit the download
    const { writeAudit } = require('../models/auditModel');
    await writeAudit({ tableName: 'Documents', recordID: docID, action: 'DOWNLOAD',
      userID: req.user?.UserID, ip: req.ip, userAgent: req.headers['user-agent'] });

    res.setHeader('Content-Type',        result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.filename)}"`);
    res.setHeader('Content-Length',      result.buffer.length);
    res.send(result.buffer);
  } catch (err) { next(err); }
});

// ── POST /documents/:id/delete ────────────────────────────────────────────────
router.post('/:id/delete', canWrite, async (req, res, next) => {
  try {
    const docID = parseInt(req.params.id);
    const doc   = await documentModel.getMetadata(docID);
    if (!doc) { req.flash('error', 'File not found.'); return res.redirect('back'); }

    // Only admin or uploader can delete
    const isAdmin    = req.user.roles.includes('Admin');
    const isUploader = doc.UploadedByUserID === req.user.UserID;
    if (!isAdmin && !isUploader) {
      req.flash('error', 'You do not have permission to delete this file.');
      return res.redirect('back');
    }

    await documentModel.delete(docID, req.auditContext);
    req.flash('success', 'File deleted.');
    res.redirect('back');
  } catch (err) { next(err); }
});

module.exports = router;
