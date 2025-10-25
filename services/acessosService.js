const { v4: uuidv4 } = require('uuid')
const { query } = require('../db')

async function listAcessos(processoId) {
  const { rows } = await query(
    `SELECT a.id,
            a.tipo,
            a.valor,
            CASE WHEN a.tipo = 'PARTE' THEN a.valor ELSE NULL END AS "parteId",
            cp.nome AS "parteNome",
            cp.documento AS "parteDocumento",
            a.criado_em AS "criadoEm"
      FROM processo_acessos a
      LEFT JOIN processo_partes pp ON a.tipo = 'PARTE' AND pp.id::text = a.valor
      LEFT JOIN cadastro_partes cp ON cp.id = pp.cadastro_parte_id
      WHERE a.processo_id = $1
      ORDER BY a.criado_em ASC`,
    [processoId],
  )
  return rows
}

async function addAcesso(processoId, { tipo, valor, parteId }) {
  const t = String(tipo || '').toUpperCase()
  if (!['SETOR', 'USUARIO', 'PARTE'].includes(t)) {
    const err = new Error('tipo inválido')
    err.code = 400
    throw err
  }
  if ((t === 'SETOR' || t === 'USUARIO') && !valor) {
    const err = new Error('valor é obrigatório')
    err.code = 400
    throw err
  }
  if (t === 'PARTE' && !parteId) {
    const err = new Error('parteId é obrigatório para tipo PARTE')
    err.code = 400
    throw err
  }

  const proc = await query(`SELECT id FROM processos WHERE id = $1`, [processoId])
  if (proc.rows.length === 0) {
    const err = new Error('Processo não encontrado')
    err.code = 404
    throw err
  }

  const acessoId = uuidv4()

  if (t === 'PARTE') {
    const { rows: partRows } = await query(
      `SELECT pp.id
         FROM processo_partes pp
        WHERE pp.id = $1 AND pp.processo_id = $2`,
      [parteId, processoId],
    )
    if (!partRows.length) {
      const err = new Error('Parte não encontrada no processo')
      err.code = 400
      throw err
    }
    await query(
      `INSERT INTO processo_acessos (id, processo_id, tipo, valor)
       VALUES ($1, $2, $3, $4)`,
      [acessoId, processoId, t, parteId],
    )
    return { id: acessoId }
  }

  await query(
    `INSERT INTO processo_acessos (id, processo_id, tipo, valor)
     VALUES ($1, $2, $3, $4)`,
    [acessoId, processoId, t, valor],
  )

  return { id: acessoId }
}

async function removeAcesso(processoId, acessoId) {
  const { rowCount } = await query(
    `DELETE FROM processo_acessos WHERE id = $1 AND processo_id = $2`,
    [acessoId, processoId],
  )
  if (rowCount === 0) {
    const err = new Error('Acesso não encontrado')
    err.code = 404
    throw err
  }
  return { ok: true }
}

module.exports = {
  listAcessos,
  addAcesso,
  removeAcesso,
}
