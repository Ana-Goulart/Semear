const express = require('express');
const path = require('path');
const app = express();
const rotasEJC = require('./routes/ejc');
const rotasListaMestre = require('./routes/listaMestre');
const rotasEquipes = require('./routes/equipes');
const rotasAnexos = require('./routes/anexos');
const rotasUsuarios = require('./routes/usuarios');
const rotasHistoricoEquipes = require('./routes/historicoEquipes');
const rotasVotacao = require('./routes/votacao');
const rotasOutrosEjcs = require('./routes/outrosEjcs');
const rotasMontarEncontro = require('./routes/montar-encontro');

app.use(express.json());
app.use(express.static('public')); // Serve arquivos estáticos

// --- VIEW ROUTES ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'listaMestre.html')));
app.get('/ejc', (req, res) => res.sendFile(path.join(__dirname, 'views', 'ejc.html')));
app.get('/equipes', (req, res) => res.sendFile(path.join(__dirname, 'views', 'equipes.html')));
app.get('/historico-equipes', (req, res) => res.sendFile(path.join(__dirname, 'views', 'historico-equipes.html')));
app.get('/anexos', (req, res) => res.sendFile(path.join(__dirname, 'views', 'anexos.html')));
app.get('/usuarios', (req, res) => res.sendFile(path.join(__dirname, 'views', 'usuarios.html')));
app.get('/votacao', (req, res) => res.sendFile(path.join(__dirname, 'views', 'votacao.html')));
app.get('/outros-ejcs', (req, res) => res.sendFile(path.join(__dirname, 'views', 'outros-ejcs.html')));
app.get('/montar-encontro', (req, res) => res.sendFile(path.join(__dirname, 'views', 'montar-encontro.html')));

// --- API ROUTES ---
app.use('/api/ejc', rotasEJC);
app.use('/api/lista-mestre', rotasListaMestre);
app.use('/api/anexos', rotasAnexos);
app.use('/api/usuarios', rotasUsuarios);
app.use('/api/equipes', rotasEquipes);
app.use('/api/historico-equipes', rotasHistoricoEquipes);
app.use('/api/votacao', rotasVotacao);
app.use('/api/outros-ejcs', rotasOutrosEjcs);
app.use('/api/montar-encontro', rotasMontarEncontro);

// --- ROTAS ANTIGAS / COMPATIBILIDADE ---
// Algumas rotas frontend chamavam URLs específicas que agora estão dentro dos módulos.
// Precisamos garantir que os fronts funcionem.
// Vou mapear as chamadas antigas para os novos controllers se necessário, 
// ou idealmente ajustar o front, mas como o pedido é refatorar backend, vou usar redirecionamentos ou mounts adicionais.

// Lista Mestre Front chama: /api/lista-mestre (ok), /api/historico/:id, /api/importacao, etc.
// O router 'rotasListaMestre' está montado em /api/lista-mestre. 
// ENTÃO: GET /api/lista-mestre/ chama router.get('/').
// MAS: GET /api/historico/:id no front antigo era direto.
// Se eu mudar para /api/lista-mestre/historico/:id, quebra o front.
// PARA NÃO QUEBRAR O FRONT: Vou montar o router em caminhos múltiplos ou criar alias.

// 1. Rota principal da Lista Mestre
// 2. Rotas de Histórico e Jovem eram soltas.
app.use('/api/historico', (req, res, next) => {
    // Redireciona chamadas /api/historico para dentro do rotasListaMestre
    // Mas rotasListaMestre espera /historico/:id
    // Se a req.url for /:id, e eu der use, ele passa /:id.
    // Vamos usar o router diretamente aqui também?
    rotasListaMestre(req, res, next);
});

// Rota de busca jovem e outras do lista mestre
app.use('/api/jovens', rotasListaMestre);
app.use('/api/jovem', (req, res, next) => {
    rotasListaMestre(req, res, next);
});

// Importação
app.post('/api/importacao', (req, res, next) => {
    req.url = '/importacao'; // Ajusta url interna para dar match no router
    rotasListaMestre(req, res, next);
});

// EJCs Dropdown
app.get('/api/ejcs', (req, res, next) => {
    // Chama rotasEJC GET /
    req.url = '/';
    rotasEJC(req, res, next);
});

// Equipes Dropdown e Filtros
app.get('/api/todas-equipes', (req, res, next) => {
    req.url = '/';
    rotasEquipes(req, res, next);
});
app.get('/api/equipes/:ejcId', (req, res, next) => {
    req.url = '/por-ejc/' + req.params.ejcId; // Ajuste para nome da rota no controller
    rotasEquipes(req, res, next);
});
// Rota de DELETE vinculo antigo: /api/equipes-ejc/:ejcId/:equipeId
app.delete('/api/equipes-ejc/:ejcId/:equipeId', (req, res, next) => {
    req.url = '/vinculo/' + req.params.ejcId + '/' + req.params.equipeId;
    rotasEquipes(req, res, next);
});


// Rota antiga de historico-equipes view
// /api/equipes/:equipeId/jovens/:ejcId -> /api/historico-equipes/:equipeId/jovens/:ejcId
app.get('/api/equipes/:equipeId/jovens/:ejcId', (req, res, next) => {
    rotasHistoricoEquipes(req, res, next);
});


app.listen(3001, () => {
    console.log("🚀 SemeaJovens rodando na porta 3001");
});