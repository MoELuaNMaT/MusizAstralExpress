/**
 * Start NeteaseCloudMusicApi server
 * This script starts the local API server for NetEase Cloud Music
 */

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

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

console.log(`Starting NeteaseCloudMusicApi on http://${HOST}:${PORT}...`);

// Start the API server
const apiProcess = exec(`node "${appPath}"`, {
  cwd: apiPath,
  env: {
    ...process.env,
    PORT: PORT,
  },
});

// Handle output
apiProcess.stdout.on('data', (data) => {
  console.log(`[NetEase API] ${data}`);
});

apiProcess.stderr.on('data', (data) => {
  console.error(`[NetEase API Error] ${data}`);
});

// Handle process exit
apiProcess.on('close', (code) => {
  console.log(`NeteaseCloudMusicApi exited with code ${code}`);
  process.exit(code);
});

// Handle cleanup on exit
process.on('SIGINT', () => {
  console.log('\nStopping NeteaseCloudMusicApi...');
  apiProcess.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  apiProcess.kill();
  process.exit(0);
});
