jest.mock('fs', () => ({
  readFileSync: jest.fn().mockReturnValue('QUJD'),
}))
jest.mock('mailersend', () => {
  const last = { sentParams: null }
  const state = { error: null }
  class EmailParams {
    constructor() { this.data = { to: [], cc: [], bcc: [], attachments: [] } }
    setFrom(v) { this.data.from = v; return this }
    setTo(v) { this.data.to = v; return this }
    setSubject(v) { this.data.subject = v; return this }
    setReplyTo(v) { this.data.replyTo = v; return this }
    setCc(v) { this.data.cc = v; return this }
    setBcc(v) { this.data.bcc = v; return this }
    setHtml(v) { this.data.html = v; return this }
    setText(v) { this.data.text = v; return this }
    setAttachments(v) { this.data.attachments = v; return this }
  }
  class Sender { constructor(email, name) { this.email = email; this.name = name } }
  class Recipient { constructor(email, name) { this.email = email; this.name = name } }
  class Attachment { constructor(contentBase64, filename) { this.contentBase64 = contentBase64; this.filename = filename } }
  class MailerSend {
    constructor(opts) {
      this.apiKey = opts.apiKey
      this.email = {
        send: jest.fn(async params => {
          last.sentParams = params
          if (state.error) throw state.error
          return { id: 'mock-sent' }
        }),
      }
    }
  }
  return { MailerSend, EmailParams, Sender, Recipient, Attachment, __last: last, __setError: e => { state.error = e }, __clear: () => { last.sentParams = null; state.error = null } }
})

describe('emailService', () => {
  beforeEach(() => {
    jest.resetModules()
    process.env.MAILERSEND_API_KEY = 'key-123'
    process.env.MAILERSEND_SENDER_EMAIL = 'MS_XqsBtl@eficaz.online'
    process.env.MAILERSEND_SENDER_NAME = 'SPE'
    process.env.INTERNAL_EMAIL_DOMAIN = 'eficaz.online'
    const { __clear } = require('mailersend')
    __clear()
  })

  it('valida destinatários obrigatórios (400)', async () => {
    const svc = require('../emailService')
    await expect(svc.sendEmail({ subject: 'S', html: '<b>x</b>' })).rejects.toMatchObject({ code: 400 })
  })

  it('valida subject obrigatório (400)', async () => {
    const svc = require('../emailService')
    await expect(svc.sendEmail({ to: 'a@b.com', html: '<b>x</b>' })).rejects.toMatchObject({ code: 400 })
  })

  it('valida html ou text obrigatório (400)', async () => {
    const svc = require('../emailService')
    await expect(svc.sendEmail({ to: 'a@b.com', subject: 'S' })).rejects.toMatchObject({ code: 400 })
  })

  it('falha 500 quando API_KEY ausente', async () => {
    jest.resetModules()
    process.env.MAILERSEND_API_KEY = ''
    process.env.API_KEY = ''
    const svc = require('../emailService')
    await expect(svc.sendEmail({ to: 'a@b.com', subject: 'S', html: '<b>x</b>' })).rejects.toMatchObject({ code: 500 })
  })

  it('envia com sucesso e retorna ok: true', async () => {
    const svc = require('../emailService')
    const res = await svc.sendEmail({ to: 'user@exemplo.com', subject: 'Assunto', html: '<b>Olá</b>' })
    expect(res).toEqual({ ok: true, response: { id: 'mock-sent' } })
    const { __last, EmailParams } = require('mailersend')
    expect(__last.sentParams).toBeInstanceOf(EmailParams)
    expect(__last.sentParams.data.subject).toBe('Assunto')
    const toEmails = (__last.sentParams.data.to || []).map(r => r.email)
    expect(toEmails).toEqual(['user@exemplo.com'])
  })

  it('envia com cc, bcc e replyTo normalizados', async () => {
    const svc = require('../emailService')
    await svc.sendEmail({
      to: ['a@b.com'],
      subject: 'S',
      html: '<b>x</b>',
      cc: 'c@d.com',
      bcc: ['e@f.com'],
      replyTo: ['reply@x.com', 'other@y.com'],
    })
    const { __last } = require('mailersend')
    const ccEmails = (__last.sentParams.data.cc || []).map(r => r.email)
    const bccEmails = (__last.sentParams.data.bcc || []).map(r => r.email)
    expect(ccEmails).toEqual(['c@d.com'])
    expect(bccEmails).toEqual(['e@f.com'])
    expect(__last.sentParams.data.replyTo.email).toBe('reply@x.com')
  })

  it('normaliza recipients com string, objeto e instância Recipient', async () => {
    const { Recipient } = require('mailersend')
    const svc = require('../emailService')
    await svc.sendEmail({
      to: ['a@b.com', { email: 'b@c.com', name: 'Bee' }, new Recipient('c@d.com', 'Cee')],
      subject: 'S',
      html: '<b>x</b>',
    })
    const { __last } = require('mailersend')
    const toList = (__last.sentParams.data.to || []).map(r => `${r.email}:${r.name}`)
    expect(toList).toEqual(['a@b.com:a', 'b@c.com:Bee', 'c@d.com:Cee'])
  })

  it('lança erro quando recipient inválido', async () => {
    const svc = require('../emailService')
    await expect(
      svc.sendEmail({ to: [{}], subject: 'S', html: '<b>x</b>' }),
    ).rejects.toThrow('recipient inválido')
  })

  it('attachments via contentBase64 e path (readFileSync)', async () => {
    const svc = require('../emailService')
    await svc.sendEmail({
      to: 'a@b.com',
      subject: 'S',
      html: '<b>x</b>',
      attachments: [
        { contentBase64: 'QUJD', filename: 'x.bin' },
        { path: 'relative/file.txt', filename: 'file.txt' },
      ],
    })
    const { __last } = require('mailersend')
    const atts = __last.sentParams.data.attachments || []
    expect(atts[0].contentBase64).toBe('QUJD')
    expect(atts[0].filename).toBe('x.bin')
    expect(atts[1].contentBase64).toBe('QUJD')
    expect(atts[1].filename).toBe('file.txt')
  })

  it('lança erro quando attachment inválido', async () => {
    const svc = require('../emailService')
    await expect(
      svc.sendEmail({ to: 'a@b.com', subject: 'S', html: '<b>x</b>', attachments: [{ foo: 'bar' }] }),
    ).rejects.toThrow('attachment inválido; forneça contentBase64 ou path')
  })

  it('resolveSender usa from personalizado e default quando envs ausentes', async () => {
    const svc = require('../emailService')
    // personalizado
    await svc.sendEmail({ to: 'a@b.com', subject: 'S', html: '<b>x</b>', from: { email: 'noreply@foo.com', name: 'Foo' } })
    let { __last } = require('mailersend')
    expect(__last.sentParams.data.from.email).toBe('noreply@foo.com')
    expect(__last.sentParams.data.from.name).toBe('Foo')

    // default sem envs
    process.env.MAILERSEND_SENDER_EMAIL = ''
    process.env.SENDER_EMAIL = ''
    process.env.MAILERSEND_SENDER_NAME = ''
    process.env.SENDER_NAME = ''
    await svc.sendEmail({ to: 'a@b.com', subject: 'S2', html: '<b>x</b>' })
    ;({ __last } = require('mailersend'))
    expect(__last.sentParams.data.from.email).toBe('info@domain.com')
    expect(__last.sentParams.data.from.name).toBe('SPE')
  })

  it('sendToUsuarios constrói emails com INTERNAL_EMAIL_DOMAIN', async () => {
    const svc = require('../emailService')
    await svc.sendToUsuarios({ logins: ['user1', 'user2'], subject: 'Aviso', text: 'Mensagem' })
    const { __last } = require('mailersend')
    const toEmails = (__last.sentParams.data.to || []).map(r => r.email)
    expect(toEmails).toEqual(['user1@eficaz.online', 'user2@eficaz.online'])
  })

  it('sendToUsuarios lança 400 quando INTERNAL_EMAIL_DOMAIN ausente', async () => {
    const svc = require('../emailService')
    delete process.env.INTERNAL_EMAIL_DOMAIN
    try {
      await svc.sendToUsuarios({ logins: ['user1'], subject: 'Aviso', text: 'Mensagem' })
      throw new Error('deveria lançar 400')
    } catch (e) {
      expect(e.code).toBe(400)
    }
  })

  it('sendToUsuarios remove @ inicial do domínio', async () => {
    process.env.INTERNAL_EMAIL_DOMAIN = '@dominio.com'
    const svc = require('../emailService')
    await svc.sendToUsuarios({ logins: ['user1'], subject: 'Aviso', text: 'Mensagem' })
    const { __last } = require('mailersend')
    const toEmails = (__last.sentParams.data.to || []).map(r => r.email)
    expect(toEmails).toEqual(['user1@dominio.com'])
  })

  it('sendToExternos normaliza emails string e objeto', async () => {
    const svc = require('../emailService')
    await svc.sendToExternos({ emails: ['x@a.com', { email: 'y@b.com', name: 'Y' }], subject: 'S', text: 'Msg' })
    const { __last } = require('mailersend')
    const toList = (__last.sentParams.data.to || []).map(r => `${r.email}:${r.name}`)
    expect(toList).toEqual(['x@a.com:x', 'y@b.com:Y'])
  })

  describe('tratamento de erros em sendEmail', () => {
    it('propaga status quando presente em e.status', async () => {
      const svc = require('../emailService')
      const { __setError } = require('mailersend')
      __setError({ status: 503, message: 'Service Unavailable', response: { data: { msg: 'falha' } } })
      await expect(
        svc.sendEmail({ to: 'a@b.com', subject: 'S', html: '<b>x</b>' }),
      ).rejects.toMatchObject({ code: 502, status: 503 })
    })

    it('propaga status quando presente em e.statusCode', async () => {
      const svc = require('../emailService')
      const { __setError } = require('mailersend')
      __setError({ statusCode: 500, response: { data: 'boom' } })
      await expect(
        svc.sendEmail({ to: 'a@b.com', subject: 'S', html: '<b>x</b>' }),
      ).rejects.toMatchObject({ code: 502, status: 500 })
    })

    it('propaga status quando presente em e.response.status e detalhes objeto', async () => {
      const svc = require('../emailService')
      const { __setError } = require('mailersend')
      __setError({ response: { status: 429, data: { reason: 'rate limit' } } })
      try {
        await svc.sendEmail({ to: 'a@b.com', subject: 'S', html: '<b>x</b>' })
        throw new Error('deveria falhar')
      } catch (e) {
        expect(e.code).toBe(502)
        expect(e.status).toBe(429)
        expect(e.details).toEqual({ reason: 'rate limit' })
        expect(e.message).toContain('Falha ao enviar email')
      }
    })

    it('stringify falha e usa String(data) quando data é BigInt', async () => {
      const svc = require('../emailService')
      const { __setError } = require('mailersend')
      __setError({ response: { data: BigInt(123) } })
      try {
        await svc.sendEmail({ to: 'a@b.com', subject: 'S', html: '<b>x</b>' })
        throw new Error('deveria falhar')
      } catch (e) {
        expect(e.code).toBe(502)
        expect(String(e.details)).toBe('123')
        expect(e.message).toContain('Falha ao enviar email')
      }
    })
  })
})