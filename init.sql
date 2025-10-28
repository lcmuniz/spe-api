CREATE SCHEMA IF NOT EXISTS {{schema}};

SET search_path TO {{schema}}, public;

CREATE TABLE IF NOT EXISTS auditoria ( id UUID PRIMARY KEY, data TIMESTAMPTZ NOT NULL DEFAULT now(), acao VARCHAR(100) NOT NULL, usuario_login VARCHAR(100), entidade VARCHAR(100), entidade_id VARCHAR(100), detalhes JSONB, ip VARCHAR(15), user_agent TEXT, rota VARCHAR(255) );

CREATE TABLE IF NOT EXISTS cadastro_partes ( id UUID PRIMARY KEY, tipo VARCHAR(20) NOT NULL, nome VARCHAR(255) NOT NULL, documento VARCHAR(50), email VARCHAR(255), telefone VARCHAR(50), endereco_logradouro VARCHAR(255), endereco_numero VARCHAR(50), endereco_complemento VARCHAR(255), endereco_bairro VARCHAR(255), endereco_cidade VARCHAR(255), endereco_estado VARCHAR(2), endereco_cep VARCHAR(20), chave VARCHAR(100), chave_ativo BOOLEAN NOT NULL DEFAULT TRUE, chave_criado_em TIMESTAMPTZ NOT NULL DEFAULT now() );

CREATE INDEX IF NOT EXISTS idx_cad_partes_nome ON cadastro_partes(nome);

CREATE INDEX IF NOT EXISTS idx_cad_partes_doc ON cadastro_partes(documento);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cad_partes_chave ON cadastro_partes(chave);

CREATE TABLE IF NOT EXISTS tipos_documento ( id VARCHAR(50) PRIMARY KEY, nome VARCHAR(255) NOT NULL );

CREATE INDEX IF NOT EXISTS idx_tipos_documento_nome ON tipos_documento(nome);

INSERT INTO tipos_documento (id, nome) VALUES ('TD-0001','Requerimento'), ('TD-0002','Ofício'), ('TD-0003','Documento') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS documento_modelos ( id UUID PRIMARY KEY, nome VARCHAR(255) NOT NULL, tipo_id VARCHAR(50) NOT NULL, conteudo TEXT NOT NULL, criado_em TIMESTAMPTZ NOT NULL DEFAULT now() );

ALTER TABLE documento_modelos DROP CONSTRAINT IF EXISTS documento_modelos_tipo_id_fkey, ADD CONSTRAINT documento_modelos_tipo_id_fkey FOREIGN KEY (tipo_id) REFERENCES tipos_documento(id);

CREATE INDEX IF NOT EXISTS idx_doc_modelos_tipo_id ON documento_modelos(tipo_id);

CREATE TABLE IF NOT EXISTS documentos ( id UUID PRIMARY KEY, titulo VARCHAR(255) NOT NULL, tipo_id VARCHAR(50), modo VARCHAR(50) NOT NULL DEFAULT 'Editor', status VARCHAR(50) NOT NULL DEFAULT 'rascunho', file_name VARCHAR(255), content_base64 TEXT, conteudo TEXT, autor VARCHAR(100), assinado_por VARCHAR(100), assinado_em TIMESTAMPTZ, criado_em TIMESTAMPTZ NOT NULL DEFAULT now() );

ALTER TABLE documentos DROP CONSTRAINT IF EXISTS documentos_tipo_id_fkey, ADD CONSTRAINT documentos_tipo_id_fkey FOREIGN KEY (tipo_id) REFERENCES tipos_documento(id);

CREATE INDEX IF NOT EXISTS idx_documentos_tipo_id ON documentos(tipo_id);

CREATE TABLE IF NOT EXISTS tipos_processo ( id VARCHAR(50) PRIMARY KEY, nome VARCHAR(255) NOT NULL );

CREATE INDEX IF NOT EXISTS idx_tipos_processo_nome ON tipos_processo(nome);

INSERT INTO tipos_processo (id, nome) VALUES ('TP-0001','Processo Administrativo'), ('TP-0002','Requerimento'), ('TP-0003','Denúncia') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS processos ( id UUID PRIMARY KEY, numero VARCHAR(50) UNIQUE NOT NULL, assunto VARCHAR(255) NOT NULL, tipo_id VARCHAR(50), nivel_acesso VARCHAR(50) NOT NULL, base_legal TEXT, observacoes TEXT, status VARCHAR(50) NOT NULL DEFAULT 'Em instrução', prioridade VARCHAR(50) NOT NULL DEFAULT 'Normal', setor_atual VARCHAR(100) NOT NULL DEFAULT 'PROTOCOLO', atribuido_usuario VARCHAR(100), prazo DATE, pendente BOOLEAN NOT NULL DEFAULT false, pendente_destino_setor VARCHAR(100), pendente_origem_setor VARCHAR(100), criado_em TIMESTAMPTZ NOT NULL DEFAULT now() );

ALTER TABLE processos DROP CONSTRAINT IF EXISTS processos_tipo_id_fkey, ADD CONSTRAINT processos_tipo_id_fkey FOREIGN KEY (tipo_id) REFERENCES tipos_processo(id);

CREATE INDEX IF NOT EXISTS idx_processos_tipo_id ON processos(tipo_id);

CREATE INDEX IF NOT EXISTS idx_processos_assunto ON processos(assunto);

CREATE TABLE IF NOT EXISTS externo_documentos_temp ( id UUID PRIMARY KEY, processo_id UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE, parte_id UUID NOT NULL REFERENCES cadastro_partes(id) ON DELETE CASCADE, file_name VARCHAR(255) NOT NULL, content_base64 TEXT NOT NULL, status VARCHAR(32) NOT NULL DEFAULT 'aguardando_analise', titulo VARCHAR(255), rejeicao_motivo TEXT, rejeitado_em TIMESTAMPTZ, criado_em TIMESTAMPTZ NOT NULL DEFAULT now() );

CREATE INDEX IF NOT EXISTS idx_ext_docs_temp_proc ON externo_documentos_temp(processo_id);

CREATE INDEX IF NOT EXISTS idx_ext_docs_temp_parte_id ON externo_documentos_temp(parte_id);

CREATE TABLE IF NOT EXISTS processo_acessos ( id UUID PRIMARY KEY, processo_id UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE, tipo VARCHAR(20) NOT NULL, valor VARCHAR(255), criado_em TIMESTAMPTZ NOT NULL DEFAULT now() );

CREATE INDEX IF NOT EXISTS idx_proc_acessos_proc ON processo_acessos(processo_id);

CREATE INDEX IF NOT EXISTS idx_proc_acessos_tipo ON processo_acessos(tipo);

CREATE TABLE IF NOT EXISTS processo_documentos ( processo_id UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE, documento_id UUID NOT NULL REFERENCES documentos(id) ON DELETE CASCADE, PRIMARY KEY (processo_id, documento_id) );

CREATE TABLE IF NOT EXISTS processo_partes ( id UUID PRIMARY KEY, processo_id UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE, papel VARCHAR(100), cadastro_parte_id UUID REFERENCES cadastro_partes(id) ON DELETE SET NULL );

CREATE INDEX IF NOT EXISTS idx_proc_partes_cadastro ON processo_partes(cadastro_parte_id);

CREATE TABLE IF NOT EXISTS setores ( sigla VARCHAR(100) PRIMARY KEY, nome VARCHAR(255) NOT NULL );

INSERT INTO setores (sigla, nome) VALUES ('PROTOCOLO','Protocolo'), ('GABINETE','Gabinete'), ('JURÍDICO','Jurídico'), ('TI','Tecnologia da Informação'), ('FINANCEIRO','Financeiro') ON CONFLICT (sigla) DO NOTHING;

CREATE TABLE IF NOT EXISTS tramites ( id UUID PRIMARY KEY, processo_id UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE, origem_setor VARCHAR(100), destino_setor VARCHAR(100), motivo TEXT, prioridade VARCHAR(50), prazo DATE, origem_usuario VARCHAR(100), data TIMESTAMPTZ NOT NULL DEFAULT now() );

CREATE TABLE IF NOT EXISTS usuarios ( login VARCHAR(100) PRIMARY KEY, setor VARCHAR(100) NOT NULL REFERENCES setores(sigla), nome VARCHAR(255), cargo VARCHAR(255) );

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_setor_fkey, ADD CONSTRAINT usuarios_setor_fkey FOREIGN KEY (setor) REFERENCES setores(sigla);
