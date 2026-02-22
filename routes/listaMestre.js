const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'public/uploads/fotos_jovens';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'));
    }
});
const upload = multer({ storage: storage });

let hasSubfuncaoColumnCache = null;
let hasHistoricoCreatedAtColumnCache = null;
let hasEhMusicoColumnCache = null;
let hasInstrumentosMusicaisColumnCache = null;
let hasSexoColumnCache = null;
async function hasSubfuncaoColumn() {
    if (hasSubfuncaoColumnCache !== null) return hasSubfuncaoColumnCache;
    const [rows] = await pool.query(`
        SELECT COUNT(*) as cnt
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'historico_equipes'
          AND COLUMN_NAME = 'subfuncao'
    `);
    hasSubfuncaoColumnCache = !!(rows && rows[0] && rows[0].cnt > 0);
    return hasSubfuncaoColumnCache;
}

async function hasHistoricoCreatedAtColumn() {
    if (hasHistoricoCreatedAtColumnCache !== null) return hasHistoricoCreatedAtColumnCache;
    const [rows] = await pool.query(`
        SELECT COUNT(*) as cnt
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'historico_equipes'
          AND COLUMN_NAME = 'created_at'
    `);
    hasHistoricoCreatedAtColumnCache = !!(rows && rows[0] && rows[0].cnt > 0);
    return hasHistoricoCreatedAtColumnCache;
}

async function hasEhMusicoColumn() {
    if (hasEhMusicoColumnCache !== null) return hasEhMusicoColumnCache;
    const [rows] = await pool.query(`
        SELECT COUNT(*) as cnt
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'jovens'
          AND COLUMN_NAME = 'eh_musico'
    `);
    hasEhMusicoColumnCache = !!(rows && rows[0] && rows[0].cnt > 0);
    return hasEhMusicoColumnCache;
}

async function hasInstrumentosMusicaisColumn() {
    if (hasInstrumentosMusicaisColumnCache !== null) return hasInstrumentosMusicaisColumnCache;
    const [rows] = await pool.query(`
        SELECT COUNT(*) as cnt
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'jovens'
          AND COLUMN_NAME = 'instrumentos_musicais'
    `);
    hasInstrumentosMusicaisColumnCache = !!(rows && rows[0] && rows[0].cnt > 0);
    return hasInstrumentosMusicaisColumnCache;
}

async function hasSexoColumn() {
    if (hasSexoColumnCache !== null) return hasSexoColumnCache;

    const [rows] = await pool.query(`
        SELECT COUNT(*) as cnt
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'jovens'
          AND COLUMN_NAME = 'sexo'
    `);
    const existe = !!(rows && rows[0] && rows[0].cnt > 0);
    if (existe) {
        hasSexoColumnCache = true;
        return true;
    }

    try {
        await pool.query("ALTER TABLE jovens ADD COLUMN sexo ENUM('Feminino','Masculino') NULL");
    } catch (e) { }

    const [rows2] = await pool.query(`
        SELECT COUNT(*) as cnt
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'jovens'
          AND COLUMN_NAME = 'sexo'
    `);
    hasSexoColumnCache = !!(rows2 && rows2[0] && rows2[0].cnt > 0);
    return hasSexoColumnCache;
}

async function hasColumn(tableName, columnName) {
    const [rows] = await pool.query(`
        SELECT COUNT(*) as cnt
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
    `, [tableName, columnName]);
    return !!(rows && rows[0] && rows[0].cnt > 0);
}

function serializarInstrumentos(value, ehMusico) {
    if (!ehMusico) return null;
    let lista = [];
    if (Array.isArray(value)) {
        lista = value.map(v => String(v || '').trim()).filter(Boolean);
    } else if (typeof value === 'string') {
        const texto = value.trim();
        if (texto) {
            try {
                const parsed = JSON.parse(texto);
                if (Array.isArray(parsed)) {
                    lista = parsed.map(v => String(v || '').trim()).filter(Boolean);
                } else {
                    lista = texto.split(',').map(v => v.trim()).filter(Boolean);
                }
            } catch (e) {
                lista = texto.split(',').map(v => v.trim()).filter(Boolean);
            }
        }
    }
    if (!lista.length) return null;
    return JSON.stringify(lista);
}


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
        const [rows] = await pool.query(`SELECT id, nome_completo, circulo, telefone, numero_ejc_fez, sexo, data_nascimento FROM jovens WHERE nome_completo LIKE ? ORDER BY nome_completo LIMIT 20`, [like]);
        res.json(rows);
    } catch (err) {
        console.error('Erro na busca de jovens:', err);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// GET - Registros de moita (para menu Moita)
router.get('/moita/registros', async (req, res) => {
    try {
        const comParoquiaCol = await hasColumn('jovens_comissoes', 'paroquia');
        const comFuncaoCol = await hasColumn('jovens_comissoes', 'funcao_garcom');
        const selectParoquia = comParoquiaCol
            ? 'COALESCE(oe.paroquia, jc.paroquia) AS paroquia'
            : 'oe.paroquia AS paroquia';
        const selectFuncao = comFuncaoCol
            ? "COALESCE(jc.funcao_garcom, '-') AS funcao_moita"
            : "'-' AS funcao_moita";

        const [rows] = await pool.query(`
            SELECT 
                jc.id,
                jc.jovem_id,
                j.nome_completo,
                j.telefone,
                j.numero_ejc_fez,
                eorig.numero AS ejc_origem_numero,
                jc.ejc_numero,
                ${selectParoquia},
                ${selectFuncao}
            FROM jovens_comissoes jc
            JOIN jovens j ON j.id = jc.jovem_id
            LEFT JOIN ejc eorig ON eorig.id = j.numero_ejc_fez
            LEFT JOIN outros_ejcs oe ON oe.id = jc.outro_ejc_id
            WHERE jc.tipo = 'MOITA_OUTRO'
            ORDER BY jc.id DESC
        `);
        res.json(rows);
    } catch (err) {
        console.error("Erro ao listar registros de moita:", err);
        res.status(500).json({ error: "Erro ao listar registros de moita" });
    }
});

// GET - Relatório completo de histórico para exportação
router.get('/relatorio/historico-completo', async (req, res) => {
    try {
        const comSubfuncao = await hasSubfuncaoColumn();
        const subfuncaoSelect = comSubfuncao ? 'he.subfuncao' : 'NULL as subfuncao';
        const [rows] = await pool.query(`
            SELECT he.jovem_id, he.equipe, he.papel, ${subfuncaoSelect}, e.numero as numero_ejc, e.id as ejc_id
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
        const { nome_completo, telefone, data_nascimento, numero_ejc_fez, instagram, estado_civil, data_casamento, circulo, deficiencia, qual_deficiencia, restricao_alimentar, detalhes_restricao, sexo } = req.body;

        if (!nome_completo || !telefone) {
            return res.status(400).json({ error: "Nome completo e telefone são obrigatórios" });
        }

        const comEhMusico = await hasEhMusicoColumn();
        const comInstrumentos = await hasInstrumentosMusicaisColumn();
        const comSexo = await hasSexoColumn();
        const ehMusico = !!req.body.eh_musico;

        const campos = [
            'nome_completo',
            'telefone',
            'data_nascimento',
            'numero_ejc_fez',
            'instagram',
            'estado_civil',
            'data_casamento',
            'circulo',
            'deficiencia',
            'qual_deficiencia',
            'restricao_alimentar',
            'detalhes_restricao'
        ];
        const valores = [
            nome_completo,
            telefone,
            normalizeDate(data_nascimento),
            numero_ejc_fez || null,
            instagram || null,
            estado_civil || 'Solteiro',
            normalizeDate(data_casamento),
            circulo || null,
            deficiencia ? 1 : 0,
            qual_deficiencia || null,
            restricao_alimentar ? 1 : 0,
            detalhes_restricao || null
        ];

        if (comSexo) {
            campos.push('sexo');
            valores.push((sexo === 'Feminino' || sexo === 'Masculino') ? sexo : null);
        }

        if (comEhMusico) {
            campos.push('eh_musico');
            valores.push(ehMusico ? 1 : 0);
        }
        if (comInstrumentos) {
            campos.push('instrumentos_musicais');
            valores.push(serializarInstrumentos(req.body.instrumentos_musicais, ehMusico));
        }

        const placeholders = campos.map(() => '?').join(', ');
        const [result] = await pool.query(
            `INSERT INTO jovens (${campos.join(', ')}) VALUES (${placeholders})`,
            valores
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
            sexo: req.body.sexo !== undefined ? req.body.sexo : atual.sexo,
            data_nascimento: req.body.data_nascimento !== undefined ? normalizeDate(req.body.data_nascimento) : (atual.data_nascimento ? normalizeDate(atual.data_nascimento) : null),
            numero_ejc_fez: req.body.numero_ejc_fez !== undefined ? req.body.numero_ejc_fez : atual.numero_ejc_fez,
            instagram: req.body.instagram !== undefined ? req.body.instagram : (atual.instagram === undefined ? null : atual.instagram),
            estado_civil: req.body.estado_civil !== undefined ? req.body.estado_civil : atual.estado_civil,
            data_casamento: req.body.data_casamento !== undefined ? normalizeDate(req.body.data_casamento) : (atual.data_casamento ? normalizeDate(atual.data_casamento) : null),
            circulo: req.body.circulo !== undefined ? req.body.circulo : atual.circulo,
            deficiencia: req.body.deficiencia !== undefined ? (req.body.deficiencia ? 1 : 0) : (typeof atual.deficiencia === 'number' ? atual.deficiencia : (atual.deficiencia ? 1 : 0)),
            qual_deficiencia: req.body.qual_deficiencia !== undefined ? req.body.qual_deficiencia : atual.qual_deficiencia,
            restricao_alimentar: req.body.restricao_alimentar !== undefined ? (req.body.restricao_alimentar ? 1 : 0) : (atual.restricao_alimentar ? 1 : 0),
            detalhes_restricao: req.body.detalhes_restricao !== undefined ? req.body.detalhes_restricao : atual.detalhes_restricao,
            conjuge_id: req.body.conjuge_id !== undefined ? req.body.conjuge_id : atual.conjuge_id,
            conjuge_nome: req.body.conjuge_nome !== undefined ? req.body.conjuge_nome : atual.conjuge_nome,
            conjuge_telefone: req.body.conjuge_telefone !== undefined ? req.body.conjuge_telefone : actualValueOrNull(atual.conjuge_telefone),
            conjuge_ejc_id: req.body.conjuge_ejc_id !== undefined ? req.body.conjuge_ejc_id : atual.conjuge_ejc_id,
            conjuge_outro_ejc_id: req.body.conjuge_outro_ejc_id !== undefined ? req.body.conjuge_outro_ejc_id : atual.conjuge_outro_ejc_id,
            conjuge_paroquia: req.body.conjuge_paroquia !== undefined ? req.body.conjuge_paroquia : atual.conjuge_paroquia,
            eh_musico: req.body.eh_musico !== undefined ? (req.body.eh_musico ? 1 : 0) : (atual.eh_musico ? 1 : 0),
            instrumentos_musicais: req.body.instrumentos_musicais !== undefined ? req.body.instrumentos_musicais : atual.instrumentos_musicais,
            observacoes_extras: req.body.observacoes_extras !== undefined ? req.body.observacoes_extras : atual.observacoes_extras
        };

        if (!merged.eh_musico) {
            merged.instrumentos_musicais = [];
        }

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
        const hasEhMusico = await hasEhMusicoColumn();
        const hasInstrumentosMusicais = await hasInstrumentosMusicaisColumn();
        const hasSexo = await hasSexoColumn();

        let updateFields = `nome_completo=?, telefone=?, data_nascimento=?, numero_ejc_fez=?, instagram=?, estado_civil=?, data_casamento=?, circulo=?, deficiencia=?, qual_deficiencia=?, restricao_alimentar=?, detalhes_restricao=?, conjuge_id=?, conjuge_nome=?, conjuge_telefone=?, conjuge_ejc_id=?, conjuge_outro_ejc_id=?, observacoes_extras=?`;
        const params = [merged.nome_completo, merged.telefone, merged.data_nascimento, merged.numero_ejc_fez, merged.instagram, merged.estado_civil, merged.data_casamento, merged.circulo, merged.deficiencia, merged.qual_deficiencia, merged.restricao_alimentar, merged.detalhes_restricao, merged.conjuge_id || null, merged.conjuge_nome || null, merged.conjuge_telefone || null, merged.conjuge_ejc_id || null, merged.conjuge_outro_ejc_id || null, merged.observacoes_extras || null];
        if (hasSexo) {
            updateFields += ', sexo=?';
            params.push((merged.sexo === 'Feminino' || merged.sexo === 'Masculino') ? merged.sexo : null);
        }
        if (hasConjugeParoquia) {
            updateFields += ', conjuge_paroquia=?';
            params.push(merged.conjuge_paroquia || null);
        }
        if (hasEhMusico) {
            updateFields += ', eh_musico=?';
            params.push(merged.eh_musico ? 1 : 0);
        }
        if (hasInstrumentosMusicais) {
            updateFields += ', instrumentos_musicais=?';
            params.push(serializarInstrumentos(merged.instrumentos_musicais, merged.eh_musico));
        }
        params.push(id);

        await pool.query(`UPDATE jovens SET ${updateFields} WHERE id=?`, params);

        // ... lógica de cônjuge (sincronização) ...
        const previousConjugeId = atual.conjuge_id || null;
        const newConjugeId = merged.conjuge_id || null;

        if (previousConjugeId && previousConjugeId !== newConjugeId) {
            let clearFields = 'conjuge_id=NULL, conjuge_nome=NULL, conjuge_telefone=NULL, conjuge_ejc_id=NULL, conjuge_outro_ejc_id=NULL';
            if (hasConjugeParoquia) clearFields += ', conjuge_paroquia=NULL';
            if (!newConjugeId) {
                const [vinculoAtual] = await pool.query(
                    'SELECT conjuge_id FROM jovens WHERE id = ?',
                    [previousConjugeId]
                );
                const estavaVinculadoComEsteJovem = vinculoAtual && vinculoAtual[0]
                    && Number(vinculoAtual[0].conjuge_id) === Number(id);
                if (estavaVinculadoComEsteJovem) {
                    clearFields += ", estado_civil='Solteiro', data_casamento=NULL";
                }
            }
            await pool.query(`UPDATE jovens SET ${clearFields} WHERE id = ?`, [previousConjugeId]);
        }

        if (newConjugeId) {
            try {
                const [sp] = await pool.query('SELECT * FROM jovens WHERE id = ?', [newConjugeId]);
                if (sp && sp.length) {
                    const parceiro = sp[0];
                    const parceiroEstado = parceiro.estado_civil;
                    const parceiroDataCasamento = parceiro.data_casamento;
                    const shouldAtualizarEstadoParceiro = parceiroEstado === 'Solteiro';
                    const estadoRelacaoAtual = (merged.estado_civil === 'Amasiado') ? 'Amasiado' : 'Casado';
                    const finalEstado = shouldAtualizarEstadoParceiro ? estadoRelacaoAtual : parceiroEstado;
                    const finalDataCasamento = merged.data_casamento || parceiroDataCasamento || null;

                    await pool.query(
                        `UPDATE jovens SET conjuge_id=?, conjuge_nome=?, conjuge_telefone=?, conjuge_ejc_id=?, conjuge_outro_ejc_id=?, estado_civil=?, data_casamento=? WHERE id=?`,
                        [id, merged.nome_completo || atual.nome_completo, merged.telefone || actualValueOrNull(atual.telefone), null, null, finalEstado, finalDataCasamento, newConjugeId]
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
                    let clearPartnerFields = "conjuge_id=NULL, conjuge_nome=NULL, conjuge_telefone=NULL, conjuge_ejc_id=NULL, conjuge_outro_ejc_id=NULL";
                    if (hasConjugeParoquia) clearPartnerFields += ', conjuge_paroquia=NULL';
                    clearPartnerFields += ", estado_civil='Solteiro', data_casamento=NULL";
                    await pool.query(
                        `UPDATE jovens SET ${clearPartnerFields} WHERE id = ?`,
                        [linkedId]
                    );
                }
                let clearSelfFields = 'conjuge_id=NULL, conjuge_nome=NULL, conjuge_telefone=NULL, conjuge_ejc_id=NULL, conjuge_outro_ejc_id=NULL';
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

        // Deletar a imagem caso exista
        const [rows] = await pool.query('SELECT foto_url FROM jovens WHERE id = ?', [id]);
        if (rows.length > 0 && rows[0].foto_url) {
            const filepath = path.join(__dirname, '..', 'public', rows[0].foto_url);
            if (fs.existsSync(filepath)) {
                fs.unlinkSync(filepath);
            }
        }

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

// POST - Upload da foto do Jovem
router.post('/:id/foto', upload.single('foto'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Nenhuma imagem selecionada" });

    const { id } = req.params;
    const fotoUrl = `/uploads/fotos_jovens/${req.file.filename}`;

    try {
        // Obter a foto anterior, se existir, para deletar
        const [rows] = await pool.query('SELECT foto_url FROM jovens WHERE id = ?', [id]);
        if (rows.length > 0 && rows[0].foto_url) {
            const filepath = path.join(__dirname, '..', 'public', rows[0].foto_url);
            if (fs.existsSync(filepath)) {
                try {
                    fs.unlinkSync(filepath);
                } catch (e) {
                    console.error("Não foi possível excluir foto anterior", e);
                }
            }
        }

        // Atualizar banco
        const [result] = await pool.query('UPDATE jovens SET foto_url = ? WHERE id = ?', [fotoUrl, id]);

        if (result.affectedRows === 0) {
            // Se o jovem não existe, exclui a foto upada e retorna erro
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'Jovem não encontrado' });
        }

        res.json({ message: 'Foto salva com sucesso', foto_url: fotoUrl });
    } catch (err) {
        console.error("Erro ao salvar foto do jovem:", err);
        res.status(500).json({ error: "Erro ao salvar foto" });
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
        const comSubfuncao = await hasSubfuncaoColumn();
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
                            restricao_alimentar = COALESCE(?, restricao_alimentar),
                            detalhes_restricao = COALESCE(?, detalhes_restricao),
                            conjuge_nome = COALESCE(?, conjuge_nome)
                        WHERE id = ?`,
                        [j.telefone, j.data_nascimento, j.numero_ejc_fez, j.instagram, j.estado_civil, j.data_casamento, j.circulo, j.deficiencia, j.qual_deficiencia, j.restricao_alimentar, j.detalhes_restricao, j.conjuge_nome, jovemId]
                    );
                    atualizados++;
                } else {
                    const [resInsert] = await connection.query(
                        `INSERT INTO jovens (nome_completo, telefone, data_nascimento, numero_ejc_fez, instagram, estado_civil, data_casamento, circulo, deficiencia, qual_deficiencia, restricao_alimentar, detalhes_restricao, conjuge_nome)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [j.nome_completo, j.telefone, j.data_nascimento, j.numero_ejc_fez, j.instagram, j.estado_civil, j.data_casamento, j.circulo, j.deficiencia, j.qual_deficiencia, j.restricao_alimentar, j.detalhes_restricao, j.conjuge_nome]
                    );
                    jovemId = resInsert.insertId;
                    criados++;
                }

                if (item.historico && item.historico.length > 0) {
                    for (const hist of item.historico) {
                        const papelHist = hist.papel || 'Membro';
                        const subfuncaoHist = hist.subfuncao || null;
                        const [histExists] = await connection.query(
                            comSubfuncao
                                ? 'SELECT id FROM historico_equipes WHERE jovem_id = ? AND ejc_id = ? AND equipe = ? AND papel = ? AND (subfuncao <=> ?)'
                                : 'SELECT id FROM historico_equipes WHERE jovem_id = ? AND ejc_id = ? AND equipe = ? AND papel = ?',
                            comSubfuncao
                                ? [jovemId, hist.ejc_id, hist.equipe, papelHist, subfuncaoHist]
                                : [jovemId, hist.ejc_id, hist.equipe, papelHist]
                        );

                        if (histExists.length === 0) {
                            if (comSubfuncao) {
                                await connection.query(
                                    'INSERT INTO historico_equipes (jovem_id, equipe, ejc_id, papel, subfuncao) VALUES (?, ?, ?, ?, ?)',
                                    [jovemId, hist.equipe, hist.ejc_id, papelHist, subfuncaoHist]
                                );
                            } else {
                                await connection.query(
                                    'INSERT INTO historico_equipes (jovem_id, equipe, ejc_id, papel) VALUES (?, ?, ?, ?)',
                                    [jovemId, hist.equipe, hist.ejc_id, papelHist]
                                );
                            }
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
        const comCreatedAt = await hasHistoricoCreatedAtColumn();
        const orderBy = comCreatedAt ? 'he.created_at DESC' : 'he.id DESC';
        const [rows] = await pool.query(`
            SELECT 
                he.*, 
                COALESCE(e.numero, he.edicao_ejc) as display_ejc,
                e.paroquia as paroquia_ejc
            FROM historico_equipes he 
            LEFT JOIN ejc e ON he.ejc_id = e.id
            WHERE he.jovem_id = ?
            ORDER BY ${orderBy}
        `, [req.params.jovemId]);

        const [montagensRows] = await pool.query(`
            SELECT numero_ejc, COALESCE(data_fim, data_encontro) AS data_limite
            FROM montagens
        `);
        const limitePorNumero = new Map();
        for (const m of montagensRows || []) {
            if (!m || m.numero_ejc === null || m.numero_ejc === undefined) continue;
            const numero = Number(m.numero_ejc);
            if (!Number.isFinite(numero)) continue;
            const limite = m.data_limite ? String(m.data_limite).split('T')[0] : null;
            if (!limite) continue;
            const atual = limitePorNumero.get(numero);
            if (!atual || limite > atual) limitePorNumero.set(numero, limite);
        }

        const hoje = new Date();
        const hojeIso = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()))
            .toISOString()
            .split('T')[0];

        const normalizados = rows.map((r) => {
            const item = { ...r };
            const texto = item.display_ejc == null ? '' : String(item.display_ejc).trim();
            const m = texto.match(/^(\d+)\s*[ºo°]?\s*EJC\s*\(Montagem\)\s*$/i);
            if (!m) return item;

            const numero = Number(m[1]);
            const limite = limitePorNumero.get(numero);
            if (!limite || limite >= hojeIso) return item;

            item.display_ejc = `${numero}º EJC`;
            return item;
        });

        res.json(normalizados);
    } catch (err) {
        console.error("Erro ao buscar histórico:", err);
        res.status(500).json({ error: "Erro no servidor" });
    }
});

// POST - Adicionar histórico manualmente
router.post('/historico', async (req, res) => {
    const { jovem_id, equipe_nome, ejc_id, papel, subfuncao } = req.body;

    if (!jovem_id || !equipe_nome || !ejc_id) {
        return res.status(400).json({ error: "Jovem, Equipe e EJC são obrigatórios" });
    }

    try {
        const comSubfuncao = await hasSubfuncaoColumn();
        const [result] = comSubfuncao
            ? await pool.query(
                'INSERT INTO historico_equipes (jovem_id, equipe, ejc_id, papel, subfuncao) VALUES (?, ?, ?, ?, ?)',
                [jovem_id, equipe_nome, ejc_id, papel || 'Membro', subfuncao || null]
            )
            : await pool.query(
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
            SELECT 
                jc.*,
                oe.nome as outro_ejc_nome,
                oe.paroquia as outro_ejc_paroquia,
                c.periodo AS coordenacao_periodo,
                c.pasta_id AS coordenacao_pasta_id,
                p.nome AS coordenacao_pasta_nome,
                p.parent_id AS coordenacao_pasta_parent_id
            FROM jovens_comissoes jc 
            LEFT JOIN outros_ejcs oe ON jc.outro_ejc_id = oe.id
            LEFT JOIN coordenacoes_membros cm ON cm.comissao_id = jc.id
            LEFT JOIN coordenacoes c ON c.id = cm.coordenacao_id
            LEFT JOIN coordenacoes_pastas p ON p.id = c.pasta_id
            WHERE jc.jovem_id = ? 
            ORDER BY jc.id DESC
        `, [req.params.jovemId]);

        const idsPasta = [...new Set(
            (rows || [])
                .map(r => Number(r.coordenacao_pasta_id))
                .filter(v => Number.isFinite(v) && v > 0)
        )];

        let pastasMap = new Map();
        if (idsPasta.length) {
            const [pastas] = await pool.query('SELECT id, nome, parent_id FROM coordenacoes_pastas');
            pastasMap = new Map((pastas || []).map(p => [Number(p.id), p]));
        }

        const montarCaminho = (pastaId) => {
            if (!pastaId || !pastasMap.size) return null;
            const nomes = [];
            const visitados = new Set();
            let atual = pastasMap.get(Number(pastaId));
            while (atual && !visitados.has(Number(atual.id))) {
                nomes.unshift(String(atual.nome || '').trim());
                visitados.add(Number(atual.id));
                const parentId = atual.parent_id ? Number(atual.parent_id) : null;
                atual = parentId ? pastasMap.get(parentId) : null;
            }
            return nomes.filter(Boolean).join(' / ') || null;
        };

        const normalizados = (rows || []).map(r => ({
            ...r,
            coordenacao_pasta_caminho: montarCaminho(r.coordenacao_pasta_id)
        }));

        res.json(normalizados);
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
        const [[item]] = await pool.query(
            'SELECT id, tipo FROM jovens_comissoes WHERE id = ? LIMIT 1',
            [req.params.id]
        );
        if (!item) return res.status(404).json({ error: "Item não encontrado" });
        if (item.tipo === 'COORDENACAO') {
            return res.status(403).json({ error: "Itens de coordenação devem ser gerenciados na tela Cordenadores." });
        }
        if (item.tipo === 'GARCOM_EQUIPE') {
            return res.status(403).json({ error: "Itens de equipe de garçom devem ser gerenciados na tela Garçons." });
        }

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
