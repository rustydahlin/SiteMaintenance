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
    contentSecurityPolicy: {
      directives: {
        defaultSrc:  ["'self'"],
        scriptSrc:   ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net'],
        styleSrc:    ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net'],
        fontSrc:     ["'self'", 'cdn.jsdelivr.net'],
        imgSrc:      ["'self'", 'data:', 'blob:'],
        connectSrc:  ["'self'"],
        frameSrc:    ["'none'"],
        objectSrc:   ["'none'"],
      },
    },
  }));

  // ── Compression + HTTP logging ────────────────────────────────────────────
  app.use(compression());
  app.use(morgan('combined', { stream: logger.stream }));

  // ── Safe view-local defaults (set early so error views never blow up) ─────
  app.use((req, res, next) => {
    res.locals.user        = null;
    res.locals.flash       = {};
    res.locals.currentPath = req.path;
    next();
  });

  // ── Body parsing ──────────────────────────────────────────────────────────
  app.use(express.urlencoded({ extended: true }));
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
  app.use((req, res, next) => {
    res.locals.user        = req.user || null;
    res.locals.flash       = req.flash();
    res.locals.currentPath = req.path;
    next();
  });

  // ── Audit context middleware ───────────────────────────────────────────────
  app.use(require('./middleware/audit'));

  // ── Routes ────────────────────────────────────────────────────────────────
  app.use('/',           require('./routes/index'));
  app.use('/auth',       require('./routes/authRoutes'));
  app.use('/sites',      require('./routes/siteRoutes'));
  app.use('/',           require('./routes/siteInventoryRoutes'));  // /sites/:id/inventory/*
  app.use('/',           require('./routes/pmRoutes'));             // /sites/:id/pm/*
  app.use('/',           require('./routes/logRoutes'));            // /sites/:id/logs/*
  app.use('/inventory',  require('./routes/inventoryRoutes'));
  app.use('/repairs',    require('./routes/repairRoutes'));
  app.use('/documents',  require('./routes/documentRoutes'));
  app.use('/admin',      require('./routes/adminRoutes'));
  app.use('/profile',    require('./routes/profileRoutes'));

  // ── Error handling (must be last) ─────────────────────────────────────────
  const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
