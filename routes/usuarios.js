const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const crypto = require('crypto');

let estruturaFuncoesGarantida = false;

async function garantirEstruturaFuncoes() {
    if (estruturaFuncoesGarantida) return;
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
    estruturaFuncoesGarantida = true;
}

function normalizarFuncoesIds(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(v => Number(v)).filter(v => Number.isInteger(v) && v > 0))];
}

async function syncFuncoesUsuario(connection, usuarioId, funcoesIds) {
    await connection.query('DELETE FROM funcoes_dirigencia_usuarios WHERE usuario_id = ?', [usuarioId]);
    for (const funcaoId of funcoesIds) {
        await connection.query(
            'INSERT INTO funcoes_dirigencia_usuarios (funcao_id, usuario_id) VALUES (?, ?)',
            [funcaoId, usuarioId]
        );
    }
}

// Helper para hash de senha (simples SHA-256)
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Listar Usuários
router.get('/', async (req, res) => {
    try {
        await garantirEstruturaFuncoes();
        const [rows] = await pool.query(`
            SELECT 
                u.id, u.username, u.nome_completo, u.data_entrada, u.data_saida, u.grupo, u.jovem_id,
                GROUP_CONCAT(fdu.funcao_id ORDER BY fdu.funcao_id) AS funcoes_ids
            FROM usuarios u
            LEFT JOIN funcoes_dirigencia_usuarios fdu ON fdu.usuario_id = u.id
            GROUP BY u.id, u.username, u.nome_completo, u.data_entrada, u.data_saida, u.grupo, u.jovem_id
            ORDER BY u.nome_completo
        `);
        const result = rows.map(r => ({
            ...r,
            funcoes_dirigencia_ids: r.funcoes_ids ? String(r.funcoes_ids).split(',').map(v => Number(v)).filter(Boolean) : []
        }));
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro ao listar usuários" });
    }
});

// Criar Usuário
router.post('/', async (req, res) => {
    let { username, nome_completo, senha, data_entrada, data_saida, grupo, jovem_id } = req.body;
    const funcoesIds = normalizarFuncoesIds(req.body.funcoes_dirigencia_ids);

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
        await garantirEstruturaFuncoes();
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

        await syncFuncoesUsuario(connection, result.insertId, funcoesIds);

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
    const funcoesIds = normalizarFuncoesIds(req.body.funcoes_dirigencia_ids);
    const atualizarFuncoes = Array.isArray(req.body.funcoes_dirigencia_ids);

    if (!username || !nome_completo || !grupo) {
        return res.status(400).json({ error: "Campos obrigatórios faltando" });
    }

    const connection = await pool.getConnection();
    try {
        await garantirEstruturaFuncoes();
        await connection.beginTransaction();

        let query = 'UPDATE usuarios SET username=?, nome_completo=?, data_entrada=?, data_saida=?, grupo=?';
        let params = [username, nome_completo, data_entrada || null, data_saida || null, grupo];

        if (senha) {
            query += ', senha=?';
            params.push(hashPassword(senha));
        }

        query += ' WHERE id=?';
        params.push(id);

        await connection.query(query, params);
        if (atualizarFuncoes) {
            await syncFuncoesUsuario(connection, id, funcoesIds);
        }
        await connection.commit();
        res.json({ message: "Usuário atualizado com sucesso" });
    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.status(500).json({ error: "Erro ao atualizar usuário" });
    } finally {
        connection.release();
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
