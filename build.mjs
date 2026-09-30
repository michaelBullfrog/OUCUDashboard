import fs from 'node:fs';
fs.writeFileSync('worker/assets.js','export const DASHBOARD='+JSON.stringify(fs.readFileSync('public/index.html','utf8'))+';\nexport const LOGO='+JSON.stringify(fs.readFileSync('public/logo.png').toString('base64'))+';\n');
