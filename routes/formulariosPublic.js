const express = require('express');
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
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
            UNIQUE KEY uniq_formulario_jovem (formulario_id, jovem_id)
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
            user_agent VARCHAR(255) NULL
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
        const [jovemCol] = await pool.query(`
        SELECT IS_NULLABLE AS is_nullable
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'formularios_presencas'
          AND COLUMN_NAME = 'jovem_id'
        LIMIT 1
        `);
        if (jovemCol.length && String(jovemCol[0].is_nullable || '').toUpperCase() !== 'YES') {
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
            obrigatorio: !!item.obrigatorio,
            placeholder: String(item.placeholder || '').trim().slice(0, 140) || null,
            opcoes: ['select', 'radio', 'checkbox'].includes(tipo) ? opcoes : []
        });
    }
    return out;
}

function parseDbTimeToSeconds(value) {
    if (!value) return null;
    let txt = String(value).trim();
    if (!txt) return null;
    if (txt.includes(' ')) txt = txt.split(' ')[1] || '';
    if (txt.includes('T')) txt = txt.split('T')[1] || '';
    if (!txt) return null;
    const parts = txt.split(':');
    if (parts.length < 2) return null;
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const s = Number(parts[2] || 0);
    if (!Number.isInteger(h) || !Number.isInteger(m) || !Number.isInteger(s)) return null;
    if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s > 59) return null;
    return (h * 3600) + (m * 60) + s;
}

function isLinkDisponivel(form) {
    const now = new Date();
    const agoraSegundos = (now.getHours() * 3600) + (now.getMinutes() * 60) + now.getSeconds();
    const inicio = parseDbTimeToSeconds(form && form.link_inicio_hora);
    const fim = parseDbTimeToSeconds(form && form.link_fim_hora);
    if (inicio !== null && agoraSegundos < inicio) return false;
    if (fim !== null && agoraSegundos > fim) return false;
    return true;
}

// GET /api/formularios/public/:token/outro-ejc-jovens
router.get('/:token/outro-ejc-jovens', async (req, res) => {
    try {
        await garantirEstrutura();
        const token = String(req.params.token || '').trim();
        const outroEjcId = toPositiveInt(req.query.outro_ejc_id);
        if (!token) return res.status(400).json({ error: 'Token inválido.' });

        const [forms] = await pool.query(
            `SELECT id, ativo, permitir_ja_fez_ejc, tenant_id, link_inicio_hora, link_fim_hora
             FROM formularios_itens
             WHERE token = ?
             LIMIT 1`,
            [token]
        );
        if (!forms.length || !forms[0].ativo) return res.status(404).json({ error: 'Formulário não encontrado.' });
        const tenantId = Number(forms[0].tenant_id || 0);
        if (!tenantId) return res.status(400).json({ error: 'Tenant inválido no formulário.' });
        if (!isLinkDisponivel(forms[0])) {
            return res.status(403).json({ error: 'Este link está fora do período de disponibilidade.' });
        }
        if (Number(forms[0].permitir_ja_fez_ejc) !== 1) return res.json([]);

        const hasOutrosEjcs = await hasTable('outros_ejcs');
        const params = [tenantId];
        let whereOutroEjc = '';
        if (outroEjcId) {
            whereOutroEjc = 'AND fp.outro_ejc_id = ?';
            params.push(outroEjcId);
        }

        const [rowsHistorico] = await pool.query(`
            SELECT
                MAX(fp.id) AS id,
                fp.nome_completo,
                fp.telefone,
                fp.outro_ejc_id,
                MAX(fp.registrado_em) AS ultimo_registro
                ${hasOutrosEjcs ? ', oe.nome AS outro_ejc_nome, oe.paroquia AS outro_ejc_paroquia' : ", NULL AS outro_ejc_nome, NULL AS outro_ejc_paroquia"}
            FROM formularios_presencas fp
            ${hasOutrosEjcs ? 'LEFT JOIN outros_ejcs oe ON oe.id = fp.outro_ejc_id AND oe.tenant_id = fp.tenant_id' : ''}
            WHERE fp.tenant_id = ?
              AND fp.status_ejc = 'JA_FIZ'
              AND fp.origem_ja_fez = 'OUTRO_EJC'
              AND COALESCE(TRIM(fp.nome_completo), '') <> ''
              AND COALESCE(TRIM(fp.telefone), '') <> ''
              ${whereOutroEjc}
            GROUP BY fp.nome_completo, fp.telefone, fp.outro_ejc_id
                     ${hasOutrosEjcs ? ', oe.nome, oe.paroquia' : ''}
            ORDER BY fp.nome_completo ASC
        `, params);

        const [rowsCadastro] = await pool.query(`
            SELECT
                j.id,
                j.nome_completo,
                j.telefone,
                j.outro_ejc_id,
                NULL AS ultimo_registro
                ${hasOutrosEjcs ? ', oe.nome AS outro_ejc_nome, oe.paroquia AS outro_ejc_paroquia' : ", NULL AS outro_ejc_nome, NULL AS outro_ejc_paroquia"}
            FROM jovens j
            ${hasOutrosEjcs ? 'LEFT JOIN outros_ejcs oe ON oe.id = j.outro_ejc_id AND oe.tenant_id = j.tenant_id' : ''}
            WHERE j.tenant_id = ?
              AND COALESCE(j.origem_ejc_tipo, 'INCONFIDENTES') = 'OUTRO_EJC'
              AND COALESCE(TRIM(j.nome_completo), '') <> ''
              AND COALESCE(TRIM(j.telefone), '') <> ''
              ${outroEjcId ? 'AND j.outro_ejc_id = ?' : ''}
            ORDER BY j.nome_completo ASC
        `, outroEjcId ? [tenantId, outroEjcId] : [tenantId]);

        const mapa = new Map();
        const normalizarChave = (nome, telefone, outroId) => `${String(nome || '').trim().toLowerCase()}|${String(telefone || '').replace(/\D/g, '')}|${Number(outroId || 0)}`;

        for (const r of rowsHistorico || []) {
            const chave = normalizarChave(r.nome_completo, r.telefone, r.outro_ejc_id);
            if (mapa.has(chave)) continue;
            mapa.set(chave, {
                id: `H:${r.id}`,
                referencia: `H:${r.id}`,
                origem_registro: 'HISTORICO',
                nome_completo: r.nome_completo,
                telefone: r.telefone,
                outro_ejc_id: r.outro_ejc_id,
                outro_ejc_nome: r.outro_ejc_nome,
                outro_ejc_paroquia: r.outro_ejc_paroquia,
                ultimo_registro: r.ultimo_registro
            });
        }

        for (const r of rowsCadastro || []) {
            const chave = normalizarChave(r.nome_completo, r.telefone, r.outro_ejc_id);
            if (mapa.has(chave)) continue;
            mapa.set(chave, {
                id: `J:${r.id}`,
                referencia: `J:${r.id}`,
                origem_registro: 'CADASTRO',
                nome_completo: r.nome_completo,
                telefone: r.telefone,
                outro_ejc_id: r.outro_ejc_id,
                outro_ejc_nome: r.outro_ejc_nome,
                outro_ejc_paroquia: r.outro_ejc_paroquia,
                ultimo_registro: null
            });
        }

        const lista = Array.from(mapa.values()).sort((a, b) => String(a.nome_completo || '').localeCompare(String(b.nome_completo || ''), 'pt-BR'));
        return res.json(lista);
    } catch (err) {
        console.error('Erro ao listar jovens de outro EJC:', err);
        return res.status(500).json({ error: 'Erro ao buscar jovens de outro EJC.' });
    }
});

router.get('/:token', async (req, res) => {
    try {
        await garantirEstrutura();
        const token = String(req.params.token || '').trim();
        if (!token) return res.status(400).json({ error: 'Token inválido.' });

        const [forms] = await pool.query(
            `SELECT id, titulo, tema, descricao, tipo, token, ativo, evento_data, evento_hora, criar_lista_presenca,
                    usar_lista_jovens, coletar_dados_avulsos, tenant_id, pergunta_texto_obrigatoria, link_inicio_hora, link_fim_hora,
                    permitir_ja_fez_ejc, permitir_nao_fez_ejc, campos_config_json
             FROM formularios_itens
             WHERE token = ?
             LIMIT 1`,
            [token]
        );
        if (!forms.length || !forms[0].ativo) return res.status(404).json({ error: 'Formulário não encontrado.' });
        const form = forms[0];
        if (!isLinkDisponivel(form)) {
            return res.status(403).json({ error: 'Este link está fora do período de disponibilidade.' });
        }
        if (String(form.tipo || '').toUpperCase() !== 'INSCRICAO' && Number(form.criar_lista_presenca) !== 1) {
            return res.status(400).json({ error: 'Este evento não possui lista de presença ativa.' });
        }

        const camposConfig = sanitizeCamposConfig(form.campos_config_json);

        let jovens = [];
        if (String(form.tipo || '').toUpperCase() !== 'INSCRICAO' && Number(form.permitir_ja_fez_ejc) === 1 && Number(form.usar_lista_jovens) === 1) {
            const [rows] = await pool.query(
                'SELECT id, nome_completo FROM jovens WHERE tenant_id = ? ORDER BY nome_completo ASC',
                [form.tenant_id]
            );
            jovens = rows;
        }
        let outrosEjcs = [];
        if (String(form.tipo || '').toUpperCase() !== 'INSCRICAO' && Number(form.permitir_ja_fez_ejc) === 1) {
            const hasOutrosEjcs = await hasTable('outros_ejcs');
            if (hasOutrosEjcs) {
                const [rows] = await pool.query(
                    'SELECT id, nome, paroquia, bairro FROM outros_ejcs WHERE tenant_id = ? ORDER BY nome ASC',
                    [form.tenant_id]
                );
                outrosEjcs = rows;
            }
        }

        return res.json({
            formulario: {
                ...form,
                campos_config: camposConfig
            },
            jovens,
            outros_ejcs: outrosEjcs
        });
    } catch (err) {
        console.error('Erro ao carregar formulário público:', err);
        return res.status(500).json({ error: 'Erro ao carregar formulário.' });
    }
});

router.post('/:token/respostas', async (req, res) => {
    try {
        await garantirEstrutura();
        const token = String(req.params.token || '').trim();
        if (!token) return res.status(400).json({ error: 'Token inválido.' });

        const [forms] = await pool.query(
            `SELECT id, ativo, tipo, tenant_id, link_inicio_hora, link_fim_hora, campos_config_json
             FROM formularios_itens
             WHERE token = ?
             LIMIT 1`,
            [token]
        );
        if (!forms.length || !forms[0].ativo) return res.status(404).json({ error: 'Formulário não encontrado.' });
        const form = forms[0];
        if (String(form.tipo || '').toUpperCase() !== 'INSCRICAO') {
            return res.status(400).json({ error: 'Este link não é de um formulário de inscrição.' });
        }
        if (!isLinkDisponivel(form)) {
            return res.status(403).json({ error: 'Este link está fora do período de disponibilidade.' });
        }
        const tenantId = Number(form.tenant_id || 0);
        if (!tenantId) return res.status(400).json({ error: 'Tenant inválido no formulário.' });

        const camposConfig = sanitizeCamposConfig(form.campos_config_json);
        if (!camposConfig.length) {
            return res.status(400).json({ error: 'Formulário sem campos configurados.' });
        }
        const respostas = parseJsonSafe(req.body.respostas, {});
        if (!respostas || typeof respostas !== 'object') {
            return res.status(400).json({ error: 'Respostas inválidas.' });
        }

        const respostaFinal = {};
        for (const campo of camposConfig) {
            const valorBruto = respostas[campo.id];
            let valor = valorBruto;

            if (campo.tipo === 'checkbox') {
                const arr = Array.isArray(valorBruto) ? valorBruto : (valorBruto ? [valorBruto] : []);
                valor = arr.map((v) => String(v || '').trim()).filter(Boolean);
                if (campo.opcoes.length) {
                    valor = valor.filter((v) => campo.opcoes.includes(v));
                }
                if (campo.obrigatorio && !valor.length) {
                    return res.status(400).json({ error: `Preencha o campo obrigatório: ${campo.label}.` });
                }
            } else {
                valor = String(valorBruto || '').trim();
                if (campo.obrigatorio && !valor) {
                    return res.status(400).json({ error: `Preencha o campo obrigatório: ${campo.label}.` });
                }
                if (valor && (campo.tipo === 'select' || campo.tipo === 'radio') && campo.opcoes.length && !campo.opcoes.includes(valor)) {
                    return res.status(400).json({ error: `Valor inválido no campo: ${campo.label}.` });
                }
            }
            respostaFinal[campo.id] = valor;
        }

        let nomeReferencia = null;
        let telefoneReferencia = null;
        for (const campo of camposConfig) {
            const valor = respostaFinal[campo.id];
            const label = String(campo.label || '').toLowerCase();
            if (!nomeReferencia && typeof valor === 'string' && valor && (label.includes('nome') || campo.id.includes('nome'))) {
                nomeReferencia = valor.slice(0, 180);
            }
            if (!telefoneReferencia && typeof valor === 'string' && valor && (label.includes('telefone') || campo.id.includes('telefone') || campo.tipo === 'telefone')) {
                telefoneReferencia = valor.slice(0, 30);
            }
        }

        const payload = {
            campos: camposConfig.map((campo) => ({
                id: campo.id,
                label: campo.label,
                tipo: campo.tipo,
                valor: respostaFinal[campo.id]
            }))
        };

        const ipRaw = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const ip = String(Array.isArray(ipRaw) ? ipRaw[0] : ipRaw).slice(0, 64) || null;
        const userAgent = String(req.headers['user-agent'] || '').slice(0, 255) || null;

        await pool.query(
            `INSERT INTO formularios_respostas
                (tenant_id, formulario_id, nome_referencia, telefone_referencia, resposta_json, ip, user_agent)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                tenantId,
                form.id,
                nomeReferencia,
                telefoneReferencia,
                JSON.stringify(payload),
                ip,
                userAgent
            ]
        );

        return res.json({ message: 'Inscrição enviada com sucesso.' });
    } catch (err) {
        console.error('Erro ao registrar inscrição:', err);
        return res.status(500).json({ error: 'Erro ao enviar inscrição.' });
    }
});

router.post('/:token/presencas', async (req, res) => {
    try {
        await garantirEstrutura();
        const token = String(req.params.token || '').trim();
        const jovemId = toPositiveInt(req.body.jovem_id);
        const nomeCompleto = String(req.body.nome_completo || '').trim();
        const telefone = String(req.body.telefone || '').trim();
        const ejcOrigem = String(req.body.ejc_origem || '').trim();
        const statusEjc = String(req.body.status_ejc || '').trim().toUpperCase();
        const origemJaFez = String(req.body.origem_ja_fez || '').trim().toUpperCase();
        const outroEjcId = toPositiveInt(req.body.outro_ejc_id);
        const modoOutroEjc = String(req.body.primeira_vez_outro_ejc || '').trim().toUpperCase();
        const participanteHistoricoId = toPositiveInt(req.body.participante_historico_id);
        const participanteReferencia = String(req.body.participante_referencia || '').trim();
        const respostaTextoObrigatoria = String(req.body.resposta_texto_obrigatoria || '').trim();
        if (!token) return res.status(400).json({ error: 'Dados inválidos.' });

        const [forms] = await pool.query(
            `SELECT id, ativo, tipo, criar_lista_presenca, usar_lista_jovens, coletar_dados_avulsos, permitir_ja_fez_ejc, permitir_nao_fez_ejc, tenant_id, pergunta_texto_obrigatoria, link_inicio_hora, link_fim_hora
             FROM formularios_itens
             WHERE token = ?
             LIMIT 1`,
            [token]
        );
        if (!forms.length || !forms[0].ativo) return res.status(404).json({ error: 'Formulário não encontrado.' });
        const form = forms[0];
        if (String(form.tipo || '').toUpperCase() === 'INSCRICAO') {
            return res.status(400).json({ error: 'Este link usa formulário de inscrição personalizada.' });
        }
        const tenantId = Number(form.tenant_id || 0);
        if (!tenantId) return res.status(400).json({ error: 'Tenant inválido no formulário.' });
        if (!isLinkDisponivel(form)) {
            return res.status(403).json({ error: 'Este link está fora do período de disponibilidade.' });
        }
        if (Number(form.criar_lista_presenca) !== 1) {
            return res.status(400).json({ error: 'Este evento não possui lista de presença ativa.' });
        }
        if (String(form.pergunta_texto_obrigatoria || '').trim() && !respostaTextoObrigatoria) {
            return res.status(400).json({ error: 'Responda a pergunta obrigatória do formulário.' });
        }

        const permiteJaFez = Number(form.permitir_ja_fez_ejc) === 1;
        const permiteNaoFez = Number(form.permitir_nao_fez_ejc) === 1;
        const permiteListaJovens = Number(form.usar_lista_jovens) === 1;

        if (!permiteJaFez && !permiteNaoFez) {
            return res.status(400).json({ error: 'Formulário sem configuração de opções.' });
        }

        if (!['JA_FIZ', 'NAO_FIZ'].includes(statusEjc)) {
            return res.status(400).json({ error: 'Selecione se já fez EJC ou não fez EJC.' });
        }
        if (statusEjc === 'JA_FIZ' && !permiteJaFez) {
            return res.status(400).json({ error: 'Este formulário não aceita a opção "já fiz EJC".' });
        }
        if (statusEjc === 'NAO_FIZ' && !permiteNaoFez) {
            return res.status(400).json({ error: 'Este formulário não aceita a opção "não fiz EJC".' });
        }

        let jovemIdFinal = null;
        let nomeFinal = null;
        let telefoneFinal = null;
        let ejcOrigemFinal = null;
        let origemJaFezFinal = null;
        let outroEjcIdFinal = null;

        if (statusEjc === 'JA_FIZ') {
            if (!['INCONFIDENTES', 'OUTRO_EJC'].includes(origemJaFez)) {
                return res.status(400).json({ error: 'Selecione se fez EJC Inconfidentes ou outro EJC.' });
            }
            origemJaFezFinal = origemJaFez;

            if (origemJaFez === 'INCONFIDENTES') {
                if (!permiteListaJovens) {
                    return res.status(400).json({ error: 'Este formulário não aceita seleção da lista de jovens.' });
                }
                if (!jovemId) return res.status(400).json({ error: 'Selecione seu nome na lista de jovens.' });
                const [jovemExists] = await pool.query(
                    'SELECT id, nome_completo, telefone FROM jovens WHERE id = ? AND tenant_id = ? LIMIT 1',
                    [jovemId, tenantId]
                );
                if (!jovemExists.length) return res.status(400).json({ error: 'Jovem inválido.' });
                jovemIdFinal = jovemId;
                nomeFinal = jovemExists[0].nome_completo || null;
                telefoneFinal = jovemExists[0].telefone || null;
                ejcOrigemFinal = 'Inconfidentes';
            } else {
                if (!['PRIMEIRA_VEZ', 'JA_PARTICIPOU'].includes(modoOutroEjc)) {
                    return res.status(400).json({ error: 'Selecione se é o primeiro evento ou se já participou de outros eventos.' });
                }
                if (modoOutroEjc === 'PRIMEIRA_VEZ') {
                    if (!nomeCompleto || !telefone || !outroEjcId) {
                        return res.status(400).json({ error: 'Informe nome completo, telefone e o outro EJC.' });
                    }
                    const hasOutrosEjcs = await hasTable('outros_ejcs');
                    if (!hasOutrosEjcs) {
                        return res.status(400).json({ error: 'Cadastro de outros EJCs não está disponível no momento.' });
                    }
                    const [outroEjcExists] = await pool.query(
                        'SELECT id, nome, paroquia FROM outros_ejcs WHERE id = ? AND tenant_id = ? LIMIT 1',
                        [outroEjcId, tenantId]
                    );
                    if (!outroEjcExists.length) return res.status(400).json({ error: 'Outro EJC inválido.' });
                    nomeFinal = nomeCompleto;
                    telefoneFinal = telefone;
                    outroEjcIdFinal = outroEjcId;
                    ejcOrigemFinal = [outroEjcExists[0].paroquia, outroEjcExists[0].nome].filter(Boolean).join(' - ') || 'Outro EJC';
                } else {
                    const usarReferencia = /^([HJ]):(\d+)$/.exec(participanteReferencia);
                    const tipoRef = usarReferencia ? usarReferencia[1] : null;
                    const idRef = usarReferencia ? Number(usarReferencia[2]) : null;
                    if (!idRef && !participanteHistoricoId) {
                        return res.status(400).json({ error: 'Selecione seu nome na lista de jovens de outro EJC.' });
                    }
                    if (tipoRef === 'J') {
                        const [jovensRows] = await pool.query(`
                            SELECT id, nome_completo, telefone, outro_ejc_id
                            FROM jovens
                            WHERE id = ?
                              AND tenant_id = ?
                              AND COALESCE(origem_ejc_tipo, 'INCONFIDENTES') = 'OUTRO_EJC'
                            LIMIT 1
                        `, [idRef, tenantId]);
                        if (!jovensRows.length) {
                            return res.status(400).json({ error: 'Cadastro do jovem de outro EJC não encontrado.' });
                        }
                        const jovem = jovensRows[0];
                        if (!jovem.outro_ejc_id) {
                            return res.status(400).json({ error: 'Cadastro sem EJC de origem vinculado.' });
                        }
                        const hasOutrosEjcs = await hasTable('outros_ejcs');
                        if (!hasOutrosEjcs) {
                            return res.status(400).json({ error: 'Cadastro de outros EJCs não está disponível no momento.' });
                        }
                        const [outroEjcExists] = await pool.query(
                            'SELECT id, nome, paroquia FROM outros_ejcs WHERE id = ? AND tenant_id = ? LIMIT 1',
                            [jovem.outro_ejc_id, tenantId]
                        );
                        if (!outroEjcExists.length) return res.status(400).json({ error: 'Outro EJC vinculado não encontrado.' });

                        nomeFinal = String(jovem.nome_completo || '').trim() || null;
                        telefoneFinal = String(jovem.telefone || '').trim() || null;
                        outroEjcIdFinal = jovem.outro_ejc_id;
                        ejcOrigemFinal = [outroEjcExists[0].paroquia, outroEjcExists[0].nome].filter(Boolean).join(' - ') || 'Outro EJC';
                    } else {
                        const idBuscaHistorico = idRef || participanteHistoricoId;
                        const [historicoRows] = await pool.query(`
                            SELECT id, nome_completo, telefone, outro_ejc_id
                            FROM formularios_presencas
                            WHERE id = ?
                              AND tenant_id = ?
                              AND status_ejc = 'JA_FIZ'
                              AND origem_ja_fez = 'OUTRO_EJC'
                            LIMIT 1
                        `, [idBuscaHistorico, tenantId]);
                        if (!historicoRows.length) {
                            return res.status(400).json({ error: 'Registro do jovem não encontrado.' });
                        }
                        const historico = historicoRows[0];
                        if (!historico.outro_ejc_id) {
                            return res.status(400).json({ error: 'Registro antigo sem EJC vinculado. Use "primeiro evento".' });
                        }
                        const hasOutrosEjcs = await hasTable('outros_ejcs');
                        if (!hasOutrosEjcs) {
                            return res.status(400).json({ error: 'Cadastro de outros EJCs não está disponível no momento.' });
                        }
                        const [outroEjcExists] = await pool.query(
                            'SELECT id, nome, paroquia FROM outros_ejcs WHERE id = ? AND tenant_id = ? LIMIT 1',
                            [historico.outro_ejc_id, tenantId]
                        );
                        if (!outroEjcExists.length) return res.status(400).json({ error: 'Outro EJC vinculado não encontrado.' });

                        nomeFinal = String(historico.nome_completo || '').trim() || null;
                        telefoneFinal = String(historico.telefone || '').trim() || null;
                        outroEjcIdFinal = historico.outro_ejc_id;
                        ejcOrigemFinal = [outroEjcExists[0].paroquia, outroEjcExists[0].nome].filter(Boolean).join(' - ') || 'Outro EJC';
                    }

                    if (!nomeFinal || !telefoneFinal || !outroEjcIdFinal) {
                        return res.status(400).json({ error: 'Registro incompleto. Use "primeiro evento".' });
                    }
                }
            }
        } else {
            if (!nomeCompleto || !telefone) {
                return res.status(400).json({ error: 'Informe nome completo e telefone.' });
            }
            nomeFinal = nomeCompleto;
            telefoneFinal = telefone;
            ejcOrigemFinal = 'Não fez EJC';
        }

        const ipRaw = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const ip = String(Array.isArray(ipRaw) ? ipRaw[0] : ipRaw).slice(0, 64) || null;
        const userAgent = String(req.headers['user-agent'] || '').slice(0, 255) || null;

        try {
            await pool.query(
                `INSERT INTO formularios_presencas
                    (tenant_id, formulario_id, jovem_id, nome_completo, telefone, ejc_origem, status_ejc, origem_ja_fez, outro_ejc_id, resposta_texto_obrigatoria, ip, user_agent)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    tenantId,
                    form.id,
                    jovemIdFinal,
                    nomeFinal,
                    telefoneFinal,
                    ejcOrigemFinal || ejcOrigem || null,
                    statusEjc,
                    origemJaFezFinal,
                    outroEjcIdFinal,
                    String(form.pergunta_texto_obrigatoria || '').trim() ? respostaTextoObrigatoria : null,
                    ip,
                    userAgent
                ]
            );
        } catch (errIns) {
            if (errIns && errIns.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ error: 'Presença já registrada para este jovem.' });
            }
            throw errIns;
        }

        return res.json({ message: 'Presença registrada com sucesso.' });
    } catch (err) {
        console.error('Erro ao registrar presença:', err);
        return res.status(500).json({ error: 'Erro ao registrar presença.' });
    }
});

module.exports = router;
