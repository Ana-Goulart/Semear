const express = require('express');
const router = express.Router();
const { pool } = require('../database');

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
        const [equipeRows] = await pool.query('SELECT nome FROM equipes WHERE id = ?', [req.params.equipeId]);
        if (equipeRows.length === 0) {
            return res.status(404).json({ error: "Equipe não encontrada" });
        }
        const nomeEquipe = equipeRows[0].nome;

        const comSubfuncao = await hasSubfuncaoColumn();
        const subfuncaoSelect = comSubfuncao ? 'he.subfuncao' : 'NULL as subfuncao';
        const [rows] = await pool.query(`
            SELECT DISTINCT j.id, j.nome_completo, j.telefone, he.papel, ${subfuncaoSelect}
            FROM jovens j
            JOIN historico_equipes he ON j.id = he.jovem_id
            WHERE he.equipe = ? AND he.ejc_id = ?
            ORDER BY j.nome_completo ASC
        `, [nomeEquipe, req.params.ejcId]);
        res.json(rows);
    } catch (err) {
        console.error("Erro ao buscar jovens da equipe:", err);
        res.status(500).json({ error: "Erro no servidor" });
    }
});

module.exports = router;
