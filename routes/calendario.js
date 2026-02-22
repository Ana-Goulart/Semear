const express = require('express');
const router = express.Router();
const { pool } = require('../database');

let estruturaGarantida = false;

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

async function garantirEstrutura() {
    if (estruturaGarantida) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS calendario_pastas (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(120) NOT NULL,
            parent_id INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_cal_pasta_nome_parent (nome, parent_id)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS calendario_eventos_padrao (
            id INT AUTO_INCREMENT PRIMARY KEY,
            pasta_id INT NOT NULL,
            nome_evento VARCHAR(180) NOT NULL,
            recorrencia TEXT NOT NULL,
            recorrencia_tipo ENUM('SEMANAL','MENSAL_NTH') NOT NULL DEFAULT 'SEMANAL',
            dia_semana TINYINT NULL,
            ordinal_semana TINYINT NULL,
            hora_inicio_aprox TIME NULL,
            hora_fim_aprox TIME NULL,
            data_inicio DATE NULL,
            data_fim DATE NULL,
            meses_excluidos_json TEXT NULL,
            responsavel_pasta_id INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_cal_evento_pasta FOREIGN KEY (pasta_id) REFERENCES calendario_pastas(id) ON DELETE CASCADE
        )
    `);

    if (!(await hasColumn('calendario_eventos_padrao', 'recorrencia_tipo'))) {
        await pool.query("ALTER TABLE calendario_eventos_padrao ADD COLUMN recorrencia_tipo ENUM('SEMANAL','MENSAL_NTH') NOT NULL DEFAULT 'SEMANAL' AFTER recorrencia");
    }
    if (!(await hasColumn('calendario_eventos_padrao', 'dia_semana'))) {
        await pool.query('ALTER TABLE calendario_eventos_padrao ADD COLUMN dia_semana TINYINT NULL AFTER recorrencia_tipo');
    }
    if (!(await hasColumn('calendario_eventos_padrao', 'ordinal_semana'))) {
        await pool.query('ALTER TABLE calendario_eventos_padrao ADD COLUMN ordinal_semana TINYINT NULL AFTER dia_semana');
    }
    if (!(await hasColumn('calendario_eventos_padrao', 'hora_inicio_aprox'))) {
        await pool.query('ALTER TABLE calendario_eventos_padrao ADD COLUMN hora_inicio_aprox TIME NULL AFTER ordinal_semana');
    }
    if (!(await hasColumn('calendario_eventos_padrao', 'hora_fim_aprox'))) {
        await pool.query('ALTER TABLE calendario_eventos_padrao ADD COLUMN hora_fim_aprox TIME NULL AFTER hora_inicio_aprox');
    }

    const [rows] = await pool.query(
        `SELECT id FROM calendario_pastas WHERE nome = 'Eventos Padrão' AND parent_id IS NULL LIMIT 1`
    );
    if (!rows.length) {
        await pool.query(
            `INSERT INTO calendario_pastas (nome, parent_id) VALUES ('Eventos Padrão', NULL)`
        );
    }

    estruturaGarantida = true;
}

function normalizarData(value) {
    if (value === null || value === undefined || value === '') return null;
    const txt = String(value).trim();
    if (!txt) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(txt)) return txt;
    return null;
}

function normalizarHora(value) {
    if (value === null || value === undefined || value === '') return null;
    const txt = String(value).trim();
    if (!txt) return null;
    if (/^\d{2}:\d{2}$/.test(txt)) return `${txt}:00`;
    if (/^\d{2}:\d{2}:\d{2}$/.test(txt)) return txt;
    return null;
}

function normalizarMeses(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(v => Number(v)).filter(v => Number.isInteger(v) && v >= 1 && v <= 12))];
}

function parseMesesExcluidos(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed.map(Number).filter(v => Number.isInteger(v) && v >= 1 && v <= 12) : [];
    } catch (_) {
        return [];
    }
}

function formatDateISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function parseISODate(value) {
    if (!value) return null;
    const d = new Date(`${value}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
}

function nthWeekdayOfMonth(year, monthZeroBased, weekday, ordinal) {
    const first = new Date(year, monthZeroBased, 1);
    const firstWeekday = first.getDay();
    const offset = (7 + weekday - firstWeekday) % 7;
    const day = 1 + offset + (ordinal - 1) * 7;
    const daysInMonth = new Date(year, monthZeroBased + 1, 0).getDate();
    if (day < 1 || day > daysInMonth) return null;
    return new Date(year, monthZeroBased, day);
}

function gerarOcorrenciasEvento(evento, startDate, endDate) {
    const ocorrencias = [];

    const regraInicio = parseISODate(evento.data_inicio);
    const regraFim = parseISODate(evento.data_fim);

    const inicio = new Date(Math.max(startDate.getTime(), regraInicio ? regraInicio.getTime() : startDate.getTime()));
    const fim = new Date(Math.min(endDate.getTime(), regraFim ? regraFim.getTime() : endDate.getTime()));

    if (inicio > fim) return ocorrencias;

    const mesesExcluidos = parseMesesExcluidos(evento.meses_excluidos_json);
    const tipo = String(evento.recorrencia_tipo || 'SEMANAL').toUpperCase();

    if (tipo === 'MENSAL_NTH') {
        const weekday = Number(evento.dia_semana);
        const ordinal = Number(evento.ordinal_semana);
        if (!(weekday >= 0 && weekday <= 6) || !(ordinal >= 1 && ordinal <= 5)) return ocorrencias;

        let y = inicio.getFullYear();
        let m = inicio.getMonth();
        const endY = fim.getFullYear();
        const endM = fim.getMonth();

        while (y < endY || (y === endY && m <= endM)) {
            if (!mesesExcluidos.includes(m + 1)) {
                const occ = nthWeekdayOfMonth(y, m, weekday, ordinal);
                if (occ && occ >= inicio && occ <= fim) {
                    ocorrencias.push({
                        evento_id: evento.id,
                        nome_evento: evento.nome_evento,
                        recorrencia: evento.recorrencia,
                        data: formatDateISO(occ),
                        hora_inicio_aprox: evento.hora_inicio_aprox,
                        hora_fim_aprox: evento.hora_fim_aprox,
                        responsavel_nome: evento.responsavel_nome || null
                    });
                }
            }
            m += 1;
            if (m > 11) {
                m = 0;
                y += 1;
            }
        }
        return ocorrencias;
    }

    const weekday = Number(evento.dia_semana);
    if (!(weekday >= 0 && weekday <= 6)) return ocorrencias;

    let d = new Date(inicio);
    d.setHours(0, 0, 0, 0);
    while (d <= fim) {
        if (d.getDay() === weekday && !mesesExcluidos.includes(d.getMonth() + 1)) {
            ocorrencias.push({
                evento_id: evento.id,
                nome_evento: evento.nome_evento,
                recorrencia: evento.recorrencia,
                data: formatDateISO(d),
                hora_inicio_aprox: evento.hora_inicio_aprox,
                hora_fim_aprox: evento.hora_fim_aprox,
                responsavel_nome: evento.responsavel_nome || null
            });
        }
        d.setDate(d.getDate() + 1);
    }

    return ocorrencias;
}

router.get('/pastas', async (req, res) => {
    try {
        await garantirEstrutura();
        const [rows] = await pool.query(`
            SELECT id, nome, parent_id, created_at
            FROM calendario_pastas
            WHERE parent_id IS NULL
            ORDER BY nome ASC
        `);
        res.json(rows);
    } catch (err) {
        console.error('Erro ao listar pastas do calendário:', err);
        res.status(500).json({ error: 'Erro ao listar pastas do calendário' });
    }
});

router.get('/responsaveis', async (req, res) => {
    try {
        await garantirEstrutura();
        const [rows] = await pool.query(`
            SELECT id, nome
            FROM coordenacoes_pastas
            WHERE parent_id IS NULL
            ORDER BY nome ASC
        `);
        res.json(rows);
    } catch (err) {
        console.error('Erro ao listar responsáveis do calendário:', err);
        res.status(500).json({ error: 'Erro ao listar responsáveis' });
    }
});

router.get('/eventos-padrao', async (req, res) => {
    try {
        await garantirEstrutura();
        const pastaId = Number(req.query.pasta_id);
        if (!pastaId) return res.status(400).json({ error: 'pasta_id inválido.' });

        const [rows] = await pool.query(`
            SELECT e.id, e.pasta_id, e.nome_evento, e.recorrencia, e.recorrencia_tipo,
                   e.dia_semana, e.ordinal_semana, e.hora_inicio_aprox, e.hora_fim_aprox,
                   e.data_inicio, e.data_fim, e.meses_excluidos_json, e.responsavel_pasta_id, e.created_at,
                   cp.nome AS responsavel_nome
            FROM calendario_eventos_padrao e
            LEFT JOIN coordenacoes_pastas cp ON cp.id = e.responsavel_pasta_id
            WHERE e.pasta_id = ?
            ORDER BY e.nome_evento ASC
        `, [pastaId]);

        const result = rows.map(r => ({
            ...r,
            meses_excluidos: parseMesesExcluidos(r.meses_excluidos_json)
        }));
        res.json(result);
    } catch (err) {
        console.error('Erro ao listar eventos padrão:', err);
        res.status(500).json({ error: 'Erro ao listar eventos padrão' });
    }
});

router.get('/ocorrencias', async (req, res) => {
    try {
        await garantirEstrutura();
        const start = normalizarData(req.query.start);
        const end = normalizarData(req.query.end);
        if (!start || !end) return res.status(400).json({ error: 'Período inválido.' });
        if (end < start) return res.status(400).json({ error: 'Período inválido.' });

        const startDate = parseISODate(start);
        const endDate = parseISODate(end);
        if (!startDate || !endDate) return res.status(400).json({ error: 'Período inválido.' });

        const [eventos] = await pool.query(`
            SELECT e.id, e.nome_evento, e.recorrencia, e.recorrencia_tipo,
                   e.dia_semana, e.ordinal_semana, e.hora_inicio_aprox, e.hora_fim_aprox,
                   e.data_inicio, e.data_fim, e.meses_excluidos_json,
                   cp.nome AS responsavel_nome
            FROM calendario_eventos_padrao e
            LEFT JOIN coordenacoes_pastas cp ON cp.id = e.responsavel_pasta_id
            ORDER BY e.id ASC
        `);

        const ocorrencias = [];
        for (const evento of eventos) {
            ocorrencias.push(...gerarOcorrenciasEvento(evento, startDate, endDate));
        }

        ocorrencias.sort((a, b) => {
            if (a.data !== b.data) return a.data.localeCompare(b.data);
            const ha = (a.hora_inicio_aprox || '').toString();
            const hb = (b.hora_inicio_aprox || '').toString();
            return ha.localeCompare(hb);
        });

        res.json(ocorrencias);
    } catch (err) {
        console.error('Erro ao gerar ocorrências do calendário:', err);
        res.status(500).json({ error: 'Erro ao gerar ocorrências do calendário' });
    }
});

router.post('/eventos-padrao', async (req, res) => {
    try {
        await garantirEstrutura();
        const pastaId = Number(req.body.pasta_id);
        const nomeEvento = String(req.body.nome_evento || '').trim();
        const recorrenciaTipo = String(req.body.recorrencia_tipo || '').trim().toUpperCase();
        const diaSemana = Number(req.body.dia_semana);
        const ordinalSemana = req.body.ordinal_semana !== undefined && req.body.ordinal_semana !== null && req.body.ordinal_semana !== ''
            ? Number(req.body.ordinal_semana)
            : null;
        const horaInicioAprox = normalizarHora(req.body.hora_inicio_aprox);
        const horaFimAprox = normalizarHora(req.body.hora_fim_aprox);
        const dataInicio = normalizarData(req.body.data_inicio);
        const dataFim = normalizarData(req.body.data_fim);
        const responsavelPastaId = req.body.responsavel_pasta_id ? Number(req.body.responsavel_pasta_id) : null;
        const mesesExcluidos = normalizarMeses(req.body.meses_excluidos);

        if (!pastaId) return res.status(400).json({ error: 'Pasta inválida.' });
        if (!nomeEvento) return res.status(400).json({ error: 'Nome do evento é obrigatório.' });
        if (!['SEMANAL', 'MENSAL_NTH'].includes(recorrenciaTipo)) {
            return res.status(400).json({ error: 'Tipo de recorrência inválido.' });
        }
        if (!(diaSemana >= 0 && diaSemana <= 6)) {
            return res.status(400).json({ error: 'Dia da semana inválido.' });
        }
        if (recorrenciaTipo === 'MENSAL_NTH' && !(ordinalSemana >= 1 && ordinalSemana <= 5)) {
            return res.status(400).json({ error: 'Ordem semanal inválida.' });
        }
        if (dataInicio && dataFim && dataFim < dataInicio) {
            return res.status(400).json({ error: 'Data fim não pode ser menor que data início.' });
        }

        const diaNome = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'][diaSemana] || 'dia';
        const ordNome = { 1: 'primeiro', 2: 'segundo', 3: 'terceiro', 4: 'quarto', 5: 'quinto' };
        const recorrenciaTexto = recorrenciaTipo === 'MENSAL_NTH'
            ? `Todo ${ordNome[ordinalSemana] || ordinalSemana + 'º'} ${diaNome} do mês`
            : `Toda ${diaNome}`;

        const [pastaRows] = await pool.query(
            `SELECT id FROM calendario_pastas WHERE id = ? LIMIT 1`,
            [pastaId]
        );
        if (!pastaRows.length) return res.status(404).json({ error: 'Pasta não encontrada.' });

        if (responsavelPastaId) {
            const [respRows] = await pool.query(
                `SELECT id FROM coordenacoes_pastas WHERE id = ? LIMIT 1`,
                [responsavelPastaId]
            );
            if (!respRows.length) return res.status(404).json({ error: 'Responsável não encontrado.' });
        }

        const [result] = await pool.query(`
            INSERT INTO calendario_eventos_padrao
            (pasta_id, nome_evento, recorrencia, recorrencia_tipo, dia_semana, ordinal_semana,
             hora_inicio_aprox, hora_fim_aprox, data_inicio, data_fim, meses_excluidos_json, responsavel_pasta_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            pastaId,
            nomeEvento,
            recorrenciaTexto,
            recorrenciaTipo,
            diaSemana,
            recorrenciaTipo === 'MENSAL_NTH' ? ordinalSemana : null,
            horaInicioAprox,
            horaFimAprox,
            dataInicio,
            dataFim,
            JSON.stringify(mesesExcluidos),
            responsavelPastaId
        ]);

        res.status(201).json({ id: result.insertId, message: 'Evento padrão criado com sucesso.' });
    } catch (err) {
        console.error('Erro ao criar evento padrão:', err);
        res.status(500).json({ error: 'Erro ao criar evento padrão' });
    }
});

module.exports = router;
