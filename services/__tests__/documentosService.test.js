jest.mock('../../db', () => ({
  query: jest.fn(),
}))

const { query } = require('../../db')

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'doc-123'),
}))

const documentosService = require('../documentosService')

jest.mock('puppeteer', () => {
  const pdfBuffer = Buffer.from('pdf-binary')
  return {
    launch: jest.fn(() => Promise.resolve({
      newPage: jest.fn(() => Promise.resolve({
        setContent: jest.fn(() => Promise.resolve()),
        pdf: jest.fn(() => Promise.resolve(pdfBuffer)),
      })),
      close: jest.fn(() => Promise.resolve()),
    })),
  }
})

describe('documentosService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Reset DB query mock queue to avoid cross-test leakage of mockResolvedValueOnce
    query.mockReset()
  })

  describe('listByProcesso', () => {
    it('erro 404 quando processo não existe', async () => {
      // 1ª chamada: valida processo
      query.mockResolvedValueOnce({ rows: [] })

      await expect(documentosService.listByProcesso('proc-404')).rejects.toMatchObject({ code: 404 })
      expect(query).toHaveBeenCalledTimes(1)
      expect(query.mock.calls[0][0]).toEqual(expect.stringContaining('SELECT setor_atual FROM processos'))
    })

    it('lista documentos assinados quando viewerSetor ausente', async () => {
      // 1: processo existe
      query.mockResolvedValueOnce({ rows: [{ setor_atual: 'PROTOCOLO' }] })
      // 2: query documentos com filtro de assinados
      const fakeRows = [
        { id: 'd1', status: 'assinado', criadoEm: '2024-01-01' },
      ]
      query.mockResolvedValueOnce({ rows: fakeRows })

      const result = await documentosService.listByProcesso('proc-1')

      expect(query).toHaveBeenCalledTimes(2)
      const [sqlDocs, paramsDocs] = query.mock.calls[1]
      expect(sqlDocs).toEqual(expect.stringContaining("FROM processo_documentos"))
      expect(sqlDocs).toEqual(expect.stringContaining("AND LOWER(d.status) = 'assinado'"))
      expect(paramsDocs).toEqual(['proc-1'])
      expect(result).toEqual(fakeRows)
    })

    it('lista documentos considerando setor do viewer quando informado', async () => {
      // 1: processo existe
      query.mockResolvedValueOnce({ rows: [{ setor_atual: 'PROTOCOLO' }] })
      // 2: query documentos com filtro por viewerSetor
      const fakeRows = [
        { id: 'd2', status: 'rascunho', criadoEm: '2024-01-02' },
      ]
      query.mockResolvedValueOnce({ rows: fakeRows })

      const result = await documentosService.listByProcesso('proc-1', 'TI')

      expect(query).toHaveBeenCalledTimes(2)
      const [sqlDocs, paramsDocs] = query.mock.calls[1]
      expect(sqlDocs).toEqual(expect.stringContaining("UPPER(u.setor) = $2"))
      expect(paramsDocs).toEqual(['proc-1', 'TI'])
      expect(result).toEqual(fakeRows)
    })
  })

  describe('linkDocumento', () => {
    it('valida documentoId obrigatório e lança erro 400', async () => {
      await expect(documentosService.linkDocumento('proc-1', undefined)).rejects.toMatchObject({ code: 400 })
      expect(query).not.toHaveBeenCalled()
    })

    it('lança 404 quando processo não existe', async () => {
      // 1: SELECT processo
      query.mockResolvedValueOnce({ rows: [] })

      await expect(documentosService.linkDocumento('proc-404', 'doc-1')).rejects.toMatchObject({ code: 404 })
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('lança 404 quando documento não existe', async () => {
      // 1: processo existe
      query.mockResolvedValueOnce({ rows: [{ id: 'proc-1' }] })
      // 2: documento não existe
      query.mockResolvedValueOnce({ rows: [] })

      await expect(documentosService.linkDocumento('proc-1', 'doc-404')).rejects.toMatchObject({ code: 404 })
      expect(query).toHaveBeenCalledTimes(2)
    })

    it('insere link e retorna ok: true', async () => {
      // 1: processo existe
      query.mockResolvedValueOnce({ rows: [{ id: 'proc-1' }] })
      // 2: documento existe
      query.mockResolvedValueOnce({ rows: [{ id: 'doc-1' }] })
      // 3: insert link
      query.mockResolvedValueOnce({})

      const result = await documentosService.linkDocumento('proc-1', 'doc-1')

      expect(query).toHaveBeenCalledTimes(3)
      const insertArgs = query.mock.calls[2]
      expect(insertArgs[0]).toEqual(expect.stringContaining('INSERT INTO processo_documentos'))
      expect(insertArgs[1]).toEqual(['proc-1', 'doc-1'])
      expect(result).toEqual({ ok: true })
    })
  })

  describe('createDocumento', () => {
    it('valida título obrigatório e lança erro 400', async () => {
      await expect(documentosService.createDocumento({ titulo: '' })).rejects.toMatchObject({ code: 400 })
      expect(query).not.toHaveBeenCalled()
    })

    it('cria documento rascunho e retorna dados do SELECT', async () => {
      // 1: insert
      query.mockResolvedValueOnce({})
      // 2: select documento
      const fakeRow = { id: 'doc-123', titulo: 'Doc', modo: 'Editor', status: 'rascunho', autorLogin: 'user1' }
      query.mockResolvedValueOnce({ rows: [fakeRow] })

      const result = await documentosService.createDocumento({ titulo: 'Doc', autorLogin: 'user1' })

      expect(query).toHaveBeenCalledTimes(2)
      const insertArgs = query.mock.calls[0]
      expect(insertArgs[0]).toEqual(expect.stringContaining('INSERT INTO documentos'))
      expect(insertArgs[1]).toEqual(['doc-123', 'Doc', 'Documento', 'Editor', 'rascunho', 'user1'])
      expect(result).toEqual(fakeRow)
    })
  })

  describe('getDocumentoById', () => {
    it('retorna null quando não encontra', async () => {
      query.mockResolvedValueOnce({ rows: [] })
      const result = await documentosService.getDocumentoById('doc-x')
      expect(query).toHaveBeenCalledTimes(1)
      expect(result).toBeNull()
    })

    it('retorna objeto com campos mapeados quando encontra', async () => {
      const fakeRow = { id: 'doc-1', titulo: 'A', fileName: 'f.pdf', autorLogin: 'u1' }
      query.mockResolvedValueOnce({ rows: [fakeRow] })
      const result = await documentosService.getDocumentoById('doc-1')
      expect(query).toHaveBeenCalledTimes(1)
      expect(query.mock.calls[0][0]).toEqual(expect.stringContaining('FROM documentos d'))
      expect(result).toEqual(fakeRow)
    })
  })

  describe('assinar', () => {
    it('valida usuário executor obrigatório', async () => {
      await expect(documentosService.assinar('doc-1', { usuarioLogin: '' })).rejects.toMatchObject({ code: 400 })
      expect(query).not.toHaveBeenCalled()
    })

    it('lança 404 quando documento não existe', async () => {
      // 1: select documento
      query.mockResolvedValueOnce({ rows: [] })
      await expect(documentosService.assinar('doc-404', { usuarioLogin: 'u1' })).rejects.toMatchObject({ code: 404 })
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('lança 400 quando modo não é Editor nem Upload', async () => {
      query.mockResolvedValueOnce({ rows: [{ status: 'rascunho', modo: 'Outro', file_name: null, content_base64: null }] })
      await expect(documentosService.assinar('doc-1', { usuarioLogin: 'u1' })).rejects.toMatchObject({ code: 400 })
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('assina documento de Upload válido e retorna documento', async () => {
      // 1: select documento (rascunho, upload, com conteúdo válido)
      query.mockResolvedValueOnce({ rows: [{ status: 'rascunho', modo: 'Upload', file_name: 'arquivo.pdf', content_base64: 'abc' }] })
      // 2: _validarPosicaoFimArvore -> SELECT processo vinculado
      query.mockResolvedValueOnce({ rows: [{ processoId: 'proc-1', atribuidoUsuario: 'u1' }] })
      // 3: _validarPosicaoFimArvore -> SELECT setor do usuário
      query.mockResolvedValueOnce({ rows: [{ setor: 'TI' }] })
      // 4: _validarPosicaoFimArvore -> SELECT documentos do processo (doc no fim da árvore)
      query.mockResolvedValueOnce({ rows: [{ id: 'doc-1', status: 'rascunho', criadoEm: '2024-01-01', assinanteSetor: null }] })
      // 5: UPDATE documentos para assinar
      query.mockResolvedValueOnce({ rowCount: 1 })
      // 6: getDocumentoById -> SELECT detalhes
      const docRow = { id: 'doc-1', titulo: 'Assinado', status: 'assinado' }
      query.mockResolvedValueOnce({ rows: [docRow] })

      const result = await documentosService.assinar('doc-1', { usuarioLogin: 'u1' })

      expect(query).toHaveBeenCalledTimes(6)
      const updateArgs = query.mock.calls[4]
      expect(updateArgs[0]).toEqual(expect.stringContaining('UPDATE documentos'))
      expect(updateArgs[1]).toEqual(['doc-1', 'u1'])
      expect(result).toEqual({ ok: true, documento: docRow })
    })
  })

  describe('deletarRascunho', () => {
    it('impede excluir documento assinado (erro 400)', async () => {
      // 1: select documento status assinado
      query.mockResolvedValueOnce({ rows: [{ status: 'assinado', autor: 'u1' }] })
      await expect(documentosService.deletarRascunho('doc-1', { usuarioLogin: 'u1' })).rejects.toMatchObject({ code: 400 })
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('exclui rascunho criado pelo usuário e retorna ok', async () => {
      // 1: select documento (rascunho, autor = u1)
      query.mockResolvedValueOnce({ rows: [{ status: 'rascunho', autor: 'u1' }] })
      // 2: select processo vinculado ao documento
      query.mockResolvedValueOnce({ rows: [{ processoId: 'proc-1' }] })
      // 3: delete documento
      query.mockResolvedValueOnce({ rowCount: 1 })

      const result = await documentosService.deletarRascunho('doc-1', { usuarioLogin: 'u1' })

      expect(query).toHaveBeenCalledTimes(3)
      const deleteArgs = query.mock.calls[2]
      expect(deleteArgs[0]).toEqual(expect.stringContaining('DELETE FROM documentos'))
      expect(deleteArgs[1]).toEqual(['doc-1'])
      expect(result).toEqual({ ok: true, statusAnterior: 'rascunho', autorLogin: 'u1' })
    })
  })
})

describe('gerarPdfPublico', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('retorna 404 quando documento não existe', async () => {
    // 1: SELECT documento + processo
    query.mockResolvedValueOnce({ rows: [] })

    await expect(documentosService.gerarPdfPublico('doc-404')).rejects.toMatchObject({ code: 404 })
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0][0]).toEqual(expect.stringContaining('FROM documentos d'))
  })

  it('retorna 403 quando documento não assinado', async () => {
    // 1: SELECT documento (rascunho)
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-1', status: 'rascunho', modo: 'Upload', file_name: 'arquivo.pdf', content_base64: 'abc', processoId: 'proc-1', nivelAcesso: 'Público' }] })

    await expect(documentosService.gerarPdfPublico('doc-1')).rejects.toMatchObject({ code: 403 })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('processo não público sem CPF+chave retorna 403', async () => {
    // 1: SELECT documento (assinado, processo restrito)
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-1', status: 'assinado', modo: 'Upload', file_name: 'arquivo.pdf', content_base64: 'abc', processoId: 'proc-1', nivelAcesso: 'Restrito' }] })

    await expect(documentosService.gerarPdfPublico('doc-1', '', '')).rejects.toMatchObject({ code: 403 })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('CPF/chave inválidos retornam 403', async () => {
    // 1: SELECT documento (assinado, processo restrito)
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-1', status: 'assinado', modo: 'Upload', file_name: 'arquivo.pdf', content_base64: 'abc', processoId: 'proc-1', nivelAcesso: 'Restrito' }] })
    // 2: SELECT credencial inválida
    query.mockResolvedValueOnce({ rows: [] })

    await expect(documentosService.gerarPdfPublico('doc-1', 'cpf-x', 'chave-x')).rejects.toMatchObject({ code: 403 })
    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[1][0]).toEqual(expect.stringContaining('FROM processo_partes'))
    expect(query.mock.calls[1][0]).toEqual(expect.stringContaining('JOIN cadastro_partes'))
    expect(query.mock.calls[1][1]).toEqual(['proc-1', 'cpf-x', 'chave-x'])
  })

  it('upload PDF retorna conteúdo base64 e fileName do arquivo', async () => {
    // 1: SELECT documento (assinado, público, upload pdf)
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-1', status: 'assinado', modo: 'Upload', file_name: 'arquivo.pdf', content_base64: 'abc123', processoId: 'proc-1', nivelAcesso: 'Público', titulo: 'Titulo Legal' }] })

    const result = await documentosService.gerarPdfPublico('doc-1')

    expect(query).toHaveBeenCalledTimes(1)
    expect(result.fileName).toBe('arquivo.pdf')
    expect(result.contentBase64).toBe('abc123')
  })

  it('editor gera PDF via puppeteer e retorna base64', async () => {
    // 1: SELECT documento (assinado, público, editor)
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-2', status: 'assinado', modo: 'Editor', conteudo: 'Olá mundo', processoId: 'proc-2', nivelAcesso: 'Público', titulo: 'Meu Doc' }] })

    const result = await documentosService.gerarPdfPublico('doc-2')

    expect(query).toHaveBeenCalledTimes(1)
    expect(result.fileName).toBe('Meu_Doc.pdf')
    expect(typeof result.contentBase64).toBe('string')
    expect(result.contentBase64.length).toBeGreaterThan(0)
  })
})

describe('gerarPdfPublico adicionais', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('gera PDF no modo Editor com texto simples (sanitiza &<> e título)', async () => {
    // 1: SELECT documento (assinado, público, editor com texto simples e título com caracteres especiais)
    query.mockResolvedValueOnce({ rows: [{ id: 'd1', titulo: 'Doc & <>', status: 'assinado', modo: 'Editor', conteudo: 'Texto com & e < >', processoId: 'p1', nivelAcesso: 'Público' }] })

    const result = await documentosService.gerarPdfPublico('d1')

    expect(query).toHaveBeenCalledTimes(1)
    expect(result.fileName).toBe('Doc_.pdf')
    expect(typeof result.contentBase64).toBe('string')
    expect(result.contentBase64.length).toBeGreaterThan(0)
  })

  it('gera PDF no modo Upload (imagem PNG)', async () => {
    // 1: SELECT documento (assinado, público, upload png)
    query.mockResolvedValueOnce({ rows: [{ id: 'd2', titulo: 'Imagem PNG', status: 'assinado', modo: 'Upload', file_name: 'foto.png', content_base64: Buffer.from('x').toString('base64'), processoId: 'p1', nivelAcesso: 'Público' }] })

    const result = await documentosService.gerarPdfPublico('d2')

    expect(query).toHaveBeenCalledTimes(1)
    expect(result.fileName).toBe('Imagem_PNG.pdf')
    expect(typeof result.contentBase64).toBe('string')
    expect(result.contentBase64.length).toBeGreaterThan(0)
  })

  it('converte imagem WEBP para PDF no modo upload', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-webp', titulo: 'Imagem WEBP', status: 'assinado', modo: 'Upload', file_name: 'foto.webp', content_base64: 'UklGR', nivelAcesso: 'Público' }] })
    const result = await documentosService.gerarPdfPublico('doc-webp')
    expect(query).toHaveBeenCalledTimes(1)
    expect(result.fileName).toBe('Imagem_WEBP.pdf')
    expect(typeof result.contentBase64).toBe('string')
    expect(result.contentBase64.length).toBeGreaterThan(0)
  })

  it('converte SVG para PDF no modo upload', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-svg', titulo: 'Gráfico SVG', status: 'assinado', modo: 'Upload', file_name: 'grafico.svg', content_base64: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg==', nivelAcesso: 'Público' }] })
    const result = await documentosService.gerarPdfPublico('doc-svg')
    expect(query).toHaveBeenCalledTimes(1)
    expect(result.fileName).toBe('Gr_fico_SVG.pdf')
    expect(typeof result.contentBase64).toBe('string')
    expect(result.contentBase64.length).toBeGreaterThan(0)
  })

  it('decodifica CSV de bytes quando upload PDF com base64 em CSV', async () => {
    const csv = '49,50,51' // bytes de '123'
    query.mockResolvedValueOnce({ rows: [{ id: 'd5', titulo: 'Doc PDF', status: 'assinado', nivelAcesso: 'Público', modo: 'Upload', file_name: 'doc.pdf', content_base64: csv }] })
    const result = await documentosService.gerarPdfPublico('d5')
    expect(query).toHaveBeenCalledTimes(1)
    expect(result.fileName).toBe('doc.pdf')
    expect(result.contentBase64).toBe(Buffer.from([49, 50, 51]).toString('base64'))
  })

  it('retorna 415 para modo não suportado', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'd6', titulo: 'x', status: 'assinado', nivelAcesso: 'Público', modo: 'Outro' }] })
    await expect(documentosService.gerarPdfPublico('d6')).rejects.toMatchObject({ code: 415 })
  })

  it('gera PDF quando conteúdo já é HTML (usa diretamente)', async () => {
    const puppeteer = require('puppeteer')
    const pdfBuffer = Buffer.from('pdf-binary')
    let capturedHtml = ''

    puppeteer.launch.mockImplementation(() =>
      Promise.resolve({
        newPage: jest.fn(() =>
          Promise.resolve({
            setContent: jest.fn((html) => {
              capturedHtml = html
              return Promise.resolve()
            }),
            pdf: jest.fn(() => Promise.resolve(pdfBuffer)),
          }),
        ),
        close: jest.fn(() => Promise.resolve()),
      }),
    )

    query.mockResolvedValueOnce({ rows: [{ id: 'd7', titulo: 'HTML', status: 'assinado', nivelAcesso: 'Público', modo: 'Editor', conteudo: '<p>Olá</p>' }] })
    const result = await documentosService.gerarPdfPublico('d7')

    expect(query).toHaveBeenCalledTimes(1)
    expect(result.fileName).toBe('HTML.pdf')
    expect(typeof result.contentBase64).toBe('string')
    expect(result.contentBase64.length).toBeGreaterThan(0)
    const bodyMatch = capturedHtml.match(/<body>([\s\S]*?)<\/body>/)
    expect(bodyMatch && bodyMatch[1]).toEqual(expect.stringContaining('<p>Olá</p>'))
  })

  it('gera PDF com template padrão quando conteúdo vazio (Editor)', async () => {
    const puppeteer = require('puppeteer')
    const pdfBuffer = Buffer.from('pdf-binary')
    let capturedHtml = ''

    puppeteer.launch.mockImplementation(() =>
      Promise.resolve({
        newPage: jest.fn(() =>
          Promise.resolve({
            setContent: jest.fn((html) => {
              capturedHtml = html
              return Promise.resolve()
            }),
            pdf: jest.fn(() => Promise.resolve(pdfBuffer)),
          }),
        ),
        close: jest.fn(() => Promise.resolve()),
      }),
    )

    query.mockResolvedValueOnce({ rows: [{ id: 'doc-empty', titulo: 'Vazio', status: 'assinado', modo: 'Editor', conteudo: '', nivelAcesso: 'Público' }] })
    const result = await documentosService.gerarPdfPublico('doc-empty')

    expect(result.fileName).toBe('Vazio.pdf')
    expect(typeof result.contentBase64).toBe('string')
    expect(result.contentBase64.length).toBeGreaterThan(0)
    expect(capturedHtml).toEqual(expect.stringContaining('<div'))
    expect(capturedHtml).toEqual(expect.stringContaining('white-space:pre-wrap'))
  })

  it('retorna 409 quando upload sem conteúdo base64', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'd4', titulo: 't', status: 'assinado', nivelAcesso: 'Público', modo: 'Upload', file_name: 'img.png', content_base64: '' }] })
    await expect(documentosService.gerarPdfPublico('d4')).rejects.toMatchObject({ code: 409 })
  })
})

describe('uploadConteudo adicionais', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    query.mockReset()
  })

  it('exige usuarioLogin para documento assinado', async () => {
    query.mockResolvedValueOnce({ rows: [{ status: 'assinado', assinado_por: 'u2' }] })
    await expect(
      documentosService.uploadConteudo('doc-1', { fileName: 'a.pdf', contentBase64: 'abc', usuarioLogin: '' })
    ).rejects.toMatchObject({ code: 400 })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('usa defaults e atualiza assinado → rascunho quando fim da árvore', async () => {
    // 1: SELECT documento (assinado)
    query.mockResolvedValueOnce({ rows: [{ status: 'assinado', assinado_por: 'uExec' }] })
    // 2: _validar -> SELECT processo vinculado e atribuição
    query.mockResolvedValueOnce({ rows: [{ processoId: 'proc-1', atribuidoUsuario: 'uExec' }] })
    // 3: _validar -> SELECT setor do usuário
    query.mockResolvedValueOnce({ rows: [{ setor: 'TI' }] })
    // 4: _validar -> SELECT documentos do processo (doc no fim da árvore)
    query.mockResolvedValueOnce({ rows: [
      { id: 'doc-old', status: 'assinado', criadoEm: '2024-01-01', assinanteSetor: 'TI' },
      { id: 'doc-1', status: 'rascunho', criadoEm: '2024-01-02', assinanteSetor: null },
    ] })
    // 5: UPDATE
    query.mockResolvedValueOnce({ rowCount: 1 })

    const result = await documentosService.uploadConteudo('doc-1', { fileName: '', contentBase64: '', usuarioLogin: 'uExec' })

    expect(query).toHaveBeenCalledTimes(5)
    const [sql, params] = query.mock.calls[4]
    expect(sql).toEqual(expect.stringContaining("SET modo = 'Upload'"))
    expect(params[0]).toBe('arquivo.bin')
    expect(params[1]).toBeNull()
    expect(params[2]).toBe('uExec')
    expect(result).toEqual({ ok: true, statusAnterior: 'assinado', assinante: 'uExec' })
  })

  it('retorna 404 quando UPDATE não afeta linhas', async () => {
    // 1: SELECT documento (rascunho)
    query.mockResolvedValueOnce({ rows: [{ status: 'rascunho', assinado_por: null }] })
    // 2: _validar -> SELECT processo vinculado
    query.mockResolvedValueOnce({ rows: [{ processoId: 'proc-1', atribuidoUsuario: '' }] })
    // 3: _validar -> SELECT setor do usuário
    query.mockResolvedValueOnce({ rows: [{ setor: 'TI' }] })
    // 4: _validar -> SELECT documentos do processo (doc no fim)
    query.mockResolvedValueOnce({ rows: [
      { id: 'doc-1', status: 'rascunho', criadoEm: '2024-01-01', assinanteSetor: null },
    ] })
    // 5: UPDATE sem efeito
    query.mockResolvedValueOnce({ rowCount: 0 })

    await expect(
      documentosService.uploadConteudo('doc-1', { fileName: 'a.pdf', contentBase64: 'abc', usuarioLogin: 'u1' })
    ).rejects.toMatchObject({ code: 404 })
    expect(query).toHaveBeenCalledTimes(5)
  })

  it('lança 400 quando documento não está vinculado a processo (rascunho)', async () => {
    // 1: SELECT documento (rascunho)
    query.mockResolvedValueOnce({ rows: [{ status: 'rascunho', assinado_por: null }] })
    // 2: _validar -> SELECT processo vinculado vazio
    query.mockResolvedValueOnce({ rows: [] })

    await expect(
      documentosService.uploadConteudo('doc-x', { fileName: 'a.pdf', contentBase64: 'abc', usuarioLogin: 'u1' })
    ).rejects.toMatchObject({ code: 400, message: expect.stringContaining('não está vinculado a um processo') })

    expect(query).toHaveBeenCalledTimes(2)
  })
})

describe('editorConteudo adicionais', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    query.mockReset()
  })

  it('exige usuarioLogin para rascunho', async () => {
    query.mockResolvedValueOnce({ rows: [{ status: 'rascunho', assinado_por: null }] })
    await expect(
      documentosService.editorConteudo('doc-1', { conteudo: 'x', usuarioLogin: '' })
    ).rejects.toMatchObject({ code: 400 })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('retorna 404 quando UPDATE não afeta linhas', async () => {
    // 1: SELECT documento (rascunho)
    query.mockResolvedValueOnce({ rows: [{ status: 'rascunho', assinado_por: null }] })
    // 2: _validar -> SELECT processo vinculado
    query.mockResolvedValueOnce({ rows: [{ processoId: 'proc-1', atribuidoUsuario: '' }] })
    // 3: _validar -> SELECT setor do usuário
    query.mockResolvedValueOnce({ rows: [{ setor: 'TI' }] })
    // 4: _validar -> SELECT documentos do processo (doc no fim)
    query.mockResolvedValueOnce({ rows: [
      { id: 'doc-1', status: 'rascunho', criadoEm: '2024-01-01', assinanteSetor: null },
    ] })
    // 5: UPDATE sem efeito
    query.mockResolvedValueOnce({ rowCount: 0 })

    await expect(
      documentosService.editorConteudo('doc-1', { conteudo: 'x', usuarioLogin: 'u1' })
    ).rejects.toMatchObject({ code: 404 })
    expect(query).toHaveBeenCalledTimes(5)
  })
})

describe('assinar adicionais', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    query.mockReset()
  })

  it('retorna 400 para Upload sem conteúdo', async () => {
    query.mockResolvedValueOnce({ rows: [{ status: 'rascunho', modo: 'Upload', file_name: '', content_base64: null }] })
    await expect(documentosService.assinar('doc-up-1', { usuarioLogin: 'uExec' })).rejects.toMatchObject({ code: 400 })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('retorna 400 para Upload com extensão inválida', async () => {
    query.mockResolvedValueOnce({ rows: [{ status: 'rascunho', modo: 'Upload', file_name: 'anexo.txt', content_base64: 'AAA' }] })
    await expect(documentosService.assinar('doc-up-2', { usuarioLogin: 'uExec' })).rejects.toMatchObject({ code: 400 })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('assina com sucesso em modo Editor no fim da árvore', async () => {
    // 1: SELECT documento
    query.mockResolvedValueOnce({ rows: [{ status: 'rascunho', modo: 'Editor', file_name: null, content_base64: null }] })
    // 2: _validar -> SELECT processo vinculado e atribuição
    query.mockResolvedValueOnce({ rows: [{ processoId: 'proc-1', atribuidoUsuario: 'uExec' }] })
    // 3: _validar -> SELECT setor do usuário
    query.mockResolvedValueOnce({ rows: [{ setor: 'TI' }] })
    // 4: _validar -> SELECT documentos do processo (doc atual no fim)
    query.mockResolvedValueOnce({ rows: [
      { id: 'doc-old', status: 'assinado', criadoEm: '2024-01-01', assinanteSetor: 'TI' },
      { id: 'doc-e1', status: 'rascunho', criadoEm: '2024-01-02', assinanteSetor: null },
    ] })
    // 5: UPDATE assinar
    query.mockResolvedValueOnce({ rowCount: 1 })
    // 6: SELECT getDocumentoById
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-e1', titulo: 'T', status: 'assinado', autorNome: 'Autor', assinadoPorLogin: 'uExec', assinadoEm: '2024-01-03', assinaturaNome: 'User Exec', assinaturaCargo: 'Agente' }] })

    const result = await documentosService.assinar('doc-e1', { usuarioLogin: 'uExec' })

    expect(query).toHaveBeenCalled()
    expect(result.ok).toBe(true)
    expect(result.documento.id).toBe('doc-e1')
    expect(result.documento.assinadoPorLogin).toBe('uExec')
  })

  it('retorna 404 quando UPDATE não afeta linhas (Editor)', async () => {
    // 1: SELECT documento
    query.mockResolvedValueOnce({ rows: [{ status: 'rascunho', modo: 'Editor' }] })
    // 2: _validar -> SELECT processo vinculado e atribuição
    query.mockResolvedValueOnce({ rows: [{ processoId: 'proc-2', atribuidoUsuario: 'uExec' }] })
    // 3: _validar -> SELECT setor do usuário
    query.mockResolvedValueOnce({ rows: [{ setor: 'TI' }] })
    // 4: _validar -> SELECT documentos (doc no fim)
    query.mockResolvedValueOnce({ rows: [
      { id: 'doc-e2', status: 'rascunho', criadoEm: '2024-01-02', assinanteSetor: null },
    ] })
    // 5: UPDATE assinar sem efeito
    query.mockResolvedValueOnce({ rowCount: 0 })

    await expect(documentosService.assinar('doc-e2', { usuarioLogin: 'uExec' })).rejects.toMatchObject({ code: 404 })
    expect(query).toHaveBeenCalled()
  })
})

describe('gerarPdfPublico adicionais (upload extensão não suportada)', () => {
  it('lança 415 no modo upload com extensão não suportada', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-5', titulo: 'Doc', status: 'assinado', modo: 'Upload', file_name: 'arquivo.txt', content_base64: 'abc', nivelAcesso: 'Público' }] })
    await expect(
      documentosService.gerarPdfPublico('doc-5')
    ).rejects.toMatchObject({ code: 415 })
  })
})

describe('editorConteudo adicionais (regras de autorização)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    query.mockReset()
  })

  it('impede editar assinado por outro usuário', async () => {
    query.mockResolvedValueOnce({ rows: [{ status: 'assinado', assinado_por: 'u2' }] })
    await expect(
      documentosService.editorConteudo('doc-1', { conteudo: 'x', usuarioLogin: 'u1' })
    ).rejects.toMatchObject({ code: 403 })
    expect(query).toHaveBeenCalled()
  })

  it('retorna 403 quando documento não está no fim da árvore (editor assinado)', async () => {
    // 1: SELECT documento assinado por u1
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-fim-1', titulo: 'Titulo Legal', status: 'assinado', assinado_por: 'u1' }] })
    // 2: _validar -> processo atribuído ao mesmo usuário
    query.mockResolvedValueOnce({ rows: [{ processoId: 'proc-1', vinculoId: 'v1', atribuidoUsuario: 'u1' }] })
    // 3: _validar -> setor do usuário
    query.mockResolvedValueOnce({ rows: [{ setor: 'TI' }] })
    // 4: _validar -> documentos do processo: primeiro é o nosso doc, segundo é assinado por outro setor
    query.mockResolvedValueOnce({
      rows: [
        { id: 'doc-fim-1', status: 'assinado', criadoEm: '2024-01-01', assinanteSetor: 'TI' },
        { id: 'doc-outro', status: 'assinado', criadoEm: '2024-01-02', assinanteSetor: 'ADM' },
      ],
    })

    await expect(
      documentosService.editorConteudo('doc-fim-1', { conteudo: 'novo', usuarioLogin: 'u1' })
    ).rejects.toMatchObject({ code: 403, message: expect.stringContaining('fim da árvore') })

    expect(query.mock.calls.length).toBeGreaterThanOrEqual(4)
  })
})

describe('uploadConteudo extra consolidação', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('lança 404 quando documento não existe', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await expect(
      documentosService.uploadConteudo('doc-404', { fileName: 'a.pdf', contentBase64: 'abc', usuarioLogin: 'u1' })
    ).rejects.toMatchObject({ code: 404 })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('exige usuarioLogin para rascunho', async () => {
    query.mockResolvedValueOnce({ rows: [{ status: 'rascunho', assinado_por: null }] })
    await expect(
      documentosService.uploadConteudo('doc-1', { fileName: 'a.pdf', contentBase64: 'abc', usuarioLogin: '' })
    ).rejects.toMatchObject({ code: 400 })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('atualiza conteúdo de rascunho no fim da árvore', async () => {
    // 1: SELECT documento
    query.mockResolvedValueOnce({ rows: [{ status: 'rascunho', assinado_por: null }] })
    // 2: _validar -> SELECT processo
    query.mockResolvedValueOnce({ rows: [{ processoId: 'proc-1', atribuidoUsuario: '' }] })
    // 3: _validar -> SELECT setor usuário
    query.mockResolvedValueOnce({ rows: [{ setor: 'TI' }] })
    // 4: _validar -> SELECT documentos do processo
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-1', status: 'rascunho', criadoEm: '2024-01-01', assinanteSetor: null }] })
    // 5: UPDATE documentos (modo Upload)
    query.mockResolvedValueOnce({ rowCount: 1 })

    const result = await documentosService.uploadConteudo('doc-1', {
      fileName: 'arquivo.pdf',
      contentBase64: 'abc',
      usuarioLogin: 'u1',
    })

    expect(query).toHaveBeenCalledTimes(5)
    const updateArgs = query.mock.calls[4]
    expect(updateArgs[0]).toEqual(expect.stringContaining("UPDATE documentos SET modo = 'Upload'"))
    expect(result).toEqual({ ok: true, statusAnterior: 'rascunho', assinante: null })
  })
})

describe('deletarRascunho não vinculado', () => {
  it('erro 400 quando documento não vinculado a processo', async () => {
    // 1: SELECT documento rascunho autor
    query.mockResolvedValueOnce({ rows: [{ status: 'rascunho', autor: 'u1' }] })
    // 2: SELECT processo vinculado vazio
    query.mockResolvedValueOnce({ rows: [] })
    await expect(documentosService.deletarRascunho('doc-1', { usuarioLogin: 'u1' })).rejects.toMatchObject({ code: 400 })
  })
})

describe('editorConteudo extra consolidação', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    query.mockReset()
  })

  it('lança 404 quando documento não existe', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await expect(
      documentosService.editorConteudo('doc-404', { conteudo: 'x', usuarioLogin: 'u1' })
    ).rejects.toMatchObject({ code: 404 })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('edita rascunho quando no fim da árvore', async () => {
    // 1: SELECT documento
    query.mockResolvedValueOnce({ rows: [{ status: 'rascunho', assinado_por: null }] })
    // 2: _validar -> SELECT processo
    query.mockResolvedValueOnce({ rows: [{ processoId: 'proc-1', atribuidoUsuario: '' }] })
    // 3: _validar -> SELECT setor usuário
    query.mockResolvedValueOnce({ rows: [{ setor: 'TI' }] })
    // 4: _validar -> SELECT documentos do processo
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-1', status: 'rascunho', criadoEm: '2024-01-01', assinanteSetor: null }] })
    // 5: UPDATE modo Editor
    query.mockResolvedValueOnce({ rowCount: 1 })

    const result = await documentosService.editorConteudo('doc-1', { conteudo: 'novo', usuarioLogin: 'u1' })
    const updateArgs = query.mock.calls[4]
    expect(updateArgs[0]).toEqual(expect.stringContaining("modo = 'Editor'"))
    expect(result).toEqual({ ok: true, statusAnterior: 'rascunho', assinante: null })
  })

  it('edita assinado quando usuário é o assinante e no fim da árvore', async () => {
    // 1: SELECT documento
    query.mockResolvedValueOnce({ rows: [{ status: 'assinado', assinado_por: 'u1' }] })
    // 2: _validar -> SELECT processo
    query.mockResolvedValueOnce({ rows: [{ processoId: 'proc-1', atribuidoUsuario: 'u1' }] })
    // 3: _validar -> SELECT setor usuário
    query.mockResolvedValueOnce({ rows: [{ setor: 'TI' }] })
    // 4: _validar -> SELECT documentos do processo
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-1', status: 'assinado', criadoEm: '2024-01-01', assinanteSetor: 'TI' }] })
    // 5: UPDATE modo Editor
    query.mockResolvedValueOnce({ rowCount: 1 })

    const result = await documentosService.editorConteudo('doc-1', { conteudo: 'novo', usuarioLogin: 'u1' })
    const updateArgs = query.mock.calls[4]
    expect(updateArgs[0]).toEqual(expect.stringContaining("modo = 'Editor'"))
    expect(result).toEqual({ ok: true, statusAnterior: 'assinado', assinante: 'u1' })
  })

  it('retorna 400 quando processo não está atribuído ao editar assinado', async () => {
    query.mockReset()
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-atrib-1', titulo: 'Doc Atrib', status: 'assinado', assinado_por: 'u1' }] })
    query.mockResolvedValueOnce({ rows: [{ processoId: 'proc-1', vinculoId: 'v1', atribuidoUsuario: '' }] })

    await expect(
      documentosService.editorConteudo('doc-atrib-1', { usuarioLogin: 'u1', conteudo: 'x' })
    ).rejects.toMatchObject({ code: 400, message: expect.stringContaining('não está atribuído') })

    expect(query).toHaveBeenCalledTimes(2)
  })

  it('retorna 403 quando processo está atribuído a outro usuário ao editar assinado', async () => {
    query.mockReset()
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-atrib-2', titulo: 'Doc Atrib 2', status: 'assinado', assinado_por: 'u1' }] })
    query.mockResolvedValueOnce({ rows: [{ processoId: 'proc-2', vinculoId: 'v2', atribuidoUsuario: 'u2' }] })

    await expect(
      documentosService.editorConteudo('doc-atrib-2', { usuarioLogin: 'u1', conteudo: 'y' })
    ).rejects.toMatchObject({ code: 403, message: expect.stringContaining('processo atribuído a você') })

    expect(query).toHaveBeenCalledTimes(2)
  })
})

describe('editorConteudo casos de borda (fim da árvore)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    query.mockReset()
  })

  it('permite editar rascunho quando há assinatura anterior de outro setor e doc está em endStart', async () => {
    // 1: SELECT documento
    query.mockResolvedValueOnce({ rows: [{ status: 'rascunho', assinado_por_login: null }] })
    // 2: _validar -> SELECT processo (sem exigência de atribuição para rascunho)
    query.mockResolvedValueOnce({ rows: [{ processoId: 'proc-1', atribuidoUsuario: '' }] })
    // 3: _validar -> SELECT setor usuário
    query.mockResolvedValueOnce({ rows: [{ setor: 'TI' }] })
    // 4: _validar -> SELECT documentos do processo, com um assinado de outro setor antes e nosso doc na posição endStart
    query.mockResolvedValueOnce({
      rows: [
        { id: 'doc-old', status: 'assinado', criadoEm: '2024-01-01', assinanteSetor: 'ADM' },
        { id: 'doc-new', status: 'rascunho', criadoEm: '2024-01-02', assinanteSetor: null },
      ],
    })
    // 5: UPDATE modo Editor
    query.mockResolvedValueOnce({ rowCount: 1 })

    const result = await documentosService.editorConteudo('doc-new', { conteudo: 'novo', usuarioLogin: 'uTI' })

    expect(query).toHaveBeenCalledTimes(5)
    const updateArgs = query.mock.calls[4]
    expect(updateArgs[0]).toEqual(expect.stringContaining("modo = 'Editor'"))
    expect(result).toEqual({ ok: true, statusAnterior: 'rascunho', assinante: null })
  })

  it('permite edição quando assinatura anterior é do mesmo setor (não conta como cross)', async () => {
    // 1: SELECT documento
    query.mockResolvedValueOnce({ rows: [{ status: 'rascunho', assinado_por_login: null }] })
    // 2: _validar -> SELECT processo
    query.mockResolvedValueOnce({ rows: [{ processoId: 'proc-2', atribuidoUsuario: '' }] })
    // 3: _validar -> SELECT setor usuário
    query.mockResolvedValueOnce({ rows: [{ setor: 'TI' }] })
    // 4: _validar -> SELECT documentos do processo: assinatura anterior do mesmo setor não conta como cross
    query.mockResolvedValueOnce({
      rows: [
        { id: 'doc-signed', status: 'assinado', criadoEm: '2024-01-01', assinanteSetor: 'TI' },
        { id: 'doc-edit', status: 'rascunho', criadoEm: '2024-01-02', assinanteSetor: null },
      ],
    })
    // 5: UPDATE modo Editor
    query.mockResolvedValueOnce({ rowCount: 1 })

    const result = await documentosService.editorConteudo('doc-edit', { conteudo: 'conteúdo', usuarioLogin: 'uTI' })

    expect(query).toHaveBeenCalledTimes(5)
    const updateArgs = query.mock.calls[4]
    expect(updateArgs[0]).toEqual(expect.stringContaining("modo = 'Editor'"))
    expect(result).toEqual({ ok: true, statusAnterior: 'rascunho', assinante: null })
  })
})

describe('documentosService - seedByProcesso', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    query.mockReset()
  })

  it('lança 404 quando processo não existe', async () => {
    // SELECT processo
    query.mockResolvedValueOnce({ rows: [] })
    await expect(documentosService.seedByProcesso('proc-404')).rejects.toMatchObject({ code: 404 })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('retorna seeded:false quando já há documentos vinculados', async () => {
    // 1: SELECT processo
    query.mockResolvedValueOnce({ rows: [{ id: 'proc-1', setorAtual: 'TI', atribuidoUsuario: '' }] })
    // 2: SELECT processo_documentos existe
    query.mockResolvedValueOnce({ rows: [{ documento_id: 'doc-exists' }] })

    const result = await documentosService.seedByProcesso('proc-1')
    expect(result).toEqual({ ok: true, seeded: false })
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('semeia documento com autor do setor quando não há atribuído e autorLogin ausente', async () => {
    // 1: SELECT processo (sem atribuído)
    query.mockResolvedValueOnce({ rows: [{ id: 'proc-1', setorAtual: 'TI', atribuidoUsuario: '' }] })
    // 2: SELECT processo_documentos vazio
    query.mockResolvedValueOnce({ rows: [] })
    // 3: SELECT usuários por setor
    query.mockResolvedValueOnce({ rows: [{ login: 'uSetor1' }] })
    // 4: INSERT documentos
    query.mockResolvedValueOnce({})
    // 5: SELECT documento recém-criado
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-123' }] })
    // 6: INSERT vinculo processo_documentos
    query.mockResolvedValueOnce({ rowCount: 1 })

    const result = await documentosService.seedByProcesso('proc-1')

    // Verifica que autorLogin usado no INSERT documentos é do setor
    expect(query.mock.calls[3][0]).toEqual(expect.stringContaining('INSERT INTO documentos'))
    expect(query.mock.calls[3][1][5]).toBe('uSetor1')

    expect(query).toHaveBeenCalledTimes(6)
    expect(query.mock.calls[5][0]).toEqual(expect.stringContaining('INSERT INTO processo_documentos'))
    expect(result).toEqual({ ok: true, seeded: true, documentoId: 'doc-123' })
  })

  it('usa autorLogin fornecido sem consultar usuários de setor', async () => {
    // 1: SELECT processo
    query.mockResolvedValueOnce({ rows: [{ id: 'proc-1', setorAtual: 'TI', atribuidoUsuario: '' }] })
    // 2: SELECT processo_documentos vazio
    query.mockResolvedValueOnce({ rows: [] })
    // 3: INSERT documentos
    query.mockResolvedValueOnce({})
    // 4: SELECT documento recém-criado
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-123' }] })
    // 5: INSERT vinculo
    query.mockResolvedValueOnce({ rowCount: 1 })

    const result = await documentosService.seedByProcesso('proc-1', { autorLogin: 'autorX' })

    // Não deve haver SELECT de usuários por setor
    const sqls = query.mock.calls.map(c => c[0])
    expect(sqls.some(s => String(s).includes('SELECT login FROM usuarios'))).toBe(false)

    // Verifica autorLogin no INSERT documentos
    expect(query.mock.calls[2][0]).toEqual(expect.stringContaining('INSERT INTO documentos'))
    expect(query.mock.calls[2][1][5]).toBe('autorX')

    expect(query).toHaveBeenCalledTimes(5)
    expect(result).toEqual({ ok: true, seeded: true, documentoId: 'doc-123' })
  })

  it('usa atribuido_usuario como autor quando presente e autorLogin não fornecido', async () => {
    // 1: SELECT processo (atribuído)
    query.mockResolvedValueOnce({ rows: [{ id: 'proc-2', setorAtual: 'TI', atribuidoUsuario: 'uAtrib' }] })
    // 2: SELECT processo_documentos vazio
    query.mockResolvedValueOnce({ rows: [] })
    // 3: INSERT documentos
    query.mockResolvedValueOnce({})
    // 4: SELECT documento recém-criado
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-123' }] })
    // 5: INSERT vinculo
    query.mockResolvedValueOnce({ rowCount: 1 })

    const result = await documentosService.seedByProcesso('proc-2')

    expect(query.mock.calls[2][0]).toEqual(expect.stringContaining('INSERT INTO documentos'))
    expect(query.mock.calls[2][1][5]).toBe('uAtrib')

    expect(query).toHaveBeenCalledTimes(5)
    expect(result).toEqual({ ok: true, seeded: true, documentoId: 'doc-123' })
  })
})