const express = require('express');
const { pool } = require('../database');

const router = express.Router();

let estruturaGarantida = false;
let estruturaPromise = null;

async function hasTable(tableName) {
    const [rows] = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
    `, [tableName]);
    return !!(rows && rows[0] && rows[0].cnt > 0);
}

async function hasColumn(tableName, columnName) {
    const [rows] = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
    `, [tableName, columnName]);
    return !!(rows && rows[0] && rows[0].cnt > 0);
}

async function runAlterIgnoreDuplicate(sql) {
    try {
        await pool.query(sql);
    } catch (err) {
        if (err && err.code === 'ER_DUP_FIELDNAME') return;
        throw err;
    }
}

async function garantirEstrutura() {
    if (estruturaGarantida) return;
    if (estruturaPromise) {
        await estruturaPromise;
        return;
    }

    estruturaPromise = (async () => {
        await pool.query(`
        CREATE TABLE IF NOT EXISTS formularios_pastas (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(160) NOT NULL,
            parent_id INT NULL,
            criado_por INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
        `);

        await pool.query(`
        CREATE TABLE IF NOT EXISTS formularios_itens (
            id INT AUTO_INCREMENT PRIMARY KEY,
            titulo VARCHAR(180) NOT NULL,
            tema VARCHAR(200) NULL,
            tipo VARCHAR(40) NOT NULL DEFAULT 'LISTA_PRESENCA',
            token VARCHAR(80) NOT NULL UNIQUE,
            pasta_id INT NULL,
            evento_data DATE NULL,
            evento_hora TIME NULL,
            criar_lista_presenca TINYINT(1) NOT NULL DEFAULT 1,
            usar_lista_jovens TINYINT(1) NOT NULL DEFAULT 1,
            coletar_dados_avulsos TINYINT(1) NOT NULL DEFAULT 0,
            permitir_ja_fez_ejc TINYINT(1) NOT NULL DEFAULT 1,
            permitir_nao_fez_ejc TINYINT(1) NOT NULL DEFAULT 1,
            criado_por INT NULL,
            ativo TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
        `);

        await pool.query(`
        CREATE TABLE IF NOT EXISTS formularios_presencas (
            id INT AUTO_INCREMENT PRIMARY KEY,
            formulario_id INT NOT NULL,
            jovem_id INT NULL,
            nome_completo VARCHAR(180) NULL,
            telefone VARCHAR(30) NULL,
            ejc_origem VARCHAR(140) NULL,
            status_ejc VARCHAR(20) NULL,
            origem_ja_fez VARCHAR(20) NULL,
            outro_ejc_id INT NULL,
            registrado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ip VARCHAR(64) NULL,
            user_agent VARCHAR(255) NULL,
            UNIQUE KEY uniq_formulario_jovem (formulario_id, jovem_id)
        )
        `);

        const comEventoData = await hasColumn('formularios_itens', 'evento_data');
        if (!comEventoData) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_itens ADD COLUMN evento_data DATE NULL AFTER pasta_id');
        }
        const comEventoHora = await hasColumn('formularios_itens', 'evento_hora');
        if (!comEventoHora) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_itens ADD COLUMN evento_hora TIME NULL AFTER evento_data');
        }
        const comTema = await hasColumn('formularios_itens', 'tema');
        if (!comTema) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_itens ADD COLUMN tema VARCHAR(200) NULL AFTER titulo');
        }
        const comCriarLista = await hasColumn('formularios_itens', 'criar_lista_presenca');
        if (!comCriarLista) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_itens ADD COLUMN criar_lista_presenca TINYINT(1) NOT NULL DEFAULT 1 AFTER evento_hora');
        }
        const comUsarListaJovens = await hasColumn('formularios_itens', 'usar_lista_jovens');
        if (!comUsarListaJovens) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_itens ADD COLUMN usar_lista_jovens TINYINT(1) NOT NULL DEFAULT 1 AFTER evento_hora');
        }
        const comColetarDadosAvulsos = await hasColumn('formularios_itens', 'coletar_dados_avulsos');
        if (!comColetarDadosAvulsos) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_itens ADD COLUMN coletar_dados_avulsos TINYINT(1) NOT NULL DEFAULT 0 AFTER usar_lista_jovens');
        }
        const comPermitirJaFez = await hasColumn('formularios_itens', 'permitir_ja_fez_ejc');
        if (!comPermitirJaFez) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_itens ADD COLUMN permitir_ja_fez_ejc TINYINT(1) NOT NULL DEFAULT 1 AFTER coletar_dados_avulsos');
        }
        const comPermitirNaoFez = await hasColumn('formularios_itens', 'permitir_nao_fez_ejc');
        if (!comPermitirNaoFez) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_itens ADD COLUMN permitir_nao_fez_ejc TINYINT(1) NOT NULL DEFAULT 1 AFTER permitir_ja_fez_ejc');
        }

        const comNomeCompleto = await hasColumn('formularios_presencas', 'nome_completo');
        if (!comNomeCompleto) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_presencas ADD COLUMN nome_completo VARCHAR(180) NULL AFTER jovem_id');
        }
        const comTelefone = await hasColumn('formularios_presencas', 'telefone');
        if (!comTelefone) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_presencas ADD COLUMN telefone VARCHAR(30) NULL AFTER nome_completo');
        }
        const comEjcOrigem = await hasColumn('formularios_presencas', 'ejc_origem');
        if (!comEjcOrigem) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_presencas ADD COLUMN ejc_origem VARCHAR(140) NULL AFTER telefone');
        }
        const comStatusEjc = await hasColumn('formularios_presencas', 'status_ejc');
        if (!comStatusEjc) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_presencas ADD COLUMN status_ejc VARCHAR(20) NULL AFTER ejc_origem');
        }
        const comOrigemJaFez = await hasColumn('formularios_presencas', 'origem_ja_fez');
        if (!comOrigemJaFez) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_presencas ADD COLUMN origem_ja_fez VARCHAR(20) NULL AFTER status_ejc');
        }
        const comOutroEjcId = await hasColumn('formularios_presencas', 'outro_ejc_id');
        if (!comOutroEjcId) {
            await runAlterIgnoreDuplicate('ALTER TABLE formularios_presencas ADD COLUMN outro_ejc_id INT NULL AFTER origem_ja_fez');
        }
        const [jovemCol] = await pool.query(`
        SELECT IS_NULLABLE AS is_nullable
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'formularios_presencas'
          AND COLUMN_NAME = 'jovem_id'
        LIMIT 1
        `);
        if (jovemCol.length && String(jovemCol[0].is_nullable || '').toUpperCase() !== 'YES') {
            await pool.query('ALTER TABLE formularios_presencas MODIFY COLUMN jovem_id INT NULL');
        }

        estruturaGarantida = true;
    })();

    try {
        await estruturaPromise;
    } finally {
        estruturaPromise = null;
    }
}

function toPositiveInt(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
}

// GET /api/formularios/public/:token/outro-ejc-jovens
router.get('/:token/outro-ejc-jovens', async (req, res) => {
    try {
        await garantirEstrutura();
        const token = String(req.params.token || '').trim();
        const outroEjcId = toPositiveInt(req.query.outro_ejc_id);
        if (!token) return res.status(400).json({ error: 'Token inválido.' });

        const [forms] = await pool.query(
            `SELECT id, ativo, permitir_ja_fez_ejc
             FROM formularios_itens
             WHERE token = ?
             LIMIT 1`,
            [token]
        );
        if (!forms.length || !forms[0].ativo) return res.status(404).json({ error: 'Formulário não encontrado.' });
        if (Number(forms[0].permitir_ja_fez_ejc) !== 1) return res.json([]);

        const hasOutrosEjcs = await hasTable('outros_ejcs');
        const params = [];
        let whereOutroEjc = '';
        if (outroEjcId) {
            whereOutroEjc = 'AND fp.outro_ejc_id = ?';
            params.push(outroEjcId);
        }

        const [rowsHistorico] = await pool.query(`
            SELECT
                MAX(fp.id) AS id,
                fp.nome_completo,
                fp.telefone,
                fp.outro_ejc_id,
                MAX(fp.registrado_em) AS ultimo_registro
                ${hasOutrosEjcs ? ', oe.nome AS outro_ejc_nome, oe.paroquia AS outro_ejc_paroquia' : ", NULL AS outro_ejc_nome, NULL AS outro_ejc_paroquia"}
            FROM formularios_presencas fp
            ${hasOutrosEjcs ? 'LEFT JOIN outros_ejcs oe ON oe.id = fp.outro_ejc_id' : ''}
            WHERE fp.status_ejc = 'JA_FIZ'
              AND fp.origem_ja_fez = 'OUTRO_EJC'
              AND COALESCE(TRIM(fp.nome_completo), '') <> ''
              AND COALESCE(TRIM(fp.telefone), '') <> ''
              ${whereOutroEjc}
            GROUP BY fp.nome_completo, fp.telefone, fp.outro_ejc_id
                     ${hasOutrosEjcs ? ', oe.nome, oe.paroquia' : ''}
            ORDER BY fp.nome_completo ASC
        `, params);

        const [rowsCadastro] = await pool.query(`
            SELECT
                j.id,
                j.nome_completo,
                j.telefone,
                j.outro_ejc_id,
                NULL AS ultimo_registro
                ${hasOutrosEjcs ? ', oe.nome AS outro_ejc_nome, oe.paroquia AS outro_ejc_paroquia' : ", NULL AS outro_ejc_nome, NULL AS outro_ejc_paroquia"}
            FROM jovens j
            ${hasOutrosEjcs ? 'LEFT JOIN outros_ejcs oe ON oe.id = j.outro_ejc_id' : ''}
            WHERE COALESCE(j.origem_ejc_tipo, 'INCONFIDENTES') = 'OUTRO_EJC'
              AND COALESCE(TRIM(j.nome_completo), '') <> ''
              AND COALESCE(TRIM(j.telefone), '') <> ''
              ${outroEjcId ? 'AND j.outro_ejc_id = ?' : ''}
            ORDER BY j.nome_completo ASC
        `, outroEjcId ? [outroEjcId] : []);

        const mapa = new Map();
        const normalizarChave = (nome, telefone, outroId) => `${String(nome || '').trim().toLowerCase()}|${String(telefone || '').replace(/\D/g, '')}|${Number(outroId || 0)}`;

        for (const r of rowsHistorico || []) {
            const chave = normalizarChave(r.nome_completo, r.telefone, r.outro_ejc_id);
            if (mapa.has(chave)) continue;
            mapa.set(chave, {
                id: `H:${r.id}`,
                referencia: `H:${r.id}`,
                origem_registro: 'HISTORICO',
                nome_completo: r.nome_completo,
                telefone: r.telefone,
                outro_ejc_id: r.outro_ejc_id,
                outro_ejc_nome: r.outro_ejc_nome,
                outro_ejc_paroquia: r.outro_ejc_paroquia,
                ultimo_registro: r.ultimo_registro
            });
        }

        for (const r of rowsCadastro || []) {
            const chave = normalizarChave(r.nome_completo, r.telefone, r.outro_ejc_id);
            if (mapa.has(chave)) continue;
            mapa.set(chave, {
                id: `J:${r.id}`,
                referencia: `J:${r.id}`,
                origem_registro: 'CADASTRO',
                nome_completo: r.nome_completo,
                telefone: r.telefone,
                outro_ejc_id: r.outro_ejc_id,
                outro_ejc_nome: r.outro_ejc_nome,
                outro_ejc_paroquia: r.outro_ejc_paroquia,
                ultimo_registro: null
            });
        }

        const lista = Array.from(mapa.values()).sort((a, b) => String(a.nome_completo || '').localeCompare(String(b.nome_completo || ''), 'pt-BR'));
        return res.json(lista);
    } catch (err) {
        console.error('Erro ao listar jovens de outro EJC:', err);
        return res.status(500).json({ error: 'Erro ao buscar jovens de outro EJC.' });
    }
});

router.get('/:token', async (req, res) => {
    try {
        await garantirEstrutura();
        const token = String(req.params.token || '').trim();
        if (!token) return res.status(400).json({ error: 'Token inválido.' });

        const [forms] = await pool.query(
            `SELECT id, titulo, tema, tipo, token, ativo, evento_data, evento_hora, criar_lista_presenca,
                    usar_lista_jovens, coletar_dados_avulsos,
                    permitir_ja_fez_ejc, permitir_nao_fez_ejc
             FROM formularios_itens
             WHERE token = ?
             LIMIT 1`,
            [token]
        );
        if (!forms.length || !forms[0].ativo) return res.status(404).json({ error: 'Formulário não encontrado.' });
        const form = forms[0];
        if (Number(form.criar_lista_presenca) !== 1) {
            return res.status(400).json({ error: 'Este evento não possui lista de presença ativa.' });
        }

        let jovens = [];
        if (Number(form.permitir_ja_fez_ejc) === 1 && Number(form.usar_lista_jovens) === 1) {
            const [rows] = await pool.query('SELECT id, nome_completo FROM jovens ORDER BY nome_completo ASC');
            jovens = rows;
        }
        let outrosEjcs = [];
        if (Number(form.permitir_ja_fez_ejc) === 1) {
            const hasOutrosEjcs = await hasTable('outros_ejcs');
            if (hasOutrosEjcs) {
                const [rows] = await pool.query('SELECT id, nome, paroquia, bairro FROM outros_ejcs ORDER BY nome ASC');
                outrosEjcs = rows;
            }
        }

        return res.json({
            formulario: form,
            jovens,
            outros_ejcs: outrosEjcs
        });
    } catch (err) {
        console.error('Erro ao carregar formulário público:', err);
        return res.status(500).json({ error: 'Erro ao carregar formulário.' });
    }
});

router.post('/:token/presencas', async (req, res) => {
    try {
        await garantirEstrutura();
        const token = String(req.params.token || '').trim();
        const jovemId = toPositiveInt(req.body.jovem_id);
        const nomeCompleto = String(req.body.nome_completo || '').trim();
        const telefone = String(req.body.telefone || '').trim();
        const ejcOrigem = String(req.body.ejc_origem || '').trim();
        const statusEjc = String(req.body.status_ejc || '').trim().toUpperCase();
        const origemJaFez = String(req.body.origem_ja_fez || '').trim().toUpperCase();
        const outroEjcId = toPositiveInt(req.body.outro_ejc_id);
        const modoOutroEjc = String(req.body.primeira_vez_outro_ejc || '').trim().toUpperCase();
        const participanteHistoricoId = toPositiveInt(req.body.participante_historico_id);
        const participanteReferencia = String(req.body.participante_referencia || '').trim();
        if (!token) return res.status(400).json({ error: 'Dados inválidos.' });

        const [forms] = await pool.query(
            `SELECT id, ativo, criar_lista_presenca, usar_lista_jovens, coletar_dados_avulsos, permitir_ja_fez_ejc, permitir_nao_fez_ejc
             FROM formularios_itens
             WHERE token = ?
             LIMIT 1`,
            [token]
        );
        if (!forms.length || !forms[0].ativo) return res.status(404).json({ error: 'Formulário não encontrado.' });
        const form = forms[0];
        if (Number(form.criar_lista_presenca) !== 1) {
            return res.status(400).json({ error: 'Este evento não possui lista de presença ativa.' });
        }

        const permiteJaFez = Number(form.permitir_ja_fez_ejc) === 1;
        const permiteNaoFez = Number(form.permitir_nao_fez_ejc) === 1;
        const permiteListaJovens = Number(form.usar_lista_jovens) === 1;

        if (!permiteJaFez && !permiteNaoFez) {
            return res.status(400).json({ error: 'Formulário sem configuração de opções.' });
        }

        if (!['JA_FIZ', 'NAO_FIZ'].includes(statusEjc)) {
            return res.status(400).json({ error: 'Selecione se já fez EJC ou não fez EJC.' });
        }
        if (statusEjc === 'JA_FIZ' && !permiteJaFez) {
            return res.status(400).json({ error: 'Este formulário não aceita a opção "já fiz EJC".' });
        }
        if (statusEjc === 'NAO_FIZ' && !permiteNaoFez) {
            return res.status(400).json({ error: 'Este formulário não aceita a opção "não fiz EJC".' });
        }

        let jovemIdFinal = null;
        let nomeFinal = null;
        let telefoneFinal = null;
        let ejcOrigemFinal = null;
        let origemJaFezFinal = null;
        let outroEjcIdFinal = null;

        if (statusEjc === 'JA_FIZ') {
            if (!['INCONFIDENTES', 'OUTRO_EJC'].includes(origemJaFez)) {
                return res.status(400).json({ error: 'Selecione se fez EJC Inconfidentes ou outro EJC.' });
            }
            origemJaFezFinal = origemJaFez;

            if (origemJaFez === 'INCONFIDENTES') {
                if (!permiteListaJovens) {
                    return res.status(400).json({ error: 'Este formulário não aceita seleção da lista de jovens.' });
                }
                if (!jovemId) return res.status(400).json({ error: 'Selecione seu nome na lista de jovens.' });
                const [jovemExists] = await pool.query('SELECT id, nome_completo, telefone FROM jovens WHERE id = ? LIMIT 1', [jovemId]);
                if (!jovemExists.length) return res.status(400).json({ error: 'Jovem inválido.' });
                jovemIdFinal = jovemId;
                nomeFinal = jovemExists[0].nome_completo || null;
                telefoneFinal = jovemExists[0].telefone || null;
                ejcOrigemFinal = 'Inconfidentes';
            } else {
                if (!['PRIMEIRA_VEZ', 'JA_PARTICIPOU'].includes(modoOutroEjc)) {
                    return res.status(400).json({ error: 'Selecione se é o primeiro evento ou se já participou de outros eventos.' });
                }
                if (modoOutroEjc === 'PRIMEIRA_VEZ') {
                    if (!nomeCompleto || !telefone || !outroEjcId) {
                        return res.status(400).json({ error: 'Informe nome completo, telefone e o outro EJC.' });
                    }
                    const hasOutrosEjcs = await hasTable('outros_ejcs');
                    if (!hasOutrosEjcs) {
                        return res.status(400).json({ error: 'Cadastro de outros EJCs não está disponível no momento.' });
                    }
                    const [outroEjcExists] = await pool.query('SELECT id, nome, paroquia FROM outros_ejcs WHERE id = ? LIMIT 1', [outroEjcId]);
                    if (!outroEjcExists.length) return res.status(400).json({ error: 'Outro EJC inválido.' });
                    nomeFinal = nomeCompleto;
                    telefoneFinal = telefone;
                    outroEjcIdFinal = outroEjcId;
                    ejcOrigemFinal = [outroEjcExists[0].paroquia, outroEjcExists[0].nome].filter(Boolean).join(' - ') || 'Outro EJC';
                } else {
                    const usarReferencia = /^([HJ]):(\d+)$/.exec(participanteReferencia);
                    const tipoRef = usarReferencia ? usarReferencia[1] : null;
                    const idRef = usarReferencia ? Number(usarReferencia[2]) : null;
                    if (!idRef && !participanteHistoricoId) {
                        return res.status(400).json({ error: 'Selecione seu nome na lista de jovens de outro EJC.' });
                    }
                    if (tipoRef === 'J') {
                        const [jovensRows] = await pool.query(`
                            SELECT id, nome_completo, telefone, outro_ejc_id
                            FROM jovens
                            WHERE id = ?
                              AND COALESCE(origem_ejc_tipo, 'INCONFIDENTES') = 'OUTRO_EJC'
                            LIMIT 1
                        `, [idRef]);
                        if (!jovensRows.length) {
                            return res.status(400).json({ error: 'Cadastro do jovem de outro EJC não encontrado.' });
                        }
                        const jovem = jovensRows[0];
                        if (!jovem.outro_ejc_id) {
                            return res.status(400).json({ error: 'Cadastro sem EJC de origem vinculado.' });
                        }
                        const hasOutrosEjcs = await hasTable('outros_ejcs');
                        if (!hasOutrosEjcs) {
                            return res.status(400).json({ error: 'Cadastro de outros EJCs não está disponível no momento.' });
                        }
                        const [outroEjcExists] = await pool.query('SELECT id, nome, paroquia FROM outros_ejcs WHERE id = ? LIMIT 1', [jovem.outro_ejc_id]);
                        if (!outroEjcExists.length) return res.status(400).json({ error: 'Outro EJC vinculado não encontrado.' });

                        nomeFinal = String(jovem.nome_completo || '').trim() || null;
                        telefoneFinal = String(jovem.telefone || '').trim() || null;
                        outroEjcIdFinal = jovem.outro_ejc_id;
                        ejcOrigemFinal = [outroEjcExists[0].paroquia, outroEjcExists[0].nome].filter(Boolean).join(' - ') || 'Outro EJC';
                    } else {
                        const idBuscaHistorico = idRef || participanteHistoricoId;
                        const [historicoRows] = await pool.query(`
                            SELECT id, nome_completo, telefone, outro_ejc_id
                            FROM formularios_presencas
                            WHERE id = ?
                              AND status_ejc = 'JA_FIZ'
                              AND origem_ja_fez = 'OUTRO_EJC'
                            LIMIT 1
                        `, [idBuscaHistorico]);
                        if (!historicoRows.length) {
                            return res.status(400).json({ error: 'Registro do jovem não encontrado.' });
                        }
                        const historico = historicoRows[0];
                        if (!historico.outro_ejc_id) {
                            return res.status(400).json({ error: 'Registro antigo sem EJC vinculado. Use "primeiro evento".' });
                        }
                        const hasOutrosEjcs = await hasTable('outros_ejcs');
                        if (!hasOutrosEjcs) {
                            return res.status(400).json({ error: 'Cadastro de outros EJCs não está disponível no momento.' });
                        }
                        const [outroEjcExists] = await pool.query('SELECT id, nome, paroquia FROM outros_ejcs WHERE id = ? LIMIT 1', [historico.outro_ejc_id]);
                        if (!outroEjcExists.length) return res.status(400).json({ error: 'Outro EJC vinculado não encontrado.' });

                        nomeFinal = String(historico.nome_completo || '').trim() || null;
                        telefoneFinal = String(historico.telefone || '').trim() || null;
                        outroEjcIdFinal = historico.outro_ejc_id;
                        ejcOrigemFinal = [outroEjcExists[0].paroquia, outroEjcExists[0].nome].filter(Boolean).join(' - ') || 'Outro EJC';
                    }

                    if (!nomeFinal || !telefoneFinal || !outroEjcIdFinal) {
                        return res.status(400).json({ error: 'Registro incompleto. Use "primeiro evento".' });
                    }
                }
            }
        } else {
            if (!nomeCompleto || !telefone) {
                return res.status(400).json({ error: 'Informe nome completo e telefone.' });
            }
            nomeFinal = nomeCompleto;
            telefoneFinal = telefone;
            ejcOrigemFinal = 'Não fez EJC';
        }

        const ipRaw = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const ip = String(Array.isArray(ipRaw) ? ipRaw[0] : ipRaw).slice(0, 64) || null;
        const userAgent = String(req.headers['user-agent'] || '').slice(0, 255) || null;

        try {
            await pool.query(
                `INSERT INTO formularios_presencas
                    (formulario_id, jovem_id, nome_completo, telefone, ejc_origem, status_ejc, origem_ja_fez, outro_ejc_id, ip, user_agent)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    form.id,
                    jovemIdFinal,
                    nomeFinal,
                    telefoneFinal,
                    ejcOrigemFinal || ejcOrigem || null,
                    statusEjc,
                    origemJaFezFinal,
                    outroEjcIdFinal,
                    ip,
                    userAgent
                ]
            );
        } catch (errIns) {
            if (errIns && errIns.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ error: 'Presença já registrada para este jovem.' });
            }
            throw errIns;
        }

        return res.json({ message: 'Presença registrada com sucesso.' });
    } catch (err) {
        console.error('Erro ao registrar presença:', err);
        return res.status(500).json({ error: 'Erro ao registrar presença.' });
    }
});

module.exports = router;
