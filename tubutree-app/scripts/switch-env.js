#!/usr/bin/env node
/**
 * Switch frontend backend URL giữa local / staging / production.
 *
 * Usage:
 *   node scripts/switch-env.js local       # http://localhost:3001/api
 *   node scripts/switch-env.js staging URL # custom URL
 *   node scripts/switch-env.js production https://api.tubutree.com/api
 */
const fs = require('fs');
const path = require('path');

const ENVS = {
  local: 'http://localhost:3001/api',
};

const [, , mode, customUrl] = process.argv;

if (!mode || (!ENVS[mode] && !customUrl)) {
  console.error('Usage:');
  console.error('  node scripts/switch-env.js local');
  console.error('  node scripts/switch-env.js staging https://<railway-domain>/api');
  console.error('  node scripts/switch-env.js production https://api.tubutree.com/api');
  process.exit(1);
}

const url = ENVS[mode] || customUrl;
const envPath = path.resolve(__dirname, '..', '.env');
const content = `# Tubu Tree Mini App - Frontend env
# Mode: ${mode}
# Switched at: ${new Date().toISOString()}
VITE_API_URL=${url}
`;

fs.writeFileSync(envPath, content);
console.log(`✓ Switched to ${mode} mode`);
console.log(`  VITE_API_URL=${url}`);
console.log(`  → Run: npx vite build --outDir www && npx zmp deploy --testing`);
