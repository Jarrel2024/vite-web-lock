# vite-web-lock

Build-time AES-256-GCM encryption for Vite SPAs. Locks access behind a `?key=` password.

## How it works

1. At build time, the plugin encrypts every JS chunk with AES-256-GCM using a PBKDF2-derived key.
2. It generates a Service Worker (`sw.js`) that intercepts and decrypts JS asset requests on-the-fly.
3. It injects an inline bootstrap script into `index.html` that:
   - Reads the key from `?key=` query param or `gt_key` cookie
   - Derives the AES key via PBKDF2 (same salt, iterations)
   - Registers the Service Worker and passes the derived AES key to it
   - Injects the original entry module script — the SW transparently decrypts every chunk at fetch time
   - Boots the SPA as usual
4. No key → static "Access Denied" message. No valid key → decrypt fails → denied.

## Usage

```bash
pnpm add github:Jarrel2024/vite-web-lock
```

```ts
// vite.config.ts
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { encryptPlugin } from 'vite-web-lock'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      vue(),
      encryptPlugin({
        cookieName: 'gt_key',
        cookieDays: 30,
      }),
    ],
  }
})
```

## Configuration

The plugin accepts an optional `EncryptPluginOptions` object:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `cookieName` | `string` | `'gt_key'` | Cookie name for storing the access key |
| `cookieDays` | `number` | `30` | Cookie max-age in days |
| `iterations` | `number` | `100000` | PBKDF2 iterations |
| `saltLen` | `number` | `16` | Random salt length in bytes |
| `ivLen` | `number` | `12` | AES-GCM IV length in bytes |
| `algorithm` | `string` | `'aes-256-gcm'` | Encryption algorithm (must match key size) |
| `envKey` | `string` | `'ENCRYPTION_KEY'` | Environment variable name for the encryption secret |
| `distDir` | `string` | `'dist'` | Output directory relative to project root |
| `assetsDir` | `string` | `'dist/assets'` | Assets directory (where JS bundles are placed) |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ENCRYPTION_KEY` | Secret used to derive the AES encryption key. If unset, the plugin skips encryption (dev mode). |

Consumers access the site via `https://example.com/?key=<ENCRYPTION_KEY>`. The key is stored in a `gt_key` cookie for 30 days (SameSite=Strict, Secure).

## Caveats

- **Service Worker required** — Code splitting support relies on a Service Worker to intercept and decrypt JS chunks at fetch time. The browser must support Service Workers (`navigator.serviceWorker`).
- **Cache busting** — Each build generates a random salt; the bootstrap appends `?v=<salt-hash>` to the JS URL to prevent stale cache serving wrong encryption.
- **Secure context** — The `Secure` cookie flag requires HTTPS. Local dev (`http://localhost`) needs manual override or testing on a Netlify deploy preview.
