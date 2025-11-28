#!/usr/bin/env bash
#
# Generate a random SESSION_SECRET for VULNZ
#
# This script will check if SESSION_SECRET is missing, empty, or set to the
# default placeholder value in .env. If so, it generates a cryptographically
# secure random 48-character string and updates .env automatically.
#

set -e

SECRET_LENGTH=48

THIS_SCRIPT=$(basename "${BASH_SOURCE[0]}")
THIS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_ROOT_DIR=$(realpath "${THIS_DIR}/..")
ENV_FILE="$(realpath "${PROJECT_ROOT_DIR}/.env")"

# Check if .env exists
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Error: ${ENV_FILE} not found."
  echo "Please copy env.sample to .env and configure database settings first."
  exit 1
fi

# Get current SESSION_SECRET value (if any)
CURRENT_SECRET=""
if grep -q "^SESSION_SECRET=" "${ENV_FILE}"; then
  CURRENT_SECRET=$(grep "^SESSION_SECRET=" "${ENV_FILE}" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
fi

# Check if we need to generate a new secret
NEEDS_NEW_SECRET=false

if [[ -z "${CURRENT_SECRET}" ]]; then
  echo "SESSION_SECRET is missing or empty in ${ENV_FILE}"
  NEEDS_NEW_SECRET=true
elif [[ "$CURRENT_SECRET" == "CREATE_A_RANDOM_STRING_HERE" ]]; then
  echo "SESSION_SECRET is set to default placeholder value"
  NEEDS_NEW_SECRET=true
else
  # OK
  :
fi

if [[ "${NEEDS_NEW_SECRET}" == "false" ]]; then
  echo "SESSION_SECRET already configured in ${ENV_FILE}"
  echo "Current value: ${CURRENT_SECRET:0:10}... (${#CURRENT_SECRET} characters)"
  echo ""
  echo "To generate a new secret, either:"
  echo "  1. Remove the SESSION_SECRET line from ${ENV_FILE}"
  echo "  2. Set it to an empty value: SESSION_SECRET="
  echo "  3. Set it to: SESSION_SECRET=CREATE_A_RANDOM_STRING_HERE"
  echo ""
  echo "Then run this script again."
  exit 0
fi

echo "Generating a new ${SECRET_LENGTH}-character random SESSION_SECRET..."

# Generate a cryptographically secure random string
# Using /dev/urandom with base64 encoding, then removing non-alphanumeric chars
NEW_SECRET=$(LC_ALL=C cat < /dev/urandom | tr -dc 'A-Za-z0-9' | head -c "${SECRET_LENGTH}")

# Update or add SESSION_SECRET in .env
if [ -z "${NEW_SECRET}" ]; then
  echo "Error: Failed to generate a new SESSION_SECRET"
  exit 1
elif ! grep -q "^SESSION_SECRET=" "${ENV_FILE}"; then
  # append new line
  echo "SESSION_SECRET=$NEW_SECRET" >> "${ENV_FILE}"
  echo "✓ Added SESSION_SECRET to ${ENV_FILE}"
elif [[ "${OSTYPE}" == "darwin"* ]]; then
  # Replace existing line (macOS)
  sed -i '' "s|^SESSION_SECRET=.*|SESSION_SECRET=$NEW_SECRET|" "${ENV_FILE}"
  echo "✓ Updated SESSION_SECRET in ${ENV_FILE}"
else
  # Replace existing line (Linux/BSD)
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$NEW_SECRET|" "${ENV_FILE}"
  echo "✓ Updated SESSION_SECRET in ${ENV_FILE}"
fi

echo "✓ Generated secure ${SECRET_LENGTH}-character random string"
echo ""
echo "Your new SESSION_SECRET has been saved to ${ENV_FILE}"
echo ""
echo "IMPORTANT: Keep this secret secure and never commit it to version control!"
echo ""

exit 0
