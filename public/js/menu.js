/**
 * Menu Lateral - SemeaJovens
 * Template reutilizável para todas as páginas
 */

const menuTemplate = `
<div id="layout-wrapper">
    <div id="sidebarOverlay"></div>
    <nav id="sidebar">
        <div class="logo-box">
            <img src="/assets/logo-oficial.png" alt="Semear Paroquial" class="brand-mark">
            <div class="brand-stack">
                <span class="brand-name">SEMEAR</span>
                <span class="brand-subtitle">PAROQUIAL</span>
            </div>
        </div>
        <div class="nav flex-column mt-2">
            <a href="/dashboard" class="nav-link" title="Dashboard">
                <span class="fs-5">📊</span> <span class="link-text">Visão Geral</span>
            </a>

            <div class="menu-group" data-group="gestao">
                <button type="button" class="menu-group-toggle" data-group-toggle="gestao">
                    <span class="group-title">Encontro</span>
                    <span class="menu-chevron">▸</span>
                </button>
                <div class="menu-group-links" data-group-links="gestao">
                    <a href="/gestaodoencontro/listamestre" class="nav-link" title="Lista Mestre">
                        <span class="fs-5">📋</span> <span class="link-text">Cadastro de Jovens</span>
                    </a>
                    <a href="/gestaodoencontro/tios" class="nav-link" title="Tios">
                        <span class="fs-5">👫</span> <span class="link-text">Tios</span>
                    </a>
                    <a href="/gestaodoencontro/equipes" class="nav-link" title="Equipes">
                        <span class="fs-5">👥</span> <span class="link-text">Equipes e Funções</span>
                    </a>
                    <a href="/gestaodoencontro/ejc" class="nav-link" title="EJC">
                        <span class="fs-5">🎯</span> <span class="link-text">Edições do EJC</span>
                    </a>
                    <a href="/gestaodoencontro/montarencontro" class="nav-link" title="Montar Encontro">
                        <span class="fs-5">🧩</span> <span class="link-text">Montagem do Encontro</span>
                    </a>
                    <a href="/gestaodoencontro/formularios-atualizacao" class="nav-link" title="Formulários">
                        <span class="fs-5">🧾</span> <span class="link-text">Formulários</span>
                    </a>
                    <a href="/gestaodoencontro/votacao" class="nav-link" title="Votação">
                        <span class="fs-5">🗳️</span> <span class="link-text">Votação</span>
                    </a>
                </div>
            </div>

            <div class="menu-group" data-group="participacoes">
                <button type="button" class="menu-group-toggle" data-group-toggle="participacoes">
                    <span class="group-title">Participações</span>
                    <span class="menu-chevron">▸</span>
                </button>
                <div class="menu-group-links" data-group-links="participacoes">
                    <a href="/gestaodoencontro/outrosejcs" class="nav-link" title="Outros EJCs">
                        <span class="fs-5">🌍</span> <span class="link-text">Outros EJCs</span>
                    </a>
                    <a href="/gestaodoencontro/jovensoutroejc" class="nav-link" title="Jovens de Outro EJC">
                        <span class="fs-5">🧾</span> <span class="link-text">Jovens de Outro EJC</span>
                    </a>
                    <a href="/gestaodoencontro/visitantes" class="nav-link" title="Visitantes">
                        <span class="fs-5">🙋</span> <span class="link-text">Visitantes</span>
                    </a>
                    <a href="/gestaodoencontro/moita" class="nav-link" title="Moita">
                        <span class="fs-5">🌿</span> <span class="link-text">Moita</span>
                    </a>
                    <a href="/gestaodoencontro/garcons" class="nav-link" title="Garçons">
                        <span class="fs-5">🍽️</span> <span class="link-text">Garçons</span>
                    </a>
                </div>
            </div>

            <div class="menu-group" data-group="planejamento">
                <button type="button" class="menu-group-toggle" data-group-toggle="planejamento">
                    <span class="group-title">Planejamento</span>
                    <span class="menu-chevron">▸</span>
                </button>
                <div class="menu-group-links" data-group-links="planejamento">
                    <a href="/planejamento/calendario" class="nav-link" title="Calendário">
                        <span class="fs-5">📅</span> <span class="link-text">Calendário</span>
                    </a>
                    <a href="javascript:void(0)" class="nav-link disabled" title="Eventos e Presença" aria-disabled="true" tabindex="-1">
                        <span class="fs-5">🎉</span> <span class="link-text">Eventos e Presença</span>
                    </a>
                    <a href="/planejamento/atasdereuniao" class="nav-link" title="Atas de Reunião">
                        <span class="fs-5">📝</span> <span class="link-text">Atas de Reunião</span>
                    </a>
                </div>
            </div>

            <div class="menu-group" data-group="administrativo">
                <button type="button" class="menu-group-toggle" data-group-toggle="administrativo">
                    <span class="group-title">Administrativo</span>
                    <span class="menu-chevron">▸</span>
                </button>
                <div class="menu-group-links" data-group-links="administrativo">
                    <a href="/administrativo/financeiro" class="nav-link" title="Financeiro">
                        <span class="fs-5">💰</span> <span class="link-text">Financeiro</span>
                    </a>
                    <a href="/administrativo/anexos" class="nav-link" title="Anexos">
                        <span class="fs-5">📁</span> <span class="link-text">Anexos</span>
                    </a>
                    <a href="/administrativo/contatos" class="nav-link" title="Contatos">
                        <span class="fs-5">📞</span> <span class="link-text">Contatos</span>
                    </a>
                </div>
            </div>

            <div class="menu-group" data-group="configuracoes">
                <button type="button" class="menu-group-toggle" data-group-toggle="configuracoes">
                    <span class="group-title">Cadastros Base</span>
                    <span class="menu-chevron">▸</span>
                </button>
                <div class="menu-group-links" data-group-links="configuracoes">
                    <a href="/configuracoes/usuarios" class="nav-link" title="Usuários">
                        <span class="fs-5">👥</span> <span class="link-text">Usuários</span>
                    </a>
                    <a href="/configuracoes/coordenacoes" class="nav-link" title="Coordenações">
                        <span class="fs-5">🧭</span> <span class="link-text">Coordenações</span>
                    </a>
                    <a href="/configuracoes/funcoes-dirigencia" class="nav-link" title="Funções da Dirigência">
                        <span class="fs-5">🗂️</span> <span class="link-text">Funções da Dirigência</span>
                    </a>
                    <a href="/configuracoes/meuejc" class="nav-link" title="Meu EJC">
                        <span class="fs-5">🏷️</span> <span class="link-text">Meu EJC</span>
                    </a>
                    <a href="/configuracoes/circulos" class="nav-link" title="Círculos">
                        <span class="fs-5">🎨</span> <span class="link-text">Círculos</span>
                    </a>
                </div>
            </div>
        </div>
    </nav>
    <div id="main-content">
        <header id="page-topbar">
            <div class="d-flex w-100 justify-content-between align-items-center">
                <button id="sidebarToggle" class="btn btn-sm px-3 fs-16 header-item vertical-menu-btn topnav-hamburger">
                    ☰
                </button>
                <div class="d-flex align-items-center">
                    <button id="btnLogoutSistema" type="button" class="btn btn-sm btn-outline-danger me-2" title="Sair do sistema">
                        Sair
                    </button>
                    <div class="dropdown ms-sm-3 header-item topbar-user">
                        <button type="button" class="btn shadow-none" id="page-header-user-dropdown" data-bs-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                            <span class="d-flex align-items-center">
                                <span class="text-start ms-xl-2">
                                    <span class="d-none d-xl-inline-block ms-1 fw-medium user-name-text">Logado como Admin</span>
                                </span>
                            </span>
                        </button>
                    </div>
                </div>
            </div>
        </header>
        <div class="page-content" id="PAGE_CONTENT_PLACEHOLDER">
            <!-- Conteúdo da página será inserido aqui pelo script -->
        </div>
    </div>
</div>
`;

if (!window.__dateBrLoaded) {
    window.__dateBrLoaded = true;
    const script = document.createElement('script');
    script.src = '/js/date-br.js';
    document.head.appendChild(script);
}

let nomeMeuEJCAtual = 'Inconfidentes';

function escapeRegex(txt) {
    return String(txt).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizarNomeMeuEJC(novoNome) {
    let nome = String(novoNome || '').trim();
    if (!nome) return 'Inconfidentes';
    nome = nome.replace(/^(?:\s*(?:EJC|ECJ)\s+)+/i, '').trim();
    nome = nome.replace(/\s{2,}/g, ' ');
    return nome || 'Inconfidentes';
}

function ajustarCapitalizacao(match, novoValor) {
    if (!novoValor) return novoValor;
    if (match === match.toUpperCase()) return novoValor.toUpperCase();
    if (match === match.toLowerCase()) return novoValor.toLowerCase();
    return novoValor.charAt(0).toUpperCase() + novoValor.slice(1);
}

function substituirTextoInconfidentes(texto, novoNome) {
    if (!texto || !novoNome) return texto;
    return String(texto).replace(/inconfidentes/gi, (m) => ajustarCapitalizacao(m, novoNome));
}

function substituirInconfidentesNoDom(rootNode, novoNome) {
    if (!rootNode || !novoNome) return;

    const skipTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);

    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (!node || !node.nodeValue || !/inconfidentes/i.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
            const parent = node.parentElement;
            if (parent && skipTags.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        }
    });

    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach((node) => {
        node.nodeValue = substituirTextoInconfidentes(node.nodeValue, novoNome);
    });

    const attrSelectors = '[placeholder], [title], [aria-label]';
    rootNode.querySelectorAll && rootNode.querySelectorAll(attrSelectors).forEach((el) => {
        ['placeholder', 'title', 'aria-label'].forEach((attr) => {
            const val = el.getAttribute(attr);
            if (val && /inconfidentes/i.test(val)) {
                el.setAttribute(attr, substituirTextoInconfidentes(val, novoNome));
            }
        });
    });
}

function aplicarNomeMeuEJC(novoNome) {
    const nome = normalizarNomeMeuEJC(novoNome);
    nomeMeuEJCAtual = nome;
    window.__NOME_EJC_ATUAL = nome;
    substituirInconfidentesNoDom(document.body, nome);
    try {
        window.dispatchEvent(new CustomEvent('meu-ejc-atualizado', { detail: { nome } }));
    } catch (_) { }
}

async function carregarNomeMeuEJC() {
    try {
        const res = await fetch('/api/meu-ejc');
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        const nome = data && data.nome ? String(data.nome).trim() : '';
        if (nome) aplicarNomeMeuEJC(nome);
    } catch (_) { }
}

window.aplicarNomeMeuEJC = aplicarNomeMeuEJC;

let telefoneMaskInicializada = false;
let uxUiInicializada = false;
let uxModalInstance = null;
let uxResolver = null;
let uxModo = 'alert';

function formatarTelefoneBrasil(valor) {
    const digits = String(valor || '').replace(/\D/g, '').slice(0, 11);
    if (!digits) return '';
    if (digits.length <= 2) return `(${digits}`;
    if (digits.length <= 7) return `(${digits.slice(0, 2)})${digits.slice(2)}`;
    return `(${digits.slice(0, 2)})${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function isCampoTelefone(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    const type = String(el.type || '').toLowerCase();
    if (type === 'tel') return true;
    const attrs = [
        el.name,
        el.id,
        el.placeholder,
        el.getAttribute('aria-label'),
        el.getAttribute('data-mask')
    ].map(v => String(v || '').toLowerCase());
    if (attrs.some(v => v.includes('telefone') || v.includes('phone'))) return true;
    const wrapper = el.closest('.col, .mb-2, .mb-3, .form-group, .input-group, div');
    if (wrapper) {
        const label = wrapper.querySelector('label');
        if (label && /telefone/i.test(label.textContent || '')) return true;
    }
    return false;
}

function inicializarMascaraTelefoneGlobal() {
    if (telefoneMaskInicializada) return;
    telefoneMaskInicializada = true;
    const handler = (event) => {
        const input = event && event.target;
        if (!isCampoTelefone(input)) return;
        const atual = String(input.value || '');
        const formatado = formatarTelefoneBrasil(atual);
        if (atual !== formatado) input.value = formatado;
    };
    document.addEventListener('input', handler, true);
    document.addEventListener('blur', handler, true);
}

function garantirUxUi() {
    if (uxUiInicializada) return;
    if (!window.bootstrap || !bootstrap.Modal || !bootstrap.Toast) return;
    uxUiInicializada = true;

    if (!document.getElementById('uxToastContainer')) {
        const toastContainer = document.createElement('div');
        toastContainer.id = 'uxToastContainer';
        toastContainer.className = 'toast-container position-fixed top-0 end-0 p-3';
        toastContainer.style.zIndex = '2000';
        document.body.appendChild(toastContainer);
    }

    if (!document.getElementById('uxFloatingModal')) {
        const modalWrap = document.createElement('div');
        modalWrap.innerHTML = `
<div class="modal fade" id="uxFloatingModal" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content border-0 shadow">
      <div class="modal-header bg-light">
        <h5 class="modal-title" id="uxFloatingModalTitle">Aviso</h5>
        <button type="button" class="btn-close" id="uxFloatingClose"></button>
      </div>
      <div class="modal-body">
        <div id="uxFloatingModalMessage" class="mb-2"></div>
        <div id="uxFloatingInputWrap" class="d-none">
          <input id="uxFloatingInput" class="form-control" />
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-soft-secondary d-none" id="uxFloatingCancel">Cancelar</button>
        <button type="button" class="btn btn-primary" id="uxFloatingOk">OK</button>
      </div>
    </div>
  </div>
</div>`;
        document.body.appendChild(modalWrap.firstElementChild);
    }

    const modalEl = document.getElementById('uxFloatingModal');
    const okBtn = document.getElementById('uxFloatingOk');
    const cancelBtn = document.getElementById('uxFloatingCancel');
    const closeBtn = document.getElementById('uxFloatingClose');
    const inputEl = document.getElementById('uxFloatingInput');

    uxModalInstance = new bootstrap.Modal(modalEl);

    const finalizar = (valor) => {
        const resolver = uxResolver;
        uxResolver = null;
        try { uxModalInstance.hide(); } catch (_) { }
        if (resolver) resolver(valor);
    };

    okBtn.addEventListener('click', () => {
        if (uxModo === 'prompt') {
            finalizar(String(inputEl.value || ''));
            return;
        }
        finalizar(true);
    });
    cancelBtn.addEventListener('click', () => {
        if (uxModo === 'confirm') finalizar(false);
        else finalizar(null);
    });
    closeBtn.addEventListener('click', () => {
        if (uxModo === 'confirm') finalizar(false);
        else if (uxModo === 'prompt') finalizar(null);
        else finalizar(true);
    });
    inputEl.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') okBtn.click();
    });
}

function showFloatingToast(message, type = 'info') {
    if (!window.bootstrap || !bootstrap.Toast) {
        return;
    }
    garantirUxUi();
    const container = document.getElementById('uxToastContainer');
    const map = {
        success: 'text-bg-success',
        danger: 'text-bg-danger',
        warning: 'text-bg-warning',
        info: 'text-bg-primary'
    };
    const cls = map[type] || map.info;
    const wrap = document.createElement('div');
    wrap.className = `toast align-items-center ${cls} border-0`;
    wrap.setAttribute('role', 'alert');
    wrap.setAttribute('aria-live', 'assertive');
    wrap.setAttribute('aria-atomic', 'true');
    wrap.innerHTML = `
      <div class="d-flex">
        <div class="toast-body">${String(message || '')}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    `;
    container.appendChild(wrap);
    const t = new bootstrap.Toast(wrap, { delay: 3500 });
    t.show();
    wrap.addEventListener('hidden.bs.toast', () => wrap.remove());
}

function showFloatingAlert(message, title = 'Aviso') {
    if (!window.bootstrap || !bootstrap.Modal) {
        alert(message);
        return Promise.resolve(true);
    }
    garantirUxUi();
    uxModo = 'alert';
    const modalEl = document.getElementById('uxFloatingModal');
    const titleEl = document.getElementById('uxFloatingModalTitle');
    const messageEl = document.getElementById('uxFloatingModalMessage');
    const inputWrap = document.getElementById('uxFloatingInputWrap');
    const cancelBtn = document.getElementById('uxFloatingCancel');

    titleEl.textContent = String(title || 'Aviso');
    messageEl.textContent = String(message || '');
    inputWrap.classList.add('d-none');
    cancelBtn.classList.add('d-none');

    return new Promise((resolve) => {
        uxResolver = resolve;
        uxModalInstance.show();
    });
}

function showFloatingConfirm(message, title = 'Confirmação') {
    if (!window.bootstrap || !bootstrap.Modal) {
        return Promise.resolve(false);
    }
    garantirUxUi();
    uxModo = 'confirm';
    const modalEl = document.getElementById('uxFloatingModal');
    const titleEl = document.getElementById('uxFloatingModalTitle');
    const messageEl = document.getElementById('uxFloatingModalMessage');
    const inputWrap = document.getElementById('uxFloatingInputWrap');
    const cancelBtn = document.getElementById('uxFloatingCancel');

    titleEl.textContent = String(title || 'Confirmação');
    messageEl.textContent = String(message || '');
    inputWrap.classList.add('d-none');
    cancelBtn.classList.remove('d-none');

    return new Promise((resolve) => {
        uxResolver = resolve;
        uxModalInstance.show();
    });
}

function showFloatingPrompt(message, opts = {}) {
    if (!window.bootstrap || !bootstrap.Modal) {
        return Promise.resolve(null);
    }
    garantirUxUi();
    uxModo = 'prompt';
    const modalEl = document.getElementById('uxFloatingModal');
    const titleEl = document.getElementById('uxFloatingModalTitle');
    const messageEl = document.getElementById('uxFloatingModalMessage');
    const inputWrap = document.getElementById('uxFloatingInputWrap');
    const inputEl = document.getElementById('uxFloatingInput');
    const cancelBtn = document.getElementById('uxFloatingCancel');

    titleEl.textContent = String(opts.title || 'Preencher');
    messageEl.textContent = String(message || '');
    inputWrap.classList.remove('d-none');
    cancelBtn.classList.remove('d-none');
    inputEl.value = String(opts.defaultValue || '');
    inputEl.placeholder = String(opts.placeholder || '');

    return new Promise((resolve) => {
        uxResolver = resolve;
        uxModalInstance.show();
        setTimeout(() => inputEl.focus(), 120);
    });
}

window.showFloatingToast = showFloatingToast;
window.showFloatingAlert = showFloatingAlert;
window.showFloatingConfirm = showFloatingConfirm;
window.showFloatingPrompt = showFloatingPrompt;

const __nativeAlert = window.alert ? window.alert.bind(window) : null;
window.alert = function patchedAlert(message) {
    try {
        if (window.showFloatingAlert) {
            window.showFloatingAlert(String(message || ''), 'Aviso');
            return;
        }
    } catch (_) { }
    if (__nativeAlert) __nativeAlert(message);
};

// Estado inicial baseado no localStorage
document.addEventListener('DOMContentLoaded', () => {
    inicializarMascaraTelefoneGlobal();
    garantirUxUi();
});

/**
 * Função para injetar o menu no DOM
 * @param {string} selector - Seletor CSS onde injetar o menu (ex: '#app' ou 'body')
 * @param {string} position - 'prepend' ou 'append' (padrão: 'prepend')
 */
function injetarMenu(selector = '#app', position = 'prepend') {
    const container = document.querySelector(selector);
    if (!container) {
        console.error(`Elemento com seletor "${selector}" não encontrado`);
        return false;
    }

    // Verifica se já existe um layout-wrapper para não duplicar
    if (document.getElementById('layout-wrapper')) {
        return true;
    }

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = menuTemplate.trim();
    const layoutElement = tempDiv.firstChild;

    // Evitar conflito com Vue 3 movendo #app para DENTRO do page-content
    if (selector === '#app' && container.id === 'app' && container.parentNode === document.body) {
        // Limpar os stilos velhos adicionados na versão antiga
        document.body.style.display = '';
        document.body.style.width = '';
        document.body.style.minHeight = '';
        document.body.style.margin = '';
        container.style.flex = '';

        document.body.insertBefore(layoutElement, container);
        const pageContent = document.getElementById('PAGE_CONTENT_PLACEHOLDER');
        pageContent.innerHTML = '';
        pageContent.appendChild(container); // Move o #app para dentro do page-content
    } else {
        if (position === 'append') {
            container.appendChild(layoutElement);
        } else {
            container.insertBefore(layoutElement, container.firstChild);
        }
    }

    // Lógica do Menu Colapsável / Mobile
    const layoutWrapper = document.getElementById('layout-wrapper');
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');
    const logoutBtn = document.getElementById('btnLogoutSistema');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    const isMobile = () => window.matchMedia('(max-width: 991.98px)').matches;
    const atualizarModoMenu = () => {
        if (!layoutWrapper || !sidebar) return;
        if (isMobile()) {
            layoutWrapper.classList.add('mobile-sidebar');
            layoutWrapper.classList.remove('menu-open');
            sidebar.classList.remove('collapsed');
        } else {
            layoutWrapper.classList.remove('mobile-sidebar');
            layoutWrapper.classList.remove('menu-open');
            const isCollapsed = localStorage.getItem('menuCollapsed') === 'true';
            sidebar.classList.toggle('collapsed', isCollapsed);
        }
    };

    const abrirFecharSidebarMobile = (open) => {
        if (!layoutWrapper || !layoutWrapper.classList.contains('mobile-sidebar')) return;
        layoutWrapper.classList.toggle('menu-open', !!open);
    };

    atualizarModoMenu();
    window.addEventListener('resize', atualizarModoMenu);

    const aplicarEstadoGrupos = () => {
        const raw = localStorage.getItem('menuGroupOpen');
        let aberto = {};
        try { aberto = raw ? JSON.parse(raw) : {}; } catch (_) { aberto = {}; }
        document.querySelectorAll('#sidebar .menu-group').forEach((groupEl) => {
            const key = groupEl.getAttribute('data-group');
            const open = !!aberto[key];
            groupEl.classList.toggle('open', open);
        });
    };

    const salvarEstadoGrupo = (groupKey, open) => {
        const raw = localStorage.getItem('menuGroupOpen');
        let estado = {};
        try { estado = raw ? JSON.parse(raw) : {}; } catch (_) { estado = {}; }
        estado[groupKey] = !!open;
        localStorage.setItem('menuGroupOpen', JSON.stringify(estado));
    };
    aplicarEstadoGrupos();

    document.querySelectorAll('#sidebar [data-group-toggle]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const key = btn.getAttribute('data-group-toggle');
            const group = btn.closest('.menu-group');
            if (!key || !group) return;
            const open = !group.classList.contains('open');
            group.classList.toggle('open', open);
            salvarEstadoGrupo(key, open);
        });
    });

    // Evento de Toggle
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            if (layoutWrapper && layoutWrapper.classList.contains('mobile-sidebar')) {
                abrirFecharSidebarMobile(!layoutWrapper.classList.contains('menu-open'));
                return;
            }
            sidebar.classList.toggle('collapsed');
            localStorage.setItem('menuCollapsed', sidebar.classList.contains('collapsed'));
        });
    }
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', () => abrirFecharSidebarMobile(false));
    }

    document.querySelectorAll('#sidebar .nav-link').forEach((link) => {
        link.addEventListener('click', () => {
            if (layoutWrapper && layoutWrapper.classList.contains('mobile-sidebar')) {
                abrirFecharSidebarMobile(false);
            }
        });
    });

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await fetch('/api/auth/logout', { method: 'POST' });
            } catch (_) { }
            window.location.href = '/login';
        });
    }

    carregarNomeMeuEJC();
    inicializarMascaraTelefoneGlobal();
    garantirUxUi();

    return true;
}

/**
 * Função para ativar link no menu
 * @param {string} identifier - Href ou Texto exato do link a ativar
 */
function ativarMenu(identifier) {
    const links = document.querySelectorAll('#sidebar .nav-link');
    const pathAtual = window.location.pathname;
    const aliases = {
        '/historico-equipes': '/gestaodoencontro/ejc',
        '/ejc': '/gestaodoencontro/ejc',
        '/equipes': '/gestaodoencontro/equipes',
        '/outros-ejcs': '/gestaodoencontro/outrosejcs',
        '/jovens-outro-ejc': '/gestaodoencontro/jovensoutroejc',
        '/visitantes': '/gestaodoencontro/visitantes',
        '/tios': '/gestaodoencontro/tios',
        '/montar-encontro': '/gestaodoencontro/montarencontro',
        '/gestaodoencontro/formularios-atualizacao': '/gestaodoencontro/formularios-atualizacao',
        '/moita': '/gestaodoencontro/moita',
        '/garcons': '/gestaodoencontro/garcons',
        '/votacao': '/gestaodoencontro/votacao',
        '/calendario': '/planejamento/calendario',
        '/eventos': '/planejamento/inscricoes',
        '/formularios': '/planejamento/inscricoes',
        '/inscricoes': '/planejamento/inscricoes',
        '/planejamento/eventos': '/planejamento/inscricoes',
        '/ata-reunioes': '/planejamento/atasdereuniao',
        '/financeiro': '/administrativo/financeiro',
        '/anexos': '/administrativo/anexos',
        '/contatos': '/administrativo/contatos',
        '/usuarios': '/configuracoes/usuarios',
        '/coordenadores': '/configuracoes/coordenacoes',
        '/funcoes-dirigencia': '/configuracoes/funcoes-dirigencia',
        '/meu-ejc': '/configuracoes/meuejc',
        '/circulos': '/configuracoes/circulos'
    };
    const canonicalizar = (valor) => aliases[String(valor || '').trim()] || String(valor || '').trim();
    const identifierCanonico = canonicalizar(identifier);
    const pathAtualCanonico = canonicalizar(pathAtual);

    links.forEach(link => {
        const href = link.getAttribute('href');
        const hrefCanonico = canonicalizar(href);
        // Buscar texto dentro do span .link-text se existir, senão textContent normal
        const textSpan = link.querySelector('.link-text');
        const text = textSpan ? textSpan.textContent.trim() : link.textContent.trim();

        // Verifica se o identificador corresponde ao href ou ao texto exato
        if (
            href === identifier ||
            href === pathAtual ||
            hrefCanonico === identifierCanonico ||
            hrefCanonico === pathAtualCanonico ||
            text === identifier
        ) {
            link.classList.add('active');
            link.classList.remove('text-white-50');
        } else {
            link.classList.remove('active');
            link.classList.add('text-white-50');
        }
    });

    const activeLink = Array.from(links).find((l) => l.classList.contains('active'));
    if (activeLink) {
        const group = activeLink.closest('.menu-group');
        if (group) {
            const key = group.getAttribute('data-group');
            group.classList.add('open');
            const raw = localStorage.getItem('menuGroupOpen');
            let estado = {};
            try { estado = raw ? JSON.parse(raw) : {}; } catch (_) { estado = {}; }
            estado[key] = true;
            localStorage.setItem('menuGroupOpen', JSON.stringify(estado));
        }
    }
}
