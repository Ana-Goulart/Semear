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
            formulario_id INT NOT NULL,
            jovem_id INT NULL,
            nome_completo VARCHAR(180) NULL,
            telefone VARCHAR(30) NULL,
            ejc_origem VARCHAR(140) NULL,
            status_ejc VARCHAR(20) NULL,
            origem_ja_fez VARCHAR(20) NULL,
            outro_ejc_id INT NULL,
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

function queryFolderWhereAndParam(rawPastaId) {
    const pastaId = toPositiveInt(rawPastaId);
    if (pastaId) return { where: 'pasta_id = ?', params: [pastaId] };
    return { where: 'pasta_id IS NULL', params: [] };
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

router.get('/pastas', async (req, res) => {
    try {
        await garantirEstrutura();
        const parentId = toPositiveInt(req.query.parentId);

        if (parentId) {
            const [rows] = await pool.query(`
                SELECT id, nome, parent_id, criado_por, created_at, updated_at
                FROM formularios_pastas
                WHERE parent_id = ?
                ORDER BY nome ASC
            `, [parentId]);
            return res.json(rows);
        }

        if (String(req.query.tree || '').toLowerCase() === '1') {
            const [rows] = await pool.query(`
                SELECT id, nome, parent_id, criado_por, created_at, updated_at
                FROM formularios_pastas
                ORDER BY nome ASC
            `);
            return res.json({
                tree: buildTree(rows),
                flat: rows
            });
        }

        const [rows] = await pool.query(`
            SELECT id, nome, parent_id, criado_por, created_at, updated_at
            FROM formularios_pastas
            WHERE parent_id IS NULL
            ORDER BY nome ASC
        `);
        return res.json(rows);
    } catch (err) {
        console.error('Erro ao listar pastas de formulários:', err);
        res.status(500).json({ error: 'Erro ao listar pastas.' });
    }
});

router.post('/pastas', async (req, res) => {
    try {
        await garantirEstrutura();
        const nome = String(req.body.nome || '').trim();
        const parentId = toPositiveInt(req.body.parent_id || req.body.parentId);

        if (!nome) return res.status(400).json({ error: 'Nome da pasta é obrigatório.' });

        if (parentId) {
            const [exists] = await pool.query('SELECT id FROM formularios_pastas WHERE id = ? LIMIT 1', [parentId]);
            if (!exists.length) return res.status(400).json({ error: 'Pasta pai não encontrada.' });
        }

        const criadoPor = await resolveUsuarioCriadorId(req);
        const [result] = await pool.query(
            'INSERT INTO formularios_pastas (nome, parent_id, criado_por) VALUES (?, ?, ?)',
            [nome, parentId, criadoPor]
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
        const id = toPositiveInt(req.params.id);
        if (!id) return res.status(400).json({ error: 'ID inválido.' });

        const [result] = await pool.query('DELETE FROM formularios_pastas WHERE id = ?', [id]);
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
        const fp = queryFolderWhereAndParam(req.query.pastaId);
        const [rows] = await pool.query(
            `SELECT id, titulo, tema, tipo, token, pasta_id, evento_data, evento_hora, criar_lista_presenca,
                    usar_lista_jovens, coletar_dados_avulsos,
                    permitir_ja_fez_ejc, permitir_nao_fez_ejc,
                    ativo, created_at
             FROM formularios_itens
             WHERE ${fp.where}
             ORDER BY created_at DESC`,
            fp.params
        );
        return res.json(rows);
    } catch (err) {
        console.error('Erro ao listar formulários:', err);
        return res.status(500).json({ error: 'Erro ao listar formulários.' });
    }
});

router.post('/forms', async (req, res) => {
    try {
        await garantirEstrutura();
        const titulo = String(req.body.titulo || '').trim();
        const tema = String(req.body.tema || '').trim() || null;
        const pastaId = toPositiveInt(req.body.pasta_id || req.body.pastaId);
        const eventoData = normalizarData(req.body.evento_data || req.body.data);
        const eventoHora = normalizarHorario(req.body.evento_hora || req.body.hora);
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
        const tipo = criarListaPresenca ? 'LISTA_PRESENCA' : 'EVENTO';

        if (!titulo) return res.status(400).json({ error: 'Título é obrigatório.' });
        if (criarListaPresenca && !permitirJaFezEjc && !permitirNaoFezEjc) {
            return res.status(400).json({ error: 'Selecione ao menos uma opção: já fiz EJC ou não fiz EJC.' });
        }
        if (pastaId) {
            const [exists] = await pool.query('SELECT id FROM formularios_pastas WHERE id = ? LIMIT 1', [pastaId]);
            if (!exists.length) return res.status(400).json({ error: 'Pasta não encontrada.' });
        }

        const token = newToken();
        const criadoPor = await resolveUsuarioCriadorId(req);
        const [result] = await pool.query(
            `INSERT INTO formularios_itens
                (titulo, tema, tipo, token, pasta_id, evento_data, evento_hora, criar_lista_presenca, usar_lista_jovens, coletar_dados_avulsos, permitir_ja_fez_ejc, permitir_nao_fez_ejc, criado_por)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                titulo,
                tema,
                tipo,
                token,
                pastaId,
                eventoData,
                eventoHora,
                criarListaPresenca ? 1 : 0,
                criarListaPresenca && (usarListaJovens || permitirJaFezEjc) ? 1 : 0,
                criarListaPresenca && (coletarDadosAvulsos || permitirNaoFezEjc) ? 1 : 0,
                criarListaPresenca && permitirJaFezEjc ? 1 : 0,
                criarListaPresenca && permitirNaoFezEjc ? 1 : 0,
                criadoPor
            ]
        );
        return res.status(201).json({
            id: result.insertId,
            token,
            link: criarListaPresenca ? `/formularios/public/${token}` : null,
            criar_lista_presenca: criarListaPresenca ? 1 : 0,
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
        const id = toPositiveInt(req.params.id);
        if (!id) return res.status(400).json({ error: 'ID inválido.' });
        const [result] = await pool.query('DELETE FROM formularios_itens WHERE id = ?', [id]);
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
        const id = toPositiveInt(req.params.id);
        if (!id) return res.status(400).json({ error: 'ID inválido.' });

        const [rows] = await pool.query(
            `SELECT id, titulo, tema, tipo, token, pasta_id, evento_data, evento_hora, criar_lista_presenca,
                    permitir_ja_fez_ejc, permitir_nao_fez_ejc, ativo, created_at, updated_at
             FROM formularios_itens
             WHERE id = ?
             LIMIT 1`,
            [id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Evento não encontrado.' });
        return res.json(rows[0]);
    } catch (err) {
        console.error('Erro ao carregar evento:', err);
        return res.status(500).json({ error: 'Erro ao carregar evento.' });
    }
});

router.put('/forms/:id', async (req, res) => {
    try {
        await garantirEstrutura();
        const id = toPositiveInt(req.params.id);
        if (!id) return res.status(400).json({ error: 'ID inválido.' });

        const titulo = String(req.body.titulo || '').trim();
        const tema = String(req.body.tema || '').trim() || null;
        const eventoData = normalizarData(req.body.evento_data || req.body.data);
        const eventoHora = normalizarHorario(req.body.evento_hora || req.body.hora);
        const criarListaPresenca = req.body.criar_lista_presenca !== undefined || req.body.criarListaPresenca !== undefined
            ? toBoolean(req.body.criar_lista_presenca ?? req.body.criarListaPresenca)
            : null;
        const permitirJaFezEjc = req.body.permitir_ja_fez_ejc !== undefined || req.body.permitirJaFezEJC !== undefined
            ? toBoolean(req.body.permitir_ja_fez_ejc ?? req.body.permitirJaFezEJC)
            : null;
        const permitirNaoFezEjc = req.body.permitir_nao_fez_ejc !== undefined || req.body.permitirNaoFezEJC !== undefined
            ? toBoolean(req.body.permitir_nao_fez_ejc ?? req.body.permitirNaoFezEJC)
            : null;

        if (!titulo) return res.status(400).json({ error: 'Título é obrigatório.' });

        const [exists] = await pool.query('SELECT id FROM formularios_itens WHERE id = ? LIMIT 1', [id]);
        if (!exists.length) return res.status(404).json({ error: 'Evento não encontrado.' });

        const criarLista = criarListaPresenca === null ? null : (criarListaPresenca ? 1 : 0);
        const jaFez = permitirJaFezEjc === null ? null : (permitirJaFezEjc ? 1 : 0);
        const naoFez = permitirNaoFezEjc === null ? null : (permitirNaoFezEjc ? 1 : 0);

        await pool.query(
            `UPDATE formularios_itens
             SET titulo = ?,
                 tema = ?,
                 evento_data = ?,
                 evento_hora = ?,
                 tipo = CASE
                    WHEN ? IS NULL THEN tipo
                    WHEN ? = 1 THEN 'LISTA_PRESENCA'
                    ELSE 'EVENTO'
                 END,
                 criar_lista_presenca = COALESCE(?, criar_lista_presenca),
                 permitir_ja_fez_ejc = CASE
                    WHEN ? IS NULL THEN permitir_ja_fez_ejc
                    WHEN COALESCE(?, criar_lista_presenca) = 0 THEN 0
                    ELSE ?
                 END,
                 permitir_nao_fez_ejc = CASE
                    WHEN ? IS NULL THEN permitir_nao_fez_ejc
                    WHEN COALESCE(?, criar_lista_presenca) = 0 THEN 0
                    ELSE ?
                 END
             WHERE id = ?`,
            [
                titulo,
                tema,
                eventoData,
                eventoHora,
                criarLista,
                criarLista,
                criarLista,
                jaFez,
                criarLista,
                jaFez,
                naoFez,
                criarLista,
                naoFez,
                id
            ]
        );

        return res.json({ message: 'Evento atualizado com sucesso.' });
    } catch (err) {
        console.error('Erro ao atualizar evento:', err);
        return res.status(500).json({ error: 'Erro ao atualizar evento.' });
    }
});

router.get('/forms/:id/presencas', async (req, res) => {
    try {
        await garantirEstrutura();
        const id = toPositiveInt(req.params.id);
        if (!id) return res.status(400).json({ error: 'ID inválido.' });
        const hasOutrosEjcs = await hasTable('outros_ejcs');

        const [rows] = await pool.query(`
            SELECT fp.id, fp.jovem_id, fp.nome_completo, fp.telefone, fp.ejc_origem, fp.status_ejc, fp.origem_ja_fez,
                   fp.outro_ejc_id, fp.registrado_em, j.nome_completo AS jovem_nome,
                   ${hasOutrosEjcs ? 'oe.nome AS outro_ejc_nome, oe.paroquia AS outro_ejc_paroquia' : 'NULL AS outro_ejc_nome, NULL AS outro_ejc_paroquia'}
            FROM formularios_presencas fp
            LEFT JOIN jovens j ON j.id = fp.jovem_id
            ${hasOutrosEjcs ? 'LEFT JOIN outros_ejcs oe ON oe.id = fp.outro_ejc_id' : ''}
            WHERE fp.formulario_id = ?
            ORDER BY fp.registrado_em DESC
        `, [id]);
        return res.json(rows);
    } catch (err) {
        console.error('Erro ao listar presenças:', err);
        return res.status(500).json({ error: 'Erro ao listar presenças.' });
    }
});

module.exports = router;
