// Placeholders replaced by encryptPlugin at build time
var COOKIE_NAME = "__COOKIE__";
var COOKIE_DAYS = __DAYS__;
var SALT_BASE64 = "__SALT__";
var ENTRY_URL = "__ENTRY__?v=__CACHE__";
var IV_LEN = __IV_LEN__;
var PBKDF2_ITERATIONS = __ITERATIONS__;

function getCookie(name) {
  var match = document.cookie.match("(^|;)\\s*" + name + "\\s*=\\s*([^;]+)");
  return match ? match.pop() : "";
}

function setCookie(name, value) {
  var expire = new Date();
  expire.setTime(expire.getTime() + COOKIE_DAYS * 864e5);
  document.cookie =
    name +
    "=" +
    value +
    ";path=/;SameSite=Strict;max-age=" +
    COOKIE_DAYS * 86400 +
    ";secure";
}

function getKey() {
  var params = new URLSearchParams(location.search);
  var key = params.get("key");
  if (key) {
    setCookie(COOKIE_NAME, key);
    history.replaceState(null, "", location.pathname);
    return key;
  }
  return getCookie(COOKIE_NAME);
}

function showVerifyMessage() {
  var html =
    '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#1a1a2e;color:#e0e0e0;font-family:sans-serif;font-size:18px">__VERIFY_TEXT__</div>';
  if (document.body) {
    document.body.innerHTML = html;
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      document.body.innerHTML = html;
    });
  }
}

function deriveAesKey(password, saltBytes, iterations) {
  return crypto.subtle
    .importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
      "deriveKey",
    ])
    .then(function (baseKey) {
      return crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          salt: saltBytes,
          iterations: iterations,
          hash: "SHA-256",
        },
        baseKey,
        { name: "AES-GCM", length: 256 },
        true,
        ["decrypt"],
      );
    });
}

function exportKeyBase64(aesKey) {
  return crypto.subtle.exportKey("raw", aesKey).then(function (rawKey) {
    var bytes = new Uint8Array(rawKey);
    var binary = "";
    for (var i = 0; i < bytes.length; i++) {
      binary += String.fromCodePoint(bytes[i]);
    }
    return btoa(binary);
  });
}

function registerServiceWorker(cacheKey) {
  return navigator.serviceWorker
    .register("sw.js?v=" + cacheKey)
    .then(function () {
      return navigator.serviceWorker.ready;
    })
    .then(function () {
      if (!navigator.serviceWorker.controller) {
        return new Promise(function (resolve) {
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            resolve,
            { once: true },
          );
        });
      }
    });
}

function sendKeyToWorker(keyBase64) {
  return new Promise(function (resolve, reject) {
    var channel = new MessageChannel();
    var timeout = setTimeout(function () {
      reject(new Error("timeout"));
    }, 5000);
    channel.port1.onmessage = function () {
      clearTimeout(timeout);
      resolve();
    };
    navigator.serviceWorker.controller.postMessage(
      { type: "key", key: keyBase64 },
      [channel.port2],
    );
  });
}

function injectEntryScript() {
  var script = document.createElement("script");
  script.type = "module";
  script.src = ENTRY_URL;
  document.body.appendChild(script);
}

// --- Main ---
var key = getKey();

if (!key) {
  showVerifyMessage();
  return;
}

var saltBytes = Uint8Array.from(atob(SALT_BASE64), function (c) {
  return c.charCodeAt(0);
});

deriveAesKey(key, saltBytes, PBKDF2_ITERATIONS)
  .then(exportKeyBase64)
  .then(function (keyBase64) {
    return registerServiceWorker("__CACHE__").then(function () {
      return sendKeyToWorker(keyBase64);
    });
  })
  .then(injectEntryScript)
  .catch(function () {
    showVerifyMessage();
  });
