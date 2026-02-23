const express = require('express');
const { pool } = require('../database');
const { ensureTenantStructure } = require('../lib/tenantSetup');

const router = express.Router();

let estruturaOk = false;
let estruturaPromise = null;

async function garantirEstrutura() {
    if (estruturaOk) return;
    if (estruturaPromise) {
        await estruturaPromise;
        return;
    }

    estruturaPromise = (async () => {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS meu_ejc_config (
                id TINYINT NOT NULL PRIMARY KEY,
                nome VARCHAR(140) NOT NULL DEFAULT 'Inconfidentes',
                paroquia VARCHAR(180) NULL,
                endereco VARCHAR(255) NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            INSERT INTO meu_ejc_config (id, nome)
            VALUES (1, 'Inconfidentes')
            ON DUPLICATE KEY UPDATE nome = COALESCE(nome, 'Inconfidentes')
        `);

        try {
            await pool.query('ALTER TABLE meu_ejc_config ADD COLUMN paroquia VARCHAR(180) NULL AFTER nome');
        } catch (e) {
            if (!e || e.code !== 'ER_DUP_FIELDNAME') throw e;
        }
        try {
            await pool.query('ALTER TABLE meu_ejc_config ADD COLUMN endereco VARCHAR(255) NULL AFTER paroquia');
        } catch (e) {
            if (!e || e.code !== 'ER_DUP_FIELDNAME') throw e;
        }

        estruturaOk = true;
    })();

    try {
        await estruturaPromise;
    } finally {
        estruturaPromise = null;
    }
}

router.get('/', async (_req, res) => {
    try {
        await ensureTenantStructure();
        await garantirEstrutura();
        const tenantId = _req.user && _req.user.tenant_id ? Number(_req.user.tenant_id) : 0;
        if (tenantId) {
            const [tenantRows] = await pool.query(
                'SELECT nome_ejc AS nome, paroquia, endereco, updated_at FROM tenants_ejc WHERE id = ? LIMIT 1',
                [tenantId]
            );
            if (tenantRows && tenantRows.length) {
                return res.json({
                    nome: tenantRows[0].nome || 'Inconfidentes',
                    paroquia: tenantRows[0].paroquia || null,
                    endereco: tenantRows[0].endereco || null,
                    updated_at: tenantRows[0].updated_at || null
                });
            }
        }

        const [rows] = await pool.query('SELECT nome, paroquia, endereco, updated_at FROM meu_ejc_config WHERE id = 1 LIMIT 1');
        const nome = rows && rows.length && rows[0].nome ? String(rows[0].nome).trim() : 'Inconfidentes';
        return res.json({
            nome: nome || 'Inconfidentes',
            paroquia: rows && rows[0] ? (rows[0].paroquia || null) : null,
            endereco: rows && rows[0] ? (rows[0].endereco || null) : null,
            updated_at: rows && rows[0] ? rows[0].updated_at : null
        });
    } catch (err) {
        console.error('Erro ao buscar configuração do Meu EJC:', err);
        return res.status(500).json({ error: 'Erro ao buscar configuração do Meu EJC.' });
    }
});

router.put('/', async (req, res) => {
    try {
        await ensureTenantStructure();
        await garantirEstrutura();
        const nome = String(req.body && req.body.nome ? req.body.nome : '').trim();
        const paroquia = String(req.body && req.body.paroquia ? req.body.paroquia : '').trim() || null;
        const endereco = String(req.body && req.body.endereco ? req.body.endereco : '').trim() || null;
        if (!nome) return res.status(400).json({ error: 'Informe o nome do EJC.' });
        if (nome.length > 140) return res.status(400).json({ error: 'Nome do EJC muito longo.' });

        const tenantId = req.user && req.user.tenant_id ? Number(req.user.tenant_id) : 0;
        if (tenantId) {
            await pool.query(
                'UPDATE tenants_ejc SET nome_ejc = ?, paroquia = ?, endereco = ? WHERE id = ?',
                [nome, paroquia, endereco, tenantId]
            );
            return res.json({ message: 'Configuração do EJC atualizada com sucesso.', nome, paroquia, endereco });
        }

        await pool.query('UPDATE meu_ejc_config SET nome = ?, paroquia = ?, endereco = ? WHERE id = 1', [nome, paroquia, endereco]);
        return res.json({ message: 'Configuração do EJC atualizada com sucesso.', nome, paroquia, endereco });
    } catch (err) {
        console.error('Erro ao salvar configuração do Meu EJC:', err);
        return res.status(500).json({ error: 'Erro ao salvar configuração do Meu EJC.' });
    }
});

module.exports = router;
