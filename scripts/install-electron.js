const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

try {
  const pkgPath = path.join(__dirname, '..', 'node_modules', 'electron', 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.log('[liangllm] electron package not present, skipping postinstall');
    process.exit(0);
  }
  const p = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const installScript = path.join(__dirname, '..', 'node_modules', 'electron', 'install.js');
  if (fs.existsSync(installScript)) {
    execSync('node ' + installScript, { stdio: 'inherit' });
    console.log('[liangllm] electron v' + p.version + ' binary ready');
  }
} catch (e) {
  console.warn('[liangllm] electron postinstall skipped:', e.message);
}
