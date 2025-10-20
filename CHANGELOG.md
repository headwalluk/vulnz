# Changelog

## 0.11.0 2025-10-20

- Fixed the saerch results by removing duplicates and apply a less aggressive sanitsation of the search query.

## 0.9.0- 2025-10-19

- Break the admin dashboard into multiple endpoints.
- Don't run the internal cron housekeeping tasks on pm2 cluster mode, unless we're the primary instance.
- Updated the API call logging, with call-log retention housekeeping.
- Minor cosmetic adjustments.
- Updated swagger docs.
