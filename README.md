# SPE API

Projeto Node.js/Express para a API do SPE, com banco PostgreSQL e testes em Jest.

## Requisitos
- Node.js 18+ (recomendado)
- PostgreSQL 13+ (local ou remoto)

## Configuração
Crie um arquivo `.env` na raiz (já referenciado em `server.js`) com uma das opções abaixo:

Usando `DATABASE_URL`:
```
DATABASE_URL=postgres://usuario:senha@localhost:5432/spe
PGSCHEMA=spe
```

Ou usando variáveis PG*:
```
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=postgres
PGDATABASE=spe
PGSCHEMA=spe
```

Observações:
- O servidor roda em `PORT=3001` (definido no código atual).
- O `PGSCHEMA` é usado para definir o `search_path` do banco.

## Instalação
```
npm install
```

## Scripts
- `npm start` — inicia a API (`server.js`) em `http://localhost:3001`
- `npm test` — executa a suíte de testes (Jest)
- `npm run build` — sem etapa de build (projeto CommonJS puro)

## Endpoints
Alguns endpoints disponíveis (ver `server.js` para lista completa):
- `GET /api/processos` — lista processos
- `GET /api/setores` — lista setores
- `POST /api/processos` — cria processo
- `GET /api/documentos/:id` — obtém documento

## Desenvolvimento
- CORS permite `http://localhost:9000`, `9001`, `9002` por padrão.
- Banco é inicializado com seeds para setores e tipos de processo.

## Licença
Uso interno. Este repositório é privado.