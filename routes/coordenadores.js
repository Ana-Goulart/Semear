const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const { getTenantId } = require('../lib/tenantIsolation');

let estruturaGarantida = false;

async function garantirEstrutura() {
    if (estruturaGarantida) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS coordenacoes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(120) NOT NULL,
            pasta_id INT NULL,
            periodo VARCHAR(50) NULL,
            descricao TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    try {
        await pool.query('ALTER TABLE coordenacoes ADD COLUMN pasta_id INT NULL');
    } catch (e) { }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS coordenacoes_pastas (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(120) NOT NULL,
            parent_id INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    try {
        await pool.query('ALTER TABLE coordenacoes_pastas ADD COLUMN parent_id INT NULL');
    } catch (e) { }
    try {
        await pool.query('ALTER TABLE coordenacoes_pastas ADD INDEX idx_coord_pastas_parent (parent_id)');
    } catch (e) { }
    try {
        await pool.query(`
            SELECT INDEX_NAME
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'coordenacoes_pastas'
              AND COLUMN_NAME = 'nome'
              AND NON_UNIQUE = 0
              AND INDEX_NAME <> 'PRIMARY'
        `).then(async ([idxRows]) => {
            for (const idx of idxRows || []) {
                await pool.query(`ALTER TABLE coordenacoes_pastas DROP INDEX \`${idx.INDEX_NAME}\``);
            }
        });
    } catch (e) { }
    try {
        const [idxRows] = await pool.query(`
            SELECT INDEX_NAME
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'coordenacoes'
              AND COLUMN_NAME = 'nome'
              AND NON_UNIQUE = 0
              AND INDEX_NAME <> 'PRIMARY'
        `);
        for (const idx of idxRows || []) {
            await pool.query(`ALTER TABLE coordenacoes DROP INDEX \`${idx.INDEX_NAME}\``);
        }
    } catch (e) { }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS coordenacoes_membros (
            id INT AUTO_INCREMENT PRIMARY KEY,
            coordenacao_id INT NOT NULL,
            jovem_id INT NOT NULL,
            comissao_id INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_coord_jovem (coordenacao_id, jovem_id),
            CONSTRAINT fk_coord_membro_coord FOREIGN KEY (coordenacao_id) REFERENCES coordenacoes(id) ON DELETE CASCADE,
            CONSTRAINT fk_coord_membro_jovem FOREIGN KEY (jovem_id) REFERENCES jovens(id) ON DELETE CASCADE
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS jovens_comissoes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            jovem_id INT NOT NULL,
            tipo VARCHAR(120) NOT NULL,
            ejc_numero INT NULL,
            paroquia VARCHAR(255) NULL,
            data_inicio DATE NULL,
            data_fim DATE NULL,
            funcao_garcom VARCHAR(50) NULL,
            semestre VARCHAR(20) NULL,
            circulo VARCHAR(50) NULL,
            coordenacao_nome VARCHAR(120) NULL,
            observacao TEXT NULL,
            outro_ejc_id INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (jovem_id) REFERENCES jovens(id) ON DELETE CASCADE
        )
    `);

    try {
        await pool.query('ALTER TABLE jovens_comissoes MODIFY COLUMN tipo VARCHAR(120) NOT NULL');
    } catch (e) { }
    try {
        await pool.query('ALTER TABLE jovens_comissoes ADD COLUMN coordenacao_nome VARCHAR(120) NULL');
    } catch (e) { }

    estruturaGarantida = true;
}

router.get('/pastas', async (req, res) => {
    try {
        await garantirEstrutura();
        const [rows] = await pool.query('SELECT id, nome, parent_id, created_at FROM coordenacoes_pastas ORDER BY nome ASC');
        res.json(rows);
    } catch (err) {
        console.error('Erro ao listar pastas de coordenações:', err);
        res.status(500).json({ error: 'Erro ao listar pastas' });
    }
});

router.get('/historico/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    try {
        await garantirEstrutura();

        const [[coordAtual]] = await pool.query(
            `SELECT c.id, c.nome, c.pasta_id, p.nome AS pasta_nome
             FROM coordenacoes c
             LEFT JOIN coordenacoes_pastas p ON p.id = c.pasta_id
             WHERE c.id = ? LIMIT 1`,
            [id]
        );
        if (!coordAtual) return res.status(404).json({ error: 'Coordenação não encontrada.' });

        const [coordenacoes] = await pool.query(
            `SELECT c.id, c.nome, c.pasta_id, p.nome AS pasta_nome, c.periodo, c.descricao, c.created_at
             FROM coordenacoes c
             LEFT JOIN coordenacoes_pastas p ON p.id = c.pasta_id
             WHERE COALESCE(c.pasta_id, 0) = COALESCE(?, 0)
             ORDER BY c.created_at DESC, c.id DESC`,
            [coordAtual.pasta_id || null]
        );

        const ids = coordenacoes.map(c => c.id);
        let membros = [];
        if (ids.length) {
            const placeholders = ids.map(() => '?').join(', ');
            const [rowsMembros] = await pool.query(
                `SELECT cm.id, cm.coordenacao_id, cm.jovem_id, cm.comissao_id, j.nome_completo, j.telefone, j.circulo
                 FROM coordenacoes_membros cm
                 JOIN jovens j ON j.id = cm.jovem_id
                 WHERE cm.coordenacao_id IN (${placeholders})
                 ORDER BY j.nome_completo ASC`,
                ids
            );
            membros = rowsMembros;
        }

        const mapa = new Map();
        coordenacoes.forEach(c => mapa.set(c.id, { ...c, membros: [] }));
        membros.forEach(m => {
            const item = mapa.get(m.coordenacao_id);
            if (item) item.membros.push(m);
        });

        res.json({
            nome: coordAtual.pasta_nome || coordAtual.nome,
            gestoes: Array.from(mapa.values())
        });
    } catch (err) {
        console.error('Erro ao buscar histórico de coordenação:', err);
        res.status(500).json({ error: 'Erro ao buscar histórico de coordenação' });
    }
});

router.post('/pastas', async (req, res) => {
    const nome = String(req.body.nome || '').trim();
    const parentId = req.body.parent_id ? Number(req.body.parent_id) : null;
    if (!nome) return res.status(400).json({ error: 'Nome da pasta é obrigatório.' });

    try {
        await garantirEstrutura();
        if (parentId) {
            const [parentRows] = await pool.query('SELECT id FROM coordenacoes_pastas WHERE id = ? LIMIT 1', [parentId]);
            if (!parentRows.length) return res.status(404).json({ error: 'Pasta pai não encontrada.' });
        }
        const [exists] = await pool.query(
            `SELECT id
             FROM coordenacoes_pastas
             WHERE LOWER(nome)=LOWER(?)
               AND COALESCE(parent_id, 0)=COALESCE(?, 0)
             LIMIT 1`,
            [nome, parentId || null]
        );
        if (exists.length) return res.status(409).json({ error: 'Já existe uma pasta com esse nome neste nível.' });

        const [result] = await pool.query('INSERT INTO coordenacoes_pastas (nome, parent_id) VALUES (?, ?)', [nome, parentId || null]);
        res.status(201).json({ id: result.insertId, message: 'Pasta criada com sucesso' });
    } catch (err) {
        console.error('Erro ao criar pasta de coordenações:', err);
        res.status(500).json({ error: 'Erro ao criar pasta' });
    }
});

router.put('/pastas/:id', async (req, res) => {
    const id = Number(req.params.id);
    const nome = String(req.body.nome || '').trim();
    const parentId = req.body.parent_id !== undefined ? (req.body.parent_id ? Number(req.body.parent_id) : null) : undefined;
    if (!id || !nome) return res.status(400).json({ error: 'Dados inválidos.' });

    try {
        await garantirEstrutura();
        const [rows] = await pool.query('SELECT id, parent_id FROM coordenacoes_pastas WHERE id = ? LIMIT 1', [id]);
        if (!rows.length) return res.status(404).json({ error: 'Pasta não encontrada.' });

        const parentFinal = parentId === undefined ? (rows[0].parent_id || null) : parentId;
        if (parentFinal && Number(parentFinal) === id) {
            return res.status(400).json({ error: 'A pasta não pode ser filha dela mesma.' });
        }
        if (parentFinal) {
            const [parentRows] = await pool.query('SELECT id FROM coordenacoes_pastas WHERE id = ? LIMIT 1', [parentFinal]);
            if (!parentRows.length) return res.status(404).json({ error: 'Pasta pai não encontrada.' });
        }

        const [dup] = await pool.query(
            `SELECT id
             FROM coordenacoes_pastas
             WHERE LOWER(nome)=LOWER(?)
               AND COALESCE(parent_id, 0)=COALESCE(?, 0)
               AND id <> ?
             LIMIT 1`,
            [nome, parentFinal || null, id]
        );
        if (dup.length) return res.status(409).json({ error: 'Já existe uma pasta com esse nome neste nível.' });

        await pool.query('UPDATE coordenacoes_pastas SET nome = ?, parent_id = ? WHERE id = ?', [nome, parentFinal || null, id]);
        res.json({ message: 'Pasta atualizada com sucesso' });
    } catch (err) {
        console.error('Erro ao atualizar pasta de coordenações:', err);
        res.status(500).json({ error: 'Erro ao atualizar pasta' });
    }
});

router.delete('/pastas/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const connection = await pool.getConnection();
    try {
        await garantirEstrutura();
        await connection.beginTransaction();

        const [filhas] = await connection.query(
            'SELECT id FROM coordenacoes_pastas WHERE parent_id = ? LIMIT 1',
            [id]
        );
        if (filhas.length) {
            await connection.rollback();
            return res.status(409).json({ error: 'Esta pasta possui subpastas. Remova as subpastas primeiro.' });
        }

        await connection.query('UPDATE coordenacoes SET pasta_id = NULL WHERE pasta_id = ?', [id]);
        await connection.query('DELETE FROM coordenacoes_pastas WHERE id = ?', [id]);

        await connection.commit();
        res.json({ message: 'Pasta removida com sucesso' });
    } catch (err) {
        await connection.rollback();
        console.error('Erro ao remover pasta de coordenações:', err);
        res.status(500).json({ error: 'Erro ao remover pasta' });
    } finally {
        connection.release();
    }
});

router.get('/', async (req, res) => {
    try {
        await garantirEstrutura();
        const [coordenacoes] = await pool.query(
            `SELECT c.id, c.nome, c.pasta_id, p.nome AS pasta_nome, c.periodo, c.descricao, c.created_at
             FROM coordenacoes c
             LEFT JOIN coordenacoes_pastas p ON p.id = c.pasta_id
             ORDER BY COALESCE(p.nome, 'zzzz'), c.created_at DESC, c.id DESC`
        );
        const [membros] = await pool.query(`
            SELECT cm.id, cm.coordenacao_id, cm.jovem_id, cm.comissao_id, j.nome_completo, j.telefone, j.circulo
            FROM coordenacoes_membros cm
            JOIN jovens j ON j.id = cm.jovem_id
            ORDER BY j.nome_completo ASC
        `);

        const mapa = new Map();
        coordenacoes.forEach(c => mapa.set(c.id, { ...c, membros: [] }));
        membros.forEach(m => {
            const item = mapa.get(m.coordenacao_id);
            if (item) item.membros.push(m);
        });
        res.json(Array.from(mapa.values()));
    } catch (err) {
        console.error('Erro ao listar coordenações:', err);
        res.status(500).json({ error: 'Erro ao listar coordenações' });
    }
});

router.post('/', async (req, res) => {
    const pastaId = req.body.pasta_id ? Number(req.body.pasta_id) : null;
    const periodo = String(req.body.periodo || '').trim();
    const descricao = String(req.body.descricao || '').trim();
    if (!pastaId) return res.status(400).json({ error: 'Selecione uma pasta para criar a coordenação.' });
    if (!periodo) return res.status(400).json({ error: 'Período é obrigatório.' });

    try {
        await garantirEstrutura();
        const [pastaRows] = await pool.query('SELECT id, nome FROM coordenacoes_pastas WHERE id = ? LIMIT 1', [pastaId]);
        if (!pastaRows.length) return res.status(404).json({ error: 'Pasta não encontrada.' });
        const nomeCoordenacao = String(pastaRows[0].nome || '').trim();

        const [exists] = await pool.query(
            `SELECT id
             FROM coordenacoes
             WHERE COALESCE(pasta_id, 0) = COALESCE(?, 0)
               AND LOWER(COALESCE(periodo, '')) = LOWER(COALESCE(?, ''))
             LIMIT 1`,
            [pastaId || null, periodo || null]
        );
        if (exists.length) return res.status(409).json({ error: 'Já existe um registro com esse período nesta coordenação.' });

        const [result] = await pool.query(
            'INSERT INTO coordenacoes (nome, pasta_id, periodo, descricao) VALUES (?, ?, ?, ?)',
            [nomeCoordenacao, pastaId || null, periodo || null, descricao || null]
        );
        res.status(201).json({ id: result.insertId, message: 'Coordenação criada com sucesso' });
    } catch (err) {
        console.error('Erro ao criar coordenação:', err);
        res.status(500).json({ error: 'Erro ao criar coordenação' });
    }
});

router.put('/:id', async (req, res) => {
    const id = Number(req.params.id);
    const pastaId = req.body.pasta_id ? Number(req.body.pasta_id) : null;
    const periodo = String(req.body.periodo || '').trim();
    const descricao = String(req.body.descricao || '').trim();
    if (!id) return res.status(400).json({ error: 'Dados inválidos.' });
    if (!pastaId) return res.status(400).json({ error: 'Selecione uma pasta para salvar a coordenação.' });
    if (!periodo) return res.status(400).json({ error: 'Período é obrigatório.' });

    const connection = await pool.getConnection();
    try {
        await garantirEstrutura();
        await connection.beginTransaction();

        const [rows] = await connection.query('SELECT id FROM coordenacoes WHERE id = ? LIMIT 1', [id]);
        if (!rows.length) {
            await connection.rollback();
            return res.status(404).json({ error: 'Coordenação não encontrada.' });
        }

        const [pastaRows] = await connection.query('SELECT id, nome FROM coordenacoes_pastas WHERE id = ? LIMIT 1', [pastaId]);
        if (!pastaRows.length) {
            await connection.rollback();
            return res.status(404).json({ error: 'Pasta não encontrada.' });
        }
        const nomeCoordenacao = String(pastaRows[0].nome || '').trim();

        const [exists] = await connection.query(
            `SELECT id
             FROM coordenacoes
             WHERE COALESCE(pasta_id, 0)=COALESCE(?, 0)
               AND LOWER(COALESCE(periodo, '')) = LOWER(COALESCE(?, ''))
               AND id <> ?
             LIMIT 1`,
            [pastaId || null, periodo || null, id]
        );
        if (exists.length) {
            await connection.rollback();
            return res.status(409).json({ error: 'Já existe um registro com esse período nesta coordenação.' });
        }

        await connection.query(
            'UPDATE coordenacoes SET nome = ?, pasta_id = ?, periodo = ?, descricao = ? WHERE id = ?',
            [nomeCoordenacao, pastaId || null, periodo || null, descricao || null, id]
        );

        await connection.query(
            `UPDATE jovens_comissoes jc
             JOIN coordenacoes_membros cm ON cm.comissao_id = jc.id
             SET jc.coordenacao_nome = ?, jc.semestre = ?
             WHERE cm.coordenacao_id = ?`,
            [nomeCoordenacao, periodo || null, id]
        );

        await connection.commit();
        res.json({ message: 'Coordenação atualizada com sucesso' });
    } catch (err) {
        await connection.rollback();
        console.error('Erro ao atualizar coordenação:', err);
        res.status(500).json({ error: 'Erro ao atualizar coordenação' });
    } finally {
        connection.release();
    }
});

router.delete('/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const connection = await pool.getConnection();
    try {
        await garantirEstrutura();
        await connection.beginTransaction();

        const [membros] = await connection.query(
            'SELECT comissao_id FROM coordenacoes_membros WHERE coordenacao_id = ?',
            [id]
        );
        const idsComissao = membros.map(m => m.comissao_id).filter(Boolean);
        if (idsComissao.length) {
            const placeholders = idsComissao.map(() => '?').join(', ');
            await connection.query(`DELETE FROM jovens_comissoes WHERE id IN (${placeholders})`, idsComissao);
        }

        await connection.query('DELETE FROM coordenacoes_membros WHERE coordenacao_id = ?', [id]);
        await connection.query('DELETE FROM coordenacoes WHERE id = ?', [id]);

        await connection.commit();
        res.json({ message: 'Coordenação removida com sucesso' });
    } catch (err) {
        await connection.rollback();
        console.error('Erro ao remover coordenação:', err);
        res.status(500).json({ error: 'Erro ao remover coordenação' });
    } finally {
        connection.release();
    }
});

router.post('/:id/membros', async (req, res) => {
    const coordenacaoId = Number(req.params.id);
    const jovemId = Number(req.body.jovem_id);
    if (!coordenacaoId || !jovemId) return res.status(400).json({ error: 'Dados inválidos.' });

    const connection = await pool.getConnection();
    try {
        const tenantId = getTenantId(req);
        await garantirEstrutura();
        await connection.beginTransaction();

        const [[coord]] = await connection.query(
            'SELECT id, nome, periodo FROM coordenacoes WHERE id = ? LIMIT 1',
            [coordenacaoId]
        );
        if (!coord) {
            await connection.rollback();
            return res.status(404).json({ error: 'Coordenação não encontrada.' });
        }

        const [jaExiste] = await connection.query(
            'SELECT id FROM coordenacoes_membros WHERE coordenacao_id = ? AND jovem_id = ? LIMIT 1',
            [coordenacaoId, jovemId]
        );
        if (jaExiste.length) {
            await connection.rollback();
            return res.status(409).json({ error: 'Este jovem já está nesta coordenação.' });
        }

        const [comissaoResult] = await connection.query(
            `INSERT INTO jovens_comissoes 
             (tenant_id, jovem_id, tipo, semestre, coordenacao_nome, observacao)
             VALUES (?, ?, 'COORDENACAO', ?, ?, ?)`,
            [tenantId, jovemId, coord.periodo || null, coord.nome, null]
        );

        await connection.query(
            'INSERT INTO coordenacoes_membros (coordenacao_id, jovem_id, comissao_id) VALUES (?, ?, ?)',
            [coordenacaoId, jovemId, comissaoResult.insertId]
        );

        await connection.commit();
        res.status(201).json({ message: 'Jovem adicionado à coordenação' });
    } catch (err) {
        await connection.rollback();
        console.error('Erro ao adicionar jovem na coordenação:', err);
        const msg = err && (err.sqlMessage || err.message) ? (err.sqlMessage || err.message) : 'Erro ao adicionar jovem na coordenação';
        res.status(500).json({ error: msg });
    } finally {
        connection.release();
    }
});

router.delete('/membros/:id', async (req, res) => {
    const membroId = Number(req.params.id);
    if (!membroId) return res.status(400).json({ error: 'ID inválido.' });

    const connection = await pool.getConnection();
    try {
        await garantirEstrutura();
        await connection.beginTransaction();

        const [[membro]] = await connection.query(
            'SELECT id, comissao_id FROM coordenacoes_membros WHERE id = ? LIMIT 1',
            [membroId]
        );
        if (!membro) {
            await connection.rollback();
            return res.status(404).json({ error: 'Vínculo não encontrado.' });
        }

        if (membro.comissao_id) {
            await connection.query('DELETE FROM jovens_comissoes WHERE id = ?', [membro.comissao_id]);
        }
        await connection.query('DELETE FROM coordenacoes_membros WHERE id = ?', [membroId]);

        await connection.commit();
        res.json({ message: 'Jovem removido da coordenação' });
    } catch (err) {
        await connection.rollback();
        console.error('Erro ao remover jovem da coordenação:', err);
        res.status(500).json({ error: 'Erro ao remover jovem da coordenação' });
    } finally {
        connection.release();
    }
});

module.exports = router;
