import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {patchAtlasBlit} from './pt-atlas-patch.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(root+'package.json');
// require.resolve('three') selects the Node CJS entry, which calls process.emitWarning.
// Resolve the bare import to ESM while retaining the shared package's subpath exports.
const threeESM=join(dirname(require.resolve('three')),'three.module.js');
const result=await build({entryPoints:[root+'src/dual-viewer.js'],outfile:root+'viewer.bundle.js',bundle:true,minify:true,format:'esm',platform:'browser',legalComments:'eof',metafile:true,write:false,plugins:[{name:'shared-three',setup(build){build.onResolve({filter:/^three(?:\/|$)/},args=>({path:args.path==='three'?threeESM:require.resolve(args.path)}));}},{name:'pt-atlas-copy-uv',setup(build){build.onLoad({filter:/three-gpu-pathtracer[\\/]src[\\/]webgpu[\\/]AtlasTexture\.js$/},async args=>({contents:patchAtlasBlit(await readFile(args.path,'utf8')),loader:'js'}));}}]});
if(Object.keys(result.metafile.inputs).some(path=>/three[\\/]build[\\/]three\.cjs$/.test(path)))throw new Error('Browser bundle must not include the Three.js Node CJS entry.');
for(const file of result.outputFiles){
  if(/\bprocess\.emitWarning\s*\(/.test(file.text))throw new Error('Node-only process.emitWarning leaked into the browser bundle.');
  await writeFile(file.path,file.contents);
}
console.log('Built the 61-character dual renderer.');
