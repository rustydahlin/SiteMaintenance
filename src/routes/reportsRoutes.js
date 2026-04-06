'use strict';

const express        = require('express');
const router         = express.Router();
const { isAuthenticated, canAccessReports } = require('../middleware/auth');
const inventoryModel = require('../models/inventoryModel');
const lookupModel    = require('../models/lookupModel');

// Block entire section when feature is disabled
router.use((_req, res, next) => {
  if (!res.locals.reportsEnabled)
    return res.status(404).render('errors/404', { title: 'Not Found' });
  next();
});
router.use(isAuthenticated);
router.use(canAccessReports);

// GET /reports — index
router.get('/', (_req, res) => {
  res.render('reports/index', { title: 'Reports' });
});

// GET /reports/inventory
router.get('/inventory', async (req, res, next) => {
  try {
    const { categoryID = '', locationID = '', inStockOnly = '' } = req.query;

    const [categories, locations, statuses] = await Promise.all([
      lookupModel.getInventoryCategories(),
      lookupModel.getStockLocations(),
      lookupModel.getInventoryStatuses(),
    ]);

    const inStockID = statuses.find(s => s.StatusName === 'In-Stock')?.StatusID || null;

    const { rows } = await inventoryModel.getAll({
      categoryID:  categoryID  || undefined,
      locationID:  locationID  || undefined,
      statusID:    (inStockOnly === '1' && inStockID) ? inStockID : undefined,
      page:        1,
      pageSize:    100000,
      sort:        'category',
      dir:         'asc',
    });

    // statusID filter in getAll applies to serialized items; filter bulk post-query by availability
    const filtered = (inStockOnly === '1')
      ? rows.filter(i => i.TrackingType === 'serialized' || (i.QuantityAvailable > 0))
      : rows;

    // Fetch bulk stock distribution in parallel
    const stockMap = {};
    await Promise.all(
      filtered.filter(i => i.TrackingType === 'bulk').map(async i => {
        stockMap[i.ItemID] = await inventoryModel.getStock(i.ItemID);
      })
    );

    // Group by category
    const grouped = {};
    for (const item of filtered) {
      const cat = item.CategoryName || 'Uncategorized';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(item);
    }

    const filterDesc = [];
    if (inStockOnly === '1') filterDesc.push('In-Stock / Available only');
    if (categoryID) filterDesc.push(`Category: ${(categories.find(c => c.CategoryID == categoryID) || {}).CategoryName || ''}`);
    if (locationID) filterDesc.push(`Location: ${(locations.find(l => l.LocationID == locationID) || {}).LocationName || ''}`);

    res.render('reports/inventory', {
      title:      'Inventory Report',
      grouped,
      stockMap,
      categories,
      locations,
      filters:    { categoryID, locationID, inStockOnly },
      filterDesc: filterDesc.length ? filterDesc.join(' | ') : 'All Inventory',
      runDate:    new Date().toLocaleDateString('en-US'),
    });
  } catch (err) { next(err); }
});

module.exports = router;
