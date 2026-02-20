const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: 'localhost',
    user: 'infra',
    password: 'anaclara14',
    database: 'db_semeajovens'
});

async function registrarLog(usuario, acao, detalhes) {
    try {
        await pool.query('INSERT INTO logs (usuario, acao, detalhes) VALUES (?, ?, ?)', [usuario, acao, detalhes]);
    } catch (err) { console.error("Erro ao gravar log:", err); }
}

module.exports = { pool, registrarLog };