// src/runtime/transport/http.js

/**
 * Existing function — KEPT AS-IS
 * Backward compatible
 */
async function callExternalResolver(resolver, action, context) {
  const { endpoint, timeout_ms = 30000 } = resolver.manifest;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout_ms);

  try {
    const res = await fetch(`${endpoint}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        context,
        resolver: resolver.resolverName,
        workflow: context.workflow_name,
        timestamp: new Date().toISOString()
      }),
      signal: controller.signal
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    if (json?.error) throw new Error(json.error.message);

    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ✅ NEW: Class wrapper expected by RuntimeAPI
 */
class HttpTransport {
  constructor({ verbose = false } = {}) {
    this.verbose = verbose;
  }

  async call(resolver, action, context) {
    if (this.verbose) {
      console.log(
        `[transport:http] calling external resolver "${resolver.resolverName}"`
      );
    }
    return callExternalResolver(resolver, action, context);
  }
}

/**
 * ✅ EXPORTS
 * - default export: class (for RuntimeAPI)
 * - named export: function (for existing code)
 */
module.exports = HttpTransport;
module.exports.callExternalResolver = callExternalResolver;
