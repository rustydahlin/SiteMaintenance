'use strict';

const passport      = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const userModel     = require('../models/userModel');
const settingsModel = require('../models/settingsModel');
const logger        = require('../utils/logger');

// ── Serialize / Deserialize ───────────────────────────────────────────────────
passport.serializeUser((user, done) => {
  done(null, user.UserID);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await userModel.findByID(id);
    if (!user || !user.IsActive) return done(null, false);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// ── Local Strategy ────────────────────────────────────────────────────────────
passport.use('local', new LocalStrategy(
  { usernameField: 'username', passwordField: 'password' },
  async (username, password, done) => {
    try {
      const user = await userModel.findByUsername(username);
      if (!user || !user.IsActive) {
        return done(null, false, { message: 'Invalid username or password.' });
      }
      if (user.AuthProvider !== 'local') {
        return done(null, false, { message: 'This account uses SSO login. Please use the appropriate login method.' });
      }
      const ok = await userModel.verifyPassword(user, password);
      if (!ok) return done(null, false, { message: 'Invalid username or password.' });
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

// ── OIDC / Entra ID Strategy (lazy-loaded when enabled) ───────────────────────
// Strategies are registered dynamically so admin can update settings without restart.
// Call initOIDC() and initLDAP() after settings are loaded.

async function initOIDC() {
  const enabled = await settingsModel.getSettingsBool('oidc.enabled', 'OIDC_ENABLED');
  if (!enabled) {
    logger.info('OIDC strategy: disabled');
    return;
  }

  const clientID     = await settingsModel.getSetting('oidc.clientId',     'OIDC_CLIENT_ID');
  const clientSecret = await settingsModel.getSetting('oidc.clientSecret',  'OIDC_CLIENT_SECRET');
  const tenantID     = await settingsModel.getSetting('oidc.tenantId',      'OIDC_TENANT_ID');
  const redirectUri  = await settingsModel.getSetting('oidc.redirectUri',   'OIDC_REDIRECT_URI');

  if (!clientID || !clientSecret || !tenantID) {
    logger.warn('OIDC strategy: enabled but missing clientId/clientSecret/tenantId — skipping');
    return;
  }

  try {
    const OIDCStrategy = require('passport-openidconnect');
    passport.use('openidconnect', new OIDCStrategy(
      {
        issuer:           `https://login.microsoftonline.com/${tenantID}/v2.0`,
        authorizationURL: `https://login.microsoftonline.com/${tenantID}/oauth2/v2.0/authorize`,
        tokenURL:         `https://login.microsoftonline.com/${tenantID}/oauth2/v2.0/token`,
        userInfoURL:      'https://graph.microsoft.com/oidc/userinfo',
        clientID,
        clientSecret,
        callbackURL:      redirectUri,
        scope:            ['openid', 'profile', 'email'],
      },
      async (issuer, profile, done) => {
        try {
          const oid   = profile.id;
          const email = profile.emails?.[0]?.value || null;

          let user = oid ? await userModel.findByExternalID(oid) : null;
          if (!user && email) user = await userModel.findByEmail(email);

          if (!user) {
            user = await userModel.create({
              username:     email || oid,
              displayName:  profile.displayName || email || oid,
              email,
              authProvider: 'oidc',
              externalID:   oid,
            });
            await userModel.setRoles(user.UserID, ['Viewer']);
            user = await userModel.findByID(user.UserID);
            logger.info(`OIDC: auto-provisioned user ${user.Username}`);
          }

          if (!user.IsActive) return done(null, false, { message: 'Account is disabled.' });
          return done(null, user);
        } catch (err) {
          return done(err);
        }
      }
    ));
    logger.info('OIDC strategy: registered');
  } catch (err) {
    logger.error('OIDC strategy init failed:', err.message);
  }
}

async function initLDAP() {
  const enabled = await settingsModel.getSettingsBool('ldap.enabled', 'LDAP_ENABLED');
  if (!enabled) {
    logger.info('LDAP strategy: disabled');
    return;
  }

  const url                = await settingsModel.getSetting('ldap.url',                'LDAP_URL');
  const bindDN             = await settingsModel.getSetting('ldap.bindDn',             'LDAP_BIND_DN');
  const bindCredentials    = await settingsModel.getSetting('ldap.bindCredentials',    'LDAP_BIND_CREDENTIALS');
  const searchBase         = await settingsModel.getSetting('ldap.searchBase',         'LDAP_SEARCH_BASE');
  const searchFilter       = await settingsModel.getSetting('ldap.searchFilter',       'LDAP_SEARCH_FILTER');
  const rejectUnauthorized = await settingsModel.getSettingsBool('ldap.rejectUnauthorized', 'LDAP_REJECT_UNAUTHORIZED');

  if (!url || !bindDN || !searchBase) {
    logger.warn('LDAP strategy: enabled but missing required settings — skipping');
    return;
  }

  // Auto-prepend ldap:// if no protocol specified
  const normalizedUrl = /^ldaps?:\/\//i.test(url) ? url : `ldap://${url}`;

  try {
    const LdapStrategy = require('passport-ldapauth');
    passport.use('ldapauth', new LdapStrategy(
      {
        server: {
          url:          normalizedUrl,
          bindDN,
          bindCredentials,
          searchBase,
          searchFilter: searchFilter || '(sAMAccountName={{username}})',
          tlsOptions:   { rejectUnauthorized: rejectUnauthorized !== false },
        },
        usernameField: 'ldapUsername',
        passwordField: 'ldapPassword',
        passReqToCallback: true,
      },
      async (req, ldapUser, done) => {
        try {
          const dn       = ldapUser.dn;
          const username = ldapUser.sAMAccountName || ldapUser.uid || ldapUser.cn;
          const email    = ldapUser.mail || ldapUser.userPrincipalName || null;

          let user = await userModel.findByExternalID(dn);
          if (!user && username) user = await userModel.findByUsername(username);

          if (!user) {
            user = await userModel.create({
              username:     username || dn,
              displayName:  ldapUser.displayName || username || dn,
              email,
              authProvider: 'ldap',
              externalID:   dn,
            });
            await userModel.setRoles(user.UserID, ['Viewer']);
            user = await userModel.findByID(user.UserID);
            logger.info(`LDAP: auto-provisioned user ${user.Username}`);
          }

          if (!user.IsActive) return done(null, false, { message: 'Account is disabled.' });
          return done(null, user);
        } catch (err) {
          return done(err);
        }
      }
    ));
    logger.info('LDAP strategy: registered');
  } catch (err) {
    logger.error('LDAP strategy init failed:', err.message);
  }
}

// Initialize SSO strategies on startup
(async () => {
  try {
    await initOIDC();
    await initLDAP();
  } catch (err) {
    logger.error('Passport SSO init error:', err.message);
  }
})();

module.exports = passport;
module.exports.reinitSSO = async () => {
  settingsModel.bustCache();
  await initOIDC();
  await initLDAP();
  logger.info('Passport SSO strategies re-initialized');
};
