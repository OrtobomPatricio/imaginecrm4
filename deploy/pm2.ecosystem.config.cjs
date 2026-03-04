module.exports = {
  apps: [
    {
      name: "chin-crm",
      script: "dist/index.js",
      cwd: "/opt/chin-crm",
      autorestart: true,
      max_memory_restart: "1G",
      exp_backoff_restart_delay: 100,
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
  ],
};
