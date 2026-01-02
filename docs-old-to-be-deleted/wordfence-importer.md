# Wordfence Feed Importer

You can pull the public Wordfence Intelligence feed and insert vulnerabilities into VULNZ in small batches using the helper script at `scripts/process-wordfence-feed.sh`. It's suitable for running periodically via cron on Linux/BSD servers.

## Prerequisites

- **Bash** (installed by default on most systems)
- **jq** - command-line JSON processor
- **wget** - network downloader
- **HTTPie** - provides the `http`/`https` CLI tools

## Setup

1. Create a `.env.wordfence` file in the project root with at least the following:

```bash
# VULNZ API base (note the /api suffix)
VULNZ_API_URL=http://localhost:3000/api

# An API key with permissions to add component releases and vulnerabilities
VULNZ_API_KEY=YOUR_API_KEY_HERE

# Optional: a persistent working directory for cache/state
# (recommended: avoids re-downloading and preserves processed IDs)
WORK_DIR=/var/local/vulnz

# Optional: set to 'true' to print extra diagnostics when the script runs
ENABLE_DIAGNOSTICS=false

# Optional: number of Wordfence entries to process per run (default 20)
BATCH_SIZE=20
```

You can copy from the sample file:

```bash
cp env.wordfence.sample .env.wordfence
```

2. Run the script manually to test:

```bash
bash scripts/process-wordfence-feed.sh
```

## What It Does

- Downloads the Wordfence production feed JSON and caches it under `WORK_DIR` (re-fetched daily).
- Maintains a simple state file of processed Wordfence IDs (cleared weekly) to avoid re-processing.
- For each feed entry, processes affected plugin versions and adds vulnerability URLs to matching releases in VULNZ via the API.
- Batches work in small chunks per run (default batch size is 20; override by setting `BATCH_SIZE` in `.env.wordfence`).

## Cron Scheduling

Example to run every hour:

```bash
0 * * * * /usr/bin/env bash /path/to/vulnz/scripts/process-wordfence-feed.sh > /dev/null 2>&1
```

## Notes

- The script currently focuses on WordPress plugins. Theme entries in the feed are skipped.
- Ensure your `VULNZ_API_URL` matches your deployment (e.g., behind a reverse proxy, use the internal API base).
- If your instance enforces rate limits, keep the default batch size or schedule less frequently.
- The `WORK_DIR` is used to cache the downloaded feed and track processed entries. Using a persistent location (like `/var/local/vulnz`) is recommended to avoid re-downloading and re-processing.
