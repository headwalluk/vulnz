const db = require('../db');
const passport = require('passport');

function apiOrSessionAuth(req, res, next) {
  passport.authenticate('headerapikey', { session: false }, (err, user, info) => {
    if (err) {
      return next(err);
    }
    if (user) {
      if (user.blocked) {
        return res.status(401).send('User account is blocked.');
      }
      req.user = user;
      req.logIn(user, { session: false }, (err) => {
        if (err) {
          return next(err);
        }
        return next();
      });
    } else {
      isAuthenticated(req, res, next);
    }
  })(req, res, next);
}

function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).send('Unauthorized');
}

function isAuthenticatedPage(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
}

function hasRole(role) {
  return async (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send('Unauthorized');
    }
    try {
      const rows = await db.query(
        'SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?',
        [req.user.id]
      );
      const roles = rows.map(row => row.name);
      if (roles.includes(role)) {
        return next();
      }
      res.status(403).send('Forbidden');
    } catch (err) {
      console.error(err);
      res.status(500).send('Server error');
    }
  };
}

function hasRolePage(role) {
  return async (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.redirect('/login');
    }
    try {
      const rows = await db.query(
        'SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?',
        [req.user.id]
      );
      const roles = rows.map(row => row.name);
      if (roles.includes(role)) {
        return next();
      }
      res.redirect('/');
    } catch (err) {
      console.error(err);
      res.status(500).send('Server error');
    }
  };
}

function isAdminPage(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.redirect('/login');
  }
  hasRolePage('administrator')(req, res, next);
}

function redirectIfAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return res.redirect('/dashboard');
  }
  next();
}

function optionalApiOrSessionAuth(req, res, next) {
  passport.authenticate('headerapikey', { session: false }, (err, user, info) => {
    if (err) {
      return next(err);
    }
    if (user) {
      if (user.blocked) {
        // Treat as unauthenticated if blocked
        return next();
      }
      req.user = user;
      req.logIn(user, { session: false }, (err) => {
        if (err) {
          return next(err);
        }
        return next();
      });
    } else {
      // No valid API key, just continue. Session auth will be checked by req.isAuthenticated() in the route.
      next();
    }
  })(req, res, next);
}

module.exports = {
  isAuthenticated,
  isAuthenticatedPage,
  hasRole,
  hasRolePage,
  redirectIfAuthenticated,
  apiOrSessionAuth,
  optionalApiOrSessionAuth,
  isAdminPage,
};
