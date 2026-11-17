const fs = require('node:fs/promises');
const path = require('node:path');

const appDirectory = path.resolve(__dirname, '..');
const outputDirectory = path.join(appDirectory, 'www');
const appFiles = [
  'index.html',
  'styles.css',
  'app.js',
  'admin.html',
  'admin.js',
  'manifest.webmanifest',
  'sw.js',
  'app-icon-192.png',
  'app-icon-512.png',
  'sff-logo.png',
];

async function buildWebAssets() {
  await fs.mkdir(outputDirectory, { recursive: true });
  await Promise.all(appFiles.map(async (fileName) => {
    await fs.copyFile(path.join(appDirectory, fileName), path.join(outputDirectory, fileName));
  }));
  console.log(`Copied ${appFiles.length} app files to ${path.relative(appDirectory, outputDirectory)}.`);
}

buildWebAssets().catch((error) => {
  console.error('Unable to prepare the Android web assets.', error);
  process.exitCode = 1;
});
