#!/bin/bash

##
# process-npm-vulnerabilities.sh
#
# Queries OSV.dev for vulnerabilities affecting tracked npm packages
# and inserts/updates vulnerability records in VULNZ via the API.
#
# Create .env.npm-vulnerabilities in the project root with:
#   VULNZ_API_KEY=your-api-key
#   VULNZ_API_URL=http://localhost:3000/api
#   WORK_DIR=/var/local/vulnz    (optional, defaults to project var/)
#   BATCH_SIZE=100               (optional, max packages per OSV.dev request)
#   ENABLE_DIAGNOSTICS=true      (optional, verbose output)
#
# Add to crontab for daily vulnerability updates:
#   0 3 * * * /path/to/scripts/process-npm-vulnerabilities.sh >/dev/null 2>&1
#
# OSV.dev API: https://google.github.io/osv.dev/post-v1-querybatch/
##

THIS_SCRIPT="$(realpath "${BASH_SOURCE[0]}")"
THIS_DIR="$(dirname "${THIS_SCRIPT}")"
PROJECT_ROOT_DIR="$(realpath "${THIS_DIR}/..")"
BATCH_SIZE="${BATCH_SIZE:-100}"
OSV_API_URL="https://api.osv.dev/v1/querybatch"

# ============================================================
# Dependency checks
# ============================================================
REQUIRED_BINS=(jq curl http)
for REQUIRED_BIN in "${REQUIRED_BINS[@]}"; do
  if ! command -v "${REQUIRED_BIN}" > /dev/null 2>&1; then
    echo "ERROR: required binary not found in PATH: ${REQUIRED_BIN}"
    exit 1
  fi
done

# ============================================================
# Load configuration
# ============================================================
ENV_FILE="${PROJECT_ROOT_DIR}/.env.npm-vulnerabilities"
if [ ! -f "${ENV_FILE}" ]; then
  echo "ERROR: config file not found: ${ENV_FILE}"
  echo "Create it with VULNZ_API_KEY and VULNZ_API_URL set."
  exit 1
fi
# shellcheck source=/dev/null
source "${ENV_FILE}"

if [ -z "${VULNZ_API_KEY}" ] || [ -z "${VULNZ_API_URL}" ]; then
  echo "ERROR: VULNZ_API_KEY or VULNZ_API_URL not set in ${ENV_FILE}"
  exit 1
fi

if [ -z "${WORK_DIR}" ]; then
  echo "WORK_DIR not set — using default. Consider setting it to a persistent location."
  WORK_DIR="${PROJECT_ROOT_DIR}/var"
fi

mkdir -p "${WORK_DIR}"

if [ ! -d "${WORK_DIR}" ]; then
  echo "ERROR: work directory does not exist and could not be created: ${WORK_DIR}"
  exit 1
fi

if [ "${ENABLE_DIAGNOSTICS}" == 'true' ]; then
  echo "INFO: script=${THIS_SCRIPT}"
  echo "INFO: project_root=${PROJECT_ROOT_DIR}"
  echo "INFO: work_dir=${WORK_DIR}"
  echo "INFO: api_url=${VULNZ_API_URL}"
  echo "INFO: batch_size=${BATCH_SIZE}"
fi

# ============================================================
# Semver comparison utility
#
# Sets global __ to: -1 (v1 < v2), 0 (v1 == v2), 1 (v1 > v2)
# Strips pre-release suffixes before comparing (e.g. "1.0.0-beta" → "1.0.0")
# ============================================================
function semver_compare() {
  local ver1_raw="${1#v}"
  local ver2_raw="${2#v}"

  # Strip pre-release tags (anything after - or +)
  local v1="${ver1_raw%%-*}"
  v1="${v1%%+*}"
  local v2="${ver2_raw%%-*}"
  v2="${v2%%+*}"

  if [[ "${v1}" == "${v2}" ]]; then
    __=0
    return
  fi

  local IFS=.
  local i
  local ver1_parts=($v1)
  local ver2_parts=($v2)

  for ((i = ${#ver1_parts[@]}; i < ${#ver2_parts[@]}; i++)); do
    ver1_parts[i]=0
  done

  for ((i = 0; i < ${#ver1_parts[@]}; i++)); do
    if [[ -z "${ver2_parts[i]}" ]]; then
      ver2_parts[i]=0
    fi
    local n1="${ver1_parts[i]//[^0-9]/}"
    local n2="${ver2_parts[i]//[^0-9]/}"
    n1="${n1:-0}"
    n2="${n2:-0}"
    if ((10#${n1} > 10#${n2})); then
      __=1
      return
    fi
    if ((10#${n1} < 10#${n2})); then
      __=-1
      return
    fi
  done

  __=0
}

# ============================================================
# Check whether a tracked version is affected by a vulnerability
#
# Strategy:
#   1. Check explicit `versions` list from OSV.dev (fastest, most accurate)
#   2. Fall back to SEMVER range checking if no explicit list
#
# Returns: 0 if affected, 1 if not affected
# ============================================================
function is_version_affected() {
  local vuln_json="$1"
  local package_name="$2"
  local version="$3"

  # Step 1: Check explicit versions list
  local in_list
  in_list=$(echo "${vuln_json}" | jq --arg pkg "${package_name}" --arg ver "${version}" \
    '.affected[]
     | select(.package.name == $pkg and .package.ecosystem == "npm")
     | .versions // []
     | any(. == $ver)' \
    2>/dev/null)

  if [[ "${in_list}" == "true" ]]; then
    return 0
  fi

  # Step 2: Fall back to SEMVER range checking
  local ranges_json
  ranges_json=$(echo "${vuln_json}" | jq --arg pkg "${package_name}" \
    '[.affected[]
     | select(.package.name == $pkg and .package.ecosystem == "npm")
     | .ranges // []
     | .[]
     | select(.type == "SEMVER")]' \
    2>/dev/null)

  local range_count
  range_count=$(echo "${ranges_json}" | jq 'length' 2>/dev/null)
  range_count="${range_count:-0}"

  local range_index=0
  while [ "${range_index}" -lt "${range_count}" ]; do
    local introduced fixed

    introduced=$(echo "${ranges_json}" | jq -r --argjson idx "${range_index}" \
      '.[$idx].events[] | select(has("introduced")) | .introduced' 2>/dev/null | head -1)

    fixed=$(echo "${ranges_json}" | jq -r --argjson idx "${range_index}" \
      '.[$idx].events[] | select(has("fixed")) | .fixed' 2>/dev/null | head -1)

    # Strip "v" prefix from version strings
    introduced="${introduced#v}"
    fixed="${fixed#v}"

    # Check: version >= introduced (or no lower bound)
    local is_after_introduced=0
    if [ -z "${introduced}" ] || [ "${introduced}" == "0" ]; then
      is_after_introduced=1
    else
      semver_compare "${version}" "${introduced}"
      if [ "${__}" -ge 0 ]; then
        is_after_introduced=1
      fi
    fi

    # Check: version < fixed (or no fix available yet)
    local is_before_fixed=0
    if [ -z "${fixed}" ]; then
      is_before_fixed=1
    else
      semver_compare "${version}" "${fixed}"
      if [ "${__}" -lt 0 ]; then
        is_before_fixed=1
      fi
    fi

    if [ "${is_after_introduced}" -eq 1 ] && [ "${is_before_fixed}" -eq 1 ]; then
      return 0
    fi

    range_index=$((range_index + 1))
  done

  return 1
}

# ============================================================
# Step 1: Fetch all tracked npm packages from VULNZ
# ============================================================
echo "** Processing npm vulnerabilities via OSV.dev **"
echo "Fetching tracked npm packages from VULNZ..."

declare -a ALL_SLUGS
PAGE=1
PAGE_SIZE=500

while true; do
  RESPONSE=$(http --ignore-stdin GET "${VULNZ_API_URL}/components?page=${PAGE}&limit=${PAGE_SIZE}" \
    "X-API-Key: ${VULNZ_API_KEY}" 2>/dev/null)

  if [ -z "${RESPONSE}" ]; then
    echo "ERROR: Empty response from VULNZ API (page ${PAGE})" >&2
    exit 1
  fi

  ERR=$(echo "${RESPONSE}" | jq -r 'if type == "string" then . else empty end' 2>/dev/null)
  if [ -n "${ERR}" ]; then
    echo "ERROR: VULNZ API returned an error: ${ERR}" >&2
    exit 1
  fi

  mapfile -t PAGE_SLUGS < <(echo "${RESPONSE}" | jq -r \
    '.components[] | select(.component_type_slug == "npm-package") | .slug' 2>/dev/null)
  ALL_SLUGS+=("${PAGE_SLUGS[@]}")

  TOTAL_PAGES=$(echo "${RESPONSE}" | jq -r '.totalPages // 1')

  if [ "${PAGE}" -ge "${TOTAL_PAGES}" ]; then
    break
  fi
  PAGE=$((PAGE + 1))
done

TOTAL_PACKAGES="${#ALL_SLUGS[@]}"
echo "Found ${TOTAL_PACKAGES} tracked npm package(s)"

if [ "${TOTAL_PACKAGES}" -eq 0 ]; then
  echo "No npm packages tracked in VULNZ. Nothing to do."
  exit 0
fi

if [ "${ENABLE_DIAGNOSTICS}" == 'true' ]; then
  echo "INFO: packages=$(printf '%s ' "${ALL_SLUGS[@]}")"
fi

# ============================================================
# Step 2: Batch query OSV.dev and process results
# ============================================================
ADDED_VULN_COUNT=0
PACKAGE_INDEX=0

while [ "${PACKAGE_INDEX}" -lt "${TOTAL_PACKAGES}" ]; do
  BATCH=("${ALL_SLUGS[@]:${PACKAGE_INDEX}:${BATCH_SIZE}}")
  BATCH_COUNT="${#BATCH[@]}"
  BATCH_END=$((PACKAGE_INDEX + BATCH_COUNT))

  echo "Querying OSV.dev: ${BATCH_COUNT} package(s) [${PACKAGE_INDEX}–$((BATCH_END - 1)) of $((TOTAL_PACKAGES - 1))]"

  # Build OSV.dev batch query JSON
  QUERIES_JSON=$(printf '%s\n' "${BATCH[@]}" | \
    jq -R '{"package": {"name": ., "ecosystem": "npm"}}' | \
    jq -s '{"queries": .}')

  # POST to OSV.dev batch endpoint
  OSV_RESPONSE=$(echo "${QUERIES_JSON}" | curl -sf -X POST \
    -H "Content-Type: application/json" \
    -d @- \
    "${OSV_API_URL}")

  if [ $? -ne 0 ] || [ -z "${OSV_RESPONSE}" ]; then
    echo "ERROR: OSV.dev batch query failed at package index ${PACKAGE_INDEX}" >&2
    PACKAGE_INDEX="${BATCH_END}"
    continue
  fi

  # ============================================================
  # Step 3: Match OSV results to tracked releases and add vulns
  # ============================================================
  RESULT_INDEX=0
  while [ "${RESULT_INDEX}" -lt "${BATCH_COUNT}" ]; do
    PACKAGE_SLUG="${BATCH[${RESULT_INDEX}]}"

    VULN_COUNT=$(echo "${OSV_RESPONSE}" | jq ".results[${RESULT_INDEX}].vulns | length // 0" 2>/dev/null)
    VULN_COUNT="${VULN_COUNT:-0}"

    if [ "${VULN_COUNT}" -eq 0 ]; then
      if [ "${ENABLE_DIAGNOSTICS}" == 'true' ]; then
        echo "  ${PACKAGE_SLUG}: no vulnerabilities"
      fi
      RESULT_INDEX=$((RESULT_INDEX + 1))
      continue
    fi

    echo "  ${PACKAGE_SLUG}: ${VULN_COUNT} OSV vulnerability record(s) found"

    # Fetch tracked releases for this package from VULNZ
    PACKAGE_DATA=$(http --ignore-stdin GET \
      "${VULNZ_API_URL}/components/npm-package/${PACKAGE_SLUG}" \
      "X-API-Key: ${VULNZ_API_KEY}" 2>/dev/null)

    mapfile -t TRACKED_VERSIONS < <(echo "${PACKAGE_DATA}" | jq -r '.releases[].version' 2>/dev/null)

    if [ "${#TRACKED_VERSIONS[@]}" -eq 0 ]; then
      if [ "${ENABLE_DIAGNOSTICS}" == 'true' ]; then
        echo "    no tracked releases for ${PACKAGE_SLUG} — skipping"
      fi
      RESULT_INDEX=$((RESULT_INDEX + 1))
      continue
    fi

    # Process each vulnerability for this package
    VULN_INDEX=0
    while [ "${VULN_INDEX}" -lt "${VULN_COUNT}" ]; do
      VULN_JSON=$(echo "${OSV_RESPONSE}" | jq ".results[${RESULT_INDEX}].vulns[${VULN_INDEX}]")
      VULN_ID=$(echo "${VULN_JSON}" | jq -r '.id')

      # Build reference URL list; fall back to OSV permalink if none provided
      REFERENCE_URLS=$(echo "${VULN_JSON}" | jq '[.references[].url] | unique')
      if [ -z "${REFERENCE_URLS}" ] || [ "${REFERENCE_URLS}" == 'null' ] || [ "${REFERENCE_URLS}" == '[]' ]; then
        REFERENCE_URLS="[\"https://osv.dev/vulnerability/${VULN_ID}\"]"
      fi

      # Check each tracked release against this vulnerability
      for TRACKED_VERSION in "${TRACKED_VERSIONS[@]}"; do
        if is_version_affected "${VULN_JSON}" "${PACKAGE_SLUG}" "${TRACKED_VERSION}"; then
          echo "    + ${VULN_ID}: ${PACKAGE_SLUG}@${TRACKED_VERSION}"

          BODY="{\"urls\": ${REFERENCE_URLS}}"
          echo "${BODY}" | http --ignore-stdin POST \
            "${VULNZ_API_URL}/components/npm-package/${PACKAGE_SLUG}/${TRACKED_VERSION}" \
            "X-API-Key: ${VULNZ_API_KEY}" > /dev/null 2>&1

          if [ $? -eq 0 ]; then
            ADDED_VULN_COUNT=$((ADDED_VULN_COUNT + 1))
          else
            echo "    ERROR: failed to record ${VULN_ID} for ${PACKAGE_SLUG}@${TRACKED_VERSION}" >&2
          fi
        fi
      done

      VULN_INDEX=$((VULN_INDEX + 1))
    done

    RESULT_INDEX=$((RESULT_INDEX + 1))
  done

  PACKAGE_INDEX="${BATCH_END}"

  # Polite delay between OSV.dev batch requests
  if [ "${PACKAGE_INDEX}" -lt "${TOTAL_PACKAGES}" ]; then
    sleep 2
  fi
done

echo "Done. Vulnerability entries added/updated: ${ADDED_VULN_COUNT}"
