import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
await build({entryPoints:[fileURLToPath(new URL('scene.mjs',import.meta.url))],outfile:fileURLToPath(new URL('../../dist/dice-scene.mjs',import.meta.url)),
  bundle:true,minify:true,format:'esm',target:'es2022',legalComments:'inline'});
const licenses=await Promise.all(['three','cannon-es'].map(async name=>name+'\n\n'+await readFile(new URL('node_modules/'+name+'/LICENSE',import.meta.url),'utf8')));
await writeFile(new URL('../../dist/assets/dice-libraries.txt',import.meta.url),'Wayfarer dice renderer: Three.js 0.187.0 and cannon-es 0.20.0\n\n'+licenses.join('\n\n'));
