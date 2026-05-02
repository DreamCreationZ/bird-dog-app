const fs = require("fs");

function loadEnvFile(path) {
  try {
    const raw = fs.readFileSync(path, "utf8");
    return raw.split(/\r?\n/).reduce((acc, line) => {
      const clean = String(line || "").trim();
      if (!clean || clean.startsWith("#")) return acc;
      const idx = clean.indexOf("=");
      if (idx <= 0) return acc;
      const key = clean.slice(0, idx).trim();
      const value = clean.slice(idx + 1).trim();
      if (!key) return acc;
      acc[key] = value;
      return acc;
    }, {});
  } catch {
    return {};
  }
}

const fileEnv = loadEnvFile("/etc/bird-dog/.env.production");

module.exports = {
  apps: [
    {
      name: "bird-dog-web",
      cwd: "/var/www/bird-dog-app/current",
      script: "npm",
      args: "run start",
      env: {
        ...fileEnv,
        NODE_ENV: "production",
        PORT: "3000"
      }
    },
    {
      name: "bird-dog-harvest-worker",
      cwd: "/var/www/bird-dog-app/current",
      script: "npm",
      args: "run worker:harvest",
      env: {
        ...fileEnv,
        NODE_ENV: "production"
      }
    }
  ]
};
