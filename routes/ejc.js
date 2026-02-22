const express = require('express');
const router = express.Router();
const { pool, registrarLog } = require('../database');

// GET - Listar todos os EJCs
router.get('/', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM ejc ORDER BY numero DESC'
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
        const [rows] = await pool.query(
            'SELECT * FROM ejc WHERE id = ?',
            [req.params.id]
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
        const [rows] = await pool.query(
            'SELECT id, nome_completo, circulo, telefone FROM jovens WHERE numero_ejc_fez = ? ORDER BY nome_completo ASC',
            [req.params.id]
        );
        res.json(rows);
    } catch (err) {
        console.error("Erro ao buscar encontristas:", err);
        res.status(500).json({ error: "Erro ao buscar encontristas" });
    }
});

// POST - Criar novo EJC
router.post('/', async (req, res) => {
    const { numero, paroquia, ano, data_inicio, data_fim, descricao } = req.body;

    // Validação
    if (!numero || !paroquia) {
        return res.status(400).json({ error: "Número e Paróquia são obrigatórios" });
    }

    try {
        const [result] = await pool.query(
            'INSERT INTO ejc (numero, paroquia, ano, data_inicio, data_fim, descricao) VALUES (?, ?, ?, ?, ?, ?)',
            [numero, paroquia, ano || new Date().getFullYear(), data_inicio || null, data_fim || null, descricao || null]
        );

        // Ao criar um novo EJC, vincula automaticamente todas as equipes já cadastradas.
        await pool.query(
            `INSERT IGNORE INTO equipes_ejc (ejc_id, equipe_id)
             SELECT ?, id FROM equipes`,
            [result.insertId]
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
    const { numero, paroquia, ano, data_inicio, data_fim, descricao } = req.body;

    if (!numero || !paroquia) {
        return res.status(400).json({ error: "Número e Paróquia são obrigatórios" });
    }

    try {
        const [result] = await pool.query(
            'UPDATE ejc SET numero=?, paroquia=?, ano=?, data_inicio=?, data_fim=?, descricao=? WHERE id=?',
            [numero, paroquia, ano, data_inicio || null, data_fim || null, descricao || null, req.params.id]
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
        // Verificar se há jovens vinculados
        const [jovens] = await pool.query(
            'SELECT COUNT(*) as count FROM jovens WHERE numero_ejc_fez = ?',
            [req.params.id]
        );

        if (jovens[0].count > 0) {
            return res.status(400).json({
                error: "Não é possível deletar este EJC. Há jovens vinculados."
            });
        }

        const [result] = await pool.query(
            'DELETE FROM ejc WHERE id = ?',
            [req.params.id]
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
