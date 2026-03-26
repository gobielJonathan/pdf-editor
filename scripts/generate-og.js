import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const svgPath = resolve(root, 'public', 'og-image.svg')
const outPath = resolve(root, 'public', 'og-image.png')

const svg = readFileSync(svgPath)

await sharp(svg)
  .resize(1200, 630)
  .png({ quality: 90, compressionLevel: 9 })
  .toFile(outPath)

console.log('Generated public/og-image.png (1200×630)')
