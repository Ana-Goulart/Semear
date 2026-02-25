const express = require('express');
const router = express.Router();
const { pool, registrarLog } = require('../database');
const { getTenantId } = require('../lib/tenantIsolation');

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

async function garantirEstruturaEjcMusicaTema() {
    await runAlterIgnoreDuplicate("ALTER TABLE ejc ADD COLUMN musica_tema VARCHAR(180) NULL AFTER descricao");
}

// GET - Listar todos os EJCs
router.get('/', async (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const [rows] = await pool.query(
            'SELECT * FROM ejc WHERE tenant_id = ? ORDER BY numero DESC',
            [tenantId]
        );
        res.json(rows);
    } catch (err) {
        console.error("Erro ao buscar EJCs:", err);
        res.status(500).json({ error: "Erro ao buscar EJCs" });
    }
});

// GET - Buscar um EJC específico
router.get('/:id', async (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const [rows] = await pool.query(
            'SELECT * FROM ejc WHERE id = ? AND tenant_id = ?',
            [req.params.id, tenantId]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: "EJC não encontrado" });
        }
        res.json(rows[0]);
    } catch (err) {
        console.error("Erro ao buscar EJC:", err);
        res.status(500).json({ error: "Erro ao buscar EJC" });
    }
});

// GET - Buscar encontristas de um EJC específico
router.get('/:id/encontristas', async (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const comOrigem = await hasColumn('jovens', 'origem_ejc_tipo');
        const comFoiMoita = await hasColumn('jovens', 'ja_foi_moita_inconfidentes');
        const comMoitaEjc = await hasColumn('jovens', 'moita_ejc_id');
        const comMoitaFuncao = await hasColumn('jovens', 'moita_funcao');

        const usarRegraMoita = comOrigem && comFoiMoita && comMoitaEjc;
        const selectFoiMoita = usarRegraMoita
            ? "CASE WHEN (j.origem_ejc_tipo = 'OUTRO_EJC' AND j.ja_foi_moita_inconfidentes = 1 AND j.moita_ejc_id = ?) THEN 1 ELSE 0 END AS foi_moita"
            : "0 AS foi_moita";
        const selectMoitaFuncao = usarRegraMoita && comMoitaFuncao
            ? "CASE WHEN (j.origem_ejc_tipo = 'OUTRO_EJC' AND j.ja_foi_moita_inconfidentes = 1 AND j.moita_ejc_id = ?) THEN j.moita_funcao ELSE NULL END AS moita_funcao"
            : "NULL AS moita_funcao";

        const sql = usarRegraMoita
            ? `SELECT DISTINCT j.id, j.nome_completo, j.circulo, j.telefone,
                      ${selectFoiMoita},
                      ${selectMoitaFuncao}
               FROM jovens j
               WHERE j.tenant_id = ?
                 AND (j.numero_ejc_fez = ?
                  OR (j.origem_ejc_tipo = 'OUTRO_EJC' AND j.ja_foi_moita_inconfidentes = 1 AND j.moita_ejc_id = ?))
               ORDER BY nome_completo ASC`
            : `SELECT j.id, j.nome_completo, j.circulo, j.telefone,
                      ${selectFoiMoita},
                      ${selectMoitaFuncao}
               FROM jovens j
               WHERE j.tenant_id = ?
                 AND j.numero_ejc_fez = ?
               ORDER BY nome_completo ASC`;
        const params = usarRegraMoita
            ? [req.params.id, req.params.id, tenantId, req.params.id, req.params.id]
            : [tenantId, req.params.id];
        const [rows] = await pool.query(sql, params);
        res.json(rows);
    } catch (err) {
        console.error("Erro ao buscar encontristas:", err);
        res.status(500).json({ error: "Erro ao buscar encontristas" });
    }
});

// POST - Criar novo EJC
router.post('/', async (req, res) => {
    const { numero, paroquia, ano, data_inicio, data_fim, data_encontro, data_tarde_revelacao, data_inicio_reunioes, data_fim_reunioes, descricao, musica_tema } = req.body;

    // Validação
    if (!numero || !paroquia) {
        return res.status(400).json({ error: "Número e Paróquia são obrigatórios" });
    }

    try {
        const tenantId = getTenantId(req);
        await garantirEstruturaEjcDatasMontagem();
        await garantirEstruturaEjcMusicaTema();
        const [result] = await pool.query(
            `INSERT INTO ejc (tenant_id, numero, paroquia, ano, data_inicio, data_fim, data_encontro, data_tarde_revelacao, data_inicio_reunioes, data_fim_reunioes, descricao, musica_tema)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                tenantId,
                numero,
                paroquia,
                ano || new Date().getFullYear(),
                data_inicio || null,
                data_fim || null,
                data_encontro || null,
                data_tarde_revelacao || null,
                data_inicio_reunioes || null,
                data_fim_reunioes || null,
                descricao || null,
                musica_tema || null
            ]
        );

        // Ao criar um novo EJC, vincula automaticamente todas as equipes já cadastradas.
        await pool.query(
            `INSERT IGNORE INTO equipes_ejc (ejc_id, equipe_id)
             SELECT ?, id FROM equipes WHERE tenant_id = ?`,
            [result.insertId, tenantId]
        );

        await registrarLog('sistema', 'CREATE', `EJC ${numero} criado`);

        res.status(201).json({
            message: "EJC criado com sucesso",
            id: result.insertId
        });
    } catch (err) {
        console.error("Erro ao criar EJC:", err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: "Este número de EJC já existe" });
        }
        res.status(500).json({ error: "Erro ao criar EJC" });
    }
});

// PUT - Editar EJC
router.put('/:id', async (req, res) => {
    const { numero, paroquia, ano, data_inicio, data_fim, data_encontro, data_tarde_revelacao, data_inicio_reunioes, data_fim_reunioes, descricao, musica_tema } = req.body;

    if (!numero || !paroquia) {
        return res.status(400).json({ error: "Número e Paróquia são obrigatórios" });
    }

    try {
        const tenantId = getTenantId(req);
        await garantirEstruturaEjcDatasMontagem();
        await garantirEstruturaEjcMusicaTema();
        const [result] = await pool.query(
            `UPDATE ejc
             SET numero=?,
                 paroquia=?,
                 ano=?,
                 data_inicio=?,
                 data_fim=?,
                 data_encontro=?,
                 data_tarde_revelacao=?,
                 data_inicio_reunioes=?,
                 data_fim_reunioes=?,
                 descricao=?,
                 musica_tema=?
             WHERE id=? AND tenant_id = ?`,
            [
                numero,
                paroquia,
                ano,
                data_inicio || null,
                data_fim || null,
                data_encontro || null,
                data_tarde_revelacao || null,
                data_inicio_reunioes || null,
                data_fim_reunioes || null,
                descricao || null,
                musica_tema || null,
                req.params.id,
                tenantId
            ]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "EJC não encontrado" });
        }

        await registrarLog('sistema', 'UPDATE', `EJC ${numero} atualizado`);

        res.json({ message: "EJC atualizado com sucesso" });
    } catch (err) {
        console.error("Erro ao atualizar EJC:", err);
        res.status(500).json({ error: "Erro ao atualizar EJC" });
    }
});

// DELETE - Deletar EJC
router.delete('/:id', async (req, res) => {
    try {
        const tenantId = getTenantId(req);
        // Verificar se há jovens vinculados
        const [jovens] = await pool.query(
            'SELECT COUNT(*) as count FROM jovens WHERE numero_ejc_fez = ? AND tenant_id = ?',
            [req.params.id, tenantId]
        );

        if (jovens[0].count > 0) {
            return res.status(400).json({
                error: "Não é possível deletar este EJC. Há jovens vinculados."
            });
        }

        const [result] = await pool.query(
            'DELETE FROM ejc WHERE id = ? AND tenant_id = ?',
            [req.params.id, tenantId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "EJC não encontrado" });
        }

        await registrarLog('sistema', 'DELETE', `EJC deletado`);

        res.json({ message: "EJC deletado com sucesso" });
    } catch (err) {
        console.error("Erro ao deletar EJC:", err);
        res.status(500).json({ error: "Erro ao deletar EJC" });
    }
});

module.exports = router;
