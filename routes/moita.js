const express = require('express');
const router = express.Router();
const { pool } = require('../database');

let estruturaGarantida = false;

async function garantirEstrutura() {
    if (estruturaGarantida) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS moita_funcoes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(120) NOT NULL UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS moita_reservas (
            id INT AUTO_INCREMENT PRIMARY KEY,
            jovem_id INT NOT NULL,
            lista ENUM('MULHERES','HOMENS') NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_moita_reserva_jovem (jovem_id),
            CONSTRAINT fk_moita_reserva_jovem FOREIGN KEY (jovem_id) REFERENCES jovens(id) ON DELETE CASCADE
        )
    `);
    estruturaGarantida = true;
}

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

router.get('/funcoes', async (req, res) => {
    try {
        await garantirEstrutura();
        const [rows] = await pool.query('SELECT id, nome, created_at FROM moita_funcoes ORDER BY nome ASC');
        res.json(rows);
    } catch (err) {
        console.error('Erro ao listar funções de moita:', err);
        res.status(500).json({ error: 'Erro ao listar funções de moita' });
    }
});

router.get('/reservas', async (req, res) => {
    try {
        await garantirEstrutura();
        const [rows] = await pool.query(`
            SELECT mr.id, mr.jovem_id, mr.lista, mr.created_at,
                   j.nome_completo, j.telefone, j.circulo, j.sexo, j.data_nascimento,
                   j.numero_ejc_fez,
                   eorig.numero AS ejc_origem_numero
            FROM moita_reservas mr
            JOIN jovens j ON j.id = mr.jovem_id
            LEFT JOIN ejc eorig ON eorig.id = j.numero_ejc_fez
            ORDER BY j.nome_completo ASC
        `);
        res.json({
            mulheres: rows.filter(r => r.lista === 'MULHERES'),
            homens: rows.filter(r => r.lista === 'HOMENS')
        });
    } catch (err) {
        console.error('Erro ao listar reservas de moita:', err);
        res.status(500).json({ error: 'Erro ao listar reservas de moita' });
    }
});

router.post('/reservas', async (req, res) => {
    const jovemId = Number(req.body.jovem_id);
    const listaRaw = String(req.body.lista || '').trim().toUpperCase();
    const lista = ['MULHERES', 'HOMENS'].includes(listaRaw) ? listaRaw : null;
    if (!jovemId || !lista) return res.status(400).json({ error: 'Dados inválidos.' });

    try {
        await garantirEstrutura();
        const [[jovem]] = await pool.query('SELECT id, sexo FROM jovens WHERE id = ? LIMIT 1', [jovemId]);
        if (!jovem) return res.status(404).json({ error: 'Jovem não encontrado.' });

        if (jovem.sexo === 'Feminino' && lista !== 'MULHERES') {
            return res.status(409).json({ error: 'Este jovem é do sexo feminino e deve estar na lista de mulheres.' });
        }
        if (jovem.sexo === 'Masculino' && lista !== 'HOMENS') {
            return res.status(409).json({ error: 'Este jovem é do sexo masculino e deve estar na lista de homens.' });
        }

        const [exists] = await pool.query('SELECT id FROM moita_reservas WHERE jovem_id = ? LIMIT 1', [jovemId]);
        if (exists.length) return res.status(409).json({ error: 'Este jovem já está em uma lista de reserva.' });

        const [result] = await pool.query(
            'INSERT INTO moita_reservas (jovem_id, lista) VALUES (?, ?)',
            [jovemId, lista]
        );
        res.status(201).json({ id: result.insertId, message: 'Jovem adicionado à reserva de moita.' });
    } catch (err) {
        console.error('Erro ao adicionar jovem na reserva de moita:', err);
        res.status(500).json({ error: 'Erro ao adicionar jovem na reserva de moita' });
    }
});

router.post('/reservas/automatico', async (req, res) => {
    const jovemId = Number(req.body.jovem_id);
    if (!jovemId) return res.status(400).json({ error: 'Jovem é obrigatório.' });

    try {
        await garantirEstrutura();
        const [[jovem]] = await pool.query('SELECT id, sexo FROM jovens WHERE id = ? LIMIT 1', [jovemId]);
        if (!jovem) return res.status(404).json({ error: 'Jovem não encontrado.' });

        if (!jovem.sexo) {
            return res.status(409).json({ error: 'Defina o sexo do jovem para adicionar na reserva de moita.' });
        }

        const lista = jovem.sexo === 'Feminino' ? 'MULHERES' : 'HOMENS';
        const [exists] = await pool.query('SELECT id FROM moita_reservas WHERE jovem_id = ? LIMIT 1', [jovemId]);
        if (exists.length) return res.status(409).json({ error: 'Este jovem já está em uma lista de reserva.' });

        const [result] = await pool.query(
            'INSERT INTO moita_reservas (jovem_id, lista) VALUES (?, ?)',
            [jovemId, lista]
        );

        res.status(201).json({
            id: result.insertId,
            lista,
            message: 'Jovem adicionado à lista de reserva de moita com sucesso.'
        });
    } catch (err) {
        console.error('Erro ao adicionar jovem automaticamente na reserva de moita:', err);
        res.status(500).json({ error: 'Erro ao adicionar jovem automaticamente na reserva de moita' });
    }
});

router.delete('/reservas/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    try {
        await garantirEstrutura();
        const [result] = await pool.query('DELETE FROM moita_reservas WHERE id = ?', [id]);
        if (!result.affectedRows) return res.status(404).json({ error: 'Registro não encontrado.' });
        res.json({ message: 'Jovem removido da reserva de moita.' });
    } catch (err) {
        console.error('Erro ao remover jovem da reserva de moita:', err);
        res.status(500).json({ error: 'Erro ao remover jovem da reserva de moita' });
    }
});

router.post('/funcoes', async (req, res) => {
    const nome = String(req.body.nome || '').trim();
    if (!nome) return res.status(400).json({ error: 'Nome da função é obrigatório.' });

    try {
        await garantirEstrutura();
        const [exists] = await pool.query('SELECT id FROM moita_funcoes WHERE LOWER(nome)=LOWER(?) LIMIT 1', [nome]);
        if (exists.length) return res.status(409).json({ error: 'Esta função já existe.' });

        const [result] = await pool.query('INSERT INTO moita_funcoes (nome) VALUES (?)', [nome]);
        res.status(201).json({ id: result.insertId, message: 'Função criada com sucesso.' });
    } catch (err) {
        console.error('Erro ao criar função de moita:', err);
        res.status(500).json({ error: 'Erro ao criar função de moita' });
    }
});

router.delete('/funcoes/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    try {
        await garantirEstrutura();
        const [result] = await pool.query('DELETE FROM moita_funcoes WHERE id = ?', [id]);
        if (!result.affectedRows) return res.status(404).json({ error: 'Função não encontrada.' });
        res.json({ message: 'Função removida com sucesso.' });
    } catch (err) {
        console.error('Erro ao remover função de moita:', err);
        res.status(500).json({ error: 'Erro ao remover função de moita' });
    }
});

router.get('/registros', async (req, res) => {
    try {
        await garantirEstrutura();
        const comParoquiaCol = await hasColumn('jovens_comissoes', 'paroquia');
        const comFuncaoCol = await hasColumn('jovens_comissoes', 'funcao_garcom');
        const selectParoquia = comParoquiaCol
            ? 'COALESCE(oe.paroquia, jc.paroquia) AS paroquia'
            : 'oe.paroquia AS paroquia';
        const selectFuncao = comFuncaoCol
            ? "COALESCE(jc.funcao_garcom, '-') AS funcao_moita"
            : "'-' AS funcao_moita";

        const [rows] = await pool.query(`
            SELECT 
                jc.id,
                jc.jovem_id,
                j.nome_completo,
                j.telefone,
                j.numero_ejc_fez,
                eorig.numero AS ejc_origem_numero,
                jc.ejc_numero,
                ${selectParoquia},
                ${selectFuncao}
            FROM jovens_comissoes jc
            JOIN jovens j ON j.id = jc.jovem_id
            LEFT JOIN ejc eorig ON eorig.id = j.numero_ejc_fez
            LEFT JOIN outros_ejcs oe ON oe.id = jc.outro_ejc_id
            WHERE jc.tipo = 'MOITA_OUTRO'
            ORDER BY jc.id DESC
        `);
        res.json(rows);
    } catch (err) {
        console.error('Erro ao listar registros de moita:', err);
        res.status(500).json({ error: 'Erro ao listar registros de moita' });
    }
});

module.exports = router;
