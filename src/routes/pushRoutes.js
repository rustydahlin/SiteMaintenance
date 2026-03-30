'use strict';

const express   = require('express');
const router    = express.Router();
const pushModel = require('../models/pushModel');
const pushService = require('../services/pushService');
const { isAuthenticated } = require('../middleware/auth');

// All push routes require login
router.use(isAuthenticated);

// GET /api/push/vapid-public-key — return public key for client-side subscription setup
router.get('/vapid-public-key', (req, res) => {
  const key = pushService.getVapidPublicKey();
  if (!key) return res.status(503).json({ error: 'Push notifications not configured' });
  res.json({ publicKey: key });
});

// POST /api/push/subscribe — save a push subscription
router.post('/subscribe', async (req, res, next) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return res.status(400).json({ error: 'Invalid subscription object' });
    }
    await pushModel.upsertSubscription(req.user.id, {
      endpoint,
      p256dh: keys.p256dh,
      auth:   keys.auth,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/push/unsubscribe — remove a push subscription
router.delete('/unsubscribe', async (req, res, next) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
    await pushModel.deleteSubscription(endpoint);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
