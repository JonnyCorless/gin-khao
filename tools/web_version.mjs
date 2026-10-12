// Writes site/web/version.json for over-the-air web updates.
// Usage: node tools/web_version.mjs <site/web dir> <build number>
// minApk (package.json "ginkhao.minApk") is the lowest APK version code this web build can run on:
// raise it when web code starts using something only a newer APK has.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const [dir, build] = process.argv.slice(2);
const { ginkhao } = JSON.parse(readFileSync('package.json', 'utf8'));
const files = [];
const walk = d => {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name !== 'version.json') files.push({ path: relative(dir, p).split('\\').join('/'), sha1: createHash('sha1').update(readFileSync(p)).digest('hex') });
  }
};
walk(dir);
writeFileSync(join(dir, 'version.json'), JSON.stringify({ build: Number(build), minApk: ginkhao.minApk, files }, null, 1));
console.log(`web/version.json: build ${build}, minApk ${ginkhao.minApk}, ${files.length} files`);
