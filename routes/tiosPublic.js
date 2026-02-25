const express = require('express');
const crypto = require('crypto');
const { pool } = require('../database');

const router = express.Router();
const TOKEN_TTL_MS = 15 * 60 * 1000;
const TOKEN_SECRET = process.env.JOVENS_PUBLIC_TOKEN_SECRET || process.env.JWT_SECRET || 'semea-jovens-public';

let estruturaOk = false;
let estruturaPromise = null;

async function ensureEstrutura() {
    if (estruturaOk) return;
    if (estruturaPromise) return estruturaPromise;
    estruturaPromise = (async () => {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tios_ecc (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id INT NOT NULL,
                numero VARCHAR(30) NOT NULL,
                descricao VARCHAR(160) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_tios_ecc_tenant_numero (tenant_id, numero)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS tios_casais (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id INT NOT NULL,
                ecc_id INT NULL,
                nome_tio VARCHAR(180) NOT NULL,
                telefone_tio VARCHAR(30) NOT NULL,
                data_nascimento_tio DATE NULL,
                nome_tia VARCHAR(180) NOT NULL,
                telefone_tia VARCHAR(30) NOT NULL,
                data_nascimento_tia DATE NULL,
                observacoes VARCHAR(255) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY idx_tios_casais_tenant (tenant_id),
                KEY idx_tios_casais_ecc (ecc_id)
            )
        `);

        estruturaOk = true;
    })();

    try {
        await estruturaPromise;
    } finally {
        estruturaPromise = null;
    }
}

function normalizeDate(v) {
    if (!v) return null;
    const txt = String(v).trim();
    if (!txt) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(txt)) return txt;
    const br = txt.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    if (txt.includes('T')) return txt.split('T')[0];
    return null;
}

function normalizePhoneDigits(v) {
    return String(v || '').replace(/\D/g, '');
}

function criarToken(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
    return `${body}.${sig}`;
}

function validarToken(token) {
    try {
        if (!token || typeof token !== 'string' || !token.includes('.')) return null;
        const [body, sig] = token.split('.');
        const sigEsperada = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
        if (sig !== sigEsperada) return null;
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (!payload || !payload.casal_id || !payload.tenant_id || !payload.ts) return null;
        if ((Date.now() - Number(payload.ts)) > TOKEN_TTL_MS) return null;
        return payload;
    } catch (_) {
        return null;
    }
}

router.get('/ecc', async (_req, res) => {
    try {
        await ensureEstrutura();
        const [rows] = await pool.query(
            'SELECT id, numero, descricao FROM tios_ecc ORDER BY numero ASC'
        );
        return res.json(rows || []);
    } catch (err) {
        console.error('Erro ao listar ECC (público):', err);
        return res.status(500).json({ error: 'Erro ao listar ECC.' });
    }
});

router.post('/validar', async (req, res) => {
    try {
        await ensureEstrutura();
        const nomeTio = String(req.body.nome_tio || '').trim();
        const nomeTia = String(req.body.nome_tia || '').trim();
        const telefoneTio = String(req.body.telefone_tio || '').trim();
        const telefoneTia = String(req.body.telefone_tia || '').trim();
        const dataTio = normalizeDate(req.body.data_nascimento_tio);
        const dataTia = normalizeDate(req.body.data_nascimento_tia);
        const eccId = Number(req.body.ecc_id || 0);

        if (!nomeTio || !nomeTia || !telefoneTio || !telefoneTia || !dataTio || !dataTia || !eccId) {
            return res.status(400).json({ error: 'Preencha nome, telefone, datas de nascimento e o ECC.' });
        }

        const telTioDigits = normalizePhoneDigits(telefoneTio);
        const telTiaDigits = normalizePhoneDigits(telefoneTia);
        if (!telTioDigits || !telTiaDigits) {
            return res.status(400).json({ error: 'Telefone inválido.' });
        }

        const [rows] = await pool.query(
            `SELECT id, tenant_id
             FROM tios_casais
             WHERE ecc_id = ?
               AND LOWER(TRIM(nome_tio)) = LOWER(TRIM(?))
               AND LOWER(TRIM(nome_tia)) = LOWER(TRIM(?))
               AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(telefone_tio, '')), ' ', ''), '(', ''), ')', ''), '-', ''), '+', '') = ?
               AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(telefone_tia, '')), ' ', ''), '(', ''), ')', ''), '-', ''), '+', '') = ?
               AND DATE(data_nascimento_tio) = ?
               AND DATE(data_nascimento_tia) = ?`,
            [eccId, nomeTio, nomeTia, telTioDigits, telTiaDigits, dataTio, dataTia]
        );

        if (!rows.length) {
            return res.status(404).json({ error: 'Não encontramos cadastro com esses dados.' });
        }
        if (rows.length > 1) {
            return res.status(409).json({ error: 'Encontramos mais de um cadastro. Procure a coordenação.' });
        }

        const token = criarToken({
            casal_id: rows[0].id,
            tenant_id: rows[0].tenant_id,
            ts: Date.now()
        });

        return res.json({ message: 'Cadastro confirmado. Agora você pode atualizar o telefone.', token });
    } catch (err) {
        console.error('Erro ao validar dados de tios (público):', err);
        return res.status(500).json({ error: 'Erro ao validar dados.' });
    }
});

router.post('/atualizar', async (req, res) => {
    try {
        await ensureEstrutura();
        const token = String(req.body.token || '').trim();
        const payload = validarToken(token);
        if (!payload) return res.status(401).json({ error: 'Validação expirada ou inválida.' });

        const telefoneTio = String(req.body.telefone_tio || '').trim();
        const telefoneTia = String(req.body.telefone_tia || '').trim();
        if (!telefoneTio || !telefoneTia) {
            return res.status(400).json({ error: 'Informe o telefone do tio e da tia.' });
        }

        const [result] = await pool.query(
            `UPDATE tios_casais
             SET telefone_tio = ?, telefone_tia = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND tenant_id = ?`,
            [telefoneTio, telefoneTia, payload.casal_id, payload.tenant_id]
        );

        if (!result.affectedRows) {
            return res.status(404).json({ error: 'Cadastro não encontrado.' });
        }

        return res.json({ message: 'Telefone atualizado com sucesso.' });
    } catch (err) {
        console.error('Erro ao atualizar telefone de tios (público):', err);
        return res.status(500).json({ error: 'Erro ao atualizar telefone.' });
    }
});

module.exports = router;
