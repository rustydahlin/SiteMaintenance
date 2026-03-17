'use strict';

const express  = require('express');
const passport = require('passport');
const { body, validationResult } = require('express-validator');
const userModel  = require('../models/userModel');
const { writeAudit } = require('../models/auditModel');
const logger     = require('../utils/logger');
const router     = express.Router();

// ── GET /auth/login ───────────────────────────────────────────────────────────
router.get('/login', async (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/');
  const settings = require('../models/settingsModel');
  let ldapEnabled = false, oidcEnabled = false;
  try {
    [ldapEnabled, oidcEnabled] = await Promise.all([
      settings.getSettingsBool('ldap.enabled', 'LDAP_ENABLED'),
      settings.getSettingsBool('oidc.enabled', 'OIDC_ENABLED'),
    ]);
  } catch (_) {}
  res.render('auth/login', { title: 'Sign In', layout: 'layouts/auth', ldapEnabled, oidcEnabled });
});

// ── POST /auth/login (local) ──────────────────────────────────────────────────
router.post('/login',
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg));
      return res.redirect('/auth/login');
    }
    next();
  },
  (req, res, next) => {
    passport.authenticate('local', async (err, user, info) => {
      if (err) return next(err);
      if (!user) {
        await writeAudit({ tableName: 'Users', action: 'LOGIN_FAILED',
          notes: `username=${req.body.username}`,
          ip: req.ip, userAgent: req.headers['user-agent'] });
        req.flash('error', info?.message || 'Invalid credentials.');
        return res.redirect('/auth/login');
      }
      req.session.regenerate((err2) => {
        if (err2) return next(err2);
        req.logIn(user, async (err3) => {
          if (err3) return next(err3);
          await userModel.updateLastLogin(user.UserID);
          await writeAudit({ tableName: 'Users', recordID: user.UserID, action: 'LOGIN',
            userID: user.UserID, ip: req.ip, userAgent: req.headers['user-agent'] });
          logger.info(`Login: ${user.Username} (local)`);
          res.redirect(req.session.returnTo || '/');
        });
      });
    })(req, res, next);
  }
);

// ── POST /auth/ldap ───────────────────────────────────────────────────────────
router.post('/ldap', (req, res, next) => {
  passport.authenticate('ldapauth', async (err, user, info) => {
    if (err) {
      // Treat all LDAP errors as auth failures rather than 500s
      logger.warn(`LDAP auth error [${err.name}]: ${err.message}`);
      let msg = 'Invalid username or password.';
      if (err.name === 'InvalidCredentialsError') msg = 'Invalid username or password.';
      else msg = `LDAP error (${err.name}): ${err.message}`;
      req.flash('error', msg);
      return res.redirect('/auth/login');
    }
    if (!user) {
      req.flash('error', info?.message || 'LDAP authentication failed.');
      return res.redirect('/auth/login');
    }
    req.session.regenerate((err2) => {
      if (err2) return next(err2);
      req.logIn(user, async (err3) => {
        if (err3) return next(err3);
        await userModel.updateLastLogin(user.UserID);
        await writeAudit({ tableName: 'Users', recordID: user.UserID, action: 'LOGIN',
          userID: user.UserID, ip: req.ip, userAgent: req.headers['user-agent'], notes: 'ldap' });
        logger.info(`Login: ${user.Username} (ldap)`);
        res.redirect('/');
      });
    });
  })(req, res, next);
});

// ── GET /auth/oidc ────────────────────────────────────────────────────────────
router.get('/oidc', (req, res, next) => {
  passport.authenticate('openidconnect', { failureRedirect: '/auth/login' })(req, res, next);
});

// ── GET /auth/oidc/callback ───────────────────────────────────────────────────
router.get('/oidc/callback', (req, res, next) => {
  passport.authenticate('openidconnect', { failureRedirect: '/auth/login', failureFlash: true },
    async (err, user, _info) => {
      if (err) return next(err);
      if (!user) {
        req.flash('error', 'OIDC authentication failed.');
        return res.redirect('/auth/login');
      }
      req.session.regenerate((err2) => {
        if (err2) return next(err2);
        req.logIn(user, async (err3) => {
          if (err3) return next(err3);
          await userModel.updateLastLogin(user.UserID);
          await writeAudit({ tableName: 'Users', recordID: user.UserID, action: 'LOGIN',
            userID: user.UserID, ip: req.ip, userAgent: req.headers['user-agent'], notes: 'oidc' });
          logger.info(`Login: ${user.Username} (oidc)`);
          res.redirect('/');
        });
      });
    }
  )(req, res, next);
});

// ── GET /auth/methods — tells the login page which SSO buttons to show ────────
router.get('/methods', async (_req, res) => {
  try {
    const settings = require('../models/settingsModel');
    const [oidc, ldap] = await Promise.all([
      settings.getSettingsBool('oidc.enabled', 'OIDC_ENABLED'),
      settings.getSettingsBool('ldap.enabled', 'LDAP_ENABLED'),
    ]);
    res.json({ oidc, ldap });
  } catch (err) {
    logger.warn('GET /auth/methods failed:', err.message);
    res.json({ oidc: false, ldap: false });
  }
});

// ── GET /auth/logout ──────────────────────────────────────────────────────────
router.get('/logout', async (req, res, next) => {
  const userID   = req.user?.UserID;
  const username = req.user?.Username;
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(async () => {
      if (userID) {
        await writeAudit({ tableName: 'Users', recordID: userID, action: 'LOGOUT',
          userID, ip: req.ip, userAgent: req.headers['user-agent'] });
        logger.info(`Logout: ${username}`);
      }
      res.clearCookie('sitemaint.sid');
      res.redirect('/auth/login');
    });
  });
});

module.exports = router;
