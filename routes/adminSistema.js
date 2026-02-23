const express = require('express');
const { pool } = require('../database');
const { ensureTenantStructure, hashPassword } = require('../lib/tenantSetup');
const { setAdminSessionCookie, clearAdminSessionCookie } = require('../lib/adminSession');

const router = express.Router();
const GRUPO_ADMIN_LOCAL = 'Tios';
const TENANT_SCOPED_TABLES = [
    'usuarios',
    'ejc',
    'outros_ejcs',
    'jovens',
    'historico_equipes',
    'jovens_comissoes',
    'jovens_observacoes',
    'equipes',
    'equipes_ejc',
    'equipes_funcoes',
    'equipes_papeis',
    'equipes_funcoes_padrao',
    'montagens',
    'montagem_membros',
    'montagem_jovens_servir',
    'formularios_pastas',
    'formularios_itens',
    'formularios_presencas',
    'financeiro_movimentacoes',
    'circulos',
    'coordenadores',
    'coordenacoes',
    'coordenacoes_membros',
    'coordenacoes_pastas'
];

function requireAdmin(req, res, next) {
    if (!req.admin || !req.admin.id) return res.status(401).json({ error: 'Não autenticado no painel admin.' });
    next();
}

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

router.get('/me', async (req, res) => {
    try {
        await ensureTenantStructure();
        if (!req.admin || !req.admin.id) return res.json({ logged: false });
        const [rows] = await pool.query(
            'SELECT id, username, nome_completo, ativo FROM admin_usuarios WHERE id = ? LIMIT 1',
            [req.admin.id]
        );
        if (!rows.length || !rows[0].ativo) return res.json({ logged: false });
        return res.json({ logged: true, user: rows[0] });
    } catch (err) {
        console.error('Erro ao obter sessão admin:', err);
        return res.status(500).json({ error: 'Erro ao obter sessão admin.' });
    }
});

router.post('/login', async (req, res) => {
    try {
        await ensureTenantStructure();
        const username = String(req.body.username || '').trim();
        const senha = String(req.body.senha || '');
        if (!username || !senha) {
            return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
        }
        const [rows] = await pool.query(
            'SELECT id, username, nome_completo, senha, ativo FROM admin_usuarios WHERE username = ? LIMIT 1',
            [username]
        );
        if (!rows.length || !rows[0].ativo) return res.status(401).json({ error: 'Credenciais inválidas.' });
        if (rows[0].senha !== hashPassword(senha)) return res.status(401).json({ error: 'Credenciais inválidas.' });

        setAdminSessionCookie(res, rows[0].id);
        return res.json({
            message: 'Login admin efetuado com sucesso.',
            user: { id: rows[0].id, username: rows[0].username, nome_completo: rows[0].nome_completo }
        });
    } catch (err) {
        console.error('Erro no login admin:', err);
        return res.status(500).json({ error: 'Erro no servidor.' });
    }
});

router.post('/logout', (_req, res) => {
    clearAdminSessionCookie(res);
    return res.json({ message: 'Logout admin efetuado.' });
});

router.get('/tenants', requireAdmin, async (_req, res) => {
    try {
        await ensureTenantStructure();
        const [rows] = await pool.query(`
            SELECT t.*,
                   u.id AS usuario_id,
                   u.username AS usuario_username
            FROM tenants_ejc t
            LEFT JOIN usuarios u ON u.id = (
                SELECT ux.id
                FROM usuarios ux
                WHERE ux.tenant_id = t.id
                ORDER BY ux.id ASC
                LIMIT 1
            )
            ORDER BY t.estado ASC, t.cidade ASC, t.nome_ejc ASC
        `);
        return res.json(rows);
    } catch (err) {
        console.error('Erro ao listar tenants:', err);
        return res.status(500).json({ error: 'Erro ao listar EJCs.' });
    }
});

router.put('/tenants/:id', requireAdmin, async (req, res) => {
    const tenantId = Number(req.params.id);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
        return res.status(400).json({ error: 'Tenant inválido.' });
    }

    const nomeEjc = String(req.body.nome_ejc || '').trim();
    const paroquia = String(req.body.paroquia || '').trim();
    const endereco = String(req.body.endereco || '').trim() || null;
    const cidade = String(req.body.cidade || '').trim();
    const estado = String(req.body.estado || '').trim();

    if (!nomeEjc || !paroquia || !cidade || !estado) {
        return res.status(400).json({ error: 'Preencha nome do EJC, paróquia, cidade e estado.' });
    }

    try {
        await ensureTenantStructure();
        const [result] = await pool.query(
            `UPDATE tenants_ejc
             SET nome_ejc = ?, paroquia = ?, endereco = ?, cidade = ?, estado = ?
             WHERE id = ?`,
            [nomeEjc, paroquia, endereco, cidade, estado, tenantId]
        );
        if (!result.affectedRows) {
            return res.status(404).json({ error: 'EJC não encontrado.' });
        }
        return res.json({ message: 'EJC atualizado com sucesso.' });
    } catch (err) {
        console.error('Erro ao atualizar tenant:', err);
        if (err && err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Já existe EJC com esse nome/cidade/estado.' });
        }
        return res.status(500).json({ error: 'Erro ao atualizar EJC.' });
    }
});

router.patch('/tenants/:id/status', requireAdmin, async (req, res) => {
    const tenantId = Number(req.params.id);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
        return res.status(400).json({ error: 'Tenant inválido.' });
    }

    const ativo = !!req.body.ativo;
    const motivo = String(req.body.motivo_desabilitacao || '').trim();
    if (!ativo && !motivo) {
        return res.status(400).json({ error: 'Informe o motivo ao desabilitar o EJC.' });
    }

    try {
        await ensureTenantStructure();
        const [result] = await pool.query(
            `UPDATE tenants_ejc
             SET ativo = ?,
                 motivo_desabilitacao = ?,
                 desabilitado_em = ?
             WHERE id = ?`,
            [ativo ? 1 : 0, ativo ? null : motivo, ativo ? null : new Date(), tenantId]
        );
        if (!result.affectedRows) {
            return res.status(404).json({ error: 'EJC não encontrado.' });
        }
        return res.json({ message: ativo ? 'EJC habilitado com sucesso.' : 'EJC desabilitado com sucesso.' });
    } catch (err) {
        console.error('Erro ao alterar status do tenant:', err);
        return res.status(500).json({ error: 'Erro ao alterar status do EJC.' });
    }
});

router.delete('/tenants/:id', requireAdmin, async (req, res) => {
    const tenantId = Number(req.params.id);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
        return res.status(400).json({ error: 'Tenant inválido.' });
    }
    if (tenantId === 1) {
        return res.status(400).json({ error: 'O tenant principal (ID 1) não pode ser excluído.' });
    }

    const connection = await pool.getConnection();
    try {
        await ensureTenantStructure();
        await connection.beginTransaction();

        const [[tenantRow]] = await connection.query(
            'SELECT id FROM tenants_ejc WHERE id = ? LIMIT 1',
            [tenantId]
        );
        if (!tenantRow) {
            await connection.rollback();
            return res.status(404).json({ error: 'EJC não encontrado.' });
        }

        for (const tableName of TENANT_SCOPED_TABLES) {
            if (!await hasTable(tableName)) continue;
            if (!await hasColumn(tableName, 'tenant_id')) continue;
            await connection.query(`DELETE FROM ${tableName} WHERE tenant_id = ?`, [tenantId]);
        }

        await connection.query('DELETE FROM tenants_ejc WHERE id = ?', [tenantId]);
        await connection.commit();
        return res.json({ message: 'EJC excluído com sucesso.' });
    } catch (err) {
        await connection.rollback();
        console.error('Erro ao excluir tenant:', err);
        return res.status(500).json({ error: 'Erro ao excluir EJC.' });
    } finally {
        connection.release();
    }
});

router.post('/tenants', requireAdmin, async (req, res) => {
    const nomeEjc = String(req.body.nome_ejc || '').trim();
    const paroquia = String(req.body.paroquia || '').trim();
    const endereco = String(req.body.endereco || '').trim() || null;
    const cidade = String(req.body.cidade || '').trim();
    const estado = String(req.body.estado || '').trim();
    const username = String(req.body.username || '').trim();
    const senha = String(req.body.senha || '');
    const nomeAdmin = String(req.body.nome_admin || 'Administrador do EJC').trim() || 'Administrador do EJC';

    if (!nomeEjc || !paroquia || !cidade || !estado || !username || !senha) {
        return res.status(400).json({ error: 'Preencha nome do EJC, paróquia, cidade, estado, usuário e senha.' });
    }

    const connection = await pool.getConnection();
    try {
        await ensureTenantStructure();
        await connection.beginTransaction();

        const [tenantResult] = await connection.query(
            'INSERT INTO tenants_ejc (nome_ejc, paroquia, endereco, cidade, estado) VALUES (?, ?, ?, ?, ?)',
            [nomeEjc, paroquia, endereco, cidade, estado]
        );
        const tenantId = tenantResult.insertId;

        await connection.query(
            'INSERT INTO usuarios (tenant_id, username, nome_completo, senha, grupo) VALUES (?, ?, ?, ?, ?)',
            [tenantId, username, nomeAdmin, hashPassword(senha), GRUPO_ADMIN_LOCAL]
        );

        await connection.commit();
        return res.json({ id: tenantId, message: 'EJC cadastrado com sucesso.' });
    } catch (err) {
        await connection.rollback();
        console.error('Erro ao cadastrar tenant:', err);
        if (err && err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Já existe EJC com esses dados ou usuário já em uso. Se for base antiga, reinicie o servidor e tente novamente para aplicar migração multitenant.' });
        }
        return res.status(500).json({ error: 'Erro ao cadastrar EJC.' });
    } finally {
        connection.release();
    }
});

module.exports = router;
