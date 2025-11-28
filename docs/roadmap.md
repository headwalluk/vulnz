# Roadmap

This document tracks planned improvements and enhancements for VULNZ.

## Security Enhancements

### Session Cookie Security (Medium Priority)

- [ ] Add `secure: true` flag for production cookies (HTTPS-only)
- [ ] Add `sameSite: 'lax'` for CSRF protection
- [ ] Verify `httpOnly: true` is set (already present)

### Helmet Configuration (Low Priority)

- [ ] Implement more restrictive Content Security Policy (CSP)
- [ ] Configure specific directives for default-src, script-src, style-src, img-src
- [ ] Test CSP configuration with actual application usage

### API Key Management (Medium Priority)

- [ ] Add expiration dates for API keys
- [ ] Track last used timestamp for each API key
- [ ] Implement API key rotation capability
- [ ] Add UI for key management and renewal

### Audit Logging (Low Priority)

- [ ] Track failed login attempts
- [ ] Log admin actions (user creation/deletion, role changes)
- [ ] Implement suspicious activity detection
- [ ] Add admin dashboard for security events

### Environment Validation (Low Priority)

- [ ] Add startup validation for critical environment variables
- [ ] Check SESSION_SECRET is set and meets minimum length
- [ ] Verify database credentials are configured
- [ ] Ensure SMTP settings are present if email features enabled

### Password Reset Token Cleanup (Low Priority)

- [ ] Add cron job to purge expired password reset tokens
- [ ] Similar to existing email log and API log cleanup
- [ ] Configurable retention period via environment variable

### CORS Configuration (As Needed)

- [ ] Evaluate if CORS is needed for API access patterns
- [ ] Configure explicit CORS policy if required
- [ ] Document CORS configuration in deployment guide

## Feature Enhancements

### Vulnerability Data Sources

- [ ] Add additional vulnerability feed integrations beyond Wordfence
- [ ] Support for WPScan vulnerability database
- [ ] Support for CVE/NVD integration
- [ ] Automated deduplication of vulnerabilities from multiple sources

### Reporting Improvements

- [ ] Add customizable report templates
- [ ] Support for on-demand reports (not just scheduled)
- [ ] PDF export capability
- [ ] Dashboard analytics and charts

### API Enhancements

- [ ] Webhook support for vulnerability notifications
- [ ] Bulk operations for website and component management
- [ ] GraphQL endpoint consideration
- [ ] API versioning strategy

### UI/UX Improvements

- [ ] Dark mode support
- [ ] Improved mobile responsiveness
- [ ] Search autocomplete and suggestions
- [ ] Bulk actions in admin interfaces

## Performance Optimizations

- [ ] Database query optimization review
- [ ] Implement caching layer (Redis consideration)
- [ ] Rate limiting optimization for high-traffic scenarios
- [ ] Connection pool tuning

## Testing & Quality

- [ ] Add unit test framework
- [ ] Integration tests for API endpoints
- [ ] Security scanning automation
- [ ] CI/CD pipeline setup

## Documentation

- [ ] API client examples in multiple languages
- [ ] Video tutorials for common tasks
- [ ] Troubleshooting guide expansion
- [ ] Architecture documentation

## Deployment & Operations

- [ ] Docker container support
- [ ] Kubernetes deployment examples
- [ ] Backup and restore procedures documentation
- [ ] High availability configuration guide
