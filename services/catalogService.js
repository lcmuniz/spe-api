const { query } = require('../db')

async function listSetores() {
  const { rows } = await query(
    `SELECT s.sigla, s.nome FROM setores s WHERE s.sigla <> 'ARQUIVO' ORDER BY s.nome`,
  )
  return rows
}

async function listAssuntos() {
  const { rows } = await query(`SELECT id, nome FROM assuntos ORDER BY id`)
  return rows
}

async function listTiposProcesso() {
  const { rows } = await query(`SELECT id, nome FROM tipos_processo ORDER BY id`)
  return rows
}

module.exports = { listSetores, listAssuntos, listTiposProcesso }
