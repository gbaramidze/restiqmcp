module.exports = {
  apps: [
    {
      name: 'pos-mcp-sse',
      script: './dist/sse-server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3005,
        DEFAULT_TENANT: 'teatro'
      },
      env_file: '.env'
    }
  ]
};
