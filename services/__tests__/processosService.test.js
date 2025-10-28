jest.mock('../../db', () => ({
  query: jest.fn(),
}))

const { query } = require('../../db')

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'uuid-1'),
}))

const { v4: uuidv4 } = require('uuid')
const processosService = require('../processosService')

describe('processosService', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  describe('getProcessoById', () => {
    it('retorna null quando processo não encontrado', async () => {
      query.mockResolvedValueOnce({ rows: [] })
      const result = await processosService.getProcessoById('proc-404')
      expect(query).toHaveBeenCalledTimes(1)
      expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE p.id = $1'), [
        'proc-404',
      ])
      expect(result).toBeNull()
    })

    it('retorna processo com partes', async () => {
      const procRow = {
        id: 'proc-1',
        numero: '20240101-000000-001',
        assunto: 'Teste',
        tipo: 'Processo',
        nivelAcesso: 'Público',
        baseLegal: null,
        observacoes: '',
        status: 'Em instrução',
        prioridade: 'Normal',
        prazo: null,
        setor: 'PROTOCOLO',
        atribuidoA: null,
        criadoEm: '2024-01-01T00:00:00.000Z',
        ultimaMovimentacao: '2024-01-01T00:00:00.000Z',
      }
      const partesRows = [
        { id: 'p1', tipo: 'Pessoa', nome: 'Alice', documento: '123', papel: 'Interessado' },
      ]
      query.mockResolvedValueOnce({ rows: [procRow] }).mockResolvedValueOnce({ rows: partesRows })

      const result = await processosService.getProcessoById('proc-1')

      expect(query).toHaveBeenCalledTimes(2)
      expect(query.mock.calls[0][0]).toEqual(expect.stringContaining('SELECT p.id'))
      expect(query.mock.calls[1][0]).toEqual(expect.stringContaining('FROM processo_partes'))
      expect(result).toEqual({ ...procRow, partes: partesRows })
    })
  })

  describe('createProcesso', () => {
    it('exige assunto obrigatório', async () => {
      await expect(processosService.createProcesso({ assunto: '' })).rejects.toThrow(
        'Assunto é obrigatório',
      )
      expect(query).not.toHaveBeenCalled()
    })

    it('exige base legal quando nivelAcesso não é Público', async () => {
      await expect(
        processosService.createProcesso({ assunto: 'A', nivelAcesso: 'Restrito' }),
      ).rejects.toMatchObject({ code: 400 })
      expect(query).not.toHaveBeenCalled()
    })

    it('cria processo com defaults, insere partes e documentos, e retorna view', async () => {
    // Preparar UUIDs previsíveis
    uuidv4
      .mockReturnValueOnce('proc-123') // id do processo
      .mockReturnValueOnce('parte-1')
      .mockReturnValueOnce('parte-2')

    // BEGIN
    query.mockResolvedValueOnce({})
    // INSERT processos
    query.mockResolvedValueOnce({})
    // INSERT cadastro_partes (2 partes)
    query.mockResolvedValueOnce({})
    query.mockResolvedValueOnce({})
    // INSERT processo_partes (2 partes)
    query.mockResolvedValueOnce({})
    query.mockResolvedValueOnce({})
    // INSERT processo_documentos (2 documentos)
    query.mockResolvedValueOnce({})
    query.mockResolvedValueOnce({})
    // SELECT setor_atual
    query.mockResolvedValueOnce({ rows: [{ setor_atual: 'PROTOCOLO' }] })
    // INSERT tramites (andamento inicial)
    query.mockResolvedValueOnce({})
    // COMMIT
    query.mockResolvedValueOnce({})
    // SELECT interessado
    query.mockResolvedValueOnce({ rows: [{ nome: 'Alice' }] })

    const result = await processosService.createProcesso({
      assunto: 'Assunto X',
      observacoes: undefined,
      partes: [
        { tipo: 'Pessoa', nome: 'Alice', documento: '123', papel: 'Interessado' },
        { tipo: 'Pessoa', nome: 'Bob', documento: '456', papel: 'Interessado' },
      ],
      documentosIds: ['doc-1', 'doc-2'],
      executadoPor: 'user1',
    })

    // Verificar chamadas
    expect(query).toHaveBeenCalledTimes(12)
    expect(query.mock.calls[0][0]).toBe('BEGIN')
    expect(query.mock.calls[1][0]).toEqual(expect.stringContaining('INSERT INTO processos'))
    const insertProcParams = query.mock.calls[1][1]
    expect(insertProcParams[0]).toBe('proc-123')
    expect(insertProcParams[1]).toEqual(expect.stringMatching(/^\d{8}-\d{6}-\d{3}$/))
    expect(insertProcParams[2]).toBe('Assunto X')
    // nivel_acesso default
    expect(insertProcParams[3]).toBe('Público')
    // base_legal default
    expect(insertProcParams[4]).toBeNull()
    // observacoes default
    expect(insertProcParams[5]).toBe('')
    // atribuido_usuario
    expect(insertProcParams[6]).toBe('user1')
    // tipo_id default
    expect(insertProcParams[7]).toBeNull()

    // Inserts de cadastro_partes + processo_partes
    expect(query.mock.calls[2][0]).toEqual(expect.stringContaining('INSERT INTO cadastro_partes'))
    expect(query.mock.calls[3][0]).toEqual(expect.stringContaining('INSERT INTO processo_partes'))
    expect(query.mock.calls[4][0]).toEqual(expect.stringContaining('INSERT INTO cadastro_partes'))
    expect(query.mock.calls[5][0]).toEqual(expect.stringContaining('INSERT INTO processo_partes'))

    // Inserts de documentos
    expect(query.mock.calls[6][0]).toEqual(
      expect.stringContaining('INSERT INTO processo_documentos'),
    )
    expect(query.mock.calls[7][0]).toEqual(
      expect.stringContaining('INSERT INTO processo_documentos'),
    )

    // Andamento inicial
    const sqls = query.mock.calls.map(c => c[0])
    expect(sqls.some(s => s.includes('INSERT INTO tramites'))).toBe(true)

    expect(query.mock.calls[10][0]).toBe('COMMIT')
    expect(query.mock.calls[11][0]).toEqual(expect.stringContaining('SELECT cp.nome'))
    expect(query.mock.calls[11][0]).toEqual(expect.stringContaining('FROM processo_partes pp'))

    // Verificar retorno
    expect(result.id).toBe('proc-123')
    expect(result.numero).toEqual(expect.stringMatching(/^\d{8}-\d{6}-\d{3}$/))
    expect(result.assunto).toBe('Assunto X')
    expect(result.tipo).toBe('Processo')
    expect(result.nivelAcesso).toBe('Público')
    expect(result.baseLegal).toBeNull()
    expect(result.observacoes).toBe('')
    expect(result.interessado).toBe('Alice')
    expect(result.setor).toBe('PROTOCOLO')
    expect(result.status).toBe('Em instrução')
    expect(result.prioridade).toBe('Normal')
    expect(result.atribuidoA).toBe('user1')
  })

    it('retorna 404 quando partes inclui parteId inexistente', async () => {
      // BEGIN
      query.mockResolvedValueOnce({})
      // INSERT processos
      query.mockResolvedValueOnce({})
      // SELECT cadastro_partes pelo parteId (não encontrado)
      query.mockResolvedValueOnce({ rows: [] })

      await expect(
        processosService.createProcesso({
          assunto: 'Assunto', nivelAcesso: 'Público', executadoPor: 'uExec',
          partes: [{ parteId: 'cad-inexistente', papel: 'Interessado' }],
        }),
      ).rejects.toMatchObject({ code: 404 })

      const sqls = query.mock.calls.map(c => c[0])
      expect(query).toHaveBeenCalledTimes(3)
      expect(sqls[0]).toBe('BEGIN')
      expect(sqls[1]).toEqual(expect.stringContaining('INSERT INTO processos'))
      expect(sqls[2]).toEqual(expect.stringContaining('SELECT id FROM cadastro_partes'))
      expect(sqls.some(s => s === 'COMMIT')).toBe(false)
    })

    it('vincula parte existente via parteId sem criar cadastro', async () => {
      // BEGIN
      query.mockResolvedValueOnce({})
      // INSERT processos
      query.mockResolvedValueOnce({})
      // SELECT cadastro_partes pelo parteId (encontrado)
      query.mockResolvedValueOnce({ rows: [{ id: 'cad-1' }] })
      // INSERT processo_partes
      query.mockResolvedValueOnce({})
      // SELECT setor_atual
      query.mockResolvedValueOnce({ rows: [{ setor_atual: 'PROTOCOLO' }] })
      // INSERT tramite inicial
      query.mockResolvedValueOnce({})
      // COMMIT
      query.mockResolvedValueOnce({})
      // SELECT primeiro interessado
      query.mockResolvedValueOnce({ rows: [{ nome: 'João' }] })

      const view = await processosService.createProcesso({
        assunto: 'Assunto', tipo: 'Processo', nivelAcesso: 'Público', observacoes: '',
        partes: [{ parteId: 'cad-1', papel: 'Interessado' }],
        executadoPor: 'uExec', documentosIds: [],
      })

      const sqls = query.mock.calls.map(c => c[0])
      expect(sqls.some(s => s.includes('INSERT INTO cadastro_partes'))).toBe(false)
      expect(sqls.some(s => s.includes('INSERT INTO processo_partes'))).toBe(true)
      expect(sqls.some(s => s === 'COMMIT')).toBe(true)
      expect(view.interessado).toBe('João')
      expect(view.setor).toBe('PROTOCOLO')
      expect(view.prioridade).toBe('Normal')
    })
  })

  describe('updateDados', () => {
    it('retorna 404 quando processo não existe', async () => {
      // SELECT inicial
      query.mockResolvedValueOnce({ rows: [] })
      await expect(
        processosService.updateDados('proc-404', { assunto: 'Novo' }),
      ).rejects.toMatchObject({ status: 404 })
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('valida base legal quando nivelAcesso diferente de Público', async () => {
      // SELECT atual
      query.mockResolvedValueOnce({ rows: [{ nivel_acesso: 'Público', base_legal: null }] })
      // SELECT partes (getProcessoById chama listarPartesDoProcesso quando encontra o processo)
      query.mockResolvedValueOnce({ rows: [] })
      await expect(
        processosService.updateDados('proc-1', { nivelAcesso: 'Restrito' }),
      ).rejects.toMatchObject({ status: 400 })
      expect(query).toHaveBeenCalledTimes(2)
    })

    it('atualiza dados e retorna o processo atualizado', async () => {
      // SELECT atual
      query.mockResolvedValueOnce({ rows: [{ nivel_acesso: 'Público', base_legal: null }] })
      // SELECT partes
      query.mockResolvedValueOnce({ rows: [] })
      // UPDATE
      query.mockResolvedValueOnce({})
      // SELECT retorno
      const updatedRow = {
        id: 'proc-1',
        numero: '20240101-000000-001',
        assunto: 'Novo',
        tipo: 'Processo',
        nivelAcesso: 'Público',
        baseLegal: null,
        observacoes: 'Obs',
        status: 'Em instrução',
        prioridade: 'Alta',
        prazo: '2024-12-31',
        setor: 'PROTOCOLO',
        atribuidoA: null,
        criadoEm: '2024-01-01T00:00:00.000Z',
        ultimaMovimentacao: '2024-01-01T00:00:00.000Z',
      }
      query.mockResolvedValueOnce({ rows: [updatedRow] })

      const result = await processosService.updateDados('proc-1', {
        assunto: 'Novo',
        nivelAcesso: 'Público',
        observacoes: 'Obs',
        baseLegal: null,
      })

      expect(query).toHaveBeenCalledTimes(4)
      expect(query.mock.calls[2][0]).toEqual(expect.stringContaining('UPDATE processos'))
      expect(query.mock.calls[3][0]).toEqual(expect.stringContaining('SELECT p.id'))
      expect(result).toEqual(updatedRow)
    })
  })

  describe('atribuir', () => {
    it('valida usuário e executor obrigatórios', async () => {
      await expect(
        processosService.atribuir('proc-1', { executadoPor: 'uExec' }),
      ).rejects.toMatchObject({ code: 400 })
      await expect(processosService.atribuir('proc-1', { usuario: 'uDest' })).rejects.toMatchObject(
        { code: 400 },
      )
      expect(query).not.toHaveBeenCalled()
    })

    it('retorna 404 quando processo não existe', async () => {
      query.mockResolvedValueOnce({ rows: [] })
      await expect(
        processosService.atribuir('proc-404', { usuario: 'uDest', executadoPor: 'uExec' }),
      ).rejects.toMatchObject({ code: 404 })
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('retorna 403 quando processo não está atribuído ao executor', async () => {
      query.mockResolvedValueOnce({ rows: [{ setor_atual: 'TI', atribuido_usuario: 'outro' }] })
      await expect(
        processosService.atribuir('proc-1', { usuario: 'uDest', executadoPor: 'uExec' }),
      ).rejects.toMatchObject({ code: 403 })
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('retorna 400 quando usuário destino não existe', async () => {
      // SELECT processo
      query.mockResolvedValueOnce({ rows: [{ setor_atual: 'TI', atribuido_usuario: 'uExec' }] })
      // SELECT usuário
      query.mockResolvedValueOnce({ rows: [] })
      await expect(
        processosService.atribuir('proc-1', { usuario: 'uDest', executadoPor: 'uExec' }),
      ).rejects.toMatchObject({ code: 400 })
      expect(query).toHaveBeenCalledTimes(2)
    })

    it('retorna 400 quando setor do usuário destino difere do setor atual', async () => {
      // SELECT processo
      query.mockResolvedValueOnce({ rows: [{ setor_atual: 'TI', atribuido_usuario: 'uExec' }] })
      // SELECT usuário
      query.mockResolvedValueOnce({ rows: [{ setor: 'PROTOCOLO' }] })
      await expect(
        processosService.atribuir('proc-1', { usuario: 'uDest', executadoPor: 'uExec' }),
      ).rejects.toMatchObject({ code: 400 })
      expect(query).toHaveBeenCalledTimes(2)
    })

    it('atribui com sucesso e retorna processo e detalhes', async () => {
      // SELECT processo
      query.mockResolvedValueOnce({ rows: [{ setor_atual: 'TI', atribuido_usuario: 'uExec' }] })
      // SELECT usuário
      query.mockResolvedValueOnce({ rows: [{ setor: 'TI' }] })
      // UPDATE
      query.mockResolvedValueOnce({ rowCount: 1 })
      // SELECT retorno
      const procRow = {
        id: 'proc-1',
        numero: 'N',
        assunto: 'A',
        status: 'Em instrução',
        prioridade: 'Normal',
        prazo: null,
        nivelAcesso: 'Público',
        setor: 'TI',
        atribuidoA: 'uDest',
        criadoEm: '2024-01-01T00:00:00.000Z',
        ultimaMovimentacao: '2024-01-01T00:00:00.000Z',
      }
      query.mockResolvedValueOnce({ rows: [procRow] })

      const result = await processosService.atribuir('proc-1', {
        usuario: 'uDest',
        executadoPor: 'uExec',
      })

      expect(query).toHaveBeenCalledTimes(4)
      expect(query.mock.calls[2]).toEqual([
        expect.stringContaining('UPDATE processos SET atribuido_usuario = $1'),
        ['uDest', 'proc-1'],
      ])
      expect(result).toEqual({ processo: procRow, detalhes: { de: 'uExec', para: 'uDest' } })
    })

    it('retorna 403 quando processo restrito e destino não possui acesso', async () => {
      // SELECT processo com acesso restrito
      query.mockResolvedValueOnce({ rows: [{ setor_atual: 'TI', atribuido_usuario: 'uExec', nivel_acesso: 'Restrito' }] })
      // SELECT usuário destino no mesmo setor
      query.mockResolvedValueOnce({ rows: [{ setor: 'TI' }] })
      // SELECT processo_acessos sem registros
      query.mockResolvedValueOnce({ rows: [] })

      await expect(
        processosService.atribuir('proc-1', { usuario: 'uDest', executadoPor: 'uExec' }),
      ).rejects.toMatchObject({ code: 403 })
      expect(query).toHaveBeenCalledTimes(3)
    })

    it('retorna 404 quando UPDATE não afeta nenhuma linha', async () => {
      // SELECT processo público
      query.mockResolvedValueOnce({ rows: [{ setor_atual: 'TI', atribuido_usuario: 'uExec', nivel_acesso: 'Público' }] })
      // SELECT usuário destino no mesmo setor
      query.mockResolvedValueOnce({ rows: [{ setor: 'TI' }] })
      // UPDATE sem linhas afetadas
      query.mockResolvedValueOnce({ rowCount: 0 })

      await expect(
        processosService.atribuir('proc-1', { usuario: 'uDest', executadoPor: 'uExec' }),
      ).rejects.toMatchObject({ code: 404 })
      expect(query).toHaveBeenCalledTimes(3)
    })
  })

  describe('consultarPublico', () => {
    beforeEach(() => {
      jest.clearAllMocks()
    })

    it('retorna 404 quando processo não encontrado pelo número', async () => {
      query.mockResolvedValueOnce({ rows: [] })
      await expect(processosService.consultarPublico('N-404')).rejects.toMatchObject({ code: 404 })
      expect(query).toHaveBeenCalledTimes(1)
      expect(query.mock.calls[0][0]).toEqual(expect.stringContaining('FROM processos p'))
      expect(query.mock.calls[0][1]).toEqual(['N-404'])
    })

    it('retorna 403 quando restrito sem chave', async () => {
      query.mockResolvedValueOnce({
        rows: [
          { id: 'p1', numero: 'N1', assunto: 'A', nivelAcesso: 'Restrito', status: 'Em instrução' },
        ],
      })
      await expect(processosService.consultarPublico('N1')).rejects.toMatchObject({ code: 403 })
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('retorna dados públicos quando processo é público (por número)', async () => {
      query.mockResolvedValueOnce({
        rows: [
          { id: 'p1', numero: 'N1', assunto: 'A', nivelAcesso: 'Público', status: 'Em instrução' },
        ],
      })
      const docsRows = [
        {
          id: 'd1',
          titulo: 'T1',
          tipo: 'Memo',
          modo: 'upload',
          status: 'Assinado',
          fileName: 't1.pdf',
          criadoEm: '2024-01-01T00:00:00.000Z',
          assinadoPorLogin: 'user1',
          assinaturaNome: 'User 1',
          assinaturaCargo: 'Agente',
          assinanteSetor: 'PROTOCOLO',
        },
      ]
      query.mockResolvedValueOnce({ rows: docsRows })
      const tramitesRows = [
        {
          id: 't1',
          origemSetor: 'TI',
          destinoSetor: 'PROTOCOLO',
          motivo: 'M',
          prioridade: 'Alta',
          prazo: '2024-12-31',
          usuario: 'user1',
          data: '2024-01-02T00:00:00.000Z',
        },
      ]
      query.mockResolvedValueOnce({ rows: tramitesRows })
      const partesRows = [
        { id: 'pp1', tipo: 'Pessoa Física', nome: 'Alice', papel: 'Interessado' },
      ]
      query.mockResolvedValueOnce({ rows: partesRows })

      const result = await processosService.consultarPublico('N1')

      expect(query).toHaveBeenCalledTimes(4)
      expect(result).toEqual({
        capaPublica: { id: 'p1', numero: 'N1', assunto: 'A', status: 'Em instrução' },
        andamentosPublicos: tramitesRows,
        documentosPublicos: docsRows,
        partesPublicas: partesRows,
      })
    })

    it('busca por UUID quando valor é UUID', async () => {
      const uuid = '123e4567-e89b-12d3-a456-426614174000'
      query.mockResolvedValueOnce({
        rows: [
          { id: uuid, numero: 'N1', assunto: 'A', nivelAcesso: 'Público', status: 'Em instrução' },
        ],
      })
      query.mockResolvedValueOnce({ rows: [] })
      query.mockResolvedValueOnce({ rows: [] })
      query.mockResolvedValueOnce({ rows: [] })

      const result = await processosService.consultarPublico(uuid)
      expect(query).toHaveBeenCalledTimes(4)
      expect(query.mock.calls[0][0]).toEqual(expect.stringContaining('WHERE id = $1'))
      expect(result.capaPublica.id).toBe(uuid)
    })
  })

  describe('tramitar', () => {
    it('valida usuário executor obrigatório', async () => {
      await expect(
        processosService.tramitar('proc-1', { destinoSetor: 'PROTOCOLO' }),
      ).rejects.toMatchObject({ code: 400 })
      expect(query).not.toHaveBeenCalled()
    })

    it('retorna 404 quando processo não existe', async () => {
      // SELECT processo
      query.mockResolvedValueOnce({ rows: [] })
      await expect(
        processosService.tramitar('proc-404', { destinoSetor: 'PROTOCOLO', usuario: 'uExec' }),
      ).rejects.toMatchObject({ code: 404 })
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('retorna 403 quando processo não está atribuído ao executor', async () => {
      // SELECT processo
      query.mockResolvedValueOnce({ rows: [{ setor_atual: 'TI', atribuido_usuario: 'outro' }] })
      await expect(
        processosService.tramitar('proc-1', { destinoSetor: 'PROTOCOLO', usuario: 'uExec' }),
      ).rejects.toMatchObject({ code: 403 })
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('tramita com sucesso e retorna processo e detalhes', async () => {
      // Preparar UUID do trâmite
      uuidv4.mockReturnValueOnce('tram-123')

      // 1: SELECT processo
      query.mockResolvedValueOnce({ rows: [{ setor_atual: 'TI', atribuido_usuario: 'uExec' }] })
      // 2: BEGIN
      query.mockResolvedValueOnce({})
      // 3: INSERT tramites
      query.mockResolvedValueOnce({})
      // 4: UPDATE processos
      query.mockResolvedValueOnce({})
      // 5: COMMIT
      query.mockResolvedValueOnce({})
      // 6: SELECT retorno
      const procRow = {
        id: 'proc-1',
        numero: 'N',
        assunto: 'A',
        status: 'Aguardando',
        prioridade: 'Alta',
        prazo: '2024-12-31',
        nivelAcesso: 'Público',
        setor: 'PROTOCOLO',
        atribuidoA: null,
        criadoEm: '2024-01-01T00:00:00.000Z',
      }
      query.mockResolvedValueOnce({ rows: [procRow] })

      const result = await processosService.tramitar('proc-1', {
        destinoSetor: 'PROTOCOLO',
        usuario: 'uExec',
        motivo: 'M',
        prioridade: 'Alta',
        prazo: '2024-12-31',
      })

      expect(query).toHaveBeenCalledTimes(6)
      expect(query.mock.calls[2][0]).toEqual(expect.stringContaining('INSERT INTO tramites'))
      expect(query.mock.calls[3][0]).toEqual(expect.stringContaining('UPDATE processos'))
      expect(query.mock.calls[4][0]).toBe('COMMIT')
      expect(result).toEqual({
        processo: procRow,
        detalhes: {
          origem: 'TI',
          destino: 'PROTOCOLO',
          motivo: 'M',
          prioridade: 'Alta',
          prazo: '2024-12-31',
          tramiteId: 'tram-123',
        },
      })
    })

    it('tramita alterando somente prazo e mantém prioridade original', async () => {
      uuidv4.mockReturnValueOnce('tram-456')

      // 1: SELECT processo atribuído ao executor
      query.mockResolvedValueOnce({ rows: [{ setor_atual: 'TI', atribuido_usuario: 'uExec' }] })
      // 2: BEGIN
      query.mockResolvedValueOnce({})
      // 3: INSERT tramites
      query.mockResolvedValueOnce({})
      // 4: UPDATE processos (prazo novo, prioridade mantida)
      query.mockResolvedValueOnce({})
      // 5: COMMIT
      query.mockResolvedValueOnce({})
      // 6: SELECT retorno com prioridade original e prazo atualizado
      const procRow = {
        id: 'proc-1',
        numero: 'N',
        assunto: 'A',
        status: 'Aguardando',
        prioridade: 'Normal',
        prazo: '2025-01-31',
        nivelAcesso: 'Público',
        setor: 'PROTOCOLO',
        atribuidoA: null,
        criadoEm: '2024-01-01T00:00:00.000Z',
      }
      query.mockResolvedValueOnce({ rows: [procRow] })

      const result = await processosService.tramitar('proc-1', {
        destinoSetor: 'PROTOCOLO',
        usuario: 'uExec',
        motivo: 'M2',
        prazo: '2025-01-31',
      })

      expect(query).toHaveBeenCalledTimes(6)
      expect(query.mock.calls[3][0]).toEqual(expect.stringContaining('UPDATE processos'))
      expect(query.mock.calls[3][1]).toEqual(['PROTOCOLO', 'proc-1', 'TI', null, '2025-01-31'])
      expect(result).toEqual({
        processo: procRow,
        detalhes: {
          origem: 'TI',
          destino: 'PROTOCOLO',
          motivo: 'M2',
          prioridade: null,
          prazo: '2025-01-31',
          tramiteId: 'tram-456',
        },
      })
    })

    it('tramita sem motivo e prazo, com prioridade definida', async () => {
      uuidv4.mockReturnValueOnce('tram-789')

      // 1: SELECT processo atribuído ao executor
      query.mockResolvedValueOnce({ rows: [{ setor_atual: 'PROTOCOLO', atribuido_usuario: 'uExec' }] })
      // 2: BEGIN
      query.mockResolvedValueOnce({})
      // 3: INSERT tramites
      query.mockResolvedValueOnce({})
      // 4: UPDATE processos
      query.mockResolvedValueOnce({})
      // 5: COMMIT
      query.mockResolvedValueOnce({})
      // 6: SELECT retorno
      query.mockResolvedValueOnce({ rows: [{ id: 'p1', setor: 'ARQUIVO', prioridade: 'Alta', prazo: null }] })

      const res = await processosService.tramitar('p1', { destinoSetor: 'ARQUIVO', usuario: 'uExec', prioridade: 'Alta' })

      expect(query).toHaveBeenCalledTimes(6)
      expect(query.mock.calls[2][0]).toEqual(expect.stringContaining('INSERT INTO tramites'))
      expect(query.mock.calls[4][0]).toBe('COMMIT')
      expect(res.detalhes.origem).toBe('PROTOCOLO')
      expect(res.detalhes.destino).toBe('ARQUIVO')
      expect(res.detalhes.motivo).toBeNull()
      expect(res.detalhes.prazo).toBeNull()
      expect(res.detalhes.prioridade).toBe('Alta')
    })
  })

describe('listProcessos', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('retorna total, page e items com paginação, sem filtros', async () => {
    // COUNT
    query.mockResolvedValueOnce({ rows: [{ count: '2' }] })
    // SELECT items
    const rows = [
      {
        id: 'p1',
        numero: 'N1',
        assunto: 'A1',
        status: 'Em instrução',
        prioridade: 'Normal',
        prazo: null,
        nivelAcesso: 'Público',
        setor: 'PROTOCOLO',
        atribuidoA: null,
        pendente: false,
        pendenteOrigemSetor: null,
        pendenteDestinoSetor: null,
        criadoEm: '2024-01-01T00:00:00.000Z',
        ultimaMovimentacao: '2024-01-01T00:00:00.000Z',
        interessado: 'Alice',
      },
      {
        id: 'p2',
        numero: 'N2',
        assunto: 'A2',
        status: 'Aguardando',
        prioridade: 'Alta',
        prazo: '2024-12-31',
        nivelAcesso: 'Restrito',
        setor: 'TI',
        atribuidoA: 'user1',
        pendente: true,
        pendenteOrigemSetor: 'TI',
        pendenteDestinoSetor: 'PROTOCOLO',
        criadoEm: '2024-02-01T00:00:00.000Z',
        ultimaMovimentacao: '2024-02-10T00:00:00.000Z',
        interessado: 'Bob',
      },
    ]
    query.mockResolvedValueOnce({ rows })

    const result = await processosService.listProcessos({ page: '2', pageSize: '5' })

    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[0][0]).toEqual(
      expect.stringContaining('SELECT COUNT(*) FROM processos p'),
    )
    expect(query.mock.calls[0][0]).not.toEqual(expect.stringContaining('WHERE'))

    expect(query.mock.calls[1][0]).toEqual(expect.stringContaining('SELECT\n        p.id,'))
    expect(query.mock.calls[1][0]).toEqual(expect.stringContaining('ORDER BY p.criado_em DESC'))
    expect(query.mock.calls[1][0]).toEqual(expect.stringContaining('LIMIT $'))
    expect(query.mock.calls[1][0]).toEqual(expect.stringContaining('OFFSET $'))

    const paramsItems = query.mock.calls[1][1]
    expect(paramsItems[paramsItems.length - 2]).toBe(5)
    expect(paramsItems[paramsItems.length - 1]).toBe(5)

    expect(result).toEqual({ total: 2, page: 2, pageSize: 5, items: rows })
  })

  it('aplica filtros de numero, assunto e interessado', async () => {
    query.mockResolvedValueOnce({ rows: [{ count: '0' }] })
    query.mockResolvedValueOnce({ rows: [] })

    await processosService.listProcessos({
      numero: '2024-0001',
      assunto: 'Teste',
      interessado: 'Alice',
      page: '1',
      pageSize: '10',
    })

    const countSql = query.mock.calls[0][0]
    expect(countSql).toEqual(expect.stringContaining('p.numero ILIKE $1'))
    expect(countSql).toEqual(expect.stringContaining('p.assunto ILIKE $2'))
    expect(countSql).toEqual(expect.stringContaining('EXISTS ('))
    expect(countSql).toEqual(expect.stringContaining('FROM processo_partes pp'))
    expect(countSql).toEqual(expect.stringContaining('LEFT JOIN cadastro_partes cp ON cp.id = pp.cadastro_parte_id'))
    expect(countSql).toEqual(expect.stringContaining('cp.nome ILIKE $3'))
    expect(query.mock.calls[0][1]).toEqual(['%2024-0001%', '%Teste%', '%Alice%'])

    const itemsSql = query.mock.calls[1][0]
    expect(itemsSql).toEqual(expect.stringContaining('p.numero ILIKE $1'))
    expect(itemsSql).toEqual(expect.stringContaining('p.assunto ILIKE $2'))
    expect(itemsSql).toEqual(expect.stringContaining('cp.nome ILIKE $3'))
    expect(itemsSql).toEqual(expect.stringContaining('LEFT JOIN cadastro_partes cp ON cp.id = pp.cadastro_parte_id'))
    const itemsParams = query.mock.calls[1][1]
    expect(itemsParams.slice(0, 3)).toEqual(['%2024-0001%', '%Teste%', '%Alice%'])
    expect(itemsParams[itemsParams.length - 2]).toBe(10)
    expect(itemsParams[itemsParams.length - 1]).toBe(0)
  })

  it('aplica filtros de status, prioridade, nivelAcesso e setor', async () => {
    query.mockResolvedValueOnce({ rows: [{ count: '0' }] })
    query.mockResolvedValueOnce({ rows: [] })

    await processosService.listProcessos({
      status: 'Aguardando',
      prioridade: 'Alta',
      nivelAcesso: 'Restrito',
      setor: 'TI',
      page: '1',
      pageSize: '10',
    })

    const countSql = query.mock.calls[0][0]
    expect(countSql).toEqual(expect.stringContaining('p.status = $1'))
    expect(countSql).toEqual(expect.stringContaining('p.prioridade = $2'))
    expect(countSql).toEqual(expect.stringContaining('p.nivel_acesso = $3'))
    expect(countSql).toEqual(expect.stringContaining('p.setor_atual = $4'))
    expect(query.mock.calls[0][1]).toEqual(['Aguardando', 'Alta', 'Restrito', 'TI'])

    const itemsSql = query.mock.calls[1][0]
    expect(itemsSql).toEqual(expect.stringContaining('p.status = $1'))
    expect(itemsSql).toEqual(expect.stringContaining('p.prioridade = $2'))
    expect(itemsSql).toEqual(expect.stringContaining('p.nivel_acesso = $3'))
    expect(itemsSql).toEqual(expect.stringContaining('p.setor_atual = $4'))
    const itemsParams = query.mock.calls[1][1]
    expect(itemsParams.slice(0, 4)).toEqual(['Aguardando', 'Alta', 'Restrito', 'TI'])
  })

  it('aplica pendente, pendenteSetor e somenteMeus com usuario', async () => {
    query.mockResolvedValueOnce({ rows: [{ count: '0' }] })
    query.mockResolvedValueOnce({ rows: [] })

    await processosService.listProcessos({
      pendente: 'true',
      pendenteSetor: 'PROTOCOLO',
      somenteMeus: 'true',
      usuario: 'user1',
      page: '1',
      pageSize: '10',
    })

    const countSql = query.mock.calls[0][0]
    expect(countSql).toEqual(expect.stringContaining('p.pendente = TRUE'))
    expect(countSql).toEqual(expect.stringContaining('p.pendente_destino_setor = $1'))
    expect(countSql).toEqual(expect.stringContaining('p.atribuido_usuario = $2'))
    expect(query.mock.calls[0][1]).toEqual(['PROTOCOLO', 'user1'])

    const itemsSql = query.mock.calls[1][0]
    expect(itemsSql).toEqual(expect.stringContaining('p.pendente = TRUE'))
    expect(itemsSql).toEqual(expect.stringContaining('p.pendente_destino_setor = $1'))
    expect(itemsSql).toEqual(expect.stringContaining('p.atribuido_usuario = $2'))
    const itemsParams = query.mock.calls[1][1]
    expect(itemsParams.slice(0, 2)).toEqual(['PROTOCOLO', 'user1'])
  })
})
 
  describe('addParte', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })
  it('valida nome obrigatório', async () => {
    await expect(processosService.addParte('proc-1', { tipo: 'Pessoa' })).rejects.toMatchObject({
      code: 400,
    })
    expect(query).not.toHaveBeenCalled()
  })

  it('retorna 404 quando processo não existe', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await expect(processosService.addParte('proc-404', { nome: 'Alice' })).rejects.toMatchObject({
      code: 404,
    })
    expect(query).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT id FROM processos WHERE id = $1'),
      ['proc-404'],
    )
  })

  it('cria parte e retorna dados', async () => {
    // SELECT processo
    query.mockResolvedValueOnce({ rows: [{ id: 'proc-1' }] })
    // INSERT cadastro_partes mínimo
    query.mockResolvedValueOnce({})
    // INSERT processo_partes vinculando cadastro
    query.mockResolvedValueOnce({})
    // SELECT parte criada via JOIN
    const parteRow = {
      id: 'uuid-1',
      tipo: 'Pessoa',
      nome: 'Alice',
      documento: '123',
      papel: 'Interessado',
    }
    query.mockResolvedValueOnce({ rows: [parteRow] })

    const result = await processosService.addParte('proc-1', {
      tipo: 'Pessoa',
      nome: 'Alice',
      documento: '123',
      papel: 'Interessado',
    })

    expect(query).toHaveBeenCalledTimes(4)
    expect(query.mock.calls[2][0]).toEqual(expect.stringContaining('INSERT INTO processo_partes'))
    expect(result).toEqual(parteRow)
  })

  it('retorna 404 quando parteId inexiste no cadastro', async () => {
    // SELECT processo existente
    query.mockResolvedValueOnce({ rows: [{ id: 'proc-1' }] })
    // SELECT cadastro_partes não encontrado
    query.mockResolvedValueOnce({ rows: [] })

    await expect(
      processosService.addParte('proc-1', { parteId: 'cad-404', papel: 'Interessado' }),
    ).rejects.toMatchObject({ code: 404 })
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('retorna 404 quando processo não existe via parteId', async () => {
    // SELECT processo inexistente
    query.mockResolvedValueOnce({ rows: [] })

    await expect(
      processosService.addParte('proc-404', { parteId: 'cad-1', papel: 'Interessado' }),
    ).rejects.toMatchObject({ code: 404 })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('vincula cadastro existente via parteId sem inserir novo cadastro', async () => {
    // SELECT processo existente
    query.mockResolvedValueOnce({ rows: [{ id: 'proc-1' }] })
    // SELECT cadastro_partes encontrado
    query.mockResolvedValueOnce({ rows: [{ id: 'cad-1', tipo: 'Pessoa', nome: 'Bob', documento: '999' }] })
    // INSERT processo_partes com cadastro_parte_id
    query.mockResolvedValueOnce({})
    // SELECT parte vinculada
    const parteLink = {
      id: 'uuid-link',
      tipo: 'Pessoa',
      nome: 'Bob',
      documento: '999',
      papel: 'Interessado',
      cadastroParteId: 'cad-1',
    }
    query.mockResolvedValueOnce({ rows: [parteLink] })

    const result = await processosService.addParte('proc-1', { parteId: 'cad-1', papel: 'Interessado' })

    expect(query).toHaveBeenCalledTimes(4)
    expect(query.mock.calls[2][0]).toEqual(expect.stringContaining('INSERT INTO processo_partes'))
    expect(result).toEqual(parteLink)
  })

  describe('deleteParte', () => {
    beforeEach(() => {
      jest.clearAllMocks()
    })

    it('retorna 404 quando parte não encontrada no processo', async () => {
      query.mockResolvedValueOnce({ rows: [] })
      await expect(processosService.deleteParte('proc-1', 'p404')).rejects.toMatchObject({
        code: 404,
      })
      expect(query).toHaveBeenCalledTimes(1)
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE pp.id = $1 AND pp.processo_id = $2'),
        ['p404', 'proc-1'],
      )
    })

    it('deleta parte e retorna nome', async () => {
      // SELECT parte vinculada ao processo
      query.mockResolvedValueOnce({ rows: [{ id: 'p1', nome: 'Alice' }] })
      // DELETE parte
      query.mockResolvedValueOnce({ rowCount: 1 })

      const result = await processosService.deleteParte('proc-1', 'p1')

      expect(query).toHaveBeenCalledTimes(2)
      expect(query.mock.calls[1][0]).toEqual(expect.stringContaining('DELETE FROM processo_partes'))
      expect(query.mock.calls[1][1]).toEqual(['p1'])
      expect(result).toEqual({ ok: true, nome: 'Alice' })
    })
  })
})

describe('consultarPublico', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('retorna 404 quando processo não encontrado pelo número', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await expect(processosService.consultarPublico('N-404')).rejects.toMatchObject({ code: 404 })
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0][0]).toEqual(expect.stringContaining('FROM processos p'))
    expect(query.mock.calls[0][1]).toEqual(['N-404'])
  })

  it('retorna 403 quando restrito sem chave', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { id: 'p1', numero: 'N1', assunto: 'A', nivelAcesso: 'Restrito', status: 'Em instrução' },
      ],
    })
    await expect(processosService.consultarPublico('N1')).rejects.toMatchObject({ code: 403 })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('retorna 403 quando CPF/chave inválidos', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { id: 'p1', numero: 'N1', assunto: 'A', nivelAcesso: 'Restrito', status: 'Em instrução' },
      ],
    })
    query.mockResolvedValueOnce({ rows: [] })
    await expect(processosService.consultarPublico('N1', '123', 'abc123')).rejects.toMatchObject({
      code: 403,
    })
    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[1][0]).toEqual(expect.stringContaining('FROM processo_partes'))
    expect(query.mock.calls[1][0]).toEqual(expect.stringContaining('JOIN cadastro_partes'))
    expect(query.mock.calls[1][1]).toEqual(['p1', '123', 'abc123'])
  })

  it('retorna dados públicos quando restrito com chave válida', async () => {
    // 1: processo restrito
    query.mockResolvedValueOnce({
      rows: [
        { id: 'p1', numero: 'N1', assunto: 'A', nivelAcesso: 'Restrito', status: 'Em instrução' },
      ],
    })
    // 2: chave ativa válida
    query.mockResolvedValueOnce({ rows: [{ id: 'acesso-1' }] })
    // 3: documentos
    const docsRows = [
      {
        id: 'd1',
        titulo: 'T1',
        tipo: 'Memo',
        modo: 'upload',
        status: 'Assinado',
        fileName: 't1.pdf',
        criadoEm: '2024-01-01T00:00:00.000Z',
        assinadoPorLogin: 'user1',
        assinaturaNome: 'User 1',
        assinaturaCargo: 'Agente',
        assinanteSetor: 'PROTOCOLO',
      },
    ]
    query.mockResolvedValueOnce({ rows: docsRows })
    // 4: tramites
    const tramitesRows = [
      {
        id: 't1',
        origemSetor: 'TI',
        destinoSetor: 'PROTOCOLO',
        motivo: 'M',
        prioridade: 'Alta',
        prazo: '2024-12-31',
        usuario: 'user1',
        data: '2024-01-02T00:00:00.000Z',
      },
    ]
    query.mockResolvedValueOnce({ rows: tramitesRows })
    // 5: partes
    const partesRows = [
      { id: 'pp1', tipo: 'Pessoa Física', nome: 'Alice', papel: 'Interessado' },
    ]
    query.mockResolvedValueOnce({ rows: partesRows })

    const result = await processosService.consultarPublico('N1', '123', 'abc123')

    expect(query).toHaveBeenCalledTimes(5)
    // valida consulta da credencial
    expect(query.mock.calls[1][0]).toEqual(expect.stringContaining('FROM processo_partes'))
    expect(query.mock.calls[1][0]).toEqual(expect.stringContaining('JOIN cadastro_partes'))
    expect(query.mock.calls[1][1]).toEqual(['p1', '123', 'abc123'])
    expect(result).toEqual({
      capaPublica: { id: 'p1', numero: 'N1', assunto: 'A', status: 'Em instrução' },
      andamentosPublicos: tramitesRows,
      documentosPublicos: docsRows,
      partesPublicas: partesRows,
    })
  })

  it('retorna dados públicos quando processo é público (por número)', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { id: 'p1', numero: 'N1', assunto: 'A', nivelAcesso: 'Público', status: 'Em instrução' },
      ],
    })
    const docsRows = [
      {
        id: 'd1',
        titulo: 'T1',
        tipo: 'Memo',
        modo: 'upload',
        status: 'Assinado',
        fileName: 't1.pdf',
        criadoEm: '2024-01-01T00:00:00.000Z',
        assinadoPorLogin: 'user1',
        assinaturaNome: 'User 1',
        assinaturaCargo: 'Agente',
        assinanteSetor: 'PROTOCOLO',
      },
    ]
    query.mockResolvedValueOnce({ rows: docsRows })
    const tramitesRows = [
      {
        id: 't1',
        origemSetor: 'TI',
        destinoSetor: 'PROTOCOLO',
        motivo: 'M',
        prioridade: 'Alta',
        prazo: '2024-12-31',
        usuario: 'user1',
        data: '2024-01-02T00:00:00.000Z',
      },
    ]
    query.mockResolvedValueOnce({ rows: tramitesRows })
    const partesRows = [
      { id: 'pp1', tipo: 'Pessoa Física', nome: 'Alice', papel: 'Interessado' },
    ]
    query.mockResolvedValueOnce({ rows: partesRows })

    const result = await processosService.consultarPublico('N1')

    expect(query).toHaveBeenCalledTimes(4)
    expect(result).toEqual({
      capaPublica: { id: 'p1', numero: 'N1', assunto: 'A', status: 'Em instrução' },
      andamentosPublicos: tramitesRows,
      documentosPublicos: docsRows,
      partesPublicas: partesRows,
    })
  })

  it('busca por UUID quando valor é UUID', async () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000'
    query.mockResolvedValueOnce({
      rows: [
        { id: uuid, numero: 'N1', assunto: 'A', nivelAcesso: 'Público', status: 'Em instrução' },
      ],
    })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [] })

    const result = await processosService.consultarPublico(uuid)
    expect(query).toHaveBeenCalledTimes(4)
    expect(query.mock.calls[0][0]).toEqual(expect.stringContaining('WHERE id = $1'))
    expect(result.capaPublica.id).toBe(uuid)
  })
})

describe('listTramites', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('retorna lista de trâmites para um processo', async () => {
    const rows = [
      {
        id: 't1',
        origemSetor: 'TI',
        destinoSetor: 'PROTOCOLO',
        motivo: 'M1',
        prioridade: 'Alta',
        prazo: '2024-12-31',
        usuario: 'user1',
        data: '2024-01-02T00:00:00.000Z',
      },
      {
        id: 't0',
        origemSetor: 'PROTOCOLO',
        destinoSetor: 'TI',
        motivo: null,
        prioridade: null,
        prazo: null,
        usuario: 'user2',
        data: '2024-01-01T00:00:00.000Z',
      },
    ]
    query.mockResolvedValueOnce({ rows })

    const result = await processosService.listTramites('proc-1')

    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0][0]).toEqual(expect.stringContaining('FROM tramites'))
    expect(query.mock.calls[0][0]).toEqual(expect.stringContaining('WHERE processo_id = $1'))
    expect(query.mock.calls[0][0]).toEqual(expect.stringContaining('ORDER BY data DESC'))
    expect(query.mock.calls[0][1]).toEqual(['proc-1'])
    expect(result).toEqual(rows)
  })

  it('retorna lista vazia quando não há trâmites', async () => {
    query.mockResolvedValueOnce({ rows: [] })

    const result = await processosService.listTramites('proc-2')

    expect(query).toHaveBeenCalledTimes(1)
    expect(result).toEqual([])
  })
})

describe('priorizar', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })
  it('valida prioridade e executor obrigatórios', async () => {
    await expect(
      processosService.priorizar('proc-1', { prioridade: 'Invalida', executadoPor: 'uExec' }),
    ).rejects.toMatchObject({ code: 400 })
    await expect(
      processosService.priorizar('proc-1', { prioridade: 'Alta' }),
    ).rejects.toMatchObject({ code: 400 })
    expect(query).not.toHaveBeenCalled()
  })

  it('retorna 404 quando processo não existe', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await expect(
      processosService.priorizar('proc-404', { prioridade: 'Alta', executadoPor: 'uExec' }),
    ).rejects.toMatchObject({ code: 404 })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('retorna 403 quando processo está atribuído a outro usuário', async () => {
    query.mockResolvedValueOnce({ rows: [{ atribuido_usuario: 'outro' }] })
    await expect(
      processosService.priorizar('proc-1', { prioridade: 'Alta', executadoPor: 'uExec' }),
    ).rejects.toMatchObject({ code: 403 })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('prioriza com sucesso e retorna processo e detalhes', async () => {
    // SELECT processo
    query.mockResolvedValueOnce({ rows: [{ atribuido_usuario: 'uExec' }] })
    // UPDATE
    query.mockResolvedValueOnce({ rowCount: 1 })
    // SELECT retorno
    const procRow = {
      id: 'proc-1',
      numero: 'N',
      assunto: 'A',
      status: 'Em instrução',
      prioridade: 'Alta',
      prazo: null,
      nivelAcesso: 'Público',
      setor: 'TI',
      atribuidoA: 'uExec',
      criadoEm: '2024-01-01T00:00:00.000Z',
      ultimaMovimentacao: '2024-01-01T00:00:00.000Z',
    }
    query.mockResolvedValueOnce({ rows: [procRow] })

    const result = await processosService.priorizar('proc-1', {
      prioridade: 'Alta',
      executadoPor: 'uExec',
    })

    expect(query).toHaveBeenCalledTimes(3)
    expect(query.mock.calls[1]).toEqual([
      expect.stringContaining('UPDATE processos SET prioridade = $2'),
      ['proc-1', 'Alta'],
    ])
    expect(result).toEqual({ processo: procRow, detalhes: { prioridade: 'Alta' } })
  })
})

describe('aceitarPendencia', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('valida usuário obrigatório', async () => {
    await expect(processosService.aceitarPendencia('proc-1', {})).rejects.toMatchObject({
      code: 400,
    })
    expect(query).not.toHaveBeenCalled()
  })

  it('retorna 404 quando processo não existe', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await expect(
      processosService.aceitarPendencia('proc-404', { usuario: 'user1' }),
    ).rejects.toMatchObject({ code: 404 })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('retorna 400 quando processo não está pendente', async () => {
    query.mockResolvedValueOnce({ rows: [{ pendente: false, pendente_destino_setor: 'TI' }] })
    await expect(
      processosService.aceitarPendencia('proc-1', { usuario: 'user1' }),
    ).rejects.toMatchObject({ code: 400 })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('retorna 400 quando usuário não encontrado', async () => {
    query.mockResolvedValueOnce({ rows: [{ pendente: true, pendente_destino_setor: 'TI' }] })
    query.mockResolvedValueOnce({ rows: [] })
    await expect(
      processosService.aceitarPendencia('proc-1', { usuario: 'user1' }),
    ).rejects.toMatchObject({ code: 400 })
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('retorna 403 quando usuário não pertence ao setor destino', async () => {
    query.mockResolvedValueOnce({ rows: [{ pendente: true, pendente_destino_setor: 'TI' }] })
    query.mockResolvedValueOnce({ rows: [{ setor: 'PROTOCOLO' }] })
    await expect(
      processosService.aceitarPendencia('proc-1', { usuario: 'user1' }),
    ).rejects.toMatchObject({ code: 403 })
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('aceita pendência com sucesso e retorna processo e detalhes', async () => {
    // SELECT processo
    query.mockResolvedValueOnce({ rows: [{ pendente: true, pendente_destino_setor: 'TI' }] })
    // SELECT usuário
    query.mockResolvedValueOnce({ rows: [{ setor: 'TI' }] })
    // BEGIN
    query.mockResolvedValueOnce({})
    // UPDATE
    query.mockResolvedValueOnce({ rowCount: 1 })
    // COMMIT
    query.mockResolvedValueOnce({})
    // SELECT retorno
    const procRow = {
      id: 'proc-1',
      numero: 'N',
      assunto: 'A',
      status: 'Em instrução',
      prioridade: 'Normal',
      prazo: null,
      nivelAcesso: 'Público',
      setor: 'TI',
      atribuidoA: 'user1',
      pendente: false,
      pendenteOrigemSetor: null,
      pendenteDestinoSetor: null,
      criadoEm: '2024-01-01T00:00:00.000Z',
      ultimaMovimentacao: '2024-01-01T00:00:00.000Z',
    }
    query.mockResolvedValueOnce({ rows: [procRow] })

    const result = await processosService.aceitarPendencia('proc-1', { usuario: 'user1' })

    expect(query).toHaveBeenCalledTimes(6)
    expect(query.mock.calls[2][0]).toBe('BEGIN')
    expect(query.mock.calls[3][0]).toEqual(expect.stringContaining('UPDATE processos'))
    expect(query.mock.calls[4][0]).toBe('COMMIT')
    expect(result).toEqual({ processo: procRow, detalhes: { destino: 'TI' } })
  })
})

describe('recusarPendencia', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('valida usuário e motivo obrigatórios', async () => {
    await expect(
      processosService.recusarPendencia('proc-1', { motivo: 'M' }),
    ).rejects.toMatchObject({ code: 400 })
    await expect(
      processosService.recusarPendencia('proc-1', { usuario: 'user1' }),
    ).rejects.toMatchObject({ code: 400 })
    expect(query).not.toHaveBeenCalled()
  })

  it('retorna 404 quando processo não existe', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await expect(
      processosService.recusarPendencia('proc-404', { usuario: 'user1', motivo: 'M' }),
    ).rejects.toMatchObject({ code: 404 })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('retorna 400 quando processo não está pendente', async () => {
    query.mockResolvedValueOnce({ rows: [{ pendente: false, pendente_destino_setor: 'TI' }] })
    await expect(
      processosService.recusarPendencia('proc-1', { usuario: 'user1', motivo: 'M' }),
    ).rejects.toMatchObject({ code: 400 })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('retorna 400 quando usuário não encontrado', async () => {
    query.mockResolvedValueOnce({
      rows: [{ pendente: true, pendente_destino_setor: 'TI', pendente_origem_setor: 'PROTOCOLO' }],
    })
    query.mockResolvedValueOnce({ rows: [] })
    await expect(
      processosService.recusarPendencia('proc-1', { usuario: 'user1', motivo: 'M' }),
    ).rejects.toMatchObject({ code: 400 })
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('retorna 403 quando usuário não pertence ao setor destino', async () => {
    query.mockResolvedValueOnce({
      rows: [{ pendente: true, pendente_destino_setor: 'TI', pendente_origem_setor: 'PROTOCOLO' }],
    })
    query.mockResolvedValueOnce({ rows: [{ setor: 'PROTOCOLO' }] })
    await expect(
      processosService.recusarPendencia('proc-1', { usuario: 'user1', motivo: 'M' }),
    ).rejects.toMatchObject({ code: 403 })
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('recusa pendência com sucesso e retorna processo e detalhes', async () => {
    // SELECT processo
    query.mockResolvedValueOnce({
      rows: [{ pendente: true, pendente_destino_setor: 'TI', pendente_origem_setor: 'PROTOCOLO' }],
    })
    query.mockResolvedValueOnce({ rows: [{ setor: 'TI' }] })
    // BEGIN
    query.mockResolvedValueOnce({})
    // INSERT tramites
    query.mockResolvedValueOnce({ rowCount: 1 })
    // UPDATE processos
    query.mockResolvedValueOnce({ rowCount: 1 })
    // COMMIT
    query.mockResolvedValueOnce({})
    // SELECT retorno
    const procRow = {
      id: 'proc-1',
      numero: 'N',
      assunto: 'A',
      status: 'Aguardando',
      prioridade: 'Normal',
      prazo: null,
      nivelAcesso: 'Público',
      setor: 'TI',
      atribuidoA: null,
      pendente: true,
      pendenteOrigemSetor: 'TI',
      pendenteDestinoSetor: 'PROTOCOLO',
      criadoEm: '2024-02-01T00:00:00.000Z',
      ultimaMovimentacao: '2024-01-01T00:00:00.000Z',
    }
    query.mockResolvedValueOnce({ rows: [procRow] })

    uuidv4.mockReturnValueOnce('tram-r1')

    const result = await processosService.recusarPendencia('proc-1', {
      usuario: 'user1',
      motivo: 'M',
    })

    expect(query).toHaveBeenCalledTimes(7)
    expect(query.mock.calls[2][0]).toBe('BEGIN')
    expect(query.mock.calls[3][0]).toEqual(expect.stringContaining('INSERT INTO tramites'))
    expect(query.mock.calls[3][1]).toEqual(['tram-r1', 'proc-1', 'TI', 'PROTOCOLO', 'M', 'user1'])
    expect(query.mock.calls[4][0]).toEqual(expect.stringContaining('UPDATE processos'))
    expect(query.mock.calls[4][1]).toEqual(['proc-1', 'PROTOCOLO', 'TI'])
    expect(query.mock.calls[5][0]).toBe('COMMIT')
    expect(result).toEqual({
      processo: procRow,
      detalhes: { origem: 'PROTOCOLO', destino: 'TI', motivo: 'M', tramiteId: 'tram-r1' },
    })
  })
})
})

