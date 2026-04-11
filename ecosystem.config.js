module.exports = {
  apps: [
    {
      name:               'autoscore',
      script:             'api/index.js',
      instances:          1,
      autorestart:        true,
      watch:              false,
      max_memory_restart: '256M',

      error_file:     '/home/ubuntu/.pm2/logs/autoscore-error.log',
      out_file:       '/home/ubuntu/.pm2/logs/autoscore-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:     true,

      env: {
        NODE_ENV: 'production',
        PORT:     3000,
      },
    },
  ],
};
