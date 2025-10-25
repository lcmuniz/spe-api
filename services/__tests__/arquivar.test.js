jest.mock('../../db', () => ({
  query: jest.fn(),
}))

const { query } = require('../../db')
const processosService = require('../processosService')

describe('arquivar', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('valida usuário obrigatório', async () => {
    await expect(processosService.arquivar('proc-1', {})).rejects.toMatchObject({ code: 400 })
    expect(query).not.toHaveBeenCalled()
  })

  it('retorna 404 quando processo não existe', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await expect(processosService.arquivar('proc-404', { usuario: 'user1' })).rejects.toMatchObject({ code: 404 })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('retorna 400 quando processo está pendente', async () => {
    query.mockResolvedValueOnce({ rows: [{ pendente: true }] })
    await expect(processosService.arquivar('proc-1', { usuario: 'user1' })).rejects.toMatchObject({ code: 400 })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('retorna 400 quando processo já está arquivado', async () => {
    query.mockResolvedValueOnce({ rows: [{ status: 'Arquivado', pendente: false }] })
    await expect(processosService.arquivar('proc-1', { usuario: 'user1' })).rejects.toMatchObject({ code: 400 })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('retorna 403 quando não atribuído ao usuário', async () => {
    query.mockResolvedValueOnce({ rows: [{ status: 'Em instrução', pendente: false, atribuido_usuario: 'other' }] })
    await expect(processosService.arquivar('proc-1', { usuario: 'user1' })).rejects.toMatchObject({ code: 403 })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('arquiva com sucesso', async () => {
    // SELECT processo
    query.mockResolvedValueOnce({ rows: [{ id: 'proc-1', pendente: false, status: 'Em instrução', atribuido_usuario: 'user1' }] })
    // UPDATE
    query.mockResolvedValueOnce({ rowCount: 1 })
    // SELECT retorno
    const procRow = {
      id: 'proc-1',
      numero: 'N',
      assunto: 'A',
      status: 'Arquivado',
      prioridade: 'Normal',
      prazo: null,
      nivelAcesso: 'Público',
      setor: 'TI',
      atribuidoA: null,
      criadoEm: '2024-01-01T00:00:00.000Z',
      ultimaMovimentacao: '2024-01-01T00:00:00.000Z',
    }
    query.mockResolvedValueOnce({ rows: [procRow] })

    const result = await processosService.arquivar('proc-1', { usuario: 'user1' })
    expect(query).toHaveBeenCalledTimes(3)
    expect(query.mock.calls[1][0]).toEqual(expect.stringContaining('UPDATE processos'))
    expect(result).toEqual({ processo: procRow, detalhes: { acao: 'Arquivar' } })
  })
})