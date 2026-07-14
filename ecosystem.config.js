// PM2 process config for PayTrack on Hostinger.
// Usage on the server:  pm2 start ecosystem.config.js && pm2 save
module.exports = {
  apps: [
    {
      name: "paytrack",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
    },
  ],
};
