#!/bin/bash

ENV_FILE=".env"

# Default values
BACKUP_DIR="backups"
DB_USER=""
DB_PASS=""
DB_NAME=""
DB_HOST="localhost"
DB_PORT="3306" # Default MariaDB/MySQL port

# Function to show usage
usage() {
  echo "Usage: $0 [ --users | --components | --all ]"
  echo ""
  echo "Options:"
  echo "  --users       Backup user, userRole, Role, and apiKey tables."
  echo "  --components  Backup component, componentType, release, and vulnerability tables."
  echo "  --all         Backup all specified tables."
  echo "  --help        Show this help message."
  exit 1
}

# Function to backup tables
backup_tables() {
  local tables=$1
  local filename=$2
  local metadata=$3
  
  echo "Backing up tables: $metadata to $filename"
  
  # Create backup directory if it doesn't exist
  mkdir -p "$BACKUP_DIR"

  # Write metadata to file
  echo "-- Backup of: $metadata" > "$BACKUP_DIR/$filename"
  echo "-- Date: $(date)" >> "$BACKUP_DIR/$filename"
  echo "" >> "$BACKUP_DIR/$filename"
  
  # mysqldump command
  mysqldump --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" --password="$DB_PASS" "$DB_NAME" $tables >> "$BACKUP_DIR/$filename"
  
  if [ $? -eq 0 ]; then
    echo "Backup complete: $BACKUP_DIR/$filename"
  else
    echo "Error: mysqldump failed. Please check credentials and database status."
    # Clean up empty file on failure
    if [ ! -s "$BACKUP_DIR/$filename" ]; then
        rm "$BACKUP_DIR/$filename"
    fi
    exit 1
  fi
}

# Main script logic
# Handle help and no-arg case first
if [ "$#" -eq 0 ] || [ "$1" == "--help" ]; then
  usage
fi

# Parse .env file
if [ ! -f "${ENV_FILE}" ]; then
  echo "Error: .env file not found!" >&2
  exit 1
else
  # Read .env file line by line
  while IFS='=' read -r key value; do
    # Remove single quotes from value, if present
    value="${value%\'}"
    value="${value#\'}"
    
    # Assign values to script variables
    case "$key" in
      "DB_USER") DB_USER="$value" ;;
      "DB_PASSWORD") DB_PASS="$value" ;;
      "DB_NAME") DB_NAME="$value" ;;
      "DB_HOST") DB_HOST="$value" ;;
      "DB_PORT") DB_PORT="$value" ;;
    esac
  done < <(grep "^DB_" "${ENV_FILE}")

  # Set default values if not defined in .env
  DB_HOST=${DB_HOST:-localhost}
  DB_PORT=${DB_PORT:-3306}
fi

# Check for required credentials
if [ -z "$DB_USER" ] || [ -z "$DB_PASS" ] || [ -z "$DB_NAME" ]; then
  echo "Error: Database credentials not found or incomplete in .env file."
  exit 1
fi

# Handle backup commands
case "$1" in
  --users)
    backup_tables "users user_roles roles api_keys" "users_backup_$(date +%F).sql" "user, userRole, Role, apiKey"
    ;;
  --components)
    backup_tables "components component_types releases vulnerabilities" "components_backup_$(date +%F).sql" "component, componentType, release, vulnerability"
    ;;
  --all)
    backup_tables "users user_roles roles api_keys" "users_backup_$(date +%F).sql" "user, userRole, Role, apiKey"
    backup_tables "components component_types releases vulnerabilities" "components_backup_$(date +%F).sql" "component, componentType, release, vulnerability"
    ;;
  *) # Default case for invalid options
    usage
    ;;
esac

exit 0
