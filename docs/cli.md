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
