const express = require('express');
const router = express.Router();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
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

async function runAlterIgnoreDuplicate(sql) {
    try {
        await pool.query(sql);
    } catch (err) {
        if (err && (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_DUP_KEYNAME')) return;
        throw err;
    }
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

async function garantirEstruturaMontagemMembrosExtra() {
    await runAlterIgnoreDuplicate("ALTER TABLE montagem_membros ADD COLUMN status_ligacao ENUM('ACEITOU','RECUSOU','LIGAR_MAIS_TARDE') NULL AFTER jovem_id");
    await runAlterIgnoreDuplicate("ALTER TABLE montagem_membros ADD COLUMN motivo_recusa TEXT NULL AFTER status_ligacao");
    await runAlterIgnoreDuplicate("ALTER TABLE montagem_membros ADD COLUMN eh_substituicao TINYINT(1) NOT NULL DEFAULT 0 AFTER motivo_recusa");
    await runAlterIgnoreDuplicate("ALTER TABLE montagem_membros ADD COLUMN nome_externo VARCHAR(180) NULL AFTER eh_substituicao");
    await runAlterIgnoreDuplicate("ALTER TABLE montagem_membros ADD COLUMN telefone_externo VARCHAR(30) NULL AFTER nome_externo");
}

async function garantirEstruturaMontagemJovensServir() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS montagem_jovens_servir (
            id INT AUTO_INCREMENT PRIMARY KEY,
            montagem_id INT NOT NULL,
            jovem_id INT NOT NULL,
            pode_servir TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_montagem_jovem_servir (montagem_id, jovem_id),
            CONSTRAINT fk_montagem_jovens_servir_montagem FOREIGN KEY (montagem_id) REFERENCES montagens(id) ON DELETE CASCADE,
            CONSTRAINT fk_montagem_jovens_servir_jovem FOREIGN KEY (jovem_id) REFERENCES jovens(id) ON DELETE CASCADE
        )
    `);
}

// Listar montagens de encontros
router.get('/', async (req, res) => {
    try {
        await garantirEstruturaMontagemMembrosExtra();
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
        await garantirEstruturaMontagemMembrosExtra();
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
        await garantirEstruturaMontagemMembrosExtra();
        const comPapelBase = await hasPapelBaseColumn();
        const papelBaseSelect = comPapelBase
            ? 'COALESCE(ef.papel_base, "Membro")'
            : '"Membro"';
        const [equipesFuncoes] = await pool.query(`
            SELECT eq.id as equipe_id, eq.nome as equipe_nome, COALESCE(eq.membros_outro_ejc, 0) AS membros_outro_ejc,
                   ef.id as funcao_id, ef.nome as funcao_nome, ${papelBaseSelect} as papel_base
            FROM equipes eq
            LEFT JOIN equipes_funcoes ef ON eq.id = ef.equipe_id
            ORDER BY eq.nome ASC, ef.nome ASC
        `);

        const [membros] = await pool.query(`
            SELECT mm.id as membro_id, mm.equipe_id, mm.funcao_id, mm.jovem_id, j.nome_completo as jovem_nome, j.telefone,
                   mm.status_ligacao, mm.motivo_recusa, mm.eh_substituicao, mm.nome_externo, mm.telefone_externo
            FROM montagem_membros mm
            LEFT JOIN jovens j ON mm.jovem_id = j.id
            WHERE mm.montagem_id = ?
        `, [montagemId]);

        const estrutura = {};
        for (let row of equipesFuncoes) {
            if (!estrutura[row.equipe_id]) {
                estrutura[row.equipe_id] = {
                    id: row.equipe_id,
                    nome: row.equipe_nome,
                    membros_outro_ejc: row.membros_outro_ejc ? 1 : 0,
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

router.get('/:id/jovens-para-servir', async (req, res) => {
    const montagemId = Number(req.params.id);
    if (!montagemId) return res.status(400).json({ error: 'ID inválido.' });
    try {
        await garantirEstruturaMontagemJovensServir();
        const [rows] = await pool.query(`
            SELECT
                j.id,
                j.nome_completo,
                j.numero_ejc_fez,
                j.outro_ejc_numero,
                j.outro_ejc_id,
                j.data_nascimento,
                j.sexo,
                j.estado_civil,
                COALESCE(j.eh_musico, 0) AS eh_musico,
                COALESCE(j.origem_ejc_tipo, 'INCONFIDENTES') AS origem_ejc_tipo,
                oe.nome AS outro_ejc_nome,
                oe.paroquia AS outro_ejc_paroquia,
                COALESCE(mjs.pode_servir, 0) AS pode_servir
            FROM jovens j
            LEFT JOIN outros_ejcs oe ON oe.id = j.outro_ejc_id
            LEFT JOIN montagem_jovens_servir mjs ON mjs.jovem_id = j.id AND mjs.montagem_id = ?
            ORDER BY j.nome_completo ASC
        `, [montagemId]);
        return res.json(rows);
    } catch (err) {
        console.error('Erro ao listar jovens para servir:', err);
        return res.status(500).json({ error: 'Erro ao listar jovens para servir.' });
    }
});

router.patch('/:id/jovens-para-servir/:jovemId', async (req, res) => {
    const montagemId = Number(req.params.id);
    const jovemId = Number(req.params.jovemId);
    const podeServir = req.body && req.body.pode_servir ? 1 : 0;
    if (!montagemId || !jovemId) return res.status(400).json({ error: 'Parâmetros inválidos.' });
    try {
        await garantirEstruturaMontagemJovensServir();
        const [jovemRows] = await pool.query('SELECT id FROM jovens WHERE id = ? LIMIT 1', [jovemId]);
        if (!jovemRows.length) return res.status(404).json({ error: 'Jovem não encontrado.' });

        await pool.query(
            `INSERT INTO montagem_jovens_servir (montagem_id, jovem_id, pode_servir)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE pode_servir = VALUES(pode_servir)`,
            [montagemId, jovemId, podeServir]
        );
        return res.json({ message: 'Lista de jovens para servir atualizada.' });
    } catch (err) {
        console.error('Erro ao atualizar jovem para servir:', err);
        return res.status(500).json({ error: 'Erro ao atualizar lista de jovens para servir.' });
    }
});

router.get('/:id/jovens-para-servir/search', async (req, res) => {
    const montagemId = Number(req.params.id);
    const q = String((req.query && req.query.q) || '').trim();
    const origem = String((req.query && req.query.origem) || '').trim().toUpperCase();
    const outroEjcId = Number((req.query && req.query.outro_ejc_id) || 0);
    if (!montagemId) return res.status(400).json({ error: 'ID inválido.' });
    if (!q || q.length < 2) return res.json([]);
    if (origem === 'OUTRO_EJC' && !outroEjcId) {
        return res.status(400).json({ error: 'Selecione o EJC de origem para buscar jovens de outro EJC.' });
    }
    try {
        await garantirEstruturaMontagemJovensServir();
        const where = [
            'j.nome_completo LIKE ?',
            'mjs.montagem_id = ?',
            'mjs.pode_servir = 1'
        ];
        const params = [`%${q}%`, montagemId];

        if (origem === 'OUTRO_EJC') {
            where.push("COALESCE(j.origem_ejc_tipo, 'INCONFIDENTES') = 'OUTRO_EJC'");
            if (outroEjcId > 0) {
                where.push('j.outro_ejc_id = ?');
                params.push(outroEjcId);
            }
        } else {
            where.push("COALESCE(j.origem_ejc_tipo, 'INCONFIDENTES') <> 'OUTRO_EJC'");
        }

        const [rows] = await pool.query(`
            SELECT j.id, j.nome_completo, j.data_nascimento, j.telefone, j.numero_ejc_fez, j.outro_ejc_numero, j.outro_ejc_id
            FROM jovens j
            JOIN montagem_jovens_servir mjs ON mjs.jovem_id = j.id
            WHERE ${where.join(' AND ')}
            ORDER BY j.nome_completo ASC
            LIMIT 30
        `, params);
        return res.json(rows);
    } catch (err) {
        console.error('Erro ao buscar jovens para servir:', err);
        return res.status(500).json({ error: 'Erro ao buscar jovens para servir.' });
    }
});

// Adicionar um jovem a uma função (cargo) nessa montagem
router.post('/:id/membros', async (req, res) => {
    const { equipe_id, funcao_id, jovem_id } = req.body;
    const montagemId = req.params.id;
    const ehSubstituicao = req.body.eh_substituicao ? 1 : 0;

    try {
        await garantirEstruturaMontagemMembrosExtra();
        await garantirEstruturaMontagemJovensServir();

        const [liberadoRows] = await pool.query(
            'SELECT pode_servir FROM montagem_jovens_servir WHERE montagem_id = ? AND jovem_id = ? LIMIT 1',
            [montagemId, jovem_id]
        );
        if (!liberadoRows.length || !liberadoRows[0].pode_servir) {
            return res.status(400).json({ error: 'Este jovem não está marcado na aba "Jovens para servir" desta montagem.' });
        }

        const [emOutraEquipe] = await pool.query(
            `SELECT mm.id, mm.equipe_id, mm.status_ligacao, e.nome AS equipe_nome
             FROM montagem_membros mm
             JOIN equipes e ON e.id = mm.equipe_id
             WHERE mm.montagem_id = ?
               AND mm.jovem_id = ?
               AND mm.equipe_id <> ?
             LIMIT 1`,
            [montagemId, jovem_id, equipe_id]
        );
        if (emOutraEquipe.length) {
            if (String(emOutraEquipe[0].status_ligacao || '').toUpperCase() === 'RECUSOU') {
                return res.status(400).json({
                    error: `Essa jovem está com recusa ativa na equipe: ${emOutraEquipe[0].equipe_nome}. Exclua a recusa para poder alocar novamente.`
                });
            }
            return res.status(400).json({ error: `Esse jovem já está na equipe: ${emOutraEquipe[0].equipe_nome}.` });
        }

        const [duplicadoNaEquipe] = await pool.query(
            `SELECT mm.id, mm.funcao_id, ef.nome AS funcao_nome
             FROM montagem_membros mm
             LEFT JOIN equipes_funcoes ef ON ef.id = mm.funcao_id
             WHERE mm.montagem_id = ?
               AND mm.equipe_id = ?
               AND mm.jovem_id = ?
             LIMIT 1`,
            [montagemId, equipe_id, jovem_id]
        );
        if (duplicadoNaEquipe.length) {
            const nomeFuncao = String(duplicadoNaEquipe[0].funcao_nome || '').trim();
            return res.status(400).json({
                error: nomeFuncao
                    ? `Esse jovem já está nesta equipe (função: ${nomeFuncao}).`
                    : 'Esse jovem já está nesta equipe.'
            });
        }

        const [jaExiste] = await pool.query(
            'SELECT id FROM montagem_membros WHERE montagem_id = ? AND equipe_id = ? AND funcao_id = ? AND jovem_id = ? LIMIT 1',
            [montagemId, equipe_id, funcao_id, jovem_id]
        );
        if (jaExiste.length > 0) {
            await pool.query(
                'UPDATE montagem_membros SET eh_substituicao = ? WHERE id = ?',
                [ehSubstituicao, jaExiste[0].id]
            );
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
            'INSERT INTO montagem_membros (montagem_id, equipe_id, funcao_id, jovem_id, eh_substituicao) VALUES (?, ?, ?, ?, ?)',
            [montagemId, equipe_id, funcao_id, jovem_id, ehSubstituicao]
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

router.post('/:id/membros-externos', async (req, res) => {
    const montagemId = req.params.id;
    const equipeId = Number(req.body.equipe_id);
    const funcaoId = Number(req.body.funcao_id);
    const nome = String(req.body.nome_completo || '').trim();
    const telefone = String(req.body.telefone || '').trim() || null;
    const ehSubstituicao = req.body.eh_substituicao ? 1 : 0;
    if (!equipeId || !funcaoId || !nome) return res.status(400).json({ error: 'Dados obrigatórios: equipe, função e nome.' });

    try {
        await garantirEstruturaMontagemMembrosExtra();
        const [result] = await pool.query(
            `INSERT INTO montagem_membros
                (montagem_id, equipe_id, funcao_id, jovem_id, eh_substituicao, nome_externo, telefone_externo)
             VALUES (?, ?, ?, NULL, ?, ?, ?)`,
            [montagemId, equipeId, funcaoId, ehSubstituicao, nome, telefone]
        );
        return res.json({ id: result.insertId, message: 'Membro externo adicionado.' });
    } catch (err) {
        console.error('Erro ao adicionar membro externo:', err);
        return res.status(500).json({ error: 'Erro ao adicionar membro externo.' });
    }
});

router.post('/:id/equipes/:equipeId/importar-externos', async (req, res) => {
    const montagemId = Number(req.params.id);
    const equipeId = Number(req.params.equipeId);
    const lista = Array.isArray(req.body && req.body.items) ? req.body.items : [];
    if (!montagemId || !equipeId || !lista.length) return res.status(400).json({ error: 'Dados inválidos para importação.' });

    try {
        await garantirEstruturaMontagemMembrosExtra();
        let inseridos = 0;
        for (const item of lista) {
            const nome = String(item.nome_completo || '').trim();
            const telefone = String(item.telefone || '').trim() || null;
            const funcaoId = Number(item.funcao_id);
            const ehSubstituicao = item.eh_substituicao ? 1 : 0;
            if (!nome || !funcaoId) continue;
            await pool.query(
                `INSERT INTO montagem_membros
                    (montagem_id, equipe_id, funcao_id, jovem_id, eh_substituicao, nome_externo, telefone_externo)
                 VALUES (?, ?, ?, NULL, ?, ?, ?)`,
                [montagemId, equipeId, funcaoId, ehSubstituicao, nome, telefone]
            );
            inseridos++;
        }
        return res.json({ message: 'Importação concluída.', inseridos });
    } catch (err) {
        console.error('Erro ao importar membros externos:', err);
        return res.status(500).json({ error: 'Erro ao importar membros externos.' });
    }
});

router.get('/:id/equipes/:equipeId/detalhes', async (req, res) => {
    const montagemId = Number(req.params.id);
    const equipeId = Number(req.params.equipeId);
    if (!montagemId || !equipeId) return res.status(400).json({ error: 'Parâmetros inválidos.' });

    try {
        await garantirEstruturaMontagemMembrosExtra();
        const [rows] = await pool.query(`
            SELECT mm.id AS membro_id, mm.equipe_id, mm.funcao_id, mm.jovem_id,
                   mm.status_ligacao, mm.motivo_recusa, mm.eh_substituicao,
                   mm.nome_externo, mm.telefone_externo,
                   ef.nome AS funcao_nome, COALESCE(ef.papel_base, 'Membro') AS papel_base,
                   j.nome_completo AS jovem_nome, j.telefone AS jovem_telefone
            FROM montagem_membros mm
            JOIN equipes_funcoes ef ON ef.id = mm.funcao_id
            LEFT JOIN jovens j ON j.id = mm.jovem_id
            WHERE mm.montagem_id = ? AND mm.equipe_id = ?
            ORDER BY COALESCE(j.nome_completo, mm.nome_externo) ASC
        `, [montagemId, equipeId]);

        const titular = rows.filter(r => !r.eh_substituicao && r.status_ligacao !== 'RECUSOU');
        const recusas = rows.filter(r => r.status_ligacao === 'RECUSOU');
        const substituicoes = rows.filter(r => r.eh_substituicao === 1);
        return res.json({ titular, recusas, substituicoes });
    } catch (err) {
        console.error('Erro ao buscar detalhes da equipe na montagem:', err);
        return res.status(500).json({ error: 'Erro ao buscar detalhes da equipe.' });
    }
});

router.patch('/membro/:membroId/ligacao', async (req, res) => {
    const membroId = Number(req.params.membroId);
    const statusRaw = String(req.body.status_ligacao || '').trim().toUpperCase();
    const status = ['ACEITOU', 'RECUSOU', 'LIGAR_MAIS_TARDE'].includes(statusRaw) ? statusRaw : null;
    const motivoRecusa = String(req.body.motivo_recusa || '').trim() || null;
    if (!membroId || !status) return res.status(400).json({ error: 'Status inválido.' });
    if (status === 'RECUSOU' && !motivoRecusa) return res.status(400).json({ error: 'Informe o motivo da recusa.' });

    try {
        await garantirEstruturaMontagemMembrosExtra();
        const [[membro]] = await pool.query(`
            SELECT mm.id, mm.jovem_id, mm.montagem_id, m.numero_ejc
            FROM montagem_membros mm
            JOIN montagens m ON m.id = mm.montagem_id
            WHERE mm.id = ?
            LIMIT 1
        `, [membroId]);
        if (!membro) return res.status(404).json({ error: 'Membro não encontrado.' });

        await pool.query(
            'UPDATE montagem_membros SET status_ligacao = ?, motivo_recusa = ? WHERE id = ?',
            [status, status === 'RECUSOU' ? motivoRecusa : null, membroId]
        );

        if (status === 'RECUSOU' && membro.jovem_id) {
            const texto = `Jovem recusou servir no ${membro.numero_ejc}º encontro de montagem. Motivo: ${motivoRecusa}`;
            await pool.query(
                'INSERT INTO jovens_observacoes (jovem_id, texto) VALUES (?, ?)',
                [membro.jovem_id, texto]
            );
        }

        return res.json({ message: 'Status de ligação atualizado.' });
    } catch (err) {
        console.error('Erro ao atualizar status de ligação:', err);
        return res.status(500).json({ error: 'Erro ao atualizar status de ligação.' });
    }
});

router.patch('/membro/:membroId/mover-titular', async (req, res) => {
    const membroId = Number(req.params.membroId);
    if (!membroId) return res.status(400).json({ error: 'ID inválido.' });
    try {
        await garantirEstruturaMontagemMembrosExtra();
        const [r] = await pool.query('UPDATE montagem_membros SET eh_substituicao = 0 WHERE id = ?', [membroId]);
        if (!r.affectedRows) return res.status(404).json({ error: 'Membro não encontrado.' });
        return res.json({ message: 'Membro movido para titular.' });
    } catch (err) {
        console.error('Erro ao mover substituição para titular:', err);
        return res.status(500).json({ error: 'Erro ao mover para titular.' });
    }
});

router.patch('/membro/:membroId/remover-recusa', async (req, res) => {
    const membroId = Number(req.params.membroId);
    if (!membroId) return res.status(400).json({ error: 'ID inválido.' });
    try {
        await garantirEstruturaMontagemMembrosExtra();
        const [[membro]] = await pool.query(`
            SELECT mm.id, mm.jovem_id, mm.status_ligacao, m.numero_ejc
            FROM montagem_membros mm
            JOIN montagens m ON m.id = mm.montagem_id
            WHERE mm.id = ?
            LIMIT 1
        `, [membroId]);
        if (!membro) return res.status(404).json({ error: 'Membro não encontrado.' });
        if (String(membro.status_ligacao || '').toUpperCase() !== 'RECUSOU') {
            return res.status(400).json({ error: 'Este membro não está marcado como recusou.' });
        }

        await pool.query(
            'UPDATE montagem_membros SET status_ligacao = NULL, motivo_recusa = NULL WHERE id = ?',
            [membroId]
        );

        if (membro.jovem_id && membro.numero_ejc) {
            const likeTexto = `Jovem recusou servir no ${membro.numero_ejc}º encontro de montagem.%`;
            await pool.query(
                `DELETE FROM jovens_observacoes
                 WHERE jovem_id = ? AND texto LIKE ?
                 ORDER BY id DESC
                 LIMIT 1`,
                [membro.jovem_id, likeTexto]
            );
        }

        return res.json({ message: 'Recusa removida com sucesso.' });
    } catch (err) {
        console.error('Erro ao remover recusa:', err);
        return res.status(500).json({ error: 'Erro ao remover recusa.' });
    }
});

router.get('/:id/powerpoint', async (req, res) => {
    const montagemId = Number(req.params.id);
    if (!montagemId) return res.status(400).json({ error: 'ID inválido.' });
    try {
        await garantirEstruturaMontagemMembrosExtra();
        const [rows] = await pool.query(`
            SELECT e.nome AS equipe_nome, COALESCE(j.nome_completo, mm.nome_externo) AS nome
            FROM montagem_membros mm
            JOIN equipes e ON e.id = mm.equipe_id
            LEFT JOIN jovens j ON j.id = mm.jovem_id
            WHERE mm.montagem_id = ?
              AND mm.status_ligacao = 'ACEITOU'
              AND COALESCE(j.nome_completo, mm.nome_externo) IS NOT NULL
            ORDER BY e.nome ASC, nome ASC
        `, [montagemId]);

        const grupos = new Map();
        for (const row of rows) {
            const equipe = String(row.equipe_nome || 'Sem equipe').trim();
            const nome = String(row.nome || '').trim();
            if (!nome) continue;
            if (!grupos.has(equipe)) grupos.set(equipe, []);
            grupos.get(equipe).push(nome);
        }

        const slides = Array.from(grupos.entries()).map(([equipe, nomes]) => ({
            title: `Equipe: ${equipe}`,
            items: nomes
        }));
        if (slides.length === 0) {
            slides.push({ title: 'Equipe: Sem equipe', items: [] });
        }

        const scriptPath = path.join(__dirname, '..', 'scripts', 'generate_simple_pptx.py');
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-aceitos-'));
        const outPath = path.join(tmpDir, `montagem-${montagemId}-aceitos.pptx`);
        const py = spawnSync('python3', [scriptPath, outPath], {
            input: JSON.stringify({ slides }),
            encoding: null,
            maxBuffer: 20 * 1024 * 1024
        });

        let arquivoBytes = null;
        if (py.status === 0) {
            try {
                arquivoBytes = fs.readFileSync(outPath);
            } catch (_) {
                arquivoBytes = null;
            }
        }
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (_) {}

        if (py.status !== 0 || !arquivoBytes || !arquivoBytes.length) {
            const stderr = py.stderr ? py.stderr.toString('utf8') : '';
            console.error('Erro ao gerar PPTX via Python:', stderr || `status=${py.status}`);
            return res.status(500).json({ error: 'Erro ao gerar arquivo PowerPoint (.pptx).' });
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
        res.setHeader('Content-Disposition', `attachment; filename="montagem-${montagemId}-aceitos.pptx"`);
        return res.send(arquivoBytes);
    } catch (err) {
        console.error('Erro ao gerar lista para PowerPoint:', err);
        return res.status(500).json({ error: 'Erro ao gerar arquivo.' });
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
