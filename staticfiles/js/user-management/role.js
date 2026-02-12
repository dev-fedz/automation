(function () {
    'use strict';

    function getCsrfToken() {
        const name = 'csrftoken=';
        const parts = document.cookie.split(';');

        for (let i = 0; i < parts.length; i += 1) {
            const trimmed = parts[i].trim();
            if (trimmed.startsWith(name)) {
                return decodeURIComponent(trimmed.substring(name.length));
            }
        }

        const meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.getAttribute('content') : '';
    }

    function createPaginationControls(paginationId, onPrev, onNext, defaultPageSize) {
        const container = document.getElementById(paginationId);
        if (!container) return null;

        container.innerHTML = '';

        const prev = document.createElement('button');
        prev.type = 'button';
        prev.className = 'btn btn-sm';
        prev.textContent = 'Prev';

        const info = document.createElement('span');
        info.className = 'pagination-info';
        info.style.margin = '0 0.6rem';

        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'btn btn-sm';
        next.textContent = 'Next';

        prev.addEventListener('click', onPrev);
        next.addEventListener('click', onNext);

        const select = document.createElement('select');
        select.className = 'pagination-pagesize';
        [10, 20, 30, 40, 50, 100].forEach((n) => {
            const opt = document.createElement('option');
            opt.value = n;
            opt.text = String(n);
            select.appendChild(opt);
        });

        if (defaultPageSize) {
            select.value = String(defaultPageSize);
        }

        select.style.marginLeft = '0.6rem';
        select.style.padding = '0.25rem 0.5rem';
        select.title = 'Rows per page';

        container.appendChild(prev);
        container.appendChild(info);
        container.appendChild(next);
        container.appendChild(select);

        return { prev, info, next, pagesize: select };
    }

    function initTablePagination(tableId, paginationId, pageSize) {
        const table = document.getElementById(tableId);
        const tbody = table && table.querySelector('tbody');
        if (!tbody) return;

        const rows = Array.from(tbody.querySelectorAll('tr')).filter(
            (r) => !r.classList.contains('empty-row') && !r.classList.contains('empty')
        );

        const state = { page: 1, pageSize, rows };

        function renderPage() {
            const start = (state.page - 1) * state.pageSize;
            const end = start + state.pageSize;

            state.rows.forEach((r, i) => {
                r.style.display = i >= start && i < end ? '' : 'none';
            });

            const totalPages = Math.max(1, Math.ceil(state.rows.length / state.pageSize));
            controls.info.textContent = `${state.page} / ${totalPages}`;
            controls.prev.disabled = state.page <= 1;
            controls.next.disabled = state.page >= totalPages;
        }

        function prev() {
            if (state.page > 1) {
                state.page -= 1;
                renderPage();
            }
        }

        function next() {
            const totalPages = Math.max(1, Math.ceil(state.rows.length / state.pageSize));
            if (state.page < totalPages) {
                state.page += 1;
                renderPage();
            }
        }

        const controls = createPaginationControls(paginationId, prev, next, pageSize) || {
            prev: { disabled: true },
            next: { disabled: true },
            info: { textContent: '' },
            pagesize: null,
        };

        if (controls.pagesize) {
            controls.pagesize.addEventListener('change', function () {
                const value = parseInt(this.value, 10) || 10;
                state.pageSize = value;
                state.page = 1;
                renderPage();
            });
        }

        renderPage();
    }

    function initRoleModalAndActions() {
        const modal = document.querySelector('[data-role="role-modal"]');
        if (!modal) return;

        const modalBody = modal.querySelector('[data-role="role-modal-body"]');
        const modalTitle = modal.querySelector('[data-role="role-modal-title"]');

        function openModal(title, html) {
            if (modalTitle) {
                modalTitle.textContent = title;
            }
            if (modalBody) {
                modalBody.innerHTML = html;
            }

            modal.hidden = false;
            document.body.classList.add('automation-modal-open');

            const closeButton = modal.querySelector('.automation-modal__close');
            if (closeButton) {
                closeButton.focus();
            }
        }

        function closeModal() {
            modal.hidden = true;
            document.body.classList.remove('automation-modal-open');
        }

        modal.addEventListener('click', function (event) {
            if (event.target.dataset.action === 'close-role-modal') {
                closeModal();
            }
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && !modal.hidden) {
                closeModal();
            }
        });

        function renderPermissions(data) {
            if (!data) {
                return '<p class="muted">No modules / permissions</p>';
            }

            if (data.role_modules && data.role_modules.length) {
                return data.role_modules
                    .map(function (rm) {
                        const perms = rm.permissions && rm.permissions.length
                            ? '<ul class="role-modal-perms">' + rm.permissions.map(function (p) { return '<li>' + p.codename + '</li>'; }).join('') + '</ul>'
                            : '<p class="muted">No permissions</p>';
                        return '<section class="role-modal-module"><h3>' + rm.module.name + '</h3>' + perms + '</section>';
                    })
                    .join('');
            }

            if (data.modules && data.modules.length) {
                return data.modules
                    .map(function (m) {
                        return '<section class="role-modal-module"><h3>' + m.name + '</h3></section>';
                    })
                    .join('');
            }

            return '<p class="muted">No modules / permissions</p>';
        }

        document.querySelectorAll('[data-role-view]').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                const id = btn.getAttribute('data-role-view');

                try {
                    const response = await fetch(`/api/accounts/roles/${id}/`);
                    if (!response.ok) {
                        throw new Error('Failed');
                    }

                    const data = await response.json();
                    const body = [
                        '<div class="role-modal-body-section">',
                        `<p class="role-modal-meta"><span>ID:</span> ${data.id}</p>`,
                        renderPermissions(data),
                        '</div>',
                    ].join('');

                    openModal(`Role: ${data.name}`, body);
                } catch (error) {
                    openModal('Error', '<p class="role-modal-error">Could not load role details.</p>');
                }
            });
        });

        document.querySelectorAll('[data-role-delete]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const id = btn.getAttribute('data-role-delete');

                openModal(
                    'Delete Role',
                    '<form id="delete-role-form" class="role-confirm-form">' +
                    '<p class="role-modal-warning">Are you sure you want to delete this role?</p>' +
                    '<div class="role-confirm-actions" role="group">' +
                    '<button type="submit" class="action-button" data-variant="danger" data-testid="confirm-delete-btn">Delete</button>' +
                    '<button type="button" class="btn-secondary" data-action="close-role-modal" data-testid="cancel-delete-btn">Cancel</button>' +
                    '</div>' +
                    '</form>'
                );

                const form = document.getElementById('delete-role-form');
                if (!form) return;

                form.addEventListener('submit', async function (event) {
                    event.preventDefault();

                    try {
                        const response = await fetch(`/api/accounts/roles/${id}/delete/`, {
                            method: 'DELETE',
                            headers: {
                                'X-Requested-With': 'XMLHttpRequest',
                                'X-CSRFToken': getCsrfToken(),
                            },
                        });

                        if (response.status === 400) {
                            const data = await response.json();
                            form.innerHTML =
                                `<p class="role-modal-error">${data.error || 'Cannot delete role with related records.'}</p>` +
                                '<div class="role-confirm-actions"><button type="button" class="btn-secondary" data-action="close-role-modal">Close</button></div>';
                            return;
                        }

                        if (!response.ok) {
                            throw new Error('Delete failed');
                        }

                        const row = document.querySelector(`tr[data-role-id='${id}']`);
                        if (row) {
                            row.remove();
                        }

                        closeModal();
                    } catch (error) {
                        form.innerHTML =
                            '<p class="role-modal-error">Failed to delete role.</p>' +
                            '<div class="role-confirm-actions"><button type="button" class="btn-secondary" data-action="close-role-modal">Close</button></div>';
                    }
                }, { once: true });
            });
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        initRoleModalAndActions();
        initTablePagination('roles-table', 'roles-pagination', 10);
    });
})();
