'use strict';

const express   = require('express');
const { isAuthenticated, canManageNotifications } = require('../middleware/auth');
const userModel = require('../models/userModel');
const { body, validationResult } = require('express-validator');
const router = express.Router();

router.use(isAuthenticated);

router.get('/', async (req, res, next) => {
  try {
    const roles = req.user?.roles || [];
    const canNotify = roles.includes('Admin') || roles.includes('Notifications');
    const [profile, notifPrefs] = await Promise.all([
      userModel.findByID(req.user.UserID),
      canNotify ? userModel.getNotificationPrefs(req.user.UserID) : Promise.resolve({}),
    ]);
    res.render('users/profile', { title: 'My Profile', profile, notifPrefs, canNotify });
  } catch (err) { next(err); }
});

router.post('/notifications', canManageNotifications, async (req, res, next) => {
  try {
    const TYPES = [
      'pm.reminder', 'repair.followup', 'repair.overdue',
      'warranty.expiring', 'site.statusChange', 'log.new',
      'systemKey.expiring',
    ];
    const prefs = {};
    for (const t of TYPES) prefs[t] = req.body[t] === '1';
    await userModel.setNotificationPrefs(req.user.UserID, prefs);
    req.flash('success', 'Notification preferences saved.');
    res.redirect('/profile');
  } catch (err) { next(err); }
});

router.post('/password', [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
  body('confirmPassword').custom((val, { req }) => {
    if (val !== req.body.newPassword) throw new Error('Passwords do not match');
    return true;
  }),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg));
      return res.redirect('/profile');
    }

    const user = await userModel.findByID(req.user.UserID);
    if (user.AuthProvider !== 'local') {
      req.flash('error', 'Password changes are not available for SSO accounts.');
      return res.redirect('/profile');
    }

    const ok = await userModel.verifyPassword(user, req.body.currentPassword);
    if (!ok) {
      req.flash('error', 'Current password is incorrect.');
      return res.redirect('/profile');
    }

    await userModel.updatePassword(req.user.UserID, req.body.newPassword, req.auditContext);
    req.flash('success', 'Password changed successfully.');
    res.redirect('/profile');
  } catch (err) { next(err); }
});

module.exports = router;
