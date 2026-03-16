'use strict';

// Attaches audit context to every request so model functions can log changes
// without needing to pass user/IP as arguments manually.
function auditMiddleware(req, _res, next) {
  req.auditContext = {
    userID:    req.user ? req.user.UserID : null,
    ip:        req.ip || (req.connection && req.connection.remoteAddress) || null,
    userAgent: req.headers['user-agent'] || null,
  };
  next();
}

module.exports = auditMiddleware;
