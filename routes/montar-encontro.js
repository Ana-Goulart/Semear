const express = require('express');
const router = express.Router();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pool } = require('../database');
const { getTenantId } = require('../lib/tenantIsolation');

let hasPapelBaseColumnCache = null;
let hasSubfuncaoColumnCache = null;
let hasMontagemDataInicioColumnCache = null;
let hasMontagemDataFimColumnCache = null;
let hasMontagemDataTardeRevelacaoColumnCache = null;
let hasMontagemDataInicioReunioesColumnCache = null;
let hasMontagemDataFimReunioesColumnCache = null;
let ensuredReunioesTables = false;

function mapearPapelPorNomeFuncao(nomeFuncao) {
    const funcaoLower = (nomeFuncao || '').toLowerCase();
    if (funcaoLower.includes('tio') || funcaoLower.includes('tia')) return 'Tio';
    if (funcaoLower.includes('coordenador') || funcaoLower.includes('coord')) return 'Coordenador';
    return 'Membro';
}

function montarEtiquetaEdicao(numeroEjc) {
    return `${numeroEjc}º EJC (Montagem)`;
}

function normalizarDataISO(valor) {
    if (!valor) return null;
    const str = String(valor);
    return str.includes('T') ? str.split('T')[0] : str;
}

function normalizarDataBr(valor) {
    if (!valor) return null;
    const txt = String(valor).trim();
    if (!txt) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(txt)) return txt;
    const m = txt.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return null;
}

function normalizarDataEntrada(valor) {
    return normalizarDataBr(valor) || normalizarDataISO(valor);
}

async function garantirEstruturaMontagemReunioes() {
    if (ensuredReunioesTables) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS montagem_reunioes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            montagem_id INT NOT NULL,
            data_reuniao DATE NOT NULL,
            periodo VARCHAR(120) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_montagem_reuniao (montagem_id, data_reuniao),
            CONSTRAINT fk_montagem_reunioes_montagem FOREIGN KEY (montagem_id) REFERENCES montagens(id) ON DELETE CASCADE
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS montagem_reunioes_presencas (
            id INT AUTO_INCREMENT PRIMARY KEY,
            montagem_id INT NOT NULL,
            reuniao_id INT NOT NULL,
            jovem_id INT NOT NULL,
            presente TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_reuniao_jovem (reuniao_id, jovem_id),
            KEY idx_montagem_jovem (montagem_id, jovem_id),
            CONSTRAINT fk_reuniao_presenca_reuniao FOREIGN KEY (reuniao_id) REFERENCES montagem_reunioes(id) ON DELETE CASCADE
        )
    `);
    ensuredReunioesTables = true;
}

async function runAlterIgnoreDuplicate(sql) {
    try {
        await pool.query(sql);
    } catch (err) {
        if (err && (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_DUP_KEYNAME')) return;
        throw err;
    }
}

async function garantirEstruturaEjcDatasMontagem() {
    await runAlterIgnoreDuplicate("ALTER TABLE ejc ADD COLUMN data_encontro DATE NULL AFTER data_fim");
    await runAlterIgnoreDuplicate("ALTER TABLE ejc ADD COLUMN data_tarde_revelacao DATE NULL AFTER data_encontro");
    await runAlterIgnoreDuplicate("ALTER TABLE ejc ADD COLUMN data_inicio_reunioes DATE NULL AFTER data_tarde_revelacao");
    await runAlterIgnoreDuplicate("ALTER TABLE ejc ADD COLUMN data_fim_reunioes DATE NULL AFTER data_inicio_reunioes");
}

async function sincronizarHistoricoDaAlocacao({ montagemId, equipeId, funcaoId, jovemId, tenantId }) {
    const comPapelBase = await hasPapelBaseColumn();
    const papelBaseSelect = comPapelBase
        ? 'COALESCE(ef.papel_base, "Membro")'
        : '"Membro"';
    const [[dadosAux]] = await pool.query(`
        SELECT m.numero_ejc, e.nome as equipe_nome, ef.nome as funcao_nome, ${papelBaseSelect} as papel_base
        FROM montagens m
        JOIN equipes e ON e.id = ?
        JOIN equipes_funcoes ef ON ef.id = ?
        WHERE m.id = ?
    `, [equipeId, funcaoId, montagemId]);

    if (!dadosAux) return false;

    const papelMapeado = dadosAux.papel_base || mapearPapelPorNomeFuncao(dadosAux.funcao_nome);
    const subfuncao = dadosAux.funcao_nome || null;
    const edicaoMontagem = montarEtiquetaEdicao(dadosAux.numero_ejc);
    const comSubfuncao = await hasSubfuncaoColumn();

    if (comSubfuncao) {
        const [histExists] = await pool.query(
            `SELECT id
             FROM historico_equipes
             WHERE jovem_id = ?
               AND tenant_id = ?
               AND equipe = ?
               AND papel = ?
               AND (subfuncao <=> ?)
               AND (edicao_ejc <=> ?)`,
            [jovemId, tenantId, dadosAux.equipe_nome, papelMapeado, subfuncao, edicaoMontagem]
        );
        if (histExists.length === 0) {
            await pool.query(
                `INSERT INTO historico_equipes (tenant_id, jovem_id, edicao_ejc, equipe, papel, subfuncao, ejc_id) 
                 VALUES (?, ?, ?, ?, ?, ?, NULL)`,
                [tenantId, jovemId, edicaoMontagem, dadosAux.equipe_nome, papelMapeado, subfuncao]
            );
        }
    } else {
        const [histExists] = await pool.query(
            `SELECT id
             FROM historico_equipes
             WHERE jovem_id = ?
               AND tenant_id = ?
               AND equipe = ?
               AND papel = ?
               AND (edicao_ejc <=> ?)`,
            [jovemId, tenantId, dadosAux.equipe_nome, papelMapeado, edicaoMontagem]
        );
        if (histExists.length === 0) {
            await pool.query(
                `INSERT INTO historico_equipes (tenant_id, jovem_id, edicao_ejc, equipe, papel, ejc_id) 
                 VALUES (?, ?, ?, ?, ?, NULL)`,
                [tenantId, jovemId, edicaoMontagem, dadosAux.equipe_nome, papelMapeado]
            );
        }
    }

    return true;
}

async function removerHistoricoDaAlocacao({ montagemId, equipeId, funcaoId, jovemId, tenantId }) {
    const comPapelBase = await hasPapelBaseColumn();
    const papelBaseSelect = comPapelBase
        ? 'COALESCE(ef.papel_base, "Membro")'
        : '"Membro"';
    const [[dadosAux]] = await pool.query(`
        SELECT m.numero_ejc, e.nome as equipe_nome, ef.nome as funcao_nome, ${papelBaseSelect} as papel_base
        FROM montagens m
        JOIN equipes e ON e.id = ?
        JOIN equipes_funcoes ef ON ef.id = ?
        WHERE m.id = ?
    `, [equipeId, funcaoId, montagemId]);

    if (!dadosAux || !jovemId) return false;

    const papelMapeado = dadosAux.papel_base || mapearPapelPorNomeFuncao(dadosAux.funcao_nome);
    const subfuncao = dadosAux.funcao_nome || null;
    const edicaoMontagem = montarEtiquetaEdicao(dadosAux.numero_ejc);
    const comSubfuncao = await hasSubfuncaoColumn();

    if (comSubfuncao) {
        await pool.query(
            `DELETE FROM historico_equipes
             WHERE jovem_id = ?
               AND tenant_id = ?
               AND equipe = ?
               AND papel = ?
               AND (subfuncao <=> ?)
               AND (edicao_ejc <=> ?)
             ORDER BY id DESC
             LIMIT 1`,
            [jovemId, tenantId, dadosAux.equipe_nome, papelMapeado, subfuncao, edicaoMontagem]
        );
    } else {
        await pool.query(
            `DELETE FROM historico_equipes
             WHERE jovem_id = ?
               AND tenant_id = ?
               AND equipe = ?
               AND papel = ?
               AND (edicao_ejc <=> ?)
             ORDER BY id DESC
             LIMIT 1`,
            [jovemId, tenantId, dadosAux.equipe_nome, papelMapeado, edicaoMontagem]
        );
    }

    return true;
}

async function hasPapelBaseColumn() {
    if (hasPapelBaseColumnCache !== null) return hasPapelBaseColumnCache;
    const [rows] = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'equipes_funcoes'
          AND COLUMN_NAME = 'papel_base'
    `);
    hasPapelBaseColumnCache = !!(rows && rows[0] && rows[0].cnt > 0);
    return hasPapelBaseColumnCache;
}

async function hasSubfuncaoColumn() {
    if (hasSubfuncaoColumnCache !== null) return hasSubfuncaoColumnCache;
    const [rows] = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'historico_equipes'
          AND COLUMN_NAME = 'subfuncao'
    `);
    hasSubfuncaoColumnCache = !!(rows && rows[0] && rows[0].cnt > 0);
    return hasSubfuncaoColumnCache;
}

async function hasMontagemDataInicioColumn() {
    if (hasMontagemDataInicioColumnCache !== null) return hasMontagemDataInicioColumnCache;
    const [rows] = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'montagens'
          AND COLUMN_NAME = 'data_inicio'
    `);
    hasMontagemDataInicioColumnCache = !!(rows && rows[0] && rows[0].cnt > 0);
    return hasMontagemDataInicioColumnCache;
}

async function hasMontagemDataFimColumn() {
    if (hasMontagemDataFimColumnCache !== null) return hasMontagemDataFimColumnCache;
    const [rows] = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'montagens'
          AND COLUMN_NAME = 'data_fim'
    `);
    hasMontagemDataFimColumnCache = !!(rows && rows[0] && rows[0].cnt > 0);
    return hasMontagemDataFimColumnCache;
}

async function hasMontagemDataTardeRevelacaoColumn() {
    if (hasMontagemDataTardeRevelacaoColumnCache !== null) return hasMontagemDataTardeRevelacaoColumnCache;
    const [rows] = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'montagens'
          AND COLUMN_NAME = 'data_tarde_revelacao'
    `);
    hasMontagemDataTardeRevelacaoColumnCache = !!(rows && rows[0] && rows[0].cnt > 0);
    return hasMontagemDataTardeRevelacaoColumnCache;
}

async function hasMontagemDataInicioReunioesColumn() {
    if (hasMontagemDataInicioReunioesColumnCache !== null) return hasMontagemDataInicioReunioesColumnCache;
    const [rows] = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'montagens'
          AND COLUMN_NAME = 'data_inicio_reunioes'
    `);
    hasMontagemDataInicioReunioesColumnCache = !!(rows && rows[0] && rows[0].cnt > 0);
    return hasMontagemDataInicioReunioesColumnCache;
}

async function hasMontagemDataFimReunioesColumn() {
    if (hasMontagemDataFimReunioesColumnCache !== null) return hasMontagemDataFimReunioesColumnCache;
    const [rows] = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'montagens'
          AND COLUMN_NAME = 'data_fim_reunioes'
    `);
    hasMontagemDataFimReunioesColumnCache = !!(rows && rows[0] && rows[0].cnt > 0);
    return hasMontagemDataFimReunioesColumnCache;
}

async function garantirEstruturaMontagemMembrosExtra() {
    await runAlterIgnoreDuplicate("ALTER TABLE montagem_membros ADD COLUMN status_ligacao ENUM('ACEITOU','RECUSOU','LIGAR_MAIS_TARDE','TELEFONE_INCORRETO') NULL AFTER jovem_id");
    await runAlterIgnoreDuplicate("ALTER TABLE montagem_membros ADD COLUMN motivo_recusa TEXT NULL AFTER status_ligacao");
    await runAlterIgnoreDuplicate("ALTER TABLE montagem_membros ADD COLUMN eh_substituicao TINYINT(1) NOT NULL DEFAULT 0 AFTER motivo_recusa");
    await runAlterIgnoreDuplicate("ALTER TABLE montagem_membros ADD COLUMN nome_externo VARCHAR(180) NULL AFTER eh_substituicao");
    await runAlterIgnoreDuplicate("ALTER TABLE montagem_membros ADD COLUMN telefone_externo VARCHAR(30) NULL AFTER nome_externo");
    try {
        await pool.query("ALTER TABLE montagem_membros MODIFY jovem_id INT NULL");
    } catch (err) {
        if (!err || err.code !== 'ER_DUP_FIELDNAME') {
            if (err.code !== 'ER_PARSE_ERROR' && err.code !== 'ER_BAD_FIELD_ERROR') {
                throw err;
            }
        }
    }
    try {
        await pool.query("ALTER TABLE montagem_membros MODIFY status_ligacao ENUM('ACEITOU','RECUSOU','LIGAR_MAIS_TARDE','TELEFONE_INCORRETO') NULL");
    } catch (err) {
        if (!err || err.code !== 'ER_DUP_FIELDNAME') {
            if (err.code !== 'ER_PARSE_ERROR' && err.code !== 'ER_BAD_FIELD_ERROR') {
                throw err;
            }
        }
    }
}

async function garantirEstruturaMontagemDatas() {
    await runAlterIgnoreDuplicate("ALTER TABLE montagens ADD COLUMN data_tarde_revelacao DATE NULL AFTER data_encontro");
    await runAlterIgnoreDuplicate("ALTER TABLE montagens ADD COLUMN data_inicio_reunioes DATE NULL AFTER data_tarde_revelacao");
    await runAlterIgnoreDuplicate("ALTER TABLE montagens ADD COLUMN data_fim_reunioes DATE NULL AFTER data_inicio_reunioes");
}

async function garantirEstruturaMontagemJovensServir() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS montagem_jovens_servir (
            id INT AUTO_INCREMENT PRIMARY KEY,
            montagem_id INT NOT NULL,
            jovem_id INT NOT NULL,
            pode_servir TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_montagem_jovem_servir (montagem_id, jovem_id),
            CONSTRAINT fk_montagem_jovens_servir_montagem FOREIGN KEY (montagem_id) REFERENCES montagens(id) ON DELETE CASCADE,
            CONSTRAINT fk_montagem_jovens_servir_jovem FOREIGN KEY (jovem_id) REFERENCES jovens(id) ON DELETE CASCADE
        )
    `);
}

async function garantirEstruturaMontagemTiosServir() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS montagem_tios_servir (
            id INT AUTO_INCREMENT PRIMARY KEY,
            montagem_id INT NOT NULL,
            casal_id INT NOT NULL,
            pode_servir TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_montagem_tio_servir (montagem_id, casal_id),
            KEY idx_montagem_tios_servir_casal (casal_id),
            CONSTRAINT fk_montagem_tios_servir_montagem FOREIGN KEY (montagem_id) REFERENCES montagens(id) ON DELETE CASCADE
        )
    `);
}

// Listar montagens de encontros
router.get('/', async (req, res) => {
    try {
        const tenantId = getTenantId(req);
        await garantirEstruturaMontagemMembrosExtra();
        await garantirEstruturaMontagemDatas();
        const comDataInicio = await hasMontagemDataInicioColumn();
        const comDataFim = await hasMontagemDataFimColumn();
        const comDataTarde = await hasMontagemDataTardeRevelacaoColumn();
        const comDataInicioReunioes = await hasMontagemDataInicioReunioesColumn();
        const comDataFimReunioes = await hasMontagemDataFimReunioesColumn();

        const selectDataInicio = comDataInicio ? 'data_inicio' : 'data_encontro';
        const selectDataFim = comDataFim ? 'data_fim' : 'data_encontro';
        const selectDataTarde = comDataTarde ? 'data_tarde_revelacao' : 'NULL';
        const selectDataInicioReunioes = comDataInicioReunioes ? 'data_inicio_reunioes' : 'NULL';
        const selectDataFimReunioes = comDataFimReunioes ? 'data_fim_reunioes' : 'NULL';
        const whereAtivo = comDataFimReunioes
            ? 'COALESCE(data_fim_reunioes, data_fim, data_encontro, "9999-12-31") >= CURDATE()'
            : (comDataFim
                ? 'COALESCE(data_fim, data_encontro, "9999-12-31") >= CURDATE()'
                : 'COALESCE(data_encontro, "9999-12-31") >= CURDATE()');

        const [rows] = await pool.query(`
            SELECT
                id,
                numero_ejc,
                data_encontro,
                ${selectDataTarde} AS data_tarde_revelacao,
                ${selectDataInicioReunioes} AS data_inicio_reunioes,
                ${selectDataFimReunioes} AS data_fim_reunioes,
                ${selectDataInicio} AS data_inicio,
                ${selectDataFim} AS data_fim,
                created_at
            FROM montagens
            WHERE ${whereAtivo}
              AND tenant_id = ?
            ORDER BY created_at DESC
        `, [tenantId]);
        res.json(rows);
    } catch (err) {
        console.error("Erro ao buscar montagens:", err);
        res.status(500).json({ error: "Erro ao buscar montagens" });
    }
});

// Criar montagem
router.post('/', async (req, res) => {
    const { numero_ejc, data_encontro, data_tarde_revelacao, data_inicio_reunioes, data_fim_reunioes } = req.body;
    if (!numero_ejc || !data_encontro || !data_tarde_revelacao || !data_inicio_reunioes || !data_fim_reunioes) {
        return res.status(400).json({ error: "Preencha número do EJC, data do encontro, tarde de revelação e período das reuniões." });
    }

    const dataEncontro = normalizarDataEntrada(data_encontro);
    const dataTarde = normalizarDataEntrada(data_tarde_revelacao);
    const inicioReunioes = normalizarDataEntrada(data_inicio_reunioes);
    const fimReunioes = normalizarDataEntrada(data_fim_reunioes);
    if (!dataEncontro || !dataTarde || !inicioReunioes || !fimReunioes) {
        return res.status(400).json({ error: "Informe todas as datas no formato dd/mm/aaaa." });
    }
    if (inicioReunioes > fimReunioes) {
        return res.status(400).json({ error: "A data fim das reuniões não pode ser menor que a data início." });
    }

    try {
        const tenantId = getTenantId(req);
        await garantirEstruturaMontagemMembrosExtra();
        await garantirEstruturaMontagemDatas();
        const comDataInicio = await hasMontagemDataInicioColumn();
        const comDataFim = await hasMontagemDataFimColumn();
        const comDataTarde = await hasMontagemDataTardeRevelacaoColumn();
        const comDataInicioReunioes = await hasMontagemDataInicioReunioesColumn();
        const comDataFimReunioes = await hasMontagemDataFimReunioesColumn();

        const cols = ['tenant_id', 'numero_ejc', 'data_encontro'];
        const vals = [tenantId, numero_ejc, dataEncontro];
        if (comDataTarde) { cols.push('data_tarde_revelacao'); vals.push(dataTarde); }
        if (comDataInicioReunioes) { cols.push('data_inicio_reunioes'); vals.push(inicioReunioes); }
        if (comDataFimReunioes) { cols.push('data_fim_reunioes'); vals.push(fimReunioes); }
        if (comDataInicio) { cols.push('data_inicio'); vals.push(inicioReunioes); }
        if (comDataFim) { cols.push('data_fim'); vals.push(fimReunioes); }

        const placeholders = cols.map(() => '?').join(', ');
        const [result] = await pool.query(
            `INSERT INTO montagens (${cols.join(', ')}) VALUES (${placeholders})`,
            vals
        );
        res.json({ id: result.insertId, message: "Montagem de encontro iniciada" });
    } catch (err) {
        console.error("Erro ao criar montagem:", err);
        res.status(500).json({ error: "Erro ao criar montagem" });
    }
});

// Atualizar informações da montagem (ex: número EJC e datas)
router.put('/:id', async (req, res) => {
    const montagemId = Number(req.params.id);
    const { numero_ejc, data_encontro, data_tarde_revelacao, data_inicio_reunioes, data_fim_reunioes } = req.body || {};
    if (!montagemId) return res.status(400).json({ error: 'Montagem inválida.' });
    if (!numero_ejc || !data_encontro || !data_tarde_revelacao || !data_inicio_reunioes || !data_fim_reunioes) {
        return res.status(400).json({ error: 'Preencha número do EJC, data do encontro, tarde de revelação e período das reuniões.' });
    }

    const dataEncontro = normalizarDataEntrada(data_encontro);
    const dataTarde = normalizarDataEntrada(data_tarde_revelacao);
    const inicioReunioes = normalizarDataEntrada(data_inicio_reunioes);
    const fimReunioes = normalizarDataEntrada(data_fim_reunioes);
    if (!dataEncontro || !dataTarde || !inicioReunioes || !fimReunioes) {
        return res.status(400).json({ error: 'Informe todas as datas no formato dd/mm/aaaa.' });
    }
    if (inicioReunioes > fimReunioes) {
        return res.status(400).json({ error: 'A data fim das reuniões não pode ser menor que a data início.' });
    }

    try {
        const tenantId = getTenantId(req);
        await garantirEstruturaMontagemMembrosExtra();
        await garantirEstruturaMontagemDatas();
        const [exists] = await pool.query('SELECT id FROM montagens WHERE id = ? AND tenant_id = ? LIMIT 1', [montagemId, tenantId]);
        if (!exists.length) return res.status(404).json({ error: 'Montagem não encontrada.' });

        const comDataInicio = await hasMontagemDataInicioColumn();
        const comDataFim = await hasMontagemDataFimColumn();
        const comDataTarde = await hasMontagemDataTardeRevelacaoColumn();
        const comDataInicioReunioes = await hasMontagemDataInicioReunioesColumn();
        const comDataFimReunioes = await hasMontagemDataFimReunioesColumn();

        const sets = ['numero_ejc = ?', 'data_encontro = ?'];
        const params = [numero_ejc, dataEncontro];
        if (comDataTarde) { sets.push('data_tarde_revelacao = ?'); params.push(dataTarde); }
        if (comDataInicioReunioes) { sets.push('data_inicio_reunioes = ?'); params.push(inicioReunioes); }
        if (comDataFimReunioes) { sets.push('data_fim_reunioes = ?'); params.push(fimReunioes); }
        if (comDataInicio) { sets.push('data_inicio = ?'); params.push(inicioReunioes); }
        if (comDataFim) { sets.push('data_fim = ?'); params.push(fimReunioes); }
        params.push(montagemId, tenantId);

        await pool.query(
            `UPDATE montagens SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`,
            params
        );

        return res.json({ message: 'Montagem atualizada com sucesso.' });
    } catch (err) {
        console.error('Erro ao atualizar montagem:', err);
        return res.status(500).json({ error: 'Erro ao atualizar montagem.' });
    }
});

// Deletar montagem
router.delete('/:id', async (req, res) => {
    const montagemId = req.params.id;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const tenantId = getTenantId(req);

        const [[montagem]] = await connection.query(
            'SELECT id, numero_ejc FROM montagens WHERE id = ? AND tenant_id = ? LIMIT 1',
            [montagemId, tenantId]
        );
        if (!montagem) {
            await connection.rollback();
            return res.status(404).json({ error: "Montagem não encontrada" });
        }

        const edicaoMontagem = montarEtiquetaEdicao(montagem.numero_ejc);
        const edicaoMontagemAlt = `${montagem.numero_ejc}° EJC (Montagem)`;
        const likeMontagemNumero = `${montagem.numero_ejc}%EJC (Montagem)%`;

        await connection.query('DELETE FROM montagem_membros WHERE montagem_id = ? AND tenant_id = ?', [montagemId, tenantId]);
        await connection.query(
            `DELETE FROM historico_equipes
             WHERE edicao_ejc = ?
                OR edicao_ejc = ?
                OR edicao_ejc LIKE ?`,
            [edicaoMontagem, edicaoMontagemAlt, likeMontagemNumero]
        );
        await connection.query('DELETE FROM montagens WHERE id = ? AND tenant_id = ?', [montagemId, tenantId]);

        await connection.commit();
        res.json({ message: "Montagem deletada com sucesso" });
    } catch (err) {
        await connection.rollback();
        console.error("Erro ao deletar montagem:", err);
        res.status(500).json({ error: "Erro ao deletar" });
    } finally {
        connection.release();
    }
});

// Buscar equipes, funções e membros associados à montagem
router.get('/:id/estrutura', async (req, res) => {
    const montagemId = req.params.id;
    try {
        const tenantId = getTenantId(req);
        await garantirEstruturaMontagemMembrosExtra();
        const comPapelBase = await hasPapelBaseColumn();
        const papelBaseSelect = comPapelBase
            ? 'COALESCE(ef.papel_base, "Membro")'
            : '"Membro"';
        const [equipesFuncoes] = await pool.query(`
            SELECT eq.id as equipe_id, eq.nome as equipe_nome, COALESCE(eq.membros_outro_ejc, 0) AS membros_outro_ejc,
                   ef.id as funcao_id, ef.nome as funcao_nome, ${papelBaseSelect} as papel_base
            FROM equipes eq
            LEFT JOIN equipes_funcoes ef ON eq.id = ef.equipe_id
            ORDER BY eq.nome ASC, ef.nome ASC
        `);

        const [membros] = await pool.query(`
            SELECT mm.id as membro_id, mm.equipe_id, mm.funcao_id, mm.jovem_id, j.nome_completo as jovem_nome, j.telefone,
                   mm.status_ligacao, mm.motivo_recusa, mm.eh_substituicao, mm.nome_externo, mm.telefone_externo
            FROM montagem_membros mm
            LEFT JOIN jovens j ON mm.jovem_id = j.id
            WHERE mm.montagem_id = ?
              AND mm.tenant_id = ?
              AND (mm.status_ligacao IS NULL OR mm.status_ligacao <> 'RECUSOU')
        `, [montagemId, tenantId]);

        const estrutura = {};
        for (let row of equipesFuncoes) {
            if (!estrutura[row.equipe_id]) {
                estrutura[row.equipe_id] = {
                    id: row.equipe_id,
                    nome: row.equipe_nome,
                    membros_outro_ejc: row.membros_outro_ejc ? 1 : 0,
                    funcoes: []
                };
            }

            if (row.funcao_id) {
                const memberInRole = membros.filter(m => m.equipe_id === row.equipe_id && m.funcao_id === row.funcao_id);
                estrutura[row.equipe_id].funcoes.push({
                    id: row.funcao_id,
                    nome: row.funcao_nome,
                    papel_base: row.papel_base || 'Membro',
                    membros: memberInRole
                });
            }
        }
        res.json(Object.values(estrutura));
    } catch (err) {
        console.error("Erro ao buscar estrutura:", err);
        res.status(500).json({ error: "Erro ao buscar estrutura" });
    }
});

router.get('/:id/jovens-para-servir', async (req, res) => {
    const montagemId = Number(req.params.id);
    if (!montagemId) return res.status(400).json({ error: 'ID inválido.' });
    try {
        await garantirEstruturaMontagemJovensServir();
        const [rows] = await pool.query(`
            SELECT
                j.id,
                j.nome_completo,
                j.numero_ejc_fez,
                j.outro_ejc_numero,
                j.outro_ejc_id,
                j.data_nascimento,
                j.sexo,
                j.estado_civil,
                COALESCE(j.eh_musico, 0) AS eh_musico,
                COALESCE(j.origem_ejc_tipo, 'INCONFIDENTES') AS origem_ejc_tipo,
                oe.nome AS outro_ejc_nome,
                oe.paroquia AS outro_ejc_paroquia,
                COALESCE(mjs.pode_servir, 0) AS pode_servir
            FROM jovens j
            LEFT JOIN outros_ejcs oe ON oe.id = j.outro_ejc_id
            LEFT JOIN montagem_jovens_servir mjs ON mjs.jovem_id = j.id AND mjs.montagem_id = ?
            ORDER BY j.nome_completo ASC
        `, [montagemId]);
        return res.json(rows);
    } catch (err) {
        console.error('Erro ao listar jovens para servir:', err);
        return res.status(500).json({ error: 'Erro ao listar jovens para servir.' });
    }
});

router.patch('/:id/jovens-para-servir/:jovemId', async (req, res) => {
    const montagemId = Number(req.params.id);
    const jovemId = Number(req.params.jovemId);
    const podeServir = req.body && req.body.pode_servir ? 1 : 0;
    if (!montagemId || !jovemId) return res.status(400).json({ error: 'Parâmetros inválidos.' });
    try {
        await garantirEstruturaMontagemJovensServir();
        const [jovemRows] = await pool.query('SELECT id FROM jovens WHERE id = ? LIMIT 1', [jovemId]);
        if (!jovemRows.length) return res.status(404).json({ error: 'Jovem não encontrado.' });

        await pool.query(
            `INSERT INTO montagem_jovens_servir (montagem_id, jovem_id, pode_servir)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE pode_servir = VALUES(pode_servir)`,
            [montagemId, jovemId, podeServir]
        );
        return res.json({ message: 'Lista de jovens para servir atualizada.' });
    } catch (err) {
        console.error('Erro ao atualizar jovem para servir:', err);
        return res.status(500).json({ error: 'Erro ao atualizar lista de jovens para servir.' });
    }
});

router.get('/:id/tios-para-servir', async (req, res) => {
    const montagemId = Number(req.params.id);
    if (!montagemId) return res.status(400).json({ error: 'ID inválido.' });
    try {
        await garantirEstruturaMontagemTiosServir();
        const tenantId = getTenantId(req);
        const [rows] = await pool.query(`
            SELECT
                c.id,
                c.nome_tio,
                c.nome_tia,
                c.telefone_tio,
                c.telefone_tia,
                COALESCE(mts.pode_servir, 0) AS pode_servir
            FROM tios_casais c
            LEFT JOIN montagem_tios_servir mts ON mts.casal_id = c.id AND mts.montagem_id = ?
            WHERE c.tenant_id = ?
            ORDER BY c.nome_tio ASC, c.nome_tia ASC
        `, [montagemId, tenantId]);
        return res.json(rows);
    } catch (err) {
        console.error('Erro ao listar tios para servir:', err);
        return res.status(500).json({ error: 'Erro ao listar tios para servir.' });
    }
});

router.patch('/:id/tios-para-servir/:casalId', async (req, res) => {
    const montagemId = Number(req.params.id);
    const casalId = Number(req.params.casalId);
    const podeServir = req.body && req.body.pode_servir ? 1 : 0;
    if (!montagemId || !casalId) return res.status(400).json({ error: 'Parâmetros inválidos.' });
    try {
        await garantirEstruturaMontagemTiosServir();
        const tenantId = getTenantId(req);
        const [casalRows] = await pool.query(
            'SELECT id FROM tios_casais WHERE id = ? AND tenant_id = ? LIMIT 1',
            [casalId, tenantId]
        );
        if (!casalRows.length) return res.status(404).json({ error: 'Casal de tios não encontrado.' });

        await pool.query(
            `INSERT INTO montagem_tios_servir (montagem_id, casal_id, pode_servir)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE pode_servir = VALUES(pode_servir)`,
            [montagemId, casalId, podeServir]
        );
        return res.json({ message: 'Lista de tios para servir atualizada.' });
    } catch (err) {
        console.error('Erro ao atualizar tio para servir:', err);
        return res.status(500).json({ error: 'Erro ao atualizar lista de tios para servir.' });
    }
});

// Reuniões e presença (Pré-Encontro)
router.get('/:id/reunioes', async (req, res) => {
    const montagemId = Number(req.params.id);
    if (!montagemId) return res.status(400).json({ error: 'ID inválido.' });
    try {
        const tenantId = getTenantId(req);
        await garantirEstruturaMontagemReunioes();
        const [reunioes] = await pool.query(
            `SELECT id, data_reuniao, periodo
             FROM montagem_reunioes
             WHERE montagem_id = ?
             ORDER BY data_reuniao ASC`,
            [montagemId]
        );
        const [membros] = await pool.query(
            `SELECT mm.equipe_id, e.nome AS equipe_nome,
                    j.id, j.nome_completo, j.telefone,
                    COALESCE(j.origem_ejc_tipo, 'INCONFIDENTES') AS origem_ejc_tipo,
                    j.numero_ejc_fez, j.outro_ejc_numero, j.outro_ejc_id,
                    oe.nome AS outro_ejc_nome, oe.paroquia AS outro_ejc_paroquia
             FROM montagem_membros mm
             JOIN equipes e ON e.id = mm.equipe_id
             JOIN jovens j ON j.id = mm.jovem_id
             LEFT JOIN outros_ejcs oe ON oe.id = j.outro_ejc_id
            WHERE mm.montagem_id = ?
              AND mm.tenant_id = ?
              AND mm.jovem_id IS NOT NULL
              AND mm.eh_substituicao = 0
              AND (mm.status_ligacao = 'ACEITOU')
             ORDER BY e.nome ASC, j.nome_completo ASC`,
            [montagemId, tenantId]
        );
        const [presencas] = await pool.query(
            `SELECT reuniao_id, jovem_id, presente
             FROM montagem_reunioes_presencas
             WHERE montagem_id = ?`,
            [montagemId]
        );
        const equipesMap = new Map();
        for (const row of membros || []) {
            const equipeId = Number(row.equipe_id);
            if (!equipesMap.has(equipeId)) {
                equipesMap.set(equipeId, { id: equipeId, nome: row.equipe_nome, membros: [] });
            }
            equipesMap.get(equipeId).membros.push({
                id: row.id,
                nome_completo: row.nome_completo,
                telefone: row.telefone,
                origem_ejc_tipo: row.origem_ejc_tipo,
                numero_ejc_fez: row.numero_ejc_fez,
                outro_ejc_numero: row.outro_ejc_numero,
                outro_ejc_id: row.outro_ejc_id,
                outro_ejc_nome: row.outro_ejc_nome,
                outro_ejc_paroquia: row.outro_ejc_paroquia
            });
        }
        const equipes = Array.from(equipesMap.values());
        return res.json({ reunioes, equipes, presencas });
    } catch (err) {
        console.error('Erro ao buscar reuniões:', err);
        return res.status(500).json({ error: 'Erro ao buscar reuniões.' });
    }
});

router.post('/:id/reunioes/gerar', async (req, res) => {
    const montagemId = Number(req.params.id);
    if (!montagemId) return res.status(400).json({ error: 'ID inválido.' });
    try {
        await garantirEstruturaMontagemReunioes();
        const dataInicio = normalizarDataBr(req.body.data_inicio);
        const dataFim = normalizarDataBr(req.body.data_fim);
        const diaSemana = Number(req.body.dia_semana);
        const periodo = String(req.body.periodo || '').trim() || null;
        if (!dataInicio || !dataFim || Number.isNaN(diaSemana)) {
            return res.status(400).json({ error: 'Informe período e datas válidas.' });
        }
        if (dataInicio > dataFim) {
            return res.status(400).json({ error: 'Data fim não pode ser menor que a data início.' });
        }

        const start = new Date(`${dataInicio}T00:00:00`);
        const end = new Date(`${dataFim}T00:00:00`);
        const datas = [];
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            if (d.getDay() === diaSemana) {
                const iso = d.toISOString().split('T')[0];
                datas.push(iso);
            }
        }
        if (!datas.length) {
            return res.status(400).json({ error: 'Nenhuma reunião encontrada dentro do período.' });
        }

        await pool.query('DELETE FROM montagem_reunioes_presencas WHERE montagem_id = ?', [montagemId]);
        await pool.query('DELETE FROM montagem_reunioes WHERE montagem_id = ?', [montagemId]);

        const values = datas.map((d) => [montagemId, d, periodo]);
        await pool.query(
            'INSERT INTO montagem_reunioes (montagem_id, data_reuniao, periodo) VALUES ?',
            [values]
        );

        return res.json({ message: 'Reuniões geradas com sucesso.', total: datas.length });
    } catch (err) {
        console.error('Erro ao gerar reuniões:', err);
        return res.status(500).json({ error: 'Erro ao gerar reuniões.' });
    }
});

router.post('/:id/reunioes/gerar-domingos', async (req, res) => {
    const montagemId = Number(req.params.id);
    if (!montagemId) return res.status(400).json({ error: 'ID inválido.' });
    try {
        await garantirEstruturaMontagemReunioes();
        const dataInicio = normalizarDataBr(req.body.data_inicio);
        const dataFim = normalizarDataBr(req.body.data_fim);
        if (!dataInicio || !dataFim) return res.status(400).json({ error: 'Informe datas válidas.' });
        if (dataInicio > dataFim) return res.status(400).json({ error: 'Data fim não pode ser menor que a data início.' });

        const start = new Date(`${dataInicio}T00:00:00`);
        const end = new Date(`${dataFim}T00:00:00`);
        const datas = [];
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            if (d.getDay() === 0) {
                const iso = d.toISOString().split('T')[0];
                datas.push(iso);
            }
        }
        if (!datas.length) {
            return res.status(400).json({ error: 'Nenhum domingo encontrado dentro do período.' });
        }

        await pool.query('DELETE FROM montagem_reunioes_presencas WHERE montagem_id = ?', [montagemId]);
        await pool.query('DELETE FROM montagem_reunioes WHERE montagem_id = ?', [montagemId]);

        const values = datas.map((d) => [montagemId, d, 'Domingo']);
        await pool.query(
            'INSERT INTO montagem_reunioes (montagem_id, data_reuniao, periodo) VALUES ?',
            [values]
        );

        return res.json({ message: 'Reuniões (domingos) geradas com sucesso.', total: datas.length });
    } catch (err) {
        console.error('Erro ao gerar reuniões (domingos):', err);
        return res.status(500).json({ error: 'Erro ao gerar reuniões.' });
    }
});

router.patch('/:id/reunioes/:reuniaoId/presencas/:jovemId', async (req, res) => {
    const montagemId = Number(req.params.id);
    const reuniaoId = Number(req.params.reuniaoId);
    const jovemId = Number(req.params.jovemId);
    const presente = req.body && req.body.presente ? 1 : 0;
    if (!montagemId || !reuniaoId || !jovemId) return res.status(400).json({ error: 'Parâmetros inválidos.' });
    try {
        await garantirEstruturaMontagemReunioes();
        await pool.query(
            `INSERT INTO montagem_reunioes_presencas (montagem_id, reuniao_id, jovem_id, presente)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE presente = VALUES(presente)`,
            [montagemId, reuniaoId, jovemId, presente]
        );
        return res.json({ message: 'Presença atualizada.' });
    } catch (err) {
        console.error('Erro ao atualizar presença:', err);
        return res.status(500).json({ error: 'Erro ao atualizar presença.' });
    }
});

router.get('/:id/jovens-para-servir/search', async (req, res) => {
    const montagemId = Number(req.params.id);
    const q = String((req.query && req.query.q) || '').trim();
    const origem = String((req.query && req.query.origem) || '').trim().toUpperCase();
    const fonte = String((req.query && req.query.fonte) || '').trim().toUpperCase();
    const outroEjcId = Number((req.query && req.query.outro_ejc_id) || 0);
    if (!montagemId) return res.status(400).json({ error: 'ID inválido.' });
    const fonteFinal = fonte || (origem === 'OUTRO_EJC' ? 'OUTRO_EJC' : 'LISTA_MESTRE');
    if ((fonteFinal === 'LISTA_MESTRE' || fonteFinal === 'TIOS') && (!q || q.length < 2)) {
        return res.json([]);
    }
    if (fonteFinal === 'OUTRO_EJC' && !outroEjcId) {
        return res.status(400).json({ error: 'Selecione o EJC de origem para buscar jovens de outro EJC.' });
    }
    try {
        const tenantId = getTenantId(req);
        if (fonteFinal === 'TIOS') {
            const [rows] = await pool.query(
                `SELECT id, nome_tio, nome_tia, telefone_tio, telefone_tia
                 FROM tios_casais
                 WHERE tenant_id = ?
                   AND (nome_tio LIKE ? OR nome_tia LIKE ?)
                 ORDER BY nome_tio ASC, nome_tia ASC
                 LIMIT 30`,
                [tenantId, `%${q}%`, `%${q}%`]
            );
            const out = rows.map(r => ({
                id: r.id,
                tipo: 'TIOS',
                nome_completo: [r.nome_tio, r.nome_tia].filter(Boolean).join(' e ') || r.nome_tio || r.nome_tia || 'Tios',
                telefone: r.telefone_tio || r.telefone_tia || ''
            }));
            return res.json(out);
        }

        const where = [
            'j.nome_completo LIKE ?',
            'j.tenant_id = ?'
        ];
        const params = [`%${q}%`, tenantId];

        if (fonteFinal === 'OUTRO_EJC') {
            where.push("COALESCE(j.origem_ejc_tipo, 'INCONFIDENTES') = 'OUTRO_EJC'");
            if (outroEjcId > 0) {
                where.push('j.outro_ejc_id = ?');
                params.push(outroEjcId);
            }
        } else {
            where.push("COALESCE(j.origem_ejc_tipo, 'INCONFIDENTES') <> 'OUTRO_EJC'");
        }

        const limit = (fonteFinal === 'OUTRO_EJC' && (!q || q.length < 2)) ? 200 : 30;
        const [rows] = await pool.query(`
            SELECT j.id, j.nome_completo, j.data_nascimento, j.telefone, j.numero_ejc_fez, j.outro_ejc_numero, j.outro_ejc_id
            FROM jovens j
            WHERE ${where.join(' AND ')}
            ORDER BY j.nome_completo ASC
            LIMIT ${limit}
        `, params);
        return res.json(rows);
    } catch (err) {
        console.error('Erro ao buscar jovens para servir:', err);
        return res.status(500).json({ error: 'Erro ao buscar jovens para servir.' });
    }
});

// Adicionar um jovem a uma função (cargo) nessa montagem
router.post('/:id/membros', async (req, res) => {
    const { equipe_id, funcao_id, jovem_id } = req.body;
    const montagemId = req.params.id;
    const ehSubstituicao = req.body.eh_substituicao ? 1 : 0;

    try {
        const tenantId = getTenantId(req);
        await garantirEstruturaMontagemMembrosExtra();

        if (!ehSubstituicao) {
        const [emOutraEquipe] = await pool.query(
            `SELECT mm.id, mm.equipe_id, e.nome AS equipe_nome
             FROM montagem_membros mm
             JOIN equipes e ON e.id = mm.equipe_id
             WHERE mm.montagem_id = ?
               AND mm.jovem_id = ?
               AND mm.equipe_id <> ?
               AND mm.eh_substituicao = 0
               AND mm.tenant_id = ?
             LIMIT 1`,
            [montagemId, jovem_id, equipe_id, tenantId]
        );
        if (emOutraEquipe.length) {
            return res.status(409).json({
                error: `Esse jovem já está na equipe: ${emOutraEquipe[0].equipe_nome}.`,
                conflict: {
                    membro_id: emOutraEquipe[0].id,
                    equipe_id: emOutraEquipe[0].equipe_id,
                    equipe_nome: emOutraEquipe[0].equipe_nome
                }
            });
        }
        }

        const [duplicadoNaEquipe] = await pool.query(
            `SELECT mm.id, mm.funcao_id, ef.nome AS funcao_nome
             FROM montagem_membros mm
             LEFT JOIN equipes_funcoes ef ON ef.id = mm.funcao_id
             WHERE mm.montagem_id = ?
               AND mm.equipe_id = ?
               AND mm.jovem_id = ?
               AND mm.tenant_id = ?
             LIMIT 1`,
            [montagemId, equipe_id, jovem_id, tenantId]
        );
        if (duplicadoNaEquipe.length) {
            const nomeFuncao = String(duplicadoNaEquipe[0].funcao_nome || '').trim();
            return res.status(400).json({
                error: nomeFuncao
                    ? `Esse jovem já está nesta equipe (função: ${nomeFuncao}).`
                    : 'Esse jovem já está nesta equipe.'
            });
        }

        const [jaExiste] = await pool.query(
            'SELECT id FROM montagem_membros WHERE montagem_id = ? AND equipe_id = ? AND funcao_id = ? AND jovem_id = ? AND tenant_id = ? LIMIT 1',
            [montagemId, equipe_id, funcao_id, jovem_id, tenantId]
        );
        if (jaExiste.length > 0) {
            await pool.query(
                'UPDATE montagem_membros SET eh_substituicao = ? WHERE id = ? AND tenant_id = ?',
                [ehSubstituicao, jaExiste[0].id, tenantId]
            );
            if (ehSubstituicao) {
                await removerHistoricoDaAlocacao({
                    montagemId,
                    equipeId: equipe_id,
                    funcaoId: funcao_id,
                    jovemId: jovem_id,
                    tenantId
                });
                return res.status(200).json({ id: jaExiste[0].id, message: "Jovem atualizado como reserva; histórico removido." });
            }
            await sincronizarHistoricoDaAlocacao({
                montagemId,
                equipeId: equipe_id,
                funcaoId: funcao_id,
                jovemId: jovem_id,
                tenantId
            });
            return res.status(200).json({ id: jaExiste[0].id, message: "Jovem já estava alocado; histórico sincronizado." });
        }

        // 1. Inserir na tabela de montagem (o que já fazíamos)
        const [result] = await pool.query(
            'INSERT INTO montagem_membros (tenant_id, montagem_id, equipe_id, funcao_id, jovem_id, eh_substituicao) VALUES (?, ?, ?, ?, ?, ?)',
            [tenantId, montagemId, equipe_id, funcao_id, jovem_id, ehSubstituicao]
        );

        if (!ehSubstituicao) {
            await sincronizarHistoricoDaAlocacao({
                montagemId,
                equipeId: equipe_id,
                funcaoId: funcao_id,
                jovemId: jovem_id,
                tenantId
            });
        }

        res.json({ id: result.insertId, message: "Jovem alocado e histórico atualizado!" });
    } catch (err) {
        console.error("Erro ao alocar membro e salvar histórico:", err);
        res.status(500).json({ error: "Erro ao processar alocação" });
    }
});

router.post('/:id/membros-externos', async (req, res) => {
    const montagemId = req.params.id;
    const equipeId = Number(req.body.equipe_id);
    const funcaoId = Number(req.body.funcao_id);
    const nome = String(req.body.nome_completo || '').trim();
    const telefone = String(req.body.telefone || '').trim() || null;
    const ehSubstituicao = req.body.eh_substituicao ? 1 : 0;
    if (!equipeId || !funcaoId || !nome) return res.status(400).json({ error: 'Dados obrigatórios: equipe, função e nome.' });

    try {
        const tenantId = getTenantId(req);
        await garantirEstruturaMontagemMembrosExtra();
        const [result] = await pool.query(
            `INSERT INTO montagem_membros
                (tenant_id, montagem_id, equipe_id, funcao_id, jovem_id, eh_substituicao, nome_externo, telefone_externo)
             VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
            [tenantId, montagemId, equipeId, funcaoId, ehSubstituicao, nome, telefone]
        );
        return res.json({ id: result.insertId, message: 'Membro externo adicionado.' });
    } catch (err) {
        console.error('Erro ao adicionar membro externo:', err);
        return res.status(500).json({ error: 'Erro ao adicionar membro externo.' });
    }
});

router.post('/:id/equipes/:equipeId/importar-externos', async (req, res) => {
    const montagemId = Number(req.params.id);
    const equipeId = Number(req.params.equipeId);
    const lista = Array.isArray(req.body && req.body.items) ? req.body.items : [];
    if (!montagemId || !equipeId || !lista.length) return res.status(400).json({ error: 'Dados inválidos para importação.' });

    try {
        const tenantId = getTenantId(req);
        await garantirEstruturaMontagemMembrosExtra();
        let inseridos = 0;
        for (const item of lista) {
            const nome = String(item.nome_completo || '').trim();
            const telefone = String(item.telefone || '').trim() || null;
            const funcaoId = Number(item.funcao_id);
            const ehSubstituicao = item.eh_substituicao ? 1 : 0;
            if (!nome || !funcaoId) continue;
            await pool.query(
                `INSERT INTO montagem_membros
                    (tenant_id, montagem_id, equipe_id, funcao_id, jovem_id, eh_substituicao, nome_externo, telefone_externo)
                 VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
                [tenantId, montagemId, equipeId, funcaoId, ehSubstituicao, nome, telefone]
            );
            inseridos++;
        }
        return res.json({ message: 'Importação concluída.', inseridos });
    } catch (err) {
        console.error('Erro ao importar membros externos:', err);
        return res.status(500).json({ error: 'Erro ao importar membros externos.' });
    }
});

router.get('/:id/equipes/:equipeId/detalhes', async (req, res) => {
    const montagemId = Number(req.params.id);
    const equipeId = Number(req.params.equipeId);
    if (!montagemId || !equipeId) return res.status(400).json({ error: 'Parâmetros inválidos.' });

    try {
        const tenantId = getTenantId(req);
        await garantirEstruturaMontagemMembrosExtra();
        const [rows] = await pool.query(`
            SELECT mm.id AS membro_id, mm.equipe_id, mm.funcao_id, mm.jovem_id,
                   mm.status_ligacao, mm.motivo_recusa, mm.eh_substituicao,
                   mm.nome_externo, mm.telefone_externo,
                   ef.nome AS funcao_nome, COALESCE(ef.papel_base, 'Membro') AS papel_base,
                   j.nome_completo AS jovem_nome, j.telefone AS jovem_telefone
            FROM montagem_membros mm
            JOIN equipes_funcoes ef ON ef.id = mm.funcao_id
            LEFT JOIN jovens j ON j.id = mm.jovem_id
            WHERE mm.montagem_id = ? AND mm.equipe_id = ? AND mm.tenant_id = ?
              AND (mm.status_ligacao IS NULL OR mm.status_ligacao <> 'RECUSOU')
            ORDER BY COALESCE(j.nome_completo, mm.nome_externo) ASC
        `, [montagemId, equipeId, tenantId]);

        const titular = rows.filter(r => !r.eh_substituicao);
        const substituicoes = rows.filter(r => r.eh_substituicao === 1);
        return res.json({ titular, substituicoes });
    } catch (err) {
        console.error('Erro ao buscar detalhes da equipe na montagem:', err);
        return res.status(500).json({ error: 'Erro ao buscar detalhes da equipe.' });
    }
});

router.patch('/membro/:membroId/ligacao', async (req, res) => {
    const membroId = Number(req.params.membroId);
    const statusRaw = String(req.body.status_ligacao || '').trim().toUpperCase();
    const status = ['ACEITOU', 'RECUSOU', 'LIGAR_MAIS_TARDE', 'TELEFONE_INCORRETO'].includes(statusRaw) ? statusRaw : null;
    const motivoRecusa = String(req.body.motivo_recusa || '').trim() || null;
    if (!membroId || !status) return res.status(400).json({ error: 'Status inválido.' });
    if (status === 'RECUSOU' && !motivoRecusa) return res.status(400).json({ error: 'Informe o motivo da recusa.' });

    try {
        const tenantId = getTenantId(req);
        await garantirEstruturaMontagemMembrosExtra();
        const [[membro]] = await pool.query(`
            SELECT mm.id, mm.jovem_id, mm.montagem_id, mm.equipe_id, mm.funcao_id,
                   m.numero_ejc, e.nome AS equipe_nome
            FROM montagem_membros mm
            JOIN montagens m ON m.id = mm.montagem_id
            LEFT JOIN equipes e ON e.id = mm.equipe_id
            WHERE mm.id = ? AND mm.tenant_id = ?
            LIMIT 1
        `, [membroId, tenantId]);
        if (!membro) return res.status(404).json({ error: 'Membro não encontrado.' });

        await pool.query(
            'UPDATE montagem_membros SET status_ligacao = ?, motivo_recusa = ? WHERE id = ? AND tenant_id = ?',
            [status, status === 'RECUSOU' ? motivoRecusa : motivoRecusa, membroId, tenantId]
        );

        if (status === 'RECUSOU' && membro.jovem_id) {
            const texto = `Jovem recusou servir no ${membro.numero_ejc}º encontro de montagem. Motivo: ${motivoRecusa}`;
            await pool.query(
                'INSERT INTO jovens_observacoes (tenant_id, jovem_id, texto) VALUES (?, ?, ?)',
                [tenantId, membro.jovem_id, texto]
            );
            if (membro.montagem_id && membro.equipe_id && membro.funcao_id) {
                await removerHistoricoDaAlocacao({
                    montagemId: membro.montagem_id,
                    equipeId: membro.equipe_id,
                    funcaoId: membro.funcao_id,
                    jovemId: membro.jovem_id,
                    tenantId
                });
            }
            if (membro.jovem_id && membro.numero_ejc && membro.equipe_nome) {
                const edicaoMontagem = montarEtiquetaEdicao(membro.numero_ejc);
                const likeMontagem = `${membro.numero_ejc}%EJC (Montagem)%`;
                await pool.query(
                    `DELETE FROM historico_equipes
                     WHERE jovem_id = ?
                       AND tenant_id = ?
                       AND equipe = ?
                       AND (edicao_ejc <=> ? OR edicao_ejc LIKE ?)`,
                    [membro.jovem_id, tenantId, membro.equipe_nome, edicaoMontagem, likeMontagem]
                );
            }
        } else if (status === 'ACEITOU' && membro.jovem_id) {
            if (membro.montagem_id && membro.equipe_id && membro.funcao_id && membro.eh_substituicao === 0) {
                await sincronizarHistoricoDaAlocacao({
                    montagemId: membro.montagem_id,
                    equipeId: membro.equipe_id,
                    funcaoId: membro.funcao_id,
                    jovemId: membro.jovem_id,
                    tenantId
                });
            }
        }

        return res.json({ message: 'Status de ligação atualizado.' });
    } catch (err) {
        console.error('Erro ao atualizar status de ligação:', err);
        return res.status(500).json({ error: 'Erro ao atualizar status de ligação.' });
    }
});

router.get('/:id/ligacoes', async (req, res) => {
    const montagemId = Number(req.params.id);
    if (!montagemId) return res.status(400).json({ error: 'ID inválido.' });
    try {
        const tenantId = getTenantId(req);
        await garantirEstruturaMontagemMembrosExtra();
        const [rows] = await pool.query(`
            SELECT mm.id AS membro_id, mm.equipe_id, e.nome AS equipe_nome,
                   mm.funcao_id, ef.nome AS funcao_nome,
                   mm.jovem_id, j.nome_completo AS jovem_nome, j.telefone AS jovem_telefone,
                   COALESCE(j.origem_ejc_tipo, 'INCONFIDENTES') AS origem_ejc_tipo,
                   j.outro_ejc_numero, j.outro_ejc_id,
                   oe.nome AS outro_ejc_nome, oe.paroquia AS outro_ejc_paroquia,
                   mm.status_ligacao, mm.motivo_recusa, mm.eh_substituicao,
                   mm.nome_externo, mm.telefone_externo
            FROM montagem_membros mm
            JOIN equipes e ON e.id = mm.equipe_id
            JOIN equipes_funcoes ef ON ef.id = mm.funcao_id
            LEFT JOIN jovens j ON j.id = mm.jovem_id
            LEFT JOIN outros_ejcs oe ON oe.id = j.outro_ejc_id
            WHERE mm.montagem_id = ?
              AND mm.tenant_id = ?
              AND mm.eh_substituicao = 0
            ORDER BY e.nome ASC, COALESCE(j.nome_completo, mm.nome_externo) ASC
        `, [montagemId, tenantId]);

        const recusas = [];
        const equipesMap = new Map();
        for (const row of rows) {
            const item = {
                membro_id: row.membro_id,
                equipe_id: row.equipe_id,
                equipe_nome: row.equipe_nome,
                funcao_id: row.funcao_id,
                funcao_nome: row.funcao_nome,
                jovem_id: row.jovem_id,
                jovem_nome: row.jovem_nome,
                jovem_telefone: row.jovem_telefone,
                origem_ejc_tipo: row.origem_ejc_tipo,
                outro_ejc_numero: row.outro_ejc_numero,
                outro_ejc_id: row.outro_ejc_id,
                outro_ejc_nome: row.outro_ejc_nome,
                outro_ejc_paroquia: row.outro_ejc_paroquia,
                nome_externo: row.nome_externo,
                telefone_externo: row.telefone_externo,
                status_ligacao: row.status_ligacao,
                motivo_recusa: row.motivo_recusa,
                eh_substituicao: row.eh_substituicao ? 1 : 0
            };
            if (String(row.status_ligacao || '').toUpperCase() === 'RECUSOU') {
                recusas.push(item);
                continue;
            }
            if (!equipesMap.has(row.equipe_id)) {
                equipesMap.set(row.equipe_id, { id: row.equipe_id, nome: row.equipe_nome, membros: [] });
            }
            equipesMap.get(row.equipe_id).membros.push(item);
        }

        return res.json({ equipes: Array.from(equipesMap.values()), recusas });
    } catch (err) {
        console.error('Erro ao carregar ligações:', err);
        return res.status(500).json({ error: 'Erro ao carregar ligações.' });
    }
});

router.get('/:id/ligacoes/pendentes', async (req, res) => {
    const montagemId = Number(req.params.id);
    if (!montagemId) return res.status(400).json({ error: 'ID inválido.' });
    try {
        const tenantId = getTenantId(req);
        await garantirEstruturaMontagemMembrosExtra();
        const [rows] = await pool.query(
            `SELECT e.nome AS equipe_nome, COUNT(*) AS total
             FROM montagem_membros mm
             JOIN equipes e ON e.id = mm.equipe_id
             WHERE mm.montagem_id = ?
               AND mm.tenant_id = ?
               AND mm.eh_substituicao = 0
               AND (mm.status_ligacao IS NULL OR (mm.status_ligacao <> 'ACEITOU' AND mm.status_ligacao <> 'RECUSOU'))
             GROUP BY e.id, e.nome
             ORDER BY e.nome ASC`,
            [montagemId, tenantId]
        );
        return res.json({ pendentes: rows || [] });
    } catch (err) {
        console.error('Erro ao verificar pendências de ligações:', err);
        return res.status(500).json({ error: 'Erro ao verificar pendências.' });
    }
});

async function finalizarEncontroHandler(req, res) {
    const montagemId = Number(req.params.id);
    if (!montagemId) return res.status(400).json({ error: 'ID inválido.' });
    try {
        await garantirEstruturaMontagemDatas();
        await garantirEstruturaEjcDatasMontagem();
    } catch (err) {
        console.error('Erro ao preparar estrutura do EJC:', err);
        return res.status(500).json({ error: 'Erro ao preparar estrutura do EJC.' });
    }
    const connection = await pool.getConnection();
    try {
        const tenantId = getTenantId(req);
        await connection.beginTransaction();

        const [[montagem]] = await connection.query(
            `SELECT id, numero_ejc, data_encontro, data_tarde_revelacao, data_inicio_reunioes, data_fim_reunioes
             FROM montagens
             WHERE id = ? AND tenant_id = ?
             LIMIT 1`,
            [montagemId, tenantId]
        );
        if (!montagem) {
            await connection.rollback();
            return res.status(404).json({ error: 'Montagem não encontrada.' });
        }

        const [pendentes] = await connection.query(
            `SELECT e.nome AS equipe_nome, COUNT(*) AS total
             FROM montagem_membros mm
             JOIN equipes e ON e.id = mm.equipe_id
             WHERE mm.montagem_id = ?
               AND mm.tenant_id = ?
               AND mm.eh_substituicao = 0
               AND (mm.status_ligacao IS NULL OR (mm.status_ligacao <> 'ACEITOU' AND mm.status_ligacao <> 'RECUSOU'))
             GROUP BY e.id, e.nome`,
            [montagemId, tenantId]
        );
        if (pendentes && pendentes.length) {
            await connection.rollback();
            return res.status(400).json({ error: 'Pendências de ligação.', pendentes });
        }

        let ejcId = null;
        const dataInicioEjc = montagem.data_encontro || null;
        const dataFimEjc = montagem.data_tarde_revelacao || montagem.data_encontro || null;
        const anoBase = montagem.data_encontro ? Number(String(montagem.data_encontro).slice(0, 4)) : new Date().getFullYear();
        const [[ejc]] = await connection.query(
            'SELECT id, ano FROM ejc WHERE tenant_id = ? AND numero = ? LIMIT 1',
            [tenantId, montagem.numero_ejc]
        );
        if (ejc && ejc.id) {
            ejcId = ejc.id;
            const anoFinal = Number.isFinite(anoBase) ? anoBase : (ejc.ano || new Date().getFullYear());
            await connection.query(
                `UPDATE ejc
                 SET ano = ?,
                     data_inicio = ?,
                     data_fim = ?,
                     data_encontro = ?,
                     data_tarde_revelacao = ?,
                     data_inicio_reunioes = ?,
                     data_fim_reunioes = ?
                 WHERE id = ? AND tenant_id = ?`,
                [
                    anoFinal,
                    dataInicioEjc,
                    dataFimEjc,
                    montagem.data_encontro || null,
                    montagem.data_tarde_revelacao || null,
                    montagem.data_inicio_reunioes || null,
                    montagem.data_fim_reunioes || null,
                    ejcId,
                    tenantId
                ]
            );
        } else {
            const [[tenantRow]] = await connection.query(
                'SELECT nome_ejc, paroquia FROM tenants_ejc WHERE id = ? LIMIT 1',
                [tenantId]
            );
            const paroquia = tenantRow && tenantRow.paroquia ? tenantRow.paroquia : null;
            const ano = Number.isFinite(anoBase) ? anoBase : new Date().getFullYear();
            const [ejcRes] = await connection.query(
                `INSERT INTO ejc (tenant_id, numero, paroquia, ano, data_inicio, data_fim, data_encontro, data_tarde_revelacao, data_inicio_reunioes, data_fim_reunioes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    tenantId,
                    montagem.numero_ejc,
                    paroquia,
                    ano,
                    dataInicioEjc,
                    dataFimEjc,
                    montagem.data_encontro || null,
                    montagem.data_tarde_revelacao || null,
                    montagem.data_inicio_reunioes || null,
                    montagem.data_fim_reunioes || null
                ]
            );
            ejcId = ejcRes.insertId;
            await connection.query(
                `INSERT IGNORE INTO equipes_ejc (tenant_id, ejc_id, equipe_id)
                 SELECT ?, ?, id FROM equipes WHERE tenant_id = ?`,
                [tenantId, ejcId, tenantId]
            );
        }

        await connection.query(
            `INSERT IGNORE INTO equipes_ejc (tenant_id, ejc_id, equipe_id)
             SELECT ?, ?, id FROM equipes WHERE tenant_id = ?`,
            [tenantId, ejcId, tenantId]
        );

        const comSubfuncao = await hasSubfuncaoColumn();
        const comPapelBase = await hasPapelBaseColumn();
        const papelBaseSelect = comPapelBase
            ? 'COALESCE(ef.papel_base, "Membro")'
            : '"Membro"';
        const [membros] = await connection.query(
            `SELECT mm.jovem_id, mm.eh_substituicao, mm.status_ligacao,
                    e.nome AS equipe_nome, ef.nome AS funcao_nome, ${papelBaseSelect} AS papel_base
             FROM montagem_membros mm
             JOIN equipes e ON e.id = mm.equipe_id
             JOIN equipes_funcoes ef ON ef.id = mm.funcao_id
             WHERE mm.montagem_id = ?
               AND mm.tenant_id = ?`,
            [montagemId, tenantId]
        );

        const edicaoFinal = `${montagem.numero_ejc}º EJC`;
        const edicaoMontagem = montarEtiquetaEdicao(montagem.numero_ejc);
        const likeMontagem = `${montagem.numero_ejc}%EJC (Montagem)%`;
        if (Array.isArray(membros) && membros.length) {
            for (const membro of membros) {
                if (!membro || !membro.jovem_id) continue;
                if (membro.eh_substituicao) continue;
                if (String(membro.status_ligacao || '').toUpperCase() === 'RECUSOU') continue;
                const papelMapeado = membro.papel_base || mapearPapelPorNomeFuncao(membro.funcao_nome);
                const subfuncao = membro.funcao_nome || null;
                if (comSubfuncao) {
                    const [jaExiste] = await connection.query(
                        `SELECT id
                         FROM historico_equipes
                         WHERE tenant_id = ?
                           AND jovem_id = ?
                           AND equipe = ?
                           AND papel = ?
                           AND (ejc_id = ? OR edicao_ejc = ? OR edicao_ejc LIKE ?)
                           AND (subfuncao <=> ?)
                         LIMIT 1`,
                        [tenantId, membro.jovem_id, membro.equipe_nome, papelMapeado, ejcId, edicaoMontagem, likeMontagem, subfuncao]
                    );
                    if (!jaExiste.length) {
                        await connection.query(
                            `INSERT INTO historico_equipes (tenant_id, jovem_id, edicao_ejc, equipe, papel, subfuncao, ejc_id)
                             VALUES (?, ?, ?, ?, ?, ?, ?)`,
                            [tenantId, membro.jovem_id, edicaoFinal, membro.equipe_nome, papelMapeado, subfuncao, ejcId]
                        );
                    }
                } else {
                    const [jaExiste] = await connection.query(
                        `SELECT id
                         FROM historico_equipes
                         WHERE tenant_id = ?
                           AND jovem_id = ?
                           AND equipe = ?
                           AND papel = ?
                           AND (ejc_id = ? OR edicao_ejc = ? OR edicao_ejc LIKE ?)
                         LIMIT 1`,
                        [tenantId, membro.jovem_id, membro.equipe_nome, papelMapeado, ejcId, edicaoMontagem, likeMontagem]
                    );
                    if (!jaExiste.length) {
                        await connection.query(
                            `INSERT INTO historico_equipes (tenant_id, jovem_id, edicao_ejc, equipe, papel, ejc_id)
                             VALUES (?, ?, ?, ?, ?, ?)`,
                            [tenantId, membro.jovem_id, edicaoFinal, membro.equipe_nome, papelMapeado, ejcId]
                        );
                    }
                }
            }
        }

        await connection.query(
            `UPDATE historico_equipes
             SET ejc_id = ?, edicao_ejc = ?
             WHERE tenant_id = ?
               AND (edicao_ejc = ? OR edicao_ejc LIKE ?)`,
            [ejcId, edicaoFinal, tenantId, montarEtiquetaEdicao(montagem.numero_ejc), likeMontagem]
        );

        await connection.query('DELETE FROM montagem_reunioes_presencas WHERE montagem_id = ?', [montagemId]);
        await connection.query('DELETE FROM montagem_reunioes WHERE montagem_id = ?', [montagemId]);
        await connection.query('DELETE FROM montagem_jovens_servir WHERE montagem_id = ?', [montagemId]).catch(() => {});
        await connection.query('DELETE FROM montagem_tios_servir WHERE montagem_id = ?', [montagemId]).catch(() => {});
        await connection.query('DELETE FROM montagem_membros WHERE montagem_id = ? AND tenant_id = ?', [montagemId, tenantId]);
        await connection.query('DELETE FROM montagens WHERE id = ? AND tenant_id = ?', [montagemId, tenantId]);

        await connection.commit();
        return res.json({ message: 'Encontro finalizado com sucesso.' });
    } catch (err) {
        await connection.rollback();
        console.error('Erro ao finalizar encontro:', err);
        return res.status(500).json({ error: 'Erro ao finalizar encontro.' });
    } finally {
        connection.release();
    }
}

router.post('/:id/finalizar', finalizarEncontroHandler);

router.patch('/membro/:membroId/mover-titular', async (req, res) => {
    const membroId = Number(req.params.membroId);
    const forcar = req.body && req.body.forcar ? 1 : 0;
    if (!membroId) return res.status(400).json({ error: 'ID inválido.' });
    try {
        const tenantId = getTenantId(req);
        await garantirEstruturaMontagemMembrosExtra();
        const [[membro]] = await pool.query(
            `SELECT id, montagem_id, equipe_id, funcao_id, jovem_id
             FROM montagem_membros
             WHERE id = ? AND tenant_id = ?
             LIMIT 1`,
            [membroId, tenantId]
        );
        if (!membro) return res.status(404).json({ error: 'Membro não encontrado.' });

        if (membro.jovem_id) {
            const [[conflito]] = await pool.query(
                `SELECT mm.id, mm.equipe_id, mm.funcao_id, e.nome AS equipe_nome, ef.nome AS funcao_nome
                 FROM montagem_membros mm
                 JOIN equipes e ON e.id = mm.equipe_id
                 LEFT JOIN equipes_funcoes ef ON ef.id = mm.funcao_id
                 WHERE mm.montagem_id = ?
                   AND mm.jovem_id = ?
                   AND mm.eh_substituicao = 0
                   AND mm.id <> ?
                   AND mm.tenant_id = ?
                 LIMIT 1`,
                [membro.montagem_id, membro.jovem_id, membroId, tenantId]
            );
            if (conflito && !forcar) {
                return res.status(409).json({
                    error: `Esse jovem já está na equipe ${conflito.equipe_nome} como função ${conflito.funcao_nome || '-'}. Deseja trocar mesmo assim?`,
                    conflict: conflito
                });
            }
            if (conflito && forcar) {
                await pool.query(
                    'UPDATE montagem_membros SET eh_substituicao = 1 WHERE id = ? AND tenant_id = ?',
                    [conflito.id, tenantId]
                );
                if (membro.montagem_id && membro.jovem_id && conflito) {
                    await removerHistoricoDaAlocacao({
                        montagemId: membro.montagem_id,
                        equipeId: conflito.equipe_id || membro.equipe_id,
                        funcaoId: conflito.funcao_id || membro.funcao_id,
                        jovemId: membro.jovem_id,
                        tenantId
                    });
                }
            }
        }

        const [r] = await pool.query('UPDATE montagem_membros SET eh_substituicao = 0 WHERE id = ? AND tenant_id = ?', [membroId, tenantId]);
        if (!r.affectedRows) return res.status(404).json({ error: 'Membro não encontrado.' });
        if (membro.montagem_id && membro.equipe_id && membro.funcao_id && membro.jovem_id) {
            await sincronizarHistoricoDaAlocacao({
                montagemId: membro.montagem_id,
                equipeId: membro.equipe_id,
                funcaoId: membro.funcao_id,
                jovemId: membro.jovem_id,
                tenantId
            });
        }
        return res.json({ message: 'Membro movido para titular.' });
    } catch (err) {
        console.error('Erro ao mover substituição para titular:', err);
        return res.status(500).json({ error: 'Erro ao mover para titular.' });
    }
});

router.patch('/membro/:membroId/remover-recusa', async (req, res) => {
    const membroId = Number(req.params.membroId);
    if (!membroId) return res.status(400).json({ error: 'ID inválido.' });
    try {
        const tenantId = getTenantId(req);
        await garantirEstruturaMontagemMembrosExtra();
        const [[membro]] = await pool.query(`
            SELECT mm.id, mm.jovem_id, mm.status_ligacao, mm.montagem_id, mm.equipe_id, mm.funcao_id,
                   m.numero_ejc, e.nome AS equipe_nome
            FROM montagem_membros mm
            JOIN montagens m ON m.id = mm.montagem_id
            LEFT JOIN equipes e ON e.id = mm.equipe_id
            WHERE mm.id = ? AND mm.tenant_id = ?
            LIMIT 1
        `, [membroId, tenantId]);
        if (!membro) return res.status(404).json({ error: 'Membro não encontrado.' });
        if (String(membro.status_ligacao || '').toUpperCase() !== 'RECUSOU') {
            return res.status(400).json({ error: 'Este membro não está marcado como recusou.' });
        }

        if (membro.jovem_id && membro.montagem_id && membro.equipe_id && membro.funcao_id) {
            await removerHistoricoDaAlocacao({
                montagemId: membro.montagem_id,
                equipeId: membro.equipe_id,
                funcaoId: membro.funcao_id,
                jovemId: membro.jovem_id,
                tenantId
            });
        }
        if (membro.jovem_id && membro.numero_ejc && membro.equipe_nome) {
            const edicaoMontagem = montarEtiquetaEdicao(membro.numero_ejc);
            await pool.query(
                `DELETE FROM historico_equipes
                 WHERE jovem_id = ?
                   AND tenant_id = ?
                   AND equipe = ?
                   AND (edicao_ejc <=> ?)`,
                [membro.jovem_id, tenantId, membro.equipe_nome, edicaoMontagem]
            );
        }

        await pool.query('DELETE FROM montagem_membros WHERE id = ? AND tenant_id = ?', [membroId, tenantId]);

        if (membro.jovem_id && membro.numero_ejc) {
            const likeTexto = `Jovem recusou servir no ${membro.numero_ejc}º encontro de montagem.%`;
            await pool.query(
                `DELETE FROM jovens_observacoes
                 WHERE jovem_id = ? AND tenant_id = ? AND texto LIKE ?
                 ORDER BY id DESC
                 LIMIT 1`,
                [membro.jovem_id, tenantId, likeTexto]
            );
        }

        return res.json({ message: 'Recusa removida e jovem retirado da equipe.' });
    } catch (err) {
        console.error('Erro ao remover recusa:', err);
        return res.status(500).json({ error: 'Erro ao remover recusa.' });
    }
});

router.get('/:id/powerpoint', async (req, res) => {
    const montagemId = Number(req.params.id);
    if (!montagemId) return res.status(400).json({ error: 'ID inválido.' });
    try {
        const tenantId = getTenantId(req);
        await garantirEstruturaMontagemMembrosExtra();
        const [rows] = await pool.query(`
            SELECT e.nome AS equipe_nome, COALESCE(j.nome_completo, mm.nome_externo) AS nome
            FROM montagem_membros mm
            JOIN equipes e ON e.id = mm.equipe_id
            LEFT JOIN jovens j ON j.id = mm.jovem_id
            WHERE mm.montagem_id = ?
              AND mm.tenant_id = ?
              AND mm.status_ligacao = 'ACEITOU'
              AND COALESCE(j.nome_completo, mm.nome_externo) IS NOT NULL
            ORDER BY e.nome ASC, nome ASC
        `, [montagemId, tenantId]);

        const grupos = new Map();
        for (const row of rows) {
            const equipe = String(row.equipe_nome || 'Sem equipe').trim();
            const nome = String(row.nome || '').trim();
            if (!nome) continue;
            if (!grupos.has(equipe)) grupos.set(equipe, []);
            grupos.get(equipe).push(nome);
        }

        const slides = Array.from(grupos.entries()).map(([equipe, nomes]) => ({
            title: `Equipe: ${equipe}`,
            items: nomes
        }));
        if (slides.length === 0) {
            slides.push({ title: 'Equipe: Sem equipe', items: [] });
        }

        const scriptPath = path.join(__dirname, '..', 'scripts', 'generate_simple_pptx.py');
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-aceitos-'));
        const outPath = path.join(tmpDir, `montagem-${montagemId}-aceitos.pptx`);
        const py = spawnSync('python3', [scriptPath, outPath], {
            input: JSON.stringify({ slides }),
            encoding: null,
            maxBuffer: 20 * 1024 * 1024
        });

        let arquivoBytes = null;
        if (py.status === 0) {
            try {
                arquivoBytes = fs.readFileSync(outPath);
            } catch (_) {
                arquivoBytes = null;
            }
        }
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (_) {}

        if (py.status !== 0 || !arquivoBytes || !arquivoBytes.length) {
            const stderr = py.stderr ? py.stderr.toString('utf8') : '';
            console.error('Erro ao gerar PPTX via Python:', stderr || `status=${py.status}`);
            return res.status(500).json({ error: 'Erro ao gerar arquivo PowerPoint (.pptx).' });
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
        res.setHeader('Content-Disposition', `attachment; filename="montagem-${montagemId}-aceitos.pptx"`);
        return res.send(arquivoBytes);
    } catch (err) {
        console.error('Erro ao gerar lista para PowerPoint:', err);
        return res.status(500).json({ error: 'Erro ao gerar arquivo.' });
    }
});

// Remover jovem da função
router.delete('/membro/:membroId', async (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const [[dadosMembro]] = await pool.query(`
            SELECT mm.id, mm.jovem_id, mm.equipe_id, mm.funcao_id, m.numero_ejc, e.nome AS equipe_nome,
                   ef.nome AS funcao_nome, COALESCE(ef.papel_base, 'Membro') AS papel_base
            FROM montagem_membros mm
            JOIN montagens m ON m.id = mm.montagem_id
            JOIN equipes e ON e.id = mm.equipe_id
            JOIN equipes_funcoes ef ON ef.id = mm.funcao_id
            WHERE mm.id = ? AND mm.tenant_id = ?
            LIMIT 1
        `, [req.params.membroId, tenantId]);

        if (!dadosMembro) {
            return res.status(404).json({ error: "Membro não encontrado na montagem." });
        }

        await pool.query('DELETE FROM montagem_membros WHERE id = ? AND tenant_id = ?', [req.params.membroId, tenantId]);

        const comSubfuncao = await hasSubfuncaoColumn();
        const edicaoMontagem = montarEtiquetaEdicao(dadosMembro.numero_ejc);
        const papelMapeado = dadosMembro.papel_base || mapearPapelPorNomeFuncao(dadosMembro.funcao_nome);
        if (comSubfuncao) {
            await pool.query(
                `DELETE FROM historico_equipes
                 WHERE jovem_id = ?
                   AND equipe = ?
                   AND papel = ?
                   AND (subfuncao <=> ?)
                   AND (edicao_ejc <=> ?)
                 ORDER BY id DESC
                 LIMIT 1`,
                [dadosMembro.jovem_id, dadosMembro.equipe_nome, papelMapeado, dadosMembro.funcao_nome || null, edicaoMontagem]
            );
        } else {
            await pool.query(
                `DELETE FROM historico_equipes
                 WHERE jovem_id = ?
                  AND equipe = ?
                  AND papel = ?
                  AND (edicao_ejc <=> ?)
                 ORDER BY id DESC
                 LIMIT 1`,
                [dadosMembro.jovem_id, dadosMembro.equipe_nome, papelMapeado, edicaoMontagem]
            );
        }
        if (dadosMembro.jovem_id && dadosMembro.equipe_nome) {
            await pool.query(
                `DELETE FROM historico_equipes
                 WHERE jovem_id = ?
                   AND tenant_id = ?
                   AND equipe = ?
                   AND (edicao_ejc <=> ?)`,
                [dadosMembro.jovem_id, tenantId, dadosMembro.equipe_nome, edicaoMontagem]
            );
        }

        res.json({ message: "Jovem removido com sucesso" });
    } catch (err) {
        console.error("Erro ao remover membro:", err);
        res.status(500).json({ error: "Erro ao remover jovem" });
    }
});

router.finalizarEncontroHandler = finalizarEncontroHandler;
module.exports = router;
