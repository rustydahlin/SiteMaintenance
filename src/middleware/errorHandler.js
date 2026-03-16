'use strict';

const logger = require('../utils/logger');

function notFoundHandler(req, res, _next) {
  res.status(404).render('errors/404', { title: 'Page Not Found' });
}

function errorHandler(err, req, res, _next) {
  logger.error(`${err.status || 500} — ${err.message}`, { stack: err.stack, url: req.originalUrl });

  const status = err.status || 500;
  res.status(status).render('errors/500', {
    title: 'Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred.',
    stack:   process.env.NODE_ENV === 'development' ? err.stack   : null,
  });
}

module.exports = { notFoundHandler, errorHandler };
