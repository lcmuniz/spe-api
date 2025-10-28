jest.mock('../../db', () => ({
  query: jest.fn(),
}))

const { query } = require('../../db')
const documentosModelosService = require('../documentosModelosService')

describe('documentosModelosService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    query.mockReset()
  })

  describe('listModelos', () => {
    it('lista modelos sem filtro de tipo', async () => {
      const fakeRows = [
        { id: 'm1', nome: 'Modelo 1', tipoId: null, tipoNome: null, criadoEm: '2024-01-01' },
      ]
      query.mockResolvedValueOnce({ rows: fakeRows })

      const result = await documentosModelosService.listModelos()

      expect(query).toHaveBeenCalledTimes(1)
      const [sql, params] = query.mock.calls[0]
      expect(sql).toEqual(expect.stringContaining('FROM documento_modelos'))
      expect(sql).toEqual(expect.stringContaining('LEFT JOIN tipos_documento'))
      expect(sql).toEqual(expect.stringContaining('ORDER BY dm.nome'))
      expect(params).toEqual([])
      expect(result).toEqual(fakeRows)
    })

    it('lista modelos filtrando por tipoId quando informado', async () => {
      const fakeRows = [
        { id: 'm2', nome: 'Modelo 2', tipoId: 'td1', tipoNome: 'Ofício', criadoEm: '2024-02-01' },
      ]
      query.mockResolvedValueOnce({ rows: fakeRows })

      const result = await documentosModelosService.listModelos({ tipoId: 'td1' })

      expect(query).toHaveBeenCalledTimes(1)
      const [sql, params] = query.mock.calls[0]
      expect(sql).toEqual(expect.stringContaining('WHERE dm.tipo_id = $1'))
      expect(params).toEqual(['td1'])
      expect(result).toEqual(fakeRows)
    })
  })

  describe('getModeloById', () => {
    it('retorna null quando modelo não encontrado', async () => {
      query.mockResolvedValueOnce({ rows: [] })

      const result = await documentosModelosService.getModeloById('m-x')

      expect(query).toHaveBeenCalledTimes(1)
      const [sql, params] = query.mock.calls[0]
      expect(sql).toEqual(expect.stringContaining('WHERE dm.id = $1'))
      expect(params).toEqual(['m-x'])
      expect(result).toBeNull()
    })

    it('retorna objeto quando encontrado', async () => {
      const row = { id: 'm1', nome: 'Modelo', tipoId: null, tipoNome: null, conteudo: '<p>...</p>' }
      query.mockResolvedValueOnce({ rows: [row] })

      const result = await documentosModelosService.getModeloById('m1')

      expect(query).toHaveBeenCalledTimes(1)
      expect(result).toEqual(row)
    })
  })
})