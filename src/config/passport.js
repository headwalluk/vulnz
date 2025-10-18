const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const HeaderAPIKeyStrategy = require('passport-headerapikey').HeaderAPIKeyStrategy;
const db = require('../db');
const bcrypt = require('bcrypt');

passport.use(new LocalStrategy(
  async (username, password, done) => {
    try {
      const [user] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
      if (!user) {
        return done(null, false, { message: 'Incorrect username.' });
      }
      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        return done(null, false, { message: 'Incorrect password.' });
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

passport.use(new HeaderAPIKeyStrategy(
  { header: 'X-API-Key', prefix: '' },
  false,
  async (apiKey, done) => {
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
  }
));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const [user] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;
