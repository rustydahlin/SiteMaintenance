'use strict';

const express       = require('express');
const multer        = require('multer');
const router        = express.Router();
const logModel      = require('../models/logModel');
const siteModel     = require('../models/siteModel');
const lookupModel   = require('../models/lookupModel');
const documentModel = require('../models/documentModel');
const emailService  = require('../services/emailService');
const { isAuthenticated, isAdmin, canWrite } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// All routes require authentication
router.use(isAuthenticated);

// ── GET /sites/:siteID/logs — redirect to site detail logs tab ────────────────
router.get('/sites/:siteID/logs', async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.siteID, 10);
    res.redirect(`/sites/${siteID}#logs`);
  } catch (err) {
    next(err);
  }
});

// ── GET /sites/:siteID/logs/new — new log form ────────────────────────────────
router.get('/sites/:siteID/logs/new', canWrite, async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.siteID, 10);
    const [site, logTypes] = await Promise.all([
      siteModel.getByID(siteID),
      lookupModel.getLogTypes(),
    ]);

    if (!site) {
      req.flash('error', 'Site not found.');
      return res.redirect('/sites');
    }

    res.render('logs/form', {
      title:    `New Log Entry — ${site.SiteName}`,
      log:      null,
      site,
      action:   `/sites/${siteID}/logs`,
      logTypes,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /sites/:siteID/logs — create log entry ───────────────────────────────
router.post('/sites/:siteID/logs', canWrite, upload.array('files', 20), async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.siteID, 10);
    const site = await siteModel.getByID(siteID);

    if (!site) {
      req.flash('error', 'Site not found.');
      return res.redirect('/sites');
    }

    const { logTypeID, entryDate, subject, performedBy, description, notes } = req.body;

    if (!logTypeID) {
      req.flash('error', 'Log Type is required.');
      return res.redirect(`/sites/${siteID}/logs/new`);
    }
    if (!entryDate) {
      req.flash('error', 'Entry Date is required.');
      return res.redirect(`/sites/${siteID}/logs/new`);
    }

    const log = await logModel.create({
      siteID,
      logTypeID,
      entryDate,
      subject:      subject      || null,
      performedBy:  performedBy  || null,
      description:  description  || null,
      notes:        notes        || null,
      createdByUserID: req.auditContext.userID || null,
    }, req.auditContext);

    // Send email notification (non-fatal)
    try {
      await emailService.notifyNewLogEntry({ site, log });
    } catch (emailErr) {
      // log but do not block the user
      console.error('Email notification failed:', emailErr.message);
    }

    // Save any uploaded attachments
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await documentModel.create({
          originalFilename:  file.originalname,
          mimeType:          file.mimetype,
          fileSizeBytes:     file.size,
          fileBuffer:        file.buffer,
          logEntryID:        log.LogEntryID,
          uploadedByUserID:  req.auditContext?.userID || null,
        }, req.auditContext);
      }
    }

    req.flash('success', 'Log entry created successfully.');
    res.redirect(`/sites/${siteID}/logs/${log.LogEntryID}`);
  } catch (err) {
    next(err);
  }
});

// ── GET /sites/:siteID/logs/:logID — log detail ───────────────────────────────
router.get('/sites/:siteID/logs/:logID', async (req, res, next) => {
  try {
    const siteID  = parseInt(req.params.siteID, 10);
    const logID   = parseInt(req.params.logID, 10);

    const [site, log, documents] = await Promise.all([
      siteModel.getByID(siteID),
      logModel.getByID(logID),
      documentModel.getByLogEntry(logID),
    ]);

    if (!site || !log) {
      req.flash('error', 'Log entry not found.');
      return res.redirect(`/sites/${siteID}`);
    }

    const isAdminUser  = req.user && req.user.roles && req.user.roles.includes('Admin');
    const canWriteFlag = req.user && req.user.roles &&
      (req.user.roles.includes('Admin') || req.user.roles.includes('Technician') || req.user.roles.includes('Contractor'));

    res.render('logs/detail', {
      title:       log.Subject || `Log Entry #${logID}`,
      site,
      log,
      documents,
      isAdminUser,
      canWrite:    canWriteFlag,
      uploadUrl:   `/documents/upload`,
      canUpload:   canWriteFlag,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /sites/:siteID/logs/:logID/edit — edit form ──────────────────────────
router.get('/sites/:siteID/logs/:logID/edit', canWrite, async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.siteID, 10);
    const logID  = parseInt(req.params.logID, 10);

    const [site, log, logTypes] = await Promise.all([
      siteModel.getByID(siteID),
      logModel.getByID(logID),
      lookupModel.getLogTypes(),
    ]);

    if (!site || !log) {
      req.flash('error', 'Log entry not found.');
      return res.redirect(`/sites/${siteID}`);
    }

    res.render('logs/form', {
      title:    `Edit Log Entry — ${site.SiteName}`,
      log,
      site,
      action:   `/sites/${siteID}/logs/${logID}`,
      logTypes,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /sites/:siteID/logs/:logID — update log entry ───────────────────────
router.post('/sites/:siteID/logs/:logID', canWrite, upload.none(), async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.siteID, 10);
    const logID  = parseInt(req.params.logID, 10);

    const { logTypeID, entryDate, subject, performedBy, description, notes } = req.body;

    if (!logTypeID) {
      req.flash('error', 'Log Type is required.');
      return res.redirect(`/sites/${siteID}/logs/${logID}/edit`);
    }

    await logModel.update(logID, {
      siteID,
      logTypeID,
      entryDate,
      subject:     subject     || null,
      performedBy: performedBy || null,
      description: description || null,
      notes:       notes       || null,
    }, req.auditContext);

    req.flash('success', 'Log entry updated successfully.');
    res.redirect(`/sites/${siteID}/logs/${logID}`);
  } catch (err) {
    next(err);
  }
});

// ── POST /sites/:siteID/logs/:logID/delete — delete log ──────────────────────
router.post('/sites/:siteID/logs/:logID/delete', isAdmin, async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.siteID, 10);
    const logID  = parseInt(req.params.logID, 10);

    await logModel.delete(logID, req.auditContext);
    req.flash('success', 'Log entry deleted.');
    res.redirect(`/sites/${siteID}#logs`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
