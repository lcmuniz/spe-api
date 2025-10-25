const { v4: uuidv4 } = require('uuid')
const { query } = require('../db')

async function listByProcesso(processoId, viewerSetorRaw) {
  const viewerSetor = String(viewerSetorRaw || '').toUpperCase()
  const { rows: procRows } = await query(`SELECT setor_atual FROM processos WHERE id = $1`, [
    processoId,
  ])
  if (procRows.length === 0) {
    const err = new Error('Processo não encontrado')
    err.code = 404
    throw err
  }

  const filterByViewer = viewerSetor
    ? "AND (LOWER(d.status) = 'assinado' OR (LOWER(d.status) <> 'assinado' AND UPPER(u.setor) = $2))"
    : "AND LOWER(d.status) = 'assinado'"
  const params = viewerSetor ? [processoId, viewerSetor] : [processoId]

  const { rows } = await query(
    `SELECT d.id,
            d.titulo,
            d.tipo,
            d.modo,
            d.status,
            d.file_name AS "fileName",
            d.criado_em AS "criadoEm",
            d.autor AS "autor",
            COALESCE(u.nome, ca.nome) AS "autorNome",
            u.setor AS "autorSetor",
            d.assinado_por AS "assinadoPor",
            a.setor AS "assinanteSetor"
       FROM processo_documentos pd
       JOIN documentos d ON d.id = pd.documento_id
       LEFT JOIN usuarios u ON u.login = d.autor
       LEFT JOIN cadastro_partes ca ON ca.id::text = d.autor
       LEFT JOIN usuarios a ON a.login = d.assinado_por
       LEFT JOIN cadastro_partes cs ON cs.id::text = d.assinado_por
      WHERE pd.processo_id = $1 ${filterByViewer}
      ORDER BY d.criado_em ASC`,
    params,
  )
  return rows
}

async function linkDocumento(processoId, documentoId) {
  if (!documentoId) {
    const err = new Error('documentoId é obrigatório')
    err.code = 400
    throw err
  }
  const proc = await query(`SELECT id FROM processos WHERE id = $1`, [processoId])
  if (proc.rows.length === 0) {
    const err = new Error('Processo não encontrado')
    err.code = 404
    throw err
  }
  const doc = await query(`SELECT id FROM documentos WHERE id = $1`, [documentoId])
  if (doc.rows.length === 0) {
    const err = new Error('Documento não encontrado')
    err.code = 404
    throw err
  }
  await query(
    `INSERT INTO processo_documentos (processo_id, documento_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [processoId, documentoId],
  )
  return { ok: true }
}

async function createDocumento({ titulo, tipo, modo, autor, autorLogin }) {
  if (!titulo) {
    const err = new Error('Título é obrigatório')
    err.code = 400
    throw err
  }
  const id = uuidv4()
  await query(
    `INSERT INTO documentos (id, titulo, tipo, modo, status, autor) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, titulo, tipo || 'Documento', modo || 'Editor', 'rascunho', autor || autorLogin || null],
  )
  const { rows } = await query(
    `SELECT d.id, d.titulo, d.tipo, d.modo, d.status, d.criado_em AS "criadoEm", d.autor AS "autor", COALESCE(u.nome, ca.nome) AS "autorNome"
       FROM documentos d
       LEFT JOIN usuarios u ON u.login = d.autor
       LEFT JOIN cadastro_partes ca ON ca.id::text = d.autor
      WHERE d.id = $1`,
    [id],
  )
  return rows[0]
}

async function _validarPosicaoFimArvore({ documentoId, usuarioLogin, exigeAtribuicao }) {
  const { rows: prows } = await query(
    `SELECT p.id AS "processoId", p.atribuido_usuario AS "atribuidoUsuario"
       FROM processos p
       JOIN processo_documentos pd ON pd.processo_id = p.id
      WHERE pd.documento_id = $1
      LIMIT 1`,
    [documentoId],
  )
  if (prows.length === 0) {
    const err = new Error('Documento não está vinculado a um processo')
    err.code = 400
    throw err
  }
  const processoId = prows[0].processoId
  const atribuidoUsuario = String(prows[0].atribuidoUsuario || '')
  if (exigeAtribuicao) {
    if (!atribuidoUsuario) {
      const err = new Error('Processo não está atribuído a nenhum usuário')
      err.code = 400
      throw err
    }
    if (atribuidoUsuario !== usuarioLogin) {
      const err = new Error('Você só pode editar documentos do processo atribuído a você')
      err.code = 403
      throw err
    }
  }
  const { rows: vrows } = await query(`SELECT setor FROM usuarios WHERE login = $1`, [usuarioLogin])
  const viewerSetor = String(vrows[0]?.setor || '').toUpperCase()
  const { rows: docsRows } = await query(
    `SELECT d.id, d.status, d.criado_em AS "criadoEm", a.setor AS "assinanteSetor"
       FROM processo_documentos pd
       JOIN documentos d ON d.id = pd.documento_id
       LEFT JOIN usuarios a ON a.login = d.assinado_por
      WHERE pd.processo_id = $1
      ORDER BY d.criado_em ASC`,
    [processoId],
  )
  const indexDoc = docsRows.findIndex((r) => String(r.id) === String(documentoId))
  let lastCrossIndex = -1
  for (let i = 0; i < docsRows.length; i++) {
    const r = docsRows[i]
    if (
      String(r.status || '').toLowerCase() === 'assinado' &&
      String(r.assinanteSetor || '').toUpperCase() !== viewerSetor
    ) {
      lastCrossIndex = i
    }
  }
  const endStart = lastCrossIndex + 1
  if (!(indexDoc >= endStart)) {
    const err = new Error('Documento só pode ser editado/assinado se estiver no fim da árvore')
    err.code = 403
    throw err
  }
  return { processoId }
}

async function uploadConteudo(id, { fileName, contentBase64, usuarioLogin, autorLogin, autor }) {
  const { rows: drows } = await query(
    `SELECT status, assinado_por FROM documentos WHERE id = $1`,
    [id],
  )
  if (drows.length === 0) {
    const err = new Error('Documento não encontrado')
    err.code = 404
    throw err
  }
  const statusAtual = String(drows[0].status || '').toLowerCase()
  const assinante = drows[0].assinado_por || null
  if (statusAtual === 'rascunho') {
    if (!usuarioLogin) {
      const err = new Error('Usuário executor é obrigatório para editar rascunho')
      err.code = 400
      throw err
    }
    await _validarPosicaoFimArvore({ documentoId: id, usuarioLogin, exigeAtribuicao: false })
  }
  if (statusAtual === 'assinado') {
    if (!usuarioLogin) {
      const err = new Error('Usuário executor é obrigatório para editar documento assinado')
      err.code = 400
      throw err
    }
    await _validarPosicaoFimArvore({
      documentoId: id,
      usuarioLogin,
      exigeAtribuicao: true,
    })
  }

  const sql =
    statusAtual === 'assinado'
      ? `UPDATE documentos SET modo = 'Upload', file_name = $1, content_base64 = $2, autor = COALESCE($3, autor), status = 'rascunho', assinado_por = NULL, assinado_em = NULL WHERE id = $4`
      : `UPDATE documentos SET modo = 'Upload', file_name = $1, content_base64 = $2, autor = COALESCE($3, autor) WHERE id = $4`

  const { rowCount } = await query(sql, [
    fileName || 'arquivo.bin',
    contentBase64 || null,
    usuarioLogin || autor || autorLogin || null,
    id,
  ])
  if (rowCount === 0) {
    const err = new Error('Documento não encontrado')
    err.code = 404
    throw err
  }
  return { ok: true, statusAnterior: statusAtual, assinante }
}

async function editorConteudo(id, { conteudo, usuarioLogin, autorLogin, autor }) {
  const { rows: drows } = await query(
    `SELECT status, assinado_por FROM documentos WHERE id = $1`,
    [id],
  )
  if (drows.length === 0) {
    const err = new Error('Documento não encontrado')
    err.code = 404
    throw err
  }
  const statusAtual = String(drows[0].status || '').toLowerCase()
  const assinante = drows[0].assinado_por || null

  if (statusAtual === 'rascunho') {
    if (!usuarioLogin) {
      const err = new Error('Usuário executor é obrigatório para editar rascunho')
      err.code = 400
      throw err
    }
    await _validarPosicaoFimArvore({ documentoId: id, usuarioLogin, exigeAtribuicao: false })
  }
  if (statusAtual === 'assinado') {
    if (!usuarioLogin) {
      const err = new Error('Usuário executor é obrigatório para editar documento assinado')
      err.code = 400
      throw err
    }
    if (usuarioLogin !== assinante) {
      const err = new Error('Você só pode editar documentos assinados por você')
      err.code = 403
      throw err
    }
    await _validarPosicaoFimArvore({ documentoId: id, usuarioLogin, exigeAtribuicao: true })
  }

  const { rowCount } = await query(
    `UPDATE documentos SET modo = 'Editor', conteudo = $1, autor = COALESCE($2, autor) WHERE id = $3`,
    [conteudo || null, usuarioLogin || autor || autorLogin || null, id],
  )
  if (rowCount === 0) {
    const err = new Error('Documento não encontrado')
    err.code = 404
    throw err
  }
  return { ok: true, statusAnterior: statusAtual, assinante }
}

async function getDocumentoById(id) {
  const { rows } = await query(
    `SELECT d.id,
            d.titulo,
            d.tipo,
            d.modo,
            d.status,
            d.file_name AS "fileName",
            d.content_base64 AS "contentBase64",
            d.conteudo,
            d.criado_em AS "criadoEm",
            d.autor AS "autor",
            COALESCE(u.nome, ca.nome) AS "autorNome",
            d.assinado_por AS "assinadoPor",
            d.assinado_em AS "assinadoEm",
            COALESCE(a.nome, cs.nome) AS "assinaturaNome",
            a.cargo AS "assinaturaCargo"
       FROM documentos d
       LEFT JOIN usuarios u ON u.login = d.autor
       LEFT JOIN cadastro_partes ca ON ca.id::text = d.autor
       LEFT JOIN usuarios a ON a.login = d.assinado_por
       LEFT JOIN cadastro_partes cs ON cs.id::text = d.assinado_por
      WHERE d.id = $1`,
    [id],
  )
  return rows.length ? rows[0] : null
}

async function assinar(id, { usuarioLogin }) {
  if (!usuarioLogin) {
    const err = new Error('Usuário executor é obrigatório para assinar')
    err.code = 400
    throw err
  }
  const { rows: drows } = await query(
    `SELECT status, modo, file_name, content_base64 FROM documentos WHERE id = $1`,
    [id],
  )
  if (drows.length === 0) {
    const err = new Error('Documento não encontrado')
    err.code = 404
    throw err
  }
  const statusAtual = String(drows[0].status || '').toLowerCase()
  const modo = String(drows[0].modo || '')
  const fileName = String(drows[0].file_name || '')
  const contentBase64 = drows[0].content_base64 || null

  const isEditor = modo.toLowerCase() === 'editor'
  const isUpload = modo.toLowerCase() === 'upload'
  if (!isEditor && !isUpload) {
    const err = new Error('Apenas documentos do Editor ou Upload podem ser assinados')
    err.code = 400
    throw err
  }
  if (isUpload) {
    if (!fileName || !contentBase64) {
      const err = new Error('Documento de Upload sem conteúdo para assinatura')
      err.code = 400
      throw err
    }
    const ext = (fileName.split('.').pop() || '').toLowerCase()
    const allowed = ['pdf', 'png', 'jpg', 'jpeg', 'gif']
    if (!allowed.includes(ext)) {
      const err = new Error('Apenas PDFs e imagens podem ser assinados')
      err.code = 400
      throw err
    }
  }
  if (statusAtual !== 'rascunho') {
    const err = new Error('Documento não está em rascunho')
    err.code = 400
    throw err
  }
  await _validarPosicaoFimArvore({ documentoId: id, usuarioLogin, exigeAtribuicao: true })

  const { rowCount } = await query(
    `UPDATE documentos
       SET status = 'assinado',
           assinado_por = $2,
           assinado_em = now()
     WHERE id = $1`,
    [id, usuarioLogin],
  )
  if (rowCount === 0) {
    const err = new Error('Documento não encontrado')
    err.code = 404
    throw err
  }
  const doc = await getDocumentoById(id)
  return { ok: true, documento: doc }
}

async function deletarRascunho(id, { usuarioLogin }) {
  if (!usuarioLogin) {
    const err = new Error('Usuário executor é obrigatório')
    err.code = 400
    throw err
  }
  const { rows: drows } = await query(`SELECT status, autor FROM documentos WHERE id = $1`, [
    id,
  ])
  if (drows.length === 0) {
    const err = new Error('Documento não encontrado')
    err.code = 404
    throw err
  }
  const statusAtual = String(drows[0].status || '').toLowerCase()
  const autorLogin = drows[0].autor || null
  if (statusAtual === 'assinado') {
    const err = new Error('Documento assinado não pode ser excluído')
    err.code = 400
    throw err
  }
  if (statusAtual !== 'rascunho') {
    const err = new Error('Documento não está em rascunho')
    err.code = 400
    throw err
  }
  if (!autorLogin || autorLogin !== usuarioLogin) {
    const err = new Error('Você só pode excluir documentos criados por você')
    err.code = 403
    throw err
  }
  const { rows: prows } = await query(
    `SELECT p.id AS "processoId"
       FROM processos p
       JOIN processo_documentos pd ON pd.processo_id = p.id
      WHERE pd.documento_id = $1
      LIMIT 1`,
    [id],
  )
  if (prows.length === 0) {
    const err = new Error('Documento não está vinculado a um processo')
    err.code = 400
    throw err
  }
  const { rowCount } = await query(`DELETE FROM documentos WHERE id = $1`, [id])
  if (rowCount === 0) {
    const err = new Error('Documento não encontrado')
    err.code = 404
    throw err
  }
  return { ok: true, statusAnterior: statusAtual, autorLogin }
}

async function gerarPdfPublico(id, cpf, chaveRaw) {
  const { rows } = await query(
    `SELECT d.id, d.titulo, d.modo, d.status, d.file_name AS "fileName", d.content_base64 AS "contentBase64", d.conteudo,
            p.id AS "processoId", p.nivel_acesso AS "nivelAcesso"
       FROM documentos d
       JOIN processo_documentos pd ON pd.documento_id = d.id
       JOIN processos p ON p.id = pd.processo_id
      WHERE d.id = $1
      LIMIT 1`,
    [id],
  )
  if (rows.length === 0) {
    const err = new Error('Documento não encontrado')
    err.code = 404
    throw err
  }
  const d = rows[0]
  if (String(d.status || '').toLowerCase() !== 'assinado') {
    const err = new Error('Documento não assinado')
    err.code = 403
    throw err
  }
  if (String(d.nivelAcesso || '') !== 'Público') {
    const chave = String(chaveRaw || '')
    if (!cpf || !chave) {
      const err = new Error('Documento pertence a processo não público: CPF e chave são obrigatórios')
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
      [d.processoId, cpf, chave],
    )
    if (!cred.length) {
      const err = new Error('Credenciais inválidas para acesso ao documento')
      err.code = 403
      throw err
    }
  }

  const modo = String(d.modo || '').toLowerCase()
  const titulo = d.titulo || 'documento'
  const safeTitle = titulo.replace(/[^a-zA-Z0-9_-]+/g, '_')
  let pdfBase64 = null
  if (modo === 'editor') {
    const rawText = d.conteudo || ''
    const looksHtml = /<\/?[a-zA-Z]/.test(rawText)
    let bodyHtml
    if (!rawText.trim()) {
      bodyHtml = `<div style="white-space:pre-wrap"></div>`
    } else if (looksHtml) {
      bodyHtml = rawText
    } else {
      const text = rawText.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
      bodyHtml = `<pre>${text}</pre>`
    }
    const html = `<html><head><meta charset="utf-8"><title>${safeTitle}</title></head><body>${bodyHtml}</body></html>`
    const puppeteer = require('puppeteer')
    const browser = await puppeteer.launch()
    const page = await browser.newPage()
    await page.setContent(html)
    const pdfBuffer = await page.pdf()
    await browser.close()
    pdfBase64 = Buffer.from(pdfBuffer).toString('base64')
  } else if (modo === 'upload') {
    const fileName = String(d.fileName || d.file_name || '')
    const base64Raw = (d.contentBase64 != null ? d.contentBase64 : (d.content_base64 != null ? d.content_base64 : ''))
    if (!base64Raw) {
      const err = new Error('Upload sem conteúdo para geração de PDF')
      err.code = 409
      throw err
    }
    const ext = (fileName.split('.').pop() || '').toLowerCase()
    const allowed = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']
    if (!allowed.includes(ext)) {
      const err = new Error('Formato de upload não suportado para PDF público')
      err.code = 415
      throw err
    }
    let base64 = base64Raw
    if (ext === 'pdf') {
      // Se vier CSV de bytes, converte para base64 real
      if (/^\s*\d+(?:\s*,\s*\d+)*\s*$/.test(base64Raw)) {
        const bytes = base64Raw.split(',').map((s) => parseInt(s.trim(), 10))
        base64 = Buffer.from(bytes).toString('base64')
      }
    }
    pdfBase64 = base64
  } else {
    const err = new Error('Modo de documento não suportado para PDF público')
    err.code = 415
    throw err
  }

  // Nome do arquivo: se upload PDF, mantém o nome original; caso contrário, usa título
  const origName = String(d.fileName || d.file_name || '')
  const resultFileName = (modo === 'upload' && origName.toLowerCase().endsWith('.pdf'))
    ? origName
    : `${safeTitle}.pdf`

  return { fileName: resultFileName, contentBase64: pdfBase64 }
}

async function seedByProcesso(processoId, { autor, autorLogin } = {}) {
  // Verifica existência do processo e obtém setor atual e atribuição
  const { rows: procRows } = await query(
    `SELECT id, setor_atual AS "setorAtual", atribuido_usuario AS "atribuidoUsuario" FROM processos WHERE id = $1`,
    [processoId],
  )
  if (procRows.length === 0) {
    const err = new Error('Processo não encontrado')
    err.code = 404
    throw err
  }

  // Evita duplicar: se já há documentos vinculados, não semeia novamente
  const { rows: existingRows } = await query(
    `SELECT documento_id FROM processo_documentos WHERE processo_id = $1 LIMIT 1`,
    [processoId],
  )
  if (existingRows.length > 0) {
    return { ok: true, seeded: false }
  }

  const setorAtual = String(procRows[0].setorAtual || '').toUpperCase()
  let autorResolved = String(autor || autorLogin || procRows[0].atribuidoUsuario || '')

  if (!autorResolved) {
    // Escolhe um usuário do setor atual como autor, se possível
    const { rows: urows } = await query(
      `SELECT login FROM usuarios WHERE UPPER(setor) = $1 ORDER BY nome ASC LIMIT 1`,
      [setorAtual],
    )
    autorResolved = String(urows[0]?.login || '')
  }

  // Cria documento inicial (rascunho, modo Editor)
  const created = await createDocumento({
    titulo: 'Documento inicial',
    tipo: 'Documento',
    modo: 'Editor',
    autor: autorResolved || null,
  })

  // Vincula ao processo
  await query(
    `INSERT INTO processo_documentos (processo_id, documento_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [processoId, created.id],
  )

  return { ok: true, seeded: true, documentoId: created.id }
}

module.exports = {
  listByProcesso,
  linkDocumento,
  createDocumento,
  uploadConteudo,
  editorConteudo,
  getDocumentoById,
  assinar,
  deletarRascunho,
  gerarPdfPublico,
  seedByProcesso,
}
