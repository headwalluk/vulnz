const db = require('../db');

const up = async () => {
  const query = `
    CREATE TABLE security_event_types (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(100) NOT NULL UNIQUE,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      severity ENUM('info', 'warning', 'critical') DEFAULT 'warning',
      enabled TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_enabled (enabled),
      INDEX idx_severity (severity)
    )
  `;
  await db.query(query);

  // Insert initial event types
  const eventTypes = [
    {
      slug: 'failed-login',
      title: 'Failed Login Attempt',
      description: 'Authentication attempt with incorrect credentials',
      severity: 'warning'
    },
    {
      slug: 'blocked-user-enum',
      title: 'Blocked User Enumeration',
      description: 'Attempt to enumerate valid usernames',
      severity: 'warning'
    },
    {
      slug: 'xmlrpc-probe',
      title: 'XML-RPC Probe Attempt',
      description: 'Suspicious XML-RPC endpoint access',
      severity: 'warning'
    },
    {
      slug: 'file-probe',
      title: 'Suspicious File Access',
      description: 'Attempt to access sensitive or non-existent files',
      severity: 'warning'
    },
    {
      slug: 'plugin-enum',
      title: 'Plugin Enumeration',
      description: 'Attempt to enumerate installed plugins',
      severity: 'info'
    },
    {
      slug: 'theme-enum',
      title: 'Theme Enumeration',
      description: 'Attempt to enumerate installed themes',
      severity: 'info'
    },
    {
      slug: 'brute-force',
      title: 'Brute Force Attack Detected',
      description: 'Multiple rapid authentication attempts detected',
      severity: 'critical'
    },
    {
      slug: 'sql-injection',
      title: 'SQL Injection Attempt',
      description: 'Suspected SQL injection in request parameters',
      severity: 'critical'
    },
    {
      slug: 'xss-attempt',
      title: 'XSS Attempt',
      description: 'Suspected cross-site scripting attack',
      severity: 'critical'
    },
    {
      slug: 'command-injection',
      title: 'Command Injection Attempt',
      description: 'Suspected OS command injection attempt',
      severity: 'critical'
    }
  ];

  const insertQuery = `
    INSERT INTO security_event_types (slug, title, description, severity)
    VALUES (?, ?, ?, ?)
  `;

  for (const eventType of eventTypes) {
    await db.query(insertQuery, [
      eventType.slug,
      eventType.title,
      eventType.description,
      eventType.severity
    ]);
  }
};

module.exports = {
  up,
};
