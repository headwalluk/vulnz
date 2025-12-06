require('dotenv').config({ quiet: true });
const { normalizeEnv, checkEnvFilePermissions } = require('./lib/env');
normalizeEnv();
checkEnvFilePermissions();

// Colorful startup banner for quick visibility
(() => {
  const RESET = '\x1b[0m';
  const BOLD = '\x1b[1m';
  const CYAN = '\x1b[36m';
  const GREEN = '\x1b[32m';
  const color = process.env.NODE_ENV === 'production' ? GREEN : CYAN;
  const instance = process.env.NODE_APP_INSTANCE;
  const env = process.env.NODE_ENV;
  console.log(`${BOLD}${color}[vulnz] ${env} instance ${instance}${RESET}`);
})();

process.on('uncaughtException', (err) => {
  console.error('There was an uncaught error', err);
  process.exit(1); //mandatory (as per the Node.js docs)
});

// Monkey-patch BigInt to allow JSON serialization
BigInt.prototype.toJSON = function () {
  return this.toString();
};

const express = require('express');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const app = express();
const port = process.env.HTTP_LISTEN_PORT || 3000;
const apiKey = require('./models/apiKey');
const componentType = require('./models/componentType');
const component = require('./models/component');
const website = require('./models/website');
const websiteComponent = require('./models/websiteComponent');
const role = require('./models/role');
const user = require('./models/user');
const userRole = require('./models/userRole');
const session = require('./models/session');
const apiCallLog = require('./models/apiCallLog');
const emailLog = require('./models/emailLog');
const passwordResetToken = require('./models/passwordResetToken');
const release = require('./models/release');
const vulnerability = require('./models/vulnerability');
const passport = require('./config/passport');
const expressSession = require('express-session');
const MySQLStore = require('express-mysql-session')(expressSession);
const dbConfig = require('./config/db');
const apiKeyRoutes = require('./routes/apiKeys');
const componentRoutes = require('./routes/components');
const componentTypeRoutes = require('./routes/componentTypes');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const roleRoutes = require('./routes/roles');
const logRoutes = require('./routes/logs');
const websiteRoutes = require('./routes/websites');
const configRoutes = require('./routes/config');
const reportRoutes = require('./routes/reports');
const { redirectIfAuthenticated, isAuthenticatedPage, isAdminPage } = require('./middleware/auth');
const { versionAssets } = require('./middleware/versionAssets');
const { setCacheControl } = require('./middleware/cacheControl');
const redirectHtml = require('./middleware/redirectHtml');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const cron = require('node-cron');
const { syncNextPlugin } = require('./lib/wporg');
const { sendWeeklyReports } = require('./lib/reporting');
const migrations = require('./migrations');
const { initializeGeoIP } = require('./lib/geoip');
const securityEvent = require('./models/securityEvent');
const securityEventType = require('./models/securityEventType');
const fileSecurityIssue = require('./models/fileSecurityIssue');
const componentChange = require('./models/componentChange');

// Swagger definition
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'vulnz API',
      version: '1.0.0',
      description: 'API for WordPress vulnerability database',
    },
    servers: [
      {
        url: process.env.BASE_URL,
      },
    ],
  },
  apis: ['./src/routes/*.js'], // files containing annotations as above
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

app.set('trust proxy', 1);
app.use(redirectHtml);
app.use('/doc', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use(helmet());
app.use(express.json());

const sessionStore = new MySQLStore({
  ...dbConfig,
  user: dbConfig.user,
  password: dbConfig.password,
  database: dbConfig.database,
  clearExpired: true,
  checkExpirationInterval: 900000, // 15 minutes
  expiration: parseInt(process.env.SESSION_DURATION_DAYS, 10) * 24 * 60 * 60 * 1000,
});

app.use(
  expressSession({
    secret: process.env.SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: parseInt(process.env.SESSION_DURATION_DAYS, 10) * 24 * 60 * 60 * 1000,
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// Diagnostic middleware to confirm if the /api path is being hit
if (process.env.LOG_LEVEL === 'debug') {
  app.use('/api', (req, res, next) => {
    console.log('Generic /api middleware triggered for route:', req.originalUrl);
    next();
  });
}

app.get('/api/ping', (req, res) => {
  res.send('pong');
});

// Serve HTML from /public in development and /dist in production
const root = process.env.NODE_ENV === 'production' ? '../dist' : '../public';

// In production, verify the build artifacts exist before wiring routes
if (process.env.NODE_ENV === 'production') {
  const distRoot = path.join(__dirname, '../dist');
  const required = [path.join(distRoot, 'index.html'), path.join(distRoot, 'build', 'css', 'app.bundle.min.css'), path.join(distRoot, 'build', 'js', 'core.bundle.min.js')];
  const missing = required.filter((p) => !fs.existsSync(p));
  if (missing.length) {
    const rel = (p) => p.replace(path.join(__dirname, '..') + '/', '');
    console.error('Production build artifacts not found. Please run "npm run build" first. Missing files:');
    for (const m of missing) console.error(' - ' + rel(m));
    process.exit(1);
  }
}

app.get('/login', redirectIfAuthenticated, (req, res, next) => {
  versionAssets(req, res, next, path.join(__dirname, root, 'login.html'));
});

app.get('/register', (req, res, next) => {
  versionAssets(req, res, next, path.join(__dirname, root, 'register.html'));
});

app.get('/reset-password', (req, res, next) => {
  versionAssets(req, res, next, path.join(__dirname, root, 'reset-password.html'));
});

app.get('/dashboard', isAuthenticatedPage, (req, res, next) => {
  versionAssets(req, res, next, path.join(__dirname, root, 'dashboard.html'));
});

app.get('/admin', isAdminPage, (req, res) => {
  res.redirect('/admin/users');
});

app.get('/admin/users', isAdminPage, (req, res, next) => {
  versionAssets(req, res, next, path.join(__dirname, root, 'admin/users.html'));
});

app.get('/admin/components', isAdminPage, (req, res, next) => {
  versionAssets(req, res, next, path.join(__dirname, root, 'admin/components.html'));
});

app.get('/admin/api-logs', isAdminPage, (req, res, next) => {
  versionAssets(req, res, next, path.join(__dirname, root, 'admin/api-logs.html'));
});

app.get('/', (req, res, next) => {
  versionAssets(req, res, next, path.join(__dirname, root, 'index.html'));
});

app.use('/api/components', componentRoutes);
app.use('/api/component-types', componentTypeRoutes);
app.use('/api/api-keys', apiKeyRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/websites', websiteRoutes);
app.use('/api/config', configRoutes);
app.use('/api/reports', reportRoutes);

// Serve static assets from the same root
app.use(setCacheControl);
app.use(express.static(path.join(__dirname, root)));

// 404 handler
app.use((req, res, next) => {
  res.status(404);
  versionAssets(req, res, next, path.join(__dirname, root, '404.html'));
});

async function startServer() {
  try {
    if (process.env.NODE_APP_INSTANCE === '0') {
      await migrations.run();
      console.log('Migrations complete.');
      await initializeGeoIP();
    }

    if (process.env.CRON_ENABLE !== 'true') {
      console.warn('Cron jobs are disabled in .env (CRON_ENABLE).');
    } else {
      if (process.env.NODE_ENV === 'production' && process.env.NODE_APP_INSTANCE && process.env.NODE_APP_INSTANCE !== '0') {
        console.log(`Not scheduling cron jobs on this instance (${process.env.NODE_APP_INSTANCE})`);
        return;
      }

      console.log(`Scheduling cron jobs for instance ${process.env.NODE_APP_INSTANCE}`);

      cron.schedule('0 0 * * *', () => {
        process.env.LOG_LEVEL === 'debug' && console.log('Running cron job to purge expired sessions...');
        sessionStore.clearExpiredSessions();
      });

      cron.schedule('0 0 * * *', () => {
        process.env.LOG_LEVEL === 'debug' && console.log('Running cron job to purge old API call logs...');
        apiCallLog.purgeOldLogs();
      });

      cron.schedule('0 0,12 * * *', () => {
        process.env.LOG_LEVEL === 'debug' && console.log('Running cron job to purge old email logs...');
        emailLog.purgeOldLogs();
      });

      cron.schedule('*/10 * * * *', () => {
        process.env.LOG_LEVEL === 'debug' && console.log('Running cron job to send weekly summary emails...');
        sendWeeklyReports();
      });

      cron.schedule('* * * * *', () => {
        process.env.LOG_LEVEL === 'debug' && console.log('Running cron job to sync plugin data from wporg...');
        syncNextPlugin();
      });

      if (process.env.WEBSITE_AUTO_DELETE_ENABLED === 'true') {
        const days = parseInt(process.env.WEBSITE_AUTO_DELETE_DAYS, 10) || 30;
        cron.schedule('0 0 * * *', async () => {
          console.log(`Running cron job to delete stale websites (older than ${days} days)...`);
          try {
            const deletedCount = await website.removeStaleWebsites(days);
            console.log(`Deleted ${deletedCount} stale website(s).`);
          } catch (err) {
            console.error('Error deleting stale websites:', err);
          }
        });
      } else {
        console.log('Stale website deletion is disabled (WEBSITE_AUTO_DELETE_ENABLED=false).');
      }

      // Purge old security events
      const securityEventsRetentionDays = parseInt(process.env.SECURITY_EVENTS_RETENTION_DAYS, 10) || 30;
      cron.schedule('0 1 * * *', async () => {
        console.log(`Running cron job to purge old security events (older than ${securityEventsRetentionDays} days)...`);
        try {
          const deletedCount = await securityEvent.removeOldEvents(securityEventsRetentionDays);
          console.log(`Purged ${deletedCount} old security event(s).`);
        } catch (err) {
          console.error('Error purging old security events:', err);
        }
      });

      // Purge stale file security issues
      const fileIssuesRetentionDays = parseInt(process.env.FILE_SECURITY_ISSUES_RETENTION_DAYS, 10) || 30;
      cron.schedule('0 2 * * *', async () => {
        console.log(`Running cron job to purge stale file security issues (older than ${fileIssuesRetentionDays} days)...`);
        try {
          const deletedCount = await fileSecurityIssue.removeStaleIssues(fileIssuesRetentionDays);
          console.log(`Purged ${deletedCount} stale file security issue(s).`);
        } catch (err) {
          console.error('Error purging stale file security issues:', err);
        }
      });

      // Purge old component changes (runs weekly on Sunday at 3 AM)
      const componentChangesRetentionDays = parseInt(process.env.COMPONENT_CHANGES_RETENTION_DAYS, 10) || 365;
      cron.schedule('0 3 * * 0', async () => {
        console.log(`Running cron job to purge old component changes (older than ${componentChangesRetentionDays} days)...`);
        try {
          const deletedCount = await componentChange.removeOldChanges(componentChangesRetentionDays);
          console.log(`Purged ${deletedCount} old component change(s).`);
        } catch (err) {
          console.error('Error purging old component changes:', err);
        }
      });
    }

    await role.createTable();
    await role.seedData();
    await user.createTable();
    await userRole.createTable();
    await session.createTable();
    await apiKey.createTable();
    await componentType.createTable();
    await componentType.seedData();
    await component.createTable();
    await apiCallLog.createTable();
    await emailLog.createTable();
    await passwordResetToken.createTable();
    await release.createTable();
    await vulnerability.createTable();
    await website.createTable();
    await websiteComponent.createTable();
    await securityEventType.createTable();
    await securityEvent.createTable();
    await fileSecurityIssue.createTable();
    await componentChange.createTable();
    console.log('Database tables created or already exist.');
    app.listen(port, () => {
      console.log(`Server accessible at ${process.env.BASE_URL} in ${process.env.NODE_ENV || 'development'} mode`);
    });
  } catch (err) {
    console.error('Failed to initialize the database or start the server:', err);
    process.exit(1);
  }
}

startServer();
