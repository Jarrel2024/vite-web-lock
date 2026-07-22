export interface EncryptPluginOptions {
  cookieName?: string
  cookieDays?: number
  iterations?: number
  saltLen?: number
  ivLen?: number
  algorithm?: string
  envKey?: string
  distDir?: string
  assetsDir?: string
}

export function encryptPlugin(options?: EncryptPluginOptions): import('vite').Plugin

export default encryptPlugin
