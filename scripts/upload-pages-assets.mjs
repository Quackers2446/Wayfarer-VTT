import fs from 'node:fs';
import path from 'node:path';
import { blake3 } from '/tmp/noble/node_modules/@noble/hashes/blake3.js';

const clientDir = path.resolve('wayfarer/dist/client');
const JWT = process.env.PAGES_JWT;

if (!JWT) {
  console.error("Missing PAGES_JWT");
  process.exit(1);
}

const MIME_TYPES = {
  html: 'text/html',
  css: 'text/css',
  mjs: 'application/javascript',
  js: 'application/javascript',
  json: 'application/json',
  svg: 'image/svg+xml',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  woff2: 'font/woff2',
  txt: 'text/plain',
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function getExtension(filePath) {
  return path.extname(filePath).slice(1);
}

function walkDir(dir, baseDir = dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(fullPath, baseDir));
    } else if (entry.isFile()) {
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      files.push({ fullPath, relPath });
    }
  }
  return files;
}

const allFiles = walkDir(clientDir);
const manifest = {};
const assetMap = new Map();

for (const { fullPath, relPath } of allFiles) {
  if (relPath === '_worker.js') {
    continue;
  }

  const rawBytes = fs.readFileSync(fullPath);
  const base64Content = rawBytes.toString('base64');
  const ext = getExtension(relPath);
  const toHash = base64Content + ext;
  const hash = Buffer.from(blake3(toHash)).toString('hex').slice(0, 32);

  manifest['/' + relPath] = hash;
  if (!assetMap.has(hash)) {
    assetMap.set(hash, {
      key: hash,
      value: base64Content,
      metadata: { contentType: getMimeType(relPath) },
      base64: true,
      size: rawBytes.length,
      relPath
    });
  }
}

console.log(`Processed ${allFiles.length} files. Assets to check: ${assetMap.size}. Manifest entries: ${Object.keys(manifest).length}`);

// Step 1: Check missing
const allHashes = Array.from(assetMap.keys());
console.log(`Checking missing hashes...`);

const checkRes = await fetch("https://api.cloudflare.com/client/v4/pages/assets/check-missing", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${JWT}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ hashes: allHashes })
});

if (!checkRes.ok) {
  console.error("Check missing failed:", checkRes.status, await checkRes.text());
  process.exit(1);
}

const checkData = await checkRes.json();
const missingHashes = checkData.result || [];
console.log(`Missing hashes count: ${missingHashes.length} out of ${allHashes.length}`);

// Step 2: Upload missing assets in chunks (max ~2MB per batch)
const missingAssets = missingHashes.map(h => assetMap.get(h)).filter(Boolean);

let currentBatch = [];
let currentBatchSize = 0;
const batches = [];

for (const asset of missingAssets) {
  if (currentBatchSize + asset.size > 2 * 1024 * 1024 && currentBatch.length > 0) {
    batches.push(currentBatch);
    currentBatch = [];
    currentBatchSize = 0;
  }
  currentBatch.push({
    key: asset.key,
    value: asset.value,
    metadata: asset.metadata,
    base64: asset.base64
  });
  currentBatchSize += asset.size;
}
if (currentBatch.length > 0) {
  batches.push(currentBatch);
}

console.log(`Uploading in ${batches.length} batch(es)...`);

for (let i = 0; i < batches.length; i++) {
  const batch = batches[i];
  console.log(`Uploading batch ${i + 1}/${batches.length} (${batch.length} files)...`);
  const uploadRes = await fetch("https://api.cloudflare.com/client/v4/pages/assets/upload", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${JWT}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(batch)
  });

  if (!uploadRes.ok) {
    console.error(`Batch ${i + 1} upload failed:`, uploadRes.status, await uploadRes.text());
    process.exit(1);
  }
  const uploadData = await uploadRes.json();
  if (!uploadData.success) {
    console.error(`Batch ${i + 1} unsuccessful:`, uploadData);
    process.exit(1);
  }
}

// Step 3: Upsert hashes
console.log(`Upserting hashes...`);
const upsertRes = await fetch("https://api.cloudflare.com/client/v4/pages/assets/upsert-hashes", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${JWT}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ hashes: allHashes })
});

if (!upsertRes.ok) {
  console.error("Upsert hashes failed:", upsertRes.status, await upsertRes.text());
  process.exit(1);
}

const upsertData = await upsertRes.json();
console.log(`Upsert result:`, upsertData.success);

// Save manifest for deployment step
fs.writeFileSync('wayfarer/manifest.json', JSON.stringify(manifest, null, 2), 'utf8');
console.log(`Saved manifest with ${Object.keys(manifest).length} entries to wayfarer/manifest.json`);
