const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  return pool;
}

async function close() {
  if (pool) { await pool.end(); pool = null; }
}

module.exports = { getPool, close };
