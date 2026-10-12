// Copies the built content site into public/bundled so the APK can work offline on first launch.
import { cpSync, existsSync, rmSync } from 'node:fs';

const src = 'site';
const dest = 'public/bundled';
if (!existsSync(`${src}/manifest.json`)) {
  console.error('No site/manifest.json. Run "npm run content" first.');
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log('Bundled content copied to public/bundled');
