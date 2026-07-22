import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, extname, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, pbkdf2Sync, randomBytes, createCipheriv } from 'node:crypto'
import { loadEnv } from 'vite'

const DEFAULT_OPTIONS = {
  cookieName: 'gt_key',
  cookieDays: 30,
  iterations: 100000,
  saltLen: 16,
  ivLen: 12,
  algorithm: 'aes-256-gcm',
  envKey: 'ENCRYPTION_KEY',
  distDir: 'dist',
  assetsDir: 'dist/assets',
}

function mergeOptions(user) {
  return { ...DEFAULT_OPTIONS, ...user }
}

let bootstrapTemplate = null
let swTemplate = null

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))

function encrypt(plaintext, keyBuffer, ivLen, algorithm) {
  const iv = randomBytes(ivLen)
  const cipher = createCipheriv(algorithm, keyBuffer, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, encrypted, tag])
}

function deriveKey(secret, salt, iterations) {
  return pbkdf2Sync(secret, salt, iterations, 32, 'sha256')
}

function buildBootstrap(entryPath, saltBase64, cacheKey, opts) {
  if (!bootstrapTemplate) {
    bootstrapTemplate = readFileSync(resolve(PLUGIN_DIR, 'bootstrap.js'), 'utf-8')
  }
  return bootstrapTemplate
    .replace('__COOKIE__', opts.cookieName)
    .replace('__DAYS__', String(opts.cookieDays))
    .replace('__ENTRY__', entryPath)
    .replace('__CACHE__', cacheKey)
    .replace('__SALT__', saltBase64)
    .replace('__ITERATIONS__', String(opts.iterations))
    .replace('__IV_LEN__', String(opts.ivLen))
}

function buildSW(assetsDirName, ivLen, cacheKey) {
  if (!swTemplate) {
    swTemplate = readFileSync(resolve(PLUGIN_DIR, 'sw.js'), 'utf-8')
  }
  return swTemplate
    .replace('__ASSETS_DIR__', assetsDirName)
    .replace('__IV_LEN__', String(ivLen))
    .replace('__CACHE__', cacheKey)
}

export function encryptPlugin(options) {
  const opts = mergeOptions(options)
  let resolvedConfig

  return {
    name: 'vite-plugin-encrypt',
    apply: 'build',
    enforce: 'post',

    configResolved(config) {
      resolvedConfig = config
    },

    closeBundle() {
      const env = loadEnv(resolvedConfig.mode, process.cwd(), '')
      const secret = env.VITE_ENCRYPTION_KEY || env[opts.envKey] || ''
      if (!secret) {
        console.log(`[encrypt] ${opts.envKey} not set, skipping encryption`)
        return
      }

      const distDir = resolve(process.cwd(), opts.distDir)
      const assetsDir = resolve(process.cwd(), opts.assetsDir)
      const indexPath = resolve(distDir, 'index.html')

      if (!existsSync(assetsDir)) {
        throw new Error('[encrypt] no dist/assets directory found')
      }

      const jsFiles = readdirSync(assetsDir).filter((f) => extname(f) === '.js')

      if (jsFiles.length === 0) {
        throw new Error('[encrypt] no .js files found in dist/assets')
      }

      const salt = randomBytes(opts.saltLen)
      const keyBuffer = deriveKey(secret, salt, opts.iterations)
      const saltBase64 = salt.toString('base64')
      const cacheKey = createHash('sha256').update(saltBase64).digest('hex').slice(0, 12)

      for (const file of jsFiles) {
        const filePath = resolve(assetsDir, file)
        const plaintext = readFileSync(filePath)
        const encrypted = encrypt(plaintext, keyBuffer, opts.ivLen, opts.algorithm)
        writeFileSync(filePath, encrypted)
      }

      const assetsDirName = basename(opts.assetsDir)
      const swContent = buildSW(assetsDirName, opts.ivLen, cacheKey)
      writeFileSync(resolve(distDir, 'sw.js'), swContent)

      let html = readFileSync(indexPath, 'utf-8')

      const mainMatch = html.match(/<script type="module"[^>]*src="([^"]*)"[^>]*><\/script>/)
      const entryPath = mainMatch ? mainMatch[1] : null

      if (!entryPath) {
        throw new Error('[encrypt] no module entry <script> found in dist/index.html')
      }

      html = html
        .replace(/<script type="module"[^>]*src="[^"]*"[^>]*><\/script>/g, '')
        .replace(/<link rel="modulepreload"[^>]*>/g, '')

      const bootstrapBlock = '<script>' + buildBootstrap(entryPath, saltBase64, cacheKey, opts) + '</script>'

      const titleEnd = html.indexOf('</title>')
      const headEnd = html.indexOf('</head>')
      if (titleEnd !== -1) {
        html = html.slice(0, titleEnd + 8) + '\n    ' + bootstrapBlock + html.slice(titleEnd + 8)
      } else if (headEnd !== -1) {
        html = html.slice(0, headEnd) + '\n    ' + bootstrapBlock + '\n  ' + html.slice(headEnd)
      } else {
        throw new Error('[encrypt] could not find </title> or </head> to inject bootstrap')
      }

      writeFileSync(indexPath, html)
      console.log(`[encrypt] encrypted ${jsFiles.length} chunk(s), salt=${saltBase64}, sw.js generated`)
    },
  }
}

export default encryptPlugin
