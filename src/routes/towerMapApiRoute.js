'use strict';

const express              = require('express');
const router               = express.Router();
const crypto               = require('crypto');
const settingsModel        = require('../models/settingsModel');
const networkResourceModel = require('../models/networkResourceModel');

// ── API key authentication ────────────────────────────────────────────────────
async function requireApiKey(req, res, next) {
  try {
    const provided = req.headers['x-api-key'];
    if (!provided) {
      return res.status(401).json({ error: 'Missing X-API-Key header.' });
    }

    const expected = await settingsModel.getSetting('towerMap.apiKey', null);
    if (!expected || expected.trim() === '') {
      return res.status(503).json({ error: 'Tower map API key is not configured on this server.' });
    }

    // Constant-time comparison to prevent timing attacks
    const a = Buffer.from(provided.trim());
    const b = Buffer.from(expected.trim());
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(403).json({ error: 'Invalid API key.' });
    }

    next();
  } catch (err) {
    next(err);
  }
}

// ── GET /api/tower-map ────────────────────────────────────────────────────────
// Returns location + device data in the exact devices.json format used by SIRNnetworkmap.
// Auth: X-API-Key header (set in Admin → Settings → towerMap.apiKey).
router.get('/tower-map', requireApiKey, async (req, res, next) => {
  try {
    const data = await networkResourceModel.getTowerMapData();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
