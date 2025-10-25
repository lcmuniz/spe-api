const { query } = require('../db')
const { randomUUID } = require('crypto')

const TABLE = 'cadastro_partes'

function normalizeEstado(uf) {
  const v = String(uf || '')
    .trim()
    .toUpperCase()
  if (!v) return null
  return v.slice(0, 2)
}

function sanitize(data = {}) {
  return {
    id: data.id || null,
    tipo: data.tipo || null,
    nome: data.nome || null,
    documento: data.documento || null,
    email: data.email || null,
    telefone: data.telefone || null,
    endereco_logradouro: data.endereco_logradouro || null,
    endereco_numero: data.endereco_numero || null,
    endereco_complemento: data.endereco_complemento || null,
    endereco_bairro: data.endereco_bairro || null,
    endereco_cidade: data.endereco_cidade || null,
    endereco_estado: normalizeEstado(data.endereco_estado),
    endereco_cep: data.endereco_cep || null,
  }
}

async function listarPartesCadastro({ q, limit = 50, offset = 0 } = {}) {
  const params = []
  let where = ''
  if (q) {
    params.push(`%${q}%`)
    where = 'WHERE nome ILIKE $1 OR documento ILIKE $1'
  }
  const limitIdx = params.length + 1
  const offsetIdx = params.length + 2
  const sql = `SELECT * FROM ${TABLE} ${where} ORDER BY nome ASC LIMIT $${limitIdx} OFFSET $${offsetIdx}`
  params.push(limit)
  params.push(offset)
  const { rows } = await query(sql, params)
  return rows || []
}

async function obterParteCadastro(id) {
  const { rows } = await query(`SELECT * FROM ${TABLE} WHERE id = $1`, [id])
  return rows?.[0] || null
}

async function criarParteCadastro(payload = {}) {
  const data = sanitize(payload)
  const id = data.id || randomUUID()
  const chave = randomUUID()
  const sql = `
    INSERT INTO ${TABLE} (
      id, tipo, nome, documento, email, telefone,
      endereco_logradouro, endereco_numero, endereco_complemento,
      endereco_bairro, endereco_cidade, endereco_estado, endereco_cep,
      chave
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
      $14
    ) RETURNING *
  `
  const params = [
    id,
    data.tipo,
    data.nome,
    data.documento,
    data.email,
    data.telefone,
    data.endereco_logradouro,
    data.endereco_numero,
    data.endereco_complemento,
    data.endereco_bairro,
    data.endereco_cidade,
    data.endereco_estado,
    data.endereco_cep,
    chave,
  ]
  const { rows } = await query(sql, params)
  return rows?.[0] || null
}

async function atualizarParteCadastro(id, payload = {}) {
  const data = sanitize(payload)
  const fields = [
    'tipo',
    'nome',
    'documento',
    'email',
    'telefone',
    'endereco_logradouro',
    'endereco_numero',
    'endereco_complemento',
    'endereco_bairro',
    'endereco_cidade',
    'endereco_estado',
    'endereco_cep',
  ]
  const setParts = []
  const params = []
  fields.forEach((f, idx) => {
    if (typeof data[f] !== 'undefined') {
      setParts.push(`${f} = $${idx + 1}`)
      params.push(data[f])
    }
  })
  if (!setParts.length) {
    const current = await obterParteCadastro(id)
    return current
  }
  params.push(id)
  const sql = `UPDATE ${TABLE} SET ${setParts.join(', ')} WHERE id = $${params.length} RETURNING *`
  const { rows } = await query(sql, params)
  return rows?.[0] || null
}

async function removerParteCadastro(id) {
  // Verifica se existe vínculo em processo_partes pelo cadastro_parte_id
  const links = await query(`SELECT 1 FROM processo_partes WHERE cadastro_parte_id = $1 LIMIT 1`, [id])
  if (links.rows && links.rows.length) {
    const err = new Error('Parte está vinculada a processos e não pode ser excluída')
    err.code = 400
    throw err
  }
  await query(`DELETE FROM ${TABLE} WHERE id = $1`, [id])
  return { ok: true }
}

module.exports = {
  listarPartesCadastro,
  obterParteCadastro,
  criarParteCadastro,
  atualizarParteCadastro,
  removerParteCadastro,
}