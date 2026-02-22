const express = require('express');
const router = express.Router();
const { pool } = require('../database');

let hasPapelBaseColumnCache = null;
let hasSubfuncaoColumnCache = null;
let hasMontagemDataInicioColumnCache = null;
let hasMontagemDataFimColumnCache = null;

function mapearPapelPorNomeFuncao(nomeFuncao) {
    const funcaoLower = (nomeFuncao || '').toLowerCase();
    if (funcaoLower.includes('tio') || funcaoLower.includes('tia')) return 'Tio';
    if (funcaoLower.includes('coordenador') || funcaoLower.includes('coord')) return 'Coordenador';
    return 'Membro';
}

function montarEtiquetaEdicao(numeroEjc) {
    return `${numeroEjc}º EJC (Montagem)`;
}

function normalizarDataISO(valor) {
    if (!valor) return null;
    const str = String(valor);
    return str.includes('T') ? str.split('T')[0] : str;
}

async function sincronizarHistoricoDaAlocacao({ montagemId, equipeId, funcaoId, jovemId }) {
    const comPapelBase = await hasPapelBaseColumn();
    const papelBaseSelect = comPapelBase
        ? 'COALESCE(ef.papel_base, "Membro")'
        : '"Membro"';
    const [[dadosAux]] = await pool.query(`
        SELECT m.numero_ejc, e.nome as equipe_nome, ef.nome as funcao_nome, ${papelBaseSelect} as papel_base
        FROM montagens m
        JOIN equipes e ON e.id = ?
        JOIN equipes_funcoes ef ON ef.id = ?
        WHERE m.id = ?
    `, [equipeId, funcaoId, montagemId]);

    if (!dadosAux) return false;

    const papelMapeado = dadosAux.papel_base || mapearPapelPorNomeFuncao(dadosAux.funcao_nome);
    const subfuncao = dadosAux.funcao_nome || null;
    const edicaoMontagem = montarEtiquetaEdicao(dadosAux.numero_ejc);
    const comSubfuncao = await hasSubfuncaoColumn();

    if (comSubfuncao) {
        const [histExists] = await pool.query(
            `SELECT id
             FROM historico_equipes
             WHERE jovem_id = ?
               AND equipe = ?
               AND papel = ?
               AND (subfuncao <=> ?)
               AND (edicao_ejc <=> ?)`,
            [jovemId, dadosAux.equipe_nome, papelMapeado, subfuncao, edicaoMontagem]
        );
        if (histExists.length === 0) {
            await pool.query(
                `INSERT INTO historico_equipes (jovem_id, edicao_ejc, equipe, papel, subfuncao, ejc_id) 
                 VALUES (?, ?, ?, ?, ?, NULL)`,
                [jovemId, edicaoMontagem, dadosAux.equipe_nome, papelMapeado, subfuncao]
            );
        }
    } else {
        const [histExists] = await pool.query(
            `SELECT id
             FROM historico_equipes
             WHERE jovem_id = ?
               AND equipe = ?
               AND papel = ?
               AND (edicao_ejc <=> ?)`,
            [jovemId, dadosAux.equipe_nome, papelMapeado, edicaoMontagem]
        );
        if (histExists.length === 0) {
            await pool.query(
                `INSERT INTO historico_equipes (jovem_id, edicao_ejc, equipe, papel, ejc_id) 
                 VALUES (?, ?, ?, ?, NULL)`,
                [jovemId, edicaoMontagem, dadosAux.equipe_nome, papelMapeado]
            );
        }
    }

    return true;
}

async function hasPapelBaseColumn() {
    if (hasPapelBaseColumnCache !== null) return hasPapelBaseColumnCache;
    const [rows] = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'equipes_funcoes'
          AND COLUMN_NAME = 'papel_base'
    `);
    hasPapelBaseColumnCache = !!(rows && rows[0] && rows[0].cnt > 0);
    return hasPapelBaseColumnCache;
}

async function hasSubfuncaoColumn() {
    if (hasSubfuncaoColumnCache !== null) return hasSubfuncaoColumnCache;
    const [rows] = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'historico_equipes'
          AND COLUMN_NAME = 'subfuncao'
    `);
    hasSubfuncaoColumnCache = !!(rows && rows[0] && rows[0].cnt > 0);
    return hasSubfuncaoColumnCache;
}

async function hasMontagemDataInicioColumn() {
    if (hasMontagemDataInicioColumnCache !== null) return hasMontagemDataInicioColumnCache;
    const [rows] = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'montagens'
          AND COLUMN_NAME = 'data_inicio'
    `);
    hasMontagemDataInicioColumnCache = !!(rows && rows[0] && rows[0].cnt > 0);
    return hasMontagemDataInicioColumnCache;
}

async function hasMontagemDataFimColumn() {
    if (hasMontagemDataFimColumnCache !== null) return hasMontagemDataFimColumnCache;
    const [rows] = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'montagens'
          AND COLUMN_NAME = 'data_fim'
    `);
    hasMontagemDataFimColumnCache = !!(rows && rows[0] && rows[0].cnt > 0);
    return hasMontagemDataFimColumnCache;
}

// Listar montagens de encontros
router.get('/', async (req, res) => {
    try {
        const comDataInicio = await hasMontagemDataInicioColumn();
        const comDataFim = await hasMontagemDataFimColumn();

        const selectDataInicio = comDataInicio ? 'data_inicio' : 'data_encontro';
        const selectDataFim = comDataFim ? 'data_fim' : 'data_encontro';
        const whereAtivo = comDataFim
            ? 'COALESCE(data_fim, data_encontro, "9999-12-31") >= CURDATE()'
            : 'COALESCE(data_encontro, "9999-12-31") >= CURDATE()';

        const [rows] = await pool.query(`
            SELECT
                id,
                numero_ejc,
                data_encontro,
                ${selectDataInicio} AS data_inicio,
                ${selectDataFim} AS data_fim,
                created_at
            FROM montagens
            WHERE ${whereAtivo}
            ORDER BY created_at DESC
        `);
        res.json(rows);
    } catch (err) {
        console.error("Erro ao buscar montagens:", err);
        res.status(500).json({ error: "Erro ao buscar montagens" });
    }
});

// Criar montagem
router.post('/', async (req, res) => {
    const { numero_ejc, data_inicio, data_fim } = req.body;
    if (!numero_ejc || !data_inicio || !data_fim) {
        return res.status(400).json({ error: "Preencha número do EJC, data de início e data de fim." });
    }

    const inicio = normalizarDataISO(data_inicio);
    const fim = normalizarDataISO(data_fim);
    if (inicio > fim) {
        return res.status(400).json({ error: "A data fim não pode ser menor que a data início." });
    }

    try {
        const comDataInicio = await hasMontagemDataInicioColumn();
        const comDataFim = await hasMontagemDataFimColumn();
        const [result] = (comDataInicio && comDataFim)
            ? await pool.query(
                'INSERT INTO montagens (numero_ejc, data_encontro, data_inicio, data_fim) VALUES (?, ?, ?, ?)',
                [numero_ejc, inicio, inicio, fim]
            )
            : await pool.query(
                'INSERT INTO montagens (numero_ejc, data_encontro) VALUES (?, ?)',
                [numero_ejc, inicio]
            );
        res.json({ id: result.insertId, message: "Montagem de encontro iniciada" });
    } catch (err) {
        console.error("Erro ao criar montagem:", err);
        res.status(500).json({ error: "Erro ao criar montagem" });
    }
});

// Deletar montagem
router.delete('/:id', async (req, res) => {
    const montagemId = req.params.id;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [[montagem]] = await connection.query(
            'SELECT id, numero_ejc FROM montagens WHERE id = ? LIMIT 1',
            [montagemId]
        );
        if (!montagem) {
            await connection.rollback();
            return res.status(404).json({ error: "Montagem não encontrada" });
        }

        const edicaoMontagem = montarEtiquetaEdicao(montagem.numero_ejc);
        const edicaoMontagemAlt = `${montagem.numero_ejc}° EJC (Montagem)`;
        const likeMontagemNumero = `${montagem.numero_ejc}%EJC (Montagem)%`;

        await connection.query('DELETE FROM montagem_membros WHERE montagem_id = ?', [montagemId]);
        await connection.query(
            `DELETE FROM historico_equipes
             WHERE edicao_ejc = ?
                OR edicao_ejc = ?
                OR edicao_ejc LIKE ?`,
            [edicaoMontagem, edicaoMontagemAlt, likeMontagemNumero]
        );
        await connection.query('DELETE FROM montagens WHERE id = ?', [montagemId]);

        await connection.commit();
        res.json({ message: "Montagem deletada com sucesso" });
    } catch (err) {
        await connection.rollback();
        console.error("Erro ao deletar montagem:", err);
        res.status(500).json({ error: "Erro ao deletar" });
    } finally {
        connection.release();
    }
});

// Buscar equipes, funções e membros associados à montagem
router.get('/:id/estrutura', async (req, res) => {
    const montagemId = req.params.id;
    try {
        const comPapelBase = await hasPapelBaseColumn();
        const papelBaseSelect = comPapelBase
            ? 'COALESCE(ef.papel_base, "Membro")'
            : '"Membro"';
        const [equipesFuncoes] = await pool.query(`
            SELECT eq.id as equipe_id, eq.nome as equipe_nome, ef.id as funcao_id, ef.nome as funcao_nome, ${papelBaseSelect} as papel_base
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
                    papel_base: row.papel_base || 'Membro',
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
    const montagemId = req.params.id;

    try {
        const [jaExiste] = await pool.query(
            'SELECT id FROM montagem_membros WHERE montagem_id = ? AND equipe_id = ? AND funcao_id = ? AND jovem_id = ? LIMIT 1',
            [montagemId, equipe_id, funcao_id, jovem_id]
        );
        if (jaExiste.length > 0) {
            await sincronizarHistoricoDaAlocacao({
                montagemId,
                equipeId: equipe_id,
                funcaoId: funcao_id,
                jovemId: jovem_id
            });
            return res.status(200).json({ id: jaExiste[0].id, message: "Jovem já estava alocado; histórico sincronizado." });
        }

        // 1. Inserir na tabela de montagem (o que já fazíamos)
        const [result] = await pool.query(
            'INSERT INTO montagem_membros (montagem_id, equipe_id, funcao_id, jovem_id) VALUES (?, ?, ?, ?)',
            [montagemId, equipe_id, funcao_id, jovem_id]
        );

        await sincronizarHistoricoDaAlocacao({
            montagemId,
            equipeId: equipe_id,
            funcaoId: funcao_id,
            jovemId: jovem_id
        });

        res.json({ id: result.insertId, message: "Jovem alocado e histórico atualizado!" });
    } catch (err) {
        console.error("Erro ao alocar membro e salvar histórico:", err);
        res.status(500).json({ error: "Erro ao processar alocação" });
    }
});

// Remover jovem da função
router.delete('/membro/:membroId', async (req, res) => {
    try {
        const [[dadosMembro]] = await pool.query(`
            SELECT mm.id, mm.jovem_id, mm.equipe_id, mm.funcao_id, m.numero_ejc, e.nome AS equipe_nome,
                   ef.nome AS funcao_nome, COALESCE(ef.papel_base, 'Membro') AS papel_base
            FROM montagem_membros mm
            JOIN montagens m ON m.id = mm.montagem_id
            JOIN equipes e ON e.id = mm.equipe_id
            JOIN equipes_funcoes ef ON ef.id = mm.funcao_id
            WHERE mm.id = ?
            LIMIT 1
        `, [req.params.membroId]);

        if (!dadosMembro) {
            return res.status(404).json({ error: "Membro não encontrado na montagem." });
        }

        await pool.query('DELETE FROM montagem_membros WHERE id = ?', [req.params.membroId]);

        const comSubfuncao = await hasSubfuncaoColumn();
        const edicaoMontagem = montarEtiquetaEdicao(dadosMembro.numero_ejc);
        if (comSubfuncao) {
            await pool.query(
                `DELETE FROM historico_equipes
                 WHERE jovem_id = ?
                   AND equipe = ?
                   AND papel = ?
                   AND (subfuncao <=> ?)
                   AND (edicao_ejc <=> ?)
                 ORDER BY id DESC
                 LIMIT 1`,
                [dadosMembro.jovem_id, dadosMembro.equipe_nome, dadosMembro.papel_base || 'Membro', dadosMembro.funcao_nome || null, edicaoMontagem]
            );
        } else {
            await pool.query(
                `DELETE FROM historico_equipes
                 WHERE jovem_id = ?
                   AND equipe = ?
                   AND papel = ?
                   AND (edicao_ejc <=> ?)
                 ORDER BY id DESC
                 LIMIT 1`,
                [dadosMembro.jovem_id, dadosMembro.equipe_nome, dadosMembro.papel_base || 'Membro', edicaoMontagem]
            );
        }

        res.json({ message: "Jovem removido com sucesso" });
    } catch (err) {
        console.error("Erro ao remover membro:", err);
        res.status(500).json({ error: "Erro ao remover jovem" });
    }
});

module.exports = router;
