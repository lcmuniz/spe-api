jest.mock('../../db', () => ({
  query: jest.fn(),
}))

const { query } = require('../../db')

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'audit-123'),
}))

const { auditLog } = require('../auditoriaService')

describe('auditoriaService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('insere registro com detalhes objeto removendo cargo vazio', async () => {
    query.mockResolvedValueOnce({})
    const req = {
      headers: { 'x-forwarded-for': '1.2.3.4', 'user-agent': 'UA' },
      originalUrl: '/api/foo',
    }

    await auditLog(req, {
      acao: 'user.create',
      usuarioLogin: 'u1',
      entidade: 'usuarios',
      entidadeId: 'user-1',
      detalhes: { cargo: '', extra: 'x' },
    })

    expect(query).toHaveBeenCalledTimes(1)
    const [sql, params] = query.mock.calls[0]
    expect(sql).toEqual(expect.stringContaining('INSERT INTO auditoria'))
    expect(params).toEqual([
      'audit-123',
      'user.create',
      'u1',
      'usuarios',
      'user-1',
      { extra: 'x' },
      '1.2.3.4',
      'UA',
      '/api/foo',
    ])
  })

  it('insere com detalhes string, ip de connection e url fallback', async () => {
    query.mockResolvedValueOnce({})
    const req = {
      headers: {},
      connection: { remoteAddress: '9.9.9.9' },
      url: '/bar',
    }

    await auditLog(req, {
      acao: 'acao',
      usuarioLogin: null,
      entidade: 'E',
      entidadeId: 'E-1',
      detalhes: 'texto',
    })

    const [sql, params] = query.mock.calls[0]
    expect(sql).toEqual(expect.stringContaining('INSERT INTO auditoria'))
    expect(params).toEqual([
      'audit-123',
      'acao',
      null,
      'E',
      'E-1',
      'texto',
      '9.9.9.9',
      '',
      '/bar',
    ])
  })

  it('não lança quando query falha e registra erro', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    query.mockRejectedValueOnce(new Error('db falhou'))

    const req = { headers: { 'x-forwarded-for': '127.0.0.1' }, url: '/err' }

    await expect(
      auditLog(req, { acao: 'acao', usuarioLogin: 'u1', entidade: 'X', entidadeId: 'X-1', detalhes: { a: 1 } })
    ).resolves.toBeUndefined()

    expect(query).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Falha ao registrar auditoria:'), expect.any(Error))
    spy.mockRestore()
  })
})