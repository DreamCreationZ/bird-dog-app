module.exports = {
  apps: [
    {
      name: "bird-dog-web",
      cwd: "/var/www/bird-dog-app/current",
      script: "npm",
      args: "run start",
      env_file: "/etc/bird-dog/.env.production",
      env: {
        NODE_ENV: "production",
        PORT: "3000"
      }
    },
    {
      name: "bird-dog-harvest-worker",
      cwd: "/var/www/bird-dog-app/current",
      script: "npm",
      args: "run worker:harvest",
      env_file: "/etc/bird-dog/.env.production",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
