'use strict';

const session    = require('express-session');
const MSSQLStore = require('connect-mssql-v2');

async function buildSessionMiddleware() {
  const store = new MSSQLStore(
    {
      server:   process.env.DB_SERVER,
      database: process.env.DB_DATABASE,
      user:     process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      port:     parseInt(process.env.DB_PORT || '1433', 10),
      options: {
        encrypt:              process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === 'true',
      },
    },
    {
      table:      'Sessions',
      ttl:        8 * 60 * 60 * 1000,  // 8 hours (ms)
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
      secure:    process.env.NODE_ENV === 'production',
      maxAge:    8 * 60 * 60 * 1000,  // 8 hours
    },
  });
}

module.exports = { buildSessionMiddleware };
