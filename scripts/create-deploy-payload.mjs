import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const workerCode = fs.readFileSync(path.join(root, 'dist/client/_worker.js'), 'utf8');
const workerB64 = Buffer.from(workerCode).toString('base64');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

const executeCode = 'async () => {\n' +
  '  const manifest = ' + JSON.stringify(manifest) + ';\n' +
  '  const workerB64 = "' + workerB64 + '";\n' +
  '  const workerCode = new TextDecoder().decode(Uint8Array.from(atob(workerB64), c => c.charCodeAt(0)));\n' +
  '  const form = new FormData();\n' +
  '  form.append("manifest", JSON.stringify(manifest));\n' +
  '  form.append("branch", "main");\n' +
  '  form.append("_worker.js", new Blob([workerCode], { type: "application/javascript+module" }), "_worker.js");\n' +
  '  const res = await cloudflare.request({\n' +
  '    method: "POST",\n' +
  '    path: `/accounts/${accountId}/pages/projects/wayfarer-vtt/deployments`,\n' +
  '    body: form\n' +
  '  });\n' +
  '  return {\n' +
  '    success: res.success,\n' +
  '    deploymentId: res.result?.id,\n' +
  '    url: res.result?.url,\n' +
  '    stages: res.result?.stages,\n' +
  '    errors: res.errors\n' +
  '  };\n' +
  '}';

const payload = {
  account_id: "1a15c3ffd6933ad42e67777406cb8a61",
  code: executeCode
};

fs.writeFileSync(path.join(root, 'scripts/deploy-payload.json'), JSON.stringify(payload), 'utf8');
console.log("Written scripts/deploy-payload.json. Code length:", executeCode.length);
