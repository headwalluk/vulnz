# Changelog

## 0.14.0 2025-10-21

- The /api/websites REST endpoint is coming together now, with an addition to the /dashboard page su users can track the websites' vulnerabilities.

## 0.12.0 2025-10-20

- Fixed the saerch results by removing duplicates and apply a less aggressive sanitsation of the search query.
- Added linting and formatting (prettier) and tidied up the code a bit.

## 0.9.0- 2025-10-19

- Break the admin dashboard into multiple endpoints.
- Don't run the internal cron housekeeping tasks on pm2 cluster mode, unless we're the primary instance.
- Updated the API call logging, with call-log retention housekeeping.
- Minor cosmetic adjustments.
- Updated swagger docs.
