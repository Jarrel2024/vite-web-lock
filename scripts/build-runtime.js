import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const srcRuntimeDir = resolve(rootDir, 'src', 'runtime')
const outputDir = resolve(rootDir, 'dist', 'runtime')

mkdirSync(outputDir, { recursive: true })

const files = ['bootstrap.js', 'sw.js']

for (const file of files) {
  const source = readFileSync(resolve(srcRuntimeDir, file), 'utf-8')
  const result = transformSync(source, {
    minify: true,
    target: 'es2015',
    format: 'iife',
    legalComments: 'none',
    platform: 'browser',
    charset: 'utf8',
  })
  writeFileSync(resolve(outputDir, file), result.code)
  console.log(`[build-runtime] ${file}: ${source.length}B → ${result.code.length}B (${Math.round((1 - result.code.length / source.length) * 100)}% smaller)`)
}
