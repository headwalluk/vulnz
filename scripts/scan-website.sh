#!/bin/bash
#
# Sample static analysis scanner for WordPress websites
# Requires: PHP_CodeSniffer, WordPress Coding Standards, WordPress Security Coding Standards
#
# Usage: ./scan-website.sh <website_path> <vulnz_api_url> <vulnz_api_key> <website_domain>
#
# Example:
#   ./scan-website.sh /var/www/example.com https://vulnz.example.com your-api-key example.com
#

set -e

WEBSITE_PATH=$1
VULNZ_API_URL=$2
VULNZ_API_KEY=$3
WEBSITE_DOMAIN=$4

if [ -z "$WEBSITE_PATH" ] || [ -z "$VULNZ_API_URL" ] || [ -z "$VULNZ_API_KEY" ] || [ -z "$WEBSITE_DOMAIN" ]; then
    echo "Usage: $0 <website_path> <vulnz_api_url> <vulnz_api_key> <website_domain>"
    echo ""
    echo "Example:"
    echo "  $0 /var/www/example.com https://vulnz.example.com your-api-key example.com"
    exit 1
fi

if [ ! -d "$WEBSITE_PATH" ]; then
    echo "Error: Website path does not exist: $WEBSITE_PATH"
    exit 1
fi

# Check if phpcs is installed
if ! command -v phpcs &> /dev/null; then
    echo "Error: phpcs (PHP_CodeSniffer) is not installed"
    echo "Install with: composer global require squizlabs/php_codesniffer"
    exit 1
fi

echo "Scanning WordPress site: $WEBSITE_PATH"
echo "API URL: $VULNZ_API_URL"
echo "Website: $WEBSITE_DOMAIN"
echo ""

# Create temp file for scan results
SCAN_RESULTS=$(mktemp)
trap "rm -f $SCAN_RESULTS" EXIT

# Run phpcs with WordPress Security standards
echo "Running PHP_CodeSniffer with WordPress Security standards..."
phpcs --standard=WordPress-Security \
     --report=json \
     --extensions=php \
     --ignore=*/vendor/*,*/node_modules/* \
     "$WEBSITE_PATH" > "$SCAN_RESULTS" 2>/dev/null || true

# Check if scan produced output
if [ ! -s "$SCAN_RESULTS" ]; then
    echo "Warning: No scan results generated. Creating empty results."
    echo '{"totals":{"errors":0,"warnings":0,"fixable":0},"files":{}}' > "$SCAN_RESULTS"
fi

echo "Scan complete. Processing results..."

# Parse JSON and POST to VULNZ API using Node.js
node -e "
const fs = require('fs');
const https = require('https');
const http = require('http');

const scanResults = JSON.parse(fs.readFileSync('$SCAN_RESULTS', 'utf8'));
const websitePath = '$WEBSITE_PATH';
const apiUrl = '$VULNZ_API_URL';
const apiKey = '$VULNZ_API_KEY';
const websiteDomain = '$WEBSITE_DOMAIN';

// Convert phpcs format to VULNZ format
const files = [];
for (const [filePath, fileData] of Object.entries(scanResults.files || {})) {
    const relativePath = filePath.replace(websitePath, '').replace(/^\//, '');
    const issues = [];
    
    for (const message of fileData.messages || []) {
        issues.push({
            line: message.line,
            type: message.source,
            severity: message.type === 'ERROR' ? 'error' : 'warning',
            message: message.message
        });
    }
    
    files.push({
        path: relativePath,
        issues: issues
    });
}

const payload = {
    scan_datetime: new Date().toISOString(),
    scanner: 'phpcs-wordpress-security',
    scanner_version: '3.7.2',
    files: files
};

// Parse API URL
const url = new URL(\`\${apiUrl}/api/websites/\${websiteDomain}/security-scan\`);
const client = url.protocol === 'https:' ? https : http;

const postData = JSON.stringify(payload);

const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname,
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'X-API-Key': apiKey
    }
};

const req = client.request(options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
        data += chunk;
    });
    
    res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log('✓ Scan results uploaded successfully');
            try {
                const response = JSON.parse(data);
                console.log(\`  Files processed: \${response.processed}\`);
                console.log(\`  Issues found: \${response.summary.error} errors, \${response.summary.warning} warnings, \${response.summary.info} info\`);
                if (response.issues_deleted > 0) {
                    console.log(\`  Issues resolved: \${response.issues_deleted}\`);
                }
            } catch (e) {
                console.log('  Response:', data);
            }
        } else {
            console.error('✗ Failed to upload scan results');
            console.error(\`  Status: \${res.statusCode}\`);
            console.error(\`  Response: \${data}\`);
            process.exit(1);
        }
    });
});

req.on('error', (error) => {
    console.error('✗ Error uploading scan results:', error.message);
    process.exit(1);
});

req.write(postData);
req.end();
"

echo ""
echo "Done!"
