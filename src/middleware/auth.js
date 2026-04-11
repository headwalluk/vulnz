const db = require('../db');
const passport = require('passport');

function apiAuth(req, res, next) {
  passport.authenticate('headerapikey', { session: false }, (err, user) => {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.status(401).send('Unauthorized');
    }
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
  })(req, res, next);
}

function optionalApiAuth(req, res, next) {
  passport.authenticate('headerapikey', { session: false }, (err, user) => {
    if (err) {
      return next(err);
    }
    if (user && !user.blocked) {
      req.user = user;
      req.logIn(user, { session: false }, (err) => {
        if (err) {
          return next(err);
        }
        return next();
      });
    } else {
      next();
    }
  })(req, res, next);
}

function hasRole(role) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).send('Unauthorized');
    }
    try {
      const rows = await db.query('SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?', [req.user.id]);
      const roles = rows.map((row) => row.name);
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

function apiKeyAdminAuth(req, res, next) {
  passport.authenticate('headerapikey', { session: false }, async (err, user) => {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.status(401).send('Unauthorized');
    }
    if (user.blocked) {
      return res.status(401).send('User account is blocked.');
    }
    try {
      const rows = await db.query('SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?', [user.id]);
      const roles = rows.map((row) => row.name);
      if (!roles.includes('administrator')) {
        return res.status(403).send('Forbidden: API key holder is not an administrator.');
      }
      req.user = user;
      return next();
    } catch (dbErr) {
      console.error(dbErr);
      return res.status(500).send('Server error during role check.');
    }
  })(req, res, next);
}

module.exports = {
  apiAuth,
  optionalApiAuth,
  hasRole,
  apiKeyAdminAuth,
};
