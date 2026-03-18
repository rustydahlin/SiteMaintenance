'use strict';

const express      = require('express');
const router       = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const logModel     = require('../models/logModel');
const siteModel    = require('../models/siteModel');
const lookupModel  = require('../models/lookupModel');

router.use(isAuthenticated);

router.get('/', async (req, res, next) => {
  try {
    const page      = parseInt(req.query.page, 10) || 1;
    const siteID    = req.query.siteID    ? parseInt(req.query.siteID,    10) : null;
    const logTypeID = req.query.logTypeID ? parseInt(req.query.logTypeID, 10) : null;
    const dateFrom  = req.query.dateFrom  || null;
    const dateTo    = req.query.dateTo    || null;
    const search    = req.query.search    || '';
    const sort      = req.query.sort      || 'date';
    const dir       = req.query.dir       || 'desc';

    const [{ rows, total, totalPages }, sites, logTypes] = await Promise.all([
      logModel.getAll({ siteID, logTypeID, dateFrom, dateTo, search, sort, dir, page, pageSize: 25 }),
      siteModel.getSimpleList(),
      lookupModel.getLogTypes(),
    ]);

    const queryString = [
      siteID    ? `siteID=${siteID}`       : '',
      logTypeID ? `logTypeID=${logTypeID}` : '',
      dateFrom  ? `dateFrom=${dateFrom}`   : '',
      dateTo    ? `dateTo=${dateTo}`       : '',
      search    ? `search=${encodeURIComponent(search)}` : '',
      `sort=${sort}`,
      `dir=${dir}`,
    ].filter(Boolean).join('&');

    res.render('logs/index', {
      title: 'Logs',
      rows,
      sites,
      logTypes,
      filters: { siteID, logTypeID, dateFrom, dateTo, search },
      sort, dir,
      pagination: { page, totalPages, total, queryString },
    });
  } catch (err) { next(err); }
});

module.exports = router;
