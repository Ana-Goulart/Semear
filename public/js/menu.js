/**
 * Menu Lateral - SemeaJovens
 * Template reutilizável para todas as páginas
 */

const menuTemplate = `
<nav id="sidebar">
    <div class="p-4 border-bottom border-secondary">
        <h4 class="m-0">🌱 SemeaJovens</h4>
        <button id="sidebarToggle" class="btn btn-sm btn-outline-light border-0">☰</button>
    </div>
    <div class="nav flex-column mt-2">
        <a href="/" class="nav-link text-white-50" title="Lista Mestre">
            <span class="fs-5">📋</span> <span class="link-text">Lista Mestre</span>
        </a>
        <a href="/ejc" class="nav-link text-white-50" title="EJC">
            <span class="fs-5">🎯</span> <span class="link-text">EJC</span>
        </a>
        <a href="/equipes" class="nav-link text-white-50" title="Equipes">
            <span class="fs-5">👥</span> <span class="link-text">Equipes</span>
        </a>
        <a href="/historico-equipes" class="nav-link text-white-50" title="Histórico de Equipes">
            <span class="fs-5">📜</span> <span class="link-text">Histórico</span>
        </a>
        <a href="/anexos" class="nav-link text-white-50" title="Anexos">
            <span class="fs-5">📁</span> <span class="link-text">Anexos</span>
        </a>
        <a href="/usuarios" class="nav-link text-white-50" title="Usuários">
            <span class="fs-5">👥</span> <span class="link-text">Usuários</span>
        </a>
        <a href="/votacao" class="nav-link text-white-50" title="Votação">
            <span class="fs-5">🗳️</span> <span class="link-text">Votação</span>
        </a>
    </div>
</nav>
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

    // Verifica se já existe um sidebar para não duplicar
    if (document.getElementById('sidebar')) {
        return true;
    }

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = menuTemplate.trim();
    const menuElement = tempDiv.firstChild;

    // Evitar conflito com Vue 3 injetando fora do #app
    if (selector === '#app' && container.id === 'app' && container.parentNode === document.body) {
        document.body.style.display = 'flex';
        document.body.style.width = '100%';
        document.body.style.minHeight = '100vh';
        document.body.style.margin = '0';
        document.body.insertBefore(menuElement, container);
        container.style.flex = '1';
    } else {
        if (position === 'append') {
            container.appendChild(menuElement);
        } else {
            container.insertBefore(menuElement, container.firstChild);
        }
    }

    // Lógica do Menu Colapsável
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');
    const title = sidebar.querySelector('h4');

    // Ler estado salvo
    const isCollapsed = localStorage.getItem('menuCollapsed') === 'true';
    if (isCollapsed) {
        sidebar.classList.add('collapsed');
        title.style.display = 'none'; // Garantir que comece oculto
    }

    // Evento de Toggle
    toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        const collapsed = sidebar.classList.contains('collapsed');
        localStorage.setItem('menuCollapsed', collapsed);

        if (collapsed) {
            setTimeout(() => title.style.display = 'none', 200); // Aguarda transição
        } else {
            title.style.display = 'block';
        }
    });

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
