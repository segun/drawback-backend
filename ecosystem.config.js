module.exports = {
  apps: [
    {
      name: 'drawback-backend',
      script: 'dist/main.js',
      // 'max' uses all available CPU cores. Set to a number (e.g. 4) to cap it.
      // Requires REDIS_HOST to be set so the Socket.IO Redis adapter
      // keeps all workers in sync.
      instances: 'max',
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      // Restart a worker if it exceeds 512 MB — guards against slow memory leaks.
      max_memory_restart: '512M',
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
