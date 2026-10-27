import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

export async function stampServiceWorker(directory, files) {
  const workerPath=path.join(directory,'service-worker.js');
  const htmlPath=path.join(directory,'index.html');
  const [worker,html]=await Promise.all([readFile(workerPath,'utf8'),readFile(htmlPath,'utf8')]);
  const assets=files.filter(file=>file.startsWith('assets/')&&/\.(js|css|woff2?|svg)$/.test(file)).sort();
  const hash=createHash('sha256').update(worker).update(html);
  for(const file of assets){hash.update(file);hash.update(await readFile(path.join(directory,file)));}
  const buildId=hash.digest('hex').slice(0,20);
  const stamped=worker.replaceAll('__KEEPLOCAL_BUILD_ID__',buildId)
    .replace("'__KEEPLOCAL_BUILD_ASSETS__'",assets.map(file=>JSON.stringify('/'+file)).join(',\n  '));
  await Promise.all([
    writeFile(workerPath,stamped),
    writeFile(htmlPath,html.replace('</head>',`<meta name="keeplocal-build" content="${buildId}" />\n  </head>`)),
  ]);
  return {buildId,assets};
}

export function serviceWorkerBuild() {
  let outputDirectory;
  return {
    name:'keeplocal-service-worker-build',
    apply:'build',
    configResolved(config){outputDirectory=path.resolve(config.root,config.build.outDir);},
    async writeBundle(_options,bundle){await stampServiceWorker(outputDirectory,Object.keys(bundle));},
  };
}
