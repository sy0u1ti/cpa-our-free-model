import fs from 'node:fs';
import path from 'node:path';

// Static local page package for isolated CPA integration and browser checks.
export function writePagePluginFixture(directory) {
  const source = path.join(directory, 'page-plugin-fixture');
  const files = {
    'page/index.html': '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="page.css"><script type="module" src="main.mjs"></script></head><body><h1>Loading</h1><p id="plugin-info">Waiting for host</p></body></html>',
    'page/main.mjs': [
      "import { heading } from './labels.mjs';",
      "document.querySelector('h1').textContent = heading;",
      "window.ofm.plugin.info().then(info => { document.querySelector('#plugin-info').textContent = info.id; });",
    ].join('\n'),
    'page/labels.mjs': 'export const heading = "CPA 插件页面验证";\n',
    'page/page.css': 'body{font:16px system-ui;padding:24px;color:var(--ofm-text,#17251b);background:var(--ofm-bg,#fff)}h1{padding-left:28px;background:url("dot.svg") no-repeat left center}',
    'page/dot.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="#328157"/></svg>',
  };
  for (const [name, body] of Object.entries(files)) {
    const target = path.join(source, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
  fs.writeFileSync(path.join(source, 'ofm-plugin.json'), JSON.stringify({
    schemaVersion: 2, id: 'cpa-page-fixture', version: '1.0.0', name: 'CPA 页面验证',
    apiVersion: '^2', minHost: '2.8.1', files: Object.keys(files),
    contributes: { pages: [{ id: 'main', title: 'CPA 页面验证', entry: 'page/index.html' }] },
    permissions: { network: [], secrets: [], storage: false },
  }));
  return source;
}
