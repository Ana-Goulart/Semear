const express = require('express');
const { pool } = require('../database');
const { getTenantId } = require('../lib/tenantIsolation');

const router = express.Router();

let ensured = false;
let ensurePromise = null;

async function ensureStructure() {
    if (ensured) return;
    if (ensurePromise) return ensurePromise;
    ensurePromise = (async () => {
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

        await pool.query(`
            CREATE TABLE IF NOT EXISTS tios_casal_equipes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id INT NOT NULL,
                casal_id INT NOT NULL,
                equipe_id INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_tios_casal_equipe (casal_id, equipe_id),
                KEY idx_tios_casal_equipes_tenant (tenant_id)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS tios_casal_servicos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id INT NOT NULL,
                casal_id INT NOT NULL,
                equipe_id INT NOT NULL,
                ejc_id INT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_tios_casal_servico (casal_id, equipe_id, ejc_id),
                KEY idx_tios_casal_servicos_tenant (tenant_id),
                KEY idx_tios_casal_servicos_ejc (ejc_id)
            )
        `);

        await pool.query(`
            INSERT INTO tios_casal_servicos (tenant_id, casal_id, equipe_id, ejc_id)
            SELECT ce.tenant_id, ce.casal_id, ce.equipe_id, NULL
            FROM tios_casal_equipes ce
            LEFT JOIN tios_casal_servicos cs
              ON cs.tenant_id = ce.tenant_id
             AND cs.casal_id = ce.casal_id
             AND cs.equipe_id = ce.equipe_id
             AND cs.ejc_id IS NULL
            WHERE cs.id IS NULL
        `);

        ensured = true;
    })();

    try {
        await ensurePromise;
    } finally {
        ensurePromise = null;
    }
}

function normalizeDate(v) {
    if (!v) return null;
    const txt = String(v).trim();
    if (!txt) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(txt)) return txt;
    if (txt.includes('T')) return txt.split('T')[0];
    return null;
}

function toIntArray(value) {
    if (!Array.isArray(value)) return [];
    return value.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
}

function normalizeServicos(value, fallbackEquipeIds) {
    const result = [];
    const seen = new Set();
    if (Array.isArray(value)) {
        for (const item of value) {
            const equipeId = Number(item && item.equipe_id);
            const ejcIdRaw = item ? item.ejc_id : null;
            const ejcId = ejcIdRaw ? Number(ejcIdRaw) : null;
            if (!Number.isInteger(equipeId) || equipeId <= 0) continue;
            const validEjcId = Number.isInteger(ejcId) && ejcId > 0 ? ejcId : null;
            const key = `${equipeId}:${validEjcId || 0}`;
            if (seen.has(key)) continue;
            seen.add(key);
            result.push({ equipe_id: equipeId, ejc_id: validEjcId });
        }
    }

    if (result.length) return result;

    for (const equipeId of toIntArray(fallbackEquipeIds)) {
        const key = `${equipeId}:0`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ equipe_id: equipeId, ejc_id: null });
    }
    return result;
}

router.get('/equipes', async (req, res) => {
    try {
        await ensureStructure();
        const tenantId = getTenantId(req);
        const [rows] = await pool.query(
            'SELECT id, nome FROM equipes WHERE tenant_id = ? ORDER BY nome ASC',
            [tenantId]
        );
        return res.json(rows);
    } catch (err) {
        console.error('Erro ao listar equipes para tios:', err);
        return res.status(500).json({ error: 'Erro ao listar equipes.' });
    }
});

router.get('/ejcs', async (req, res) => {
    try {
        await ensureStructure();
        const tenantId = getTenantId(req);
        const [rows] = await pool.query(
            'SELECT id, numero, paroquia, ano FROM ejc WHERE tenant_id = ? ORDER BY numero DESC',
            [tenantId]
        );
        return res.json(rows);
    } catch (err) {
        console.error('Erro ao listar EJCs para tios:', err);
        return res.status(500).json({ error: 'Erro ao listar EJCs.' });
    }
});

router.get('/ecc', async (req, res) => {
    try {
        await ensureStructure();
        const tenantId = getTenantId(req);
        const [rows] = await pool.query(
            `SELECT id, numero, descricao, created_at, updated_at
             FROM tios_ecc
             WHERE tenant_id = ?
             ORDER BY numero ASC`,
            [tenantId]
        );
        return res.json(rows);
    } catch (err) {
        console.error('Erro ao listar ECC:', err);
        return res.status(500).json({ error: 'Erro ao listar ECC.' });
    }
});

router.post('/ecc', async (req, res) => {
    try {
        await ensureStructure();
        const tenantId = getTenantId(req);
        const numero = String(req.body.numero || '').trim();
        const descricao = String(req.body.descricao || '').trim() || null;
        if (!numero) return res.status(400).json({ error: 'Número do ECC é obrigatório.' });
        const [result] = await pool.query(
            'INSERT INTO tios_ecc (tenant_id, numero, descricao) VALUES (?, ?, ?)',
            [tenantId, numero, descricao]
        );
        return res.status(201).json({ id: result.insertId, message: 'ECC cadastrado com sucesso.' });
    } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Esse número de ECC já está cadastrado.' });
        }
        console.error('Erro ao criar ECC:', err);
        return res.status(500).json({ error: 'Erro ao criar ECC.' });
    }
});

router.put('/ecc/:id', async (req, res) => {
    try {
        await ensureStructure();
        const tenantId = getTenantId(req);
        const id = Number(req.params.id);
        if (!id) return res.status(400).json({ error: 'ID inválido.' });
        const numero = String(req.body.numero || '').trim();
        const descricao = String(req.body.descricao || '').trim() || null;
        if (!numero) return res.status(400).json({ error: 'Número do ECC é obrigatório.' });
        const [result] = await pool.query(
            'UPDATE tios_ecc SET numero = ?, descricao = ? WHERE id = ? AND tenant_id = ?',
            [numero, descricao, id, tenantId]
        );
        if (!result.affectedRows) return res.status(404).json({ error: 'ECC não encontrado.' });
        return res.json({ message: 'ECC atualizado com sucesso.' });
    } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Esse número de ECC já está cadastrado.' });
        }
        console.error('Erro ao atualizar ECC:', err);
        return res.status(500).json({ error: 'Erro ao atualizar ECC.' });
    }
});

router.delete('/ecc/:id', async (req, res) => {
    try {
        await ensureStructure();
        const tenantId = getTenantId(req);
        const id = Number(req.params.id);
        if (!id) return res.status(400).json({ error: 'ID inválido.' });
        const [used] = await pool.query(
            'SELECT id FROM tios_casais WHERE tenant_id = ? AND ecc_id = ? LIMIT 1',
            [tenantId, id]
        );
        if (used.length) return res.status(400).json({ error: 'Não é possível excluir: ECC em uso por casal cadastrado.' });
        const [result] = await pool.query('DELETE FROM tios_ecc WHERE id = ? AND tenant_id = ?', [id, tenantId]);
        if (!result.affectedRows) return res.status(404).json({ error: 'ECC não encontrado.' });
        return res.json({ message: 'ECC removido com sucesso.' });
    } catch (err) {
        console.error('Erro ao remover ECC:', err);
        return res.status(500).json({ error: 'Erro ao remover ECC.' });
    }
});

router.get('/casais', async (req, res) => {
    try {
        await ensureStructure();
        const tenantId = getTenantId(req);
        const [casais] = await pool.query(
            `SELECT c.id, c.ecc_id, c.nome_tio, c.telefone_tio, c.data_nascimento_tio,
                    c.nome_tia, c.telefone_tia, c.data_nascimento_tia, c.observacoes,
                    c.created_at, c.updated_at, e.numero AS ecc_numero, e.descricao AS ecc_descricao
             FROM tios_casais c
             LEFT JOIN tios_ecc e ON e.id = c.ecc_id AND e.tenant_id = c.tenant_id
             WHERE c.tenant_id = ?
             ORDER BY c.nome_tio ASC, c.nome_tia ASC`,
            [tenantId]
        );
        const casalIds = (casais || []).map((c) => c.id).filter(Boolean);
        let servicosRows = [];
        if (casalIds.length) {
            const [rows] = await pool.query(
                `SELECT cs.casal_id, cs.equipe_id, cs.ejc_id, eq.nome AS equipe_nome,
                        e.numero AS ejc_numero, e.paroquia AS ejc_paroquia
                 FROM tios_casal_servicos cs
                 JOIN equipes eq ON eq.id = cs.equipe_id AND eq.tenant_id = cs.tenant_id
                 LEFT JOIN ejc e ON e.id = cs.ejc_id AND e.tenant_id = cs.tenant_id
                 WHERE cs.tenant_id = ? AND cs.casal_id IN (${casalIds.map(() => '?').join(',')})
                 ORDER BY eq.nome ASC, e.numero DESC`,
                [tenantId, ...casalIds]
            );
            servicosRows = rows || [];
        }
        const byCasal = new Map();
        for (const row of servicosRows) {
            if (!byCasal.has(row.casal_id)) byCasal.set(row.casal_id, []);
            byCasal.get(row.casal_id).push({
                equipe_id: row.equipe_id,
                equipe_nome: row.equipe_nome,
                ejc_id: row.ejc_id || null,
                ejc_numero: row.ejc_numero || null,
                ejc_paroquia: row.ejc_paroquia || null
            });
        }

        const payload = (casais || []).map((c) => ({
            ...c,
            servicos: byCasal.get(c.id) || [],
            equipes: Array.from(
                new Map((byCasal.get(c.id) || []).map((s) => [s.equipe_id, { id: s.equipe_id, nome: s.equipe_nome }])).values()
            ),
            equipe_ids: Array.from(new Set((byCasal.get(c.id) || []).map((s) => s.equipe_id)))
        }));
        return res.json(payload);
    } catch (err) {
        console.error('Erro ao listar casais de tios:', err);
        return res.status(500).json({ error: 'Erro ao listar casais.' });
    }
});

router.post('/casais', async (req, res) => {
    try {
        await ensureStructure();
        const tenantId = getTenantId(req);
        const nomeTio = String(req.body.nome_tio || '').trim();
        const telefoneTio = String(req.body.telefone_tio || '').trim();
        const dataNascimentoTio = normalizeDate(req.body.data_nascimento_tio);
        const nomeTia = String(req.body.nome_tia || '').trim();
        const telefoneTia = String(req.body.telefone_tia || '').trim();
        const dataNascimentoTia = normalizeDate(req.body.data_nascimento_tia);
        const observacoes = String(req.body.observacoes || '').trim() || null;
        const eccId = req.body.ecc_id ? Number(req.body.ecc_id) : null;
        const servicos = normalizeServicos(req.body.servicos, req.body.equipe_ids);
        const equipeIds = Array.from(new Set(servicos.map((s) => s.equipe_id)));
        const ejcIds = Array.from(new Set(servicos.map((s) => s.ejc_id).filter((id) => Number.isInteger(id) && id > 0)));

        if (!nomeTio || !telefoneTio || !nomeTia || !telefoneTia) {
            return res.status(400).json({ error: 'Dados obrigatórios: nome e telefone de tio e tia.' });
        }

        if (eccId) {
            const [eccRows] = await pool.query('SELECT id FROM tios_ecc WHERE id = ? AND tenant_id = ? LIMIT 1', [eccId, tenantId]);
            if (!eccRows.length) return res.status(400).json({ error: 'ECC inválido.' });
        }

        if (equipeIds.length) {
            const [validEquipes] = await pool.query(
                `SELECT id FROM equipes WHERE tenant_id = ? AND id IN (${equipeIds.map(() => '?').join(',')})`,
                [tenantId, ...equipeIds]
            );
            if ((validEquipes || []).length !== equipeIds.length) {
                return res.status(400).json({ error: 'Uma ou mais equipes informadas são inválidas.' });
            }
        }

        if (ejcIds.length) {
            const [validEjcs] = await pool.query(
                `SELECT id FROM ejc WHERE tenant_id = ? AND id IN (${ejcIds.map(() => '?').join(',')})`,
                [tenantId, ...ejcIds]
            );
            if ((validEjcs || []).length !== ejcIds.length) {
                return res.status(400).json({ error: 'Uma ou mais edições do EJC informadas são inválidas.' });
            }
        }

        const [result] = await pool.query(
            `INSERT INTO tios_casais
                (tenant_id, ecc_id, nome_tio, telefone_tio, data_nascimento_tio, nome_tia, telefone_tia, data_nascimento_tia, observacoes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [tenantId, eccId, nomeTio, telefoneTio, dataNascimentoTio, nomeTia, telefoneTia, dataNascimentoTia, observacoes]
        );
        const casalId = result.insertId;

        for (const equipeId of equipeIds) {
            // eslint-disable-next-line no-await-in-loop
            await pool.query(
                'INSERT IGNORE INTO tios_casal_equipes (tenant_id, casal_id, equipe_id) VALUES (?, ?, ?)',
                [tenantId, casalId, equipeId]
            );
        }
        for (const servico of servicos) {
            // eslint-disable-next-line no-await-in-loop
            await pool.query(
                'INSERT IGNORE INTO tios_casal_servicos (tenant_id, casal_id, equipe_id, ejc_id) VALUES (?, ?, ?, ?)',
                [tenantId, casalId, servico.equipe_id, servico.ejc_id]
            );
        }

        return res.status(201).json({ id: casalId, message: 'Casal de tios cadastrado com sucesso.' });
    } catch (err) {
        console.error('Erro ao criar casal de tios:', err);
        return res.status(500).json({ error: 'Erro ao criar casal de tios.' });
    }
});

router.put('/casais/:id', async (req, res) => {
    try {
        await ensureStructure();
        const tenantId = getTenantId(req);
        const casalId = Number(req.params.id);
        if (!casalId) return res.status(400).json({ error: 'ID inválido.' });

        const nomeTio = String(req.body.nome_tio || '').trim();
        const telefoneTio = String(req.body.telefone_tio || '').trim();
        const dataNascimentoTio = normalizeDate(req.body.data_nascimento_tio);
        const nomeTia = String(req.body.nome_tia || '').trim();
        const telefoneTia = String(req.body.telefone_tia || '').trim();
        const dataNascimentoTia = normalizeDate(req.body.data_nascimento_tia);
        const observacoes = String(req.body.observacoes || '').trim() || null;
        const eccId = req.body.ecc_id ? Number(req.body.ecc_id) : null;
        const servicos = normalizeServicos(req.body.servicos, req.body.equipe_ids);
        const equipeIds = Array.from(new Set(servicos.map((s) => s.equipe_id)));
        const ejcIds = Array.from(new Set(servicos.map((s) => s.ejc_id).filter((id) => Number.isInteger(id) && id > 0)));

        if (!nomeTio || !telefoneTio || !nomeTia || !telefoneTia) {
            return res.status(400).json({ error: 'Dados obrigatórios: nome e telefone de tio e tia.' });
        }

        if (eccId) {
            const [eccRows] = await pool.query('SELECT id FROM tios_ecc WHERE id = ? AND tenant_id = ? LIMIT 1', [eccId, tenantId]);
            if (!eccRows.length) return res.status(400).json({ error: 'ECC inválido.' });
        }

        if (equipeIds.length) {
            const [validEquipes] = await pool.query(
                `SELECT id FROM equipes WHERE tenant_id = ? AND id IN (${equipeIds.map(() => '?').join(',')})`,
                [tenantId, ...equipeIds]
            );
            if ((validEquipes || []).length !== equipeIds.length) {
                return res.status(400).json({ error: 'Uma ou mais equipes informadas são inválidas.' });
            }
        }

        if (ejcIds.length) {
            const [validEjcs] = await pool.query(
                `SELECT id FROM ejc WHERE tenant_id = ? AND id IN (${ejcIds.map(() => '?').join(',')})`,
                [tenantId, ...ejcIds]
            );
            if ((validEjcs || []).length !== ejcIds.length) {
                return res.status(400).json({ error: 'Uma ou mais edições do EJC informadas são inválidas.' });
            }
        }

        const [result] = await pool.query(
            `UPDATE tios_casais
             SET ecc_id = ?, nome_tio = ?, telefone_tio = ?, data_nascimento_tio = ?,
                 nome_tia = ?, telefone_tia = ?, data_nascimento_tia = ?, observacoes = ?
             WHERE id = ? AND tenant_id = ?`,
            [eccId, nomeTio, telefoneTio, dataNascimentoTio, nomeTia, telefoneTia, dataNascimentoTia, observacoes, casalId, tenantId]
        );
        if (!result.affectedRows) return res.status(404).json({ error: 'Casal não encontrado.' });

        await pool.query('DELETE FROM tios_casal_equipes WHERE casal_id = ? AND tenant_id = ?', [casalId, tenantId]);
        await pool.query('DELETE FROM tios_casal_servicos WHERE casal_id = ? AND tenant_id = ?', [casalId, tenantId]);
        for (const equipeId of equipeIds) {
            // eslint-disable-next-line no-await-in-loop
            await pool.query(
                'INSERT IGNORE INTO tios_casal_equipes (tenant_id, casal_id, equipe_id) VALUES (?, ?, ?)',
                [tenantId, casalId, equipeId]
            );
        }
        for (const servico of servicos) {
            // eslint-disable-next-line no-await-in-loop
            await pool.query(
                'INSERT IGNORE INTO tios_casal_servicos (tenant_id, casal_id, equipe_id, ejc_id) VALUES (?, ?, ?, ?)',
                [tenantId, casalId, servico.equipe_id, servico.ejc_id]
            );
        }

        return res.json({ message: 'Casal atualizado com sucesso.' });
    } catch (err) {
        console.error('Erro ao atualizar casal:', err);
        return res.status(500).json({ error: 'Erro ao atualizar casal.' });
    }
});

router.delete('/casais/:id', async (req, res) => {
    try {
        await ensureStructure();
        const tenantId = getTenantId(req);
        const casalId = Number(req.params.id);
        if (!casalId) return res.status(400).json({ error: 'ID inválido.' });
        await pool.query('DELETE FROM tios_casal_equipes WHERE casal_id = ? AND tenant_id = ?', [casalId, tenantId]);
        await pool.query('DELETE FROM tios_casal_servicos WHERE casal_id = ? AND tenant_id = ?', [casalId, tenantId]);
        const [result] = await pool.query('DELETE FROM tios_casais WHERE id = ? AND tenant_id = ?', [casalId, tenantId]);
        if (!result.affectedRows) return res.status(404).json({ error: 'Casal não encontrado.' });
        return res.json({ message: 'Casal removido com sucesso.' });
    } catch (err) {
        console.error('Erro ao remover casal:', err);
        return res.status(500).json({ error: 'Erro ao remover casal.' });
    }
});

module.exports = router;
