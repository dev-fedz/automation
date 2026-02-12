(function () {
    'use strict';

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
            (r) => !r.classList.contains('empty')
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

    document.addEventListener('DOMContentLoaded', function () {
        initTablePagination('users-table', 'users-pagination', 10);
    });
})();
