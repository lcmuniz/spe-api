async function main() {
  const svc = require('./services/emailService')
  try {
    const resp = await svc.sendEmail({
      to: 'lcmuniz@gmail.com',
      subject: 'S',
      html: '<b>x</b>',
    })
    console.log('Envio OK:', resp)
  } catch (e) {
    console.error('Erro ao enviar:', e && e.message)
    if (e && e.code) console.error('code:', e.code)
    if (e && e.status) console.error('status:', e.status)
    if (e && e.details) console.error('details:', e.details)
  }
}

main()