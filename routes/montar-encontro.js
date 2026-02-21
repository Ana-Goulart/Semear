const express = require('express');
const router = express.Router();
const { pool } = require('../database');

// Listar montagens de encontros
router.get('/', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM montagens ORDER BY created_at DESC');
        res.json(rows);
    } catch (err) {
        console.error("Erro ao buscar montagens:", err);
        res.status(500).json({ error: "Erro ao buscar montagens" });
    }
});

// Criar montagem
router.post('/', async (req, res) => {
    const { numero_ejc, data_encontro } = req.body;
    if (!numero_ejc || !data_encontro) return res.status(400).json({ error: "Preencha o número do EJC e a data." });

    try {
        const [result] = await pool.query(
            'INSERT INTO montagens (numero_ejc, data_encontro) VALUES (?, ?)',
            [numero_ejc, data_encontro]
        );
        res.json({ id: result.insertId, message: "Montagem de encontro iniciada" });
    } catch (err) {
        console.error("Erro ao criar montagem:", err);
        res.status(500).json({ error: "Erro ao criar montagem" });
    }
});

// Deletar montagem
router.delete('/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM montagens WHERE id = ?', [req.params.id]);
        res.json({ message: "Montagem deletada com sucesso" });
    } catch (err) {
        console.error("Erro ao deletar montagem:", err);
        res.status(500).json({ error: "Erro ao deletar" });
    }
});

// Buscar equipes, funções e membros associados à montagem
router.get('/:id/estrutura', async (req, res) => {
    const montagemId = req.params.id;
    try {
        const [equipesFuncoes] = await pool.query(`
            SELECT eq.id as equipe_id, eq.nome as equipe_nome, ef.id as funcao_id, ef.nome as funcao_nome 
            FROM equipes eq
            LEFT JOIN equipes_funcoes ef ON eq.id = ef.equipe_id
            ORDER BY eq.nome ASC, ef.nome ASC
        `);

        const [membros] = await pool.query(`
            SELECT mm.id as membro_id, mm.equipe_id, mm.funcao_id, mm.jovem_id, j.nome_completo as jovem_nome, j.telefone 
            FROM montagem_membros mm
            JOIN jovens j ON mm.jovem_id = j.id
            WHERE mm.montagem_id = ?
        `, [montagemId]);

        const estrutura = {};
        for (let row of equipesFuncoes) {
            if (!estrutura[row.equipe_id]) {
                estrutura[row.equipe_id] = {
                    id: row.equipe_id,
                    nome: row.equipe_nome,
                    funcoes: []
                };
            }

            if (row.funcao_id) {
                const memberInRole = membros.filter(m => m.equipe_id === row.equipe_id && m.funcao_id === row.funcao_id);
                estrutura[row.equipe_id].funcoes.push({
                    id: row.funcao_id,
                    nome: row.funcao_nome,
                    membros: memberInRole
                });
            }
        }
        res.json(Object.values(estrutura));
    } catch (err) {
        console.error("Erro ao buscar estrutura:", err);
        res.status(500).json({ error: "Erro ao buscar estrutura" });
    }
});

// Adicionar um jovem a uma função (cargo) nessa montagem
router.post('/:id/membros', async (req, res) => {
    const { equipe_id, funcao_id, jovem_id } = req.body;
    try {
        const [result] = await pool.query(
            'INSERT INTO montagem_membros (montagem_id, equipe_id, funcao_id, jovem_id) VALUES (?, ?, ?, ?)',
            [req.params.id, equipe_id, funcao_id, jovem_id]
        );
        res.json({ id: result.insertId, message: "Jovem alocado com sucesso" });
    } catch (err) {
        console.error("Erro ao alocar membro:", err);
        res.status(500).json({ error: "Erro ao alocar jovem" });
    }
});

// Remover jovem da função
router.delete('/membro/:membroId', async (req, res) => {
    try {
        await pool.query('DELETE FROM montagem_membros WHERE id = ?', [req.params.membroId]);
        res.json({ message: "Jovem removido com sucesso" });
    } catch (err) {
        console.error("Erro ao remover membro:", err);
        res.status(500).json({ error: "Erro ao remover jovem" });
    }
});

module.exports = router;
