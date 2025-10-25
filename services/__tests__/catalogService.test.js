jest.mock('../../db', () => ({
  query: jest.fn(),
}))

const { query } = require('../../db')
const catalogService = require('../catalogService')

describe('catalogService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('listSetores', () => {
    it('retorna sigla e nome de setores em ordem', async () => {
      const fakeRows = [
        { sigla: 'ADM', nome: 'Administração' },
        { sigla: 'TI', nome: 'Tecnologia da Informação' },
      ]
      query.mockResolvedValueOnce({ rows: fakeRows })

      const result = await catalogService.listSetores()

      expect(query).toHaveBeenCalledTimes(1)
      const [sql, params] = query.mock.calls[0]
      expect(sql).toEqual(expect.stringContaining('SELECT s.sigla, s.nome FROM setores s'))
      expect(sql).toEqual(expect.stringContaining('ORDER BY s.nome'))
      expect(params).toBeUndefined()
      expect(result).toEqual(fakeRows)
    })
  })

  describe('listAssuntos', () => {
    it('retorna id e nome de assuntos em ordem', async () => {
      const fakeRows = [
        { id: 'ASS-0001', nome: 'Despacho' },
        { id: 'ASS-0002', nome: 'Memorando' },
        { id: 'ASS-0003', nome: 'Ofício' },
        { id: 'ASS-0004', nome: 'Ata' },
        { id: 'ASS-0005', nome: 'Requerimento' },
      ]
      query.mockResolvedValueOnce({ rows: fakeRows })

      const result = await catalogService.listAssuntos()

      expect(query).toHaveBeenCalledTimes(1)
      const [sql, params] = query.mock.calls[0]
      expect(sql).toEqual(expect.stringContaining('SELECT id, nome FROM assuntos'))
      expect(sql).toEqual(expect.stringContaining('ORDER BY id'))
      expect(params).toBeUndefined()
      expect(result).toEqual(fakeRows)
    })
  })

  describe('listTiposProcesso', () => {
    it('retorna id e nome de tipos de processo em ordem', async () => {
      const fakeRows = [
        { id: 'TP-0001', nome: 'Processo Administrativo' },
        { id: 'TP-0002', nome: 'Processo Disciplinar' },
      ]
      query.mockResolvedValueOnce({ rows: fakeRows })

      const result = await catalogService.listTiposProcesso()

      expect(query).toHaveBeenCalledTimes(1)
      const [sql, params] = query.mock.calls[0]
      expect(sql).toEqual(expect.stringContaining('SELECT id, nome FROM tipos_processo'))
      expect(sql).toEqual(expect.stringContaining('ORDER BY id'))
      expect(params).toBeUndefined()
      expect(result).toEqual(fakeRows)
    })
  })
})