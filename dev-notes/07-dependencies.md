# Dependencies

Key dependencies and their purposes in VULNZ.

---

## Production Dependencies

### Core Framework

#### express (^5.1.0)

- **Purpose**: Web application framework
- **Why chosen**: Industry standard, mature, extensive middleware ecosystem
- **Usage**: All HTTP routing, middleware, request/response handling

#### helmet (^8.1.0)

- **Purpose**: Security HTTP headers
- **Why chosen**: Essential security middleware for Express
- **Usage**: Sets secure headers (CSP, X-Frame-Options, etc.)

### Database

#### mariadb (^3.4.5)

- **Purpose**: MySQL/MariaDB driver
- **Why chosen**: Native promise support, better performance than mysql package
- **Usage**: All database connections and queries
- **Note**: Compatible with MySQL as well

#### express-mysql-session (^3.0.3)

- **Purpose**: MySQL session store
- **Why chosen**: Stores sessions in database instead of memory
- **Usage**: Shared session storage across PM2 instances

### Authentication

#### passport (^0.7.0)

- **Purpose**: Authentication middleware
- **Why chosen**: Flexible authentication strategies
- **Usage**: Session and API key authentication

#### passport-local (^1.0.0)

- **Purpose**: Username/password authentication
- **Usage**: User login with credentials

#### passport-headerapikey (^1.2.2)

- **Purpose**: API key authentication via HTTP headers
- **Usage**: API key authentication (`X-API-Key` header)

#### bcrypt (^6.0.0)

- **Purpose**: Password hashing
- **Why chosen**: Industry standard, configurable work factor
- **Usage**: Hash and verify user passwords
- **Note**: Native implementation (faster than bcryptjs)

#### express-session (^1.18.2)

- **Purpose**: Session management
- **Usage**: Cookie-based sessions for web UI

### Security & Validation

#### sanitize-html (^2.17.0)

- **Purpose**: HTML sanitization
- **Why chosen**: Configurable whitelist-based sanitizer
- **Usage**: Clean user-provided HTML in email templates
- **Pattern**: Allow specific tags/attributes, block dangerous content

#### express-rate-limit (^8.1.0)

- **Purpose**: Rate limiting middleware
- **Usage**: Limit unauthenticated requests, prevent abuse

#### cors (^2.8.5)

- **Purpose**: CORS middleware
- **Usage**: Enable cross-origin API access when needed

### Email

#### nodemailer (^7.0.9)

- **Purpose**: Email sending
- **Why chosen**: Reliable, supports all major transports (SMTP, SendGrid, etc.)
- **Usage**: Send vulnerability reports and password reset emails

#### handlebars (^4.7.8)

- **Purpose**: Email templating
- **Why chosen**: Simple, logic-less templates
- **Usage**: Generate HTML emails from templates

### Utilities

#### node-cron (^4.2.1)

- **Purpose**: Scheduled tasks
- **Why chosen**: Simple cron-like syntax
- **Usage**: Weekly reports, wordpress.org metadata sync

#### node-fetch (^3.3.2)

- **Purpose**: HTTP client
- **Why chosen**: Modern fetch API for Node.js
- **Usage**: Fetch data from wordpress.org API

#### maxmind (^5.0.1)

- **Purpose**: GeoIP lookups
- **Why chosen**: Fast local lookups, no external API calls
- **Usage**: Resolve IP addresses to countries for security events
- **Note**: Requires GeoLite2 database (free from MaxMind)

#### dotenv (^17.2.3)

- **Purpose**: Environment variable loading
- **Usage**: Load `.env` file configuration

### API Documentation

#### swagger-jsdoc (^6.2.8)

- **Purpose**: Generate OpenAPI spec from JSDoc comments
- **Usage**: Auto-generate API documentation from code

#### swagger-ui-express (^5.0.1)

- **Purpose**: Serve Swagger UI
- **Usage**: Interactive API documentation at `/doc`

### Frontend (Client-Side)

#### select2 (^4.1.0-rc.0)

- **Purpose**: Enhanced select dropdowns
- **Usage**: Website and component selection in UI

#### select2-bootstrap-5-theme (^1.3.0)

- **Purpose**: Bootstrap 5 theme for Select2
- **Usage**: Style Select2 to match Bootstrap UI

---

## Development Dependencies

### Testing

#### jest (^30.2.0)

- **Purpose**: Testing framework
- **Why chosen**: Comprehensive, fast, good mocking support
- **Usage**: All unit and integration tests

#### supertest (^7.1.4)

- **Purpose**: HTTP assertion library
- **Usage**: Test API endpoints

#### sqlite3 (^5.1.7)

- **Purpose**: In-memory database for tests
- **Why chosen**: Fast, no external dependencies
- **Usage**: Test database (instead of MySQL)

#### bcryptjs (^3.0.3)

- **Purpose**: JavaScript bcrypt implementation
- **Why chosen**: No native dependencies (easier in tests)
- **Usage**: Password hashing in tests (faster than native bcrypt)

### Code Quality

#### eslint (^9.38.0)

- **Purpose**: JavaScript linter
- **Why chosen**: Industry standard, extensive plugins
- **Usage**: Enforce coding standards

#### @eslint/js (^9.38.0)

- **Purpose**: ESLint recommended rules
- **Usage**: Base ESLint configuration

#### eslint-config-prettier (^10.1.8)

- **Purpose**: Disable ESLint rules that conflict with Prettier
- **Usage**: Integration with Prettier

#### prettier (^3.6.2)

- **Purpose**: Code formatter
- **Why chosen**: Opinionated, consistent formatting
- **Usage**: Auto-format code on save

#### prettier-plugin-sh (^0.18.0)

- **Purpose**: Shell script formatting
- **Usage**: Format bash scripts

#### globals (^16.4.0)

- **Purpose**: Global variable definitions for ESLint
- **Usage**: Define browser/node/jest globals

### Build & Development

#### nodemon (^3.1.10)

- **Purpose**: Auto-restart on file changes
- **Usage**: Development mode (`npm run dev`)

#### terser (^5.36.0)

- **Purpose**: JavaScript minifier
- **Usage**: Minify JS for production build

#### cssnano (^7.0.6)

- **Purpose**: CSS optimizer
- **Usage**: Minify CSS for production build

#### postcss (^8.4.49)

- **Purpose**: CSS transformation
- **Usage**: Process CSS during build

#### postcss-url (^10.1.3)

- **Purpose**: URL rewriting in CSS
- **Usage**: Resolve asset paths in CSS

#### html-minifier-terser (^7.2.0)

- **Purpose**: HTML minifier
- **Usage**: Minify HTML for production build

#### html-validate (^10.2.1)

- **Purpose**: HTML validation
- **Usage**: Validate HTML templates during build

#### fast-glob (^3.3.2)

- **Purpose**: File pattern matching
- **Usage**: Build script file discovery

---

## Version Constraints

### Overrides

```json
"overrides": {
  "validator": "13.15.23",
  "glob": "^10.0.0"
}
```

- **validator**: Force specific version to avoid vulnerabilities in dependencies
- **glob**: Ensure compatibility with newer Node.js versions

---

## Dependency Selection Criteria

When choosing a new dependency:

1. **Necessity**: Is it truly needed, or can we write it ourselves?
2. **Maintenance**: Active development? Recent commits?
3. **Security**: Known vulnerabilities? Security audit history?
4. **Size**: Does it add significant bloat?
5. **Popularity**: Download count, GitHub stars
6. **License**: Compatible with MIT license
7. **TypeScript Support**: Type definitions available? (future consideration)

---

## Alternatives Considered

### Database

- **mysql**: Older callback-based API
- **mysql2**: Good alternative, but mariadb has better promise support
- **Sequelize/TypeORM**: Too heavy for our needs, prefer raw SQL

### Authentication

- **express-jwt**: Considered for API auth, but passport-headerapikey is simpler
- **jsonwebtoken**: Might use for stateless auth in future CLI tool

### Email

- **SendGrid SDK**: Vendor lock-in, nodemailer supports SendGrid anyway
- **Mailgun SDK**: Same reasoning as SendGrid

### Testing

- **Mocha + Chai**: Requires more setup, Jest is more integrated
- **Vitest**: Modern alternative, but Jest has better ecosystem

---

## Notable Exclusions

### What we DON'T use

- **Sequelize/TypeORM**: ORM - adds complexity, prefer raw SQL
- **TypeScript**: Keep it simple, JavaScript is sufficient
- **Redis**: No caching layer needed yet
- **GraphQL**: REST API is sufficient
- **Socket.io**: No real-time features needed
- **React/Vue**: Frontend is vanilla JS + Bootstrap
- **MongoDB**: Relational data model fits better with SQL
- **Docker**: Deployment choice, not enforced by app
- **Kubernetes**: Overkill for typical deployment

---

## Updating Dependencies

### Regular Updates

```bash
# Check for outdated packages
npm outdated

# Update package.json
npm update

# Update to latest (breaking changes possible)
npm install package@latest
```

### Security Audits

```bash
# Check for vulnerabilities
npm audit

# Fix automatically (non-breaking)
npm audit fix

# Fix all (may have breaking changes)
npm audit fix --force
```

### Testing After Updates

1. Run `npm test` - ensure tests pass
2. Run `npm run dev` - manual testing
3. Check `npm run build` - build succeeds
4. Review CHANGELOG of updated packages

---

## Lock Files

### package-lock.json

- **Committed to git**: Yes
- **Purpose**: Ensure exact versions across environments
- **Production install**: `npm ci` (uses lockfile exactly)
- **Development install**: `npm install` (may update lockfile)

---

## Future Considerations

### Potential Additions

- **winston**: Structured logging (replace console.log)
- **joi**: Schema validation (API input validation)
- **jsonwebtoken**: Stateless auth for CLI tool
- **commander**: CLI framework for admin tool
- **chalk**: Colored terminal output for CLI
- **ora**: Spinners for CLI

### Potential Removals (CLI Transition)

- **express-session**: If we remove web admin UI
- **passport-local**: If we remove username/password login
- **handlebars**: If we simplify to plain text emails
- **select2**: If we remove web UI dropdowns

---

## Summary

VULNZ uses a lean, focused set of dependencies:

- Express for web framework
- MariaDB for database
- Passport for authentication
- Nodemailer for email
- Jest for testing

Prefer simplicity over features. Add dependencies only when necessary.
