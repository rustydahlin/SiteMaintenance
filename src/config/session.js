'use strict';

const session        = require('express-session');
const MSSQLStore     = require('connect-mssql-v2');
const { dbVar }      = require('./database');
const settingsModel  = require('../models/settingsModel');

async function buildSessionMiddleware() {
  // Read timeout from AppSettings; fall back to 8 hours if not configured yet.
  let timeoutHours = 8;
  try {
    const val = await settingsModel.getSetting('session.timeoutHours');
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed > 0) timeoutHours = parsed;
  } catch { /* DB not seeded yet on first run — use default */ }

  const timeoutMs = timeoutHours * 60 * 60 * 1000;

  const store = new MSSQLStore(
    {
      server:   dbVar('SERVER'),
      database: dbVar('DATABASE'),
      user:     dbVar('USER'),
      password: dbVar('PASSWORD'),
      port:     parseInt(dbVar('PORT') || '1433', 10),
      options: {
        encrypt:              dbVar('ENCRYPT') === 'true',
        trustServerCertificate: dbVar('TRUST_SERVER_CERT') === 'true',
      },
    },
    {
      table:      'Sessions',
      ttl:        timeoutMs,
      autoRemove: true,
    }
  );

  return session({
    store,
    secret:            process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave:            false,
    saveUninitialized: false,
    name:              'sitemaint.sid',
    cookie: {
      httpOnly:  true,
      sameSite:  'lax',
      // Set COOKIE_SECURE=true only when running behind HTTPS. Never enable over plain HTTP
      // or sessions will silently break (browser won't send secure cookies over HTTP).
      secure:    process.env.COOKIE_SECURE === 'true',
      maxAge:    timeoutMs,
    },
  });
}

module.exports = { buildSessionMiddleware };
