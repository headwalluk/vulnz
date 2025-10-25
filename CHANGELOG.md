# Changelog

## 0.50.0 2025-10-25

- **Security Fix:** Implemented a middleware to prevent unauthenticated access to `.html` pages, resolving a critical security loophole.
- **Dashboard UI Enhancements:**
  - Vulnerable components are now sorted to the top of the list in the website info modal.
  - The modal now displays website `meta` data instead of the owner's email, with special formatting for links and email addresses.
  - Various styling improvements, such as removing bold from component slugs and adding icons to links.
- **API Improvements:**
  - The `/api/websites` endpoints now return an empty object `{}` for the `meta` field when it is `null`.
- **Code Quality:**
  - Fixed a linting error in `public/js/dashboard.js`.

## 0.45.0 2025-10-25

- Fixed the report emails so administrators get ALL sites, whereas each user only gets their own sites.
- Added a JSON meta property to the website model, so we can POST/PUT custom website meta data as key/value pairs (e.g. Login URL, host server, whatever).

## 0.38.0 2025-10-24

- Added support for dev/staging sites.
- Added support for user account alternative email address for reporting.
- Weekly summary email cron is in there now (1st version).

## 0.33.0 2025-10-23

- Cleaner data input/out when POSTing to the /api/users route to create new users (using an administrator's API key in the request header).
- Tidying up the list of websites in the /dahboard page.
- Tidying up the modal plugin list when clicking a website's "info..." button.
- Made the paging toolbars for result-sets more consistent across the back-end UI.
- Tweaking the domainRegex when validitaing domains of newly created website records.
- Removed some tooltips that were just cluttering the UI.

## 0.15.0 2025-10-21

- Support for multiple users monitoring their own websites independent of each other.
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
