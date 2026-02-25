const express = require('express');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
const app = express();
const { attachUserFromSession, clearSessionCookie } = require('./lib/authSession');
const { attachAdminFromSession, clearAdminSessionCookie } = require('./lib/adminSession');
const { pool } = require('./database');
const { purgeExpiredUsers } = require('./lib/usuariosExpiracao');
const { ensureTenantStructure } = require('./lib/tenantSetup');
const { ensureTenantIsolation } = require('./lib/tenantIsolation');
const rotasEJC = require('./routes/ejc');
const rotasListaMestre = require('./routes/listaMestre');
const rotasEquipes = require('./routes/equipes');
const rotasAnexos = require('./routes/anexos');
const rotasUsuarios = require('./routes/usuarios');
const rotasHistoricoEquipes = require('./routes/historicoEquipes');
const rotasVotacao = require('./routes/votacao');
const rotasOutrosEjcs = require('./routes/outrosEjcs');
const rotasMontarEncontro = require('./routes/montar-encontro');
const rotasFinanceiro = require('./routes/financeiro');
const rotasCoordenadores = require('./routes/coordenadores');
const rotasGarcons = require('./routes/garcons');
const rotasMoita = require('./routes/moita');
const rotasAtaReunioes = require('./routes/ataReunioes');
const rotasFuncoesDirigencia = require('./routes/funcoesDirigencia');
const rotasFormularios = require('./routes/formularios');
const rotasFormulariosPublic = require('./routes/formulariosPublic');
const rotasVisitantes = require('./routes/visitantes');
const rotasContatos = require('./routes/contatos');
const rotasPastorais = require('./routes/pastorais');
const rotasTios = require('./routes/tios');
const rotasJovensPublic = require('./routes/jovensPublic');
const rotasTiosPublic = require('./routes/tiosPublic');
const rotasJovensOutroEjcPublic = require('./routes/jovensOutroEjcPublic');
const rotasAtualizacoesCadastro = require('./routes/atualizacoesCadastro');
const rotasAuth = require('./routes/auth');
const rotasMeuEjc = require('./routes/meuEjc');
const rotasCirculos = require('./routes/circulos');
const rotasAdminSistema = require('./routes/adminSistema');

app.use(express.json());
app.use(attachUserFromSession);
app.use(attachAdminFromSession);
app.use(express.static('public')); // Serve arquivos estáticos
app.get('/favicon.ico', (_req, res) => res.redirect('/assets/logo-oficial.png'));

async function requireLoginView(req, res, next) {
    if (!req.user || !req.user.id) return res.redirect('/login');
    try {
        await purgeExpiredUsers();
        await ensureTenantStructure();
        await ensureTenantIsolation();
        const [rows] = await pool.query('SELECT id, tenant_id FROM usuarios WHERE id = ? LIMIT 1', [req.user.id]);
        if (!rows.length) {
            clearSessionCookie(res);
            return res.redirect('/login');
        }
        req.user = { id: rows[0].id, tenant_id: rows[0].tenant_id || null };
    } catch (err) {
        console.error('Erro ao validar sessão de view:', err);
        clearSessionCookie(res);
        return res.redirect('/login');
    }
    next();
}

async function requireLoginApi(req, res, next) {
    if (!req.user || !req.user.id) return res.status(401).json({ error: 'Não autenticado.' });
    try {
        await purgeExpiredUsers();
        await ensureTenantStructure();
        await ensureTenantIsolation();
        const [rows] = await pool.query('SELECT id, tenant_id FROM usuarios WHERE id = ? LIMIT 1', [req.user.id]);
        if (!rows.length) {
            clearSessionCookie(res);
            return res.status(401).json({ error: 'Sessão expirada.' });
        }
        req.user = { id: rows[0].id, tenant_id: rows[0].tenant_id || null };
    } catch (err) {
        console.error('Erro ao validar sessão de API:', err);
        clearSessionCookie(res);
        return res.status(401).json({ error: 'Sessão inválida.' });
    }
    next();
}

// Alias direto para finalizar encontro (garante a rota mesmo com mounts antigos)
app.post('/api/montar-encontro/:id/finalizar', requireLoginApi, (req, res, next) => {
    if (typeof rotasMontarEncontro.finalizarEncontroHandler === 'function') {
        return rotasMontarEncontro.finalizarEncontroHandler(req, res, next);
    }
    return res.status(404).json({ error: 'Rota de finalização indisponível.' });
});

app.get('/api/ping', requireLoginApi, (_req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
});

async function requireAdminView(req, res, next) {
    if (!req.admin || !req.admin.id) return res.redirect('/admin/login');
    try {
        await ensureTenantStructure();
        const [rows] = await pool.query('SELECT id, ativo FROM admin_usuarios WHERE id = ? LIMIT 1', [req.admin.id]);
        if (!rows.length || !rows[0].ativo) {
            clearAdminSessionCookie(res);
            return res.redirect('/admin/login');
        }
        next();
    } catch (err) {
        console.error('Erro ao validar sessão admin view:', err);
        clearAdminSessionCookie(res);
        return res.redirect('/admin/login');
    }
}

// --- VIEW ROUTES ---
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));
app.get('/admin/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin-login.html')));
app.get('/admin', requireAdminView, (_req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.html')));
app.get('/formularios/public/:token', (req, res) => res.sendFile(path.join(__dirname, 'views', 'formulario-publico.html')));
app.get('/eventos/public/:token', (req, res) => res.sendFile(path.join(__dirname, 'views', 'formulario-publico.html')));
app.get('/inscricoes/public/:token', (req, res) => res.sendFile(path.join(__dirname, 'views', 'formulario-publico.html')));
app.get('/jovens/atualizar-cadastro', (_req, res) => res.sendFile(path.join(__dirname, 'views', 'jovens-atualizar.html')));
app.get('/tios/atualizar-telefone', (_req, res) => res.sendFile(path.join(__dirname, 'views', 'tios-atualizar.html')));
app.get('/jovens-outro-ejc/atualizar-cadastro', (_req, res) => res.sendFile(path.join(__dirname, 'views', 'jovens-outro-ejc-atualizar.html')));
app.get('/', (_req, res) => res.redirect('/login'));
app.get('/dashboard', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));
app.get('/ejc', (req, res) => res.redirect('/historico-equipes'));
app.get('/equipes', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'equipes.html')));
app.get('/historico-equipes', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'historico-equipes.html')));
app.get('/anexos', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'anexos.html')));
app.get('/usuarios', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'usuarios.html')));
app.get('/votacao', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'votacao.html')));
app.get('/outros-ejcs', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'outros-ejcs.html')));
app.get('/montar-encontro', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'montar-encontro.html')));
app.get('/gestaodoencontro/montarencontro/equipe', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'montar-encontro-equipe.html')));
app.get('/financeiro', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'financeiro.html')));
app.get('/coordenadores', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'coordenadores.html')));
app.get('/garcons', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'garcons.html')));
app.get('/moita', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'moita.html')));
app.get('/ata-reunioes', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'ata-reunioes.html')));
app.get('/funcoes-dirigencia', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'funcoes-dirigencia.html')));
app.get('/calendario', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'calendario.html')));
app.get('/formularios', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'formularios.html')));
app.get('/eventos', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'formularios.html')));
app.get('/inscricoes', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'formularios.html')));
app.get('/meu-ejc', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'meu-ejc.html')));
app.get('/visitantes', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'visitantes.html')));
app.get('/contatos', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'contatos.html')));
app.get('/tios', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'tios.html')));

// --- ROTAS NOVAS DE NAVEGAÇÃO AGRUPADA ---
app.get('/gestaodoencontro/listamestre', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'listaMestre.html')));
app.get('/gestaodoencontro/equipes', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'equipes.html')));
app.get('/gestaodoencontro/ejc', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'historico-equipes.html')));
app.get('/gestaodoencontro/outrosejcs', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'outros-ejcs.html')));
app.get('/gestaodoencontro/jovensoutroejc', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'jovens-outro-ejc.html')));
app.get('/gestaodoencontro/visitantes', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'visitantes.html')));
app.get('/gestaodoencontro/tios', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'tios.html')));
app.get('/gestaodoencontro/montarencontro', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'montar-encontro.html')));
app.get('/gestaodoencontro/moita', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'moita.html')));
app.get('/gestaodoencontro/garcons', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'garcons.html')));
app.get('/gestaodoencontro/votacao', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'votacao.html')));
app.get('/gestaodoencontro/formularios-atualizacao', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'formularios-atualizacao.html')));

app.get('/planejamento/calendario', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'calendario.html')));
app.get('/planejamento/eventos', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'formularios.html')));
app.get('/planejamento/inscricoes', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'formularios.html')));
app.get('/planejamento/atasdereuniao', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'ata-reunioes.html')));

app.get('/administrativo/financeiro', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'financeiro.html')));
app.get('/administrativo/anexos', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'anexos.html')));
app.get('/administrativo/contatos', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'contatos.html')));

app.get('/configuracoes/usuarios', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'usuarios.html')));
app.get('/configuracoes/coordenacoes', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'coordenadores.html')));
app.get('/configuracoes/funcoes-dirigencia', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'funcoes-dirigencia.html')));
app.get('/configuracoes/meuejc', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'meu-ejc.html')));
app.get('/configuracoes/circulos', requireLoginView, (req, res) => res.sendFile(path.join(__dirname, 'views', 'circulos.html')));

// --- API ROUTES ---
app.use('/api/auth', rotasAuth);
app.use('/api/admin', rotasAdminSistema);
app.use('/api/formularios/public', rotasFormulariosPublic);
app.use('/api/jovens-public', rotasJovensPublic);
app.use('/api/tios-public', rotasTiosPublic);
app.use('/api/jovens-outro-ejc-public', rotasJovensOutroEjcPublic);
app.use('/api', requireLoginApi);
app.use('/api/atualizacoes-cadastro', rotasAtualizacoesCadastro);
app.use('/api/ejc', rotasEJC);
app.use('/api/lista-mestre', rotasListaMestre);
app.use('/api/anexos', rotasAnexos);
app.use('/api/usuarios', rotasUsuarios);
app.use('/api/equipes', rotasEquipes);
app.use('/api/historico-equipes', rotasHistoricoEquipes);
app.use('/api/votacao', rotasVotacao);
app.use('/api/outros-ejcs', rotasOutrosEjcs);
app.use('/api/montar-encontro', rotasMontarEncontro);
app.use('/api/financeiro', rotasFinanceiro);
app.use('/api/coordenadores', rotasCoordenadores);
app.use('/api/garcons', rotasGarcons);
app.use('/api/moita', rotasMoita);
app.use('/api/ata-reunioes', rotasAtaReunioes);
app.use('/api/funcoes-dirigencia', rotasFuncoesDirigencia);
app.use('/api/formularios', rotasFormularios);
app.use('/api/visitantes', rotasVisitantes);
app.use('/api/contatos', rotasContatos);
app.use('/api/pastorais', rotasPastorais);
app.use('/api/tios', rotasTios);
app.use('/api/meu-ejc', rotasMeuEjc);
app.use('/api/circulos', rotasCirculos);

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
