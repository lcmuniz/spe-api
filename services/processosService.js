const { v4: uuidv4 } = require('uuid')
const { query } = require('../db')
const { beginTransaction, commitTransaction } = require('./transacoesService')

function genNumero() {
  const now = new Date()
  const pad = (n, l = 2) => String(n).padStart(l, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(Math.floor(Math.random() * 1000), 3)}`
}

async function listarPartesDoProcesso(processoId) {
  const { rows } = await query(
    `SELECT pp.id,
            cp.tipo,
            cp.nome,
            cp.documento,
            pp.papel,
            pp.cadastro_parte_id AS "cadastroParteId"
       FROM processo_partes pp
       LEFT JOIN cadastro_partes cp ON cp.id = pp.cadastro_parte_id
      WHERE pp.processo_id = $1
      ORDER BY pp.id`,
    [processoId],
  )
  return rows
}

async function getProcessoById(id) {
  const queryText = `
    SELECT p.id,
           p.numero,
           p.assunto,
           COALESCE(tp.nome, p.tipo_id) AS "tipo",
           p.tipo_id AS "tipoId",
           p.nivel_acesso AS "nivelAcesso",
           p.base_legal AS "baseLegal",
           p.observacoes,
           p.status,
           p.prioridade,
           p.prazo,
           p.setor_atual AS setor,
           p.atribuido_usuario AS "atribuidoA",
           p.criado_em AS "criadoEm",
           COALESCE((SELECT MAX(t.data) FROM tramites t WHERE t.processo_id = p.id), p.criado_em) AS "ultimaMovimentacao"
    FROM processos p
    LEFT JOIN tipos_processo tp ON tp.id = p.tipo_id
    WHERE p.id = $1
  `
  const { rows } = await query(queryText, [id])
  if (!rows.length) return null
  const partes = await listarPartesDoProcesso(id)
  return { ...rows[0], partes }
}

async function createProcesso({
  assunto,
  tipo,
  tipoId,
  nivelAcesso,
  baseLegal,
  observacoes,
  partes = [],
  documentosIds = [],
  executadoPor,
  usuario,
}) {
  if (!assunto) throw new Error('Assunto é obrigatório')
  if (nivelAcesso && nivelAcesso !== 'Público' && !baseLegal) {
    const err = new Error('Base legal é obrigatória para acesso restrito/sigiloso')
    err.code = 400
    throw err
  }
  const numero = genNumero()
  const id = uuidv4()
  const criadorLogin = executadoPor || usuario || null

  await beginTransaction()
  await query(
    `INSERT INTO processos (id, numero, assunto, nivel_acesso, base_legal, observacoes, atribuido_usuario, tipo_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      numero,
      assunto,
      nivelAcesso || 'Público',
      baseLegal || null,
      observacoes || '',
      criadorLogin || null,
      tipoId || null,
    ],
  )

  for (const parte of partes) {
    const parteId = uuidv4()
    if (parte.parteId) {
      // Vincula a um cadastro existente
      const cad = await query(`SELECT id FROM cadastro_partes WHERE id = $1`, [parte.parteId])
      if (!cad.rows.length) {
        const err = new Error('Parte de cadastro não encontrada')
        err.code = 404
        throw err
      }
      await query(
        `INSERT INTO processo_partes (id, processo_id, papel, cadastro_parte_id)
         VALUES ($1, $2, $3, $4)`,
        [parteId, id, parte.papel || null, parte.parteId],
      )
    } else {
      // Inserção manual: cria cadastro mínimo e vincula
      const cadId = uuidv4()
      await query(
        `INSERT INTO cadastro_partes (id, tipo, nome, documento)
         VALUES ($1, $2, $3, $4)`,
        [cadId, parte.tipo || null, parte.nome || '', parte.documento || null],
      )
      await query(
        `INSERT INTO processo_partes (id, processo_id, papel, cadastro_parte_id)
         VALUES ($1, $2, $3, $4)`,
        [parteId, id, parte.papel || null, cadId],
      )
    }
  }
  for (const docId of documentosIds) {
    await query(
      `INSERT INTO processo_documentos (processo_id, documento_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [id, docId],
    )
  }

  // Andamento inicial: origem = destino = setor atual, motivo fixo
  const { rows: setorRows } = await query(`SELECT setor_atual FROM processos WHERE id = $1`, [id])
  const setorAtual = setorRows?.[0]?.setor_atual || 'PROTOCOLO'
  const tramiteId = uuidv4()
  await query(
    `INSERT INTO tramites (id, processo_id, origem_setor, destino_setor, motivo, prioridade, prazo, origem_usuario)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [tramiteId, id, setorAtual, setorAtual, 'Andamento inicial', null, null, criadorLogin || null],
  )

  await commitTransaction()

  const interessadoRow = await query(
    `SELECT cp.nome
       FROM processo_partes pp
       LEFT JOIN cadastro_partes cp ON cp.id = pp.cadastro_parte_id
      WHERE pp.processo_id = $1
      ORDER BY pp.id
      LIMIT 1`,
    [id],
  )
  const processoView = {
    id,
    numero,
    assunto,
    tipo: tipo || 'Processo',
    nivelAcesso: nivelAcesso || 'Público',
    baseLegal: baseLegal || null,
    observacoes: observacoes || '',
    interessado: interessadoRow.rows[0]?.nome || null,
    setor: 'PROTOCOLO',
    status: 'Em instrução',
    prioridade: 'Normal',
    criadoEm: new Date().toISOString(),
    atribuidoA: criadorLogin || null,
  }
  return processoView
}

async function updateDados(id, { assunto, nivelAcesso, observacoes, baseLegal, tipoId }) {
  const atual = await getProcessoById(id)
  if (!atual) {
    const err = new Error('Processo não encontrado')
    err.status = 404
    throw err
  }

  if (nivelAcesso && nivelAcesso !== 'Público' && !baseLegal) {
    const err = new Error('Base legal obrigatória para nível de acesso não público')
    err.status = 400
    throw err
  }

  const novaBaseLegal = nivelAcesso === 'Público' ? null : baseLegal

  await query(
    `UPDATE processos
       SET assunto = COALESCE($2, assunto),
           nivel_acesso = COALESCE($3, nivel_acesso),
           observacoes = COALESCE($4, observacoes),
           base_legal = COALESCE($5, base_legal),
           tipo_id = COALESCE($6, tipo_id)
     WHERE id = $1`,
    [
      id,
      assunto ?? null,
      nivelAcesso ?? null,
      observacoes ?? null,
      novaBaseLegal ?? null,
      tipoId ?? null,
    ],
  )

  const { rows } = await query(
    `SELECT p.id,
            p.numero,
            p.assunto,
            COALESCE(tp.nome, p.tipo_id) AS "tipo",
            p.tipo_id AS "tipoId",
            p.nivel_acesso AS "nivelAcesso",
            p.base_legal AS "baseLegal",
            p.observacoes,
            p.status,
            p.prioridade,
            p.prazo,
            p.setor_atual AS setor,
            p.atribuido_usuario AS "atribuidoA",
            p.criado_em AS "criadoEm",
            COALESCE((SELECT MAX(t.data) FROM tramites t WHERE t.processo_id = p.id), p.criado_em) AS "ultimaMovimentacao"
       FROM processos p
       LEFT JOIN tipos_processo tp ON tp.id = p.tipo_id
      WHERE p.id = $1`,
    [id],
  )

  return rows[0]
}

async function atribuir(id, { usuario, executadoPor }) {
  if (!usuario) {
    const err = new Error('Usuário de destino é obrigatório')
    err.code = 400
    throw err
  }
  if (!executadoPor) {
    const err = new Error('Usuário executor é obrigatório')
    err.code = 400
    throw err
  }
  const proc = await query(
    `SELECT setor_atual, atribuido_usuario, nivel_acesso FROM processos WHERE id = $1`,
    [id],
  )
  if (proc.rows.length === 0) {
    const err = new Error('Processo não encontrado')
    err.code = 404
    throw err
  }
  const setorAtual = String(proc.rows[0].setor_atual || '').toUpperCase()
  const atualAtribuido = proc.rows[0].atribuido_usuario || null
  if (atualAtribuido && String(atualAtribuido) !== String(executadoPor)) {
    const err = new Error('Você só pode atribuir processos atribuídos a você ou sem responsável')
    err.code = 403
    throw err
  }
  const { rows: urows } = await query(`SELECT setor FROM usuarios WHERE login = $1`, [usuario])
  if (urows.length === 0) {
    const err = new Error('Usuário não encontrado')
    err.code = 400
    throw err
  }
  const setorUsuario = String(urows[0].setor || '').toUpperCase()
  if (setorUsuario !== setorAtual.toUpperCase()) {
    const err = new Error('Usuário não pertence ao setor atual do processo')
    err.code = 400
    throw err
  }

  // Se processo for restrito/sigiloso, o destino (usuário ou setor) precisa ter acesso
  const nivel = String(proc.rows[0].nivel_acesso || '').toLowerCase()
  if (nivel === 'restrito' || nivel === 'sigiloso') {
    const { rows: accessRows } = await query(
      `SELECT 1 FROM processo_acessos
        WHERE processo_id = $1
          AND (
            (tipo = 'USUARIO' AND UPPER(valor) = UPPER($2)) OR
            (tipo = 'SETOR'   AND UPPER(valor) = UPPER($3))
          )
        LIMIT 1`,
      [id, usuario, setorUsuario],
    )
    if (!accessRows.length) {
      const err = new Error('Destino não possui acesso ao processo restrito/sigiloso')
      err.code = 403
      throw err
    }
  }

  const { rowCount } = await query(`UPDATE processos SET atribuido_usuario = $1 WHERE id = $2`, [
    usuario || null,
    id,
  ])
  if (rowCount === 0) {
    const err = new Error('Processo não encontrado')
    err.code = 404
    throw err
  }
  const { rows } = await query(
    `SELECT id, numero, assunto, status, prioridade, prazo, nivel_acesso AS "nivelAcesso", setor_atual AS setor, atribuido_usuario AS "atribuidoA", criado_em AS "criadoEm", COALESCE((SELECT MAX(data) FROM tramites WHERE processo_id = $1), criado_em) AS "ultimaMovimentacao" FROM processos WHERE id = $1`,
    [id],
  )
  return { processo: rows[0], detalhes: { de: atualAtribuido || null, para: usuario } }
}

async function priorizar(id, { prioridade, executadoPor }) {
  const allowed = ['Baixa', 'Normal', 'Alta', 'Urgente']
  if (!prioridade || !allowed.includes(prioridade)) {
    const err = new Error('Prioridade inválida')
    err.code = 400
    throw err
  }
  if (!executadoPor) {
    const err = new Error('Usuário executor é obrigatório')
    err.code = 400
    throw err
  }

  const { rows: procRows } = await query(`SELECT atribuido_usuario FROM processos WHERE id = $1`, [
    id,
  ])
  if (procRows.length === 0) {
    const err = new Error('Processo não encontrado')
    err.code = 404
    throw err
  }
  const atribuidoAtual = procRows[0].atribuido_usuario || null
  if (atribuidoAtual && String(atribuidoAtual) !== String(executadoPor)) {
    const err = new Error(
      'Você só pode definir prioridade de processos atribuídos a você ou sem responsável',
    )
    err.code = 403
    throw err
  }

  const { rowCount } = await query(`UPDATE processos SET prioridade = $2 WHERE id = $1`, [
    id,
    prioridade,
  ])
  if (rowCount === 0) {
    const err = new Error('Processo não encontrado')
    err.code = 404
    throw err
  }

  const { rows } = await query(
    `SELECT id, numero, assunto, status, prioridade, prazo, nivel_acesso AS "nivelAcesso", setor_atual AS setor, atribuido_usuario AS "atribuidoA", criado_em AS "criadoEm", COALESCE((SELECT MAX(data) FROM tramites WHERE processo_id = $1), criado_em) AS "ultimaMovimentacao" FROM processos WHERE id = $1`,
    [id],
  )
  return { processo: rows[0], detalhes: { prioridade } }
}

async function tramitar(id, { destinoSetor, usuario, motivo, prioridade, prazo }) {
  if (!usuario) {
    const err = new Error('Usuário executor é obrigatório')
    err.code = 400
    throw err
  }
  const { rows: procRows } = await query(
    `SELECT setor_atual, atribuido_usuario FROM processos WHERE id = $1`,
    [id],
  )
  if (procRows.length === 0) {
    const err = new Error('Processo não encontrado')
    err.code = 404
    throw err
  }
  const origem = procRows[0].setor_atual
  const atribuidoAtual = procRows[0].atribuido_usuario
  if (String(atribuidoAtual || '') !== String(usuario)) {
    const err = new Error('Você só pode tramitar processos atribuídos a você')
    err.code = 403
    throw err
  }
  const tramiteId = uuidv4()
  await beginTransaction()
  await query(
    `INSERT INTO tramites (id, processo_id, origem_setor, destino_setor, motivo, prioridade, prazo, origem_usuario)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      tramiteId,
      id,
      origem,
      destinoSetor,
      motivo || null,
      prioridade || null,
      prazo || null,
      usuario,
    ],
  )
  await query(
    `UPDATE processos
       SET status = 'Aguardando',
           pendente = TRUE,
           pendente_origem_setor = $3,
           pendente_destino_setor = $1,
           atribuido_usuario = NULL,
           prioridade = COALESCE($4, prioridade),
           prazo = COALESCE($5, prazo)
     WHERE id = $2`,
    [destinoSetor, id, origem, prioridade || null, prazo || null],
  )
  await commitTransaction()
  const { rows } = await query(
    `SELECT id, numero, assunto, status, prioridade, prazo, nivel_acesso AS "nivelAcesso", setor_atual AS setor, atribuido_usuario AS "atribuidoA", criado_em AS "criadoEm" FROM processos WHERE id = $1`,
    [id],
  )
  return {
    processo: rows[0],
    detalhes: {
      origem,
      destino: destinoSetor,
      motivo: motivo || null,
      prioridade: prioridade || null,
      prazo: prazo || null,
      tramiteId,
    },
  }
}

async function listProcessos(q = {}) {
  const where = []
  const params = []

  if (q.numero) {
    params.push(`%${q.numero}%`)
    where.push(`p.numero ILIKE $${params.length}`)
  }
  if (q.assunto) {
    params.push(`%${q.assunto}%`)
    where.push(`p.assunto ILIKE $${params.length}`)
  }
  if (q.interessado) {
    params.push(`%${q.interessado}%`)
    where.push(
      `EXISTS (
         SELECT 1
           FROM processo_partes pp
           LEFT JOIN cadastro_partes cp ON cp.id = pp.cadastro_parte_id
          WHERE pp.processo_id = p.id AND cp.nome ILIKE $${params.length}
       )`,
    )
  }
  if (q.status) {
    params.push(q.status)
    where.push(`p.status = $${params.length}`)
  }
  if (q.prioridade) {
    params.push(q.prioridade)
    where.push(`p.prioridade = $${params.length}`)
  }
  if (q.nivelAcesso) {
    params.push(q.nivelAcesso)
    where.push(`p.nivel_acesso = $${params.length}`)
  }
  if (q.setor) {
    params.push(q.setor)
    where.push(`p.setor_atual = $${params.length}`)
  }
  if (q.pendente === 'true') {
    where.push(`p.pendente = TRUE`)
  }
  if (q.pendenteSetor) {
    params.push(q.pendenteSetor)
    where.push(`p.pendente_destino_setor = $${params.length}`)
  }
  if (q.somenteMeus === 'true' && q.usuario) {
    params.push(q.usuario)
    where.push(`p.atribuido_usuario = $${params.length}`)
  }

  const page = parseInt(q.page || '1', 10)
  const pageSize = parseInt(q.pageSize || '10', 10)
  const offset = (page - 1) * pageSize

  const countSql = `SELECT COUNT(*) FROM processos p ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`
  const { rows: countRows } = await query(countSql, params)
  const total = parseInt(countRows[0]?.count || '0', 10)

  const itemsSql = `
      SELECT
        p.id,
        p.numero,
        p.assunto,
        COALESCE(tp.nome, p.tipo_id) AS "tipo",
        p.status,
        p.prioridade,
        p.prazo AS "prazo",
        p.nivel_acesso AS "nivelAcesso",
        p.setor_atual AS setor,
        p.atribuido_usuario AS "atribuidoA",
        p.pendente AS pendente,
        p.pendente_origem_setor AS "pendenteOrigemSetor",
        p.pendente_destino_setor AS "pendenteDestinoSetor",
        p.criado_em AS "criadoEm",
        COALESCE(
          (SELECT MAX(t.data) FROM tramites t WHERE t.processo_id = p.id),
          p.criado_em
        ) AS "ultimaMovimentacao",
        (
          SELECT cp.nome FROM processo_partes pp
          LEFT JOIN cadastro_partes cp ON cp.id = pp.cadastro_parte_id
          WHERE pp.processo_id = p.id
          ORDER BY pp.id LIMIT 1
        ) AS interessado
      FROM processos p
     LEFT JOIN tipos_processo tp ON tp.id = p.tipo_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY p.criado_em DESC
     LIMIT $${params.length + 1}
     OFFSET $${params.length + 2}
   `
  const { rows } = await query(itemsSql, [...params, pageSize, offset])

  return { total, page, pageSize, items: rows }
}
async function addParte(processoId, { parteId, tipo, nome, documento, papel }) {
  // Se parteId informado, usar dados do cadastro
  if (parteId) {
    const proc = await query(`SELECT id FROM processos WHERE id = $1`, [processoId])
    if (proc.rows.length === 0) {
      const err = new Error('Processo não encontrado')
      err.code = 404
      throw err
    }
    const cad = await query(`SELECT id, tipo, nome, documento FROM cadastro_partes WHERE id = $1`, [
      parteId,
    ])
    if (cad.rows.length === 0) {
      const err = new Error('Parte de cadastro não encontrada')
      err.code = 404
      throw err
    }
    const { id: cadId } = cad.rows[0]
    const procParteId = uuidv4()
    await query(
      `INSERT INTO processo_partes (id, processo_id, papel, cadastro_parte_id)
     VALUES ($1, $2, $3, $4)`,
      [procParteId, processoId, papel || null, cadId],
    )
    const { rows } = await query(
      `SELECT pp.id,
            cp.tipo,
            cp.nome,
            cp.documento,
            pp.papel,
            pp.cadastro_parte_id AS "cadastroParteId"
       FROM processo_partes pp
       LEFT JOIN cadastro_partes cp ON cp.id = pp.cadastro_parte_id
      WHERE pp.id = $1`,
      [procParteId],
    )
    return rows[0]
  }

  // Inserção manual: cria cadastro mínimo e vincula
  if (!nome) {
    const err = new Error('Nome da parte é obrigatório')
    err.code = 400
    throw err
  }
  const proc = await query(`SELECT id FROM processos WHERE id = $1`, [processoId])
  if (proc.rows.length === 0) {
    const err = new Error('Processo não encontrado')
    err.code = 404
    throw err
  }
  const newParteId = uuidv4()
  const newCadId = uuidv4()
  await query(
    `INSERT INTO cadastro_partes (id, tipo, nome, documento)
     VALUES ($1, $2, $3, $4)`,
    [newCadId, tipo || null, nome, documento || null],
  )
  await query(
    `INSERT INTO processo_partes (id, processo_id, papel, cadastro_parte_id)
     VALUES ($1, $2, $3, $4)`,
    [newParteId, processoId, papel || null, newCadId],
  )
  const { rows } = await query(
    `SELECT pp.id,
            cp.tipo,
            cp.nome,
            cp.documento,
            pp.papel,
            pp.cadastro_parte_id AS "cadastroParteId"
       FROM processo_partes pp
       LEFT JOIN cadastro_partes cp ON cp.id = pp.cadastro_parte_id
      WHERE pp.id = $1`,
    [newParteId],
  )
  return rows[0]
}
async function deleteParte(processoId, parteId) {
  const { rows } = await query(
    `SELECT pp.id, cp.nome
       FROM processo_partes pp
       LEFT JOIN cadastro_partes cp ON cp.id = pp.cadastro_parte_id
      WHERE pp.id = $1 AND pp.processo_id = $2`,
    [parteId, processoId],
  )
  if (rows.length === 0) {
    const err = new Error('Parte não encontrada')
    err.code = 404
    throw err
  }
  await query(`DELETE FROM processo_partes WHERE id = $1`, [parteId])
  return { ok: true, nome: rows[0].nome }
}
async function listTramites(processoId) {
  const { rows } = await query(
    `SELECT id,
            origem_setor AS "origemSetor",
            destino_setor AS "destinoSetor",
            motivo,
            prioridade,
            prazo,
            origem_usuario AS "usuario",
            data
       FROM tramites
      WHERE processo_id = $1
      ORDER BY data DESC`,
    [processoId],
  )
  return rows
}
async function consultarPublico(valorRaw, cpf, chave) {
  const valor = decodeURIComponent(String(valorRaw || ''))
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor)

  let processo
  if (!isUuid) {
    const { rows } = await query(
      `SELECT p.id, p.numero, p.assunto, COALESCE(tp.nome, p.tipo_id) AS "tipo", p.nivel_acesso AS "nivelAcesso", p.base_legal AS "baseLegal", p.observacoes, p.status, p.prioridade, p.prazo, p.setor_atual AS setor, p.atribuido_usuario AS "atribuidoA", p.criado_em AS "criadoEm", COALESCE((SELECT MAX(t.data) FROM tramites t WHERE t.processo_id = p.id), p.criado_em) AS "ultimaMovimentacao"
             FROM processos p
             LEFT JOIN tipos_processo tp ON tp.id = p.tipo_id
            /* WHERE numero = $1 */
            WHERE p.numero = $1`,
      [valor],
    )
    processo = rows[0]
  } else {
    const { rows } = await query(
      `SELECT p.id, p.numero, p.assunto, COALESCE(tp.nome, p.tipo_id) AS "tipo", p.nivel_acesso AS "nivelAcesso", p.base_legal AS "baseLegal", p.observacoes, p.status, p.prioridade, p.prazo, p.setor_atual AS setor, p.atribuido_usuario AS "atribuidoA", p.criado_em AS "criadoEm", COALESCE((SELECT MAX(t.data) FROM tramites t WHERE t.processo_id = p.id), p.criado_em) AS "ultimaMovimentacao"
        FROM processos p
        LEFT JOIN tipos_processo tp ON tp.id = p.tipo_id
       /* WHERE id = $1 */
       WHERE p.id = $1`,
      [valor],
    )
    processo = rows[0]
  }

  if (!processo) {
    const err = new Error('Processo não encontrado')
    err.code = 404
    throw err
  }

  const nivel = String(processo.nivelAcesso || '').toLowerCase()
  if (!(nivel === 'público' || nivel === 'publico')) {
    // Processo restrito/sigiloso: exigir CPF e chave da parte
    if (!cpf || !chave) {
      const err = new Error('Processo restrito: CPF e chave são obrigatórios')
      err.code = 403
      throw err
    }
    const { rows: cred } = await query(
      `SELECT 1
         FROM processo_partes pp
         JOIN cadastro_partes cp ON cp.id = pp.cadastro_parte_id
        WHERE pp.processo_id = $1
          AND cp.documento = $2
          AND cp.chave = $3
          AND cp.chave_ativo = TRUE
        LIMIT 1`,
      [processo.id, cpf, chave],
    )
    if (!cred.length) {
      const err = new Error('Credenciais inválidas para acesso ao processo')
      err.code = 403
      throw err
    }
  }

  const processoId = processo.id

  const { rows: docsRows } = await query(
    `SELECT d.id,
            d.titulo,
            d.tipo_id AS "tipoId",
            td.nome AS "tipoNome",
            d.modo,
            d.status,
            d.file_name AS "fileName",
            d.criado_em AS "criadoEm",
            d.assinado_por AS "assinadoPorLogin",
            a.nome AS "assinaturaNome",
            a.cargo AS "assinaturaCargo",
            a.setor AS "assinanteSetor"
       FROM processo_documentos pd
       JOIN documentos d ON d.id = pd.documento_id
       LEFT JOIN tipos_documento td ON td.id = d.tipo_id
       LEFT JOIN usuarios a ON a.login = d.assinado_por
      WHERE pd.processo_id = $1 AND LOWER(d.status) = 'assinado'
      ORDER BY d.criado_em ASC`,
    [processoId],
  )

  const { rows: tramitesRows } = await query(
    `SELECT id,
            origem_setor AS "origemSetor",
            destino_setor AS "destinoSetor",
            motivo,
            prioridade,
            prazo,
            origem_usuario AS "usuario",
            data
       FROM tramites
      WHERE processo_id = $1
      ORDER BY data DESC`,
    [processoId],
  )

  const { rows: partesRows } = await query(
    `SELECT pp.id,
            cp.tipo,
            cp.nome,
            pp.papel
       FROM processo_partes pp
       LEFT JOIN cadastro_partes cp ON cp.id = pp.cadastro_parte_id
      WHERE pp.processo_id = $1
      ORDER BY pp.id`,
    [processoId],
  )

  return {
    capaPublica: {
      id: processo.id,
      numero: processo.numero,
      assunto: processo.assunto,
      status: processo.status,
    },
    andamentosPublicos: tramitesRows,
    documentosPublicos: docsRows,
    partesPublicas: partesRows,
  }
}
async function aceitarPendencia(id, { usuario }) {
  if (!usuario) {
    const err = new Error('Usuário executor é obrigatório')
    err.code = 400
    throw err
  }

  const { rows: procRows } = await query(
    `SELECT pendente, pendente_destino_setor, pendente_origem_setor, setor_atual FROM processos WHERE id = $1`,
    [id],
  )
  if (procRows.length === 0) {
    const err = new Error('Processo não encontrado')
    err.code = 404
    throw err
  }
  const pendente = !!procRows[0].pendente
  const destino = procRows[0].pendente_destino_setor
  if (!pendente || !destino) {
    const err = new Error('Processo não está pendente')
    err.code = 400
    throw err
  }

  const { rows: urows } = await query(`SELECT setor FROM usuarios WHERE login = $1`, [usuario])
  if (urows.length === 0) {
    const err = new Error('Usuário não encontrado')
    err.code = 400
    throw err
  }
  const setorUsuario = String(urows[0].setor || '').toUpperCase()
  if (String(setorUsuario) !== String(destino).toUpperCase()) {
    const err = new Error('Usuário não pertence ao setor de destino da pendência')
    err.code = 403
    throw err
  }

  // Aceitação padrão: move para setor destino, status Em instrução e atribui ao usuário
  const newStatus = 'Em instrução'
  const novoAtribuido = usuario

  await beginTransaction()
  await query(
    `UPDATE processos
       SET pendente = FALSE,
           pendente_destino_setor = NULL,
           pendente_origem_setor = NULL,
           setor_atual = $2,
           status = $3,
           atribuido_usuario = $4
     WHERE id = $1`,
    [id, destino, newStatus, novoAtribuido],
  )
  await commitTransaction()

  const { rows } = await query(
    `SELECT id, numero, assunto, status, prioridade, prazo, nivel_acesso AS "nivelAcesso", setor_atual AS setor, atribuido_usuario AS "atribuidoA", pendente, pendente_origem_setor AS "pendenteOrigemSetor", pendente_destino_setor AS "pendenteDestinoSetor", criado_em AS "criadoEm", COALESCE((SELECT MAX(data) FROM tramites WHERE processo_id = $1), criado_em) AS "ultimaMovimentacao" FROM processos WHERE id = $1`,
    [id],
  )
  return { processo: rows[0], detalhes: { destino } }
}
async function recusarPendencia(id, { usuario, motivo }) {
  if (!usuario) {
    const err = new Error('Usuário executor é obrigatório')
    err.code = 400
    throw err
  }
  if (!motivo) {
    const err = new Error('Motivo é obrigatório para recusa')
    err.code = 400
    throw err
  }

  const { rows: procRows } = await query(
    `SELECT pendente, pendente_destino_setor, pendente_origem_setor FROM processos WHERE id = $1`,
    [id],
  )
  if (procRows.length === 0) {
    const err = new Error('Processo não encontrado')
    err.code = 404
    throw err
  }
  const pendente = !!procRows[0].pendente
  const destino = procRows[0].pendente_destino_setor
  const origem = procRows[0].pendente_origem_setor
  if (!pendente || !destino || !origem) {
    const err = new Error('Processo não está pendente')
    err.code = 400
    throw err
  }

  const { rows: urows } = await query(`SELECT setor FROM usuarios WHERE login = $1`, [usuario])
  if (urows.length === 0) {
    const err = new Error('Usuário não encontrado')
    err.code = 400
    throw err
  }
  const setorUsuario = String(urows[0].setor || '').toUpperCase()
  if (String(setorUsuario) !== String(destino).toUpperCase()) {
    const err = new Error('Usuário não pertence ao setor de destino da pendência')
    err.code = 403
    throw err
  }

  const tramiteId = uuidv4()
  await beginTransaction()
  await query(
    `INSERT INTO tramites (id, processo_id, origem_setor, destino_setor, motivo, origem_usuario)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tramiteId, id, destino, origem, motivo, usuario],
  )
  await query(
    `UPDATE processos
       SET pendente = TRUE,
           pendente_destino_setor = $2,
           pendente_origem_setor = $3,
           atribuido_usuario = NULL,
           status = 'Aguardando'
     WHERE id = $1`,
    [id, origem, destino],
  )
  await commitTransaction()

  const { rows } = await query(
    `SELECT id, numero, assunto, status, prioridade, prazo, nivel_acesso AS "nivelAcesso", setor_atual AS setor, atribuido_usuario AS "atribuidoA", pendente, pendente_origem_setor AS "pendenteOrigemSetor", pendente_destino_setor AS "pendenteDestinoSetor", criado_em AS "criadoEm", COALESCE((SELECT MAX(data) FROM tramites WHERE processo_id = $1), criado_em) AS "ultimaMovimentacao" FROM processos WHERE id = $1`,
    [id],
  )

  return { processo: rows[0], detalhes: { origem, destino, motivo, tramiteId } }
}
async function arquivar(id, { usuario }) {
  if (!usuario) {
    const err = new Error('Usuário executor é obrigatório')
    err.code = 400
    throw err
  }
  const { rows: procRows } = await query(
    `SELECT status, pendente, setor_atual, atribuido_usuario FROM processos WHERE id = $1`,
    [id],
  )
  if (procRows.length === 0) {
    const err = new Error('Processo não encontrado')
    err.code = 404
    throw err
  }
  const p = procRows[0]
  if (p.pendente) {
    const err = new Error('Processo pendente não pode ser arquivado')
    err.code = 400
    throw err
  }
  if (String(p.status || '') === 'Arquivado') {
    const err = new Error('Processo já está arquivado')
    err.code = 400
    throw err
  }
  if (String(p.atribuido_usuario || '') !== String(usuario)) {
    const err = new Error('Você só pode arquivar processos atribuídos a você')
    err.code = 403
    throw err
  }

  await query(`UPDATE processos SET status = 'Arquivado', atribuido_usuario = NULL WHERE id = $1`, [
    id,
  ])
  const { rows } = await query(
    `SELECT id, numero, assunto, status, prioridade, prazo, nivel_acesso AS "nivelAcesso", setor_atual AS setor, atribuido_usuario AS "atribuidoA", criado_em AS "criadoEm", COALESCE((SELECT MAX(data) FROM tramites WHERE processo_id = $1), criado_em) AS "ultimaMovimentacao" FROM processos WHERE id = $1`,
    [id],
  )
  return { processo: rows[0], detalhes: { acao: 'Arquivar' } }
}
module.exports = {
  getProcessoById,
  createProcesso,
  updateDados,
  atribuir,
  priorizar,
  tramitar,
  listProcessos,
  addParte,
  deleteParte,
  consultarPublico,
  aceitarPendencia,
  recusarPendencia,
  listTramites,
  arquivar,
}
