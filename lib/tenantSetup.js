const crypto = require('crypto');
const { pool } = require('../database');

let ensured = false;
let ensurePromise = null;

function hashPassword(password) {
    return crypto.createHash('sha256').update(String(password || '')).digest('hex');
}

async function runAlterIgnoreDuplicate(sql) {
    try {
        await pool.query(sql);
    } catch (err) {
        if (err && (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_DUP_KEYNAME')) return;
        throw err;
    }
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

async function ensureTenantStructure() {
    if (ensured) return;
    if (ensurePromise) return ensurePromise;

    ensurePromise = (async () => {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tenants_ejc (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome_ejc VARCHAR(160) NOT NULL,
                paroquia VARCHAR(180) NOT NULL,
                endereco VARCHAR(255) NULL,
                cidade VARCHAR(120) NOT NULL,
                estado VARCHAR(120) NOT NULL,
                ativo TINYINT(1) NOT NULL DEFAULT 1,
                motivo_desabilitacao TEXT NULL,
                desabilitado_em DATETIME NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_tenant_nome_local (nome_ejc, cidade, estado)
            )
        `);

        if (!await hasColumn('tenants_ejc', 'motivo_desabilitacao')) {
            await pool.query('ALTER TABLE tenants_ejc ADD COLUMN motivo_desabilitacao TEXT NULL AFTER ativo');
        }
        if (!await hasColumn('tenants_ejc', 'desabilitado_em')) {
            await pool.query('ALTER TABLE tenants_ejc ADD COLUMN desabilitado_em DATETIME NULL AFTER motivo_desabilitacao');
        }

        await pool.query(
            `INSERT INTO tenants_ejc (id, nome_ejc, paroquia, endereco, cidade, estado, ativo)
             VALUES (1, 'EJC Inconfidentes', 'Paróquia Bom Jesus do Amparo', NULL, 'Belo Horizonte', 'MG', 1)
             ON DUPLICATE KEY UPDATE ativo = VALUES(ativo)`
        );

        await pool.query(`
            CREATE TABLE IF NOT EXISTS admin_usuarios (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(100) NOT NULL UNIQUE,
                nome_completo VARCHAR(160) NOT NULL,
                senha VARCHAR(255) NOT NULL,
                ativo TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await runAlterIgnoreDuplicate('ALTER TABLE usuarios ADD COLUMN tenant_id INT NULL AFTER id');
        await runAlterIgnoreDuplicate('ALTER TABLE usuarios ADD KEY idx_usuarios_tenant (tenant_id)');
        await runAlterIgnoreDuplicate('ALTER TABLE usuarios ADD UNIQUE KEY uniq_usuarios_tenant_username (tenant_id, username)');
        await pool.query('UPDATE usuarios SET tenant_id = 1 WHERE tenant_id IS NULL');
        try {
            await pool.query('ALTER TABLE usuarios MODIFY COLUMN tenant_id INT NOT NULL');
        } catch (errTenantNotNull) {
            if (!errTenantNotNull || errTenantNotNull.code !== 'ER_INVALID_USE_OF_NULL') {
                throw errTenantNotNull;
            }
        }

        // Em ambientes antigos, "username" pode estar como UNIQUE global.
        // No modo multitenant o correto é unicidade por tenant.
        try {
            const [idxRows] = await pool.query(`
                SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
                FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'usuarios'
                GROUP BY INDEX_NAME, NON_UNIQUE
            `);

            const idxUsernameGlobal = (idxRows || []).find((r) =>
                Number(r.NON_UNIQUE) === 0
                && String(r.cols || '').trim().toLowerCase() === 'username'
                && String(r.INDEX_NAME || '').toUpperCase() !== 'PRIMARY'
            );

            if (idxUsernameGlobal) {
                try {
                    await pool.query(`ALTER TABLE usuarios DROP INDEX \`${idxUsernameGlobal.INDEX_NAME}\``);
                } catch (errDrop) {
                    if (!errDrop || (errDrop.code !== 'ER_CANT_DROP_FIELD_OR_KEY' && errDrop.code !== 'ER_DROP_INDEX_FK')) {
                        throw errDrop;
                    }
                }
            }
        } catch (errIdx) {
            // Não trava bootstrap por falha de introspecção de índice
            console.error('Aviso ao ajustar índice de username para multitenant:', errIdx && errIdx.message ? errIdx.message : errIdx);
        }

        const adminUser = String(process.env.ADMIN_MASTER_USER || 'admin').trim();
        const adminNome = String(process.env.ADMIN_MASTER_NOME || 'Administrador Geral').trim();
        const adminPass = String(process.env.ADMIN_MASTER_PASS || 'admin123').trim();

        if (adminUser && adminPass) {
            await pool.query(
                `INSERT INTO admin_usuarios (username, nome_completo, senha, ativo)
                 VALUES (?, ?, ?, 1)
                 ON DUPLICATE KEY UPDATE
                    nome_completo = VALUES(nome_completo),
                    senha = COALESCE(admin_usuarios.senha, VALUES(senha))`,
                [adminUser, adminNome || 'Administrador Geral', hashPassword(adminPass)]
            );
        }

        ensured = true;
    })();

    try {
        await ensurePromise;
    } finally {
        ensurePromise = null;
    }
}

module.exports = {
    ensureTenantStructure,
    hashPassword
};
