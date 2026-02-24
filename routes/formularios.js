const express = require('express');
const crypto = require('crypto');
const { pool } = require('../database');

const router = express.Router();

let estruturaGarantida = false;
let estruturaPromise = null;

async function hasTable(tableName) {
    const [rows] = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
    `, [tableName]);
    return !!(rows && rows[0] && rows[0].cnt > 0);
}

async function hasColumn(tableName, columnName) {
    const [rows] = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
    `, [tableName, columnName]);
    return !!(rows && rows[0] && rows[0].cnt > 0);
}

async function getColumnType(tableName, columnName) {
    const [rows] = await pool.query(`
        SELECT DATA_TYPE AS data_type
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
        LIMIT 1
    `, [tableName, columnName]);
    return rows && rows[0] ? String(rows[0].data_type || '').toLowerCase() : null;
}

async function runAlterIgnoreDuplicate(sql) {
    try {
        await pool.query(sql);
    } catch (err) {
        if (err && err.code === 'ER_DUP_FIELDNAME') return;
        throw err;
    }
}

async function garantirEstrutura() {
    if (estruturaGarantida) return;
    if (estruturaPromise) {
        await estruturaPromise;
        return;
    }

    estruturaPromise = (async () => {
        await pool.query(`
        CREATE TABLE IF NOT EXISTS formularios_pastas (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tenant_id INT NOT NULL,
            nome VARCHAR(160) NOT NULL,
            parent_id INT NULL,
            criado_por INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            CONSTRAINT fk_formularios_pastas_parent
                FOREIGN KEY (parent_id) REFERENCES formularios_pastas(id)
                ON DELETE CASCADE,
            CONSTRAINT fk_formularios_pastas_user
                FOREIGN KEY (criado_por) REFERENCES usuarios(id)
                ON DELETE SET NULL
        )
        `);

        await pool.query(`
        CREATE TABLE IF NOT EXISTS formularios_itens (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tenant_id INT NOT NULL,
            titulo VARCHAR(180) NOT NULL,
            tema VARCHAR(200) NULL,
            tipo VARCHAR(40) NOT NULL DEFAULT 'LISTA_PRESENCA',
            token VARCHAR(80) NOT NULL UNIQUE,
            pasta_id INT NULL,
            evento_data DATE NULL,
            evento_hora TIME NULL,
            criar_lista_presenca TINYINT(1) NOT NULL DEFAULT 1,
            usar_lista_jovens TINYINT(1) NOT NULL DEFAULT 1,
            coletar_dados_avulsos TINYINT(1) NOT NULL DEFAULT 0,
            permitir_ja_fez_ejc TINYINT(1) NOT NULL DEFAULT 1,
            permitir_nao_fez_ejc TINYINT(1) NOT NULL DEFAULT 1,
            pergunta_texto_obrigatoria VARCHAR(220) NULL,
            criado_por INT NULL,
            ativo TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            CONSTRAINT fk_formularios_itens_pasta
                FOREIGN KEY (pasta_id) REFERENCES formularios_pastas(id)
                ON DELETE CASCADE,
            CONSTRAINT fk_formularios_itens_user
                FOREIGN KEY (criado_por) REFERENCES usuarios(id)
                ON DELETE SET NULL
        )
        `);

        await pool.query(`
        CREATE TABLE IF NOT EXISTS formularios_presencas (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tenant_id INT NOT NULL,
            formulario_id INT NOT NULL,
            jovem_id INT NULL,
            nome_completo VARCHAR(180) NULL,
            telefone VARCHAR(30) NULL,
            ejc_origem VARCHAR(140) NULL,
            status_ejc VARCHAR(20) NULL,
            origem_ja_fez VARCHAR(20) NULL,
            outro_ejc_id INT NULL,
            resposta_texto_obrigatoria VARCHAR(255) NULL,
            registrado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ip VARCHAR(64) NULL,
            user_agent VARCHAR(255) NULL,
            UNIQUE KEY uniq_formulario_jovem (formulario_id, jovem_id),
            CONSTRAINT fk_form_presenca_formulario
                FOREIGN KEY (formulario_id) REFERENCES formularios_itens(id)
                ON DELETE CASCADE,
            CONSTRAINT fk_form_presenca_jovem
                FOREIGN KEY (jovem_id) REFERENCES jovens(id)
                ON DELETE CASCADE
        )
        `);

        await pool.query(`
        CREATE TABLE IF NOT EXISTS formularios_respostas (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tenant_id INT NOT NULL,
            formulario_id INT NOT NULL,
            nome_referencia VARCHAR(180) NULL,
            telefone_referencia VARCHAR(30) NULL,
            resposta_json LONGTEXT NOT NULL,
            registrado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ip VARCHAR(64) NULL,
            user_agent VARCHAR(255) NULL,
            CONSTRAINT fk_form_respostas_formulario
                FOREIGN KEY (formulario_id) REFERENCES formularios_itens(id)
                ON DELETE CASCADE
        )
        `);

        const comEventoData = await hasColumn('formularios_itens', 'evento_data');
        if (!comEventoData) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_itens ADD COLUMN evento_data DATE NULL AFTER pasta_id');
        }
        const comEventoHora = await hasColumn('formularios_itens', 'evento_hora');
        if (!comEventoHora) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_itens ADD COLUMN evento_hora TIME NULL AFTER evento_data');
        }
        const comTema = await hasColumn('formularios_itens', 'tema');
        if (!comTema) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_itens ADD COLUMN tema VARCHAR(200) NULL AFTER titulo');
        }
        const comDescricao = await hasColumn('formularios_itens', 'descricao');
        if (!comDescricao) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_itens ADD COLUMN descricao TEXT NULL AFTER tema');
        }
        const comCamposConfig = await hasColumn('formularios_itens', 'campos_config_json');
        if (!comCamposConfig) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_itens ADD COLUMN campos_config_json LONGTEXT NULL AFTER pergunta_texto_obrigatoria');
        }
        const comCriarLista = await hasColumn('formularios_itens', 'criar_lista_presenca');
        if (!comCriarLista) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_itens ADD COLUMN criar_lista_presenca TINYINT(1) NOT NULL DEFAULT 1 AFTER evento_hora');
        }
        const comUsarListaJovens = await hasColumn('formularios_itens', 'usar_lista_jovens');
        if (!comUsarListaJovens) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_itens ADD COLUMN usar_lista_jovens TINYINT(1) NOT NULL DEFAULT 1 AFTER evento_hora');
        }
        const comColetarDadosAvulsos = await hasColumn('formularios_itens', 'coletar_dados_avulsos');
        if (!comColetarDadosAvulsos) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_itens ADD COLUMN coletar_dados_avulsos TINYINT(1) NOT NULL DEFAULT 0 AFTER usar_lista_jovens');
        }
        const comPermitirJaFez = await hasColumn('formularios_itens', 'permitir_ja_fez_ejc');
        if (!comPermitirJaFez) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_itens ADD COLUMN permitir_ja_fez_ejc TINYINT(1) NOT NULL DEFAULT 1 AFTER coletar_dados_avulsos');
        }
        const comPermitirNaoFez = await hasColumn('formularios_itens', 'permitir_nao_fez_ejc');
        if (!comPermitirNaoFez) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_itens ADD COLUMN permitir_nao_fez_ejc TINYINT(1) NOT NULL DEFAULT 1 AFTER permitir_ja_fez_ejc');
        }
        const comPerguntaTextoObrigatoria = await hasColumn('formularios_itens', 'pergunta_texto_obrigatoria');
        if (!comPerguntaTextoObrigatoria) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_itens ADD COLUMN pergunta_texto_obrigatoria VARCHAR(220) NULL AFTER permitir_nao_fez_ejc');
        }
        const comLinkInicio = await hasColumn('formularios_itens', 'link_inicio_hora');
        if (!comLinkInicio) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_itens ADD COLUMN link_inicio_hora TIME NULL AFTER permitir_nao_fez_ejc');
        } else {
            const tipoLinkInicio = await getColumnType('formularios_itens', 'link_inicio_hora');
            if (tipoLinkInicio && tipoLinkInicio !== 'time') {
                await pool.query('ALTER TABLE formularios_itens MODIFY COLUMN link_inicio_hora TIME NULL');
            }
        }
        const comLinkFim = await hasColumn('formularios_itens', 'link_fim_hora');
        if (!comLinkFim) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_itens ADD COLUMN link_fim_hora TIME NULL AFTER link_inicio_hora');
        } else {
            const tipoLinkFim = await getColumnType('formularios_itens', 'link_fim_hora');
            if (tipoLinkFim && tipoLinkFim !== 'time') {
                await pool.query('ALTER TABLE formularios_itens MODIFY COLUMN link_fim_hora TIME NULL');
            }
        }
        const comTenantPastas = await hasColumn('formularios_pastas', 'tenant_id');
        if (!comTenantPastas) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_pastas ADD COLUMN tenant_id INT NULL AFTER id');
        }
        const comTenantItens = await hasColumn('formularios_itens', 'tenant_id');
        if (!comTenantItens) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_itens ADD COLUMN tenant_id INT NULL AFTER id');
        }
        const comTenantPresencas = await hasColumn('formularios_presencas', 'tenant_id');
        if (!comTenantPresencas) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_presencas ADD COLUMN tenant_id INT NULL AFTER id');
        }
        const comTenantRespostas = await hasColumn('formularios_respostas', 'tenant_id');
        if (!comTenantRespostas) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_respostas ADD COLUMN tenant_id INT NULL AFTER id');
        }

        const comNomeCompleto = await hasColumn('formularios_presencas', 'nome_completo');
        if (!comNomeCompleto) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_presencas ADD COLUMN nome_completo VARCHAR(180) NULL AFTER jovem_id');
        }
        const comTelefone = await hasColumn('formularios_presencas', 'telefone');
        if (!comTelefone) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_presencas ADD COLUMN telefone VARCHAR(30) NULL AFTER nome_completo');
        }
        const comEjcOrigem = await hasColumn('formularios_presencas', 'ejc_origem');
        if (!comEjcOrigem) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_presencas ADD COLUMN ejc_origem VARCHAR(140) NULL AFTER telefone');
        }
        const comStatusEjc = await hasColumn('formularios_presencas', 'status_ejc');
        if (!comStatusEjc) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_presencas ADD COLUMN status_ejc VARCHAR(20) NULL AFTER ejc_origem');
        }
        const comOrigemJaFez = await hasColumn('formularios_presencas', 'origem_ja_fez');
        if (!comOrigemJaFez) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_presencas ADD COLUMN origem_ja_fez VARCHAR(20) NULL AFTER status_ejc');
        }
        const comOutroEjcId = await hasColumn('formularios_presencas', 'outro_ejc_id');
        if (!comOutroEjcId) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_presencas ADD COLUMN outro_ejc_id INT NULL AFTER origem_ja_fez');
        }
        const comRespostaTextoObrigatoria = await hasColumn('formularios_presencas', 'resposta_texto_obrigatoria');
        if (!comRespostaTextoObrigatoria) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_presencas ADD COLUMN resposta_texto_obrigatoria VARCHAR(255) NULL AFTER outro_ejc_id');
        }
        const jovemIdNullable = await pool.query(`
        SELECT IS_NULLABLE AS is_nullable
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'formularios_presencas'
          AND COLUMN_NAME = 'jovem_id'
        LIMIT 1
        `);
        const nullable = jovemIdNullable && jovemIdNullable[0] && jovemIdNullable[0][0]
            ? String(jovemIdNullable[0][0].is_nullable || '').toUpperCase() === 'YES'
            : true;
        if (!nullable) {
            await pool.query('ALTER TABLE formularios_presencas MODIFY COLUMN jovem_id INT NULL');
        }

        estruturaGarantida = true;
    })();

    try {
        await estruturaPromise;
    } finally {
        estruturaPromise = null;
    }
}

function toPositiveInt(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function toBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    const txt = String(value || '').trim().toLowerCase();
    return txt === '1' || txt === 'true' || txt === 'sim' || txt === 'on';
}

function buildTree(rows) {
    const map = new Map();
    rows.forEach(r => map.set(r.id, { ...r, children: [] }));

    const roots = [];
    rows.forEach(r => {
        const node = map.get(r.id);
        if (r.parent_id && map.has(r.parent_id)) {
            map.get(r.parent_id).children.push(node);
        } else {
            roots.push(node);
        }
    });

    return roots;
}

function newToken() {
    return crypto.randomBytes(24).toString('hex');
}

async function resolveUsuarioCriadorId(req) {
    const maybeId = req && req.user && req.user.id ? Number(req.user.id) : null;
    if (!Number.isInteger(maybeId) || maybeId <= 0) return null;
    try {
        const [rows] = await pool.query('SELECT id FROM usuarios WHERE id = ? LIMIT 1', [maybeId]);
        return rows && rows.length ? maybeId : null;
    } catch (_) {
        return null;
    }
}

function resolveTenantId(req) {
    const tenantId = req && req.user && req.user.tenant_id ? Number(req.user.tenant_id) : null;
    return Number.isInteger(tenantId) && tenantId > 0 ? tenantId : null;
}

function queryFolderWhereAndParam(rawPastaId, tenantId) {
    const pastaId = toPositiveInt(rawPastaId);
    if (pastaId) return { where: 'tenant_id = ? AND pasta_id = ?', params: [tenantId, pastaId] };
    return { where: 'tenant_id = ? AND pasta_id IS NULL', params: [tenantId] };
}

function normalizarData(value) {
    if (value === null || value === undefined || value === '') return null;
    const txt = String(value).trim();
    if (!txt) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(txt)) return txt;
    return null;
}

function normalizarHorario(value) {
    if (value === null || value === undefined || value === '') return null;
    const txt = String(value).trim();
    if (!txt) return null;
    if (/^\d{2}:\d{2}$/.test(txt)) return `${txt}:00`;
    if (/^\d{2}:\d{2}:\d{2}$/.test(txt)) return txt;
    return null;
}

function normalizarTipoFormulario(value) {
    const tipo = String(value || '').trim().toUpperCase();
    if (tipo === 'INSCRICAO') return 'INSCRICAO';
    if (tipo === 'EVENTO') return 'EVENTO';
    return 'LISTA_PRESENCA';
}

function parseJsonSafe(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(String(value));
    } catch (_) {
        return fallback;
    }
}

function sanitizeCampoTipo(value) {
    const tipo = String(value || '').trim().toLowerCase();
    const allowed = new Set(['texto', 'textarea', 'telefone', 'email', 'data', 'numero', 'select', 'radio', 'checkbox']);
    return allowed.has(tipo) ? tipo : 'texto';
}

function sanitizeCamposConfig(value) {
    const raw = Array.isArray(value) ? value : parseJsonSafe(value, []);
    if (!Array.isArray(raw)) return [];
    const out = [];
    const ids = new Set();

    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const label = String(item.label || item.titulo || '').trim().slice(0, 180);
        if (!label) continue;
        const baseId = String(item.id || label)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 60) || `campo_${out.length + 1}`;
        let finalId = baseId;
        let seq = 2;
        while (ids.has(finalId)) {
            finalId = `${baseId}_${seq}`;
            seq += 1;
        }
        ids.add(finalId);
        const tipo = sanitizeCampoTipo(item.tipo);
        let opcoes = Array.isArray(item.opcoes) ? item.opcoes : parseJsonSafe(item.opcoes, []);
        if (!Array.isArray(opcoes)) opcoes = [];
        opcoes = opcoes
            .map((op) => String(op || '').trim().slice(0, 120))
            .filter(Boolean)
            .slice(0, 30);

        out.push({
            id: finalId,
            label,
            tipo,
            obrigatorio: !!toBoolean(item.obrigatorio),
            placeholder: String(item.placeholder || '').trim().slice(0, 140) || null,
            opcoes: ['select', 'radio', 'checkbox'].includes(tipo) ? opcoes : []
        });
    }

    return out;
}

router.get('/pastas', async (req, res) => {
    try {
        await garantirEstrutura();
        const tenantId = resolveTenantId(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant inválido para a sessão.' });
        const parentId = toPositiveInt(req.query.parentId);

        if (parentId) {
            const [rows] = await pool.query(`
                SELECT id, nome, parent_id, criado_por, created_at, updated_at
                FROM formularios_pastas
                WHERE tenant_id = ? AND parent_id = ?
                ORDER BY nome ASC`,
            [tenantId, parentId]);
            return res.json(rows);
        }

        if (String(req.query.tree || '').toLowerCase() === '1') {
            const [rows] = await pool.query(`
                SELECT id, nome, parent_id, criado_por, created_at, updated_at
                FROM formularios_pastas
                WHERE tenant_id = ?
                ORDER BY nome ASC`,
            [tenantId]);
            return res.json({
                tree: buildTree(rows),
                flat: rows
            });
        }

        const [rows] = await pool.query(`
            SELECT id, nome, parent_id, criado_por, created_at, updated_at
            FROM formularios_pastas
            WHERE tenant_id = ? AND parent_id IS NULL
            ORDER BY nome ASC`,
        [tenantId]);
        return res.json(rows);
    } catch (err) {
        console.error('Erro ao listar pastas de formulários:', err);
        res.status(500).json({ error: 'Erro ao listar pastas.' });
    }
});

router.post('/pastas', async (req, res) => {
    try {
        await garantirEstrutura();
        const tenantId = resolveTenantId(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant inválido para a sessão.' });
        const nome = String(req.body.nome || '').trim();
        const parentId = toPositiveInt(req.body.parent_id || req.body.parentId);

        if (!nome) return res.status(400).json({ error: 'Nome da pasta é obrigatório.' });

        if (parentId) {
            const [exists] = await pool.query(
                'SELECT id FROM formularios_pastas WHERE id = ? AND tenant_id = ? LIMIT 1',
                [parentId, tenantId]
            );
            if (!exists.length) return res.status(400).json({ error: 'Pasta pai não encontrada.' });
        }

        const criadoPor = await resolveUsuarioCriadorId(req);
        const [result] = await pool.query(
            'INSERT INTO formularios_pastas (tenant_id, nome, parent_id, criado_por) VALUES (?, ?, ?, ?)',
            [tenantId, nome, parentId, criadoPor]
        );

        res.status(201).json({ id: result.insertId, message: 'Pasta criada com sucesso.' });
    } catch (err) {
        console.error('Erro ao criar pasta de formulários:', err);
        res.status(500).json({ error: 'Erro ao criar pasta.' });
    }
});

router.delete('/pastas/:id', async (req, res) => {
    try {
        await garantirEstrutura();
        const tenantId = resolveTenantId(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant inválido para a sessão.' });
        const id = toPositiveInt(req.params.id);
        if (!id) return res.status(400).json({ error: 'ID inválido.' });

        const [result] = await pool.query(
            'DELETE FROM formularios_pastas WHERE id = ? AND tenant_id = ?',
            [id, tenantId]
        );
        if (!result.affectedRows) return res.status(404).json({ error: 'Pasta não encontrada.' });

        return res.json({ message: 'Pasta removida com sucesso.' });
    } catch (err) {
        console.error('Erro ao remover pasta de formulários:', err);
        return res.status(500).json({ error: 'Erro ao remover pasta.' });
    }
});

router.get('/forms', async (req, res) => {
    try {
        await garantirEstrutura();
        const tenantId = resolveTenantId(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant inválido para a sessão.' });
        const fp = queryFolderWhereAndParam(req.query.pastaId, tenantId);
        const [rows] = await pool.query(
            `SELECT id, titulo, tema, descricao, tipo, token, pasta_id, evento_data, evento_hora, criar_lista_presenca,
                    usar_lista_jovens, coletar_dados_avulsos,
                    permitir_ja_fez_ejc, permitir_nao_fez_ejc, pergunta_texto_obrigatoria, campos_config_json, link_inicio_hora, link_fim_hora,
                    ativo, created_at
             FROM formularios_itens
             WHERE ${fp.where}
             ORDER BY created_at DESC`,
            fp.params
        );
        const parsed = rows.map((row) => ({
            ...row,
            campos_config: sanitizeCamposConfig(row.campos_config_json)
        }));
        return res.json(parsed);
    } catch (err) {
        console.error('Erro ao listar formulários:', err);
        return res.status(500).json({ error: 'Erro ao listar formulários.' });
    }
});

router.post('/forms', async (req, res) => {
    try {
        await garantirEstrutura();
        const tenantId = resolveTenantId(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant inválido para a sessão.' });
        const titulo = String(req.body.titulo || '').trim();
        const tema = String(req.body.tema || '').trim() || null;
        const descricao = String(req.body.descricao || '').trim() || null;
        const pastaId = toPositiveInt(req.body.pasta_id || req.body.pastaId);
        const eventoData = normalizarData(req.body.evento_data || req.body.data);
        const eventoHora = normalizarHorario(req.body.evento_hora || req.body.hora);
        const linkInicioHora = normalizarHorario(req.body.link_inicio_hora ?? req.body.linkInicioHora ?? req.body.linkInicioEm);
        const linkFimHora = normalizarHorario(req.body.link_fim_hora ?? req.body.linkFimHora ?? req.body.linkFimEm);
        const perguntaTextoObrigatoria = String(req.body.pergunta_texto_obrigatoria ?? req.body.perguntaTextoObrigatoria ?? '').trim() || null;
        const usarListaJovens = toBoolean(req.body.usar_lista_jovens ?? req.body.usarListaJovens);
        const coletarDadosAvulsos = toBoolean(req.body.coletar_dados_avulsos ?? req.body.coletarDadosAvulsos);
        const temFlagJaFez = req.body.permitir_ja_fez_ejc !== undefined || req.body.permitirJaFezEJC !== undefined;
        const temFlagNaoFez = req.body.permitir_nao_fez_ejc !== undefined || req.body.permitirNaoFezEJC !== undefined;
        const permitirJaFezEjc = temFlagJaFez
            ? toBoolean(req.body.permitir_ja_fez_ejc ?? req.body.permitirJaFezEJC)
            : true;
        const permitirNaoFezEjc = temFlagNaoFez
            ? toBoolean(req.body.permitir_nao_fez_ejc ?? req.body.permitirNaoFezEJC)
            : true;
        const criarListaPresenca = req.body.criar_lista_presenca !== undefined || req.body.criarListaPresenca !== undefined
            ? toBoolean(req.body.criar_lista_presenca ?? req.body.criarListaPresenca)
            : true;
        const tipoSolicitado = normalizarTipoFormulario(req.body.tipo);
        const tipo = tipoSolicitado === 'INSCRICAO'
            ? 'INSCRICAO'
            : (criarListaPresenca ? 'LISTA_PRESENCA' : 'EVENTO');
        const camposConfig = tipo === 'INSCRICAO'
            ? sanitizeCamposConfig(req.body.campos_config_json ?? req.body.camposConfig ?? req.body.campos)
            : [];

        if (!titulo) return res.status(400).json({ error: 'Título é obrigatório.' });
        if (tipo === 'INSCRICAO' && !camposConfig.length) {
            return res.status(400).json({ error: 'Adicione ao menos um campo no formulário de inscrição.' });
        }
        if (tipo !== 'INSCRICAO' && criarListaPresenca && !permitirJaFezEjc && !permitirNaoFezEjc) {
            return res.status(400).json({ error: 'Selecione ao menos uma opção: já fiz EJC ou não fiz EJC.' });
        }
        if (linkInicioHora && linkFimHora && linkInicioHora > linkFimHora) {
            return res.status(400).json({ error: 'A hora inicial do link deve ser menor ou igual à final.' });
        }
        if (pastaId) {
            const [exists] = await pool.query(
                'SELECT id FROM formularios_pastas WHERE id = ? AND tenant_id = ? LIMIT 1',
                [pastaId, tenantId]
            );
            if (!exists.length) return res.status(400).json({ error: 'Pasta não encontrada.' });
        }

        const token = newToken();
        const criadoPor = await resolveUsuarioCriadorId(req);
        const [result] = await pool.query(
            `INSERT INTO formularios_itens
                (tenant_id, titulo, tema, descricao, tipo, token, pasta_id, evento_data, evento_hora, criar_lista_presenca, usar_lista_jovens, coletar_dados_avulsos, permitir_ja_fez_ejc, permitir_nao_fez_ejc, pergunta_texto_obrigatoria, campos_config_json, link_inicio_hora, link_fim_hora, criado_por)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                tenantId,
                titulo,
                tema,
                descricao,
                tipo,
                token,
                pastaId,
                eventoData,
                eventoHora,
                tipo === 'INSCRICAO' ? 0 : (criarListaPresenca ? 1 : 0),
                tipo === 'INSCRICAO' ? 0 : (criarListaPresenca && (usarListaJovens || permitirJaFezEjc) ? 1 : 0),
                tipo === 'INSCRICAO' ? 0 : (criarListaPresenca && (coletarDadosAvulsos || permitirNaoFezEjc) ? 1 : 0),
                tipo === 'INSCRICAO' ? 0 : (criarListaPresenca && permitirJaFezEjc ? 1 : 0),
                tipo === 'INSCRICAO' ? 0 : (criarListaPresenca && permitirNaoFezEjc ? 1 : 0),
                tipo === 'INSCRICAO' ? null : (criarListaPresenca ? perguntaTextoObrigatoria : null),
                tipo === 'INSCRICAO' ? JSON.stringify(camposConfig) : null,
                tipo === 'INSCRICAO' ? null : (criarListaPresenca ? linkInicioHora : null),
                tipo === 'INSCRICAO' ? null : (criarListaPresenca ? linkFimHora : null),
                criadoPor
            ]
        );
        return res.status(201).json({
            id: result.insertId,
            token,
            tipo,
            link: tipo === 'INSCRICAO' || criarListaPresenca ? `/formularios/public/${token}` : null,
            criar_lista_presenca: tipo === 'INSCRICAO' ? 0 : (criarListaPresenca ? 1 : 0),
            message: 'Formulário criado com sucesso.'
        });
    } catch (err) {
        console.error('Erro ao criar formulário:', err);
        return res.status(500).json({ error: 'Erro ao criar formulário.' });
    }
});

router.delete('/forms/:id', async (req, res) => {
    try {
        await garantirEstrutura();
        const tenantId = resolveTenantId(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant inválido para a sessão.' });
        const id = toPositiveInt(req.params.id);
        if (!id) return res.status(400).json({ error: 'ID inválido.' });
        const [result] = await pool.query(
            'DELETE FROM formularios_itens WHERE id = ? AND tenant_id = ?',
            [id, tenantId]
        );
        if (!result.affectedRows) return res.status(404).json({ error: 'Formulário não encontrado.' });
        return res.json({ message: 'Formulário removido com sucesso.' });
    } catch (err) {
        console.error('Erro ao remover formulário:', err);
        return res.status(500).json({ error: 'Erro ao remover formulário.' });
    }
});

router.get('/forms/:id', async (req, res) => {
    try {
        await garantirEstrutura();
        const tenantId = resolveTenantId(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant inválido para a sessão.' });
        const id = toPositiveInt(req.params.id);
        if (!id) return res.status(400).json({ error: 'ID inválido.' });

        const [rows] = await pool.query(
            `SELECT id, titulo, tema, descricao, tipo, token, pasta_id, evento_data, evento_hora, criar_lista_presenca,
                    permitir_ja_fez_ejc, permitir_nao_fez_ejc, pergunta_texto_obrigatoria, campos_config_json, link_inicio_hora, link_fim_hora, ativo, created_at, updated_at
             FROM formularios_itens
             WHERE id = ? AND tenant_id = ?
             LIMIT 1`,
            [id, tenantId]
        );
        if (!rows.length) return res.status(404).json({ error: 'Evento não encontrado.' });
        return res.json({
            ...rows[0],
            campos_config: sanitizeCamposConfig(rows[0].campos_config_json)
        });
    } catch (err) {
        console.error('Erro ao carregar evento:', err);
        return res.status(500).json({ error: 'Erro ao carregar evento.' });
    }
});

router.put('/forms/:id', async (req, res) => {
    try {
        await garantirEstrutura();
        const tenantId = resolveTenantId(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant inválido para a sessão.' });
        const id = toPositiveInt(req.params.id);
        if (!id) return res.status(400).json({ error: 'ID inválido.' });

        const titulo = String(req.body.titulo || '').trim();
        const tema = String(req.body.tema || '').trim() || null;
        const descricao = String(req.body.descricao || '').trim() || null;
        const eventoData = normalizarData(req.body.evento_data || req.body.data);
        const eventoHora = normalizarHorario(req.body.evento_hora || req.body.hora);
        const linkInicioHora = normalizarHorario(req.body.link_inicio_hora ?? req.body.linkInicioHora ?? req.body.linkInicioEm);
        const linkFimHora = normalizarHorario(req.body.link_fim_hora ?? req.body.linkFimHora ?? req.body.linkFimEm);
        const perguntaTextoObrigatoria = String(req.body.pergunta_texto_obrigatoria ?? req.body.perguntaTextoObrigatoria ?? '').trim() || null;
        const criarListaPresenca = req.body.criar_lista_presenca !== undefined || req.body.criarListaPresenca !== undefined
            ? toBoolean(req.body.criar_lista_presenca ?? req.body.criarListaPresenca)
            : null;
        const permitirJaFezEjc = req.body.permitir_ja_fez_ejc !== undefined || req.body.permitirJaFezEJC !== undefined
            ? toBoolean(req.body.permitir_ja_fez_ejc ?? req.body.permitirJaFezEJC)
            : null;
        const permitirNaoFezEjc = req.body.permitir_nao_fez_ejc !== undefined || req.body.permitirNaoFezEJC !== undefined
            ? toBoolean(req.body.permitir_nao_fez_ejc ?? req.body.permitirNaoFezEJC)
            : null;
        const tipoSolicitado = req.body.tipo !== undefined ? normalizarTipoFormulario(req.body.tipo) : null;
        const camposConfig = sanitizeCamposConfig(req.body.campos_config_json ?? req.body.camposConfig ?? req.body.campos);

        if (!titulo) return res.status(400).json({ error: 'Título é obrigatório.' });
        if (linkInicioHora && linkFimHora && linkInicioHora > linkFimHora) {
            return res.status(400).json({ error: 'A hora inicial do link deve ser menor ou igual à final.' });
        }

        const [exists] = await pool.query(
            'SELECT id, tipo, criar_lista_presenca, permitir_ja_fez_ejc, permitir_nao_fez_ejc FROM formularios_itens WHERE id = ? AND tenant_id = ? LIMIT 1',
            [id, tenantId]
        );
        if (!exists.length) return res.status(404).json({ error: 'Evento não encontrado.' });
        const atual = exists[0];
        const tipoFinal = tipoSolicitado || normalizarTipoFormulario(atual.tipo);

        if (tipoFinal === 'INSCRICAO') {
            if (!camposConfig.length) {
                return res.status(400).json({ error: 'Adicione ao menos um campo no formulário de inscrição.' });
            }
            await pool.query(
                `UPDATE formularios_itens
                 SET titulo = ?,
                     tema = ?,
                     descricao = ?,
                     evento_data = ?,
                     evento_hora = ?,
                     tipo = 'INSCRICAO',
                     criar_lista_presenca = 0,
                     usar_lista_jovens = 0,
                     coletar_dados_avulsos = 0,
                     permitir_ja_fez_ejc = 0,
                     permitir_nao_fez_ejc = 0,
                     pergunta_texto_obrigatoria = NULL,
                     campos_config_json = ?,
                     link_inicio_hora = NULL,
                     link_fim_hora = NULL
                 WHERE id = ? AND tenant_id = ?`,
                [
                    titulo,
                    tema,
                    descricao,
                    eventoData,
                    eventoHora,
                    JSON.stringify(camposConfig),
                    id,
                    tenantId
                ]
            );
        } else {
            const criarListaFinal = criarListaPresenca === null ? Number(atual.criar_lista_presenca) === 1 : criarListaPresenca;
            const permitirJaFezFinal = permitirJaFezEjc === null ? Number(atual.permitir_ja_fez_ejc) === 1 : permitirJaFezEjc;
            const permitirNaoFezFinal = permitirNaoFezEjc === null ? Number(atual.permitir_nao_fez_ejc) === 1 : permitirNaoFezEjc;
            if (criarListaFinal && !permitirJaFezFinal && !permitirNaoFezFinal) {
                return res.status(400).json({ error: 'Selecione ao menos uma opção: já fiz EJC ou não fiz EJC.' });
            }
            await pool.query(
                `UPDATE formularios_itens
                 SET titulo = ?,
                     tema = ?,
                     descricao = ?,
                     evento_data = ?,
                     evento_hora = ?,
                     tipo = ?,
                     criar_lista_presenca = ?,
                     usar_lista_jovens = ?,
                     coletar_dados_avulsos = ?,
                     permitir_ja_fez_ejc = ?,
                     permitir_nao_fez_ejc = ?,
                     pergunta_texto_obrigatoria = ?,
                     campos_config_json = NULL,
                     link_inicio_hora = ?,
                     link_fim_hora = ?
                 WHERE id = ? AND tenant_id = ?`,
                [
                    titulo,
                    tema,
                    descricao,
                    eventoData,
                    eventoHora,
                    criarListaFinal ? 'LISTA_PRESENCA' : 'EVENTO',
                    criarListaFinal ? 1 : 0,
                    criarListaFinal && permitirJaFezFinal ? 1 : 0,
                    criarListaFinal && permitirNaoFezFinal ? 1 : 0,
                    criarListaFinal && permitirJaFezFinal ? 1 : 0,
                    criarListaFinal && permitirNaoFezFinal ? 1 : 0,
                    criarListaFinal ? perguntaTextoObrigatoria : null,
                    criarListaFinal ? linkInicioHora : null,
                    criarListaFinal ? linkFimHora : null,
                    id,
                    tenantId
                ]
            );
        }

        return res.json({ message: 'Evento atualizado com sucesso.' });
    } catch (err) {
        console.error('Erro ao atualizar evento:', err);
        return res.status(500).json({ error: 'Erro ao atualizar evento.' });
    }
});

router.get('/forms/:id/presencas', async (req, res) => {
    try {
        await garantirEstrutura();
        const tenantId = resolveTenantId(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant inválido para a sessão.' });
        const id = toPositiveInt(req.params.id);
        if (!id) return res.status(400).json({ error: 'ID inválido.' });
        const hasOutrosEjcs = await hasTable('outros_ejcs');

        const [rows] = await pool.query(`
            SELECT fp.id, fp.jovem_id, fp.nome_completo, fp.telefone, fp.ejc_origem, fp.status_ejc, fp.origem_ja_fez,
                   fp.outro_ejc_id, fp.registrado_em, j.nome_completo AS jovem_nome,
                   ${hasOutrosEjcs ? 'oe.nome AS outro_ejc_nome, oe.paroquia AS outro_ejc_paroquia' : 'NULL AS outro_ejc_nome, NULL AS outro_ejc_paroquia'}
            FROM formularios_presencas fp
            JOIN formularios_itens fi ON fi.id = fp.formulario_id AND fi.tenant_id = ?
            LEFT JOIN jovens j ON j.id = fp.jovem_id AND j.tenant_id = fi.tenant_id
            ${hasOutrosEjcs ? 'LEFT JOIN outros_ejcs oe ON oe.id = fp.outro_ejc_id AND oe.tenant_id = fi.tenant_id' : ''}
            WHERE fp.formulario_id = ? AND fp.tenant_id = ?
            ORDER BY fp.registrado_em DESC
        `, [tenantId, id, tenantId]);
        return res.json(rows);
    } catch (err) {
        console.error('Erro ao listar presenças:', err);
        return res.status(500).json({ error: 'Erro ao listar presenças.' });
    }
});

router.get('/forms/:id/respostas', async (req, res) => {
    try {
        await garantirEstrutura();
        const tenantId = resolveTenantId(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant inválido para a sessão.' });
        const id = toPositiveInt(req.params.id);
        if (!id) return res.status(400).json({ error: 'ID inválido.' });

        const [forms] = await pool.query(
            'SELECT id, tipo FROM formularios_itens WHERE id = ? AND tenant_id = ? LIMIT 1',
            [id, tenantId]
        );
        if (!forms.length) return res.status(404).json({ error: 'Formulário não encontrado.' });
        if (String(forms[0].tipo || '').toUpperCase() !== 'INSCRICAO') {
            return res.status(400).json({ error: 'Este formulário não é do tipo inscrição.' });
        }

        const [rows] = await pool.query(
            `SELECT id, nome_referencia, telefone_referencia, resposta_json, registrado_em
             FROM formularios_respostas
             WHERE formulario_id = ? AND tenant_id = ?
             ORDER BY registrado_em DESC`,
            [id, tenantId]
        );
        const parsed = rows.map((row) => ({
            ...row,
            resposta: parseJsonSafe(row.resposta_json, {})
        }));
        return res.json(parsed);
    } catch (err) {
        console.error('Erro ao listar respostas de inscrição:', err);
        return res.status(500).json({ error: 'Erro ao listar respostas.' });
    }
});

module.exports = router;
