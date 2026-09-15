import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes('--watch');

const entries = [
  { entry: 'src/devtools/devtools.ts',   out: 'dist/devtools.js' },
  { entry: 'src/background/background.ts', out: 'dist/background.js' },
  { entry: 'src/panel/panel.ts',          out: 'dist/panel.js' },
  { entry: 'src/options/options.ts',      out: 'dist/options.js' },
  { entry: 'src/sidebar/sidebar.ts',      out: 'dist/sidebar.js' },
];

const staticFiles = [
  ['manifest.json',              'dist/manifest.json'],
  ['src/devtools/devtools.html',  'dist/devtools.html'],
  ['src/panel/panel.html',        'dist/panel.html'],
  ['src/panel/panel.css',         'dist/panel.css'],
  ['src/options/options.html',    'dist/options.html'],
  ['src/sidebar/sidebar.html',    'dist/sidebar.html'],
];

function copyStatic() {
  rmSync(join(__dirname, 'dist'), { recursive: true, force: true });
  mkdirSync(join(__dirname, 'dist'), { recursive: true });
  for (const [src, dst] of staticFiles) {
    const from = join(__dirname, src);
    const to = join(__dirname, dst);
    if (existsSync(from)) {
      mkdirSync(dirname(to), { recursive: true });
      cpSync(from, to);
    }
  }
  if (existsSync(join(__dirname, 'icons'))) {
    cpSync(join(__dirname, 'icons'), join(__dirname, 'dist/icons'), { recursive: true });
  }
}

const esbuildConfig = {
  entryPoints: [],
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  sourcemap: true,
  logLevel: 'info',
};

async function main() {
  copyStatic();

  if (isWatch) {
    for (const { entry, out } of entries) {
      const ctx = await context({
        ...esbuildConfig,
        entryPoints: [join(__dirname, entry)],
        outfile: join(__dirname, out),
      });
      await ctx.watch();
    }
    console.log('Watching for changes...');
  } else {
    await Promise.all(
      entries.map(({ entry, out }) =>
        build({
          ...esbuildConfig,
          entryPoints: [join(__dirname, entry)],
          outfile: join(__dirname, out),
        })
      )
    );
    console.log('Build complete.');
  }
}

main();
