const express = require('express');
const router = express.Router();
const { pool } = require('../database');

// --- PASTAS ---

// GET /pastas - Listar pastas
router.get('/pastas', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM votacoes_pastas ORDER BY data_criacao DESC');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro ao listar pastas" });
    }
});

// POST /pastas - Criar pasta
router.post('/pastas', async (req, res) => {
    const { nome } = req.body;
    if (!nome) return res.status(400).json({ error: "Nome da pasta é obrigatório" });

    try {
        const [result] = await pool.query('INSERT INTO votacoes_pastas (nome) VALUES (?)', [nome]);
        res.json({ id: result.insertId, nome });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro ao criar pasta" });
    }
});

// GET /pastas/:id/votacoes - Listar votações de uma pasta
router.get('/pastas/:id/votacoes', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM votacoes WHERE pasta_id = ? ORDER BY data_criacao DESC', [req.params.id]);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro ao listar votações da pasta" });
    }
});

// --- VOTAÇÕES ---

// POST / - Criar votação (dentro de pasta, com candidatos definidos)
router.post('/', async (req, res) => {
    const { titulo, pasta_id, candidatos_ids } = req.body;
    // candidatos_ids deve ser array de IDs de jovens

    if (!titulo || !pasta_id || !candidatos_ids || !Array.isArray(candidatos_ids) || candidatos_ids.length === 0) {
        return res.status(400).json({ error: "Dados inválidos: Título, Pasta e Candidatos são obrigatórios." });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Criar Votação
        const [result] = await connection.query('INSERT INTO votacoes (titulo, pasta_id) VALUES (?, ?)', [titulo, pasta_id]);
        const votacaoId = result.insertId;

        // 2. Vincular Candidatos (Colunas da Matriz)
        for (const candId of candidatos_ids) {
            await connection.query('INSERT INTO votacao_candidatos (votacao_id, candidato_id) VALUES (?, ?)', [votacaoId, candId]);
        }

        await connection.commit();
        res.json({ id: votacaoId, message: "Votação criada com sucesso" });
    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.status(500).json({ error: "Erro ao criar votação" });
    } finally {
        connection.release();
    }
});

// GET /:id - Obter detalhes completos da votação (Candidatos, Eleitores, Votos existentes)
// Isso serve para montar a MATRIZ
router.get('/:id', async (req, res) => {
    const votacaoId = req.params.id;
    try {
        // 1. Dados da Votação
        const [votacao] = await pool.query('SELECT * FROM votacoes WHERE id = ?', [votacaoId]);
        if (votacao.length === 0) return res.status(404).json({ error: "Votação não encontrada" });

        // 2. Candidatos (Colunas)
        const [candidatos] = await pool.query(`
            SELECT j.id, j.nome_completo 
            FROM votacao_candidatos vc
            JOIN jovens j ON vc.candidato_id = j.id
            WHERE vc.votacao_id = ?
            ORDER BY j.nome_completo
        `, [votacaoId]);

        // 3. Usuários (Linhas) - Todos os usuários do sistema podem votar
        const [eleitores] = await pool.query('SELECT id, nome_completo FROM usuarios ORDER BY nome_completo');

        // 4. Votos já registrados (Células preenchidas)
        // Formato: { eleitor_id: 1, candidato_id: 5, pontos: 3 }
        const [votos] = await pool.query('SELECT eleitor_id, candidato_id, pontos FROM votos WHERE votacao_id = ?', [votacaoId]);

        res.json({
            votacao: votacao[0],
            candidatos,
            eleitores,
            votos
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro ao carregar dados da votação" });
    }
});

// POST /:id/votos_lote - Salvar batch de votos (Salvar Matriz)
router.post('/:id/votos_lote', async (req, res) => {
    const votacaoId = req.params.id;
    const { votos } = req.body; // Array: [{ eleitor_id, candidato_id, pontos }]

    if (!votos || !Array.isArray(votos)) {
        return res.status(400).json({ error: "Formato de votos inválido" });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Estratégia: UPSERT ou DELETE+INSERT?
        // Como o usuário pode *apagar* um voto (deixar em branco), o ideal é processar um por um ou limpar tudo de um usuário se for sobrescrever.
        // Mas a matriz pode ser salva parcialmente.
        // Vamos usar INSERT ON DUPLICATE KEY UPDATE para cada célula enviada.
        // Se o ponto for null ou 0, deveríamos deletar? O front deve enviar apenas o que tem valor.

        for (const voto of votos) {
            // Se pontos for null/vazio, removemos o voto
            if (voto.pontos === null || voto.pontos === undefined || voto.pontos === '') {
                await connection.query('DELETE FROM votos WHERE votacao_id = ? AND eleitor_id = ? AND candidato_id = ?', [votacaoId, voto.eleitor_id, voto.candidato_id]);
            } else {
                await connection.query(`
                    INSERT INTO votos (votacao_id, eleitor_id, candidato_id, pontos)
                    VALUES (?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE pontos = VALUES(pontos)
                `, [votacaoId, voto.eleitor_id, voto.candidato_id, voto.pontos]);
            }
        }

        await connection.commit();
        res.json({ message: "Votos salvos com sucesso" });
    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.status(500).json({ error: "Erro ao salvar votos" });
    } finally {
        connection.release();
    }
});

// GET /:id/ranking - Calcular Ranking
router.get('/:id/ranking', async (req, res) => {
    const votacaoId = req.params.id;
    try {
        const [ranking] = await pool.query(`
            SELECT 
                j.nome_completo as nome,
                SUM(v.pontos) as total_pontos
            FROM votacao_candidatos vc
            JOIN jovens j ON vc.candidato_id = j.id
            LEFT JOIN votos v ON v.votacao_id = vc.votacao_id AND v.candidato_id = j.id
            WHERE vc.votacao_id = ?
            GROUP BY j.id
            ORDER BY total_pontos DESC
        `, [votacaoId]);

        res.json(ranking);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro ao calcular ranking" });
    }
});

// DELETE /:id - Excluir votação
router.delete('/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM votacoes WHERE id = ?', [req.params.id]);
        res.json({ message: "Votação excluída" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro ao excluir votação" });
    }
});
// DELETE /pastas/:id - Excluir pasta
router.delete('/pastas/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM votacoes_pastas WHERE id = ?', [req.params.id]);
        res.json({ message: "Pasta excluída" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro ao excluir pasta" });
    }
});


module.exports = router;
