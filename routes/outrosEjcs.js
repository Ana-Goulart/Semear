const express = require('express');
const router = express.Router();
const db = require('../database');

// GET /api/outros-ejcs
router.get('/', async (req, res) => {
    try {
        const [rows] = await db.pool.query('SELECT * FROM outros_ejcs ORDER BY created_at DESC');
        res.json(rows);
    } catch (error) {
        console.error("Erro ao listar outros EJCs:", error);
        res.status(500).json({ error: 'Erro ao listar outros EJCs' });
    }
});

// POST /api/outros-ejcs
router.post('/', async (req, res) => {
    const { nome, paroquia, bairro } = req.body;
    try {
        if (!nome) {
            return res.status(400).json({ error: 'O nome do EJC é obrigatório.' });
        }
        const [result] = await db.pool.query(
            'INSERT INTO outros_ejcs (nome, paroquia, bairro) VALUES (?, ?, ?)',
            [nome, paroquia || null, bairro || null]
        );
        res.status(201).json({ message: 'Outro EJC criado com sucesso!', id: result.insertId });
    } catch (error) {
        console.error("Erro ao criar outro EJC:", error);
        res.status(500).json({ error: 'Erro ao criar outro EJC' });
    }
});

// PUT /api/outros-ejcs/:id
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { nome, paroquia, bairro } = req.body;
    try {
        if (!nome) {
            return res.status(400).json({ error: 'O nome do EJC é obrigatório.' });
        }
        const [result] = await db.pool.query(
            'UPDATE outros_ejcs SET nome = ?, paroquia = ?, bairro = ? WHERE id = ?',
            [nome, paroquia || null, bairro || null, id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Outro EJC não encontrado.' });
        }
        res.json({ message: 'Outro EJC atualizado com sucesso!' });
    } catch (error) {
        console.error("Erro ao atualizar outro EJC:", error);
        res.status(500).json({ error: 'Erro ao atualizar outro EJC' });
    }
});

// DELETE /api/outros-ejcs/:id
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await db.pool.query('DELETE FROM outros_ejcs WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Outro EJC não encontrado.' });
        }
        res.json({ message: 'Outro EJC excluído com sucesso!' });
    } catch (error) {
        console.error("Erro ao excluir outro EJC:", error);
        res.status(500).json({ error: 'Erro ao excluir outro EJC' });
    }
});

module.exports = router;
