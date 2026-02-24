const express = require('express');
const db = require('../database');
const { getTenantId } = require('../lib/tenantIsolation');

const router = express.Router();

async function hasTable(tableName) {
    const [rows] = await db.pool.query(`
        SELECT COUNT(*) AS cnt
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
    `, [tableName]);
    return !!(rows && rows[0] && rows[0].cnt > 0);
}

async function hasColumn(tableName, columnName) {
    const [rows] = await db.pool.query(`
        SELECT COUNT(*) AS cnt
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
    `, [tableName, columnName]);
    return !!(rows && rows[0] && rows[0].cnt > 0);
}

// GET /api/visitantes
router.get('/', async (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const hasPresencas = await hasTable('formularios_presencas');
        const hasItens = await hasTable('formularios_itens');
        if (!hasPresencas || !hasItens) return res.json([]);

        const requiredColumns = [
            ['formularios_presencas', 'tenant_id'],
            ['formularios_presencas', 'formulario_id'],
            ['formularios_presencas', 'nome_completo'],
            ['formularios_presencas', 'telefone'],
            ['formularios_presencas', 'status_ejc'],
            ['formularios_itens', 'id'],
            ['formularios_itens', 'tenant_id']
        ];

        for (const [tableName, columnName] of requiredColumns) {
            // eslint-disable-next-line no-await-in-loop
            if (!await hasColumn(tableName, columnName)) return res.json([]);
        }

        const [rows] = await db.pool.query(`
            SELECT
                MAX(TRIM(fp.nome_completo)) AS nome_completo,
                MAX(TRIM(fp.telefone)) AS telefone,
                COUNT(DISTINCT fp.formulario_id) AS total_eventos,
                GROUP_CONCAT(
                    DISTINCT CONCAT(
                        COALESCE(fi.titulo, 'Evento sem título'),
                        CASE
                            WHEN fi.evento_data IS NULL THEN ''
                            ELSE CONCAT(' (', DATE_FORMAT(fi.evento_data, '%d/%m/%Y'), ')')
                        END
                    )
                    ORDER BY fi.evento_data DESC, fi.id DESC
                    SEPARATOR '||'
                ) AS eventos
            FROM formularios_presencas fp
            JOIN formularios_itens fi
              ON fi.id = fp.formulario_id
             AND fi.tenant_id = fp.tenant_id
            WHERE fp.tenant_id = ?
              AND fp.status_ejc = 'NAO_FIZ'
              AND COALESCE(TRIM(fp.nome_completo), '') <> ''
              AND COALESCE(TRIM(fp.telefone), '') <> ''
            GROUP BY
                LOWER(TRIM(fp.nome_completo)),
                REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(fp.telefone), ' ', ''), '(', ''), ')', ''), '-', ''), '+', '')
            HAVING COUNT(DISTINCT fp.formulario_id) > 3
            ORDER BY MAX(TRIM(fp.nome_completo)) ASC
        `, [tenantId]);

        return res.json((rows || []).map((r) => ({
            nome_completo: r.nome_completo || '',
            telefone: r.telefone || '',
            total_eventos: Number(r.total_eventos || 0),
            eventos: String(r.eventos || '')
                .split('||')
                .map((e) => String(e || '').trim())
                .filter(Boolean)
        })));
    } catch (error) {
        console.error('Erro ao listar visitantes:', error);
        return res.status(500).json({ error: 'Erro ao listar visitantes.' });
    }
});

module.exports = router;
