const { v4: uuidv4 } = require('uuid')
const { query } = require('../db')

async function auditLog(req, { acao, usuarioLogin, entidade, entidadeId, detalhes }) {
  try {
    const id = uuidv4()
    const ip = (req.headers['x-forwarded-for'] || req.connection.remoteAddress || '').toString()
    const user_agent = (req.headers['user-agent'] || '').toString()
    const rota = req.originalUrl || req.url

    let detalhesOut = detalhes
    if (detalhes && typeof detalhes === 'object' && !Array.isArray(detalhes)) {
      const d = { ...detalhes }
      if (d.cargo === null || d.cargo === undefined || d.cargo === '') {
        delete d.cargo
      }
      detalhesOut = d
    }

    await query(
      `INSERT INTO auditoria (id, acao, usuario_login, entidade, entidade_id, detalhes, ip, user_agent, rota)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        acao,
        usuarioLogin || null,
        entidade || null,
        entidadeId || null,
        detalhesOut || null,
        ip,
        user_agent,
        rota,
      ],
    )
  } catch (e) {
    console.error('Falha ao registrar auditoria:', e)
  }
}

module.exports = { auditLog }