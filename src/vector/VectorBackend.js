/**
 * Abstract capability-based vector backend.
 * Backends expose what they support via `supports(capability)`
 * and execute via `call(capability, payload, context)`.
 */
class VectorBackend {
  constructor(options = {}) {
    this.options = options;
  }

  /**
   * Check whether a capability is supported.
   * @param {string} capability
   * @returns {boolean}
   */
  supports(capability) {
    return false;
  }

  /**
   * Execute a capability.
   * @param {string} capability
   * @param {object} payload
   * @param {object} context
   */
  async call(capability, payload, context) {
    throw new Error(
      `Vector backend does not support capability: ${capability}`
    );
  }
}

module.exports = VectorBackend;
