require('dotenv').config()
const { Pool } = require('pg')
const fs = require('fs')
const path = require('path')

const connectionString = process.env.DATABASE_URL
const schema = process.env.PGSCHEMA || 'spe'

const pool = connectionString
  ? new Pool({ connectionString })
  : new Pool({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432', 10),
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
      database: process.env.PGDATABASE || 'spe',
    })

// Define o search_path para o schema desejado em cada conexão do pool
pool.on('connect', async (client) => {
  try {
    await client.query(`SET search_path TO ${schema}, public`)
  } catch (e) {
    console.error('Failed to set search_path', e)
  }
})

async function initDb() {
  // Lê e executa comandos SQL do arquivo init.sql
  const sqlPath = path.join(__dirname, 'init.sql')
  const raw = fs.readFileSync(sqlPath, 'utf8')
  const content = raw.replace(/\{\{schema\}\}/g, schema)
  const commands = content
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0)

  for (const cmd of commands) {
    await pool.query(cmd)
  }
}

function query(text, params) {
  return pool.query(text, params)
}

module.exports = { pool, query, initDb }