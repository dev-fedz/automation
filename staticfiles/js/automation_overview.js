(function () {
    const root = document.getElementById('automation-overview');
    if (!root) {
        return;
    }

    const ANIMATION_DURATION = 650;

    const animateMetrics = () => {
        const metrics = root.querySelectorAll('[data-count-target]');
        const now = performance.now();

        metrics.forEach((metric) => {
            const target = Number(metric.dataset.countTarget || '0');
            const start = Number(metric.textContent.replace(/[^0-9]/g, '') || '0');
            const initial = Math.min(start, target);

            const step = (timestamp) => {
                const progress = Math.min((timestamp - now) / ANIMATION_DURATION, 1);
                const eased = 1 - Math.pow(1 - progress, 3);
                const value = Math.round(initial + (target - initial) * eased);
                metric.textContent = value.toLocaleString();

                if (progress < 1) {
                    requestAnimationFrame(step);
                }
            };

            requestAnimationFrame(step);
        });
    };

    const setupRunFiltering = () => {
        const filterContainer = root.querySelector('[data-role="run-filters"]');
        const noRunsRow = root.querySelector('[data-role="no-runs"]');
        const emptyStateRow = root.querySelector('[data-role="no-filter-results"]');
        const rows = Array.from(root.querySelectorAll('tbody > tr[data-run-status]'));
        const detailDrawer = root.querySelector('[data-role="run-detail"]');

        if (!filterContainer || rows.length === 0) {
            return;
        }

        const statusChips = Array.from(filterContainer.querySelectorAll('[data-filter-status]'));
        let activeStatus = 'all';

        const setActiveChip = (status) => {
            statusChips.forEach((chip) => {
                if (chip.dataset.filterStatus === status) {
                    chip.classList.add('is-active');
                } else {
                    chip.classList.remove('is-active');
                }
            });
        };

        const applyFilter = (status) => {
            activeStatus = status;
            let visibleCount = 0;

            rows.forEach((row) => {
                const matches = status === 'all' || row.dataset.runStatus === status;
                row.hidden = !matches;
                if (matches) {
                    visibleCount += 1;
                }
            });

            if (emptyStateRow) {
                emptyStateRow.hidden = visibleCount > 0;
            }

            if (noRunsRow) {
                noRunsRow.hidden = true;
            }

            if (visibleCount === 0 && detailDrawer) {
                detailDrawer.hidden = true;
            }
        };

        statusChips.forEach((chip) => {
            chip.addEventListener('click', () => {
                const status = chip.dataset.filterStatus || 'all';
                setActiveChip(status);
                applyFilter(status);
            });
        });

        setActiveChip(activeStatus);
        applyFilter(activeStatus);
    };

    const setupRunDetail = () => {
        const table = root.querySelector('table.automation-table tbody');
        const detailDrawer = root.querySelector('[data-role="run-detail"]');
        if (!table || !detailDrawer) {
            return;
        }

        const updateDrawer = (row) => {
            const title = detailDrawer.querySelector('[data-role="detail-title"]');
            const subtitle = detailDrawer.querySelector('[data-role="detail-subtitle"]');
            const statusChip = detailDrawer.querySelector('[data-role="detail-status"]');
            const collection = detailDrawer.querySelector('[data-role="detail-collection"]');
            const environment = detailDrawer.querySelector('[data-role="detail-environment"]');
            const total = detailDrawer.querySelector('[data-role="detail-total"]');
            const passed = detailDrawer.querySelector('[data-role="detail-passed"]');
            const failed = detailDrawer.querySelector('[data-role="detail-failed"]');
            const finished = detailDrawer.querySelector('[data-role="detail-finished"]');

            if (!title || !subtitle || !statusChip) {
                return;
            }

            const runId = row.dataset.runId || '';
            const status = row.dataset.runStatus || '';
            const statusLabel = row.dataset.runStatusLabel || status;

            title.textContent = `Run #${runId}`;
            subtitle.textContent = `${row.dataset.runCollection || '—'} · ${row.dataset.runFinishedLabel || 'Not finished yet'}`;
            statusChip.textContent = statusLabel;
            statusChip.className = `status-chip status-${status}`;

            if (collection) {
                collection.textContent = row.dataset.runCollection || '—';
            }

            if (environment) {
                environment.textContent = row.dataset.runEnvironment || '—';
            }

            if (total) {
                total.textContent = Number(row.dataset.runTotalRequests || '0').toLocaleString();
            }

            if (passed) {
                passed.textContent = Number(row.dataset.runPassed || '0').toLocaleString();
            }

            if (failed) {
                failed.textContent = Number(row.dataset.runFailed || '0').toLocaleString();
            }

            if (finished) {
                finished.textContent = row.dataset.runFinished || '—';
            }

            detailDrawer.hidden = false;
        };

        const clearSelection = () => {
            const previous = table.querySelector('tr.is-selected');
            if (previous) {
                previous.classList.remove('is-selected');
            }
        };

        const handleRowSelection = (row) => {
            clearSelection();
            row.classList.add('is-selected');
            updateDrawer(row);
        };

        table.addEventListener('click', (event) => {
            const row = event.target instanceof Element ? event.target.closest('tr[data-run-status]') : null;
            if (row && !row.hidden) {
                handleRowSelection(row);
            }
        });

        table.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                const row = event.target instanceof Element ? event.target.closest('tr[data-run-status]') : null;
                if (row && !row.hidden) {
                    event.preventDefault();
                    handleRowSelection(row);
                }
            }
        });
    };

    animateMetrics();
    setupRunFiltering();
    setupRunDetail();
})();
