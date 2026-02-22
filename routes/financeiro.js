const express = require('express');
const router = express.Router();
const { pool } = require('../database');

let tabelaFinanceiroGarantida = false;

async function garantirTabelaFinanceiro() {
    if (tabelaFinanceiroGarantida) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS financeiro_movimentacoes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tipo ENUM('ENTRADA', 'SAIDA') NOT NULL,
            valor DECIMAL(12,2) NOT NULL,
            descricao VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    tabelaFinanceiroGarantida = true;
}

async function buscarSaldoAtual(connection = pool) {
    const [rows] = await connection.query(`
        SELECT
            COALESCE(SUM(
                CASE
                    WHEN tipo = 'ENTRADA' THEN valor
                    ELSE -valor
                END
            ), 0) AS saldo_atual
        FROM financeiro_movimentacoes
    `);
    return Number(rows && rows[0] ? rows[0].saldo_atual : 0);
}

router.get('/resumo', async (req, res) => {
    try {
        await garantirTabelaFinanceiro();
        const saldo = await buscarSaldoAtual();
        res.json({ saldo_atual: saldo });
    } catch (err) {
        console.error('Erro ao buscar resumo financeiro:', err);
        res.status(500).json({ error: 'Erro ao buscar resumo financeiro' });
    }
});

router.get('/movimentacoes', async (req, res) => {
    try {
        await garantirTabelaFinanceiro();
        const [rows] = await pool.query(`
            SELECT id, tipo, valor, descricao, created_at
            FROM financeiro_movimentacoes
            ORDER BY created_at DESC, id DESC
        `);
        res.json(rows);
    } catch (err) {
        console.error('Erro ao buscar movimentações financeiras:', err);
        res.status(500).json({ error: 'Erro ao buscar movimentações financeiras' });
    }
});

router.post('/movimentacoes', async (req, res) => {
    const tipo = String(req.body.tipo || '').trim().toUpperCase();
    const descricao = String(req.body.descricao || '').trim();
    const valor = Number(req.body.valor);

    if (!['ENTRADA', 'SAIDA'].includes(tipo)) {
        return res.status(400).json({ error: "Tipo inválido. Use 'ENTRADA' ou 'SAIDA'." });
    }
    if (!descricao) {
        return res.status(400).json({ error: 'Descrição é obrigatória.' });
    }
    if (!Number.isFinite(valor) || valor <= 0) {
        return res.status(400).json({ error: 'Valor inválido.' });
    }

    const connection = await pool.getConnection();
    try {
        await garantirTabelaFinanceiro();
        await connection.beginTransaction();

        const saldoAtual = await buscarSaldoAtual(connection);
        if (tipo === 'SAIDA' && valor > saldoAtual) {
            await connection.rollback();
            return res.status(400).json({ error: 'Saldo insuficiente para registrar esta saída.' });
        }

        const valorNormalizado = Number(valor.toFixed(2));
        const [result] = await connection.query(
            'INSERT INTO financeiro_movimentacoes (tipo, valor, descricao) VALUES (?, ?, ?)',
            [tipo, valorNormalizado, descricao]
        );

        await connection.commit();
        const novoSaldo = await buscarSaldoAtual();
        res.status(201).json({
            id: result.insertId,
            message: 'Movimentação registrada com sucesso.',
            saldo_atual: novoSaldo
        });
    } catch (err) {
        await connection.rollback();
        console.error('Erro ao registrar movimentação financeira:', err);
        res.status(500).json({ error: 'Erro ao registrar movimentação financeira' });
    } finally {
        connection.release();
    }
});

module.exports = router;
