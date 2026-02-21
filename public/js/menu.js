/**
 * Menu Lateral - SemeaJovens
 * Template reutilizável para todas as páginas
 */

const menuTemplate = `
<div id="layout-wrapper">
    <nav id="sidebar">
        <div class="logo-box">
            <span>🌱 SemeaJovens</span>
        </div>
        <div class="nav flex-column mt-2">
            <a href="/" class="nav-link" title="Lista Mestre">
                <span class="fs-5">📋</span> <span class="link-text">Lista Mestre</span>
            </a>
            <a href="/ejc" class="nav-link" title="EJC">
                <span class="fs-5">🎯</span> <span class="link-text">EJC</span>
            </a>
            <a href="/equipes" class="nav-link" title="Equipes">
                <span class="fs-5">👥</span> <span class="link-text">Equipes</span>
            </a>
            <a href="/historico-equipes" class="nav-link" title="Histórico de Equipes">
                <span class="fs-5">📜</span> <span class="link-text">Histórico</span>
            </a>
            <a href="/outros-ejcs" class="nav-link" title="Outros EJCs">
                <span class="fs-5">🌍</span> <span class="link-text">Outros EJCs</span>
            </a>
            <a href="/anexos" class="nav-link" title="Anexos">
                <span class="fs-5">📁</span> <span class="link-text">Anexos</span>
            </a>
            <a href="/usuarios" class="nav-link" title="Usuários">
                <span class="fs-5">👥</span> <span class="link-text">Usuários</span>
            </a>
            <a href="/votacao" class="nav-link" title="Votação">
                <span class="fs-5">🗳️</span> <span class="link-text">Votação</span>
            </a>
        </div>
    </nav>
    <div id="main-content">
        <header id="page-topbar">
            <div class="d-flex w-100 justify-content-between align-items-center">
                <button id="sidebarToggle" class="btn btn-sm px-3 fs-16 header-item vertical-menu-btn topnav-hamburger">
                    ☰
                </button>
                <div class="d-flex align-items-center">
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

// Estado inicial baseado no localStorage
document.addEventListener('DOMContentLoaded', () => {
    // A função injetarMenu pode ser chamada depois, então vamos usar um observer ou apenas tentar inicializar se o menu já existir
    // Mas como injetarMenu é chamado nas páginas, vamos colocar a lógica de inicialização dentro de injetarMenu ou criar initMenu
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

    // Lógica do Menu Colapsável
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');

    // Ler estado salvo
    const isCollapsed = localStorage.getItem('menuCollapsed') === 'true';
    if (isCollapsed) {
        sidebar.classList.add('collapsed');
    }

    // Evento de Toggle
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            const collapsed = sidebar.classList.contains('collapsed');
            localStorage.setItem('menuCollapsed', collapsed);
        });
    }

    return true;
}

/**
 * Função para ativar link no menu
 * @param {string} identifier - Href ou Texto exato do link a ativar
 */
function ativarMenu(identifier) {
    const links = document.querySelectorAll('#sidebar .nav-link');
    links.forEach(link => {
        const href = link.getAttribute('href');
        // Buscar texto dentro do span .link-text se existir, senão textContent normal
        const textSpan = link.querySelector('.link-text');
        const text = textSpan ? textSpan.textContent.trim() : link.textContent.trim();

        // Verifica se o identificador corresponde ao href ou ao texto exato
        if (href === identifier || text === identifier) {
            link.classList.add('active');
            link.classList.remove('text-white-50');
        } else {
            link.classList.remove('active');
            link.classList.add('text-white-50');
        }
    });
}
