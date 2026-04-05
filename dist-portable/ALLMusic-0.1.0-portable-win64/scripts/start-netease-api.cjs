/**
 * Start NeteaseCloudMusicApi server
 * This script starts the local API server for NetEase Cloud Music
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { ensurePortAvailable } = require('./port-utils.cjs');

// Find the NeteaseCloudMusicApi package
const apiPath = path.resolve(__dirname, '../node_modules/NeteaseCloudMusicApi');
const appPath = path.join(apiPath, 'app.js');

if (!fs.existsSync(appPath)) {
  console.error('NeteaseCloudMusicApi not found. Please run: npm install');
  process.exit(1);
}

// Set default port
const PORT = process.env.NETEASE_API_PORT || 3000;
const HOST = process.env.NETEASE_API_HOST || 'localhost';

// Set environment variables for the API
process.env.PORT = PORT;

if (!ensurePortAvailable({ port: PORT, host: HOST, serviceName: 'NetEase API' })) {
  process.exit(1);
}

console.log(`Starting NeteaseCloudMusicApi on http://${HOST}:${PORT}...`);

// Start the API server directly (without shell wrapping) so process lifecycle is predictable.
const apiProcess = spawn(process.execPath, [appPath], {
  cwd: apiPath,
  env: {
    ...process.env,
    PORT: PORT,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: false,
  windowsHide: true,
});

// Handle output
apiProcess.stdout.on('data', (data) => {
  console.log(`[NetEase API] ${data}`);
});

apiProcess.stderr.on('data', (data) => {
  console.error(`[NetEase API Error] ${data}`);
});

apiProcess.on('error', (error) => {
  console.error(`[NetEase API Error] Failed to spawn process: ${error.message}`);
  process.exit(1);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  console.log('\nStopping NeteaseCloudMusicApi...');
  if (apiProcess.exitCode === null) {
    apiProcess.kill('SIGTERM');
  }
}

// Handle process exit
apiProcess.on('close', (code) => {
  const exitCode = typeof code === 'number' ? code : 0;
  console.log(`NeteaseCloudMusicApi exited with code ${exitCode}`);
  process.exit(exitCode);
});

// Handle cleanup on exit
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGBREAK', shutdown);
