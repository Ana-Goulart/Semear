const express = require('express');
const router = express.Router();
const { pool } = require('../database');

let estruturaGarantida = false;

async function garantirEstrutura() {
    if (estruturaGarantida) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS funcoes_dirigencia (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(160) NOT NULL UNIQUE,
            descricao TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS funcoes_dirigencia_usuarios (
            id INT AUTO_INCREMENT PRIMARY KEY,
            funcao_id INT NOT NULL,
            usuario_id INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_funcao_usuario (funcao_id, usuario_id),
            CONSTRAINT fk_fd_usuario_funcao FOREIGN KEY (funcao_id) REFERENCES funcoes_dirigencia(id) ON DELETE CASCADE,
            CONSTRAINT fk_fd_usuario_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
        )
    `);

    estruturaGarantida = true;
}

function toIntArray(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(v => Number(v)).filter(v => Number.isInteger(v) && v > 0))];
}

router.get('/', async (req, res) => {
    try {
        await garantirEstrutura();
        const [funcoes] = await pool.query(`
            SELECT id, nome, descricao, created_at
            FROM funcoes_dirigencia
            ORDER BY nome ASC
        `);

        if (!funcoes.length) return res.json([]);

        const ids = funcoes.map(f => f.id);
        const [vinculos] = await pool.query(`
            SELECT fdu.funcao_id, fdu.usuario_id, u.nome_completo, u.username, u.grupo
            FROM funcoes_dirigencia_usuarios fdu
            JOIN usuarios u ON u.id = fdu.usuario_id
            WHERE fdu.funcao_id IN (?)
            ORDER BY u.nome_completo ASC
        `, [ids]);

        const usuariosPorFuncao = {};
        vinculos.forEach(v => {
            if (!usuariosPorFuncao[v.funcao_id]) usuariosPorFuncao[v.funcao_id] = [];
            usuariosPorFuncao[v.funcao_id].push(v);
        });

        const result = funcoes.map(f => ({
            ...f,
            usuarios: usuariosPorFuncao[f.id] || []
        }));
        res.json(result);
    } catch (err) {
        console.error('Erro ao listar funções da dirigência:', err);
        res.status(500).json({ error: 'Erro ao listar funções da dirigência' });
    }
});

router.post('/', async (req, res) => {
    const nome = String(req.body.nome || '').trim();
    const descricao = String(req.body.descricao || '').trim() || null;
    const usuarios = toIntArray(req.body.usuarios);

    if (!nome) return res.status(400).json({ error: 'Nome da função é obrigatório.' });
    if (!usuarios.length) return res.status(400).json({ error: 'Selecione ao menos um usuário.' });

    const connection = await pool.getConnection();
    try {
        await garantirEstrutura();
        await connection.beginTransaction();

        const [exists] = await connection.query(
            `SELECT id FROM funcoes_dirigencia WHERE LOWER(nome) = LOWER(?) LIMIT 1`,
            [nome]
        );
        if (exists.length) {
            await connection.rollback();
            return res.status(409).json({ error: 'Já existe uma função com esse nome.' });
        }

        const [result] = await connection.query(
            `INSERT INTO funcoes_dirigencia (nome, descricao) VALUES (?, ?)`,
            [nome, descricao]
        );
        const funcaoId = result.insertId;

        for (const usuarioId of usuarios) {
            await connection.query(
                `INSERT INTO funcoes_dirigencia_usuarios (funcao_id, usuario_id) VALUES (?, ?)`,
                [funcaoId, usuarioId]
            );
        }

        await connection.commit();
        res.status(201).json({ id: funcaoId, message: 'Função criada com sucesso.' });
    } catch (err) {
        await connection.rollback();
        console.error('Erro ao criar função da dirigência:', err);
        res.status(500).json({ error: 'Erro ao criar função da dirigência' });
    } finally {
        connection.release();
    }
});

router.put('/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const nome = String(req.body.nome || '').trim();
    const descricao = String(req.body.descricao || '').trim() || null;
    const usuarios = toIntArray(req.body.usuarios);

    if (!nome) return res.status(400).json({ error: 'Nome da função é obrigatório.' });
    if (!usuarios.length) return res.status(400).json({ error: 'Selecione ao menos um usuário.' });

    const connection = await pool.getConnection();
    try {
        await garantirEstrutura();
        await connection.beginTransaction();

        const [exists] = await connection.query(
            `SELECT id FROM funcoes_dirigencia WHERE LOWER(nome) = LOWER(?) AND id <> ? LIMIT 1`,
            [nome, id]
        );
        if (exists.length) {
            await connection.rollback();
            return res.status(409).json({ error: 'Já existe uma função com esse nome.' });
        }

        const [resultUpdate] = await connection.query(
            `UPDATE funcoes_dirigencia SET nome = ?, descricao = ? WHERE id = ?`,
            [nome, descricao, id]
        );
        if (!resultUpdate.affectedRows) {
            await connection.rollback();
            return res.status(404).json({ error: 'Função não encontrada.' });
        }

        await connection.query(`DELETE FROM funcoes_dirigencia_usuarios WHERE funcao_id = ?`, [id]);
        for (const usuarioId of usuarios) {
            await connection.query(
                `INSERT INTO funcoes_dirigencia_usuarios (funcao_id, usuario_id) VALUES (?, ?)`,
                [id, usuarioId]
            );
        }

        await connection.commit();
        res.json({ message: 'Função atualizada com sucesso.' });
    } catch (err) {
        await connection.rollback();
        console.error('Erro ao atualizar função da dirigência:', err);
        res.status(500).json({ error: 'Erro ao atualizar função da dirigência' });
    } finally {
        connection.release();
    }
});

router.delete('/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    try {
        await garantirEstrutura();
        const [result] = await pool.query(`DELETE FROM funcoes_dirigencia WHERE id = ?`, [id]);
        if (!result.affectedRows) return res.status(404).json({ error: 'Função não encontrada.' });
        res.json({ message: 'Função removida com sucesso.' });
    } catch (err) {
        console.error('Erro ao remover função da dirigência:', err);
        res.status(500).json({ error: 'Erro ao remover função da dirigência' });
    }
});

module.exports = router;
