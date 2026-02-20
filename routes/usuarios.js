const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const crypto = require('crypto');

// Helper para hash de senha (simples SHA-256)
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Listar Usuários
router.get('/', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, username, nome_completo, data_entrada, data_saida, grupo, jovem_id FROM usuarios ORDER BY nome_completo');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro ao listar usuários" });
    }
});

// Criar Usuário
router.post('/', async (req, res) => {
    let { username, nome_completo, senha, data_entrada, data_saida, grupo, jovem_id } = req.body;

    // Se jovem_id for fornecido, buscamos o nome do jovem para garantir consistência
    if (jovem_id) {
        try {
            const [jovensRes] = await pool.query('SELECT nome_completo FROM jovens WHERE id = ?', [jovem_id]);
            if (jovensRes.length > 0) {
                nome_completo = jovensRes[0].nome_completo;
            } else {
                return res.status(400).json({ error: "Jovem não encontrado" });
            }
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: "Erro ao buscar jovem" });
        }
    }

    if (!username || !nome_completo || !senha || !grupo) {
        return res.status(400).json({ error: "Campos obrigatórios faltando" });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const hashedPassword = hashPassword(senha);
        const [result] = await connection.query(
            'INSERT INTO usuarios (username, nome_completo, senha, data_entrada, data_saida, grupo, jovem_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [username, nome_completo, hashedPassword, data_entrada || null, data_saida || null, grupo, jovem_id || null]
        );

        // Se vinculado a um jovem, marcar como dirigente
        if (jovem_id) {
            await connection.query('UPDATE jovens SET dirigente = 1 WHERE id = ?', [jovem_id]);
        }

        await connection.commit();
        res.json({ id: result.insertId, message: "Usuário criado com sucesso" });
    } catch (err) {
        await connection.rollback();
        console.error(err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: "Nome de usuário já existe" });
        }
        res.status(500).json({ error: "Erro ao criar usuário" });
    } finally {
        connection.release();
    }
});

// Atualizar Usuário
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { username, nome_completo, senha, data_entrada, data_saida, grupo } = req.body;

    if (!username || !nome_completo || !grupo) {
        return res.status(400).json({ error: "Campos obrigatórios faltando" });
    }

    try {
        let query = 'UPDATE usuarios SET username=?, nome_completo=?, data_entrada=?, data_saida=?, grupo=?';
        let params = [username, nome_completo, data_entrada || null, data_saida || null, grupo];

        if (senha) {
            query += ', senha=?';
            params.push(hashPassword(senha));
        }

        query += ' WHERE id=?';
        params.push(id);

        await pool.query(query, params);
        res.json({ message: "Usuário atualizado com sucesso" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro ao atualizar usuário" });
    }
});

// Deletar Usuário
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM usuarios WHERE id = ?', [id]);
        res.json({ message: "Usuário deletado" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro ao deletar usuário" });
    }
});

module.exports = router;
