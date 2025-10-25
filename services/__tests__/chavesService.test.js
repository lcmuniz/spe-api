jest.mock('../../db', () => ({
  query: jest.fn(),
}))

const { query } = require('../../db')

jest.mock('uuid', () => ({
  v4: jest.fn(),
}))
const { v4 } = require('uuid')

const chavesService = require('../chavesService')

describe('chavesService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('listChaves', () => {
    it('retorna linhas do banco para o processo informado', async () => {
      const fakeRows = [
        { id: 'c1', parteId: 'p1', chave: 'abc', ativo: true, criadoEm: '2024-01-01' },
        { id: 'c2', parteId: 'p2', chave: 'def', ativo: false, criadoEm: '2024-01-02' },
      ]
      query.mockResolvedValueOnce({ rows: fakeRows })

      const result = await chavesService.listChaves('proc-1')

      expect(query).toHaveBeenCalledTimes(1)
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('FROM processo_acesso_chaves'),
        ['proc-1'],
      )
      expect(result).toEqual(fakeRows)
    })
  })

  describe('createChave', () => {
    it('valida parteId ausente e lança erro 400', async () => {
      await expect(chavesService.createChave({ processoId: 'proc-1' })).rejects.toMatchObject({
        code: 400,
      })
      expect(query).not.toHaveBeenCalled()
    })

    it('lança 404 quando processo não existe', async () => {
      query.mockResolvedValueOnce({ rows: [] })

      await expect(
        chavesService.createChave({ processoId: 'proc-404', parteId: 'parte-1' }),
      ).rejects.toMatchObject({ code: 404 })
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('lança 404 quando parte não existe', async () => {
      // 1ª chamada: SELECT processo
      query.mockResolvedValueOnce({ rows: [{ id: 'proc-1' }] })
      // 2ª chamada: SELECT parte
      query.mockResolvedValueOnce({ rows: [] })

      await expect(
        chavesService.createChave({ processoId: 'proc-1', parteId: 'parte-404' }),
      ).rejects.toMatchObject({ code: 404 })
      expect(query).toHaveBeenCalledTimes(2)
    })

    it('cria chave e retorna id e chave', async () => {
      // 1: processo existe
      query.mockResolvedValueOnce({ rows: [{ id: 'proc-1' }] })
      // 2: parte existe
      query.mockResolvedValueOnce({ rows: [{ id: 'parte-1' }] })
      // 3: insert
      query.mockResolvedValueOnce({})

      v4.mockReturnValueOnce('id-123').mockReturnValueOnce('chave-456')

      const result = await chavesService.createChave({ processoId: 'proc-1', parteId: 'parte-1' })

      expect(query).toHaveBeenCalledTimes(3)
      const insertArgs = query.mock.calls[2]
      expect(insertArgs[0]).toEqual(expect.stringContaining('INSERT INTO processo_acesso_chaves'))
      expect(insertArgs[1]).toEqual(['id-123', 'proc-1', 'parte-1', 'chave-456'])
      expect(result).toEqual({ id: 'id-123', chave: 'chave-456' })
    })
  })

  describe('revokeChave', () => {
    it('revoga chave quando encontrada', async () => {
      query.mockResolvedValueOnce({ rowCount: 1 })

      const result = await chavesService.revokeChave({ processoId: 'proc-1', chaveId: 'ch-1' })

      expect(query).toHaveBeenCalledTimes(1)
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE processo_acesso_chaves SET ativo = FALSE'),
        ['ch-1', 'proc-1'],
      )
      expect(result).toEqual({ ok: true })
    })

    it('lança 404 quando não encontra a chave', async () => {
      query.mockResolvedValueOnce({ rowCount: 0 })

      await expect(
        chavesService.revokeChave({ processoId: 'proc-1', chaveId: 'ch-404' }),
      ).rejects.toMatchObject({ code: 404 })
      expect(query).toHaveBeenCalledTimes(1)
    })
  })
})