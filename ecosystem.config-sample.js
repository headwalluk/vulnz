module.exports = {
  apps: [
    {
      name: 'vulnz',
      script: 'src/index.js',
      exec_mode: 'cluster',
      instances: 2,
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '1G',
      min_uptime: '10s',
    },
  ],
};
