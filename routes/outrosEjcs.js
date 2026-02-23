const express = require('express');
const router = express.Router();
const db = require('../database');
const { getTenantId } = require('../lib/tenantIsolation');

async function hasTable(tableName) {
    const [rows] = await db.pool.query(`
        SELECT COUNT(*) AS cnt
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
    `, [tableName]);
    return !!(rows && rows[0] && rows[0].cnt > 0);
}

async function hasColumn(tableName, columnName) {
    const [rows] = await db.pool.query(`
        SELECT COUNT(*) AS cnt
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
    `, [tableName, columnName]);
    return !!(rows && rows[0] && rows[0].cnt > 0);
}

// GET /api/outros-ejcs
router.get('/', async (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const [rows] = await db.pool.query('SELECT * FROM outros_ejcs WHERE tenant_id = ? ORDER BY created_at DESC', [tenantId]);
        res.json(rows);
    } catch (error) {
        console.error("Erro ao listar outros EJCs:", error);
        res.status(500).json({ error: 'Erro ao listar outros EJCs' });
    }
});

// GET /api/outros-ejcs/:id/presencas
router.get('/:id/presencas', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'ID inválido.' });
    }

    try {
        const tenantId = getTenantId(req);
        const hasPresencas = await hasTable('formularios_presencas');
        const hasFormularios = await hasTable('formularios_itens');
        const hasOutroEjcId = hasPresencas ? await hasColumn('formularios_presencas', 'outro_ejc_id') : false;
        if (!hasPresencas || !hasFormularios || !hasOutroEjcId) return res.json([]);

        const [rows] = await db.pool.query(`
            SELECT
                fp.id,
                fp.nome_completo,
                fp.telefone,
                fp.registrado_em,
                fi.titulo AS evento_titulo,
                fi.evento_data
            FROM formularios_presencas fp
            JOIN formularios_itens fi ON fi.id = fp.formulario_id
            WHERE fp.outro_ejc_id = ?
              AND fp.tenant_id = ?
            ORDER BY fp.registrado_em DESC
        `, [id, tenantId]);

        const map = new Map();
        for (const row of rows) {
            const nome = String(row.nome_completo || '').trim() || 'Sem nome';
            const telefone = String(row.telefone || '').trim() || '';
            const key = `${nome}::${telefone}`;
            const evento = {
                titulo: row.evento_titulo || 'Evento sem título',
                data: row.evento_data || null,
                registrado_em: row.registrado_em || null
            };

            if (!map.has(key)) {
                map.set(key, {
                    nome_completo: nome,
                    telefone: telefone || '-',
                    eventos: [evento]
                });
            } else {
                map.get(key).eventos.push(evento);
            }
        }

        return res.json(Array.from(map.values()));
    } catch (error) {
        console.error('Erro ao listar presenças por outro EJC:', error);
        return res.status(500).json({ error: 'Erro ao listar presenças.' });
    }
});

// GET /api/outros-ejcs/:id/conjuges
router.get('/:id/conjuges', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'ID inválido.' });
    }

    try {
        const tenantId = getTenantId(req);
        const hasJovens = await hasTable('jovens');
        if (!hasJovens) return res.json([]);

        const hasConjugeOutroEjcId = await hasColumn('jovens', 'conjuge_outro_ejc_id');
        const hasConjugeNome = await hasColumn('jovens', 'conjuge_nome');
        const hasConjugeTelefone = await hasColumn('jovens', 'conjuge_telefone');
        if (!hasConjugeOutroEjcId || !hasConjugeNome || !hasConjugeTelefone) return res.json([]);

        const [rows] = await db.pool.query(`
            SELECT
                j.id AS jovem_id,
                j.nome_completo AS jovem_nome,
                j.telefone AS jovem_telefone,
                j.conjuge_nome,
                j.conjuge_telefone
            FROM jovens j
            WHERE j.conjuge_outro_ejc_id = ?
              AND j.tenant_id = ?
              AND COALESCE(TRIM(j.conjuge_nome), '') <> ''
            ORDER BY j.conjuge_nome ASC, j.nome_completo ASC
        `, [id, tenantId]);

        const payload = rows.map(r => ({
            jovem_id: r.jovem_id,
            jovem_nome: r.jovem_nome || '-',
            conjuge_nome: r.conjuge_nome || '-',
            telefone: r.conjuge_telefone || r.jovem_telefone || '-'
        }));

        return res.json(payload);
    } catch (error) {
        console.error('Erro ao listar cônjuges por outro EJC:', error);
        return res.status(500).json({ error: 'Erro ao listar cônjuges.' });
    }
});

// POST /api/outros-ejcs
router.post('/', async (req, res) => {
    const { nome, paroquia, bairro } = req.body;
    try {
        const tenantId = getTenantId(req);
        if (!nome) {
            return res.status(400).json({ error: 'O nome do EJC é obrigatório.' });
        }
        const [result] = await db.pool.query(
            'INSERT INTO outros_ejcs (tenant_id, nome, paroquia, bairro) VALUES (?, ?, ?, ?)',
            [tenantId, nome, paroquia || null, bairro || null]
        );
        res.status(201).json({ message: 'Outro EJC criado com sucesso!', id: result.insertId });
    } catch (error) {
        console.error("Erro ao criar outro EJC:", error);
        res.status(500).json({ error: 'Erro ao criar outro EJC' });
    }
});

// PUT /api/outros-ejcs/:id
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { nome, paroquia, bairro } = req.body;
    try {
        const tenantId = getTenantId(req);
        if (!nome) {
            return res.status(400).json({ error: 'O nome do EJC é obrigatório.' });
        }
        const [result] = await db.pool.query(
            'UPDATE outros_ejcs SET nome = ?, paroquia = ?, bairro = ? WHERE id = ? AND tenant_id = ?',
            [nome, paroquia || null, bairro || null, id, tenantId]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Outro EJC não encontrado.' });
        }
        res.json({ message: 'Outro EJC atualizado com sucesso!' });
    } catch (error) {
        console.error("Erro ao atualizar outro EJC:", error);
        res.status(500).json({ error: 'Erro ao atualizar outro EJC' });
    }
});

// DELETE /api/outros-ejcs/:id
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const tenantId = getTenantId(req);
        const [result] = await db.pool.query('DELETE FROM outros_ejcs WHERE id = ? AND tenant_id = ?', [id, tenantId]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Outro EJC não encontrado.' });
        }
        res.json({ message: 'Outro EJC excluído com sucesso!' });
    } catch (error) {
        console.error("Erro ao excluir outro EJC:", error);
        res.status(500).json({ error: 'Erro ao excluir outro EJC' });
    }
});

module.exports = router;
