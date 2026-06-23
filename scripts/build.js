/**
 * build.js — LiangLLM Build Helper
 *
 * Copies frontend files and creates placeholder assets.
 * Run: node scripts/build.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');

console.log('=== LiangLLM Build Helper ===\n');

// 1. Verify frontend structure
const required = [
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/api.js',
  'js/components/dashboard-panel.js',
  'js/components/model-manager.js',
  'js/components/config-panel.js',
  'js/components/chat-panel.js',
  'js/components/metrics-panel.js',
];

let allGood = true;
for (const f of required) {
  const fp = path.join(FRONTEND, f);
  if (fs.existsSync(fp)) {
    console.log(`  [OK] ${f}`);
  } else {
    console.log(`  [MISSING] ${f}`);
    allGood = false;
  }
}

// 2. Create assets directory if not exists
const assetsDir = path.join(FRONTEND, 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
  console.log('  [OK] Created assets/ directory');
}

// 3. Check backend files
const backendDir = path.join(ROOT, 'backend');
const backendFiles = [
  'server.py', 'model_manager.py', 'process_manager.py',
  'config_manager.py', 'chat_engine.py', 'metrics_collector.py',
  'backend_selector.py', '__init__.py', 'requirements.txt',
];
for (const f of backendFiles) {
  const fp = path.join(backendDir, f);
  if (fs.existsSync(fp)) {
    console.log(`  [OK] backend/${f}`);
  } else {
    console.log(`  [MISSING] backend/${f}`);
    allGood = false;
  }
}

console.log('');
if (allGood) {
  console.log('✓ All files present. Ready to build.');
  console.log('\nTo run in development mode:');
  console.log('  1. npm install');
  console.log('  2. npm start');
  console.log('\nTo build distributable:');
  console.log('  1. npm install');
  console.log('  2. npm run dist');
} else {
  console.log('✗ Some files are missing. Check the project structure.');
}
