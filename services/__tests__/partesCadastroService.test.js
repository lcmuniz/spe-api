jest.mock('../../db', () => ({ query: jest.fn() }))
const { query } = require('../../db')

jest.mock('crypto', () => ({
  randomUUID: jest.fn(() => 'uuid-123'),
}))
const { randomUUID } = require('crypto')

const service = require('../partesCadastroService')

describe('partesCadastroService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('listarPartesCadastro', () => {
    it('lista com filtro q, limit e offset', async () => {
      const fakeRows = [{ id: 'p1', nome: 'Alice' }]
      query.mockResolvedValueOnce({ rows: fakeRows })

      const res = await service.listarPartesCadastro({ q: 'Ali', limit: 10, offset: 5 })

      expect(query).toHaveBeenCalledTimes(1)
      const [sql, params] = query.mock.calls[0]
      expect(sql).toEqual(expect.stringContaining('FROM cadastro_partes'))
      expect(sql).toEqual(expect.stringContaining('WHERE nome ILIKE $1 OR documento ILIKE $1'))
      expect(sql).toEqual(expect.stringContaining('ORDER BY nome ASC'))
      expect(sql).toEqual(expect.stringContaining('LIMIT $2 OFFSET $3'))
      expect(params).toEqual(['%Ali%', 10, 5])
      expect(res).toEqual(fakeRows)
    })

    it('lista sem filtro q (defaults limit=50, offset=0)', async () => {
      query.mockResolvedValueOnce({ rows: [] })

      const res = await service.listarPartesCadastro()

      expect(query).toHaveBeenCalledTimes(1)
      const [sql, params] = query.mock.calls[0]
      expect(sql).toEqual(expect.stringContaining('FROM cadastro_partes'))
      expect(sql).not.toEqual(expect.stringContaining('WHERE nome ILIKE'))
      expect(sql).toEqual(expect.stringContaining('LIMIT $1 OFFSET $2'))
      expect(params).toEqual([50, 0])
      expect(res).toEqual([])
    })
  })

  describe('obterParteCadastro', () => {
    it('retorna registro por id', async () => {
      const row = { id: 'p1', nome: 'Alice' }
      query.mockResolvedValueOnce({ rows: [row] })

      const res = await service.obterParteCadastro('p1')

      expect(query).toHaveBeenCalledTimes(1)
      const [sql, params] = query.mock.calls[0]
      expect(sql).toEqual(expect.stringContaining('SELECT * FROM cadastro_partes WHERE id = $1'))
      expect(params).toEqual(['p1'])
      expect(res).toEqual(row)
    })
  })

  describe('criarParteCadastro', () => {
    it('insere com id gerado e normaliza UF', async () => {
      const created = {
        id: 'uuid-123',
        tipo: 'FISICA',
        nome: 'Alice',
        documento: '123',
        email: 'a@x.com',
        telefone: '999',
        endereco_logradouro: 'Rua',
        endereco_numero: '10',
        endereco_complemento: null,
        endereco_bairro: 'Centro',
        endereco_cidade: 'SP',
        endereco_estado: 'SP',
        endereco_cep: '01000-000',
      }
      query.mockResolvedValueOnce({ rows: [created] })

      const res = await service.criarParteCadastro({
        tipo: 'FISICA',
        nome: 'Alice',
        documento: '123',
        email: 'a@x.com',
        telefone: '999',
        endereco_logradouro: 'Rua',
        endereco_numero: '10',
        endereco_bairro: 'Centro',
        endereco_cidade: 'SP',
        endereco_estado: 'sp',
        endereco_cep: '01000-000',
      })

      expect(query).toHaveBeenCalledTimes(1)
      const [sql, params] = query.mock.calls[0]
      expect(sql).toEqual(expect.stringContaining('INSERT INTO cadastro_partes'))
      expect(params[0]).toBe('uuid-123')
      expect(params[1]).toBe('FISICA')
      expect(params[2]).toBe('Alice')
      expect(params[3]).toBe('123')
      expect(params[4]).toBe('a@x.com')
      expect(params[5]).toBe('999')
      expect(params[6]).toBe('Rua')
      expect(params[7]).toBe('10')
      expect(params[8]).toBe(null)
      expect(params[9]).toBe('Centro')
      expect(params[10]).toBe('SP')
      expect(params[11]).toBe('SP')
      expect(params[12]).toBe('01000-000')
      expect(res).toEqual(created)
      expect(randomUUID).toHaveBeenCalled()
    })
  })

  describe('atualizarParteCadastro', () => {
    it('atualiza com ordem fixa e normaliza UF', async () => {
      const updated = { id: 'p1', nome: 'Bob', tipo: 'JURIDICA', endereco_estado: 'SP' }
      query.mockResolvedValueOnce({ rows: [updated] })

      const res = await service.atualizarParteCadastro('p1', { nome: 'Bob', tipo: 'JURIDICA', endereco_estado: 'sp' })

      expect(query).toHaveBeenCalledTimes(1)
      const [sql, params] = query.mock.calls[0]
      expect(sql).toEqual(expect.stringContaining('UPDATE cadastro_partes SET'))
      expect(sql).toEqual(expect.stringContaining('WHERE id = $13'))
      expect(params).toEqual([
        'JURIDICA',
        'Bob',
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        'SP',
        null,
        'p1',
      ])
      expect(res).toEqual(updated)
    })
  })

  describe('removerParteCadastro', () => {
    it('bloqueia exclusão quando há vínculo em processo_partes pelo cadastro_parte_id', async () => {
      // 1) SELECT vínculo em processo_partes por cadastro_parte_id
      query.mockResolvedValueOnce({ rows: [{ exists: 1 }] })

      await expect(service.removerParteCadastro('p1')).rejects.toMatchObject({
        code: 400,
        message: expect.stringContaining('vinculada a processos'),
      })

      expect(query).toHaveBeenCalledTimes(1)
      expect(query.mock.calls[0][0]).toEqual(
        expect.stringContaining('FROM processo_partes WHERE cadastro_parte_id = $1'),
      )
      expect(query.mock.calls[0][1]).toEqual(['p1'])
    })

    it('exclui quando não há vínculo e retorna ok', async () => {
      // 1) SELECT vínculo vazio por cadastro_parte_id
      query.mockResolvedValueOnce({ rows: [] })
      // 2) DELETE cadastro
      query.mockResolvedValueOnce({ rowCount: 1 })

      const res = await service.removerParteCadastro('p1')

      expect(query).toHaveBeenCalledTimes(2)
      expect(query.mock.calls[1][0]).toEqual(
        expect.stringContaining('DELETE FROM cadastro_partes WHERE id = $1'),
      )
      expect(query.mock.calls[1][1]).toEqual(['p1'])
      expect(res).toEqual({ ok: true })
    })

    it('exclui quando SELECT retorna objeto sem rows (links.rows indefinido)', async () => {
      // 1) SELECT vínculo sem propriedade rows
      query.mockResolvedValueOnce({})
      // 2) DELETE cadastro
      query.mockResolvedValueOnce({ rowCount: 1 })

      const res = await service.removerParteCadastro('p1')

      expect(query).toHaveBeenCalledTimes(2)
      expect(query.mock.calls[1][0]).toEqual(
        expect.stringContaining('DELETE FROM cadastro_partes WHERE id = $1'),
      )
      expect(query.mock.calls[1][1]).toEqual(['p1'])
      expect(res).toEqual({ ok: true })
    })
  })
})