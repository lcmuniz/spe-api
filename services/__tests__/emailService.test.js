jest.mock('mailersend', () => {
  const last = { sentParams: null }
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
          return { id: 'mock-sent' }
        }),
      }
    }
  }
  return { MailerSend, EmailParams, Sender, Recipient, Attachment, __last: last }
})

describe('emailService', () => {
  beforeEach(() => {
    jest.resetModules()
    process.env.MAILERSEND_API_KEY = 'key-123'
    process.env.MAILERSEND_SENDER_EMAIL = 'MS_XqsBtl@eficaz.online'
    process.env.MAILERSEND_SENDER_NAME = 'SPE'
    process.env.INTERNAL_EMAIL_DOMAIN = 'eficaz.online'
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
})