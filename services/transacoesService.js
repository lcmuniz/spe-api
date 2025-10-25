const { query } = require('../db')

async function rollback() {
  try {
    await query('ROLLBACK')
  } catch (_e) {
    // Ignora erro de ROLLBACK
  }
}

async function beginTransaction() {
  await query('BEGIN')
}

async function commitTransaction() {
  await query('COMMIT')
}

module.exports = { rollback, beginTransaction, commitTransaction }