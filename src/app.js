'use strict';

require('dotenv').config();

const express      = require('express');
const path         = require('path');
const morgan       = require('morgan');
const helmet       = require('helmet');
const compression  = require('compression');
const flash        = require('connect-flash');
const passport     = require('passport');
const ejsLayouts   = require('express-ejs-layouts');
const logger       = require('./utils/logger');

async function createApp() {
  const app = express();

  // ── Security headers ──────────────────────────────────────────────────────
  app.use(helmet({
    // Disable HSTS — app runs over plain HTTP; HSTS would force browsers to HTTPS and break everything
    strictTransportSecurity: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc:  ["'self'"],
        scriptSrc:     ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net'],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc:    ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net'],
        fontSrc:     ["'self'", 'cdn.jsdelivr.net'],
        imgSrc:      ["'self'", 'data:', 'blob:'],
        connectSrc:  ["'self'", 'cdn.jsdelivr.net'],
        formAction:              ["'self'"],
        frameSrc:                ["'none'"],
        objectSrc:               ["'none'"],
        upgradeInsecureRequests: null,   // Disable — app runs over plain HTTP
      },
    },
  }));

  // ── Compression + HTTP logging ────────────────────────────────────────────
  app.use(compression());
  app.use(morgan('combined', { stream: logger.stream }));

  // ── Safe view-local defaults (set early so error views never blow up) ─────
  app.use((req, res, next) => {
    res.locals.user               = null;
    res.locals.flash              = {};
    res.locals.currentPath        = req.path;
    res.locals.isDev              = process.env.NODE_ENV !== 'production';
    res.locals.appName            = 'SiteMaintenance';
    res.locals.systemKeysEnabled  = false;
    res.locals.vendorsEnabled     = false;
    res.locals.maintenanceEnabled = false;
    res.locals.reportsEnabled     = false;
    res.locals.sidebarLogoUrl     = '/images/publicsafetyteam.png';
    res.locals.sidebarFooterHtml  = 'Call Darron. (701) 328-6974';
    // Format a SQL date-only field correctly (avoids UTC-midnight timezone shift)
    res.locals.fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { timeZone: 'UTC' }) : '';
    // Returns true if a SQL date-only field is strictly before today (UTC date comparison)
    res.locals.isDateOverdue = (d) => {
      if (!d) return false;
      const dt  = new Date(d);
      const now = new Date();
      return Date.UTC(dt.getUTCFullYear(),  dt.getUTCMonth(),  dt.getUTCDate()) <
             Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    };
    next();
  });

  // ── Body parsing ──────────────────────────────────────────────────────────
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(express.json());

  // ── Static assets ─────────────────────────────────────────────────────────
  app.use(express.static(path.join(__dirname, 'public')));

  // ── View engine ───────────────────────────────────────────────────────────
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(ejsLayouts);
  app.set('layout', 'layouts/main');

  // ── Session (must come before passport) ───────────────────────────────────
  const { buildSessionMiddleware } = require('./config/session');
  app.use(await buildSessionMiddleware());

  // ── Passport ──────────────────────────────────────────────────────────────
  require('./config/passport');
  app.use(passport.initialize());
  app.use(passport.session());

  // ── Flash messages ────────────────────────────────────────────────────────
  app.use(flash());

  // ── Global locals for every view ──────────────────────────────────────────
  const settingsModel = require('./models/settingsModel');
  app.use(async (req, res, next) => {
    res.locals.user               = req.user || null;
    res.locals.flash              = req.flash ? req.flash() : {};
    res.locals.currentPath        = req.path;
    res.locals.appName            = 'SiteMaintenance';
    res.locals.systemKeysEnabled  = false;
    res.locals.vendorsEnabled     = false;
    res.locals.maintenanceEnabled = false;
    res.locals.sidebarLogoUrl     = '/images/publicsafetyteam.png';
    res.locals.sidebarFooterHtml  = 'Call Darron. (701) 328-6974';
    try {
      const [appName, sysKeys, vendors, maintenance, reports, sidebarLogoUrl, sidebarFooterHtml] = await Promise.all([
        settingsModel.getSetting('app.name', null),
        settingsModel.getSetting('systemKeys.enabled', null),
        settingsModel.getSetting('vendors.enabled', null),
        settingsModel.getSetting('maintenance.enabled', null),
        settingsModel.getSetting('reports.enabled', null),
        settingsModel.getSetting('sidebar.logoUrl', null),
        settingsModel.getSetting('sidebar.footerHtml', null),
      ]);
      res.locals.appName             = appName || 'SiteMaintenance';
      res.locals.systemKeysEnabled   = sysKeys      === '1';
      res.locals.vendorsEnabled      = vendors      === '1';
      res.locals.maintenanceEnabled  = maintenance  === '1';
      res.locals.reportsEnabled      = reports      === '1';
      res.locals.sidebarLogoUrl      = sidebarLogoUrl  || '/images/publicsafetyteam.png';
      res.locals.sidebarFooterHtml   = sidebarFooterHtml !== null ? sidebarFooterHtml : 'Call Darron. (701) 328-6974';
    } catch (_) {
      res.locals.appName             = 'SiteMaintenance';
      res.locals.systemKeysEnabled   = false;
      res.locals.vendorsEnabled      = false;
      res.locals.maintenanceEnabled  = false;
      res.locals.reportsEnabled      = false;
      res.locals.sidebarLogoUrl      = '/images/publicsafetyteam.png';
      res.locals.sidebarFooterHtml   = 'Call Darron. (701) 328-6974';
    }
    next();
  });

  // ── Audit context middleware ───────────────────────────────────────────────
  app.use(require('./middleware/audit'));

  // ── Routes ────────────────────────────────────────────────────────────────
  // Serve service worker with correct scope header
  app.get('/sw.js', (req, res, next) => {
    res.setHeader('Service-Worker-Allowed', '/');
    next();
  });

  // Public API (no session auth — uses X-API-Key header)
  app.use('/api', require('./routes/networkMapApiRoute'));
  app.use('/api/push', require('./routes/pushRoutes'));

  app.use('/',           require('./routes/index'));
  app.use('/auth',       require('./routes/authRoutes'));
  app.use('/sites',      require('./routes/siteRoutes'));
  app.use('/',           require('./routes/siteInventoryRoutes'));  // /sites/:id/inventory/*
  app.use('/',           require('./routes/pmRoutes'));             // /sites/:id/pm/*
  app.use('/',           require('./routes/logRoutes'));            // /sites/:id/logs/*
  app.use('/inventory',  require('./routes/inventoryRoutes'));
  app.use('/repairs',    require('./routes/repairRoutes'));
  app.use('/documents',  require('./routes/documentRoutes'));
  app.use('/vendors',      require('./routes/vendorRoutes'));
  app.use('/system-keys',  require('./routes/systemKeyRoutes'));
  app.use('/maintenance',  require('./routes/maintenanceRoutes'));
  app.use('/logs',         require('./routes/logsRoutes'));
  app.use('/admin',        require('./routes/adminRoutes'));
  app.use('/reports',      require('./routes/reportsRoutes'));
  app.use('/profile',    require('./routes/profileRoutes'));
  app.use('/mobile',     require('./routes/mobileRoutes'));

  // ── Error handling (must be last) ─────────────────────────────────────────
  const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
