'use strict';

const express   = require('express');
const { isAuthenticated, isAdmin, canWrite } = require('../middleware/auth');
const pmModel   = require('../models/pmModel');
const logModel  = require('../models/logModel');
const lookupModel = require('../models/lookupModel');
const push        = require('../services/pushService');
const router    = express.Router();

router.use(isAuthenticated);

// Helper: parse "user:123" or "vendor:456" → { assignedUserID, assignedVendorID }
function parseAssignedTo(value) {
  if (!value) return { assignedUserID: null, assignedVendorID: null };
  if (value.startsWith('user:'))   return { assignedUserID:   parseInt(value.split(':')[1], 10) || null, assignedVendorID: null };
  if (value.startsWith('vendor:')) return { assignedUserID:   null, assignedVendorID: parseInt(value.split(':')[1], 10) || null };
  return { assignedUserID: null, assignedVendorID: null };
}

// POST /sites/:siteID/pm — create PM schedule
router.post('/sites/:siteID/pm', isAdmin, async (req, res, next) => {
  try {
    const siteID = parseInt(req.params.siteID);
    const { title, frequencyDays, nextPMDate, assignedTo, notes } = req.body;

    if (!title?.trim() || !frequencyDays) {
      req.flash('error', 'Title and frequency are required.');
      return res.redirect(`/sites/${siteID}?tab=pm`);
    }

    const freqDays = parseInt(frequencyDays);
    let lastPerformedAt = null;
    if (nextPMDate) {
      const d = new Date(nextPMDate);
      d.setDate(d.getDate() - freqDays);
      lastPerformedAt = d;
    }

    const { assignedUserID, assignedVendorID } = parseAssignedTo(assignedTo);

    await pmModel.create({
      siteID, title: title.trim(),
      frequencyDays: freqDays,
      lastPerformedAt,
      assignedUserID,
      assignedVendorID,
      notes: notes || null,
    }, req.auditContext);

    req.flash('success', 'PM schedule created.');
    if (assignedUserID && assignedUserID !== req.user.UserID) {
      push.sendToUser(assignedUserID, {
        title: 'PM Schedule Assigned',
        body: `${title.trim()} has been assigned to you`,
        url: `/mobile/sites/${siteID}?tab=pm`,
      }).catch(() => {});
    }
    res.redirect(`/sites/${siteID}?tab=pm`);
  } catch (err) { next(err); }
});

// POST /sites/:siteID/pm/:scheduleID — update PM schedule
router.post('/sites/:siteID/pm/:scheduleID', isAdmin, async (req, res, next) => {
  try {
    const siteID     = parseInt(req.params.siteID);
    const scheduleID = parseInt(req.params.scheduleID);
    const { action, title, frequencyDays, nextPMDate, assignedTo, notes, performedDate } = req.body;

    if (action === 'delete') {
      await pmModel.delete(scheduleID, req.auditContext);
      req.flash('success', 'PM schedule deleted.');
    } else if (action === 'complete') {
      const date = performedDate ? new Date(performedDate) : new Date();
      await pmModel.markCompleted(scheduleID, date, req.auditContext);

      // Create a corresponding log entry
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
      req.flash('success', 'PM marked as completed and log entry created.');
    } else {
      const freqDays = parseInt(frequencyDays);
      let lastPerformedAt = undefined; // undefined = keep existing value
      if (nextPMDate) {
        const d = new Date(nextPMDate);
        d.setDate(d.getDate() - freqDays);
        lastPerformedAt = d;
      }
      const existingPM = await pmModel.getByID(scheduleID);
      const { assignedUserID, assignedVendorID } = parseAssignedTo(assignedTo);
      await pmModel.update(scheduleID, {
        title: title?.trim(), frequencyDays: freqDays,
        lastPerformedAt,
        assignedUserID,
        assignedVendorID,
        notes: notes || null,
      }, req.auditContext);
      req.flash('success', 'PM schedule updated.');
      const newPMAssignedID = assignedUserID;
      if (newPMAssignedID && newPMAssignedID !== (existingPM && existingPM.AssignedUserID) && newPMAssignedID !== req.user.UserID) {
        push.sendToUser(newPMAssignedID, {
          title: 'PM Schedule Assigned',
          body: `${title?.trim() || (existingPM && existingPM.Title) || 'PM'} has been assigned to you`,
          url: `/mobile/sites/${siteID}?tab=pm`,
        }).catch(() => {});
      }
    }

    res.redirect(`/sites/${siteID}?tab=pm`);
  } catch (err) { next(err); }
});

module.exports = router;
