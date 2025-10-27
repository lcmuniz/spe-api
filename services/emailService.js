const fs = require('fs')
const path = require('path')
require('dotenv').config()
const { MailerSend, EmailParams, Sender, Recipient, Attachment } = require('mailersend')

const apiKey = process.env.MAILERSEND_API_KEY || process.env.API_KEY
if (!apiKey) {
  console.warn('[emailService] MAILERSEND_API_KEY/API_KEY não definido; envios irão falhar.')
}

let mailer
function getMailer() {
  if (!mailer) {
    mailer = new MailerSend({ apiKey })
  }
  return mailer
}

function resolveSender(opts) {
  const email = (opts && opts.email) || process.env.MAILERSEND_SENDER_EMAIL || process.env.SENDER_EMAIL || 'info@domain.com'
  const name = (opts && opts.name) || process.env.MAILERSEND_SENDER_NAME || process.env.SENDER_NAME || 'SPE'
  return new Sender(email, name)
}

function normalizeRecipients(recipients) {
  const arr = Array.isArray(recipients) ? recipients : [recipients]
  return arr
    .filter(Boolean)
    .map(r => {
      if (r instanceof Recipient) return r
      if (typeof r === 'string') return new Recipient(r, r.split('@')[0])
      if (r.email) return new Recipient(r.email, r.name || r.email.split('@')[0])
      throw new Error('recipient inválido')
    })
}

function normalizeAttachments(attachments) {
  if (!attachments || !attachments.length) return []
  return attachments.map(att => {
    if (att instanceof Attachment) return att
    if (att.contentBase64) return new Attachment(att.contentBase64, att.filename || 'file.bin')
    if (att.path) {
      const contentBase64 = fs.readFileSync(path.resolve(att.path), { encoding: 'base64' })
      return new Attachment(contentBase64, att.filename || path.basename(att.path))
    }
    throw new Error('attachment inválido; forneça contentBase64 ou path')
  })
}

async function sendEmail({ from, to, cc, bcc, replyTo, subject, html, text, attachments } = {}) {
  const recipients = normalizeRecipients(to)
  if (!recipients.length) {
    const err = new Error('destinatários (to) são obrigatórios')
    err.code = 400
    throw err
  }
  if (!subject) {
    const err = new Error('subject é obrigatório')
    err.code = 400
    throw err
  }
  if (!html && !text) {
    const err = new Error('html ou text é obrigatório')
    err.code = 400
    throw err
  }
  if (!apiKey) {
    const err = new Error('API_KEY não configurada')
    err.code = 500
    throw err
  }

  const mailerSend = getMailer()
  const sentFrom = resolveSender(from)
  const params = new EmailParams()
    .setFrom(sentFrom)
    .setTo(recipients)
    .setSubject(subject)

  if (replyTo) {
    const rt = Array.isArray(replyTo) ? replyTo[0] : replyTo
    const replyRecipient = normalizeRecipients(rt)[0]
    params.setReplyTo(replyRecipient)
  }
  if (cc && cc.length) params.setCc(normalizeRecipients(cc))
  if (bcc && bcc.length) params.setBcc(normalizeRecipients(bcc))
  if (html) params.setHtml(html)
  if (text) params.setText(text)
  const atts = normalizeAttachments(attachments)
  if (atts.length) params.setAttachments(atts)

  try {
    const response = await mailerSend.email.send(params)
    return { ok: true, response }
  } catch (e) {
    const status = (e && e.status) || (e && e.statusCode) || (e && e.response && e.response.status)
    const data = (e && e.response && e.response.data) || (e && e.data) || (e && e.body) || e
    let detailStr
    try {
      detailStr = typeof data === 'string' ? data : JSON.stringify(data)
    } catch (jsonErr) {
      detailStr = String(data)
    }
    const messageBase = e && e.message ? e.message : detailStr
    const err = new Error(`Falha ao enviar email${status ? ` (status ${status})` : ''}: ${messageBase}`)
    err.code = 502
    if (status) err.status = status
    err.details = data
    throw err
  }
}

function sendToUsuarios({ logins, subject, html, text, cc, bcc, from, replyTo, attachments } = {}) {
  const domain = process.env.INTERNAL_EMAIL_DOMAIN || process.env.MAILERSEND_INTERNAL_DOMAIN
  if (!domain) {
    const err = new Error('INTERNAL_EMAIL_DOMAIN não configurado')
    err.code = 400
    throw err
  }
  const to = (Array.isArray(logins) ? logins : [logins])
    .filter(Boolean)
    .map(login => ({
      email: `${String(login).trim()}@${domain.replace(/^@/, '')}`,
      name: login,
    }))
  return sendEmail({ to, subject, html, text, cc, bcc, from, replyTo, attachments })
}

function sendToExternos({ emails, subject, html, text, cc, bcc, from, replyTo, attachments } = {}) {
  const to = (Array.isArray(emails) ? emails : [emails]).filter(Boolean)
  return sendEmail({ to, subject, html, text, cc, bcc, from, replyTo, attachments })
}

module.exports = {
  sendEmail,
  sendToUsuarios,
  sendToExternos,
}