jest.mock('../../db', () => ({
  query: jest.fn(),
}))

const { query } = require('../../db')
const tx = require('../transacoesService')

describe('transacoesService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('beginTransaction chama BEGIN uma vez', async () => {
    query.mockResolvedValueOnce({})
    await tx.beginTransaction()
    expect(query).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledWith('BEGIN')
  })

  it('commitTransaction chama COMMIT uma vez', async () => {
    query.mockResolvedValueOnce({})
    await tx.commitTransaction()
    expect(query).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledWith('COMMIT')
  })

  it('rollback chama ROLLBACK e resolve no sucesso', async () => {
    query.mockResolvedValueOnce({})
    await expect(tx.rollback()).resolves.toBeUndefined()
    expect(query).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledWith('ROLLBACK')
  })

  it('rollback engole o erro quando ROLLBACK falha', async () => {
    query.mockRejectedValueOnce(new Error('DB failure'))
    await expect(tx.rollback()).resolves.toBeUndefined()
    expect(query).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledWith('ROLLBACK')
  })
})