import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, pbkdf2Sync, randomBytes, createCipheriv } from 'node:crypto'
import { loadEnv } from 'vite'

/**
 * @typedef {Object} EncryptPluginOptions
 * @property {string} [cookieName]
 * @property {number} [cookieDays]
 * @property {number} [iterations]
 * @property {number} [saltLen]
 * @property {number} [ivLen]
 * @property {string} [algorithm]
 * @property {string} [envKey]
 * @property {string} [distDir]
 * @property {string} [assetsDir]
 */

/** @type {Required<EncryptPluginOptions>} */
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

/**
 * @param {EncryptPluginOptions} [user]
 * @returns {Required<EncryptPluginOptions>}
 */
function mergeOptions(user) {
  return { ...DEFAULT_OPTIONS, ...user }
}

/** @type {string | null} */
let bootstrapTemplate = null

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * @param {Buffer} plaintext
 * @param {Buffer} keyBuffer
 * @param {number} ivLen
 * @param {string} algorithm
 * @returns {Buffer}
 */
function encrypt(plaintext, keyBuffer, ivLen, algorithm) {
  const iv = randomBytes(ivLen)
  /** @type {import('node:crypto').CipherGCM} */
  const cipher = /** @type {any} */ (createCipheriv(algorithm, keyBuffer, iv))
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, encrypted, tag])
}

/**
 * @param {string} secret
 * @param {Buffer} salt
 * @param {number} iterations
 * @returns {Buffer}
 */
function deriveKey(secret, salt, iterations) {
  return pbkdf2Sync(secret, salt, iterations, 32, 'sha256')
}

/**
 * @param {string} entryPath
 * @param {string} saltBase64
 * @param {string} cacheKey
 * @param {Required<EncryptPluginOptions>} opts
 * @returns {string}
 */
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

/**
 * @param {EncryptPluginOptions} [options]
 * @returns {import('vite').Plugin}
 */
export function encryptPlugin(options) {
  const opts = mergeOptions(options)
  /** @type {import('vite').ResolvedConfig} */
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

      const salt = randomBytes(opts.saltLen)
      const keyBuffer = deriveKey(secret, salt, opts.iterations)
      const saltBase64 = salt.toString('base64')
      const cacheKey = createHash('sha256').update(saltBase64).digest('hex').slice(0, 12)

      let html = readFileSync(indexPath, 'utf-8')

      const mainMatch = html.match(/<script type="module"[^>]*src="([^"]*)"[^>]*><\/script>/)
      const entryPath = mainMatch ? mainMatch[1] : null

      if (!entryPath) {
        throw new Error('[encrypt] no module entry <script> found in dist/index.html')
      }

      /** @type {string[]} */
      let files
      try {
        files = readdirSync(assetsDir).filter((f) => extname(f) === '.js')
      } catch {
        throw new Error('[encrypt] no dist/assets directory found')
      }

      if (files.length !== 1) {
        throw new Error(
          `[encrypt] expected exactly 1 JS bundle (inlineDynamicImports), found ${files.length}: ${files.join(', ')}`,
        )
      }

      const filePath = resolve(assetsDir, files[0])
      const plaintext = readFileSync(filePath)
      const encrypted = encrypt(plaintext, keyBuffer, opts.ivLen, opts.algorithm)
      writeFileSync(filePath, encrypted)

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
      console.log(`[encrypt] encrypted ${entryPath}, salt=${saltBase64}`)
    },
  }
}

export default encryptPlugin
