const PgVectorBackend = require("./backends/pgvector");

/**
 * Vector backend factory.
 * Kernel never imports pgvector directly.
 */
function createVectorBackend(context = {}) {
  // Default backend: pgvector
  if (!context.POSTGRES_URL) {
    throw new Error(
      "No vector backend available: POSTGRES_URL not provided"
    );
  }

  return new PgVectorBackend({
    POSTGRES_URL: context.POSTGRES_URL,
    table: context.vector_table,
    dimensions: context.vector_dimensions
  });
}

module.exports = {
  createVectorBackend
};
