// This file was missing from web/static/js/ but present in staticfiles/js/.
// If you have custom JS for the Automation Overview page, copy it here.
// Otherwise, this placeholder will prevent 404 errors and MIME type issues.


document.addEventListener('DOMContentLoaded', function () {
    const filterButtons = document.querySelectorAll('.control-chip[data-filter-status]');
    const runRows = document.querySelectorAll('.automation-table tbody tr[data-run-status]');
    const noResultsRow = document.querySelector('[data-role="no-filter-results"]');

    function filterRuns(status) {
        let anyVisible = false;
        runRows.forEach(row => {
            const rowStatus = row.getAttribute('data-run-status');
            if (status === 'all' || rowStatus === status) {
                row.style.display = '';
                anyVisible = true;
            } else {
                row.style.display = 'none';
            }
        });
        if (noResultsRow) {
            noResultsRow.hidden = anyVisible;
        }
    }

    filterButtons.forEach(btn => {
        btn.addEventListener('click', function () {
            // Remove active class from all
            filterButtons.forEach(b => b.classList.remove('is-active'));
            // Add active to this
            btn.classList.add('is-active');
            // Filter
            filterRuns(btn.getAttribute('data-filter-status'));
        });
    });
});
