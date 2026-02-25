const express = require('express');
const crypto = require('crypto');
const { pool } = require('../database');

const router = express.Router();
const TOKEN_TTL_MS = 15 * 60 * 1000;
const TOKEN_SECRET = process.env.JOVENS_PUBLIC_TOKEN_SECRET || process.env.JWT_SECRET || 'semea-jovens-public';

let circulosEnsured = false;
let circulosPromise = null;

async function ensureCirculosTable() {
    if (circulosEnsured) return;
    if (circulosPromise) return circulosPromise;
    circulosPromise = (async () => {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS circulos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome VARCHAR(80) NOT NULL,
                cor_hex VARCHAR(7) NULL,
                ordem INT NOT NULL DEFAULT 0,
                ativo TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        try {
            await pool.query('ALTER TABLE circulos ADD UNIQUE KEY uk_circulos_nome_tenant (tenant_id, nome)');
        } catch (err) {
            if (!err || err.code !== 'ER_DUP_KEYNAME') throw err;
        }

        circulosEnsured = true;
    })();

    try {
        await circulosPromise;
    } finally {
        circulosPromise = null;
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
        if (!payload || !payload.jovem_id || !payload.tenant_id || !payload.ts) return null;
        if ((Date.now() - Number(payload.ts)) > TOKEN_TTL_MS) return null;
        return payload;
    } catch (_) {
        return null;
    }
}

async function tenantIdPorOutroEjc(outroEjcId) {
    if (!outroEjcId) return null;
    const [rows] = await pool.query(
        'SELECT tenant_id FROM outros_ejcs WHERE id = ? LIMIT 1',
        [outroEjcId]
    );
    return rows && rows[0] ? rows[0].tenant_id : null;
}

router.get('/outros-ejcs', async (_req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, nome, paroquia FROM outros_ejcs ORDER BY nome ASC'
        );
        return res.json(rows || []);
    } catch (err) {
        console.error('Erro ao listar outros EJCs (público):', err);
        return res.status(500).json({ error: 'Erro ao listar EJCs.' });
    }
});

router.get('/circulos', async (req, res) => {
    try {
        await ensureCirculosTable();
        const token = String(req.query.token || '').trim();
        let tenantId = null;
        if (token) {
            const payload = validarToken(token);
            if (!payload) return res.status(401).json({ error: 'Validação expirada ou inválida.' });
            tenantId = payload.tenant_id;
        } else if (req.query.outro_ejc_id) {
            tenantId = await tenantIdPorOutroEjc(Number(req.query.outro_ejc_id));
        }

        if (!tenantId) return res.json([]);

        const [rows] = await pool.query(
            'SELECT id, nome, cor_hex FROM circulos WHERE ativo = 1 AND tenant_id = ? ORDER BY nome ASC',
            [tenantId]
        );
        return res.json(rows || []);
    } catch (err) {
        console.error('Erro ao listar círculos (público):', err);
        return res.status(500).json({ error: 'Erro ao listar círculos.' });
    }
});

router.post('/validar', async (req, res) => {
    try {
        const nome = String(req.body.nome_completo || '').trim();
        const telefone = String(req.body.telefone || '').trim();
        const outroEjcId = Number(req.body.outro_ejc_id || 0);
        if (!nome || !telefone || !outroEjcId) {
            return res.status(400).json({ error: 'Preencha nome, telefone e o EJC que fez.' });
        }
        const telDigits = normalizePhoneDigits(telefone);
        if (!telDigits) return res.status(400).json({ error: 'Telefone inválido.' });

        const [rows] = await pool.query(
            `SELECT id, tenant_id
             FROM jovens
             WHERE origem_ejc_tipo = 'OUTRO_EJC'
               AND outro_ejc_id = ?
               AND LOWER(TRIM(nome_completo)) = LOWER(TRIM(?))
               AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(telefone, '')), ' ', ''), '(', ''), ')', ''), '-', ''), '+', '') = ?`,
            [outroEjcId, nome, telDigits]
        );

        if (!rows.length) {
            return res.status(404).json({ error: 'Cadastro não encontrado.' });
        }
        if (rows.length > 1) {
            return res.status(409).json({ error: 'Encontramos mais de um cadastro. Procure a coordenação.' });
        }

        const token = criarToken({
            jovem_id: rows[0].id,
            tenant_id: rows[0].tenant_id,
            ts: Date.now()
        });

        return res.json({ message: 'Cadastro confirmado. Agora você pode atualizar.', token });
    } catch (err) {
        console.error('Erro ao validar jovem de outro EJC (público):', err);
        return res.status(500).json({ error: 'Erro ao validar cadastro.' });
    }
});

router.post('/atualizar', async (req, res) => {
    try {
        const token = String(req.body.token || '').trim();
        const payload = validarToken(token);
        if (!payload) return res.status(401).json({ error: 'Validação expirada ou inválida.' });

        const telefone = String(req.body.telefone || '').trim();
        const circulo = String(req.body.circulo || '').trim() || null;
        const instagram = String(req.body.instagram || '').trim() || null;
        const deficiencia = !!req.body.deficiencia;
        const qualDeficiencia = deficiencia ? (String(req.body.qual_deficiencia || '').trim() || null) : null;
        const restricaoAlimentar = !!req.body.restricao_alimentar;
        const detalhesRestricao = restricaoAlimentar ? (String(req.body.detalhes_restricao || '').trim() || null) : null;

        if (!telefone) {
            return res.status(400).json({ error: 'Informe o telefone.' });
        }
        if (deficiencia && !qualDeficiencia) {
            return res.status(400).json({ error: 'Informe a deficiência.' });
        }
        if (restricaoAlimentar && !detalhesRestricao) {
            return res.status(400).json({ error: 'Informe a restrição alimentar.' });
        }

        const [result] = await pool.query(
            `UPDATE jovens
             SET telefone = ?, circulo = ?, instagram = ?, deficiencia = ?, qual_deficiencia = ?, restricao_alimentar = ?, detalhes_restricao = ?
             WHERE id = ? AND tenant_id = ? AND origem_ejc_tipo = 'OUTRO_EJC'`,
            [
                telefone,
                circulo,
                instagram,
                deficiencia ? 1 : 0,
                qualDeficiencia,
                restricaoAlimentar ? 1 : 0,
                detalhesRestricao,
                payload.jovem_id,
                payload.tenant_id
            ]
        );

        if (!result.affectedRows) {
            return res.status(404).json({ error: 'Cadastro não encontrado.' });
        }

        return res.json({ message: 'Cadastro atualizado com sucesso.' });
    } catch (err) {
        console.error('Erro ao atualizar jovem de outro EJC (público):', err);
        return res.status(500).json({ error: 'Erro ao atualizar cadastro.' });
    }
});

router.post('/criar', async (req, res) => {
    try {
        const nome = String(req.body.nome_completo || '').trim();
        const telefone = String(req.body.telefone || '').trim();
        const dataNascimento = normalizeDate(req.body.data_nascimento);
        const sexo = String(req.body.sexo || '').trim() || null;
        const estadoCivil = String(req.body.estado_civil || '').trim() || 'Solteiro';
        const outroEjcId = Number(req.body.outro_ejc_id || 0);
        const outroEjcNumeroRaw = String(req.body.outro_ejc_numero || '').trim();
        const outroEjcNumero = outroEjcNumeroRaw || null;
        const circulo = String(req.body.circulo || '').trim() || null;
        const instagram = String(req.body.instagram || '').trim() || null;
        const deficiencia = !!req.body.deficiencia;
        const qualDeficiencia = deficiencia ? (String(req.body.qual_deficiencia || '').trim() || null) : null;
        const restricaoAlimentar = !!req.body.restricao_alimentar;
        const detalhesRestricao = restricaoAlimentar ? (String(req.body.detalhes_restricao || '').trim() || null) : null;

        if (!nome || !telefone || !dataNascimento || !sexo || !estadoCivil || !outroEjcId || !outroEjcNumeroRaw) {
            return res.status(400).json({ error: 'Preencha nome, telefone, data de nascimento, sexo, estado civil, número do EJC e o EJC que fez.' });
        }
        if (deficiencia && !qualDeficiencia) {
            return res.status(400).json({ error: 'Informe a deficiência.' });
        }
        if (restricaoAlimentar && !detalhesRestricao) {
            return res.status(400).json({ error: 'Informe a restrição alimentar.' });
        }

        const tenantId = await tenantIdPorOutroEjc(outroEjcId);
        if (!tenantId) {
            return res.status(400).json({ error: 'EJC de origem inválido.' });
        }

        const [result] = await pool.query(
            `INSERT INTO jovens (
                tenant_id, nome_completo, telefone, data_nascimento, sexo, estado_civil,
                circulo, instagram, deficiencia, qual_deficiencia, restricao_alimentar, detalhes_restricao,
                origem_ejc_tipo, outro_ejc_id, outro_ejc_numero, transferencia_outro_ejc
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OUTRO_EJC', ?, ?, 0)`,
            [
                tenantId,
                nome,
                telefone,
                dataNascimento,
                sexo,
                estadoCivil,
                circulo,
                instagram,
                deficiencia ? 1 : 0,
                qualDeficiencia,
                restricaoAlimentar ? 1 : 0,
                detalhesRestricao,
                outroEjcId,
                outroEjcNumero
            ]
        );

        return res.status(201).json({ id: result.insertId, message: 'Cadastro criado com sucesso.' });
    } catch (err) {
        console.error('Erro ao criar jovem de outro EJC (público):', err);
        return res.status(500).json({ error: 'Erro ao criar cadastro.' });
    }
});

module.exports = router;
