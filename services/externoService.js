const { query } = require('../db')
const { v4: uuidv4 } = require('uuid')
const processosService = require('./processosService')

async function listProcessosPorParteCredencial(cpf, chave) {
  const doc = String(cpf || '').trim()
  const key = String(chave || '').trim()
  if (!doc || !key) {
    const err = new Error('CPF e chave são obrigatórios')
    err.code = 400
    throw err
  }

  const { rows } = await query(
    `SELECT p.id,
            p.numero,
            p.assunto,
            p.status,
            COALESCE(tp.nome, p.tipo_id) AS tipo,
            p.nivel_acesso AS "nivelAcesso",
            p.setor_atual AS setor,
            p.atribuido_usuario AS "atribuidoA",
            p.criado_em AS "criadoEm",
            COALESCE((SELECT MAX(t.data) FROM tramites t WHERE t.processo_id = p.id), p.criado_em) AS "ultimaMovimentacao",
            pp.papel AS "meuPapel",
            cp.nome AS "meuNome"
       FROM processos p
       LEFT JOIN tipos_processo tp ON tp.id = p.tipo_id
       JOIN processo_partes pp ON pp.processo_id = p.id
       JOIN cadastro_partes cp ON cp.id = pp.cadastro_parte_id
      WHERE cp.documento = $1
        AND cp.chave = $2
        AND cp.chave_ativo = TRUE
      ORDER BY p.criado_em DESC`,
    [doc, key],
  )

  return rows
}

async function _validarParteProcesso(numero, cpf, chave) {
  const procNumero = String(numero || '').trim()
  const doc = String(cpf || '').trim()
  const key = String(chave || '').trim()
  if (!procNumero || !doc || !key) {
    const err = new Error('Parâmetros insuficientes')
    err.code = 400
    throw err
  }
  const { rows } = await query(
    `SELECT p.id AS "processoId", cp.id AS "parteId"
       FROM processos p
       JOIN processo_partes pp ON pp.processo_id = p.id
       JOIN cadastro_partes cp ON cp.id = pp.cadastro_parte_id
      WHERE p.numero = $1
        AND cp.documento = $2
        AND cp.chave = $3
        AND cp.chave_ativo = TRUE
      LIMIT 1`,
    [procNumero, doc, key],
  )
  if (!rows.length) {
    const err = new Error('Processo ou credenciais inválidas')
    err.code = 404
    throw err
  }
  return { processoId: rows[0].processoId, parteId: rows[0].parteId }
}

async function listarDocumentosExternosTemporarios(numero, cpf, chave) {
  const { processoId, parteId } = await _validarParteProcesso(numero, cpf, chave)
  const { rows } = await query(
    `SELECT id,
            file_name AS "fileName",
            status,
            titulo,
            criado_em AS "criadoEm",
            rejeicao_motivo AS "motivo"
       FROM externo_documentos_temp
      WHERE processo_id = $1
        AND parte_id = $2
      ORDER BY criado_em DESC`,
    [processoId, parteId],
  )
  return rows
}

async function anexarDocumentoExternoTemporario(numero, cpf, chave, fileName, contentBase64, titulo) {
  const { processoId, parteId } = await _validarParteProcesso(numero, cpf, chave)
  const name = String(fileName || '').trim()
  const content = String(contentBase64 || '').trim()
  if (!name || !content) {
    const err = new Error('Arquivo inválido')
    err.code = 400
    throw err
  }
  const id = uuidv4()
  await query(
    `INSERT INTO externo_documentos_temp (id, processo_id, parte_id, file_name, content_base64, status, titulo)
     VALUES ($1, $2, $3, $4, $5, 'aguardando_analise', $6)`,
    [id, processoId, parteId, name, content, titulo || null],
  )
  const { rows } = await query(
    `SELECT id,
            file_name AS "fileName",
            status,
            titulo,
            criado_em AS "criadoEm",
            rejeicao_motivo AS "motivo"
       FROM externo_documentos_temp
      WHERE id = $1`,
    [id],
  )
  return rows[0]
}

async function listarDocumentosExternosPorProcesso(processoId, { status } = {}) {
  const pid = String(processoId || '').trim()
  if (!pid) {
    const err = new Error('processoId é obrigatório')
    err.code = 400
    throw err
  }
  const params = [pid]
  const statusFilter = String(status || '').toLowerCase()
  const whereStatus = statusFilter ? `AND LOWER(edt.status) = $2` : ''
  if (whereStatus) params.push(statusFilter)
  const { rows } = await query(
    `SELECT edt.id,
            edt.file_name AS "fileName",
            edt.status,
            edt.titulo,
            edt.criado_em AS "criadoEm",
            edt.parte_id AS "parteId",
            cp.nome AS "parteNome",
            cp.documento AS "parteDocumento"
       FROM externo_documentos_temp edt
       JOIN cadastro_partes cp ON cp.id = edt.parte_id
       JOIN processo_partes pp ON pp.processo_id = edt.processo_id AND pp.cadastro_parte_id = cp.id
      WHERE edt.processo_id = $1 ${whereStatus}
      ORDER BY edt.criado_em DESC`,
    params,
  )
  return rows
}

// Visualizar documento temporário externo (detalhes + conteúdo)
async function getDocumentoTemporario(processoId, tempId) {
  const pid = String(processoId || '').trim()
  const tid = String(tempId || '').trim()
  if (!pid || !tid) {
    const err = new Error('processoId e tempId são obrigatórios')
    err.code = 400
    throw err
  }
  const { rows } = await query(
    `SELECT edt.id,
            edt.processo_id AS "processoId",
            edt.parte_id AS "parteId",
            edt.file_name AS "fileName",
            edt.content_base64 AS "contentBase64",
            edt.titulo,
            edt.status,
            edt.criado_em AS "criadoEm",
            cp.nome AS "parteNome",
            cp.documento AS "parteDocumento"
       FROM externo_documentos_temp edt
       JOIN cadastro_partes cp ON cp.id = edt.parte_id
      WHERE edt.id = $2
        AND edt.processo_id = $1
      LIMIT 1`,
    [pid, tid],
  )
  if (!rows.length) {
    const err = new Error('Documento externo não encontrado')
    err.code = 404
    throw err
  }
  return rows[0]
}

// Aceitar documento temporário: junta ao processo como documento assinado
async function aceitarDocumentoTemporario(processoId, tempId) {
  const temp = await getDocumentoTemporario(processoId, tempId)
  const status = String(temp.status || '').toLowerCase()
  if (status !== 'aguardando_analise') {
    const err = new Error('Documento já analisado')
    err.code = 409
    throw err
  }
  const docId = uuidv4()
  // Cria documento
  await query(
    `INSERT INTO documentos (id, titulo, tipo, modo, status, file_name, content_base64, autor, assinado_por, assinado_em)
     VALUES ($1, $2, $3, 'Upload', 'assinado', $4, $5, $6, $6, now())`,
    [
      docId,
      temp.titulo || temp.fileName || 'Documento Externo',
      'Documento',
      temp.fileName,
      temp.contentBase64,
      String(temp.parteId || ''),
    ],
  )
  // Vincula ao processo
  await query(
    `INSERT INTO processo_documentos (processo_id, documento_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [processoId, docId],
  )
  // Atualiza status temporário para juntado
  await query(
    `UPDATE externo_documentos_temp SET status = 'juntado' WHERE id = $1`,
    [tempId],
  )
  return { ok: true, documentoId: docId }
}

// Rejeitar documento temporário com motivo
async function rejeitarDocumentoTemporario(processoId, tempId, motivo) {
  const temp = await getDocumentoTemporario(processoId, tempId)
  const status = String(temp.status || '').toLowerCase()
  if (status !== 'aguardando_analise') {
    const err = new Error('Documento já analisado')
    err.code = 409
    throw err
  }
  const mot = String(motivo || '').trim()
  if (!mot) {
    const err = new Error('Motivo é obrigatório')
    err.code = 400
    throw err
  }
  await query(
    `UPDATE externo_documentos_temp SET status = 'rejeitado', rejeicao_motivo = $2, rejeitado_em = now() WHERE id = $1`,
    [tempId, mot],
  )
  return { ok: true }
}

async function criarProcessoExterno(cpf, chave, { assunto, tipoId, observacoes }) {
  const doc = String(cpf || '').trim()
  const key = String(chave || '').trim()
  if (!doc || !key) {
    const err = new Error('CPF e chave são obrigatórios')
    err.code = 400
    throw err
  }
  if (!assunto) {
    const err = new Error('Assunto é obrigatório')
    err.code = 400
    throw err
  }

  const { rows: cadRows } = await query(
    `SELECT id, nome FROM cadastro_partes WHERE documento = $1 AND chave = $2 AND chave_ativo = TRUE LIMIT 1`,
    [doc, key],
  )
  if (!cadRows.length) {
    const err = new Error('Credenciais inválidas ou parte não encontrada')
    err.code = 404
    throw err
  }
  const cadId = cadRows[0].id

  const processoView = await processosService.createProcesso({
    assunto,
    tipo: 'Processo',
    tipoId: tipoId || null,
    nivelAcesso: 'Público',
    baseLegal: null,
    observacoes: observacoes || '',
    partes: [{ parteId: cadId, papel: 'Interessado' }],
    documentosIds: [],
    executadoPor: null,
    usuario: null,
  })

  await query(
    `UPDATE processos
       SET setor_atual = 'PROTOCOLO',
           status = 'Aguardando',
           pendente = TRUE,
           pendente_origem_setor = 'PROTOCOLO',
           pendente_destino_setor = 'PROTOCOLO',
           atribuido_usuario = NULL
     WHERE id = $1`,
    [processoView.id],
  )

  return processoView
}
module.exports = {
  listProcessosPorParteCredencial,
  listarDocumentosExternosTemporarios,
  anexarDocumentoExternoTemporario,
  listarDocumentosExternosPorProcesso,
  getDocumentoTemporario,
  aceitarDocumentoTemporario,
  rejeitarDocumentoTemporario,
  criarProcessoExterno,
}