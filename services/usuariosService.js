const { v4: uuidv4 } = require('uuid')
const { query } = require('../db')

async function getUsuarios({ setor, login }) {
  if (login) {
    const { rows } = await query(
      `SELECT u.login AS id,
              u.login,
              u.nome,
              u.cargo,
              u.setor AS "setorId",
              s.sigla AS "setorSigla",
              s.nome AS "setorNome"
         FROM usuarios u
         LEFT JOIN setores s ON s.sigla = u.setor
        WHERE u.login = $1`,
      [login],
    )
    return rows.length ? rows[0] : null
  }

  const params = []
  let where = ''
  if (setor) {
    params.push(setor)
    where = 'WHERE u.setor = $1'
  }
  const { rows } = await query(
    `SELECT u.login AS id,
            u.login,
            u.nome,
            u.cargo,
            u.setor AS "setorId",
            s.sigla AS "setorSigla",
            s.nome AS "setorNome"
       FROM usuarios u
       LEFT JOIN setores s ON s.sigla = u.setor
       ${where}
      ORDER BY u.nome ASC`,
    params,
  )
  return rows
}

async function upsertUsuario({ login, nome, setor, cargo }) {
  if (!login || !nome) {
    const err = new Error('login e nome são obrigatórios')
    err.code = 400
    throw err
  }

  const { rows: existingRows } = await query(`SELECT login FROM usuarios WHERE login = $1`, [login])
  const hasSetor = !!(setor && String(setor).trim().length)
  const hasCargo = cargo !== undefined

  if (existingRows.length) {
    if (hasSetor && hasCargo) {
      await query(
        `UPDATE usuarios SET nome = $1, setor = $2, cargo = $3 WHERE login = $4`,
        [nome, setor, cargo, login],
      )
    } else if (hasSetor && !hasCargo) {
      await query(
        `UPDATE usuarios SET nome = $1, setor = $2 WHERE login = $3`,
        [nome, setor, login],
      )
    } else if (!hasSetor && hasCargo) {
      await query(
        `UPDATE usuarios SET nome = $1, cargo = $2 WHERE login = $3`,
        [nome, cargo, login],
      )
    } else {
      await query(
        `UPDATE usuarios SET nome = $1 WHERE login = $2`,
        [nome, login],
      )
    }
    const { rows } = await query(
      `SELECT u.login AS id,
              u.login,
              u.nome,
              u.cargo,
              u.setor AS "setorId",
              s.sigla AS "setorSigla",
              s.nome AS "setorNome"
         FROM usuarios u
         LEFT JOIN setores s ON s.sigla = u.setor
        WHERE u.login = $1`,
      [login],
    )
    return { acao: 'usuario.upsert', usuario: rows[0] }
  }

  const setorFinal = hasSetor ? setor : 'PROTOCOLO'
  const cargoFinal = hasCargo ? cargo : null
  await query(
    `INSERT INTO usuarios (login, setor, nome, cargo)
     VALUES ($1, $2, $3, $4)`,
    [login, setorFinal, nome, cargoFinal],
  )
  const { rows } = await query(
    `SELECT u.login AS id,
            u.login,
            u.nome,
            u.cargo,
            u.setor AS "setorId",
            s.sigla AS "setorSigla",
            s.nome AS "setorNome"
       FROM usuarios u
       LEFT JOIN setores s ON s.sigla = u.setor
      WHERE u.login = $1`,
    [login],
  )
  return { acao: 'usuario.criar', usuario: rows[0] }
}

async function getUsuariosPorSigla(setorSiglaRaw) {
  const sigla = String(setorSiglaRaw || '').toUpperCase()
  if (!sigla) return []
  const { rows } = await query(
    `SELECT u.login AS id,
            u.login,
            u.nome,
            u.cargo,
            u.setor AS "setorId",
            s.sigla AS "setorSigla",
            s.nome AS "setorNome"
       FROM usuarios u
       LEFT JOIN setores s ON s.sigla = u.setor
      WHERE UPPER(s.sigla) = $1
      ORDER BY u.nome ASC`,
    [sigla],
  )
  return rows
}

module.exports = { getUsuarios, getUsuariosPorSigla, upsertUsuario }