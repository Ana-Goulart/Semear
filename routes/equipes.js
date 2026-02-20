const express = require('express');
const router = express.Router();
const { pool } = require('../database');

// GET - Listar todas as equipes
router.get('/', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM equipes ORDER BY nome ASC');
        res.json(rows);
    } catch (err) {
        console.error("Erro ao buscar todas as equipes:", err);
        res.status(500).json({ error: "Erro no servidor" });
    }
});

// GET - Equipes por EJC (para dropdowns ou filtro no frontend)
router.get('/por-ejc/:ejcId', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT DISTINCT eq.id, eq.nome, eq.descricao 
            FROM equipes eq 
            JOIN equipes_ejc ee ON eq.id = ee.equipe_id 
            WHERE ee.ejc_id = ?
            ORDER BY eq.nome ASC
        `, [req.params.ejcId]);
        res.json(rows);
    } catch (err) {
        console.error("Erro ao buscar equipes:", err);
        res.status(500).json({ error: "Erro no servidor" });
    }
});

// POST - Criar equipe
router.post('/', async (req, res) => {
    const { nome, descricao, ejc_id } = req.body;

    if (!nome) {
        return res.status(400).json({ error: "Nome da equipe é obrigatório" });
    }

    try {
        const [checkEquipe] = await pool.query(
            'SELECT id FROM equipes WHERE nome = ?',
            [nome]
        );

        let equipeId;
        if (checkEquipe.length > 0) {
            equipeId = checkEquipe[0].id;
        } else {
            const [createResult] = await pool.query(
                'INSERT INTO equipes (nome, descricao) VALUES (?, ?)',
                [nome, descricao || null]
            );
            equipeId = createResult.insertId;
        }

        if (ejc_id) {
            const [checkVinculo] = await pool.query(
                'SELECT id FROM equipes_ejc WHERE ejc_id = ? AND equipe_id = ?',
                [ejc_id, equipeId]
            );

            if (checkVinculo.length === 0) {
                await pool.query(
                    'INSERT INTO equipes_ejc (ejc_id, equipe_id) VALUES (?, ?)',
                    [ejc_id, equipeId]
                );
            }
        }

        res.json({ id: equipeId, message: "Equipe criada/vinculada com sucesso" });
    } catch (err) {
        console.error("Erro ao criar equipe:", err);
        res.status(500).json({ error: "Erro ao criar equipe" });
    }
});

// PUT - Atualizar equipe
router.put('/:id', async (req, res) => {
    const { nome, descricao } = req.body;
    const { id } = req.params;

    if (!nome) {
        return res.status(400).json({ error: "Nome da equipe é obrigatório" });
    }

    try {
        const [result] = await pool.query(
            'UPDATE equipes SET nome = ?, descricao = ? WHERE id = ?',
            [nome, descricao || null, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Equipe não encontrada" });
        }

        res.json({ message: "Equipe atualizada com sucesso" });
    } catch (err) {
        console.error("Erro ao atualizar equipe:", err);
        res.status(500).json({ error: "Erro ao atualizar equipe" });
    }
});

// DELETE - Remover vínculo com EJC
router.delete('/vinculo/:ejcId/:equipeId', async (req, res) => {
    const { ejcId, equipeId } = req.params;
    try {
        const [result] = await pool.query(
            'DELETE FROM equipes_ejc WHERE ejc_id = ? AND equipe_id = ?',
            [ejcId, equipeId]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Vínculo não encontrado" });
        }
        res.json({ message: "Equipe removida do EJC com sucesso" });
    } catch (err) {
        console.error("Erro ao remover equipe:", err);
        res.status(500).json({ error: "Erro ao remover equipe" });
    }
});

module.exports = router;
