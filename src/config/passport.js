const passport = require('passport');
const HeaderAPIKeyStrategy = require('passport-headerapikey').HeaderAPIKeyStrategy;
const db = require('../db');

passport.use(
  new HeaderAPIKeyStrategy({ header: 'X-API-Key', prefix: '' }, false, async (apiKey, done) => {
    try {
      const [key] = await db.query('SELECT * FROM api_keys WHERE api_key = ?', [apiKey]);
      if (!key) {
        return done(null, false);
      }
      const [user] = await db.query('SELECT * FROM users WHERE id = ?', [key.user_id]);
      if (!user) {
        return done(null, false);
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  })
);

module.exports = passport;
