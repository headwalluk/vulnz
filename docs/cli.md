# CLI Administration Tool

VULNZ includes a CLI tool (`bin/vulnz.js`) for all administration tasks. New functionality is added here rather than the web UI.

## Running the CLI

From the project root directory (development):

```bash
node bin/vulnz.js < command > [arguments]
```

If installed globally via npm, use `vulnz` directly:

```bash
vulnz < command > [arguments]
```

The CLI reads your `.env` file automatically. Run it from the project root directory where `.env` lives.

---

## User Management Commands

### `user:add <email> <password> [--admin]`

Create a new user account. Pass `--admin` to grant the administrator role.

```bash
# Create a standard user
node bin/vulnz.js user:add alice@example.com 'SecurePass123!'

# Create an administrator
node bin/vulnz.js user:add admin@example.com 'SecurePass123!' --admin
```

Output:

```
Created user: alice@example.com (id=3, roles=user)
Created user: admin@example.com (id=1, roles=user,administrator)
```

---

### `user:list [--json]`

List all user accounts in a formatted table. Pass `--json` for machine-readable output.

```bash
# Formatted table
node bin/vulnz.js user:list

# JSON output (useful for scripting)
node bin/vulnz.js user:list --json
```

Output:

```
ID  USERNAME               ROLES              STATUS
------------------------------------------------------------
1   admin@example.com      user,administrator  active
2   alice@example.com      user                active
3   blocked@example.com    user                BLOCKED
```

---

### `user:delete <email>`

Permanently delete a user account. This cannot be undone.

```bash
node bin/vulnz.js user:delete alice@example.com
```

Output:

```
Deleted user: alice@example.com (id=2)
```

---

### `user:block <email>`

Block a user account, preventing them from logging in and disabling their API keys. Their data is preserved.

```bash
node bin/vulnz.js user:block alice@example.com
```

Output:

```
Blocked user: alice@example.com (id=2)
```

---

### `user:unblock <email>`

Unblock a previously blocked user, restoring their access.

```bash
node bin/vulnz.js user:unblock alice@example.com
```

Output:

```
Unblocked user: alice@example.com (id=2)
```

---

### `user:reset-password <email> <new-password>`

Reset the password for an existing user account.

```bash
node bin/vulnz.js user:reset-password alice@example.com 'NewSecurePass456!'
```

Output:

```
Password reset for user: alice@example.com (id=2)
```

---

### `user:info <email> [--json]`

Show full account details including status, roles, reporting preferences, API keys, and subscription state.

```bash
# Table view
node bin/vulnz.js user:info alice@example.com

# JSON output
node bin/vulnz.js user:info alice@example.com --json
```

Output:

```
User: alice@example.com (id=3)
Status: active
Roles: user
Max API Keys: 1
Reporting Email: alice@example.com
Reporting Day: MON
White Label: no

API Keys:
  abc123def456abc123def456abc123def456  (created 2026-03-28T14:30:00.000Z)

Subscriptions:
  https://vulnz.net  state=active  max_sites=50
```

---

## API Key Management Commands

API keys are used by WordPress sites and other clients to authenticate with the VULNZ REST API.

### `key:list <email> [--json]`

List all API keys associated with a user account.

```bash
# Formatted table
node bin/vulnz.js key:list alice@example.com

# JSON output (useful for scripting)
node bin/vulnz.js key:list alice@example.com --json
```

Output:

```
ID  API KEY                               CREATED
------------------------------------------------------------------
1   abc123def456abc123def456abc123def456  2026-02-01T10:00:00.000Z
2   789xyz789xyz789xyz789xyz789xyz789xyz  2026-02-10T14:30:00.000Z
```

---

### `key:generate <email>`

Generate a new API key for a user account. The new key is printed to stdout — copy it immediately, as it cannot be retrieved later.

```bash
node bin/vulnz.js key:generate alice@example.com
```

Output:

```
Generated API key for alice@example.com: abc123def456abc123def456abc123def456
```

---

### `key:revoke <key>`

Permanently revoke an API key. Any client using this key will immediately lose API access.

```bash
node bin/vulnz.js key:revoke abc123def456abc123def456abc123def456
```

Output:

```
Revoked API key: abc123def456abc123def456abc123def456
```

---

## Database Commands

### `db:migrate [--json]`

Apply any pending migrations without starting the server. Migrations also run automatically at API startup, so this is for applying a schema change ahead of a deploy, or for working with the CLI on a database that is not yet up to date (CLI commands do **not** run migrations themselves).

```bash
node bin/vulnz.js db:migrate
```

Output:

```
Applied 1 migration(s):
  20260724190000-add-release-urgency.js
```

When there is nothing to do:

```
No pending migrations — the schema is up to date.
```

Migrations are forward-only and tracked in the `migrations` table — there is no rollback.

---

## App Settings Commands

VULNZ stores runtime configuration in the database. These commands manage the key-value settings store, which supports typed values (string, integer, float, boolean).

### `setting:get <key>`

Get a setting value. The value is automatically cast to its stored type.

```bash
node bin/vulnz.js setting:get notifications.processing_mode
```

Output:

```
queue
```

---

### `setting:set <key> <value> [--type <type>] [--description <desc>] [--category <cat>]`

Set a setting value. The `--type` flag defaults to `string`.

```bash
# String setting
node bin/vulnz.js setting:set notifications.processing_mode immediate

# Boolean setting
node bin/vulnz.js setting:set feature.beta true --type boolean --category features

# Integer with description
node bin/vulnz.js setting:set retention.days 30 --type integer --description "Data retention period"
```

Output:

```
notifications.processing_mode = immediate
```

---

### `setting:list [--category <cat>] [--json]`

List all settings, optionally filtered by category.

```bash
# All settings
node bin/vulnz.js setting:list

# Filter by category
node bin/vulnz.js setting:list --category notifications

# JSON output
node bin/vulnz.js setting:list --json
```

Output:

```
KEY                              VALUE   TYPE     CATEGORY
--------------------------------------------------------------
notifications.processing_mode    queue   string   notifications
wordpress.current_version        6.7.1   string   wordpress
```

---

## Diagnostic Commands

These commands query the database directly and are useful for checking ingestion health and inspecting component data.

### `feed:status [--json]`

Show database statistics and the last Wordfence sync timestamp.

```bash
# Formatted output
node bin/vulnz.js feed:status

# JSON output
node bin/vulnz.js feed:status --json
```

Output:

```
Feed Status
-----------
  Components:           1200
  Releases:            54321
  Vulnerabilities:       789
  Last wporg sync:  2026-01-15T10:30:00.000Z
```

Shows `never` if no sync has occurred yet.

---

### `component:find <slug> [--json]`

Look up a component by its slug. Returns all matches — a slug may exist as both a plugin and a theme.

```bash
# Formatted table
node bin/vulnz.js component:find woocommerce

# JSON output
node bin/vulnz.js component:find woocommerce --json
```

Output:

```
ID  SLUG         TYPE    TITLE        RELEASES  VULNS
------------------------------------------------------
42  woocommerce  plugin  WooCommerce       300      5
```

Returns "No component found with slug: ..." if the slug is not in the database.

---

### `release:list <slug> [--json]`

List all known releases for a component slug, with per-release vulnerability counts.

```bash
# Formatted table
node bin/vulnz.js release:list woocommerce

# JSON output
node bin/vulnz.js release:list woocommerce --json
```

Output:

```
Component: woocommerce (WooCommerce) — plugin

VERSION  VULNS
--------------
8.5.0    2
8.4.1    -
8.4.0    1

3 release(s) listed.
```

A dash (`-`) indicates no known vulnerabilities for that release.

---

## Known Malware Commands

Mark a component as known malware. The verdict applies to **every version** of that component — past, present, and any version ingested in future — because malware is a property of the artefact, not of a release.

These are CLI-only by design. There is no API write path for the malware flag: `GET /api/components/:type/:slug` auto-creates components and the vulnerability POST route is open to any authenticated key, so a fleet key must not be able to set (or clear) a verdict that is actioned across every site at once. Reads are on the API as normal — see the [API usage guide](api-usage.md#known-malware).

### `component:malware:add <type> <slug> [--summary <text>] [--url <url>] [--force]`

Flag a component as known malware, creating it first if the slug has never been ingested.

```bash
node bin/vulnz.js component:malware:add wordpress-plugin easypost \
  --summary "Backdoor file dropper" \
  --url "https://vulnz.net/malware/wordpress-plugin/easypost/"
```

Output:

```
Flagged as malware: wordpress-plugin/easypost (id=36183)
Summary: Backdoor file dropper
URL: https://vulnz.net/malware/wordpress-plugin/easypost/
Applies to all 2 known release(s), and any ingested later.
```

`--url` links to a write-up of what the malware does and is surfaced to API consumers as `malware_url`. It is optional and left null when omitted — deliberately not derived from the slug, because a link that 404s in a customer-facing alert costs more trust than no link at all. A malformed URL is rejected rather than stored.

**The wordpress.org safety check.** Fake plugins commonly squat on a legitimate plugin's slug, and flagging one of those would report a real plugin as malware across the whole fleet. For `wordpress-plugin` components the command therefore does a live wordpress.org lookup first and refuses to flag a slug that is published there:

```
Error: "contact-form-7" is published on wordpress.org as "Contact Form 7".
       https://wordpress.org/plugins/contact-form-7/
       Flagging it would report a legitimate plugin as malware across the fleet.
       If the wordpress.org listing is itself malicious, re-run with --force.
```

The check is live rather than a read of the stored `wporg_available` column, which is `NULL` for the overwhelming majority of components and so cannot answer the question. If wordpress.org cannot be reached the command warns and proceeds — a network blip should not block an incident response. `--force` skips the check entirely, and is also how you flag a genuinely malicious plugin that is still listed on wordpress.org.

Non-plugin types (`wordpress-theme`, `npm-package`, …) are not checked: the plugin-info endpoint does not cover them.

Re-running against an already-flagged component updates the summary and the timestamp.

### `component:malware:remove <type> <slug>`

Clear a verdict — for a slug flagged in error.

```bash
node bin/vulnz.js component:malware:remove wordpress-plugin easypost
```

### `component:malware:list [--json]`

List every flagged component, most recently flagged first.

```bash
node bin/vulnz.js component:malware:list
```

Output:

```
SLUG      TYPE              SUMMARY                RELEASES  FLAGGED
--------------------------------------------------------------------
easypost  wordpress-plugin  Backdoor file dropper         2  2026-08-12 19:17:36

1 component(s) flagged.
```

---

## WordPress Fast Update Trigger Commands

Manage the watchlist and version syncs behind the fleet fast-update manifest (`GET /api/wordpress/latest-versions`). See the [Fast Update Triggers guide](fast-update-triggers.md) for how the feature works, the response format, and fleet-side integration — this section is the command reference.

### `wporg:watchlist [--json]`

Show the current high-priority watchlist: the WordPress core latest version, each watched plugin with its latest version, and any blind spots (watchlist slugs that cannot be tracked via wordpress.org).

```bash
node bin/vulnz.js wporg:watchlist
```

Output:

```
WordPress core latest: 7.0.2
High-priority plugins (6):
  advanced-custom-fields           6.8.6
  akismet                          5.7
  contact-form-7                   6.1.6
  elementor                        4.2.0
  woocommerce                      10.9.5
  wordpress-seo                    28.1
Blind spots (0): none
```

---

### `wporg:watchlist:rebuild [--json]`

Rebuild the watchlist now: the static "always monitor" list unioned with the top-N most-installed watchable plugins. Run this after editing the static list to apply the change immediately (otherwise it happens on the 6-hourly schedule).

```bash
node bin/vulnz.js wporg:watchlist:rebuild
```

Output:

```
Watchlist rebuilt: 6 high-priority (6 static, 0 derived), 0 blind spot(s), 0 probed.
```

---

### `wporg:watchlist:static:list [--json]`

List the static "always monitor" watchlist slugs. These are always kept in the high-priority lane regardless of install count.

```bash
node bin/vulnz.js wporg:watchlist:static:list
```

Output:

```
Static watchlist (6):
  advanced-custom-fields
  akismet
  contact-form-7
  elementor
  woocommerce
  wordpress-seo
```

---

### `wporg:watchlist:static:add <slug>`

Add a plugin slug to the static list. The slug must be a valid wordpress.org directory slug (lowercase letters, numbers, and hyphens). Idempotent — adding an existing slug is a no-op.

```bash
node bin/vulnz.js wporg:watchlist:static:add wordfence
```

Output:

```
Added "wordfence" to the static watchlist (7 total).
Run "vulnz wporg:watchlist:rebuild" to apply the change now.
```

An invalid slug is rejected with a non-zero exit code.

---

### `wporg:watchlist:static:remove <slug>`

Remove a plugin slug from the static list. Idempotent — removing an absent slug is a no-op.

```bash
node bin/vulnz.js wporg:watchlist:static:remove akismet
```

Output:

```
Removed "akismet" from the static watchlist (5 remaining).
Run "vulnz wporg:watchlist:rebuild" to apply the change now.
```

---

### `wporg:sync-high`

Sync every high-priority (watchlist) plugin from wordpress.org now, instead of waiting for the hourly run.

```bash
node bin/vulnz.js wporg:sync-high
```

Output:

```
High-priority sync: 6 synced, 0 unavailable, 0 transient, 0 error(s).
```

---

### `wporg:sync-core [--json]`

Refresh the WordPress core version from wordpress.org now. Updates the `wordpress.current_version` and `wordpress.safe_versions` settings, which the sync owns — do not set them by hand.

```bash
node bin/vulnz.js wporg:sync-core
```

Output:

```
WordPress core version synced: latest=7.0.2 (24 safe versions cached).
```

Exits non-zero if the sync could not update the settings (e.g. wordpress.org unreachable), leaving the existing values untouched.

---

## LLM Classification Commands

Manage the classification that decides whether a plugin release is an emergency security update or routine work — the `is_urgent` flag in the fast-update manifest. See [Fast update triggers](fast-update-triggers.md#urgent-updates) for what the flag means and how it is derived.

### `llm:status [--json]`

Show provider configuration and the size of the classification backlog. Useful for confirming a deployment picked up its API key.

```bash
node bin/vulnz.js llm:status
```

Output:

```
Enabled:  yes
API key:  present
Endpoint: https://openrouter.ai/api/v1
Model:    anthropic/claude-haiku-4.5
Pending:  3 release(s) awaiting classification
Tasks:
  release-urgency — Classify a WordPress plugin release as an urgent security update or a routine one
```

### `llm:classify-release <slug> <version> [--save] [--json]`

Classify a single wordpress.org plugin release. **Dry run by default** — pass `--save` to persist the verdict against the stored release.

```bash
node bin/vulnz.js llm:classify-release woocommerce 10.9.5
```

Output:

```
woocommerce 10.9.5
  is_urgent: false
  summary:   Fixes VAT exemption not applying during block checkout for logged-in users.
  source:    changelog_llm (anthropic/claude-haiku-4.5)
  Not saved (dry run — pass --save to persist).
```

The changelog is read from the stored release if VULNZ already has one. Otherwise it is fetched live from wordpress.org — which only publishes the changelog for the **current** release, so classifying an older version is only possible when its changelog was captured at the time.

`source` reports how the verdict was reached: `changelog_llm` for the model's own judgement, or `keyword_override` where the changelog named a critical vulnerability class the model had not flagged.

### `llm:classify-pending [--limit <n>] [--json]`

Classify watchlist releases that have no verdict yet — the same work the hourly cron does, run on demand. Useful straight after enabling `LLM_ENABLED`, to populate the manifest without waiting for the next scheduled pass.

```bash
node bin/vulnz.js wporg:sync-high        # capture current changelogs first
node bin/vulnz.js llm:classify-pending
```

Output:

```
Classified 4 release(s): 1 urgent, 0 failed.
```

Exits non-zero if the run was skipped (classification disabled or no API key) or any release failed. Failed releases stay queued and are retried on the next run.

---

## Notification Site Commands

Manage WordPress/WooCommerce sites that send subscription notifications to this API. See [configuration](configuration.md) for the `VULNZ_NOTIFY_SECRET` environment variable.

### `site:add <url> <data-secret> [--ip-allowlist <ips>]`

Register a new notification site. The `data-secret` is the shared secret used when this API calls the site's REST API for customer/subscription data.

```bash
node bin/vulnz.js site:add https://vulnz.net sk_secret_here

# With IP restriction
node bin/vulnz.js site:add https://vulnz.net sk_secret_here --ip-allowlist "203.0.113.10,198.51.100.20"
```

Output:

```
Registered site: https://vulnz.net (id=1)
```

---

### `site:list [--json]`

List all registered notification sites.

```bash
node bin/vulnz.js site:list
```

Output:

```
ID  SITE URL            ACTIVE  IP ALLOWLIST
--------------------------------------------
1   https://vulnz.net   yes     -
```

---

### `site:remove <url>`

Remove a registered notification site. This also removes any queued notifications for the site.

```bash
node bin/vulnz.js site:remove https://vulnz.net
```

Output:

```
Removed site: https://vulnz.net (id=1)
```

---

## Notification Queue Commands

Monitor and process the notification queue. Notifications are queued when WordPress sites report subscription changes.

### `queue:status [--json]`

Show the current state of the notification queue.

```bash
node bin/vulnz.js queue:status
```

Output:

```
Notification Queue
------------------
  Pending:          3
  Processing:       0
  Completed:       42
  Failed:           1
```

---

### `queue:process [--batch-size <n>]`

Process pending notifications from the queue. Defaults to a batch size of 10.

```bash
# Process up to 10
node bin/vulnz.js queue:process

# Process up to 50
node bin/vulnz.js queue:process --batch-size 50
```

Output:

```
Processed 3 notification(s).
```

---

## Exit Codes

| Code | Meaning                                        |
| ---- | ---------------------------------------------- |
| `0`  | Success                                        |
| `1`  | Error (user not found, validation failure, DB) |

Errors are written to stderr so they can be captured separately in scripts.
