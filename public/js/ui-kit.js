(() => {
    const nativeAlert = window.alert;
    const nativeConfirm = window.confirm;

    const hasBootstrap = () => window.bootstrap && typeof window.bootstrap.Modal === 'function';

    let modalEl = null;
    let modalInstance = null;
    let resolveFn = null;

    const ensureModal = () => {
        if (modalEl) return;
        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
<div class="modal fade" id="uiModalPadrao" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content ui-modal">
      <div class="modal-header">
        <h5 class="modal-title" id="uiModalTitulo">Aviso</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
      </div>
      <div class="modal-body" id="uiModalMensagem"></div>
      <div class="modal-footer" id="uiModalFooter">
        <button type="button" class="btn btn-outline-secondary" data-ui-cancel>Cancelar</button>
        <button type="button" class="btn btn-primary" data-ui-ok>OK</button>
      </div>
    </div>
  </div>
</div>`;
        modalEl = wrapper.firstElementChild;
        document.body.appendChild(modalEl);
        modalInstance = new window.bootstrap.Modal(modalEl);

        const okBtn = modalEl.querySelector('[data-ui-ok]');
        const cancelBtn = modalEl.querySelector('[data-ui-cancel]');

        okBtn.addEventListener('click', () => {
            if (resolveFn) resolveFn(true);
            resolveFn = null;
            modalInstance.hide();
        });

        cancelBtn.addEventListener('click', () => {
            if (resolveFn) resolveFn(false);
            resolveFn = null;
            modalInstance.hide();
        });

        modalEl.addEventListener('hidden.bs.modal', () => {
            if (resolveFn) resolveFn(false);
            resolveFn = null;
        });
    };

    const openModal = ({ title, message, confirm }) => {
        ensureModal();
        const titleEl = modalEl.querySelector('#uiModalTitulo');
        const msgEl = modalEl.querySelector('#uiModalMensagem');
        const footer = modalEl.querySelector('#uiModalFooter');
        const cancelBtn = modalEl.querySelector('[data-ui-cancel]');
        const okBtn = modalEl.querySelector('[data-ui-ok]');

        titleEl.textContent = title || 'Aviso';
        msgEl.textContent = message || '';

        if (confirm) {
            cancelBtn.classList.remove('d-none');
            okBtn.textContent = 'Confirmar';
        } else {
            cancelBtn.classList.add('d-none');
            okBtn.textContent = 'OK';
        }
        footer.classList.toggle('ui-footer-center', !confirm);

        modalInstance.show();
        return new Promise((resolve) => {
            resolveFn = resolve;
        });
    };

    window.uiAlert = (message, options = {}) => {
        if (!hasBootstrap()) {
            nativeAlert(message);
            return Promise.resolve(true);
        }
        return openModal({
            title: options.title || 'Aviso',
            message: String(message || ''),
            confirm: false
        });
    };

    window.uiConfirm = (message, options = {}) => {
        if (!hasBootstrap()) return Promise.resolve(nativeConfirm(message));
        return openModal({
            title: options.title || 'Confirmação',
            message: String(message || ''),
            confirm: true
        });
    };

    window.alert = (message) => {
        window.uiAlert(message);
    };
})();
