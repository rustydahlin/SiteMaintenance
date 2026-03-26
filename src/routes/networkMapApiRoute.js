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

    const expected = await settingsModel.getSetting('networkMap.apiKey', null);
    if (!expected || expected.trim() === '') {
      return res.status(503).json({ error: 'Network map API key is not configured on this server.' });
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

// ── GET /api/network-map ──────────────────────────────────────────────────────
// Returns location + device data in the exact devices.json format used by the network map app.
// Auth: X-API-Key header (set in Admin → Settings → networkMap.apiKey).
router.get('/network-map', requireApiKey, async (req, res, next) => {
  try {
    const data = await networkResourceModel.getNetworkMapData();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
