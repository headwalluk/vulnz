module.exports = {
  apps : [{
    name   : "vulnz",
    script : "src/index.js",
    exec_mode: "cluster",
    instances: 2,
    env: {
      NODE_ENV: "production",
    }
  }]
}
