const { Pool } = require("pg");
const VectorBackend = require("../VectorBackend");

class PgVectorBackend extends VectorBackend {
  constructor(options = {}) {
    super(options);

    if (!options.POSTGRES_URL) {
      throw new Error("PgVectorBackend requires POSTGRES_URL");
    }

    this.pool = new Pool({
      connectionString: options.POSTGRES_URL
    });

    this.table = options.table || "olang_vectors";
    this.dimensions = options.dimensions;
  }

  supports(capability) {
    return [
      "vector.insert",
      "vector.search"
    ].includes(capability);
  }

  async call(capability, payload) {
    switch (capability) {
      case "vector.insert":
        return this.insert(payload);
      case "vector.search":
        return this.search(payload);
      default:
        return super.call(capability, payload);
    }
  }

  /* ---------------- Internal ops ---------------- */

  async ensureTable() {
    if (this._tableReady) return;

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        id TEXT PRIMARY KEY,
        vector VECTOR(${this.dimensions}),
        content TEXT,
        source TEXT
      );
    `);

    this._tableReady = true;
  }

  async insert({ id, vector, content, source }) {
    await this.ensureTable();

    await this.pool.query(
      `
      INSERT INTO ${this.table} (id, vector, content, source)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id)
      DO UPDATE SET
        vector = EXCLUDED.vector,
        content = EXCLUDED.content,
        source = EXCLUDED.source
      `,
      [id, vector, content, source]
    );

    return { inserted: true };
  }

  async search({ vector, topK = 5, minScore = 0 }) {
    await this.ensureTable();

    const res = await this.pool.query(
      `
      SELECT
        id,
        content,
        source,
        1 - (vector <=> $1) AS score
      FROM ${this.table}
      ORDER BY vector <=> $1
      LIMIT $2
      `,
      [vector, topK]
    );

    return res.rows.filter(r => r.score >= minScore);
  }
}

module.exports = PgVectorBackend;
