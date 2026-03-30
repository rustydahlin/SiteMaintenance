'use strict';

const webpush  = require('web-push');
const logger   = require('../utils/logger');
const pushModel = require('../models/pushModel');

let initialized = false;

function init() {
  if (initialized) return;
  const publicKey  = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const email      = process.env.VAPID_EMAIL || 'mailto:admin@example.com';

  if (!publicKey || !privateKey) {
    logger.warn('Push notifications disabled: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set in .env');
    return;
  }

  webpush.setVapidDetails(email, publicKey, privateKey);
  initialized = true;
}

// Send a push to all subscriptions for a specific user
async function sendToUser(userID, payload) {
  init();
  if (!initialized) return;

  const subscriptions = await pushModel.getByUserID(userID);
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.Endpoint, keys: { p256dh: sub.P256dh, auth: sub.Auth } },
        JSON.stringify(payload)
      );
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        // Subscription expired or invalid — clean it up
        await pushModel.deleteByEndpoint(sub.Endpoint);
        logger.info(`Push: removed expired subscription for user ${userID}`);
      } else {
        logger.error(`Push: failed to send to user ${userID}: ${err.message}`);
      }
    }
  }
}

// Broadcast to all subscribed users
async function sendToAll(payload) {
  init();
  if (!initialized) return;

  const subscriptions = await pushModel.getAll();
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.Endpoint, keys: { p256dh: sub.P256dh, auth: sub.Auth } },
        JSON.stringify(payload)
      );
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await pushModel.deleteByEndpoint(sub.Endpoint);
      } else {
        logger.error(`Push broadcast failed for subscription ${sub.Id}: ${err.message}`);
      }
    }
  }
}

function getVapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

module.exports = { sendToUser, sendToAll, getVapidPublicKey };
