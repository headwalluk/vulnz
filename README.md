# VULNZ

** PRE-RELEASE :: In Development **

Self-hosted vulnerability database for WP plugins and themes. The database is primarlly accessed through an API, and there is a UI for basic admin tasks.

The application pulls from wordpress.org for plugin & theme meta data. We don't store details about each vulnerability - only link(s) to the original disclosure URL(s).

This can best be thought of as a vulnerability metabase.

## Who is this for?

The app is designed to help WordPress hosting providers collate and manage WP plugin vulnerabilities across their clients' sites. If your VULNZ installation to be publically accessible, you can host it behind a reverse-proxy and manage your SSL in Apache/Nginx.

## Requirements

- MySQL/MariaDB: Any recent version should be fine.
- BASH: Required if you want to use the tools to backup, restore and pull from wordfence.com.
- Node: Any recent LTS should be fine. Tested with Node v22.14.0

```bash
# Clone the repo
git clone Github https://github.com/headwalluk/vulnz

```

## Getting started

Copy `env.sample` to `.env` and configure it for your environment. Pay special attention to the following:

- **Database Credentials:** Set up a MySQL/MariaDB database and add the credentials.
- **`SERVER_MODE`:** Initially, run in `setup` mode to create the first administrator account. Once that's done, switch to `production`.
- **`REGISTRATION_ENABLED`:** Set to `false` to prevent new user registrations.
- **Rate Limiting:** Configure `UNAUTH_SEARCH_LIMIT_PER_SECOND` to control unauthenticated search requests.
- **API Key Limits:** Set `MAX_API_KEYS_PER_USER` to define the maximum number of API keys a user can create.
- **SMTP Details:** Add your SMTP server details for password reset emails.
- **`SESSION_SECRET`:** Generate a long, random string for session security.

```bash
# Install Node packages.
npm install

# Start the server
npm run start

# Point your browser at http://localhost:3000/ and register a user account.
open http://localhost:3000/
```

## Populating the vulnerability meta data

There's a script (to be written) that pulls in the Wordfence public vulnerability feed and adds the disclosure URLs to our database. Other vulnerability sources can be added, and its easy to write your own - all you need to do is POST an array of vulnerability URLs to the plugin's slug & version, to mark a release as being vulnerable. If you pass an empty array (or null) then the release is marked as having no known vulnerabilities.

### Example

If you're running vulnz on a localhost on port 3000 (the defaults) and you have [HTTPie](https://httpie.io/) installed:

```bash
# Our request body.
BODY='{"urls": [ "https://a-security-website/news/security-hole-found-in-woo-1-2-3/ ] }'

# POST to our locally hosted VULNZ API.
echo "${BODY}" | http://localhost:3000/api/components/wordpress-plugin/woocommerce/1.2.3 \
   "X-API-Key: YOURAPIKEYINHERE"
```
