const { v4: uuidv4 } = require('uuid')
const { query } = require('../db')

async function listChaves(processoId) {
  const { rows } = await query(
    `SELECT id, parte_id AS "parteId", chave, ativo, criado_em AS "criadoEm"
       FROM processo_acesso_chaves
      WHERE processo_id = $1
      ORDER BY criado_em ASC`,
    [processoId],
  )
  return rows
}

async function createChave({ processoId, parteId }) {
  if (!parteId) {
    const err = new Error('parteId é obrigatório')
    err.code = 400
    throw err
  }

  const proc = await query(`SELECT id FROM processos WHERE id = $1`, [processoId])
  if (proc.rows.length === 0) {
    const err = new Error('Processo não encontrado')
    err.code = 404
    throw err
  }

  const parte = await query(
    `SELECT id FROM processo_partes WHERE id = $1 AND processo_id = $2`,
    [parteId, processoId],
  )
  if (parte.rows.length === 0) {
    const err = new Error('Parte não encontrada')
    err.code = 404
    throw err
  }

  const chaveId = uuidv4()
  const chave = uuidv4()
  await query(
    `INSERT INTO processo_acesso_chaves (id, processo_id, parte_id, chave, ativo)
     VALUES ($1, $2, $3, $4, TRUE)`,
    [chaveId, processoId, parteId, chave],
  )

  return { id: chaveId, chave }
}

async function revokeChave({ processoId, chaveId }) {
  const { rowCount } = await query(
    `UPDATE processo_acesso_chaves SET ativo = FALSE WHERE id = $1 AND processo_id = $2`,
    [chaveId, processoId],
  )
  if (rowCount === 0) {
    const err = new Error('Chave não encontrada')
    err.code = 404
    throw err
  }
  return { ok: true }
}

module.exports = {
  listChaves,
  createChave,
  revokeChave,
}