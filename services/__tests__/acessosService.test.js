jest.mock('../../db', () => ({
  query: jest.fn(),
}))

const { query } = require('../../db')

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'uuid-123'),
}))

const acessosService = require('../acessosService')

describe('acessosService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('listAcessos', () => {
    it('retorna linhas do banco para o processo informado', async () => {
      const fakeRows = [
        { id: 'a1', tipo: 'USUARIO', valor: 'user1', criadoEm: '2024-01-01' },
        { id: 'a2', tipo: 'SETOR', valor: 'TI', criadoEm: '2024-01-02' },
      ]
      query.mockResolvedValueOnce({ rows: fakeRows })

      const result = await acessosService.listAcessos('proc-1')

      expect(query).toHaveBeenCalledTimes(1)
      expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM processo_acessos'), [
        'proc-1',
      ])
      expect(result).toEqual(fakeRows)
    })
  })

  describe('addAcesso', () => {
    it('valida tipo inválido e lança erro 400', async () => {
      await expect(
        acessosService.addAcesso('proc-1', { tipo: 'invalido', valor: 'x' }),
      ).rejects.toMatchObject({ code: 400 })
      expect(query).not.toHaveBeenCalled()
    })

    it('tipo vazio ou undefined lança erro 400 com mensagem específica', async () => {
      await expect(
        acessosService.addAcesso('proc-1', { tipo: '', valor: 'x' }),
      ).rejects.toMatchObject({ code: 400, message: 'tipo inválido' })
      await expect(
        acessosService.addAcesso('proc-1', { valor: 'x' }),
      ).rejects.toMatchObject({ code: 400, message: 'tipo inválido' })
      expect(query).not.toHaveBeenCalled()
    })

    it('SETOR sem valor lança erro 400', async () => {
      await expect(acessosService.addAcesso('proc-1', { tipo: 'SETOR' })).rejects.toMatchObject({
        code: 400,
      })
      expect(query).not.toHaveBeenCalled()
    })

    it('USUARIO sem valor lança erro 400', async () => {
      await expect(acessosService.addAcesso('proc-1', { tipo: 'USUARIO' })).rejects.toMatchObject({
        code: 400,
      })
      expect(query).not.toHaveBeenCalled()
    })

    it('retorna id ao adicionar acesso USUARIO com processo existente', async () => {
      // 1ª chamada: SELECT processo
      query.mockResolvedValueOnce({ rows: [{ id: 'proc-1' }] })
      // 2ª chamada: INSERT acesso
      query.mockResolvedValueOnce({})

      const result = await acessosService.addAcesso('proc-1', {
        tipo: 'USUARIO',
        valor: 'john.doe',
      })

      expect(query).toHaveBeenCalledTimes(2)
      // Verifica INSERT
      const insertArgs = query.mock.calls[1]
      expect(insertArgs[0]).toEqual(expect.stringContaining('INSERT INTO processo_acessos'))
      expect(insertArgs[1]).toEqual(['uuid-123', 'proc-1', 'USUARIO', 'john.doe'])
      expect(result).toEqual({ id: 'uuid-123' })
    })

    it('lança 404 quando processo não existe', async () => {
      query.mockResolvedValueOnce({ rows: [] })

      await expect(
        acessosService.addAcesso('proc-404', { tipo: 'USUARIO', valor: 'x' }),
      ).rejects.toMatchObject({ code: 404 })
      expect(query).toHaveBeenCalledTimes(1)
    })
  })

  describe('addAcesso - PARTE', () => {
    it('lança 400 quando parteId ausente', async () => {
      await expect(acessosService.addAcesso('proc-1', { tipo: 'PARTE' }))
        .rejects.toMatchObject({ code: 400 })
      expect(query).not.toHaveBeenCalled()
    })

    it('lança 404 quando processo não existe no banco', async () => {
      query.mockResolvedValueOnce({ rows: [] })
      await expect(
        acessosService.addAcesso('proc-404', { tipo: 'PARTE', parteId: 'pp-1' }),
      ).rejects.toMatchObject({ code: 404 })
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('lança 400 quando parte não está no processo', async () => {
      query.mockResolvedValueOnce({ rows: [{ id: 'proc-1' }] })
      query.mockResolvedValueOnce({ rows: [] })
      await expect(
        acessosService.addAcesso('proc-1', { tipo: 'PARTE', parteId: 'pp-404' }),
      ).rejects.toMatchObject({ code: 400 })
      expect(query).toHaveBeenCalledTimes(2)
    })

    it('adiciona acesso de PARTE quando parte existe', async () => {
      query.mockResolvedValueOnce({ rows: [{ id: 'proc-1' }] })
      query.mockResolvedValueOnce({ rows: [{ id: 'pp-1' }] })
      query.mockResolvedValueOnce({})
      const result = await acessosService.addAcesso('proc-1', {
        tipo: 'PARTE',
        parteId: 'pp-1',
      })
      expect(query).toHaveBeenCalledTimes(3)
      const insertArgs = query.mock.calls[2]
      expect(insertArgs[0]).toEqual(expect.stringContaining('INSERT INTO processo_acessos'))
      expect(insertArgs[1]).toEqual(['uuid-123', 'proc-1', 'PARTE', 'pp-1'])
      expect(result).toEqual({ id: 'uuid-123' })
    })
  })

  describe('addAcesso - SETOR', () => {
    it('insere com sucesso quando processo existe', async () => {
      query.mockResolvedValueOnce({ rows: [{ id: 'proc-1' }] })
      query.mockResolvedValueOnce({})
      const result = await acessosService.addAcesso('proc-1', { tipo: 'SETOR', valor: 'TI' })
      expect(query).toHaveBeenCalledTimes(2)
      const insertArgs = query.mock.calls[1]
      expect(insertArgs[0]).toEqual(expect.stringContaining('INSERT INTO processo_acessos'))
      expect(insertArgs[1]).toEqual(['uuid-123', 'proc-1', 'SETOR', 'TI'])
      expect(result).toEqual({ id: 'uuid-123' })
    })
  })

  describe('addAcesso - case insensitive', () => {
    it('normaliza tipo para maiúsculas', async () => {
      query.mockResolvedValueOnce({ rows: [{ id: 'proc-1' }] })
      query.mockResolvedValueOnce({})
      await acessosService.addAcesso('proc-1', { tipo: 'usuario', valor: 'john' })
      const insertArgs = query.mock.calls[1]
      expect(insertArgs[1][2]).toBe('USUARIO')
    })
  })

  describe('removeAcesso', () => {
    it('deleta e retorna ok: true quando encontrado', async () => {
      query.mockResolvedValueOnce({ rowCount: 1 })
      const result = await acessosService.removeAcesso('proc-1', 'acc-1')
      expect(query).toHaveBeenCalledTimes(1)
      expect(query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM processo_acessos'), [
        'acc-1',
        'proc-1',
      ])
      expect(result).toEqual({ ok: true })
    })

    it('lança 404 quando não encontra o acesso', async () => {
      query.mockResolvedValueOnce({ rowCount: 0 })
      await expect(acessosService.removeAcesso('proc-1', 'acc-404')).rejects.toMatchObject({
        code: 404,
      })
      expect(query).toHaveBeenCalledTimes(1)
    })
  })
})
