require('dotenv').config()
const { initDb } = require('../db')

;(async () => {
  try {
    await initDb()
    console.log('Migração aplicada com sucesso: externo_documentos_temp agora usa parte_id')
    process.exit(0)
  } catch (e) {
    console.error('Falha ao aplicar migração:', e)
    process.exit(1)
  }
})()