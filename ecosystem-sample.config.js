module.exports = {
  // App processes
  apps: [
    {
      name: 'vulnz',
      script: 'src/index.js',
      exec_mode: 'cluster',
      instances: 2,
      watch: false,
      // Default to production: serves HTML/static from `dist/`.
      // Use `--env development` to serve from `public/`.
      env: {
        NODE_ENV: 'production',
      },
      env_development: {
        NODE_ENV: 'development',
      },
      max_memory_restart: '1G',
      min_uptime: '10s',
    },
  ],
};
