const express = require('express');
const router = express.Router();
const { pool } = require('../database');

let ensureCirculosPromise = null;

function normalizarNome(nome) {
    return String(nome || '').trim().replace(/\s+/g, ' ');
}

function validarHexCor(valor) {
    if (valor === undefined || valor === null || String(valor).trim() === '') return null;
    const txt = String(valor).trim();
    if (!/^#[0-9A-Fa-f]{6}$/.test(txt)) return null;
    return txt.toUpperCase();
}

async function ensureCirculosTable() {
    if (ensureCirculosPromise) return ensureCirculosPromise;

    ensureCirculosPromise = (async () => {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS circulos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome VARCHAR(80) NOT NULL,
                cor_hex VARCHAR(7) NULL,
                ordem INT NOT NULL DEFAULT 0,
                ativo TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_circulos_nome (nome)
            )
        `);

        // Sem seed automático: a lista de círculos fica 100% sob gestão do usuário.
    })();

    try {
        await ensureCirculosPromise;
    } finally {
        ensureCirculosPromise = null;
    }
}

router.get('/', async (req, res) => {
    try {
        await ensureCirculosTable();
        const incluirInativos = String(req.query.todos || '') === '1';
        const sql = incluirInativos
            ? 'SELECT id, nome, cor_hex, ativo, created_at, updated_at FROM circulos ORDER BY nome ASC'
            : 'SELECT id, nome, cor_hex, ativo FROM circulos WHERE ativo = 1 ORDER BY nome ASC';
        const [rows] = await pool.query(sql);
        return res.json(rows);
    } catch (err) {
        console.error('Erro ao listar círculos:', err);
        return res.status(500).json({ error: 'Erro ao listar círculos.' });
    }
});

router.post('/', async (req, res) => {
    try {
        await ensureCirculosTable();
        const nome = normalizarNome(req.body && req.body.nome);
        if (!nome) return res.status(400).json({ error: 'Nome da cor é obrigatório.' });
        if (nome.length > 80) return res.status(400).json({ error: 'Nome da cor deve ter no máximo 80 caracteres.' });

        const corHex = validarHexCor(req.body && req.body.cor_hex);
        if ((req.body && req.body.cor_hex) && !corHex) {
            return res.status(400).json({ error: 'Cor HEX inválida. Exemplo válido: #1A2B3C' });
        }

        const ativo = (req.body && (req.body.ativo === false || req.body.ativo === 0 || req.body.ativo === '0')) ? 0 : 1;

        const [result] = await pool.query(
            'INSERT INTO circulos (nome, cor_hex, ativo) VALUES (?, ?, ?)',
            [nome, corHex, ativo]
        );
        return res.status(201).json({ id: result.insertId, message: 'Cor de círculo criada com sucesso.' });
    } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Já existe uma cor de círculo com esse nome.' });
        }
        console.error('Erro ao criar círculo:', err);
        return res.status(500).json({ error: 'Erro ao criar cor de círculo.' });
    }
});

router.put('/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido.' });

    try {
        await ensureCirculosTable();
        const nome = normalizarNome(req.body && req.body.nome);
        if (!nome) return res.status(400).json({ error: 'Nome da cor é obrigatório.' });
        if (nome.length > 80) return res.status(400).json({ error: 'Nome da cor deve ter no máximo 80 caracteres.' });

        const corHex = validarHexCor(req.body && req.body.cor_hex);
        if ((req.body && req.body.cor_hex) && !corHex) {
            return res.status(400).json({ error: 'Cor HEX inválida. Exemplo válido: #1A2B3C' });
        }

        const ativo = (req.body && (req.body.ativo === false || req.body.ativo === 0 || req.body.ativo === '0')) ? 0 : 1;

        const [result] = await pool.query(
            'UPDATE circulos SET nome = ?, cor_hex = ?, ativo = ? WHERE id = ?',
            [nome, corHex, ativo, id]
        );
        if (!result.affectedRows) return res.status(404).json({ error: 'Cor de círculo não encontrada.' });
        return res.json({ message: 'Cor de círculo atualizada com sucesso.' });
    } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Já existe uma cor de círculo com esse nome.' });
        }
        console.error('Erro ao atualizar círculo:', err);
        return res.status(500).json({ error: 'Erro ao atualizar cor de círculo.' });
    }
});

router.delete('/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido.' });

    try {
        await ensureCirculosTable();
        const [rowsCirculo] = await pool.query('SELECT nome FROM circulos WHERE id = ?', [id]);
        if (!rowsCirculo || !rowsCirculo.length) return res.status(404).json({ error: 'Cor de círculo não encontrada.' });

        const nome = normalizarNome(rowsCirculo[0].nome);
        const [rowsUso] = await pool.query(
            "SELECT COUNT(*) AS cnt FROM jovens WHERE TRIM(COALESCE(circulo, '')) = ?",
            [nome]
        );
        const emUso = Number(rowsUso && rowsUso[0] && rowsUso[0].cnt ? rowsUso[0].cnt : 0);
        const forceDelete = String(req.query.force || '') === '1';
        if (emUso > 0) {
            if (!forceDelete) {
                return res.status(409).json({
                    error: `Não é possível excluir "${nome}" porque existem ${emUso} jovem(ns) usando essa cor.`,
                    emUso,
                    canForce: true
                });
            }
            await pool.query(
                "UPDATE jovens SET circulo = NULL WHERE TRIM(COALESCE(circulo, '')) = ?",
                [nome]
            );
        }

        try {
            const [result] = await pool.query('DELETE FROM circulos WHERE id = ?', [id]);
            if (!result.affectedRows) return res.status(404).json({ error: 'Cor de círculo não encontrada.' });
            return res.json({
                message: emUso > 0
                    ? `Cor de círculo removida com sucesso. ${emUso} jovem(ns) tiveram o campo círculo limpo.`
                    : 'Cor de círculo removida com sucesso.'
            });
        } catch (errDelete) {
            // Fallback: se não conseguir remover fisicamente por algum motivo, desativa a cor.
            await pool.query('UPDATE circulos SET ativo = 0 WHERE id = ?', [id]);
            return res.json({
                message: emUso > 0
                    ? `Cor desativada com sucesso. ${emUso} jovem(ns) tiveram o campo círculo limpo.`
                    : 'Cor desativada com sucesso.'
            });
        }
    } catch (err) {
        console.error('Erro ao remover círculo:', err);
        return res.status(500).json({ error: err && err.message ? err.message : 'Erro ao remover cor de círculo.' });
    }
});

module.exports = router;
