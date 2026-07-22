// Placeholders replaced by encryptPlugin at build time
var IV_LEN = __IV_LEN__
var ASSETS_DIR = '__ASSETS_DIR__'

var aesKey = null
var pendingRequests = []

function decryptResponse(request) {
  return fetch(request, { cache: 'no-cache' })
    .then(function (res) {
      return res.arrayBuffer()
    })
    .then(function (buffer) {
      var iv = new Uint8Array(buffer, 0, IV_LEN)
      var ciphertext = new Uint8Array(buffer, IV_LEN)
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, aesKey, ciphertext)
    })
    .then(function (plaintext) {
      return new Response(plaintext, {
        headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
      })
    })
    .catch(function () {
      return new Response('Decryption failed', { status: 500 })
    })
}

function importAesKey(rawKeyBase64) {
  var rawBytes = Uint8Array.from(atob(rawKeyBase64), function (c) {
    return c.charCodeAt(0)
  })
  return crypto.subtle.importKey('raw', rawBytes, { name: 'AES-GCM', length: 256 }, false, [
    'decrypt',
  ])
}

// --- Service Worker lifecycle ---

self.addEventListener('install', function () {
  self.skipWaiting()
})

self.addEventListener('activate', function (event) {
  event.waitUntil(clients.claim())
})

// --- Receive key from bootstrap script ---

self.addEventListener('message', function (event) {
  if (event.data.type === 'key' && event.data.key) {
    importAesKey(event.data.key)
      .then(function (key) {
        aesKey = key
        pendingRequests.forEach(function (fn) {
          fn()
        })
        pendingRequests = []
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage('ready')
        }
      })
      .catch(function () {
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ error: 'import failed' })
        }
      })
  }
})

// --- Intercept JS asset requests and decrypt on-the-fly ---

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url)
  var isJsAsset =
    url.pathname.indexOf('/' + ASSETS_DIR + '/') >= 0 && url.pathname.endsWith('.js')

  if (!isJsAsset) {
    return
  }

  if (aesKey) {
    event.respondWith(decryptResponse(event.request))
  } else {
    event.respondWith(
      new Promise(function (resolve) {
        pendingRequests.push(function () {
          resolve(decryptResponse(event.request))
        })
      })
    )
  }
})
