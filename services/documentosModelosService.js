const { query } = require('../db')

async function listModelos({ tipoId } = {}) {
  const params = []
  let where = ''
  if (tipoId) {
    params.push(tipoId)
    where = 'WHERE dm.tipo_id = $1'
  }
  const { rows } = await query(
    `SELECT dm.id,
            dm.nome,
            dm.tipo_id AS "tipoId",
            td.nome AS "tipoNome",
            dm.conteudo,
            dm.criado_em AS "criadoEm"
       FROM documento_modelos dm
       LEFT JOIN tipos_documento td ON td.id = dm.tipo_id
       ${where}
      ORDER BY dm.nome`,
    params,
  )
  return rows
}

async function getModeloById(id) {
  const { rows } = await query(
    `SELECT dm.id,
            dm.nome,
            dm.tipo_id AS "tipoId",
            td.nome AS "tipoNome",
            dm.conteudo,
            dm.criado_em AS "criadoEm"
       FROM documento_modelos dm
       LEFT JOIN tipos_documento td ON td.id = dm.tipo_id
      WHERE dm.id = $1`,
    [id],
  )
  return rows.length ? rows[0] : null
}

module.exports = { listModelos, getModeloById }