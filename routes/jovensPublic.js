const express = require('express');
const { pool } = require('../database');
const crypto = require('crypto');

const router = express.Router();
const TOKEN_TTL_MS = 15 * 60 * 1000;
const TOKEN_SECRET = process.env.JOVENS_PUBLIC_TOKEN_SECRET || process.env.JWT_SECRET || 'semea-jovens-public';

function normalizeDate(v) {
    if (!v) return null;
    const txt = String(v).trim();
    if (!txt) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(txt)) return txt;
    const br = txt.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
    if (br) {
        const dia = Number(br[1]);
        const mes = Number(br[2]);
        const ano = Number(br[3]);
        if (dia && mes && ano) {
            return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
        }
    }
    if (txt.includes('T')) return txt.split('T')[0];
    return null;
}

function normalizePhoneDigits(v) {
    return String(v || '').replace(/\D/g, '');
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

async function ensureAtualizacaoTables() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS jovens_atualizacao_comentarios (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tenant_id INT NULL,
            jovem_id INT NULL,
            nome_completo VARCHAR(180) NULL,
            telefone VARCHAR(30) NULL,
            comentario TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS jovens_atualizacao_nao_encontrado (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tenant_id INT NULL,
            nome_completo VARCHAR(180) NOT NULL,
            telefone VARCHAR(30) NOT NULL,
            ejc_que_fez VARCHAR(180) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

function serializarInstrumentos(value, ehMusico) {
    if (!ehMusico) return null;
    let lista = [];
    if (Array.isArray(value)) {
        lista = value.map((v) => String(v || '').trim()).filter(Boolean);
    } else {
        const txt = String(value || '').trim();
        if (txt) lista = txt.split(',').map((v) => v.trim()).filter(Boolean);
    }
    return lista.length ? JSON.stringify(lista) : null;
}

function criarTokenValidacao(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
    return `${body}.${sig}`;
}

function validarTokenValidacao(token) {
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

async function buscarJovemValidado({ nomeCompleto, telefone, dataNascimento, ultimaEquipe }) {
    const telefoneDigits = normalizePhoneDigits(telefone);
    if (!telefoneDigits) {
        return { error: 'Telefone inválido.', status: 400 };
    }

    const [rows] = await pool.query(
        `SELECT j.id, j.tenant_id, j.nome_completo
         FROM jovens j
         WHERE LOWER(TRIM(j.nome_completo)) = LOWER(TRIM(?))
           AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(j.telefone, '')), ' ', ''), '(', ''), ')', ''), '-', ''), '+', '') = ?
           AND DATE(j.data_nascimento) = ?`,
        [nomeCompleto, telefoneDigits, dataNascimento]
    );

    if (!rows.length) {
        return { error: 'Não encontramos cadastro com essas informações.', status: 404 };
    }
    if (rows.length > 1) {
        return { error: 'Encontramos mais de um cadastro. Procure a coordenação para atualização assistida.', status: 409 };
    }
    const jovem = rows[0];
    const [hist] = await pool.query(
        `SELECT he.equipe, he.edicao_ejc, he.created_at, he.id, he.ejc_id, e.numero AS ejc_numero
         FROM historico_equipes he
         LEFT JOIN ejc e ON e.id = he.ejc_id AND e.tenant_id = he.tenant_id
         WHERE he.jovem_id = ?
           AND he.tenant_id = ?
         ORDER BY he.id DESC`,
        [jovem.id, jovem.tenant_id]
    );

    const semMontagem = (hist || []).filter((h) => {
        if (h && h.ejc_id) return true;
        const ed = String(h?.edicao_ejc || '');
        return ed && !ed.includes('(Montagem)');
    });

    const normalizados = semMontagem.map((h) => {
        const numero = h.ejc_numero ? Number(h.ejc_numero) : null;
        if (Number.isFinite(numero) && numero > 0) return { ...h, numero_ejc: numero };
        const texto = String(h.edicao_ejc || '').trim();
        const m = texto.match(/(\d+)/);
        const num = m ? Number(m[1]) : null;
        return Number.isFinite(num) && num > 0 ? { ...h, numero_ejc: num } : null;
    }).filter(Boolean);

    if (!normalizados.length) {
        return { error: 'Não foi possível identificar a última equipe servida.', status: 404 };
    }

    const maxNumero = Math.max(...normalizados.map((h) => h.numero_ejc));
    const candidatos = normalizados.filter((h) => h.numero_ejc === maxNumero);
    candidatos.sort((a, b) => {
        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
        if (aTime !== bTime) return bTime - aTime;
        return (b.id || 0) - (a.id || 0);
    });
    const ultimo = candidatos[0];
    const ultimaEquipeRegistrada = String(ultimo?.equipe || '').trim().toLowerCase();
    if (ultimaEquipeRegistrada !== String(ultimaEquipe || '').trim().toLowerCase()) {
        return { error: 'Última equipe informada não confere com o último EJC servido.', status: 400 };
    }

    return { jovem };
}

router.get('/equipes', async (_req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT DISTINCT nome FROM equipes WHERE TRIM(COALESCE(nome, "")) <> "" ORDER BY nome ASC'
        );
        return res.json((rows || []).map((r) => r.nome).filter(Boolean));
    } catch (err) {
        console.error('Erro ao listar equipes públicas para atualização de jovens:', err);
        return res.status(500).json({ error: 'Erro ao listar equipes.' });
    }
});

router.get('/pastorais', async (req, res) => {
    try {
        const { ensurePastoraisTables } = require('../lib/pastorais');
        const token = String(req.query.token || '').trim();
        const tokenPayload = validarTokenValidacao(token);
        if (!tokenPayload) {
            return res.status(401).json({ error: 'Validação expirada ou inválida.' });
        }
        await ensurePastoraisTables();
        const [rows] = await pool.query(
            'SELECT id, nome FROM pastorais WHERE tenant_id = ? ORDER BY nome ASC',
            [tokenPayload.tenant_id]
        );
        return res.json(rows || []);
    } catch (err) {
        console.error('Erro ao listar pastorais públicas:', err);
        return res.status(500).json({ error: 'Erro ao listar pastorais.' });
    }
});

router.get('/ejcs-outros', async (_req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, tenant_id, nome, paroquia, bairro FROM outros_ejcs ORDER BY nome ASC'
        );
        return res.json(rows || []);
    } catch (err) {
        console.error('Erro ao listar outros EJCs (público):', err);
        return res.status(500).json({ error: 'Erro ao listar EJCs.' });
    }
});

router.post('/validar-cadastro', async (req, res) => {
    try {
        const nomeCompleto = String(req.body.nome_completo || '').trim();
        const telefone = String(req.body.telefone || '').trim();
        const dataNascimento = normalizeDate(req.body.data_nascimento);
        const ultimaEquipe = String(req.body.ultima_equipe || '').trim();

        if (!nomeCompleto || !telefone || !dataNascimento || !ultimaEquipe) {
            return res.status(400).json({ error: 'Preencha nome, telefone, data de nascimento e última equipe.' });
        }

        const resultado = await buscarJovemValidado({ nomeCompleto, telefone, dataNascimento, ultimaEquipe });
        if (resultado.error) return res.status(resultado.status).json({ error: resultado.error });

        const token = criarTokenValidacao({
            jovem_id: resultado.jovem.id,
            tenant_id: resultado.jovem.tenant_id,
            ts: Date.now()
        });

        return res.json({
            message: 'Cadastro confirmado. Agora você pode atualizar seus dados.',
            token
        });
    } catch (err) {
        console.error('Erro ao validar cadastro no formulário público de jovens:', err);
        return res.status(500).json({ error: 'Erro ao validar cadastro.' });
    }
});

router.post('/atualizar', async (req, res) => {
    try {
        const token = String(req.body.validacao_token || '').trim();
        const tokenPayload = validarTokenValidacao(token);
        if (!tokenPayload) {
            return res.status(401).json({ error: 'Validação expirada ou inválida. Confirme seus dados novamente.' });
        }

        const [jovemRows] = await pool.query(
            'SELECT id, tenant_id, telefone FROM jovens WHERE id = ? AND tenant_id = ? LIMIT 1',
            [tokenPayload.jovem_id, tokenPayload.tenant_id]
        );
        if (!jovemRows.length) {
            return res.status(404).json({ error: 'Cadastro não encontrado.' });
        }

        const jovem = jovemRows[0];
        const nomeCompletoNovo = String(req.body.nome_completo_novo || '').trim() || null;
        const telefoneNovo = String(req.body.telefone_novo || '').trim() || String(jovem.telefone || '').trim();
        const email = String(req.body.email || '').trim() || null;
        const instagram = String(req.body.instagram || '').trim() || null;
        const estadoCivil = String(req.body.estado_civil || '').trim() || null;
        const deficiencia = !!req.body.deficiencia;
        const qualDeficiencia = deficiencia ? (String(req.body.qual_deficiencia || '').trim() || null) : null;
        const restricaoAlimentar = !!req.body.restricao_alimentar;
        const detalhesRestricao = restricaoAlimentar ? (String(req.body.detalhes_restricao || '').trim() || null) : null;
        const ehMusico = !!req.body.eh_musico;
        const instrumentos = serializarInstrumentos(req.body.instrumentos_musicais, ehMusico);
        const pastorais = Array.isArray(req.body.pastorais) ? req.body.pastorais : [];
        const pastoraisIds = pastorais.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0);
        const comentarioAdicional = String(req.body.comentario_adicional || '').trim() || null;

        const campos = [
            'telefone = ?',
            'estado_civil = ?',
            'deficiencia = ?',
            'qual_deficiencia = ?',
            'restricao_alimentar = ?',
            'detalhes_restricao = ?'
        ];
        const params = [
            telefoneNovo,
            estadoCivil,
            deficiencia ? 1 : 0,
            qualDeficiencia,
            restricaoAlimentar ? 1 : 0,
            detalhesRestricao
        ];

        if (nomeCompletoNovo && await hasColumn('jovens', 'nome_completo')) {
            campos.push('nome_completo = ?');
            params.push(nomeCompletoNovo);
        }
        if (email !== null && await hasColumn('jovens', 'email')) {
            campos.push('email = ?');
            params.push(email);
        }
        if (instagram !== null && await hasColumn('jovens', 'instagram')) {
            campos.push('instagram = ?');
            params.push(instagram);
        }
        if (await hasColumn('jovens', 'eh_musico')) {
            campos.push('eh_musico = ?');
            params.push(ehMusico ? 1 : 0);
        }
        if (await hasColumn('jovens', 'instrumentos_musicais')) {
            campos.push('instrumentos_musicais = ?');
            params.push(instrumentos);
        }

        params.push(jovem.id, jovem.tenant_id);
        await pool.query(
            `UPDATE jovens SET ${campos.join(', ')} WHERE id = ? AND tenant_id = ?`,
            params
        );

        if (pastoraisIds.length || Array.isArray(req.body.pastorais)) {
            const { ensurePastoraisTables } = require('../lib/pastorais');
            await ensurePastoraisTables();
            if (pastoraisIds.length) {
                const [validas] = await pool.query(
                    `SELECT id FROM pastorais WHERE tenant_id = ? AND id IN (${pastoraisIds.map(() => '?').join(',')})`,
                    [jovem.tenant_id, ...pastoraisIds]
                );
                const validSet = new Set((validas || []).map((v) => Number(v.id)));
                const invalidas = pastoraisIds.filter((v) => !validSet.has(v));
                if (invalidas.length) {
                    return res.status(400).json({ error: 'Pastoral inválida.' });
                }
            }

            await pool.query(
                'DELETE FROM pastorais_jovens WHERE tenant_id = ? AND jovem_id = ?',
                [jovem.tenant_id, jovem.id]
            );

            if (pastoraisIds.length) {
                const values = pastoraisIds.map((id) => [jovem.tenant_id, id, jovem.id]);
                await pool.query(
                    'INSERT INTO pastorais_jovens (tenant_id, pastoral_id, jovem_id) VALUES ?',
                    [values]
                );
            }
        }

        if (comentarioAdicional) {
            await ensureAtualizacaoTables();
            await pool.query(
                `INSERT INTO jovens_atualizacao_comentarios (tenant_id, jovem_id, nome_completo, telefone, comentario)
                 VALUES (?, ?, ?, ?, ?)`,
                [jovem.tenant_id, jovem.id, nomeCompletoNovo || jovem.nome_completo, telefoneNovo, comentarioAdicional]
            );
        }

        return res.json({ message: 'Dados atualizados com sucesso.' });
    } catch (err) {
        console.error('Erro ao atualizar dados pelo formulário público de jovens:', err);
        return res.status(500).json({ error: 'Erro ao atualizar dados.' });
    }
});

router.post('/nao-encontrado', async (req, res) => {
    try {
        await ensureAtualizacaoTables();
        const nome = String(req.body.nome_completo || '').trim();
        const telefone = String(req.body.telefone || '').trim();
        const ejc = String(req.body.ejc_que_fez || '').trim();
        const tenantId = req.body.tenant_id ? Number(req.body.tenant_id) : null;
        if (!nome || !telefone || !ejc) {
            return res.status(400).json({ error: 'Informe nome, telefone e EJC que fez.' });
        }
        await pool.query(
            `INSERT INTO jovens_atualizacao_nao_encontrado (tenant_id, nome_completo, telefone, ejc_que_fez)
             VALUES (?, ?, ?, ?)`,
            [tenantId || null, nome, telefone, ejc]
        );
        return res.json({ message: 'Dados enviados com sucesso.' });
    } catch (err) {
        console.error('Erro ao salvar não encontrado:', err);
        return res.status(500).json({ error: 'Erro ao enviar dados.' });
    }
});

module.exports = router;
