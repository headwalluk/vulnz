# Reverse Proxy Setup

This guide covers setting up VULNZ behind a reverse proxy (Apache or Nginx) for production deployments with SSL/TLS.

## Prerequisites

- VULNZ installed and running (see [Production Deployment](deployment.md))
- Apache or Nginx installed
- SSL certificate (Let's Encrypt recommended)
- Domain name pointing to your server

## Why Use a Reverse Proxy?

- **SSL/TLS termination**: Handle HTTPS at the proxy level
- **Security**: Hide internal application details
- **Performance**: Serve static assets directly, enable compression
- **Multiple applications**: Host multiple services on one server

## Apache Configuration

### Install Required Modules

```bash
# Enable proxy modules
sudo a2enmod proxy
sudo a2enmod proxy_http
sudo a2enmod ssl
sudo a2enmod headers
sudo a2enmod rewrite
```

### Virtual Host Configuration

Create `/etc/apache2/sites-available/vulnz.conf`:

```apache
<VirtualHost *:80>
    ServerName vulnz.example.com

    # Redirect all HTTP to HTTPS
    RewriteEngine On
    RewriteRule ^(.*)$ https://%{HTTP_HOST}$1 [R=301,L]
</VirtualHost>

<VirtualHost *:443>
    ServerName vulnz.example.com

    # SSL Configuration
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/vulnz.example.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/vulnz.example.com/privkey.pem

    # Modern SSL configuration
    SSLProtocol all -SSLv3 -TLSv1 -TLSv1.1
    SSLCipherSuite HIGH:!aNULL:!MD5
    SSLHonorCipherOrder on

    # Security Headers
    Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
    Header always set X-Frame-Options "SAMEORIGIN"
    Header always set X-Content-Type-Options "nosniff"
    Header always set Referrer-Policy "strict-origin-when-cross-origin"

    # Compression
    SetOutputFilter DEFLATE
    AddOutputFilterByType DEFLATE text/html text/plain text/xml text/css text/javascript application/javascript application/json

    # Proxy Configuration
    ProxyPreserveHost On
    ProxyPass / http://localhost:3000/
    ProxyPassReverse / http://localhost:3000/

    # Forward client IP address (critical for rate limiting)
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-For "%{REMOTE_ADDR}s"
    RequestHeader set X-Real-IP "%{REMOTE_ADDR}s"

    # Cache static assets aggressively
    <LocationMatch "^/build/.*\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$">
        Header set Cache-Control "public, max-age=31536000, immutable"
    </LocationMatch>

    # Error and Access Logs
    ErrorLog ${APACHE_LOG_DIR}/vulnz-error.log
    CustomLog ${APACHE_LOG_DIR}/vulnz-access.log combined
</VirtualHost>
```

### Enable and Restart

```bash
# Enable the site
sudo a2ensite vulnz

# Test configuration
sudo apache2ctl configtest

# Restart Apache
sudo systemctl restart apache2
```

## Nginx Configuration

### Virtual Host Configuration

Create `/etc/nginx/sites-available/vulnz`:

```nginx
# Redirect HTTP to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name vulnz.example.com;

    return 301 https://$server_name$request_uri;
}

# HTTPS Server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name vulnz.example.com;

    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/vulnz.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vulnz.example.com/privkey.pem;

    # Modern SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1000;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json application/xml+rss;

    # Cache static assets aggressively
    location ~* ^/build/.*\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        proxy_pass http://localhost:3000;
        proxy_cache_valid 200 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
        access_log off;
    }

    # Proxy all other requests to Node.js
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;

        # Forward client IP address (critical for rate limiting)
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Logging
    access_log /var/log/nginx/vulnz-access.log;
    error_log /var/log/nginx/vulnz-error.log;
}
```

### Enable and Restart

```bash
# Create symbolic link to enable site
sudo ln -s /etc/nginx/sites-available/vulnz /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

## Express Trust Proxy Configuration

For VULNZ to correctly identify client IP addresses behind a reverse proxy, you need to configure Express to trust the proxy.

In your `.env` file, ensure you have:

```bash
# Trust proxy - required when running behind Apache/Nginx
TRUST_PROXY=true
```

This ensures:

- Rate limiting works correctly per client IP
- Logs show actual client IPs instead of proxy IP
- Security features can identify real client addresses

## SSL Certificate Setup (Let's Encrypt)

### Install Certbot

```bash
# Ubuntu/Debian
sudo apt install certbot

# For Apache
sudo apt install python3-certbot-apache

# For Nginx
sudo apt install python3-certbot-nginx
```

### Obtain Certificate

```bash
# Apache
sudo certbot --apache -d vulnz.example.com

# Nginx
sudo certbot --nginx -d vulnz.example.com
```

### Auto-Renewal

Certbot automatically sets up a systemd timer for renewal. Verify it's active:

```bash
sudo systemctl status certbot.timer
```

Test renewal process:

```bash
sudo certbot renew --dry-run
```

## Additional Security Considerations

### Rate Limiting at Proxy Level

Consider adding rate limiting at the proxy level as an additional layer:

**Nginx example:**

```nginx
# In http block
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

# In location block
location /api/ {
    limit_req zone=api burst=20 nodelay;
    proxy_pass http://localhost:3000;
    # ... other proxy settings
}
```

**Apache example:**

```apache
# Load module
LoadModule ratelimit_module modules/mod_ratelimit.so

# In VirtualHost
<Location /api/>
    SetOutputFilter RATE_LIMIT
    SetEnv rate-limit 400
</Location>
```

### Firewall Configuration

Ensure your firewall only allows connections to ports 80 and 443:

```bash
# UFW example
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Block direct access to the Node.js port (3000) from external sources - it should only accept connections from localhost.

## Troubleshooting

### Rate Limiting Not Working

If rate limiting isn't working correctly:

1. Verify `TRUST_PROXY=true` in your `.env`
2. Check proxy is forwarding client IP headers correctly
3. Review application logs to see what IP addresses are being logged

### SSL Certificate Issues

If SSL certificate renewal fails:

1. Check DNS is correctly pointing to your server
2. Ensure ports 80 and 443 are accessible
3. Review Certbot logs: `sudo journalctl -u certbot`

### Performance Issues

If experiencing slow response times:

1. Verify compression is enabled in your proxy
2. Check static asset caching is working
3. Consider increasing PM2 worker instances
4. Monitor server resources (CPU, memory, disk I/O)
