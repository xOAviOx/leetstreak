// Rasterize assets/icon.svg into the four MV3 icon sizes.
// Run: npm run icons
import sharp from 'sharp';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const src = resolve(root, 'assets/icon.svg');
const outDir = resolve(root, 'public/icons');
const sizes = [16, 32, 48, 128];

const svg = await readFile(src);
await mkdir(outDir, { recursive: true });

await Promise.all(
  sizes.map((size) =>
    sharp(svg, { density: 384 })
      .resize(size, size, { fit: 'contain' })
      .png()
      .toFile(resolve(outDir, `${size}.png`)),
  ),
);

console.log(`Generated icons: ${sizes.map((s) => `${s}.png`).join(', ')}`);
