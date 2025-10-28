jest.mock('../../db', () => ({
  query: jest.fn(),
}))

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'new-doc-id'),
}))

jest.mock('../processosService', () => ({
  createProcesso: jest.fn(),
}))

const { query } = require('../../db')
const { v4 } = require('uuid')
const processosService = require('../processosService')
const externoService = require('../externoService')

describe('externoService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    query.mockReset()
  })

  describe('listProcessosPorParteCredencial', () => {
    it('valida CPF e chave obrigatórios (400)', async () => {
      await expect(externoService.listProcessosPorParteCredencial('', '')).rejects.toMatchObject({ code: 400 })
      expect(query).not.toHaveBeenCalled()
    })

    it('lista processos quando credenciais válidas', async () => {
      const rows = [{ id: 'p1', numero: '0001', meuPapel: 'Interessado', meuNome: 'Fulano' }]
      query.mockResolvedValueOnce({ rows })
      const result = await externoService.listProcessosPorParteCredencial('123', 'abc')
      expect(query).toHaveBeenCalledTimes(1)
      const [sql, params] = query.mock.calls[0]
      expect(sql).toEqual(expect.stringContaining('FROM processos p'))
      expect(sql).toEqual(expect.stringContaining('JOIN processo_partes'))
      expect(sql).toEqual(expect.stringContaining('JOIN cadastro_partes'))
      expect(params).toEqual(['123', 'abc'])
      expect(result).toEqual(rows)
    })
  })

  describe('listarDocumentosExternosTemporarios', () => {
    it('lista documentos da parte após validar processo/parte', async () => {
      // _validarParteProcesso -> SELECT validação
      query.mockResolvedValueOnce({ rows: [{ processoId: 'proc-1', parteId: 'parte-1' }] })
      // SELECT externo_documentos_temp
      const docs = [{ id: 't1', fileName: 'a.pdf', status: 'aguardando_analise', criadoEm: '2024-01-01' }]
      query.mockResolvedValueOnce({ rows: docs })

      const result = await externoService.listarDocumentosExternosTemporarios('0001', '123', 'abc')
      expect(query).toHaveBeenCalledTimes(2)
      const [sqlList, paramsList] = query.mock.calls[1]
      expect(sqlList).toEqual(expect.stringContaining('FROM externo_documentos_temp'))
      expect(paramsList).toEqual(['proc-1', 'parte-1'])
      expect(result).toEqual(docs)
    })
  })

  describe('anexarDocumentoExternoTemporario', () => {
    it('valida arquivo e conteúdo obrigatórios (400)', async () => {
      // _validarParteProcesso é chamado antes da validação de arquivo
      query.mockResolvedValueOnce({ rows: [{ processoId: 'proc-1', parteId: 'parte-1' }] })
      await expect(externoService.anexarDocumentoExternoTemporario('0001', '123', 'abc', '', '')).rejects.toMatchObject({ code: 400 })
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('anexa e retorna dados do temporário criado', async () => {
      // 1: _validarParteProcesso
      query.mockResolvedValueOnce({ rows: [{ processoId: 'proc-1', parteId: 'parte-1' }] })
      // 2: INSERT externo_documentos_temp
      query.mockResolvedValueOnce({})
      // 3: SELECT por id
      const row = { id: 'new-doc-id', fileName: 'b.pdf', status: 'aguardando_analise', criadoEm: '2024-01-02' }
      query.mockResolvedValueOnce({ rows: [row] })

      const result = await externoService.anexarDocumentoExternoTemporario('0001', '123', 'abc', 'b.pdf', 'xyz', 'Titulo')

      expect(query).toHaveBeenCalledTimes(3)
      const insertArgs = query.mock.calls[1]
      expect(insertArgs[0]).toEqual(expect.stringContaining('INSERT INTO externo_documentos_temp'))
      expect(insertArgs[1]).toEqual(['new-doc-id', 'proc-1', 'parte-1', 'b.pdf', 'xyz', 'Titulo'])
      expect(result).toEqual(row)
      expect(v4).toHaveBeenCalled()
    })
  })

  describe('listarDocumentosExternosPorProcesso', () => {
    it('valida processoId obrigatório (400)', async () => {
      await expect(externoService.listarDocumentosExternosPorProcesso('', {})).rejects.toMatchObject({ code: 400 })
      expect(query).not.toHaveBeenCalled()
    })

    it('lista por processo sem filtro de status', async () => {
      const rows = [{ id: 't1', fileName: 'a.pdf', status: 'aguardando_analise' }]
      query.mockResolvedValueOnce({ rows })
      const result = await externoService.listarDocumentosExternosPorProcesso('proc-1')
      expect(query).toHaveBeenCalledTimes(1)
      const [sql, params] = query.mock.calls[0]
      expect(sql).toEqual(expect.stringContaining('FROM externo_documentos_temp edt'))
      expect(sql).toEqual(expect.stringContaining('ORDER BY edt.criado_em DESC'))
      expect(params).toEqual(['proc-1'])
      expect(result).toEqual(rows)
    })

    it('aplica filtro de status quando informado', async () => {
      const rows = [{ id: 't2', status: 'juntado' }]
      query.mockResolvedValueOnce({ rows })
      const result = await externoService.listarDocumentosExternosPorProcesso('proc-1', { status: 'juntado' })
      expect(query).toHaveBeenCalledTimes(1)
      const [sql, params] = query.mock.calls[0]
      expect(sql).toEqual(expect.stringContaining('LOWER(edt.status) = $2'))
      expect(params).toEqual(['proc-1', 'juntado'])
      expect(result).toEqual(rows)
    })
  })

  describe('getDocumentoTemporario', () => {
    it('valida processoId e tempId obrigatórios (400)', async () => {
      await expect(externoService.getDocumentoTemporario('', '')).rejects.toMatchObject({ code: 400 })
      expect(query).not.toHaveBeenCalled()
    })

    it('lança 404 quando não encontra', async () => {
      query.mockResolvedValueOnce({ rows: [] })
      await expect(externoService.getDocumentoTemporario('proc-x', 'temp-x')).rejects.toMatchObject({ code: 404 })
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('retorna objeto quando encontra', async () => {
      const row = { id: 'temp-1', processoId: 'proc-1', fileName: 'a.pdf' }
      query.mockResolvedValueOnce({ rows: [row] })
      const result = await externoService.getDocumentoTemporario('proc-1', 'temp-1')
      expect(query).toHaveBeenCalledTimes(1)
      expect(result).toEqual(row)
    })
  })

  describe('aceitarDocumentoTemporario', () => {
    it('lança 409 quando documento já analisado', async () => {
      // getDocumentoTemporario -> retorna status diferente
      query.mockResolvedValueOnce({ rows: [{ id: 't1', status: 'rejeitado', fileName: 'a.pdf', contentBase64: 'x', parteId: 'p1' }] })
      await expect(externoService.aceitarDocumentoTemporario('proc-1', 't1')).rejects.toMatchObject({ code: 409 })
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('aceita e junta documento ao processo', async () => {
      // 1: getDocumentoTemporario -> status aguardando_analise
      query.mockResolvedValueOnce({ rows: [{ id: 't1', status: 'aguardando_analise', fileName: 'a.pdf', contentBase64: 'base', parteId: 'p1', titulo: 'Ext' }] })
      // 2: INSERT documentos
      query.mockResolvedValueOnce({})
      // 3: INSERT processo_documentos
      query.mockResolvedValueOnce({})
      // 4: UPDATE externo_documentos_temp
      query.mockResolvedValueOnce({})

      const result = await externoService.aceitarDocumentoTemporario('proc-1', 't1')

      expect(query).toHaveBeenCalledTimes(4)
      const insertDocArgs = query.mock.calls[1]
      expect(insertDocArgs[0]).toEqual(expect.stringContaining('INSERT INTO documentos'))
      expect(insertDocArgs[1]).toEqual(['new-doc-id', 'Ext', 'Documento', 'a.pdf', 'base', 'p1'])
      const linkArgs = query.mock.calls[2]
      expect(linkArgs[0]).toEqual(expect.stringContaining('INSERT INTO processo_documentos'))
      expect(linkArgs[1]).toEqual(['proc-1', 'new-doc-id'])
      const updArgs = query.mock.calls[3]
      expect(updArgs[0]).toEqual(expect.stringContaining('UPDATE externo_documentos_temp'))
      expect(result).toEqual({ ok: true, documentoId: 'new-doc-id' })
    })
  })

  describe('rejeitarDocumentoTemporario', () => {
    it('valida motivo obrigatório (400)', async () => {
      // getDocumentoTemporario -> status aguardando
      query.mockResolvedValueOnce({ rows: [{ id: 't1', status: 'aguardando_analise' }] })
      await expect(externoService.rejeitarDocumentoTemporario('proc-1', 't1', '')).rejects.toMatchObject({ code: 400 })
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('lança 409 quando documento já analisado', async () => {
      query.mockResolvedValueOnce({ rows: [{ id: 't1', status: 'juntado' }] })
      await expect(externoService.rejeitarDocumentoTemporario('proc-1', 't1', 'motivo')).rejects.toMatchObject({ code: 409 })
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('rejeita com motivo e retorna ok', async () => {
      // 1: getDocumentoTemporario aguardando
      query.mockResolvedValueOnce({ rows: [{ id: 't1', status: 'aguardando_analise' }] })
      // 2: update rejeitado
      query.mockResolvedValueOnce({})
      const result = await externoService.rejeitarDocumentoTemporario('proc-1', 't1', 'ruído')
      expect(query).toHaveBeenCalledTimes(2)
      const updArgs = query.mock.calls[1]
      expect(updArgs[0]).toEqual(expect.stringContaining('UPDATE externo_documentos_temp SET status ='))
      expect(updArgs[1]).toEqual(['t1', 'ruído'])
      expect(result).toEqual({ ok: true })
    })
  })

  describe('criarProcessoExterno', () => {
    it('valida CPF/chave e assunto obrigatórios (400)', async () => {
      await expect(externoService.criarProcessoExterno('', '', { assunto: '', tipoId: null, observacoes: '' })).rejects.toMatchObject({ code: 400 })
      expect(query).not.toHaveBeenCalled()
    })

    it('lança 404 quando parte não encontrada ou credencial inválida', async () => {
      // SELECT cadastro_partes
      query.mockResolvedValueOnce({ rows: [] })
      await expect(externoService.criarProcessoExterno('123', 'abc', { assunto: 'Teste', tipoId: null, observacoes: '' })).rejects.toMatchObject({ code: 404 })
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('cria processo com usuário externo e atualiza status inicial', async () => {
      // 1: SELECT cadastro_partes
      query.mockResolvedValueOnce({ rows: [{ id: 'cad-1', nome: 'Fulano' }] })
      // 2: processosService.createProcesso
      processosService.createProcesso.mockResolvedValueOnce({ id: 'proc-new', numero: '2024/0001', assunto: 'Teste' })
      // 3: UPDATE processos
      query.mockResolvedValueOnce({})

      const result = await externoService.criarProcessoExterno('123', 'abc', { assunto: 'Teste', tipoId: 'tp1', observacoes: 'Obs' })

      expect(query).toHaveBeenCalledTimes(2)
      expect(processosService.createProcesso).toHaveBeenCalledTimes(1)
      const updateArgs = query.mock.calls[1]
      expect(updateArgs[0]).toEqual(expect.stringContaining('UPDATE processos'))
      expect(updateArgs[1]).toEqual(['proc-new'])
      expect(result).toEqual({ id: 'proc-new', numero: '2024/0001', assunto: 'Teste' })
    })
  })
})