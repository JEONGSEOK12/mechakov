// Turns the solo build in dist-web/ into one self-contained HTML file
// (scripts and styles inlined) that can be hosted anywhere as a static page.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('dist-web');
let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet"[^>]*href="\.?\/?([^"]+)"[^>]*>/g, (_, href) =>
  `<style>${fs.readFileSync(path.join(dir, href), 'utf8')}</style>`);
html = html.replace(/<script type="module"[^>]*src="\.?\/?([^"]+)"[^>]*><\/script>/g, (_, src) => {
  const js = fs.readFileSync(path.join(dir, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${js}</script>`;
});
// Module scripts in <head> would run before the body exists once inlined; move them to the end.
const scripts = [];
html = html.replace(/<script type="module">[\s\S]*?<\/script>/g, (m) => {
  scripts.push(m);
  return '';
});
html = html.replace('</body>', () => `${scripts.join('\n')}\n</body>`);

const out = path.join(dir, 'mechakov.html');
fs.writeFileSync(out, html);
console.log(`${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
