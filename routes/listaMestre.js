const express = require('express');
const router = express.Router();
const { pool } = require('../database');

// GET - Listar todos (API principal da Lista Mestre)
router.get('/', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT j.*, e.numero as numero_ejc, e.paroquia as paroquia_ejc 
            FROM jovens j 
            LEFT JOIN ejc e ON j.numero_ejc_fez = e.id 
            ORDER BY j.nome_completo ASC
        `);
        res.json(rows);
    } catch (err) {
        console.error("Erro detalhado no banco:", err);
        res.status(500).json({ error: "Erro interno ao acessar o banco" });
    }
});

// GET - Busca rápida de jovens por nome (autocomplete)
router.get('/search', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    try {
        const like = `%${q}%`;
        const [rows] = await pool.query(`SELECT id, nome_completo, telefone, numero_ejc_fez FROM jovens WHERE nome_completo LIKE ? ORDER BY nome_completo LIMIT 20`, [like]);
        res.json(rows);
    } catch (err) {
        console.error('Erro na busca de jovens:', err);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// GET - Relatório completo de histórico para exportação
router.get('/relatorio/historico-completo', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT he.jovem_id, he.equipe, he.papel, e.numero as numero_ejc, e.id as ejc_id
            FROM historico_equipes he
            JOIN ejc e ON he.ejc_id = e.id
            ORDER BY he.jovem_id, e.numero
        `);
        res.json(rows);
    } catch (err) {
        console.error("Erro ao buscar histórico completo:", err);
        res.status(500).json({ error: "Erro no servidor" });
    }
});

// GET - Buscar um jovem por id
router.get('/:id', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT j.*, e.numero as numero_ejc, e.paroquia as paroquia_ejc
            FROM jovens j
            LEFT JOIN ejc e ON j.numero_ejc_fez = e.id
            WHERE j.id = ?
        `, [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Jovem não encontrado' });
        res.json(rows[0]);
    } catch (err) {
        console.error('Erro ao buscar jovem:', err);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// POST - Criar novo jovem
router.post('/', async (req, res) => {
    function normalizeDate(d) {
        if (d === null || d === undefined || d === '') return null;
        if (typeof d === 'string') {
            if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
            if (d.indexOf('T') !== -1) return d.split('T')[0];
        }
        try {
            const dt = new Date(d);
            if (isNaN(dt.getTime())) return null;
            return dt.toISOString().split('T')[0];
        } catch (e) { return null; }
    }

    try {
        const { nome_completo, telefone, data_nascimento, numero_ejc_fez, instagram, estado_civil, data_casamento, circulo, deficiencia, qual_deficiencia } = req.body;

        if (!nome_completo || !telefone) {
            return res.status(400).json({ error: "Nome completo e telefone são obrigatórios" });
        }

        const [result] = await pool.query(
            `INSERT INTO jovens (nome_completo, telefone, data_nascimento, numero_ejc_fez, instagram, estado_civil, data_casamento, circulo, deficiencia, qual_deficiencia) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                nome_completo,
                telefone,
                normalizeDate(data_nascimento),
                numero_ejc_fez || null,
                instagram || null,
                estado_civil || 'Solteiro',
                normalizeDate(data_casamento),
                circulo || null,
                deficiencia ? 1 : 0,
                qual_deficiencia || null
            ]
        );

        res.json({ id: result.insertId, message: "Jovem criado com sucesso" });
    } catch (err) {
        console.error("Erro ao criar jovem:", err);
        res.status(500).json({ error: "Erro ao criar jovem" });
    }
});

// PUT - Atualizar jovem
router.put('/:id', async (req, res) => {
    const { id } = req.params;

    function normalizeDate(d) {
        if (d === null || d === undefined || d === '') return null;
        if (typeof d === 'string') {
            if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
            if (d.indexOf('T') !== -1) return d.split('T')[0];
        }
        try {
            const dt = new Date(d);
            if (isNaN(dt.getTime())) return null;
            return dt.toISOString().split('T')[0];
        } catch (e) { return null; }
    }

    try {
        const [rows] = await pool.query('SELECT * FROM jovens WHERE id = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Jovem não encontrado' });
        const atual = rows[0];

        function actualValueOrNull(v) { return v === undefined ? null : v; }

        const merged = {
            nome_completo: req.body.nome_completo !== undefined ? req.body.nome_completo : atual.nome_completo,
            telefone: req.body.telefone !== undefined ? req.body.telefone : atual.telefone,
            data_nascimento: req.body.data_nascimento !== undefined ? normalizeDate(req.body.data_nascimento) : (atual.data_nascimento ? normalizeDate(atual.data_nascimento) : null),
            numero_ejc_fez: req.body.numero_ejc_fez !== undefined ? req.body.numero_ejc_fez : atual.numero_ejc_fez,
            instagram: req.body.instagram !== undefined ? req.body.instagram : (atual.instagram === undefined ? null : atual.instagram),
            estado_civil: req.body.estado_civil !== undefined ? req.body.estado_civil : atual.estado_civil,
            data_casamento: req.body.data_casamento !== undefined ? normalizeDate(req.body.data_casamento) : (atual.data_casamento ? normalizeDate(atual.data_casamento) : null),
            circulo: req.body.circulo !== undefined ? req.body.circulo : atual.circulo,
            deficiencia: req.body.deficiencia !== undefined ? (req.body.deficiencia ? 1 : 0) : (typeof atual.deficiencia === 'number' ? atual.deficiencia : (atual.deficiencia ? 1 : 0)),
            qual_deficiencia: req.body.qual_deficiencia !== undefined ? req.body.qual_deficiencia : atual.qual_deficiencia,
            conjuge_id: req.body.conjuge_id !== undefined ? req.body.conjuge_id : atual.conjuge_id,
            conjuge_nome: req.body.conjuge_nome !== undefined ? req.body.conjuge_nome : atual.conjuge_nome,
            conjuge_telefone: req.body.conjuge_telefone !== undefined ? req.body.conjuge_telefone : actualValueOrNull(atual.conjuge_telefone),
            conjuge_ejc_id: req.body.conjuge_ejc_id !== undefined ? req.body.conjuge_ejc_id : atual.conjuge_ejc_id,
            conjuge_paroquia: req.body.conjuge_paroquia !== undefined ? req.body.conjuge_paroquia : atual.conjuge_paroquia,
            observacoes_extras: req.body.observacoes_extras !== undefined ? req.body.observacoes_extras : atual.observacoes_extras
        };

        let resolvedConjugeId = merged.conjuge_id || null;
        if (!resolvedConjugeId && merged.conjuge_nome) {
            try {
                const likeName = merged.conjuge_nome.trim();
                const phone = merged.conjuge_telefone || '';
                const [found] = await pool.query(
                    `SELECT id FROM jovens WHERE nome_completo = ? OR telefone = ? LIMIT 1`,
                    [likeName, phone]
                );
                if (found && found.length) resolvedConjugeId = found[0].id;
                merged.conjuge_id = resolvedConjugeId;
            } catch (e) {
                resolvedConjugeId = merged.conjuge_id || null;
            }
        }

        const [colCheck] = await pool.query(`
            SELECT COUNT(*) as cnt FROM information_schema.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'jovens' AND COLUMN_NAME = 'conjuge_paroquia'
        `);
        const hasConjugeParoquia = (colCheck && colCheck[0] && colCheck[0].cnt > 0) || false;

        let updateFields = `nome_completo=?, telefone=?, data_nascimento=?, numero_ejc_fez=?, instagram=?, estado_civil=?, data_casamento=?, circulo=?, deficiencia=?, qual_deficiencia=?, conjuge_id=?, conjuge_nome=?, conjuge_telefone=?, conjuge_ejc_id=?, observacoes_extras=?`;
        const params = [merged.nome_completo, merged.telefone, merged.data_nascimento, merged.numero_ejc_fez, merged.instagram, merged.estado_civil, merged.data_casamento, merged.circulo, merged.deficiencia, merged.qual_deficiencia, merged.conjuge_id || null, merged.conjuge_nome || null, merged.conjuge_telefone || null, merged.conjuge_ejc_id || null, merged.observacoes_extras || null];
        if (hasConjugeParoquia) {
            updateFields += ', conjuge_paroquia=?';
            params.push(merged.conjuge_paroquia || null);
        }
        params.push(id);

        await pool.query(`UPDATE jovens SET ${updateFields} WHERE id=?`, params);

        // ... lógica de cônjuge (sincronização) ...
        const previousConjugeId = atual.conjuge_id || null;
        const newConjugeId = merged.conjuge_id || null;

        if (previousConjugeId && previousConjugeId !== newConjugeId) {
            let clearFields = 'conjuge_id=NULL, conjuge_nome=NULL, conjuge_telefone=NULL, conjuge_ejc_id=NULL';
            if (hasConjugeParoquia) clearFields += ', conjuge_paroquia=NULL';
            await pool.query(`UPDATE jovens SET ${clearFields} WHERE id = ?`, [previousConjugeId]);
        }

        if (newConjugeId) {
            try {
                const [sp] = await pool.query('SELECT * FROM jovens WHERE id = ?', [newConjugeId]);
                if (sp && sp.length) {
                    const parceiro = sp[0];
                    const parceiroEstado = parceiro.estado_civil;
                    const parceiroDataCasamento = parceiro.data_casamento;
                    const shouldSetCasado = parceiroEstado === 'Solteiro';
                    const finalEstado = shouldSetCasado ? 'Casado' : parceiroEstado;
                    const finalDataCasamento = merged.data_casamento || parceiroDataCasamento || null;

                    await pool.query(
                        `UPDATE jovens SET conjuge_id=?, conjuge_nome=?, conjuge_telefone=?, conjuge_ejc_id=?, estado_civil=?, data_casamento=? WHERE id=?`,
                        [id, merged.nome_completo || atual.nome_completo, merged.telefone || actualValueOrNull(atual.telefone), merged.numero_ejc_fez || atual.numero_ejc_fez, finalEstado, finalDataCasamento, newConjugeId]
                    );
                }
            } catch (e) {
                console.error('Erro ao sincronizar cônjuge:', e);
            }
        }

        if (merged.estado_civil === 'Solteiro') {
            const linkedId = atual.conjuge_id || merged.conjuge_id || null;
            try {
                if (linkedId) {
                    let clearPartnerFields = "conjuge_id=NULL, conjuge_nome=NULL, conjuge_telefone=NULL, conjuge_ejc_id=NULL";
                    if (hasConjugeParoquia) clearPartnerFields += ', conjuge_paroquia=NULL';
                    clearPartnerFields += ", estado_civil='Solteiro', data_casamento=NULL";
                    await pool.query(
                        `UPDATE jovens SET ${clearPartnerFields} WHERE id = ?`,
                        [linkedId]
                    );
                }
                let clearSelfFields = 'conjuge_id=NULL, conjuge_nome=NULL, conjuge_telefone=NULL, conjuge_ejc_id=NULL';
                if (hasConjugeParoquia) clearSelfFields += ', conjuge_paroquia=NULL';
                await pool.query(`UPDATE jovens SET ${clearSelfFields} WHERE id = ?`, [id]);
            } catch (e) {
                console.error('Erro ao desfazer vínculos de cônjuge:', e);
            }
        }

        res.json({ message: "Jovem atualizado com sucesso" });
    } catch (err) {
        console.error("Erro ao atualizar jovem:", err);
        res.status(500).json({ error: "Erro ao salvar alterações" });
    }
});

// DELETE - Deletar jovem
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM historico_equipes WHERE jovem_id = ?', [id]);
        const [result] = await pool.query('DELETE FROM jovens WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Jovem não encontrado" });
        }

        res.json({ message: "Jovem deletado com sucesso" });
    } catch (err) {
        console.error("Erro ao deletar jovem:", err);
        res.status(500).json({ error: "Erro ao deletar jovem" });
    }
});

// POST - Importação
router.post('/importacao', async (req, res) => {
    const dados = req.body;
    if (!Array.isArray(dados)) return res.status(400).json({ error: "Formato inválido" });

    let criados = 0;
    let atualizados = 0;
    let erros = 0;

    const connection = await pool.getConnection();

    try {
        for (const item of dados) {
            try {
                const j = item.jovem;
                let jovemId = null;

                const [exists] = await connection.query(
                    'SELECT id FROM jovens WHERE nome_completo = ? OR (telefone = ? AND telefone IS NOT NULL AND telefone != "") LIMIT 1',
                    [j.nome_completo, j.telefone]
                );

                if (exists.length > 0) {
                    jovemId = exists[0].id;
                    await connection.query(
                        `UPDATE jovens SET 
                            telefone = COALESCE(?, telefone),
                            data_nascimento = COALESCE(?, data_nascimento),
                            numero_ejc_fez = COALESCE(?, numero_ejc_fez),
                            instagram = COALESCE(?, instagram),
                            estado_civil = COALESCE(?, estado_civil),
                            data_casamento = COALESCE(?, data_casamento),
                            circulo = COALESCE(?, circulo),
                            deficiencia = COALESCE(?, deficiencia),
                            qual_deficiencia = COALESCE(?, qual_deficiencia),
                            conjuge_nome = COALESCE(?, conjuge_nome)
                        WHERE id = ?`,
                        [j.telefone, j.data_nascimento, j.numero_ejc_fez, j.instagram, j.estado_civil, j.data_casamento, j.circulo, j.deficiencia, j.qual_deficiencia, j.conjuge_nome, jovemId]
                    );
                    atualizados++;
                } else {
                    const [resInsert] = await connection.query(
                        `INSERT INTO jovens (nome_completo, telefone, data_nascimento, numero_ejc_fez, instagram, estado_civil, data_casamento, circulo, deficiencia, qual_deficiencia, conjuge_nome)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [j.nome_completo, j.telefone, j.data_nascimento, j.numero_ejc_fez, j.instagram, j.estado_civil, j.data_casamento, j.circulo, j.deficiencia, j.qual_deficiencia, j.conjuge_nome]
                    );
                    jovemId = resInsert.insertId;
                    criados++;
                }

                if (item.historico && item.historico.length > 0) {
                    for (const hist of item.historico) {
                        const [histExists] = await connection.query(
                            'SELECT id FROM historico_equipes WHERE jovem_id = ? AND ejc_id = ? AND equipe = ?',
                            [jovemId, hist.ejc_id, hist.equipe]
                        );

                        if (histExists.length === 0) {
                            await connection.query(
                                'INSERT INTO historico_equipes (jovem_id, equipe, ejc_id, papel) VALUES (?, ?, ?, ?)',
                                [jovemId, hist.equipe, hist.ejc_id, hist.papel || 'Membro']
                            );
                        }
                    }
                }

            } catch (errInner) {
                console.error("Erro ao importar item:", j.nome_completo, errInner);
                erros++;
            }
        }
        res.json({ message: "Importação concluída", resumo: { criados, atualizados, erros } });
    } catch (err) {
        console.error("Erro geral na importação:", err);
        res.status(500).json({ error: "Erro no servidor durante importação" });
    } finally {
        connection.release();
    }
});

// GET - Histórico de equipes de um jovem
router.get('/historico/:jovemId', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT he.*, eq.nome as nome_equipe, e.numero as numero_ejc, e.paroquia as paroquia_ejc
            FROM historico_equipes he 
            LEFT JOIN equipes eq ON he.equipe = eq.nome 
            LEFT JOIN ejc e ON he.ejc_id = e.id
            WHERE he.jovem_id = ?
            ORDER BY e.numero DESC
        `, [req.params.jovemId]);
        res.json(rows);
    } catch (err) {
        console.error("Erro ao buscar histórico:", err);
        res.status(500).json({ error: "Erro no servidor" });
    }
});

// POST - Adicionar histórico manualmente
router.post('/historico', async (req, res) => {
    const { jovem_id, equipe_nome, ejc_id, papel } = req.body;

    if (!jovem_id || !equipe_nome || !ejc_id) {
        return res.status(400).json({ error: "Jovem, Equipe e EJC são obrigatórios" });
    }

    try {
        const [result] = await pool.query(
            'INSERT INTO historico_equipes (jovem_id, equipe, ejc_id, papel) VALUES (?, ?, ?, ?)',
            [jovem_id, equipe_nome, ejc_id, papel || 'Membro']
        );
        res.json({ id: result.insertId, message: "Equipe adicionada ao histórico com sucesso" });
    } catch (err) {
        console.error("Erro ao adicionar histórico:", err);
        res.status(500).json({ error: "Erro ao adicionar equipe ao histórico" });
    }
});

// DELETE - Remover histórico
router.delete('/historico/:id', async (req, res) => {
    try {
        const [result] = await pool.query('DELETE FROM historico_equipes WHERE id = ?', [req.params.id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Registro não encontrado" });
        }
        res.json({ message: "Histórico removido com sucesso" });
    } catch (err) {
        console.error("Erro ao remover histórico:", err);
        res.status(500).json({ error: "Erro ao remover histórico" });
    }
});

// --- COMISSÕES / HISTÓRICO EXTERNO ---

// GET - Listar comissões de um jovem
router.get('/comissoes/:jovemId', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT jc.*, oe.nome as outro_ejc_nome, oe.paroquia as outro_ejc_paroquia 
            FROM jovens_comissoes jc 
            LEFT JOIN outros_ejcs oe ON jc.outro_ejc_id = oe.id 
            WHERE jc.jovem_id = ? 
            ORDER BY jc.id DESC
        `, [req.params.jovemId]);
        res.json(rows);
    } catch (err) {
        console.error("Erro ao buscar comissões:", err);
        res.status(500).json({ error: "Erro ao buscar comissões" });
    }
});

// POST - Adicionar comissão
router.post('/comissoes', async (req, res) => {
    const { jovem_id, tipo, ejc_numero, paroquia, data_inicio, data_fim, funcao_garcom, semestre, circulo, observacao, outro_ejc_id } = req.body;

    if (!jovem_id || !tipo) {
        return res.status(400).json({ error: "Jovem e Tipo são obrigatórios" });
    }

    try {
        const [result] = await pool.query(
            `INSERT INTO jovens_comissoes (jovem_id, tipo, ejc_numero, paroquia, data_inicio, data_fim, funcao_garcom, semestre, circulo, observacao, outro_ejc_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [jovem_id, tipo, ejc_numero || null, paroquia || null, data_inicio || null, data_fim || null, funcao_garcom || null, semestre || null, circulo || null, observacao || null, outro_ejc_id || null]
        );
        res.json({ id: result.insertId, message: "Histórico adicionado com sucesso" });
    } catch (err) {
        console.error("Erro ao adicionar comissão:", err);
        res.status(500).json({ error: "Erro ao salvar histórico" });
    }
});

// DELETE - Remover comissão
router.delete('/comissoes/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM jovens_comissoes WHERE id = ?', [req.params.id]);
        res.json({ message: "Histórico removido" });
    } catch (err) {
        console.error("Erro ao remover comissão:", err);
        res.status(500).json({ error: "Erro ao remover item" });
    }
});

// GET - Listar observações de um jovem
router.get('/observacoes/:jovemId', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM jovens_observacoes WHERE jovem_id = ? ORDER BY created_at DESC', [req.params.jovemId]);
        res.json(rows);
    } catch (err) {
        console.error("Erro ao buscar observacoes:", err);
        res.status(500).json({ error: "Erro ao buscar observações" });
    }
});

// POST - Adicionar observação
router.post('/observacoes', async (req, res) => {
    const { jovem_id, texto } = req.body;

    if (!jovem_id || !texto || !texto.trim()) {
        return res.status(400).json({ error: "Jovem e Texto são obrigatórios" });
    }

    try {
        const [result] = await pool.query(
            `INSERT INTO jovens_observacoes (jovem_id, texto) VALUES (?, ?)`,
            [jovem_id, texto.trim()]
        );
        res.json({ id: result.insertId, message: "Observação adicionada com sucesso" });
    } catch (err) {
        console.error("Erro ao adicionar observacao:", err);
        res.status(500).json({ error: "Erro ao salvar observação" });
    }
});

module.exports = router;