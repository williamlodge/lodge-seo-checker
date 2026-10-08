module.exports = {
  apps: [{
    name: 'seo-checker',
    script: 'src/server.js',
    cwd: '/home/admin/projects/seo-checker',
    env: {
      PORT: 5310,
      SEOCHECKER_DB: '/home/admin/projects/seo-checker/data/seo-checker.db',
    },
    max_memory_restart: '300M',
  }],
};
