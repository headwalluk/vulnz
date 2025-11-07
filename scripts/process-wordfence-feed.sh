#!/bin/bash

##
# process-wordfence-feed.sh
#
# Add your settings to a .env.wordfence file in the project root.
#
# Consider setting WORK_DIR in .env.wordfence to a persistent location,
# such as /var/local/vulnz or ${HOME}/.cache/vulnz
#

# You can add it to your crontab to run periodically:
# */5    *     *   *   *   ${HOME}/src/vulnz/scripts/update-vulnz.sh >/dev/null

THIS_SCRIPT="$(realpath "${BASH_SOURCE[0]}")"
THIS_DIR="$(dirname "${THIS_SCRIPT}")"
PROJECT_ROOT_DIR="$(realpath "${THIS_DIR}/..")"
# Allow override via environment (defaults to 20 if not provided)
BATCH_SIZE="${BATCH_SIZE:-20}"

REQUIRED_BINS=(jq wget http)
for REQUIRED_BIN in "${REQUIRED_BINS[@]}"; do
  if ! command -v "${REQUIRED_BIN}" > /dev/null 2>&1; then
    echo "ERROR: required binary not found in PATH: ${REQUIRED_BIN}"
    exit 1
  fi
done

##
# Load environment variables
#
source "${PROJECT_ROOT_DIR}/.env.wordfence"

if [ -z "${WORK_DIR}" ]; then
  echo "WORK_DIR not set, using default. This will get zapped if you run a clean up."
  echo "Consider setting WORK_DIR in .env.wordfence to a persistent location."

  WORK_DIR="${PROJECT_ROOT_DIR}/var"
fi

if [ -z "${VULNZ_API_KEY}" ] || [ -z "${VULNZ_API_URL}" ]; then
  echo "ERROR: VULNZ_API_KEY or VULNZ_API_URL not set in .env.wordfence"
  exit 1
fi

WORDFENCE_PRODUCTION_URL=https://www.wordfence.com/api/intelligence/v2/vulnerabilities/production
WORDFENCE_PRODUCTION_FILE="${WORK_DIR}/wf-production.json"
WORDFENCE_PROCESSED_IDS="${WORK_DIR}/wf-processed-ids.txt"

# Output some useful diagnostics.
if [ "${ENABLE_DIAGNOSTICS}" == 'true' ]; then
  echo "INFO: script=${THIS_SCRIPT}"
  echo "INFO: dir=${THIS_DIR}"
  echo "INFO: project_root=${PROJECT_ROOT_DIR}"
  echo "INFO: work_dir=${WORK_DIR}"
fi

if [ ! -d "${WORK_DIR}" ]; then
  echo "Creating work directory: ${WORK_DIR}"
  mkdir -p "${WORK_DIR}"
fi

if [ ! -d "${WORK_DIR}" ]; then
  echo "ERROR: work directory does not exist and could not be created: ${WORK_DIR}"
  exit 1
fi

pushd "${WORK_DIR}" > /dev/null

# Utility function that works the same way as the PHP function
# version_compare(string , string , ?string ), returning -1, 0 or 1
#
# @param string $1 Version 1
# @param string $2 Version 2
#
# @return void
#
function version_compare() {
  if [[ "$1" == "$2" ]]; then
    __=0
  else
    local IFS=.
    local i ver1=($1) ver2=($2)
    # fill empty fields in ver1 with zeros
    for ((i = ${#ver1[@]}; i < ${#ver2[@]}; i++)); do
      ver1[i]=0
    done

    for ((i = 0; i < ${#ver1[@]}; i++)); do
      if [[ -z ${ver2[i]} ]]; then
        # fill empty fields in ver2 with zeros
        ver2[i]=0
      fi
      if ((10#${ver1[i]} > 10#${ver2[i]})); then
        __=1
        break
      fi
      if ((10#${ver1[i]} < 10#${ver2[i]})); then
        __=-1
        break
      fi
    done
  fi
}

echo "** Updating from Wordfence **"

# Re-import the Wordfence each day
find . -maxdepth 1 -mmin +1440 -name "$(basename "${WORDFENCE_PRODUCTION_FILE}")" -print -delete

# Reset the processed IDs each week
find . -maxdepth 1 -mmin +10080 -name "$(basename "${WORDFENCE_PROCESSED_IDS}")" -print -delete

# Download the Wordfence production feed if not present
if [ ! -f "${WORDFENCE_PRODUCTION_FILE}" ]; then
  echo "Downloading wordfence production feed"
  wget -qO "${WORDFENCE_PRODUCTION_FILE}" "${WORDFENCE_PRODUCTION_URL}"
fi

if [ ! -f "${WORDFENCE_PRODUCTION_FILE}" ]; then
  echo "ERROR: could not download wordfence production feed"
  exit 1
fi

if [ ! -f "${WORDFENCE_PROCESSED_IDS}" ]; then
  touch "${WORDFENCE_PROCESSED_IDS}"
fi

WF_IDS=($(jq keys_unsorted[] -r "${WORDFENCE_PRODUCTION_FILE}" | grep -vxf "${WORDFENCE_PROCESSED_IDS}" | head -n ${BATCH_SIZE}))
ADDED_RELEASE_COUNT=0
for WF_ID in "${WF_IDS[@]}"; do
  # echo "Wordfence ID: ${WF_ID}"

  WF_META="$(jq ".\"${WF_ID}\"" "${WORDFENCE_PRODUCTION_FILE}")"

  if [ $? -ne 0 ] || [ -z "${WF_META}" ]; then
    echo "Failed to parse WF ID ${WF_ID}" >&2
  else
    # echo "Processing ${WF_ID}"

    COMPONENT_COUNT=$(echo "${WF_META}" | jq '.software | length')
    COMPONENT_INDEX=0
    while [ ${COMPONENT_INDEX} -lt ${COMPONENT_COUNT} ]; do
      if [ ${COMPONENT_INDEX} -gt 0 ]; then
        sleep 1s
      fi

      COMPONENT_META="$(echo "${WF_META}" | jq ".software[${COMPONENT_INDEX}]")"
      COMPONENT_TYPE="$(echo "${COMPONENT_META}" | jq -r .type)"
      COMPONENT_NAME="$(echo "${COMPONENT_META}" | jq -r .name)"
      COMPONENT_SLUG="$(echo "${COMPONENT_META}" | jq -r .slug)"

      URL="${VULNZ_API_URL}/components/wordpress-plugin/${COMPONENT_SLUG}/${VERSION}"
      VULNZ_COMPONENT_META="$(http GET "${URL}" "X-API-Key: ${VULNZ_API_KEY}" | jq . 2> /dev/null)"
      VULNZ_COMPONENT_TITLE="$(echo "${VULNZ_COMPONENT_META}" | jq -r .title | sed 's/"//g' | tr -d '\n' | tr -d '\r')"
      VULNZ_COMPONENT_URL="$(echo "${VULNZ_COMPONENT_META}" | jq -r .url | sed 's/"//g' | tr -d '\n' | tr -d '\r')"
      VULNZ_COMPONENT_ID="$(echo "${VULNZ_COMPONENT_META}" | jq -r .id)"

      if [ "${VULNZ_COMPONENT_TITLE}" == 'null' ] || [ "${VULNZ_COMPONENT_TITLE}" == "${COMPONENT_SLUG}" ]; then
        echo "Fixing the plugin meta: ${COMPONENT_SLUG}"

        URL="${VULNZ_API_URL}/components/${VULNZ_COMPONENT_ID}"
        BODY="{\"title\": \"${COMPONENT_NAME}\" }"
        # echo "${BODY}"
        # exit 1

        # TODO: Handle errors properly.
        echo "${BODY}" | https PUT "${URL}" "X-API-Key: ${VULNZ_API_KEY}" > /dev/null
        if [ $? -ne 0 ]; then
          echo "Failed to update plugin title for ${SLUG}" >&2
          echo "${BODY}"
          exit 1
        fi
      fi

      if [ "${COMPONENT_TYPE}" != 'plugin' ]; then
        echo "Skipping non-plugin component type: ${COMPONENT_TYPE}"
      else
        echo "Processing plugin component: ${COMPONENT_SLUG}"

        VERSION_KEYS=("$(echo "${COMPONENT_META}" | jq .affected_versions | jq -r keys_unsorted[])")
        for VERSION_KEY in "${VERSION_KEYS}"; do
          MIN_VER_INC="$(echo "${COMPONENT_META}" | jq -r ".affected_versions[\"${VERSION_KEY}\"].from_inclusive")"
          MIN_VER="$(echo "${COMPONENT_META}" | jq -r ".affected_versions[\"${VERSION_KEY}\"].from_version" | grep -oE '[0-9\*\.]+' | head -n 1)"
          if [ -z "${MIN_VER}" ]; then
            MIN_VER=0
          fi

          MAX_VER_INC="$(echo "${COMPONENT_META}" | jq -r ".affected_versions[\"${VERSION_KEY}\"].to_inclusive")"
          MAX_VER="$(echo "${COMPONENT_META}" | jq -r ".affected_versions[\"${VERSION_KEY}\"].to_version" | grep -oE '[0-9\*\.]+' | head -n 1)"
          if [ -z "${MAX_VER}" ]; then
            MAX_VER=0
          fi

          # Create the component & releases in VULNZ if they do not already exist.
          if [ -n "${MIN_VER}" ] && [ "${MIN_VER}" != '*' ]; then
            http GET "${VULNZ_API_URL}/components/wordpress-plugin/${COMPONENT_SLUG}/${MIN_VER}" "X-API-Key: ${VULNZ_API_KEY}" > /dev/null
          fi

          if [ -n "${MAX_VER}" ] && [ "${MAX_VER}" != '*' ]; then
            http GET "${VULNZ_API_URL}/components/wordpress-plugin/${COMPONENT_SLUG}/${MAX_VER}" "X-API-Key: ${VULNZ_API_KEY}" > /dev/null
          fi

          VULNZ_META="$(http GET "${VULNZ_API_URL}/components/wordpress-plugin/${COMPONENT_SLUG}" "X-API-Key: ${VULNZ_API_KEY}" | jq .)"
          VULNZ_RELEASE_COUNT=$(echo "${VULNZ_META}" | jq '.releases | length')
          VULNZ_RELEASE_COUNT=$((VULNZ_RELEASE_COUNT + 0))

          VULNZ_RELEASE_INDEX=0
          while [ ${VULNZ_RELEASE_INDEX} -lt ${VULNZ_RELEASE_COUNT} ]; do
            # echo "VULNZ Release ${VULNZ_RELEASE_INDEX}"

            VULNZ_VER="$(echo "${VULNZ_META}" | jq -r ".releases[${VULNZ_RELEASE_INDEX}].version" | grep -oE '[0-9\*\.]+')"
            if [ -z "${VULNZ_VER}" ]; then
              VULNZ_VER=0
            fi
            IS_VULNERABLE=0

            # echo "Local Version = ${VULNZ_VER}"
            # echo "Max Version = ${MAX_VER} (inclusive=${MAX_VER_INC})"

            # DIAGNOSTICS
            # echo "${COMPONENT_SLUG} ${VULNZ_VER}" >&2
            # echo "MIN: ${MIN_VER}"
            # echo "MAX: ${MAX_VER}"
            CMP_MAX=
            if [ "${MAX_VER}" == '*' ]; then
              CMP_MAX=-1
            else
              version_compare "${VULNZ_VER}" "${MAX_VER}"
              CMP_MAX=${__}
            fi

            CMP_MIN=
            if [ "${MIN_VER}" == '*' ]; then
              CMP_MIN=1
            else
              version_compare "${VULNZ_VER}" "${MIN_VER}"
              CMP_MIN=${__}
            fi

            if [ ${CMP_MAX} -eq 1 ]; then
              # Our version is higher than the max.
              :
            elif [ ${CMP_MAX} -eq 0 ] && [ "${MAX_VER_INC}" != 'true' ]; then
              # Our version is the same as the max version, but the max version is not inclusive.
              :
            elif [ ${CMP_MIN} -lt 0 ]; then
              # Our version is lower than the min version.
              :
            elif [ ${CMP_MIN} -eq 0 ] && [ "${MIN_VER_INC}" != 'true' ]; then
              # Our version is the same as the min version, but the min version is not inclusive.
              :
            else
              # We are vulnerable
              # echo "Vulnerable! ver=${VULNZ_VER}"

              echo "Adding vulnerability ${COMPONENT_SLUG} ver=${VULNZ_VER}"

              BODY="{\"urls\": $(echo "${WF_META}" | jq .references)}"
              echo "${BODY}" | jq . | http POST "${VULNZ_API_URL}/components/wordpress-plugin/${COMPONENT_SLUG}/${VULNZ_VER}" "X-API-Key: ${VULNZ_API_KEY}" > /dev/null
              ADDED_RELEASE_COUNT=$((ADDED_RELEASE_COUNT + 1))
            fi

            VULNZ_RELEASE_INDEX=$((VULNZ_RELEASE_INDEX + 1))
          done

        done

      fi

      COMPONENT_INDEX=$((COMPONENT_INDEX + 1))
    done

  fi

  echo "${WF_ID}" >> "${WORDFENCE_PROCESSED_IDS}"

done

echo "Added releases from Wordfence feed: ${ADDED_RELEASE_COUNT}"

popd > /dev/null
