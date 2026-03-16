'use strict';

function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  req.flash('error', 'Please log in to access that page.');
  res.redirect('/auth/login');
}

function isAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user.roles.includes('Admin')) return next();
  res.status(403).render('errors/403', { title: 'Access Denied' });
}

// hasRole('Admin', 'Technician') — user must have at least one of the listed roles
function hasRole(...roles) {
  return (req, res, next) => {
    if (!req.isAuthenticated()) {
      req.flash('error', 'Please log in to access that page.');
      return res.redirect('/auth/login');
    }
    const userRoles = req.user.roles || [];
    const allowed   = roles.some(r => userRoles.includes(r));
    if (allowed) return next();
    res.status(403).render('errors/403', { title: 'Access Denied' });
  };
}

// canWrite — any role except Viewer
function canWrite(req, res, next) {
  return hasRole('Admin', 'Technician', 'Contractor')(req, res, next);
}

module.exports = { isAuthenticated, isAdmin, hasRole, canWrite };
