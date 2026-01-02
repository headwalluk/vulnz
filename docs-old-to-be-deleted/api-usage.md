# API Usage

VULNZ provides a REST API for managing components, vulnerabilities, websites, and user accounts.

## API Documentation

If you're running VULNZ on localhost on port 3000 (the defaults), all the API documentation is available via Swagger:

`http://localhost:3000/doc`

## Authentication

Most API endpoints require authentication via an API key. Include your API key in the request header:

```
X-API-Key: YOUR_API_KEY_HERE
```

You can generate API keys from the Dashboard after logging in.

## Examples

The following examples use [HTTPie](https://httpie.io/) but will work just as well with cURL.

### Adding a Vulnerability Report to a Plugin

```bash
# The vulnerability information we want to add.
BODY='{"urls": [ "https://a-security-website/news/security-hole-found-in-woo-1-2-3/" ] }'

# POST to our locally hosted VULNZ API. The plugin & release will be added to
# the database automatically if they're not already in there.
echo "${BODY}" | http POST http://localhost:3000/api/components/wordpress-plugin/woocommerce/1.2.3 \
  "X-API-Key: YOUR_API_KEY"
```

### Adding a New Website

```bash
# Our website's metadata.
BODY='{"domain": "my-clients-website.com"}'

# POST to our locally hosted VULNZ API.
echo "${BODY}" | http POST http://localhost:3000/api/websites \
  "X-API-Key: YOUR_API_KEY"
```

### Searching for Components

```bash
# Search for components by slug or name
http GET "http://localhost:3000/api/components/search?query=woocommerce&page=1&limit=10" \
  "X-API-Key: YOUR_API_KEY"
```

### Getting Component Details

```bash
# Get details for a specific component
http GET http://localhost:3000/api/components/wordpress-plugin/woocommerce \
  "X-API-Key: YOUR_API_KEY"
```

## Rate Limiting

Unauthenticated API requests are subject to rate limiting (configurable via `UNAUTH_SEARCH_LIMIT_PER_SECOND`). Authenticated requests using a valid API key have separate, more generous limits.

## More Examples

For complete API endpoint documentation, including all parameters and response formats, visit the Swagger documentation at `/doc` on your running instance.
