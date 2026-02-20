const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Configuração do Multer (se não exportada, precisa redefinir ou usar helper. 
// Para manter simples e isolado, defino aqui também, mas apontando para o mesmo dir)

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'public/uploads';
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

// Listar Pastas
router.get('/pastas', async (req, res) => {
    const parentId = req.query.parentId || null;
    try {
        const query = parentId ? 'SELECT * FROM pastas WHERE parent_id = ?' : 'SELECT * FROM pastas WHERE parent_id IS NULL';
        const params = parentId ? [parentId] : [];
        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro ao listar pastas" });
    }
});

// Criar Pasta
router.post('/pastas', async (req, res) => {
    const { nome, parentId } = req.body;
    if (!nome) return res.status(400).json({ error: "Nome é obrigatório" });
    try {
        const [result] = await pool.query('INSERT INTO pastas (nome, parent_id) VALUES (?, ?)', [nome, parentId || null]);
        res.json({ id: result.insertId, nome, parentId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro ao criar pasta" });
    }
});

// Função recursiva para deletar arquivos físicos de uma pasta e subpastas
async function deleteFolderContents(folderId) {
    // 1. Encontrar todas as subpastas diretas
    const [subfolders] = await pool.query('SELECT id FROM pastas WHERE parent_id = ?', [folderId]);

    // 2. Para cada subpasta, chamar recursivamente
    for (const subfolder of subfolders) {
        await deleteFolderContents(subfolder.id);
    }

    // 3. Encontrar arquivos nesta pasta
    const [files] = await pool.query('SELECT caminho FROM arquivos WHERE pasta_id = ?', [folderId]);

    // 4. Deletar arquivos físicos
    for (const file of files) {
        if (fs.existsSync(file.caminho)) {
            try {
                fs.unlinkSync(file.caminho);
            } catch (e) {
                console.error(`Erro ao deletar arquivo físico: ${file.caminho}`, e);
            }
        }
    }
}

// Deletar Pasta
router.delete('/pastas/:id', async (req, res) => {
    const folderId = req.params.id;
    try {
        // Deletar fisicamente os arquivos da pasta e subpastas
        await deleteFolderContents(folderId);

        // Deletar do banco (constraint ON DELETE CASCADE vai limpar subpastas e registros de arquivos)
        await pool.query('DELETE FROM pastas WHERE id = ?', [folderId]);

        res.json({ message: "Pasta e conteúdo deletados" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro ao deletar pasta" });
    }
});

// Listar Arquivos
router.get('/arquivos', async (req, res) => {
    const pastaId = req.query.pastaId || null;
    try {
        const query = pastaId ? 'SELECT * FROM arquivos WHERE pasta_id = ?' : 'SELECT * FROM arquivos WHERE pasta_id IS NULL';
        const params = pastaId ? [pastaId] : [];
        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro ao listar arquivos" });
    }
});

// Upload de Arquivo
router.post('/upload', upload.single('arquivo'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado" });
    const { pastaId } = req.body;

    try {
        const [result] = await pool.query(
            'INSERT INTO arquivos (nome, caminho, mimetype, tamanho, pasta_id) VALUES (?, ?, ?, ?, ?)',
            [req.file.originalname, req.file.path, req.file.mimetype, req.file.size, pastaId || null]
        );
        res.json({ id: result.insertId, nome: req.file.originalname });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro ao salvar arquivo no banco" });
    }
});

// Deletar Arquivo
router.delete('/arquivos/:id', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT caminho FROM arquivos WHERE id = ?', [req.params.id]);
        if (rows.length > 0) {
            const caminho = rows[0].caminho;
            if (fs.existsSync(caminho)) {
                fs.unlinkSync(caminho);
            }
        }
        await pool.query('DELETE FROM arquivos WHERE id = ?', [req.params.id]);
        res.json({ message: "Arquivo deletado" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro ao deletar arquivo" });
    }
});

module.exports = router;
