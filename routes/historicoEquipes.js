const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const { getTenantId } = require('../lib/tenantIsolation');

let hasSubfuncaoColumnCache = null;
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

// GET - Jovens de uma equipe em um EJC específico
router.get('/:equipeId/jovens/:ejcId', async (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const [equipeRows] = await pool.query(
            'SELECT nome FROM equipes WHERE id = ? AND tenant_id = ?',
            [req.params.equipeId, tenantId]
        );
        if (equipeRows.length === 0) {
            return res.status(404).json({ error: "Equipe não encontrada" });
        }
        const nomeEquipe = equipeRows[0].nome;

        const comSubfuncao = await hasSubfuncaoColumn();
        const subfuncaoSelect = comSubfuncao ? 'he.subfuncao' : 'NULL as subfuncao';
        const [jovensRows] = await pool.query(`
            SELECT DISTINCT j.id, j.nome_completo, j.telefone, he.papel, ${subfuncaoSelect}
            FROM jovens j
            JOIN historico_equipes he ON j.id = he.jovem_id
            WHERE j.tenant_id = ?
              AND he.tenant_id = ?
              AND he.equipe = ?
              AND he.ejc_id = ?
            ORDER BY j.nome_completo ASC
        `, [tenantId, tenantId, nomeEquipe, req.params.ejcId]);

        const [tiosRows] = await pool.query(`
            SELECT DISTINCT
                CONCAT('tio-', c.id) AS id,
                CONCAT(COALESCE(c.nome_tio, ''), ' e ', COALESCE(c.nome_tia, '')) AS nome_completo,
                CONCAT(COALESCE(c.telefone_tio, '-'), ' / ', COALESCE(c.telefone_tia, '-')) AS telefone,
                'Tios' AS papel,
                NULL AS subfuncao
            FROM tios_casal_servicos ts
            JOIN tios_casais c
              ON c.id = ts.casal_id
             AND c.tenant_id = ts.tenant_id
            WHERE ts.tenant_id = ?
              AND ts.equipe_id = ?
              AND ts.ejc_id = ?
            ORDER BY nome_completo ASC
        `, [tenantId, req.params.equipeId, req.params.ejcId]);

        const rows = [...(jovensRows || []), ...(tiosRows || [])]
            .sort((a, b) => String(a.nome_completo || '').localeCompare(String(b.nome_completo || ''), 'pt-BR'));
        res.json(rows);
    } catch (err) {
        console.error("Erro ao buscar jovens da equipe:", err);
        res.status(500).json({ error: "Erro no servidor" });
    }
});

module.exports = router;
