// Multi-testcase runner: builds a modal with accordions for each selected case and runs their related API requests
(function () {
    'use strict';

    // Ensure a known global exists so developers can check whether this
    // JS bundle was loaded and updated in the browser. Initialize to null.
    try {
        if (typeof window !== 'undefined' && typeof window.__lastAutomationReportId === 'undefined') {
            window.__lastAutomationReportId = null;
            try { console.log('[automation] multi-runner loaded (init)'); } catch (_e) { }
        }
    } catch (_e) { /* ignore */ }

    const shouldMirrorAutomationLog = (level) => {
        if (level === 'error') {
            return true;
        }
        try {
            const debugEnabled = Boolean(typeof window !== 'undefined' && window.__automationDebugMode);
            if (debugEnabled) {
                return true;
            }
        } catch (_error) {
            return false;
        }
        return false;
    };

    const mirrorAutomationLog = (level, ...args) => {
        if (!shouldMirrorAutomationLog(level)) {
            return;
        }
        try {
            if (typeof console === 'undefined') {
                return;
            }
            const method = typeof console[level] === 'function' ? console[level] : console.log;
            if (typeof method === 'function') {
                method.apply(console, args);
            }
        } catch (_error) {
            /* ignore logging issues */
        }
    };

    const getJsonScript = (id) => {
        try {
            const el = document.getElementById(id);
            if (!el) return null;
            return JSON.parse(el.textContent || el.innerText || '{}');
        } catch (e) {
            return null;
        }
    };

    const endpoints = getJsonScript('automation-api-endpoints') || {};
    const executeUrl = endpoints.tester_execute || endpoints['tester_execute'] || endpoints['tester.execute'] || endpoints.execute || window.__automation_execute_url || null;
    const POST_URL = executeUrl || '/api/core/tester/execute/';
    const FINALIZE_URL = (endpoints && (endpoints.automation_report_finalize || endpoints['automation_report_finalize'])) || '/api/core/automation-report/finalize/';
    const DEFAULT_PRE_CONSOLE_MESSAGE = 'No pre-request console output.';
    const DEFAULT_POST_CONSOLE_MESSAGE = 'No post-request console output.';

    // Ensure global helpers exist so other UI paths can create/finalize reports
    try {
        if (typeof window !== 'undefined') {
            if (typeof window.__automationCreateReport !== 'function') {
                window.__automationCreateReport = async function (triggeredIn) {
                    try {
                        const name = 'csrftoken';
                        let csrftoken = null;
                        try {
                            const cparts = document.cookie.split(';').map(s => s.trim()).filter(Boolean);
                            for (const p of cparts) { if (p.startsWith(name + '=')) { csrftoken = decodeURIComponent(p.split('=')[1]); break; } }
                        } catch (e) { csrftoken = null; }
                        const url = FINALIZE_URL.replace('/finalize/', '/create/');
                        try { console.log('[automation] __automationCreateReport calling', url); } catch (_e) { }
                        const resp = await fetch(url, {
                            method: 'POST',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json', ...(csrftoken ? { 'X-CSRFToken': csrftoken } : {}) },
                            body: JSON.stringify({ triggered_in: triggeredIn || 'ui-manual' }),
                        });
                        if (!resp || !resp.ok) {
                            try { console.warn('[automation] create report failed', resp && resp.status); } catch (_e) { }
                            return null;
                        }
                        const body = await resp.json();
                        if (body && body.id) {
                            try { window.__lastAutomationReportId = Number(body.id); } catch (_e) { }
                            try { console.log('[automation] __automationCreateReport created', body); } catch (_e) { }
                            return Number(body.id);
                        }
                    } catch (err) {
                        try { console.warn('[automation] __automationCreateReport error', err); } catch (_e) { }
                        return null;
                    }
                    return null;
                };
            }

            if (typeof window.__automationFinalizeReport !== 'function') {
                window.__automationFinalizeReport = async function (reportId, totals) {
                    try {
                        const id = reportId || (window.__lastAutomationReportId ? Number(window.__lastAutomationReportId) : null);
                        if (!id) {
                            try { console.warn('[automation] __automationFinalizeReport: no report id'); } catch (_e) { }
                            return null;
                        }
                        const payloadTotals = (totals && typeof totals === 'object') ? totals : null;
                        let computed = payloadTotals;
                        if (!computed) {
                            try {
                                const modal = document.getElementById('testcase-multi-response-modal');
                                const res = (modal && window.collectAllScenarioTotals) ? collectAllScenarioTotals(modal) : null;
                                computed = res && res.totals ? res.totals : { passed: 0, failed: 0, blocked: 0 };
                            } catch (_e) { computed = { passed: 0, failed: 0, blocked: 0 }; }
                        }
                        const name = 'csrftoken';
                        let csrftoken = null;
                        try {
                            const cparts = document.cookie.split(';').map(s => s.trim()).filter(Boolean);
                            for (const p of cparts) { if (p.startsWith(name + '=')) { csrftoken = decodeURIComponent(p.split('=')[1]); break; } }
                        } catch (e) { csrftoken = null; }
                        const detailUrl = `/api/core/automation-report/${id}/`;
                        try { console.log('[automation] __automationFinalizeReport PATCH', detailUrl, computed); } catch (_e) { }
                        const resp = await fetch(detailUrl, {
                            method: 'PATCH',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json', ...(csrftoken ? { 'X-CSRFToken': csrftoken } : {}) },
                            body: JSON.stringify({ total_passed: Number(computed.passed || 0), total_failed: Number(computed.failed || 0), total_blocked: Number(computed.blocked || 0), finished: (new Date()).toISOString() }),
                        });
                        if (!resp) return null;
                        if (resp.status === 401) {
                            try { console.warn('[automation] __automationFinalizeReport unauthorized (401)'); } catch (_e) { }
                            return null;
                        }
                        let body = null;
                        try { body = await resp.json(); } catch (_e) { body = null; }
                        try { console.log('[automation] __automationFinalizeReport response', resp.status, body); } catch (_e) { }
                        return body;
                    } catch (err) {
                        try { console.warn('[automation] __automationFinalizeReport error', err); } catch (_e) { }
                        return null;
                    }
                };
            }
        }
    } catch (_e) { /* ignore helper install errors */ }

    function createModal() {
        // remove existing if present
        const existing = document.getElementById('testcase-multi-response-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.className = 'modal multi-run';
        modal.id = 'testcase-multi-response-modal';
        modal.setAttribute('aria-hidden', 'true');
        modal.tabIndex = -1;

        modal.innerHTML = `
            <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="testcase-multi-response-title">
                <div class="modal-header">
                    <h3 id="testcase-multi-response-title">Run Selected Test Cases</h3>
                    <span id="automation-report-badge" style="margin-left:1rem;font-size:0.9rem;color:#666">Report: none</span>
                    <button type="button" id="testcase-multi-response-close" class="modal-close" aria-label="Close">×</button>
                </div>
                <div class="modal-body">
                    <div id="testcase-multi-totals" class="multi-totals" style="margin-bottom:0.5rem;">
                        <span class="count count-passed">Passed: <strong data-role="multi-total-passed">0</strong></span>
                        <span class="count count-failed" style="margin-left:1rem;">Failed: <strong data-role="multi-total-failed">0</strong></span>
                        <span class="count count-blocked" style="margin-left:1rem;">Blocked: <strong data-role="multi-total-blocked">0</strong></span>
                    </div>
                    <div id="testcase-multi-list" class="multi-list"></div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        // Proactively attempt to create an AutomationReport for this modal so
        // any code path that creates the modal will have an associated report.
        try {
            (async () => {
                try {
                    try { console.log('[automation] createModal invoked, attempting to create automation report'); } catch (_e) { }
                    if (typeof window !== 'undefined' && typeof window.__automationCreateReport === 'function') {
                        const id = await window.__automationCreateReport('ui-modal');
                        if (id) {
                            try { modal.__automation_report_id = Number(id); } catch (_e) { }
                            try { modal.dataset.automationReportId = String(id); } catch (_e) { }
                            try { window.__lastAutomationReportId = Number(id); } catch (_e) { }
                            try { const badge = modal.querySelector && modal.querySelector('#automation-report-badge'); if (badge) badge.textContent = `Report: ${String(id)}`; } catch (_e) { }
                            try { console.log('[automation] createModal created automation report', id); } catch (_e) { }
                        }
                    } else {
                        try { console.log('[automation] __automationCreateReport helper not available'); } catch (_e) { }
                    }
                } catch (_e) { /* ignore create errors */ }
            })();
        } catch (_e) { /* ignore */ }
        return modal;
    }

    function openModal(modal) {
        if (!modal) return;
        // Save the element that had focus so we can restore it when the modal closes
        try {
            modal.__previouslyFocused = document.activeElement;
        } catch (e) {
            modal.__previouslyFocused = null;
        }
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');

        // Move focus into the modal. Prefer an element with autofocus, then the close button,
        // then the first focusable control. If none found, focus the modal container.
        try {
            const focusable = modal.querySelector('[autofocus]')
                || modal.querySelector('.modal-close')
                || modal.querySelector('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
            if (focusable && typeof focusable.focus === 'function') {
                focusable.focus();
            } else if (typeof modal.focus === 'function') {
                modal.focus();
            }
        } catch (err) {
            /* ignore focus errors */
        }
    }

    function updateModalTotals(modal) {
        try {
            if (!modal) return;
            const passedEl = modal.querySelector('[data-role="multi-total-passed"]');
            const failedEl = modal.querySelector('[data-role="multi-total-failed"]');
            const blockedEl = modal.querySelector('[data-role="multi-total-blocked"]');
            const items = Array.from(modal.querySelectorAll('.multi-item'));
            const counts = items.reduce((acc, it) => {
                const s = (it.dataset && it.dataset.status) ? String(it.dataset.status).toLowerCase() : 'queued';
                acc[s] = (acc[s] || 0) + 1;
                return acc;
            }, {});
            const passed = counts.passed || 0;
            const failed = counts.failed || 0;
            const blocked = counts.blocked || 0;
            if (passedEl) passedEl.textContent = String(passed);
            if (failedEl) failedEl.textContent = String(failed);
            if (blockedEl) blockedEl.textContent = String(blocked);
        } catch (_e) {
            /* ignore totals update errors */
        }
    }

    function collectAllScenarioTotals(modal) {
        try {
            const root = modal || document.getElementById('testcase-multi-response-modal') || document;
            const scenarioNodes = Array.from(root.querySelectorAll('.multi-scenario'));
            const result = { scenarios: [], totals: { passed: 0, failed: 0, blocked: 0, total: 0 } };
            scenarioNodes.forEach((sc) => {
                try {
                    const titleEl = sc.querySelector && sc.querySelector('.multi-scenario-title');
                    const title = titleEl ? (titleEl.textContent || '').trim() : '';
                    const id = sc.id || sc.getAttribute('data-scenario-id') || '';
                    let passed = Number.parseInt(sc.dataset && sc.dataset.passed ? sc.dataset.passed : '0', 10) || 0;
                    let failed = Number.parseInt(sc.dataset && sc.dataset.failed ? sc.dataset.failed : '0', 10) || 0;
                    let blocked = Number.parseInt(sc.dataset && sc.dataset.blocked ? sc.dataset.blocked : '0', 10) || 0;
                    // fallback: compute from child items when dataset attrs not present
                    if (typeof passed !== 'number' || typeof failed !== 'number' || typeof blocked !== 'number') {
                        passed = failed = blocked = 0;
                        const items = Array.from(sc.querySelectorAll('.multi-item'));
                        items.forEach((it) => {
                            const s = (it.dataset && it.dataset.status) ? String(it.dataset.status).toLowerCase() : 'queued';
                            if (s === 'passed') passed += 1;
                            else if (s === 'failed') failed += 1;
                            else if (s === 'blocked') blocked += 1;
                        });
                    }
                    const total = passed + failed + blocked;
                    result.scenarios.push({ id, title, passed, failed, blocked, total });
                    result.totals.passed += passed;
                    result.totals.failed += failed;
                    result.totals.blocked += blocked;
                    result.totals.total += total;
                } catch (_e) {
                    /* ignore per-scenario errors */
                }
            });
            return result;
        } catch (_e) {
            return { scenarios: [], totals: { passed: 0, failed: 0, blocked: 0, total: 0 } };
        }
    }

    function refreshScenarioCounts(modal) {
        try {
            const root = modal || document.getElementById('testcase-multi-response-modal') || document;
            const scenarioNodes = Array.from(root.querySelectorAll('.multi-scenario'));
            scenarioNodes.forEach((sc) => {
                try {
                    const items = Array.from(sc.querySelectorAll('.multi-item'));
                    const counts = items.reduce((acc, it) => {
                        const s = (it.dataset && it.dataset.status) ? String(it.dataset.status).toLowerCase() : 'queued';
                        acc[s] = (acc[s] || 0) + 1;
                        return acc;
                    }, {});
                    const order = ['passed', 'failed', 'blocked', 'skipped', 'queued', 'running'];
                    const parts = [];
                    order.forEach((key) => {
                        const n = counts[key] || 0;
                        if (key === 'passed' || key === 'failed' || n > 0) {
                            parts.push(`<span class="count count-${key}"><strong>${n}</strong> ${key}</span>`);
                        }
                    });
                    const countsEl = sc.querySelector && sc.querySelector('.multi-scenario-counts');
                    if (countsEl) countsEl.innerHTML = parts.join(' ');
                    try {
                        sc.dataset.passed = String(counts.passed || 0);
                        sc.dataset.failed = String(counts.failed || 0);
                        sc.dataset.blocked = String(counts.blocked || 0);
                    } catch (_e) { }
                } catch (_e) { /* ignore per-scenario errors */ }
            });
        } catch (_e) { /* ignore */ }
    }

    function closeModal(modal) {
        if (!modal) return;
        // Before hiding the modal (which sets aria-hidden), move focus away from any element
        // inside the modal to avoid the accessibility issue where a hidden ancestor contains
        // the currently focused element. Prefer restoring the previous focus; otherwise blur
        // the active element as a fallback.
        try {
            // If the currently focused element is inside the modal, blur it first.
            const active = document.activeElement;
            if (active && modal.contains(active) && typeof active.blur === 'function') {
                active.blur();
            }

            // Restore focus to the previously focused element if available.
            if (modal.__previouslyFocused && typeof modal.__previouslyFocused.focus === 'function') {
                modal.__previouslyFocused.focus();
            } else if (typeof document.body.focus === 'function') {
                // As a safe fallback, move focus to the document body.
                document.body.focus();
            }
        } catch (err) {
            /* ignore focus/blur errors */
        }

        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
    }

    function makeAccordionItem(caseId, caseTitle) {
        const idSafe = String(caseId).replace(/[^a-zA-Z0-9\-_]/g, '-');
        const headerId = `tc-${idSafe}-header`;
        const bodyId = `tc-${idSafe}-body`;
        const headersId = `testcase-response-headers-${idSafe}`;
        const bodyPreId = `testcase-response-body-${idSafe}`;
        const previewId = `testcase-response-preview-${idSafe}`;
        const preConsoleId = `testcase-pre-request-logs-${idSafe}`;
        const postConsoleId = `testcase-post-request-logs-${idSafe}`;
        const container = document.createElement('div');
        container.className = 'multi-item';
        container.innerHTML = `
            <div class="multi-item-header" id="${headerId}" role="button" aria-expanded="false" tabindex="0">
                <span class="multi-item-title">${escapeHtml(caseTitle || 'Untitled')}</span>
                <span class="multi-item-status" data-case-id="${caseId}">Queued</span>
            </div>
            <div class="multi-item-body" id="${bodyId}" hidden>
                <div class="response-loading">Running request…</div>
                <div class="response-content" hidden>
                    <div class="response-summary"></div>
                    <div class="response-section">
                        <div class="response-section__header">
                            <h4>Headers</h4>
                            <div class="response-section-controls">
                                <button type="button" class="action-button" data-action="toggle-section" data-target="${headersId}">Toggle</button>
                            </div>
                        </div>
                        <pre id="${headersId}" class="response-pre response-headers expandable" data-min-height="80">{}</pre>
                    </div>
                    <div class="response-section">
                        <div class="response-section__header">
                            <h4>Body</h4>
                            <div class="response-body__controls" role="group" aria-label="Response body view options">
                                <div class="response-body__views" role="group" aria-label="Format type">
                                    <button type="button" class="response-body__view-button is-active" data-response-body-view="json" aria-pressed="true">JSON</button>
                                    <button type="button" class="response-body__view-button" data-response-body-view="xml" aria-pressed="false">XML</button>
                                    <button type="button" class="response-body__view-button" data-response-body-view="html" aria-pressed="false">HTML</button>
                                </div>
                                <div class="response-body__modes" role="group" aria-label="Display mode">
                                    <button type="button" class="response-body__mode-button is-active" data-response-body-mode="pretty" aria-pressed="true">Pretty</button>
                                    <button type="button" class="response-body__mode-button" data-response-body-mode="preview" aria-pressed="false">Preview</button>
                                </div>
                            </div>
                        </div>
                        <div class="response-body__content">
                            <pre id="${bodyPreId}" class="response-pre response-body expandable" data-min-height="100">{}</pre>
                            <div class="resizer" data-resize-target="${bodyPreId}" title="Drag to resize"></div>
                            <iframe id="${previewId}" class="response-preview" title="Response preview" hidden></iframe>
                        </div>
                    </div>
                    <div class="response-section">
                        <h4>Assertions</h4>
                        <div class="assertions-list"></div>
                    </div>
                    <div class="response-section">
                        <div class="response-section__header">
                            <h4>Pre-request Console</h4>
                            <div class="response-section-controls">
                                <button type="button" class="action-button" data-action="toggle-section" data-target="${preConsoleId}">Toggle</button>
                            </div>
                        </div>
                        <pre id="${preConsoleId}" class="response-pre response-console expandable" data-min-height="60" data-console="pre">No pre-request console output.</pre>
                    </div>
                    <div class="response-section">
                        <div class="response-section__header">
                            <h4>Post-request Console</h4>
                            <div class="response-section-controls">
                                <button type="button" class="action-button" data-action="toggle-section" data-target="${postConsoleId}">Toggle</button>
                            </div>
                        </div>
                        <pre id="${postConsoleId}" class="response-pre response-console expandable" data-min-height="60" data-console="post">No post-request console output.</pre>
                    </div>
                </div>
            </div>
        `;

        // toggle handlers
        const header = container.querySelector('.multi-item-header');
        const body = container.querySelector('.multi-item-body');
        header.addEventListener('click', () => {
            const expanded = header.getAttribute('aria-expanded') === 'true';
            header.setAttribute('aria-expanded', expanded ? 'false' : 'true');
            if (expanded) { body.hidden = true; } else { body.hidden = false; }
        });
        header.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); header.click(); } });

        return container;
    }

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"']/g, function (m) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
        });
    }

    const stringifyConsoleArg = (value, seen) => {
        if (value === null || value === undefined) {
            return String(value);
        }
        const type = typeof value;
        if (type === 'string') {
            return value;
        }
        if (type === 'number' || type === 'boolean' || type === 'bigint') {
            return String(value);
        }
        if (value instanceof Error) {
            return value.stack || value.message || String(value);
        }
        if (type === 'function') {
            return `[function ${value.name || 'anonymous'}]`;
        }
        if (type === 'object') {
            if (seen && typeof seen.add === 'function') {
                if (seen.has(value)) {
                    return '[Circular]';
                }
                seen.add(value);
            }
            try {
                return JSON.stringify(value, null, 2);
            } catch (_error) {
                try {
                    return String(value);
                } catch (_err) {
                    return '[object Object]';
                }
            }
        }
        try {
            return String(value);
        } catch (_error) {
            return '';
        }
    };

    const formatConsoleEntry = (entry) => {
        if (!entry) {
            return null;
        }
        const level = typeof entry.level === 'string' ? entry.level.toUpperCase() : 'LOG';
        let args = [];
        if (Array.isArray(entry.args) && entry.args.length) {
            args = entry.args;
        } else if (entry && typeof entry === 'object') {
            if (Object.prototype.hasOwnProperty.call(entry, 'message')) {
                args = [entry.message];
            } else if (Object.prototype.hasOwnProperty.call(entry, 'msg')) {
                args = [entry.msg];
            } else if (Object.prototype.hasOwnProperty.call(entry, 'data')) {
                args = [entry.data];
            }
        }
        if (!args.length) {
            args = [entry];
        }
        const seen = typeof WeakSet === 'function' ? new WeakSet() : null;
        const parts = args
            .map((value) => stringifyConsoleArg(value, seen))
            .filter((value) => value !== null && value !== undefined && value !== '')
            .map((value) => String(value));
        const message = parts.join(' ');
        if (!message) {
            return `[${level}]`;
        }
        return `[${level}] ${message}`;
    };

    const setConsoleSection = (container, type, logs, extraMessages) => {
        if (!container) {
            return;
        }
        const selector = type === 'post' ? '[data-console="post"]' : '[data-console="pre"]';
        const el = container.querySelector(selector);
        if (!el) {
            return;
        }
        const normalizedLogs = Array.isArray(logs) ? logs : [];
        const extras = Array.isArray(extraMessages) ? extraMessages.filter(Boolean) : [];
        const lines = [];
        normalizedLogs.forEach((entry) => {
            const formatted = formatConsoleEntry(entry);
            if (formatted) {
                lines.push(formatted);
            }
        });
        extras.forEach((message) => {
            if (message && typeof message === 'string') {
                lines.push(message);
            }
        });
        if (lines.length) {
            el.textContent = lines.join('\n');
            el.dataset.hasLogs = 'true';
        } else {
            el.textContent = type === 'post' ? DEFAULT_POST_CONSOLE_MESSAGE : DEFAULT_PRE_CONSOLE_MESSAGE;
            el.dataset.hasLogs = 'false';
        }
    };

    function setPreRequestLogs(container, logs, extraMessages) {
        setConsoleSection(container, 'pre', logs, extraMessages);
    }

    function setPostRequestLogs(container, logs, extraMessages) {
        setConsoleSection(container, 'post', logs, extraMessages);
    }

    function splitPath(path) {
        if (!path) return [];
        const segments = [];
        String(path)
            .split('.')
            .map((segment) => segment.trim())
            .filter(Boolean)
            .forEach((segment) => {
                const bracketParts = segment.split(/\[|\]/).map((part) => part.trim()).filter(Boolean);
                if (bracketParts.length) {
                    bracketParts.forEach((part) => segments.push(part));
                } else {
                    segments.push(segment);
                }
            });
        return segments;
    }

    function getNestedValue(data, path) {
        const segments = splitPath(path);
        if (!segments.length) return undefined;
        let current = data;
        for (let i = 0; i < segments.length; i += 1) {
            if (current === null || current === undefined) return undefined;
            const segment = segments[i];
            if (Array.isArray(current)) {
                const index = Number(segment);
                if (Number.isNaN(index) || index < 0 || index >= current.length) {
                    return undefined;
                }
                current = current[index];
                continue;
            }
            if (typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, segment)) {
                current = current[segment];
            } else {
                return undefined;
            }
        }
        return current;
    }

    function sanitizeOverrideKey(path) {
        const segments = splitPath(path);
        if (!segments.length) return 'dependency_value';
        let candidate = segments[segments.length - 1].replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '');
        if (!candidate || /^\d+$/.test(candidate)) {
            candidate = segments
                .map((segment) => segment.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, ''))
                .filter(Boolean)
                .join('_');
        }
        return candidate || 'dependency_value';
    }

    function normalizeCaseId(value) {
        if (value === null || value === undefined) return null;
        const str = String(value).trim();
        if (!str) return null;
        const lower = str.toLowerCase();
        if (lower === 'none' || lower === 'null' || lower === 'undefined') return null;
        return str;
    }

    const fallbackCoerceExpectedResultValue = (raw) => {
        if (raw === null || raw === undefined) {
            return '';
        }
        if (typeof raw !== 'string') {
            return raw;
        }
        const trimmed = raw.trim();
        if (!trimmed) {
            return '';
        }
        if (/^(true|false)$/i.test(trimmed)) {
            return trimmed.toLowerCase() === 'true';
        }
        if (/^null$/i.test(trimmed)) {
            return null;
        }
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
            const num = Number(trimmed);
            if (!Number.isNaN(num)) {
                return num;
            }
        }
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
            try {
                return JSON.parse(trimmed);
            } catch (error) {
                // ignore parse failure; fall through to return string
            }
        }
        return trimmed;
    };

    const fallbackStringifyExpectedResultValue = (value) => {
        if (value === null) {
            return 'null';
        }
        if (value === undefined) {
            return '';
        }
        if (typeof value === 'string') {
            return value;
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        if (typeof value === 'object') {
            try {
                return JSON.stringify(value);
            } catch (error) {
                return String(value);
            }
        }
        return String(value);
    };

    const fallbackNormalizeExpectedResultsEntries = (value) => {
        if (!value && value !== 0) {
            return [];
        }
        let rawEntries = value;
        if (typeof value === 'string') {
            try {
                rawEntries = JSON.parse(value);
            } catch (error) {
                return [];
            }
        }
        if (!Array.isArray(rawEntries)) {
            return [];
        }
        const entries = [];
        rawEntries.forEach((entry) => {
            if (!entry && entry !== 0) {
                return;
            }
            if (typeof entry === 'string') {
                const trimmed = entry.trim();
                if (!trimmed) {
                    return;
                }
                let separatorIndex = trimmed.indexOf(':');
                if (separatorIndex === -1) {
                    separatorIndex = trimmed.indexOf('=');
                }
                if (separatorIndex > 0) {
                    const key = trimmed.slice(0, separatorIndex).trim();
                    if (!key) {
                        return;
                    }
                    const valuePart = trimmed.slice(separatorIndex + 1).trim();
                    entries.push({ [key]: fallbackCoerceExpectedResultValue(valuePart) });
                } else {
                    entries.push({ note: trimmed });
                }
                return;
            }
            if (Array.isArray(entry)) {
                entry.forEach((nested) => {
                    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
                        Object.keys(nested).forEach((key) => {
                            if (key === 'note') {
                                entries.push({ note: nested[key] });
                            } else {
                                entries.push({ [key]: nested[key] });
                            }
                        });
                    }
                });
                return;
            }
            if (entry && typeof entry === 'object') {
                const keys = Object.keys(entry);
                if (!keys.length) {
                    return;
                }
                keys.forEach((key) => {
                    if (key === 'note') {
                        entries.push({ note: entry[key] });
                    } else {
                        entries.push({ [key]: entry[key] });
                    }
                });
            }
        });
        return entries;
    };

    const automationHelpers = window.__automationHelpers || {};

    if (typeof window !== 'undefined' && (window.__automationMultiDiagnostics === undefined || window.__automationMultiDiagnostics === null)) {
        window.__automationMultiDiagnostics = {};
    }
    if (typeof window !== 'undefined' && !Array.isArray(window.__automationMultiDiagnosticsLog)) {
        window.__automationMultiDiagnosticsLog = [];
    }
    const normalizeExpectedResultsEntries = automationHelpers.normalizeExpectedResultsEntries || fallbackNormalizeExpectedResultsEntries;
    const coerceExpectedResultValue = automationHelpers.coerceExpectedResultValue || fallbackCoerceExpectedResultValue;
    const stringifyExpectedResultValue = automationHelpers.stringifyExpectedResultValue || fallbackStringifyExpectedResultValue;

    const getScriptHelpers = () => {
        const helpers = window.__automationHelpers || {};
        if (!helpers || typeof helpers !== 'object') {
            return null;
        }
        return helpers.scriptRunner || null;
    };

    let scriptRunnerReadyPromise = null;

    const resolveScriptRunnerSource = () => {
        const hostWindow = typeof window !== 'undefined' ? window : null;
        if (hostWindow && typeof hostWindow.__automationScriptRunnerSrc === 'string') {
            const candidate = hostWindow.__automationScriptRunnerSrc.trim();
            if (candidate) {
                return candidate;
            }
        }
        const doc = typeof document !== 'undefined' ? document : null;
        if (doc) {
            const preload = doc.querySelector('script[data-automation-script-runner-src]');
            if (preload) {
                const attr = preload.getAttribute('data-src') || preload.getAttribute('src');
                if (attr && attr.trim()) {
                    return attr.trim();
                }
            }
        }
        return '/static/js/api_tester.js';
    };

    const ensureScriptRunnerReady = () => {
        const existing = getScriptHelpers();
        if (existing) {
            return Promise.resolve(existing);
        }
        if (scriptRunnerReadyPromise) {
            return scriptRunnerReadyPromise.then((helpers) => helpers || getScriptHelpers());
        }

        scriptRunnerReadyPromise = new Promise((resolve) => {
            const hostWindow = typeof window !== 'undefined' ? window : null;
            const doc = typeof document !== 'undefined' ? document : null;
            let resolved = false;
            let pollTimer = null;

            const log = (level, message, extra) => {
                if (extra === undefined) {
                    mirrorAutomationLog(level, '[automation][testcase-multi-runner] ' + message);
                } else {
                    mirrorAutomationLog(level, '[automation][testcase-multi-runner] ' + message, extra);
                }
            };

            const clearPoll = () => {
                if (hostWindow && pollTimer !== null) {
                    hostWindow.clearInterval(pollTimer);
                    pollTimer = null;
                }
            };

            const finalize = () => {
                if (resolved) {
                    return;
                }
                resolved = true;
                clearPoll();
                log('info', 'Script runner helpers detected.');
                resolve(getScriptHelpers());
            };

            const fail = (reason) => {
                if (resolved) {
                    return;
                }
                resolved = true;
                clearPoll();
                log('warn', 'Script runner helpers unavailable' + (reason ? ` (${reason})` : '') + '.');
                resolve(null);
            };

            if (getScriptHelpers()) {
                finalize();
                return;
            }

            const src = resolveScriptRunnerSource();
            if (!src || !doc) {
                fail();
                return;
            }

            let scriptEl = doc.querySelector('script[data-automation-script-runner]');
            if (!scriptEl) {
                scriptEl = doc.createElement('script');
                scriptEl.src = src;
                scriptEl.async = false;
                scriptEl.setAttribute('data-automation-script-runner', 'true');
                scriptEl.addEventListener('load', () => {
                    if (getScriptHelpers()) {
                        finalize();
                    } else {
                        log('warn', 'Script runner script loaded but helpers not registered yet.');
                    }
                }, { once: true });
                scriptEl.addEventListener('error', () => {
                    fail('load-error');
                }, { once: true });
                const target = doc.head || doc.body || doc.documentElement;
                if (target) {
                    target.appendChild(scriptEl);
                } else {
                    fail('no-target');
                    return;
                }
            } else {
                scriptEl.addEventListener('load', () => {
                    if (getScriptHelpers()) {
                        finalize();
                    } else {
                        log('warn', 'Script runner script loaded but helpers not registered yet.');
                    }
                }, { once: true });
                scriptEl.addEventListener('error', () => fail('load-error'), { once: true });
            }

            if (hostWindow) {
                const checkInterval = 50;
                const maxWait = 5000;
                let elapsed = 0;
                pollTimer = hostWindow.setInterval(() => {
                    if (getScriptHelpers()) {
                        finalize();
                        return;
                    }
                    elapsed += checkInterval;
                    if (elapsed >= maxWait) {
                        fail('timeout');
                    }
                }, checkInterval);
            }
        }).then((helpers) => {
            if (!helpers) {
                scriptRunnerReadyPromise = null;
            }
            return helpers || getScriptHelpers();
        });

        return scriptRunnerReadyPromise;
    };

    ensureScriptRunnerReady().catch(() => { /* ignore preload errors */ });

    const clonePlainObject = (value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return {};
        }
        return { ...value };
    };

    const cloneJsonSafe = (value) => {
        if (value === null || value === undefined) {
            return value;
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_error) {
            return value;
        }
    };

    const safeCloneForDiagnostics = (value) => {
        if (value === undefined) {
            return undefined;
        }
        if (value === null) {
            return null;
        }
        try {
            if (typeof structuredClone === 'function') {
                return structuredClone(value);
            }
        } catch (_error) { /* ignore structuredClone issues */ }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_jsonError) {
            const seen = typeof WeakSet === 'function' ? new WeakSet() : null;
            const cloneValue = (input, depth) => {
                if (input === undefined) {
                    return undefined;
                }
                if (input === null) {
                    return null;
                }
                const type = typeof input;
                if (type === 'string' || type === 'number' || type === 'boolean') {
                    return input;
                }
                if (type === 'bigint') {
                    return input.toString();
                }
                if (type === 'function' || type === 'symbol') {
                    try {
                        return input.toString();
                    } catch (_stringifyError) {
                        return null;
                    }
                }
                if (input instanceof Date) {
                    return new Date(input.getTime());
                }
                if (input instanceof RegExp) {
                    return input.toString();
                }
                if (!input || type !== 'object') {
                    return input;
                }
                if (seen) {
                    if (seen.has(input)) {
                        return '[Circular]';
                    }
                    seen.add(input);
                }
                if (depth > 20) {
                    return '[MaxDepth]';
                }
                if (Array.isArray(input)) {
                    return input.map((item) => cloneValue(item, depth + 1));
                }
                if (typeof Map !== 'undefined' && input instanceof Map) {
                    const mapClone = {};
                    input.forEach((mapValue, mapKey) => {
                        const keyString = typeof mapKey === 'string' ? mapKey : cloneValue(mapKey, depth + 1);
                        mapClone[String(keyString)] = cloneValue(mapValue, depth + 1);
                    });
                    return mapClone;
                }
                if (typeof Set !== 'undefined' && input instanceof Set) {
                    const setClone = [];
                    input.forEach((item) => {
                        setClone.push(cloneValue(item, depth + 1));
                    });
                    return setClone;
                }
                if (typeof ArrayBuffer !== 'undefined') {
                    if (input instanceof ArrayBuffer) {
                        return input.slice(0);
                    }
                    if (typeof ArrayBuffer.isView === 'function' && ArrayBuffer.isView(input)) {
                        try {
                            return Array.from(new Uint8Array(input.buffer.slice(0)));
                        } catch (_typedArrayError) {
                            return Array.from(input);
                        }
                    }
                }
                const entries = Object.keys(input);
                const output = {};
                entries.forEach((key) => {
                    output[key] = cloneValue(input[key], depth + 1);
                });
                return output;
            };
            try {
                return cloneValue(value, 0);
            } catch (_fallbackError) {
                return null;
            }
        }
    };

    const snapshotForDiagnostics = (value) => {
        if (value === undefined) {
            return undefined;
        }
        if (value === null) {
            return null;
        }
        const cloned = safeCloneForDiagnostics(value);
        if (cloned !== undefined && cloned !== null) {
            return cloned;
        }
        try {
            return cloneJsonSafe(value);
        } catch (_cloneError) {
            return value;
        }
    };

    const normalizeDiagnosticsValue = (value) => {
        const snapshot = snapshotForDiagnostics(value);
        return snapshot === undefined ? null : snapshot;
    };

    const publishMultiRunDiagnostics = ({
        container,
        requestId,
        payload,
        requestSnapshot,
        scriptContext,
        scriptStores,
        overrides,
        stage,
    }) => {
        try {
            let diagKey = null;
            if (container && container.dataset) {
                if (container.dataset.caseId) diagKey = container.dataset.caseId;
                else if (container.dataset.caseKey) diagKey = container.dataset.caseKey;
                else if (container.dataset.requestId) diagKey = container.dataset.requestId;
            }
            if (!diagKey && requestId !== undefined && requestId !== null) {
                diagKey = String(requestId);
            }
            if (!diagKey && container && container.id) {
                diagKey = container.id;
            }
            if (!diagKey) {
                diagKey = `multi-${Date.now()}`;
            }

            const preScriptSnapshot = scriptContext ? normalizeDiagnosticsValue(scriptContext) : null;
            const requestSnapshotClone = requestSnapshot ? normalizeDiagnosticsValue(requestSnapshot) : null;
            const payloadClone = normalizeDiagnosticsValue(payload);
            const storeClone = scriptStores ? normalizeDiagnosticsValue(scriptStores) : null;
            const overridesClone = overrides ? normalizeDiagnosticsValue(overrides) : null;

            const existingDiagnostics = window.__automationMultiDiagnostics;
            const globalDiagnostics = (existingDiagnostics && typeof existingDiagnostics === 'object') ? existingDiagnostics : {};
            globalDiagnostics[diagKey] = {
                preScript: preScriptSnapshot,
                request: requestSnapshotClone,
                payload: payloadClone,
                scriptStores: storeClone,
                overrides: overridesClone,
                stage: stage || 'unknown',
                timestamp: Date.now(),
            };
            globalDiagnostics.__last = Object.assign({ key: diagKey }, globalDiagnostics[diagKey]);
            window.__automationMultiDiagnostics = globalDiagnostics;

            try {
                const log = window.__automationMultiDiagnosticsLog;
                if (Array.isArray(log)) {
                    log.push({
                        key: diagKey,
                        stage: stage || 'unknown',
                        timestamp: Date.now(),
                        payload: payloadClone,
                        request: requestSnapshotClone,
                        stores: storeClone,
                        overrides: overridesClone,
                    });
                    while (log.length > 100) {
                        log.shift();
                    }
                }
            } catch (_logError) { /* ignore */ }
        } catch (_error) {
            // ignore diagnostics publication errors
        }
    };

    const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

    const escapeTemplatePattern = (key) => {
        if (typeof key !== 'string') {
            return '';
        }
        return key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    };

    const getLookupValueFromStores = (stores, key) => {
        if (!key || !Array.isArray(stores)) {
            return undefined;
        }
        for (let i = 0; i < stores.length; i += 1) {
            const store = stores[i];
            if (store && Object.prototype.hasOwnProperty.call(store, key)) {
                return store[key];
            }
        }
        return undefined;
    };

    const replaceStringPlaceholders = (value, stores) => {
        if (typeof value !== 'string' || !value) {
            return value;
        }
        if (!Array.isArray(stores) || !stores.length) {
            return value;
        }
        return value.replace(PLACEHOLDER_PATTERN, (match, key) => {
            const lookupValue = getLookupValueFromStores(stores, key);
            if (lookupValue === undefined) {
                return match;
            }
            if (lookupValue === null) {
                return '';
            }
            if (typeof lookupValue === 'string') {
                return lookupValue;
            }
            try {
                return JSON.stringify(lookupValue);
            } catch (_error) {
                return String(lookupValue);
            }
        });
    };

    const replacePlaceholdersDeep = (value, stores) => {
        if (!Array.isArray(stores) || !stores.length) {
            return value;
        }
        if (typeof value === 'string') {
            return replaceStringPlaceholders(value, stores);
        }
        if (Array.isArray(value)) {
            return value.map((item) => replacePlaceholdersDeep(item, stores));
        }
        if (value && typeof value === 'object') {
            const next = Array.isArray(value) ? [] : {};
            Object.keys(value).forEach((key) => {
                next[key] = replacePlaceholdersDeep(value[key], stores);
            });
            return next;
        }
        return value;
    };

    const ensureRawPayloadPlaceholdersResolved = (target, stores, scriptHelpers) => {
        if (!target || typeof target !== 'object') {
            return;
        }
        if (!Array.isArray(stores) || !stores.length) {
            return;
        }
        Object.keys(target).forEach((key) => {
            target[key] = replacePlaceholdersDeep(target[key], stores);
        });
        if (!scriptHelpers || typeof scriptHelpers.collectJsonTemplatePlaceholders !== 'function' || typeof scriptHelpers.setValueAtObjectPath !== 'function') {
            return;
        }
        try {
            const references = scriptHelpers.collectJsonTemplatePlaceholders(target) || [];
            if (!Array.isArray(references) || !references.length) {
                return;
            }
            references.forEach((ref) => {
                if (!ref || !ref.key) {
                    return;
                }
                const lookupValue = getLookupValueFromStores(stores, ref.key);
                if (lookupValue === undefined) {
                    return;
                }
                try {
                    scriptHelpers.setValueAtObjectPath(target, ref.path || ref.key, lookupValue);
                } catch (_setError) {
                    // ignore
                }
            });
        } catch (_error) {
            // ignore collection issues
        }
    };

    const enforceRawStringPlaceholders = (raw, stores, scriptHelpers) => {
        if (typeof raw !== 'string' || !raw) {
            return raw;
        }
        if (!Array.isArray(stores) || !stores.length) {
            return raw;
        }

        let result = replaceStringPlaceholders(raw, stores);
        if (scriptHelpers && typeof scriptHelpers.resolveTemplateWithLookups === 'function') {
            try {
                result = scriptHelpers.resolveTemplateWithLookups(result, stores);
            } catch (_error) {
                // best effort
            }
        }

        const placeholderKeys = new Set();
        stores.forEach((store) => {
            if (!store || typeof store !== 'object') {
                return;
            }
            Object.keys(store).forEach((key) => {
                if (key) {
                    placeholderKeys.add(key);
                }
            });
        });

        placeholderKeys.forEach((key) => {
            const value = getLookupValueFromStores(stores, key);
            if (value === undefined) {
                return;
            }
            const pattern = new RegExp(`\\{\\{\\s*${escapeTemplatePattern(key)}\\s*\\}}`, 'g');
            try {
                if (value === null) {
                    result = result.replace(pattern, '');
                } else if (typeof value === 'string') {
                    result = result.replace(pattern, value);
                } else {
                    result = result.replace(pattern, String(value));
                }
            } catch (_replaceError) {
                // ignore replacement failure
            }
        });

        return result;
    };

    const applyScriptContextToPayload = (payload, scriptContext, scriptHelpers) => {
        if (!payload || !scriptContext || !scriptHelpers) {
            return null;
        }

        const overrides = scriptContext.overrides && typeof scriptContext.overrides === 'object'
            ? { ...scriptContext.overrides }
            : {};
        const localStore = clonePlainObject(scriptContext.localVariables);
        const environmentStore = clonePlainObject(scriptContext.environmentVariables);
        const lookupStores = [localStore, environmentStore, overrides].filter((store) => store && Object.keys(store).length);

        if (!lookupStores.length) {
            return { overrides, stores: lookupStores };
        }

        const getLookupValue = (key) => {
            if (!key) {
                return undefined;
            }
            for (let i = 0; i < lookupStores.length; i += 1) {
                const store = lookupStores[i];
                if (store && Object.prototype.hasOwnProperty.call(store, key)) {
                    return store[key];
                }
            }
            return undefined;
        };

        const escapeRegex = (value) => {
            if (typeof value !== 'string') {
                return '';
            }
            return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        };

        const resolveStringTemplate = (value) => {
            if (typeof value !== 'string') {
                return value;
            }
            if (typeof scriptHelpers.resolveTemplateWithLookups === 'function') {
                try {
                    return scriptHelpers.resolveTemplateWithLookups(value, lookupStores);
                } catch (_error) {
                    return value;
                }
            }
            return value;
        };

        const resolveStructureTemplates = (value) => {
            if (!value || typeof value !== 'object') {
                return value;
            }
            if (typeof scriptHelpers.resolveTemplatesDeep === 'function') {
                try {
                    return scriptHelpers.resolveTemplatesDeep(value, lookupStores);
                } catch (_error) {
                    return value;
                }
            }
            return value;
        };

        const enforceCollectedPlaceholders = (container) => {
            if (!container || typeof container !== 'object') {
                return;
            }
            if (typeof scriptHelpers.collectJsonTemplatePlaceholders !== 'function' || typeof scriptHelpers.setValueAtObjectPath !== 'function') {
                return;
            }
            try {
                const references = scriptHelpers.collectJsonTemplatePlaceholders(container) || [];
                references.forEach((ref) => {
                    if (!ref || !ref.key) {
                        return;
                    }
                    const lookupValue = getLookupValue(ref.key);
                    if (lookupValue === undefined) {
                        return;
                    }
                    try {
                        scriptHelpers.setValueAtObjectPath(container, ref.path || ref.key, lookupValue);
                    } catch (_setError) {
                        // ignore per-path failures
                    }
                });
            } catch (_error) {
                // ignore collection failures
            }
        };

        if (typeof payload.url === 'string') {
            payload.url = resolveStringTemplate(payload.url);
        }

        if (payload.headers && typeof payload.headers === 'object' && !Array.isArray(payload.headers)) {
            const nextHeaders = {};
            Object.entries(payload.headers).forEach(([key, value]) => {
                if (typeof value === 'string') {
                    nextHeaders[key] = resolveStringTemplate(value);
                } else if (value === undefined || value === null) {
                    nextHeaders[key] = value;
                } else {
                    nextHeaders[key] = resolveStringTemplate(String(value));
                }
            });
            payload.headers = nextHeaders;
        }

        if (payload.params && typeof payload.params === 'object' && !Array.isArray(payload.params)) {
            const nextParams = {};
            Object.entries(payload.params).forEach(([key, value]) => {
                if (typeof value === 'string') {
                    nextParams[key] = resolveStringTemplate(value);
                } else if (value === undefined || value === null) {
                    nextParams[key] = value;
                } else {
                    nextParams[key] = resolveStringTemplate(String(value));
                }
            });
            payload.params = nextParams;
        }

        if (Array.isArray(payload.form_data)) {
            payload.form_data = payload.form_data.map((entry) => {
                if (!entry || typeof entry !== 'object') {
                    return entry;
                }
                if (entry.type === 'file') {
                    return entry;
                }
                const nextEntry = { ...entry };
                const rawValue = entry.value === undefined || entry.value === null ? '' : entry.value;
                nextEntry.value = resolveStringTemplate(typeof rawValue === 'string' ? rawValue : String(rawValue));
                return nextEntry;
            });
        }

        if (payload.json && typeof payload.json === 'object') {
            const clonedJson = cloneJsonSafe(payload.json);
            payload.json = resolveStructureTemplates(clonedJson);
            enforceCollectedPlaceholders(payload.json);
        }

        if (payload.body && typeof payload.body === 'object' && !Array.isArray(payload.body)) {
            const clonedBody = cloneJsonSafe(payload.body);
            payload.body = resolveStructureTemplates(clonedBody);
            enforceCollectedPlaceholders(payload.body);
        } else if (typeof payload.body === 'string') {
            payload.body = resolveStringTemplate(payload.body);
            if (payload.body && typeof scriptHelpers.resolveTemplateWithLookups === 'function') {
                const refs = typeof scriptHelpers.collectJsonTemplatePlaceholders === 'function'
                    ? scriptHelpers.collectJsonTemplatePlaceholders({ __body: payload.body })
                    : [];
                if (Array.isArray(refs) && refs.length) {
                    refs.forEach((ref) => {
                        if (!ref || !ref.key) {
                            return;
                        }
                        const value = getLookupValue(ref.key);
                        if (value === undefined) {
                            return;
                        }
                        const patternSource = String.raw`\{\{\s*${escapeRegex(ref.key)}\s*\}\}`;
                        const pattern = new RegExp(patternSource, 'g');
                        try {
                            payload.body = payload.body.replace(pattern, typeof value === 'string' ? value : String(value));
                        } catch (_replaceError) {
                            // ignore string replacement issues
                        }
                    });
                }
            }
        }

        return { overrides, stores: lookupStores };
    };

    const buildScriptRequestSnapshot = (requestObj, scriptHelpers) => {
        const snapshot = {
            method: requestObj && requestObj.method ? requestObj.method : 'GET',
            url: requestObj && requestObj.url ? requestObj.url : '',
            headers: requestObj && requestObj.headers && typeof requestObj.headers === 'object'
                ? { ...requestObj.headers }
                : {},
            body: {
                mode: 'none',
                raw: '',
                rawType: 'text',
                json: null,
                formData: [],
                urlencoded: {},
            },
        };

        const bodyType = requestObj && requestObj.body_type ? String(requestObj.body_type).toLowerCase() : 'none';
        if (bodyType === 'json') {
            snapshot.body.mode = 'raw';
            snapshot.body.rawType = 'json';
            const jsonPayload = requestObj && requestObj.body_json && typeof requestObj.body_json === 'object'
                ? requestObj.body_json
                : {};
            snapshot.body.json = jsonPayload;
            try {
                snapshot.body.raw = JSON.stringify(jsonPayload);
            } catch (error) {
                snapshot.body.raw = '';
            }
        } else if (bodyType === 'form') {
            snapshot.body.mode = 'form-data';
            const formEntries = [];
            if (requestObj && requestObj.body_form && typeof requestObj.body_form === 'object') {
                Object.entries(requestObj.body_form).forEach(([key, value]) => {
                    formEntries.push({ key, type: 'text', value });
                });
            }
            snapshot.body.formData = formEntries;
        } else if (bodyType === 'raw') {
            snapshot.body.mode = 'raw';
            snapshot.body.rawType = requestObj && requestObj.body_raw_type ? requestObj.body_raw_type : 'text';
            snapshot.body.raw = requestObj && requestObj.body_raw ? requestObj.body_raw : '';
            if (snapshot.body.rawType === 'json' && snapshot.body.raw) {
                try {
                    snapshot.body.json = JSON.parse(snapshot.body.raw);
                } catch (error) {
                    snapshot.body.json = null;
                }
            }
        }

        if (scriptHelpers && typeof scriptHelpers.createCoercibleRequestBody === 'function') {
            snapshot.body = scriptHelpers.createCoercibleRequestBody(snapshot.body);
        }

        return snapshot;
    };

    const buildFallbackScriptResponseSnapshot = (payload, response, rawBody = '') => {
        const resultPayload = payload && typeof payload === 'object' ? payload : {};
        let headers = {};
        if (resultPayload && typeof resultPayload.headers === 'object' && resultPayload.headers !== null) {
            headers = { ...resultPayload.headers };
        } else if (resultPayload && typeof resultPayload.response_headers === 'object' && resultPayload.response_headers !== null) {
            headers = { ...resultPayload.response_headers };
        } else if (response && response.headers && typeof response.headers.forEach === 'function') {
            const collected = {};
            try {
                response.headers.forEach((value, key) => {
                    collected[key] = value;
                });
            } catch (error) {
                // ignore header collection issues
            }
            headers = collected;
        }

        let bodyText = '';
        if (typeof resultPayload.body === 'string') {
            bodyText = resultPayload.body;
        } else if (typeof rawBody === 'string' && rawBody) {
            bodyText = rawBody;
        }

        let jsonData = null;
        if (resultPayload && Object.prototype.hasOwnProperty.call(resultPayload, 'json')) {
            jsonData = resultPayload.json;
        } else if (bodyText) {
            const trimmed = bodyText.trim();
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                try {
                    jsonData = JSON.parse(bodyText);
                } catch (error) {
                    jsonData = null;
                }
            }
        }

        return {
            status: resultPayload.status_code
                ?? resultPayload.status
                ?? (response ? response.status : null),
            statusText: response ? response.statusText : '',
            headers,
            body: bodyText,
            json: jsonData,
            elapsed: resultPayload.elapsed_ms ?? resultPayload.response_time_ms ?? null,
            environment: resultPayload.environment ?? null,
            resolvedUrl: resultPayload.resolved_url ?? null,
            request: resultPayload.request ?? null,
            error: resultPayload.error ?? null,
        };
    };

    function describeAssertionValue(value) {
        if (value === undefined) {
            return 'undefined';
        }
        if (value === null) {
            return 'null';
        }
        if (typeof value === 'string') {
            return `${value} (string)`;
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return `${value} (${typeof value})`;
        }
        try {
            const serialized = JSON.stringify(value);
            const typeLabel = Array.isArray(value) ? 'array' : 'object';
            return `${serialized} (${typeLabel})`;
        } catch (error) {
            return String(value);
        }
    }

    const DECRYPTED_KEY_CANDIDATES = [
        'decrypteddata',
        'decryptedpayload',
        'decrypteddatabody',
        'decryptedresponse',
        'decryptedbody',
        'responsedecrypted',
        'bodydecrypted',
    ];

    function normalizeDecryptedKey(key) {
        if (!key && key !== 0) {
            return '';
        }
        return String(key)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '');
    }

    function parseDecryptedScalar(value) {
        if (value === null || value === undefined) {
            return null;
        }
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) {
                return null;
            }
            try {
                return JSON.parse(trimmed);
            } catch (_jsonError) {
                const lowered = trimmed.toLowerCase();
                if (lowered === 'true') {
                    return true;
                }
                if (lowered === 'false') {
                    return false;
                }
                if (lowered === 'null') {
                    return null;
                }
                const num = Number(trimmed);
                if (!Number.isNaN(num) && String(num) === trimmed) {
                    return num;
                }
                return trimmed;
            }
        }
        if (typeof value === 'object') {
            return value;
        }
        return value;
    }

    function tryParseDecryptedFromString(value) {
        if (typeof value !== 'string') {
            return undefined;
        }
        const trimmed = value.trim();
        if (!trimmed) {
            return undefined;
        }
        const lower = trimmed.toLowerCase();
        const hasKeyword = DECRYPTED_KEY_CANDIDATES.some((candidate) => {
            if (!candidate) {
                return false;
            }
            return lower.startsWith(candidate) || lower.includes(`${candidate}:`) || lower.includes(`${candidate}=`) || lower.includes(`"${candidate}`);
        });
        if (!hasKeyword) {
            return undefined;
        }
        const jsonMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        if (jsonMatch && jsonMatch[1]) {
            const parsed = parseDecryptedScalar(jsonMatch[1]);
            if (parsed !== null && parsed !== undefined && parsed !== '') {
                return parsed;
            }
        }
        const delimiterIndex = Math.max(trimmed.lastIndexOf(':'), trimmed.lastIndexOf('='));
        if (delimiterIndex !== -1 && delimiterIndex < trimmed.length - 1) {
            const tail = trimmed.slice(delimiterIndex + 1).trim();
            if (tail) {
                const parsed = parseDecryptedScalar(tail);
                if (parsed !== null && parsed !== undefined && parsed !== '') {
                    return parsed;
                }
            }
        }
        const parsedFallback = parseDecryptedScalar(trimmed);
        return (parsedFallback !== null && parsedFallback !== undefined && parsedFallback !== '') ? parsedFallback : undefined;
    }

    function findDecryptedValueInStore(store) {
        if (!store || typeof store !== 'object') {
            return undefined;
        }
        const entries = Object.keys(store);
        for (let i = 0; i < entries.length; i += 1) {
            const key = entries[i];
            const normalized = normalizeDecryptedKey(key);
            if (!normalized) {
                continue;
            }
            if (DECRYPTED_KEY_CANDIDATES.includes(normalized)) {
                const parsed = parseDecryptedScalar(store[key]);
                if (parsed !== null && parsed !== undefined && parsed !== '') {
                    return parsed;
                }
            }
        }
        return undefined;
    }

    function extractDecryptedPayload({ scriptContext, templatingStores, testsScript }) {
        const storesToInspect = [];
        if (scriptContext && typeof scriptContext === 'object') {
            if (scriptContext.localVariables && typeof scriptContext.localVariables === 'object') {
                storesToInspect.push(scriptContext.localVariables);
            }
            if (scriptContext.environmentVariables && typeof scriptContext.environmentVariables === 'object') {
                storesToInspect.push(scriptContext.environmentVariables);
            }
            if (scriptContext.overrides && typeof scriptContext.overrides === 'object') {
                storesToInspect.push(scriptContext.overrides);
            }
        }
        if (Array.isArray(templatingStores) && templatingStores.length) {
            templatingStores.forEach((store) => {
                if (store && typeof store === 'object') {
                    storesToInspect.push(store);
                }
            });
        }
        for (let i = 0; i < storesToInspect.length; i += 1) {
            const candidate = findDecryptedValueInStore(storesToInspect[i]);
            if (candidate !== undefined) {
                return candidate;
            }
        }
        if (testsScript && Array.isArray(testsScript.logs)) {
            for (let logIndex = 0; logIndex < testsScript.logs.length; logIndex += 1) {
                const entry = testsScript.logs[logIndex];
                if (!entry || !Array.isArray(entry.args)) {
                    continue;
                }
                const args = entry.args;
                for (let argIndex = 0; argIndex < args.length; argIndex += 1) {
                    const arg = args[argIndex];
                    if (typeof arg === 'string') {
                        const normalized = normalizeDecryptedKey(arg.replace(/[:]+$/, ''));
                        if (normalized && DECRYPTED_KEY_CANDIDATES.includes(normalized)) {
                            const nextArg = args[argIndex + 1];
                            const parsedNext = parseDecryptedScalar(nextArg);
                            if (parsedNext !== null && parsedNext !== undefined && parsedNext !== '') {
                                return parsedNext;
                            }
                        }
                        const parsedFromString = tryParseDecryptedFromString(arg);
                        if (parsedFromString !== undefined) {
                            return parsedFromString;
                        }
                        continue;
                    }
                    if (arg && typeof arg === 'object') {
                        const candidate = findDecryptedValueInStore(arg);
                        if (candidate !== undefined) {
                            return candidate;
                        }
                    }
                }
            }
        }
        return null;
    }

    function extractExpectedAssertions(entries) {
        const normalized = normalizeExpectedResultsEntries(entries);
        const assertions = [];
        normalized.forEach((entry) => {
            if (!entry || typeof entry !== 'object') {
                return;
            }
            Object.keys(entry).forEach((key) => {
                if (key === 'note') {
                    return;
                }
                const rawExpected = entry[key];
                const expectedValue = typeof rawExpected === 'string' ? coerceExpectedResultValue(rawExpected) : rawExpected;
                assertions.push({ path: key, expected: expectedValue });
            });
        });
        return assertions;
    }

    function deepEqual(left, right) {
        if (left === right) {
            return true;
        }
        if (left === null || right === null || left === undefined || right === undefined) {
            return left === right;
        }
        if (Number.isNaN(left) && Number.isNaN(right)) {
            return true;
        }
        if (typeof left !== typeof right) {
            return false;
        }
        if (Array.isArray(left) && Array.isArray(right)) {
            if (left.length !== right.length) {
                return false;
            }
            for (let i = 0; i < left.length; i += 1) {
                if (!deepEqual(left[i], right[i])) {
                    return false;
                }
            }
            return true;
        }
        if (typeof left === 'object' && typeof right === 'object') {
            const leftKeys = Object.keys(left);
            const rightKeys = Object.keys(right);
            if (leftKeys.length !== rightKeys.length) {
                return false;
            }
            for (let i = 0; i < leftKeys.length; i += 1) {
                const key = leftKeys[i];
                if (!Object.prototype.hasOwnProperty.call(right, key)) {
                    return false;
                }
                if (!deepEqual(left[key], right[key])) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    function valuesEqual(actual, expected) {
        if (actual === expected) {
            return true;
        }
        if ((actual === null || actual === undefined) || (expected === null || expected === undefined)) {
            return actual === expected;
        }
        const actualType = typeof actual;
        const expectedType = typeof expected;
        if (actualType !== expectedType) {
            if ((actualType === 'number' || actualType === 'boolean') && expectedType === 'string') {
                return String(actual) === expected;
            }
            if (actualType === 'string' && (expectedType === 'number' || expectedType === 'boolean')) {
                return actual === String(expected);
            }
            const actualNumber = Number(actual);
            const expectedNumber = Number(expected);
            if (!Number.isNaN(actualNumber) && !Number.isNaN(expectedNumber)) {
                return actualNumber === expectedNumber;
            }
            return false;
        }
        if (Array.isArray(actual) && Array.isArray(expected)) {
            return deepEqual(actual, expected);
        }
        if (actualType === 'object') {
            return deepEqual(actual, expected);
        }
        if (actualType === 'number') {
            if (Number.isNaN(actual) && Number.isNaN(expected)) {
                return true;
            }
        }
        return actual === expected;
    }

    function buildEvaluationContext(runResult) {
        const result = runResult && runResult.result ? runResult.result : {};
        const responseText = runResult && typeof runResult.responseText === 'string' ? runResult.responseText : '';
        const originalResponseData = (runResult && runResult.responseData !== undefined)
            ? runResult.responseData
            : (result && Object.prototype.hasOwnProperty.call(result, 'json') ? result.json : null);
        const decryptedCandidate = runResult && runResult.responseEncrypted
            ? parseDecryptedScalar(runResult.decryptedData)
            : null;
        const hasDecrypted = Boolean(runResult && runResult.responseEncrypted && decryptedCandidate !== null && decryptedCandidate !== undefined && decryptedCandidate !== '');
        const effectiveResponseData = hasDecrypted ? decryptedCandidate : originalResponseData;
        const headers = result && (result.headers || result.response_headers) ? (result.headers || result.response_headers) : {};
        const context = {
            status_code: runResult ? runResult.statusCode : undefined,
            status: runResult ? runResult.statusCode : undefined,
            elapsed_ms: runResult ? runResult.elapsed : undefined,
            response: {
                status_code: runResult ? runResult.statusCode : undefined,
                status: runResult ? runResult.statusCode : undefined,
                elapsed_ms: runResult ? runResult.elapsed : undefined,
                headers,
                body: responseText,
                text: responseText,
                json: effectiveResponseData,
                data: effectiveResponseData,
                original_json: originalResponseData,
            },
            headers,
            body: responseText,
            text: responseText,
            json: effectiveResponseData,
            data: effectiveResponseData,
            original_json: originalResponseData,
            result,
        };
        if (hasDecrypted) {
            context.response.decrypted_json = decryptedCandidate;
            context.decrypted = decryptedCandidate;
        }
        if (runResult && runResult.overridesApplied) {
            context.overrides = runResult.overridesApplied;
        }
        return context;
    }

    function evaluateExpectedResults(entries, runResult) {
        const assertions = extractExpectedAssertions(entries);
        if (!assertions.length) {
            return { evaluated: false, passed: true, assertions: [] };
        }
        const context = buildEvaluationContext(runResult);
        const details = assertions.map((assertion) => {
            const actual = getNestedValue(context, assertion.path);
            const expected = assertion.expected;
            const match = valuesEqual(actual, expected);
            return {
                path: assertion.path,
                expected,
                actual,
                passed: match,
                message: match ? 'Assertion passed.' : `Expected ${describeAssertionValue(expected)} but received ${describeAssertionValue(actual)}.`,
            };
        });
        const failures = details.filter((detail) => !detail.passed);
        const reason = failures.length ? (failures[0].message || `Expected results mismatch for "${failures[0].path}".`) : '';
        return {
            evaluated: true,
            passed: failures.length === 0,
            assertions: details,
            reason,
        };
    }

    function renderExpectedAssertions(container, evaluation) {
        if (!container) {
            return;
        }
        const assertionsEl = container.querySelector('.assertions-list');
        if (!assertionsEl) {
            return;
        }
        const existing = assertionsEl.querySelector('[data-origin="expected-results"]');
        if (existing) {
            existing.remove();
        }
        if (!evaluation || !evaluation.evaluated || !evaluation.assertions.length) {
            return;
        }
        const group = document.createElement('div');
        group.className = 'assertions-group assertions-group--expected';
        group.setAttribute('data-origin', 'expected-results');
        const heading = document.createElement('div');
        heading.className = 'assertions-group__title';
        heading.textContent = 'Expected Results';
        group.appendChild(heading);
        evaluation.assertions.forEach((assertion) => {
            const item = document.createElement('div');
            item.className = `assertion-item ${assertion.passed ? 'pass' : 'fail'}`;
            const meta = document.createElement('div');
            meta.className = 'assertion-meta';
            const keyLabel = document.createElement('strong');
            keyLabel.textContent = assertion.path;
            const expectedSpan = document.createElement('span');
            expectedSpan.textContent = `Expected: ${describeAssertionValue(assertion.expected)}`;
            const actualSpan = document.createElement('span');
            actualSpan.textContent = `Actual: ${describeAssertionValue(assertion.actual)}`;
            meta.appendChild(keyLabel);
            meta.appendChild(expectedSpan);
            meta.appendChild(actualSpan);
            item.appendChild(meta);
            group.appendChild(item);
        });
        assertionsEl.appendChild(group);
    }

    function applyEvaluationOutcome(container, evaluation) {
        if (!container) {
            return;
        }
        const statusEl = container.querySelector('.multi-item-status');
        const summaryEl = container.querySelector('.response-summary');
        if (summaryEl && !summaryEl.dataset.baseSummary) {
            summaryEl.dataset.baseSummary = summaryEl.textContent ? summaryEl.textContent.trim() : '';
        }
        renderExpectedAssertions(container, evaluation);
        if (evaluation && evaluation.evaluated) {
            const failedCount = evaluation.assertions.filter((detail) => !detail.passed).length;
            const total = evaluation.assertions.length;
            const suffix = failedCount ? `Assertions failed (${failedCount}/${total}).` : 'Assertions passed.';
            if (summaryEl) {
                const baseSummary = summaryEl.dataset.baseSummary || '';
                summaryEl.textContent = baseSummary ? `${baseSummary} · ${suffix}` : suffix;
            }
            if (statusEl) {
                statusEl.textContent = failedCount ? 'Failed' : 'Passed';
            }
            container.dataset.status = failedCount ? 'failed' : 'passed';
            try { const modal = container && container.closest ? container.closest('.modal') || document.getElementById('testcase-multi-response-modal') : document.getElementById('testcase-multi-response-modal'); updateModalTotals(modal); } catch (_e) { }
        } else {
            if (statusEl) {
                statusEl.textContent = 'Passed';
            }
            if (summaryEl) {
                const baseSummary = summaryEl.dataset.baseSummary || summaryEl.textContent.trim();
                summaryEl.textContent = baseSummary ? `${baseSummary} · Completed.` : 'Completed.';
            }
            container.dataset.status = 'passed';
            try { const modal = container && container.closest ? container.closest('.modal') || document.getElementById('testcase-multi-response-modal') : document.getElementById('testcase-multi-response-modal'); updateModalTotals(modal); } catch (_e) { }
        }
    }

    function markCaseStatus(container, statusText, summaryText) {
        if (!container) return;
        const statusEl = container.querySelector('.multi-item-status');
        if (statusEl && statusText !== undefined) statusEl.textContent = statusText;
        const loadingEl = container.querySelector('.response-loading');
        if (loadingEl) loadingEl.hidden = true;
        const contentEl = container.querySelector('.response-content');
        if (contentEl) contentEl.hidden = false;
        const summaryEl = container.querySelector('.response-summary');
        if (summaryEl && summaryText !== undefined) summaryEl.textContent = summaryText;
        const assertionsEl = container.querySelector('.assertions-list');
        if (assertionsEl) assertionsEl.innerHTML = '';
        const preview = container.querySelector('.response-preview');
        if (preview) preview.hidden = true;

        // Update the container dataset status if a clear mapping exists
        if (statusText) {
            const lower = String(statusText || '').toLowerCase();
            if (lower.indexOf('failed') !== -1) container.dataset.status = 'failed';
            else if (lower.indexOf('blocked') !== -1) container.dataset.status = 'blocked';
            else if (lower.indexOf('skipped') !== -1) container.dataset.status = 'skipped';
            else if (lower.indexOf('passed') !== -1) container.dataset.status = 'passed';
            else if (lower.indexOf('running') !== -1 || lower.indexOf('loading') !== -1) container.dataset.status = 'running';
        }

        // If this case belongs to a scenario group, update the parent scenario status aggregate
        try {
            const parent = container.closest && container.closest('.multi-scenario');
            if (parent) {
                updateScenarioStatus(parent);
            }
        } catch (_e) { /* ignore */ }
        try { const modal = container && container.closest ? container.closest('.modal') || document.getElementById('testcase-multi-response-modal') : document.getElementById('testcase-multi-response-modal'); updateModalTotals(modal); } catch (_e) { }
    }

    function updateScenarioStatus(parent) {
        if (!parent) return;
        try {
            const statusEl = parent.querySelector && parent.querySelector('.multi-scenario-status');
            const items = Array.from(parent.querySelectorAll('.multi-item'));
            if (!items.length) {
                if (statusEl) statusEl.textContent = '';
                return;
            }
            const statuses = items.map(it => (it.dataset && it.dataset.status) ? String(it.dataset.status).toLowerCase() : 'queued');

            const anyRunning = statuses.some(s => s === 'running' || s === 'loading');
            const anyQueued = statuses.some(s => s === 'queued');
            const anyFailed = statuses.some(s => s === 'failed');
            const anyBlocked = statuses.some(s => s === 'blocked');
            const anySkipped = statuses.some(s => s === 'skipped');
            const anyPassed = statuses.some(s => s === 'passed');

            let text = '';
            if (anyRunning) text = 'Running…';
            else if (anyQueued && !anyPassed && !anyFailed && !anyBlocked && anyQueued) text = 'Queued';
            else if (anyFailed) text = 'Failed';
            else if (anyBlocked) text = 'Blocked';
            else if (anySkipped && !anyPassed) text = 'Skipped';
            else if (anyPassed) text = 'Passed';
            else text = '';

            if (statusEl) statusEl.textContent = text;
            try { parent.dataset.status = (text || '').toLowerCase(); } catch (_e) { }

            // compute counts per state and render a compact counts label
            try {
                const countsEl = parent.querySelector && parent.querySelector('.multi-scenario-counts');
                if (countsEl) {
                    const counts = statuses.reduce((acc, s) => { acc[s] = (acc[s] || 0) + 1; return acc; }, {});
                    const order = ['passed', 'failed', 'blocked', 'skipped', 'queued', 'running'];
                    const parts = [];
                    order.forEach((key) => {
                        const n = counts[key] || 0;
                        // Always show 'passed' and 'failed' counts even if they are zero. Show other statuses only when non-zero.
                        if (key === 'passed' || key === 'failed' || n > 0) {
                            parts.push(`<span class="count count-${key}"><strong>${n}</strong> ${key}</span>`);
                        }
                    });
                    countsEl.innerHTML = parts.join(' ');
                    try {
                        // expose numeric counts as data attributes for easier consumption
                        parent.dataset.passed = String(counts.passed || 0);
                        parent.dataset.failed = String(counts.failed || 0);
                        parent.dataset.blocked = String(counts.blocked || 0);
                    } catch (_e) { /* ignore attribute set errors */ }
                }
            } catch (_e) { /* ignore counts render errors */ }
        } catch (_e) { /* ignore update errors */ }
        // If this scenario is contained within a module container, update the module aggregate
        try {
            const moduleParent = parent && parent.closest ? parent.closest('.multi-module') : null;
            if (moduleParent) updateModuleStatus(moduleParent);
        } catch (_e) { /* ignore */ }
    }

    function updateModuleStatus(moduleEl) {
        if (!moduleEl) return;
        try {
            const statusEl = moduleEl.querySelector && moduleEl.querySelector('.multi-module-status');
            const scenarios = Array.from(moduleEl.querySelectorAll('.multi-scenario'));
            if (!scenarios.length) {
                if (statusEl) statusEl.textContent = '';
                try { moduleEl.dataset.status = ''; } catch (_e) { }
                return;
            }
            const statuses = scenarios.map(s => (s.dataset && s.dataset.status) ? String(s.dataset.status).toLowerCase() : 'queued');
            const anyRunning = statuses.some(s => s === 'running' || s === 'loading');
            const anyQueued = statuses.some(s => s === 'queued');
            const anyFailed = statuses.some(s => s === 'failed');
            const anyBlocked = statuses.some(s => s === 'blocked');
            const anySkipped = statuses.some(s => s === 'skipped');
            const anyPassed = statuses.some(s => s === 'passed');

            let text = '';
            if (anyRunning) text = 'Running';
            else if (anyQueued && !anyPassed && !anyFailed && !anyBlocked && anyQueued) text = 'Queued';
            else if (anyFailed) text = 'Failed';
            else if (anyBlocked) text = 'Blocked';
            else if (anySkipped && !anyPassed) text = 'Skipped';
            else if (anyPassed) text = 'Passed';
            else text = '';

            if (statusEl) statusEl.textContent = text;
            try { moduleEl.dataset.status = (text || '').toLowerCase(); } catch (_e) { }

            // render counts per scenario status
            try {
                const countsEl = moduleEl.querySelector && moduleEl.querySelector('.multi-module-counts');
                if (countsEl) {
                    const counts = statuses.reduce((acc, s) => { acc[s] = (acc[s] || 0) + 1; return acc; }, {});
                    const order = ['passed', 'failed', 'blocked', 'skipped', 'queued', 'running'];
                    const parts = [];
                    order.forEach((key) => {
                        const n = counts[key] || 0;
                        if (key === 'passed' || key === 'failed' || n > 0) {
                            parts.push(`<span class="count count-${key}"><strong>${n}</strong> ${key}</span>`);
                        }
                    });
                    countsEl.innerHTML = parts.join(' ');
                }
            } catch (_e) { /* ignore counts render errors */ }
        } catch (_e) { /* ignore */ }
        // propagate to project level if present
        try {
            const projectParent = moduleEl && moduleEl.closest ? moduleEl.closest('.multi-project') : null;
            if (projectParent) updateProjectStatus(projectParent);
        } catch (_e) { /* ignore */ }
    }

    function updateProjectStatus(projectEl) {
        if (!projectEl) return;
        try {
            const statusEl = projectEl.querySelector && projectEl.querySelector('.multi-project-status');
            const modules = Array.from(projectEl.querySelectorAll('.multi-module'));
            if (!modules.length) {
                if (statusEl) statusEl.textContent = '';
                try { projectEl.dataset.status = ''; } catch (_e) { }
                return;
            }
            const statuses = modules.map(m => (m.dataset && m.dataset.status) ? String(m.dataset.status).toLowerCase() : 'queued');
            const anyRunning = statuses.some(s => s === 'running' || s === 'loading');
            const anyQueued = statuses.some(s => s === 'queued');
            const anyFailed = statuses.some(s => s === 'failed');
            const anyBlocked = statuses.some(s => s === 'blocked');
            const anySkipped = statuses.some(s => s === 'skipped');
            const anyPassed = statuses.some(s => s === 'passed');

            let text = '';
            if (anyRunning) text = 'Running';
            else if (anyQueued && !anyPassed && !anyFailed && !anyBlocked && anyQueued) text = 'Queued';
            else if (anyFailed) text = 'Failed';
            else if (anyBlocked) text = 'Blocked';
            else if (anySkipped && !anyPassed) text = 'Skipped';
            else if (anyPassed) text = 'Passed';
            else text = '';

            if (statusEl) statusEl.textContent = text;
            try { projectEl.dataset.status = (text || '').toLowerCase(); } catch (_e) { }

            try {
                const countsEl = projectEl.querySelector && projectEl.querySelector('.multi-project-counts');
                if (countsEl) {
                    const counts = statuses.reduce((acc, s) => { acc[s] = (acc[s] || 0) + 1; return acc; }, {});
                    const order = ['passed', 'failed', 'blocked', 'skipped', 'queued', 'running'];
                    const parts = [];
                    order.forEach((key) => {
                        const n = counts[key] || 0;
                        if (key === 'passed' || key === 'failed' || n > 0) {
                            parts.push(`<span class="count count-${key}"><strong>${n}</strong> ${key}</span>`);
                        }
                    });
                    countsEl.innerHTML = parts.join(' ');
                }
            } catch (_e) { /* ignore */ }
        } catch (_e) { /* ignore */ }
    }

    function markCaseFailed(container, reason, bodyText) {
        const summary = reason ? `Failed — ${reason}` : 'Failed';
        markCaseStatus(container, 'Failed', summary);
        const headersEl = container.querySelector('.response-headers');
        if (headersEl) headersEl.textContent = '{}';
        const bodyEl = container.querySelector('.response-body');
        if (bodyEl) bodyEl.textContent = bodyText !== undefined ? bodyText : (reason || '');
        container.dataset.status = 'failed';
        container._lastResponse = { text: '', json: null };
    }

    function markCaseBlocked(container, reason) {
        const summary = reason ? `Blocked — ${reason}` : 'Blocked';
        markCaseStatus(container, 'Blocked', summary);
        const headersEl = container.querySelector('.response-headers');
        if (headersEl) headersEl.textContent = '{}';
        const bodyEl = container.querySelector('.response-body');
        if (bodyEl) bodyEl.textContent = reason ? `Execution not attempted: ${reason}` : 'Execution not attempted.';
        container.dataset.status = 'blocked';
        container._lastResponse = { text: '', json: null };
    }

    function markCaseSkipped(container, reason) {
        const summary = reason ? `Skipped — ${reason}` : 'Skipped';
        markCaseStatus(container, 'Skipped', summary);
        const headersEl = container.querySelector('.response-headers');
        if (headersEl) headersEl.textContent = '{}';
        const bodyEl = container.querySelector('.response-body');
        if (bodyEl) bodyEl.textContent = reason || '';
        container.dataset.status = 'skipped';
        container._lastResponse = { text: '', json: null };
    }

    // Render response body for a specific panel (container)
    function renderPanel(container, view, mode) {
        if (!container) return;
        const last = container._lastResponse || { text: '', json: null };
        const pre = container.querySelector('.response-body');
        const preview = container.querySelector('.response-preview');
        if (!pre) return;
        view = view || (container.querySelector('.response-body__view-button.is-active') && container.querySelector('.response-body__view-button.is-active').getAttribute('data-response-body-view')) || 'json';
        mode = mode || (container.querySelector('.response-body__mode-button.is-active') && container.querySelector('.response-body__mode-button.is-active').getAttribute('data-response-body-mode')) || 'pretty';

        function setPreText(txt) { try { pre.textContent = txt == null ? '' : String(txt); } catch (e) { pre.textContent = String(txt || ''); } }

        switch (view) {
            case 'json':
                if (last.json) setPreText(JSON.stringify(last.json, null, 2));
                else {
                    try { setPreText(JSON.stringify(JSON.parse(last.text || ''), null, 2)); } catch (e) { setPreText(last.text || ''); }
                }
                if (preview) preview.hidden = true;
                break;
            case 'xml':
                try { const txt = last.text || ''; setPreText(txt.replace(/>(\s*)</g, '>' + '\n' + '<').trim()); } catch (e) { setPreText(last.text || ''); }
                if (preview) preview.hidden = true;
                break;
            case 'html':
                if (mode === 'preview') {
                    if (preview) {
                        try {
                            preview.hidden = false;
                            if ('srcdoc' in preview) {
                                preview.srcdoc = last.text || '';
                            } else if (preview.contentDocument) {
                                // fallback - avoid document.write if possible but keep fallback
                                try { preview.contentDocument.open(); preview.contentDocument.write(last.text || ''); preview.contentDocument.close(); } catch (e) { /* ignore */ }
                            }
                        } catch (e) { preview.hidden = true; }
                        setPreText((last.text || '').slice(0, 20000));
                    }
                } else {
                    setPreText(last.text || '');
                    if (preview) preview.hidden = true;
                }
                break;
            case 'pretty':
                if (last.json) setPreText(JSON.stringify(last.json, null, 2)); else setPreText(last.text || '');
                if (preview) preview.hidden = true;
                break;
            case 'raw':
                setPreText(last.text || '');
                if (preview) preview.hidden = true;
                break;
            case 'preview':
                if (preview) {
                    try {
                        preview.hidden = false;
                        if ('srcdoc' in preview) preview.srcdoc = last.text || '';
                        else if (preview.contentDocument) { preview.contentDocument.open(); preview.contentDocument.write(last.text || ''); preview.contentDocument.close(); }
                    } catch (e) { preview.hidden = true; }
                    setPreText((last.text || '').slice(0, 20000));
                }
                break;
            default:
                setPreText(last.text || '');
                if (preview) preview.hidden = true;
        }
    }

    async function executeForPanel(requestId, envId, container, options = {}) {
        const statusEl = container.querySelector('.multi-item-status');
        const loadingEl = container.querySelector('.response-loading');
        const contentEl = container.querySelector('.response-content');
        const summaryEl = container.querySelector('.response-summary');
        const headersEl = container.querySelector('.response-headers');
        const bodyEl = container.querySelector('.response-body');
        const assertionsEl = container.querySelector('.assertions-list');
        setPreRequestLogs(container, [], []);
        setPostRequestLogs(container, [], []);
        const dependencyOverrides = (options && (options.overrides || options.dependencyOverrides)) || null;
        const hasDependencyOverrides = Boolean(dependencyOverrides && typeof dependencyOverrides === 'object' && Object.keys(dependencyOverrides).length);

        container.__scriptContext = null;
        container.__scriptStores = null;

        if (!requestId) {
            markCaseSkipped(container, 'No related API request configured.');
            return { success: false, errorSummary: 'No related API request', blockChain: false };
        }

        if (statusEl) statusEl.textContent = 'Loading request details…';
        try { container.dataset.status = 'running'; } catch (_e) { }
        // notify parent scenario to refresh its aggregate status immediately
        try {
            const parent = container && container.closest ? container.closest('.multi-scenario') : null;
            if (parent) updateScenarioStatus(parent);
        } catch (_e) { /* ignore */ }
        if (loadingEl) loadingEl.hidden = false;
        if (contentEl) contentEl.hidden = true;

        let requestObj = null;
        try {
            const requestsBase = endpoints.requests || '/api/core/requests/';
            const reqUrl = requestsBase.endsWith('/') ? `${requestsBase}${requestId}/` : `${requestsBase}/${requestId}/`;
            const reqResp = await fetch(reqUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
            if (!reqResp.ok) throw new Error('Unable to load request');
            requestObj = await reqResp.json();
        } catch (err) {
            const message = String(err || 'Failed to load request details');
            markCaseFailed(container, 'Unable to load request details.', message);
            setPreRequestLogs(container, [], ['Unable to load request details.']);
            setPostRequestLogs(container, [], []);
            return { success: false, errorSummary: message, blockChain: true };
        }

        if (statusEl) statusEl.textContent = 'Running…';
        try { container.dataset.status = 'running'; } catch (_e) { }
        try {
            const parent = container && container.closest ? container.closest('.multi-scenario') : null;
            if (parent) updateScenarioStatus(parent);
        } catch (_e) { /* ignore */ }

        const payload = { request_id: requestId };
        if (envId !== undefined && envId !== null && String(envId).trim() !== '') {
            const trimmedEnv = String(envId).trim();
            const numericEnv = Number(trimmedEnv);
            if (!Number.isNaN(numericEnv) && trimmedEnv === String(numericEnv)) {
                payload.environment = numericEnv;
            } else {
                payload.environment = trimmedEnv;
            }
        }

        if (hasDependencyOverrides) {
            payload.overrides = { ...(payload.overrides || {}), ...dependencyOverrides };
        }

        // Attach automation_report_id when available (created at batch start)
        try {
            const modal = container && container.closest ? container.closest('.modal.multi-run') : null;
            const arId = (container && container.dataset && container.dataset.automationReportId) ? Number(container.dataset.automationReportId) : (modal && modal.__automation_report_id ? Number(modal.__automation_report_id) : null);
            if (arId) payload.automation_report_id = arId;
        } catch (_e) { /* ignore */ }

        let overridesApplied = hasDependencyOverrides ? { ...dependencyOverrides } : null;
        const scriptHelpers = await ensureScriptRunnerReady();
        let scriptContext = null;
        let requestSnapshot = null;
        let selectedEnvironment = null;
        let templatingResult = null;
        try {
            payload.method = requestObj.method || 'GET';
            payload.url = requestObj.url || '';
            payload.headers = requestObj.headers || {};
            payload.params = requestObj.query_params || {};

            if (requestObj.body_type === 'json' && requestObj.body_json) payload.json = requestObj.body_json;
            else if (requestObj.body_type === 'form' && requestObj.body_form) {
                const formEntries = [];
                Object.entries(requestObj.body_form || {}).forEach(([k, v]) => formEntries.push({ key: k, type: 'text', value: v }));
                payload.form_data = formEntries;
            } else if (requestObj.body_type === 'raw' && requestObj.body_raw) payload.body = requestObj.body_raw;

            if (typeof requestObj.timeout_ms === 'number') payload.timeout = Math.max(1, (requestObj.timeout_ms || 30000) / 1000);
            if (requestObj.collection_id) payload.collection_id = requestObj.collection_id;

            try {
                if (payload.environment === undefined || payload.environment === null || payload.environment === '') {
                    const btn = document.querySelector(`button[data-action="run-case"][data-request-id="${requestId}"]`);
                    const btnEnvId = btn ? btn.getAttribute('data-environment-id') : null;
                    if (btnEnvId) {
                        const parsedEnv = Number(btnEnvId);
                        payload.environment = Number.isFinite(parsedEnv) && btnEnvId === String(parsedEnv) ? parsedEnv : btnEnvId;
                    }
                }
            } catch (e) { /* ignore */ }

            const resolveTemplate = (v, vars) => {
                if (!v || typeof v !== 'string') return v;
                const m = v.match(/^\{\{\s*([\w\.\-]+)\s*\}\}$/);
                if (!m) return v;
                const key = m[1];
                if (vars && Object.prototype.hasOwnProperty.call(vars, key)) return vars[key];
                return v;
            };

            let collectionVars = null;
            if (requestObj.collection_id) {
                try {
                    const collectionsBase = endpoints.collections || '/api/core/collections/';
                    const colUrl = collectionsBase.endsWith('/') ? `${collectionsBase}${requestObj.collection_id}/` : `${collectionsBase}/${requestObj.collection_id}/`;
                    const colResp = await fetch(colUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
                    if (colResp.ok) {
                        const colData = await colResp.json();
                        const envs = Array.isArray(colData.environments) ? colData.environments : [];
                        if (envs.length) {
                            let chosenEnv = null;
                            try {
                                const btn = document.querySelector(`button[data-action="run-case"][data-request-id="${requestId}"]`);
                                const btnEnvId = btn ? btn.getAttribute('data-environment-id') : null;
                                if (btnEnvId) {
                                    const parsed = envs.find(e => String(e.id) === String(btnEnvId));
                                    if (parsed) chosenEnv = parsed;
                                }
                            } catch (e) { /* ignore */ }
                            if (!chosenEnv) chosenEnv = envs.find(e => e && e.variables && Object.prototype.hasOwnProperty.call(e.variables, 'non_realtime_mid') && Object.prototype.hasOwnProperty.call(e.variables, 'non_realtime_mkey')) || null;
                            if (!chosenEnv) chosenEnv = envs.find(e => e && e.variables && Object.prototype.hasOwnProperty.call(e.variables, 'non_realtime_mid')) || null;
                            if (!chosenEnv) chosenEnv = envs[0];
                            selectedEnvironment = chosenEnv;
                            collectionVars = chosenEnv ? (chosenEnv.variables || {}) : {};
                            if ((payload.environment === undefined || payload.environment === null || payload.environment === '') && chosenEnv && chosenEnv.id !== undefined && chosenEnv.id !== null) {
                                payload.environment = chosenEnv.id;
                            }
                        }
                    }
                } catch (e) { /* ignore */ }
            }

            if (hasDependencyOverrides) {
                if (collectionVars && typeof collectionVars === 'object') {
                    collectionVars = { ...collectionVars, ...dependencyOverrides };
                } else {
                    collectionVars = { ...dependencyOverrides };
                }
                if (selectedEnvironment && typeof selectedEnvironment === 'object') {
                    selectedEnvironment = {
                        ...selectedEnvironment,
                        variables: { ...(selectedEnvironment.variables || {}), ...dependencyOverrides },
                    };
                } else {
                    selectedEnvironment = {
                        id: payload.environment ?? null,
                        name: '',
                        variables: { ...dependencyOverrides },
                    };
                }
            }

            if (requestObj.auth_type === 'basic' && requestObj.auth_basic) {
                const ab = requestObj.auth_basic || {};
                const resolvedUsername = resolveTemplate(typeof ab.username === 'string' ? ab.username : '', collectionVars);
                const resolvedPassword = resolveTemplate(typeof ab.password === 'string' ? ab.password : '', collectionVars);
                if (resolvedUsername || resolvedPassword) {
                    try {
                        const token = btoa(`${resolvedUsername}:${resolvedPassword}`);
                        payload.headers = payload.headers || {};
                        payload.headers['Authorization'] = `Basic ${token}`;
                    } catch (e) { /* ignore */ }
                }
            }

            try {
                const transforms = requestObj.body_transforms || null;
                if (transforms && typeof transforms === 'object') {
                    const cloned = JSON.parse(JSON.stringify(transforms));
                    if (Array.isArray(cloned.overrides)) {
                        cloned.overrides = cloned.overrides.map((ov) => {
                            try {
                                if (ov && ov.isRandom) {
                                    let base = (ov.value === undefined || ov.value === null) ? '' : String(ov.value);
                                    if (base.length > 10) base = base.slice(0, 10);
                                    const now = new Date();
                                    const ms = String(now.getMilliseconds()).padStart(3, '0');
                                    let nano = '';
                                    if (typeof performance !== 'undefined' && performance.now) {
                                        const frac = performance.now();
                                        const nanos = Math.floor((frac % 1) * 1e6);
                                        nano = String(nanos).padStart(6, '0');
                                    }
                                    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}.${ms}${nano}`;
                                    let combined = `${base}${timestamp}`;
                                    const limit = Number.isFinite(Number(ov.charLimit)) && Number(ov.charLimit) > 0 ? Number(ov.charLimit) : null;
                                    if (limit) {
                                        if (combined.length > limit) {
                                            const allowedTimestampLen = Math.max(0, limit - String(base).length);
                                            const truncatedTimestamp = allowedTimestampLen > 0 ? timestamp.slice(0, allowedTimestampLen) : '';
                                            combined = `${base}${truncatedTimestamp}`;
                                        }
                                    }
                                    ov.value = combined;
                                    delete ov.isRandom;
                                    delete ov.charLimit;
                                }
                            } catch (e) { /* ignore */ }
                            return ov;
                        });
                    }
                    payload.body_transforms = cloned;
                }
            } catch (e) { /* ignore */ }

            if (requestObj.auth_type === 'bearer' && requestObj.auth_bearer) {
                const resolved = resolveTemplate(requestObj.auth_bearer, collectionVars);
                if (resolved) {
                    payload.headers = payload.headers || {};
                    payload.headers['Authorization'] = `Bearer ${resolved}`;
                }
            }
        } catch (e) {
            // ignore building errors and continue
        }

        publishMultiRunDiagnostics({
            container,
            requestId,
            payload,
            requestSnapshot,
            scriptContext: null,
            scriptStores: null,
            overrides: overridesApplied,
            stage: 'payload-built',
        });

        const preScriptText = requestObj && typeof requestObj.pre_request_script === 'string'
            ? requestObj.pre_request_script
            : '';
        if (preScriptText && preScriptText.trim() && (!scriptHelpers || typeof scriptHelpers.runPreRequestScript !== 'function')) {
            markCaseFailed(container, 'Pre-request script unavailable.', 'Unable to execute the pre-request script because the script runner helpers failed to load. Refresh the page and try again.');
            setPreRequestLogs(container, [], ['Pre-request script unavailable.']);
            setPostRequestLogs(container, [], []);
            return { success: false, errorSummary: 'Pre-request script unavailable.', blockChain: true };
        }
        if (preScriptText && preScriptText.trim() && scriptHelpers && typeof scriptHelpers.runPreRequestScript === 'function') {
            if (!requestSnapshot) {
                requestSnapshot = buildScriptRequestSnapshot(requestObj, scriptHelpers);
            }
            try {
                scriptContext = await scriptHelpers.runPreRequestScript(preScriptText, {
                    environmentId: payload.environment ?? null,
                    environmentSnapshot: selectedEnvironment,
                    requestSnapshot,
                });
                container.__scriptContext = scriptContext;
                if (scriptContext && Array.isArray(scriptContext.logs)) {
                    setPreRequestLogs(container, scriptContext.logs, []);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                markCaseFailed(container, `Pre-request script error.`, message);
                const contextLogs = scriptContext && Array.isArray(scriptContext.logs) ? scriptContext.logs : [];
                setPreRequestLogs(container, contextLogs, [`Pre-request script error: ${message}`]);
                setPostRequestLogs(container, [], []);
                return { success: false, errorSummary: message, blockChain: true };
            }
        } else if (!requestSnapshot) {
            requestSnapshot = buildScriptRequestSnapshot(requestObj, scriptHelpers);
            container.__scriptContext = null;
        }

        if (scriptContext) {
            templatingResult = applyScriptContextToPayload(payload, scriptContext, scriptHelpers);
            if (templatingResult && templatingResult.overrides && Object.keys(templatingResult.overrides).length) {
                payload.overrides = { ...(payload.overrides || {}), ...templatingResult.overrides };
                overridesApplied = { ...(overridesApplied || {}), ...templatingResult.overrides };
            }
            try {
                container.__scriptStores = templatingResult ? templatingResult.stores : null;
            } catch (_error) { /* ignore */ }

            publishMultiRunDiagnostics({
                container,
                requestId,
                payload,
                requestSnapshot,
                scriptContext,
                scriptStores: templatingResult ? templatingResult.stores : null,
                overrides: overridesApplied,
                stage: 'templating-applied',
            });
        }

        if (scriptContext && scriptHelpers && templatingResult) {
            try {
                if (payload.json && typeof payload.json === 'object') {
                    payload.json = replacePlaceholdersDeep(payload.json, templatingResult.stores);
                    ensureRawPayloadPlaceholdersResolved(payload.json, templatingResult.stores, scriptHelpers);
                }
                if (payload.body && typeof payload.body === 'object') {
                    payload.body = replacePlaceholdersDeep(payload.body, templatingResult.stores);
                    ensureRawPayloadPlaceholdersResolved(payload.body, templatingResult.stores, scriptHelpers);
                } else if (typeof payload.body === 'string') {
                    payload.body = enforceRawStringPlaceholders(payload.body, templatingResult.stores, scriptHelpers);
                }
            } catch (_error) { /* ignore */ }
        }

        if (scriptContext && Array.isArray(scriptContext.logs) && scriptContext.logs.length) {
            mirrorAutomationLog('info', '[automation][multi-runner] pre-request script logs', scriptContext.logs);
        }

        try {
            const lastPreScript = scriptContext ? normalizeDiagnosticsValue(scriptContext) : null;
            const lastRequestSnapshot = requestSnapshot ? normalizeDiagnosticsValue(requestSnapshot) : null;
            const lastPayload = normalizeDiagnosticsValue(payload);
            const lastStores = templatingResult ? normalizeDiagnosticsValue(templatingResult.stores) : null;
            const lastOverrides = overridesApplied ? normalizeDiagnosticsValue(overridesApplied) : null;

            container.__lastPreScript = lastPreScript;
            container.__lastRequestSnapshot = lastRequestSnapshot;
            container.__lastPayload = lastPayload;

            publishMultiRunDiagnostics({
                container,
                requestId,
                payload,
                requestSnapshot,
                scriptContext,
                scriptStores: templatingResult ? templatingResult.stores : null,
                overrides: overridesApplied,
                stage: 'pre-fetch',
            });
        } catch (_error) { /* ignore */ }

        if (dependencyOverrides && typeof dependencyOverrides === 'object' && Object.keys(dependencyOverrides).length) {
            payload.overrides = { ...(payload.overrides || {}), ...dependencyOverrides };
            overridesApplied = { ...(overridesApplied || {}), ...dependencyOverrides };
        }

        if (scriptContext && overridesApplied && Object.keys(overridesApplied).length) {
            scriptContext.overrides = {
                ...(scriptContext.overrides || {}),
                ...overridesApplied,
            };
        }

        let csrftoken = null;
        try {
            const name = 'csrftoken';
            const cparts = document.cookie.split(';').map(s => s.trim()).filter(Boolean);
            for (const p of cparts) { if (p.startsWith(name + '=')) { csrftoken = decodeURIComponent(p.split('=')[1]); break; } }
        } catch (e) { csrftoken = null; }

        try {
            // Attach an automation_report_id when available so server can link runs
            try {
                if (!payload.automation_report_id && typeof window !== 'undefined' && window.__lastAutomationReportId) {
                    payload.automation_report_id = Number(window.__lastAutomationReportId);
                }
            } catch (_e) { }
            const resp = await fetch(POST_URL, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', ...(csrftoken ? { 'X-CSRFToken': csrftoken } : {}) },
                body: JSON.stringify(payload),
            });

            const text = await resp.text();
            let data = null;
            try { data = JSON.parse(text); } catch (e) { data = null; }

            const result = data || {};
            if (scriptContext && Array.isArray(scriptContext.logs) && scriptContext.logs.length) {
                result.pre_request_logs = scriptContext.logs;
            }

            let scriptResponseSnapshot = null;
            if (scriptHelpers && typeof scriptHelpers.buildScriptResponseSnapshot === 'function') {
                try {
                    scriptResponseSnapshot = scriptHelpers.buildScriptResponseSnapshot({
                        payload: result,
                        response: resp,
                        rawBody: text,
                    });
                } catch (error) {
                    scriptResponseSnapshot = null;
                }
            }
            if (!scriptResponseSnapshot) {
                scriptResponseSnapshot = buildFallbackScriptResponseSnapshot(result, resp, text);
            }

            const postScriptText = requestObj && typeof requestObj.tests_script === 'string' ? requestObj.tests_script : '';
            if (postScriptText && postScriptText.trim() && scriptHelpers && typeof scriptHelpers.runTestsScript === 'function') {
                try {
                    const testsResult = await scriptHelpers.runTestsScript(postScriptText, {
                        environmentId: payload.environment ?? null,
                        environmentSnapshot: selectedEnvironment,
                        requestSnapshot,
                        responseSnapshot: scriptResponseSnapshot,
                        preContext: scriptContext,
                    });
                    if (testsResult && typeof testsResult === 'object') {
                        result.tests_script = {
                            tests: Array.isArray(testsResult.tests) ? testsResult.tests : [],
                            logs: Array.isArray(testsResult.logs) ? testsResult.logs : [],
                        };
                    }
                } catch (error) {
                    result.tests_script = {
                        tests: [],
                        logs: [],
                        error: error instanceof Error ? error.message : String(error),
                    };
                }
            }

            // capture automation_report id returned by server so we can finalize later
            try {
                if (result && (result.automation_report_id || result.automation_report)) {
                    const ar = result.automation_report_id || result.automation_report;
                    try { container.dataset.automationReportId = String(ar); } catch (e) { /* ignore */ }
                }
            } catch (_e) { /* ignore */ }

            if (!resp.ok) {
                const errorMessage = result && result.error ? String(result.error) : `HTTP ${resp.status}`;
                const bodyMessage = result && result.error ? String(result.error) : (text || '');
                markCaseFailed(container, errorMessage, bodyMessage);
                if (headersEl) headersEl.textContent = JSON.stringify(result && result.request_headers ? result.request_headers : {}, null, 2);
                if (bodyEl && !bodyEl.textContent) bodyEl.textContent = bodyMessage;
                const preLogsFailure = (result && Array.isArray(result.pre_request_logs)) ? result.pre_request_logs.slice() : (scriptContext && scriptContext.logs && Array.isArray(scriptContext.logs) ? scriptContext.logs.slice() : []);
                const postLogsFailure = [];
                if (result && result.tests_script && Array.isArray(result.tests_script.logs)) {
                    Array.prototype.push.apply(postLogsFailure, result.tests_script.logs);
                }
                if (result && Array.isArray(result.post_request_logs)) {
                    Array.prototype.push.apply(postLogsFailure, result.post_request_logs);
                }
                const postExtrasFailure = [];
                if (result && result.tests_script && result.tests_script.error) {
                    postExtrasFailure.push(`Tests script error: ${result.tests_script.error}`);
                }
                if (result && result.post_request_error) {
                    postExtrasFailure.push(`Post-request error: ${result.post_request_error}`);
                }
                setPreRequestLogs(container, preLogsFailure, []);
                setPostRequestLogs(container, postLogsFailure, postExtrasFailure);
                return {
                    success: false,
                    statusCode: resp.status,
                    errorSummary: errorMessage,
                    responseText: text,
                    responseData: result && result.json ? result.json : null,
                    overridesApplied,
                    blockChain: true,
                };
            }

            const statusCode = result.status_code || result.status || (result.response_status || null);
            const elapsed = result.elapsed_ms || result.response_time_ms || null;
            const resolvedUrl = result.resolved_url || (result.request && result.request.url) || '';
            if (summaryEl) summaryEl.textContent = 'Status: ' + (statusCode || '') + (elapsed ? (' — ' + Math.round(elapsed) + 'ms') : '') + (resolvedUrl ? (' — ' + resolvedUrl) : '');
            const headersObj = result.headers || result.response_headers || {};
            const bodyText = result.body || result.response_body || '';
            container._lastResponse = { text: typeof bodyText === 'string' ? bodyText : (JSON.stringify(bodyText) || ''), json: result.json || null };
            if (headersEl) headersEl.textContent = JSON.stringify(headersObj, null, 2);
            try { renderPanel(container); } catch (e) { /* ignore */ }

            if (assertionsEl) {
                assertionsEl.innerHTML = '';
                if (result.assertions_passed && result.assertions_passed.length) {
                    const ulPass = document.createElement('ul');
                    result.assertions_passed.forEach(a => { const li = document.createElement('li'); li.textContent = 'PASS: ' + (a || ''); ulPass.appendChild(li); });
                    assertionsEl.appendChild(ulPass);
                }
                if (result.assertions_failed && result.assertions_failed.length) {
                    const ulFail = document.createElement('ul');
                    result.assertions_failed.forEach(a => { const li = document.createElement('li'); li.textContent = 'FAIL: ' + (a || ''); ulFail.appendChild(li); });
                    assertionsEl.appendChild(ulFail);
                }
            }

            if (statusEl) statusEl.textContent = 'Complete';
            if (loadingEl) loadingEl.hidden = true;
            if (contentEl) contentEl.hidden = false;
            container.dataset.status = 'passed';

            let responseData = null;
            if (container._lastResponse && typeof container._lastResponse.json === 'object' && container._lastResponse.json !== null) {
                responseData = container._lastResponse.json;
            } else if (container._lastResponse && typeof container._lastResponse.text === 'string') {
                const trimmed = container._lastResponse.text.trim();
                if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                    try {
                        responseData = JSON.parse(trimmed);
                    } catch (e) {
                        responseData = null;
                    }
                }
            }

            const preLogsSuccess = (result && Array.isArray(result.pre_request_logs))
                ? result.pre_request_logs.slice()
                : (scriptContext && scriptContext.logs && Array.isArray(scriptContext.logs) ? scriptContext.logs.slice() : []);
            const postLogsSuccess = [];
            if (result && result.tests_script && Array.isArray(result.tests_script.logs)) {
                Array.prototype.push.apply(postLogsSuccess, result.tests_script.logs);
            }
            if (result && Array.isArray(result.post_request_logs)) {
                Array.prototype.push.apply(postLogsSuccess, result.post_request_logs);
            }
            const postExtrasSuccess = [];
            if (result && result.tests_script && result.tests_script.error) {
                postExtrasSuccess.push(`Tests script error: ${result.tests_script.error}`);
            }
            if (result && result.post_request_error) {
                postExtrasSuccess.push(`Post-request error: ${result.post_request_error}`);
            }
            setPreRequestLogs(container, preLogsSuccess, []);
            setPostRequestLogs(container, postLogsSuccess, postExtrasSuccess);

            return {
                success: true,
                statusCode,
                elapsed,
                responseData,
                responseText: container._lastResponse ? container._lastResponse.text : '',
                result,
                overridesApplied,
                blockChain: false,
            };
        } catch (err) {
            const message = String(err || 'Request error');
            markCaseFailed(container, 'Request execution error.', message);
            const preLogsCatch = scriptContext && scriptContext.logs && Array.isArray(scriptContext.logs) ? scriptContext.logs.slice() : [];
            setPreRequestLogs(container, preLogsCatch, []);
            setPostRequestLogs(container, [], [`Request error: ${message}`]);
            return { success: false, errorSummary: message, blockChain: true };
        }
    }

    function collectSelectedCases() {
        const boxes = Array.from(document.querySelectorAll('input.case-checkbox')).filter(b => b.checked);
        const cases = [];
        boxes.forEach((b, index) => {
            const tr = b.closest && b.closest('tr');
            const rawCaseId = b.getAttribute('data-case-id') || (tr && tr.getAttribute('data-case-id')) || null;
            const caseId = normalizeCaseId(rawCaseId);
            let title = '';
            if (tr) {
                // title is in the 3rd td (index 2)
                const tds = tr.querySelectorAll('td');
                if (tds && tds[2]) title = tds[2].textContent.trim();
            }
            // find related run-case button in the row
            let requestId = null;
            let envId = null;
            try {
                const btn = tr && tr.querySelector && tr.querySelector('button[data-action="run-case"]');
                if (btn) {
                    requestId = btn.getAttribute('data-request-id');
                    const envRaw = btn.getAttribute('data-environment-id');
                    envId = normalizeCaseId(envRaw) || envRaw;
                }
            } catch (e) { }
            const scenarioId = normalizeCaseId(tr && tr.getAttribute && tr.getAttribute('data-scenario-id'));
            const requiresDependencyAttr = tr && tr.getAttribute ? tr.getAttribute('data-requires-dependency') : null;
            const requiresDependency = requiresDependencyAttr === '1' || requiresDependencyAttr === 'true';
            const dependencyCaseId = normalizeCaseId(tr && tr.getAttribute && tr.getAttribute('data-dependency-id'));
            const dependencyKey = tr && tr.getAttribute ? (tr.getAttribute('data-dependency-key') || '').trim() : '';
            const expectedRaw = tr && tr.getAttribute ? tr.getAttribute('data-expected-results') : '';
            const expectedResults = normalizeExpectedResultsEntries(expectedRaw || []);
            let responseEncrypted = false;
            try {
                let attr = b.getAttribute('data-response-encrypted');
                if (attr === null || attr === undefined) {
                    attr = tr && tr.getAttribute ? tr.getAttribute('data-response-encrypted') : null;
                }
                if (attr !== null && attr !== undefined) {
                    responseEncrypted = String(attr).toLowerCase() === 'true';
                }
            } catch (_err) {
                responseEncrypted = false;
            }
            cases.push({
                caseId,
                rawCaseId,
                title,
                requestId,
                envId,
                scenarioId,
                requiresDependency,
                dependencyCaseId,
                dependencyKey,
                expectedResults,
                responseEncrypted,
                originalIndex: index,
            });
        });
        return cases;
    }

    function orderCasesByDependency(cases) {
        const byId = new Map();
        cases.forEach((caseInfo) => {
            caseInfo.caseId = normalizeCaseId(caseInfo.caseId || caseInfo.rawCaseId);
            caseInfo.caseKey = caseInfo.caseId || `__idx_${caseInfo.originalIndex}`;
            if (caseInfo.caseId) {
                byId.set(caseInfo.caseId, caseInfo);
            }
        });
        const ordered = [];
        const visited = new Set();
        const visiting = new Set();

        function visit(caseInfo) {
            if (!caseInfo) return;
            const key = caseInfo.caseKey;
            if (visited.has(key)) return;
            if (visiting.has(key)) return;
            visiting.add(key);
            const dependencyId = normalizeCaseId(caseInfo.dependencyCaseId);
            if (dependencyId && byId.has(dependencyId)) {
                visit(byId.get(dependencyId));
            }
            visiting.delete(key);
            visited.add(key);
            ordered.push(caseInfo);
        }

        cases.forEach(visit);
        return ordered;
    }

    function prepareDependencyOverrides(caseInfo, resultsByCaseId, caseInfoById) {
        if (!caseInfo.requiresDependency) {
            return { ready: true, overrides: null };
        }
        const dependencyId = normalizeCaseId(caseInfo.dependencyCaseId);
        if (!dependencyId) {
            return { ready: false, reason: 'Dependency test case not configured.' };
        }
        const dependencyResult = resultsByCaseId.get(dependencyId);
        const dependencyMeta = caseInfoById ? caseInfoById.get(dependencyId) : null;
        const dependencyLabel = dependencyMeta && dependencyMeta.title ? dependencyMeta.title : `case ${dependencyId}`;
        if (!dependencyResult || !dependencyResult.success) {
            return { ready: false, reason: `Dependency ${dependencyLabel} has not completed successfully.` };
        }
        const keyPath = (caseInfo.dependencyKey || '').trim();
        if (!keyPath) {
            return { ready: false, reason: 'Dependency response key is required for this test case.' };
        }
        let source = dependencyResult.responseData;
        if ((!source || typeof source !== 'object') && dependencyResult.responseText) {
            try {
                const trimmed = String(dependencyResult.responseText).trim();
                if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                    source = JSON.parse(trimmed);
                }
            } catch (e) {
                source = null;
            }
        }
        const value = getNestedValue(source, keyPath);
        if (value === undefined) {
            return { ready: false, reason: `Dependency key "${keyPath}" not found in ${dependencyLabel}.` };
        }
        const overrideKey = sanitizeOverrideKey(keyPath);
        let overrideValue = value;
        if (overrideValue !== null && typeof overrideValue === 'object') {
            try {
                overrideValue = JSON.stringify(overrideValue);
            } catch (e) {
                overrideValue = String(overrideValue);
            }
        }
        const overridesMap = { dependency_value: overrideValue };
        overridesMap[overrideKey] = overrideValue;
        return {
            ready: true,
            overrides: overridesMap,
            value,
            overrideKey,
            dependencyId,
        };
    }

    async function runSelectedCasesSequentially(caseList, caseInfoById, modal) {
        const resultsByCaseId = new Map();
        let haltReason = null;
        // track the first automation_report id observed for this batch
        if (modal && !modal.__automation_report_id) {
            modal.__automation_report_id = null;
        }

        for (const caseInfo of caseList) {
            const container = caseInfo && caseInfo.container;
            if (!container) {
                continue;
            }

            if (haltReason) {
                markCaseBlocked(container, haltReason);
                continue;
            }

            if (!caseInfo.requestId) {
                markCaseSkipped(container, 'No related API request configured.');
                continue;
            }

            let overridesInfo = null;
            if (caseInfo.requiresDependency) {
                overridesInfo = prepareDependencyOverrides(caseInfo, resultsByCaseId, caseInfoById);
                if (!overridesInfo.ready) {
                    markCaseFailed(container, overridesInfo.reason, overridesInfo.reason);
                    haltReason = overridesInfo.reason;
                    continue;
                }
            }

            let runResult;
            try {
                const overrideOptions = overridesInfo && overridesInfo.overrides ? { overrides: overridesInfo.overrides } : {};
                runResult = await executeForPanel(caseInfo.requestId, caseInfo.envId, container, overrideOptions);
            } catch (error) {
                const message = String(error || 'Unexpected execution error.');
                markCaseFailed(container, message, message);
                haltReason = message;
                continue;
            }

            if (!runResult || !runResult.success) {
                const reason = (runResult && runResult.errorSummary) || 'Execution failed.';
                if (!runResult || runResult.blockChain !== false) {
                    haltReason = reason;
                }
                continue;
            }

            if (caseInfo.responseEncrypted) {
                const decryptedPayload = extractDecryptedPayload({
                    scriptContext: container.__scriptContext || null,
                    templatingStores: container.__scriptStores || null,
                    testsScript: runResult.result ? runResult.result.tests_script : null,
                });
                if (decryptedPayload !== null && decryptedPayload !== undefined && decryptedPayload !== '') {
                    runResult.decryptedData = decryptedPayload;
                    runResult.responseData = decryptedPayload;
                    if (runResult.result && typeof runResult.result === 'object') {
                        runResult.result.decrypted_payload = decryptedPayload;
                    }
                }
                runResult.responseEncrypted = true;
            } else {
                runResult.responseEncrypted = false;
            }

            const evaluation = evaluateExpectedResults(caseInfo.expectedResults || [], runResult);
            applyEvaluationOutcome(container, evaluation);
            if (evaluation && evaluation.evaluated && !evaluation.passed) {
                const reason = evaluation.reason || 'Expected results mismatch.';
                haltReason = reason;
                continue;
            }

            const caseIdKey = caseInfo.caseId ? String(caseInfo.caseId) : null;
            if (caseIdKey) {
                resultsByCaseId.set(caseIdKey, runResult);
            }
            // capture automation_report_id from the container if present
            try {
                if (container && container.dataset && container.dataset.automationReportId) {
                    const val = container.dataset.automationReportId;
                    if (val && modal && !modal.__automation_report_id) {
                        modal.__automation_report_id = Number(val);
                    }
                }
            } catch (_e) { /* ignore */ }
        }
    }

    // Expose a programmatic multi-runner so other scripts can trigger the
    // multi-case modal and execution without wiring duplicate DOM listeners.
    if (!window.__automationMultiRunner) window.__automationMultiRunner = {};
    if (!window.__automationMultiRunner.runCaseBatch || typeof window.__automationMultiRunner.runCaseBatch !== 'function') {
        window.__automationMultiRunner.runCaseBatch = function runCaseBatch(cases, options) {
            return new Promise((resolve, reject) => {
                try {
                    if (!Array.isArray(cases) || !cases.length) {
                        resolve(null);
                        return;
                    }
                    const modal = createModal();
                    // Proactively create an AutomationReport for this modal so
                    // execute calls can attach the report id. Do this early and
                    // non-blocking so the UI can start rendering immediately.
                    try {
                        if (modal && !modal.__automation_report_promise) {
                            try {
                                modal.__automation_report_promise = (async () => {
                                    try {
                                        if (typeof window !== 'undefined' && typeof window.__automationCreateReport === 'function') {
                                            const triggeredIn = (options && options.title) ? options.title : 'ui-multi-run';
                                            const id = await window.__automationCreateReport(triggeredIn);
                                            if (id) {
                                                try { modal.__automation_report_id = Number(id); } catch (_e) { }
                                                try { modal.dataset.automationReportId = String(id); } catch (_e) { }
                                                try { window.__lastAutomationReportId = Number(id); } catch (_e) { }
                                                try { const badge = modal.querySelector && modal.querySelector('#automation-report-badge'); if (badge) badge.textContent = `Report: ${String(id)}`; } catch (_e) { }
                                                return Number(id);
                                            }
                                        }
                                    } catch (_err) { /* ignore create errors */ }
                                    return null;
                                })();
                            } catch (_e) { /* ignore promise setup errors */ }
                        }
                    } catch (_e) { /* ignore proactive create errors */ }
                    const list = modal.querySelector('#testcase-multi-list');
                    const ordered = orderCasesByDependency(cases.slice());
                    const caseInfoById = new Map();
                    ordered.forEach((caseInfo, idx) => {
                        const domId = caseInfo.caseId || caseInfo.caseKey || `case-${caseInfo.originalIndex || idx}-${idx}`;
                        const item = makeAccordionItem(domId, caseInfo.title || 'Untitled');
                        item.dataset.status = 'queued';
                        if (caseInfo.caseId) item.dataset.caseId = String(caseInfo.caseId);
                        if (caseInfo.caseKey) item.dataset.caseKey = String(caseInfo.caseKey);
                        if (caseInfo.requestId) item.dataset.requestId = String(caseInfo.requestId);
                        if (caseInfo.envId !== undefined && caseInfo.envId !== null && caseInfo.envId !== '') {
                            item.dataset.environmentId = String(caseInfo.envId);
                        }
                        caseInfo.container = item;
                        list.appendChild(item);
                        if (caseInfo.caseId) {
                            caseInfoById.set(caseInfo.caseId, caseInfo);
                        }
                    });

                    // close handler
                    const close = modal.querySelector('#testcase-multi-response-close');
                    if (close) close.addEventListener('click', () => { closeModal(modal); setTimeout(() => modal.remove(), 250); });

                    // clicking backdrop closes
                    modal.addEventListener('click', (ev2) => { if (ev2.target === modal) { closeModal(modal); setTimeout(() => modal.remove(), 250); } });

                    openModal(modal);
                    // Ensure we create an AutomationReport for this UI modal path as well.
                    // Some callers may not use the programmatic runCaseBatch path, so
                    // create early here and expose the id for debugging.
                    (async () => {
                        try {
                            if (modal && !modal.__automation_report_promise) {
                                try { console.log('[automation] initializing automation report for modal'); } catch (_e) { }
                                try {
                                    const badge = modal.querySelector && modal.querySelector('#automation-report-badge');
                                    if (badge) badge.textContent = 'Report: creating...';
                                } catch (_e) { }
                                modal.__automation_report_promise = (async () => {
                                    try {
                                        const triggeredIn = 'ui-multi-run';
                                        let csrftoken = null;
                                        try {
                                            const name = 'csrftoken';
                                            const cparts = document.cookie.split(';').map(s => s.trim()).filter(Boolean);
                                            for (const p of cparts) { if (p.startsWith(name + '=')) { csrftoken = decodeURIComponent(p.split('=')[1]); break; } }
                                        } catch (e) { csrftoken = null; }
                                        // Ensure cookies are included even when API runs on a different origin/port
                                        try { console.log('[automation] create report request origin', window.location ? window.location.origin : 'unknown', 'url', FINALIZE_URL.replace('/finalize/', '/create/')); } catch (_e) { }
                                        try { console.log('[automation] document.cookie (truncated)', (document.cookie || '').slice(0, 200)); } catch (_e) { }
                                        const resp = await fetch(FINALIZE_URL.replace('/finalize/', '/create/'), {
                                            method: 'POST',
                                            credentials: 'include',
                                            headers: { 'Content-Type': 'application/json', ...(csrftoken ? { 'X-CSRFToken': csrftoken } : {}) },
                                            body: JSON.stringify({ triggered_in: triggeredIn }),
                                        });
                                        if (!resp.ok) {
                                            try { console.warn('[automation] create report failed, resp status', resp.status); } catch (_e) { }
                                            return null;
                                        }
                                        const body = await resp.json();
                                        if (body && body.id) {
                                            try { modal.__automation_report_id = Number(body.id); } catch (_e) { }
                                            try { modal.dataset.automationReportId = String(body.id); } catch (_e) { }
                                            try { window.__lastAutomationReportId = Number(body.id); } catch (_e) { }
                                            try { console.log('[automation] created automation report (ui path)', body); } catch (_e) { }
                                            try { const badge = modal.querySelector && modal.querySelector('#automation-report-badge'); if (badge) badge.textContent = `Report: ${body.report_id || body.id}`; } catch (_e) { }
                                            return Number(body.id);
                                        }
                                    } catch (err) {
                                        try { console.warn('[automation] failed to create automation report (ui path)', err); } catch (_e) { }
                                        return null;
                                    }
                                    return null;
                                })();
                            }
                        } catch (_e) { /* ignore */ }
                    })();
                    try { refreshScenarioCounts(modal); } catch (_e) { }
                    try { updateModalTotals(modal); } catch (_e) { }

                    // Create an AutomationReport on the server for this batch so
                    // all run results can be associated deterministically. Store
                    // the promise on the modal so we can await it before starting.
                    modal.__automation_report_promise = (async () => {
                        try {
                            // prefer an explicit title from options, otherwise use a default
                            const triggeredIn = (options && options.title) ? options.title : 'ui-multi-run';
                            let csrftoken = null;
                            try {
                                const name = 'csrftoken';
                                const cparts = document.cookie.split(';').map(s => s.trim()).filter(Boolean);
                                for (const p of cparts) { if (p.startsWith(name + '=')) { csrftoken = decodeURIComponent(p.split('=')[1]); break; } }
                            } catch (e) { csrftoken = null; }
                            const resp = await fetch(FINALIZE_URL.replace('/finalize/', '/create/'), {
                                method: 'POST',
                                credentials: 'same-origin',
                                headers: { 'Content-Type': 'application/json', ...(csrftoken ? { 'X-CSRFToken': csrftoken } : {}) },
                                body: JSON.stringify({ triggered_in: triggeredIn }),
                            });
                            if (!resp.ok) return null;
                            const body = await resp.json();
                            if (body && body.id) {
                                // store the report id on the modal so executeForPanel can pick it up
                                try { modal.__automation_report_id = Number(body.id); } catch (_e) { }
                                try { modal.dataset.automationReportId = String(body.id); } catch (_e) { }
                                try { window.__lastAutomationReportId = Number(body.id); } catch (_e) { }
                                try { console.log('[automation] created automation report', body); } catch (_e) { }
                                return Number(body.id);
                            }
                            return null;
                        } catch (_err) {
                            console.warn('[automation] failed to create automation report before batch', _err);
                            return null;
                        }
                    })();

                    // Respect an explicit option to auto-close the modal when the
                    // run completes. Default behavior is to leave the modal open so
                    // users can inspect results and avoid unexpected closures.
                    const autoClose = options && typeof options.autoCloseOnFinish === 'boolean' ? options.autoCloseOnFinish : false;

                    (async () => {
                        try {
                            if (modal && modal.__automation_report_promise) {
                                try { await modal.__automation_report_promise; } catch (_e) { /* ignore create errors */ }
                            }
                        } catch (_e) { /* ignore */ }
                        return runSelectedCasesSequentially(ordered, caseInfoById, modal);
                    })()
                        .then(() => {
                            try {
                                if (autoClose) { closeModal(modal); setTimeout(() => modal.remove(), 250); }
                            } catch (_e) { /* ignore */ }
                            try { refreshScenarioCounts(modal); } catch (_e) { }
                            try { updateModalTotals(modal); } catch (_e) { }
                            try { console.log('[automation] scenario totals', collectAllScenarioTotals(modal)); } catch (_e) { }
                            // Persist final totals server-side if we observed an automation_report
                            try {
                                const reportId = modal && modal.__automation_report_id ? modal.__automation_report_id : null;
                                if (reportId) {
                                    (async () => {
                                        try {
                                            let csrftoken = null;
                                            try {
                                                const name = 'csrftoken';
                                                const cparts = document.cookie.split(';').map(s => s.trim()).filter(Boolean);
                                                for (const p of cparts) { if (p.startsWith(name + '=')) { csrftoken = decodeURIComponent(p.split('=')[1]); break; } }
                                            } catch (e) { csrftoken = null; }
                                            // small debounce: allow UI totals to settle before sending finalize
                                            await new Promise((res) => setTimeout(res, 350));
                                            // include client-side computed totals so server can persist blocked/skipped cases
                                            const totalsPayload = collectAllScenarioTotals(modal).totals || { passed: 0, failed: 0, blocked: 0, total: 0 };
                                            // PATCH the report detail to persist totals and finished timestamp
                                            const detailUrl = `/api/core/automation-report/${reportId}/`;
                                            const patchBody = {
                                                total_passed: Number(totalsPayload.passed || 0),
                                                total_failed: Number(totalsPayload.failed || 0),
                                                total_blocked: Number(totalsPayload.blocked || 0),
                                                finished: (new Date()).toISOString(),
                                            };
                                            // Debugging: log attempt so developer can confirm PATCH is sent
                                            try { console.log('[automation] PATCH automation report', detailUrl, patchBody); } catch (_e) { }
                                            try { console.log('[automation] finalize PATCH attempt origin', window.location ? window.location.origin : 'unknown', 'url', detailUrl); } catch (_e) { }
                                            try { console.log('[automation] csrftoken present?', Boolean(csrftoken)); } catch (_e) { }
                                            const resp = await fetch(detailUrl, {
                                                method: 'PATCH',
                                                credentials: 'include',
                                                headers: { 'Content-Type': 'application/json', ...(csrftoken ? { 'X-CSRFToken': csrftoken } : {}) },
                                                body: JSON.stringify(patchBody),
                                            });
                                            if (resp.status === 401) {
                                                try { console.warn('[automation] finalize PATCH returned 401 Unauthorized; cookies or session may be missing'); } catch (_e) { }
                                                try { console.warn('[automation] document.cookie (truncated)', (document.cookie || '').slice(0, 200)); } catch (_e) { }
                                                try { alert('Finalize failed: you appear to be unauthenticated. Please sign in and retry.'); } catch (_e) { }
                                            }
                                            try {
                                                const body = await resp.json();
                                                console.log('[automation] finalize report response', body);
                                                // If server returned totals that don't match client totals, retry once
                                                try {
                                                    const serverBlocked = Number(body && (body.total_blocked || body.totalBlocked || body.blocked) || 0);
                                                    const clientBlocked = Number(totalsPayload.blocked || 0);
                                                    if (resp.ok && serverBlocked !== clientBlocked) {
                                                        try { console.warn('[automation] finalize mismatch, retrying PATCH to persist client totals', { serverBlocked, clientBlocked }); } catch (_e) { }
                                                        const retryResp = await fetch(detailUrl, {
                                                            method: 'PATCH',
                                                            credentials: 'same-origin',
                                                            headers: { 'Content-Type': 'application/json', ...(csrftoken ? { 'X-CSRFToken': csrftoken } : {}) },
                                                            body: JSON.stringify(patchBody),
                                                        });
                                                        try { const retryBody = await retryResp.json(); console.log('[automation] finalize retry response', retryBody); } catch (_e) { }
                                                    }
                                                } catch (_e) { /* ignore comparison errors */ }
                                            } catch (_e) { /* ignore parse errors */ }
                                        } catch (err) {
                                            console.warn('[automation] failed to finalize automation report', err);
                                        }
                                    })();
                                }
                            } catch (_e) { /* ignore finalize errors */ }
                            resolve(true);
                        })
                        .catch((err) => {
                            try {
                                if (autoClose) { closeModal(modal); setTimeout(() => modal.remove(), 250); }
                            } catch (_e) { /* ignore */ }
                            try { refreshScenarioCounts(modal); } catch (_e) { }
                            try { updateModalTotals(modal); } catch (_e) { }
                            try { console.log('[automation] scenario totals (error)', collectAllScenarioTotals(modal)); } catch (_e) { }
                            reject(err);
                        });
                } catch (err) {
                    reject(err);
                }
            });
        };
        // mark initialized flag
        window.__automationMultiRunner._initialized = true;
        // expose helper to collect scenario totals
        try {
            window.__automationMultiRunner.getScenarioTotals = function (modal) { return collectAllScenarioTotals(modal); };
        } catch (_e) { /* ignore export errors */ }
    }
    // Provide a scenario-grouped runner which shows a parent accordion per scenario
    if (!window.__automationMultiRunner.runScenarioBatch || typeof window.__automationMultiRunner.runScenarioBatch !== 'function') {
        window.__automationMultiRunner.runScenarioBatch = function runScenarioBatch(scenarios, options) {
            return new Promise((resolve, reject) => {
                try {
                    if (!Array.isArray(scenarios) || !scenarios.length) {
                        resolve(null);
                        return;
                    }

                    // create a dedicated modal for scenarios
                    // remove existing if present
                    const existing = document.getElementById('scenario-multi-response-modal');
                    if (existing) existing.remove();

                    const modal = document.createElement('div');
                    modal.className = 'modal multi-run';
                    modal.id = 'scenario-multi-response-modal';
                    modal.setAttribute('aria-hidden', 'true');
                    modal.tabIndex = -1;
                    const title = options && options.title ? options.title : 'Run Scenarios';
                    modal.innerHTML = `
                        <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="scenario-multi-response-title">
                            <div class="modal-header">
                                <h3 id="scenario-multi-response-title">${escapeHtml(title)}</h3>
                                <button type="button" id="scenario-multi-response-close" class="modal-close" aria-label="Close">×</button>
                            </div>
                            <div class="modal-body">
                                <div id="scenario-multi-list" class="multi-list"></div>
                            </div>
                        </div>
                    `;
                    document.body.appendChild(modal);

                    // Proactively attempt to create an AutomationReport for this
                    // project modal so execute calls can attach the report id.
                    // This mirrors the behavior in the case-based modal.
                    try {
                        (async () => {
                            try {
                                try { console.log('[automation] runProjectBatch: attempting to create automation report for project modal'); } catch (_e) { }
                                if (typeof window !== 'undefined' && typeof window.__automationCreateReport === 'function') {
                                    if (!modal.__automation_report_promise) {
                                        modal.__automation_report_promise = (async () => {
                                            try {
                                                const triggeredIn = (options && options.title) ? options.title : 'ui-project-run';
                                                try { console.log('[automation] runProjectBatch: calling __automationCreateReport', triggeredIn); } catch (_e) { }
                                                const id = await window.__automationCreateReport(triggeredIn);
                                                if (id) {
                                                    try { modal.__automation_report_id = Number(id); } catch (_e) { }
                                                    try { modal.dataset.automationReportId = String(id); } catch (_e) { }
                                                    try { window.__lastAutomationReportId = Number(id); } catch (_e) { }
                                                    try { console.log('[automation] runProjectBatch: created automation report', id); } catch (_e) { }
                                                    return Number(id);
                                                }
                                            } catch (_err) { /* ignore create errors */ }
                                            return null;
                                        })();
                                    }
                                } else {
                                    try { console.log('[automation] runProjectBatch: __automationCreateReport helper not available'); } catch (_e) { }
                                }
                            } catch (_e) { /* ignore */ }
                        })();
                    } catch (_e) { /* ignore */ }

                    // Ensure the scenario modal is at least 70% width and centered — use inline styles to override cached CSS
                    try {
                        const dialogEl = modal.querySelector('.modal-dialog');
                        if (dialogEl) {
                            dialogEl.style.cssText = 'position:relative;margin:1.5rem auto;width:70vw;max-width:1200px;border-radius:10px;box-shadow:var(--automation-shadow);';
                        }
                        const bodyEl = modal.querySelector('.modal-body');
                        if (bodyEl) {
                            bodyEl.style.cssText = 'max-height:70vh;overflow:auto;';
                        }
                    } catch (e) { /* ignore */ }

                    const list = modal.querySelector('#scenario-multi-list');
                    const allCases = [];
                    let globalIndex = 0;
                    const caseInfoByKey = new Map();

                    scenarios.forEach((scenario, sIdx) => {
                        const scenarioId = scenario && (scenario.id || scenario.scenarioId || scenario.scenario_id) ? String(scenario.id || scenario.scenarioId || scenario.scenario_id) : `scenario-${sIdx}`;
                        const scenarioTitle = scenario && (scenario.title || scenario.name) ? String(scenario.title || scenario.name) : `Scenario ${scenarioId}`;

                        // parent container
                        const parent = document.createElement('div');
                        parent.className = 'multi-scenario';
                        const headerId = `scenario-${scenarioId}-header`;
                        const bodyId = `scenario-${scenarioId}-body`;
                        parent.innerHTML = `
                            <div class="multi-scenario-header" id="${headerId}" role="button" aria-expanded="false" tabindex="0">
                                <span class="multi-scenario-title">${escapeHtml(scenarioTitle)}</span>
                            </div>
                            <div class="multi-scenario-body" id="${bodyId}" hidden>
                                <div class="multi-list scenario-case-list"></div>
                            </div>
                        `;
                        const header = parent.querySelector('.multi-scenario-header');
                        const body = parent.querySelector('.multi-scenario-body');
                        // normalize header content to include an explicit caret and status span
                        try {
                            if (header) {
                                const titleText = escapeHtml(scenarioTitle || 'Untitled');
                                header.innerHTML = `<span class="multi-scenario-caret">▶</span><span class="multi-scenario-title">${titleText}</span><span class="multi-scenario-counts" aria-hidden="true"></span><span class="multi-scenario-status" aria-hidden="true"></span>`;
                            }
                        } catch (_e) { /* ignore */ }
                        const childList = parent.querySelector('.scenario-case-list');
                        // toggle
                        header.addEventListener('click', () => {
                            const expanded = header.getAttribute('aria-expanded') === 'true';
                            header.setAttribute('aria-expanded', expanded ? 'false' : 'true');
                            body.hidden = expanded ? true : false;
                            try { header.classList.toggle('is-expanded', !expanded); } catch (_e) { }
                        });
                        header.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); header.click(); } });

                        // append cases for this scenario
                        const cases = Array.isArray(scenario.cases) ? scenario.cases : [];
                        cases.forEach((caseInfo) => {
                            const domId = caseInfo.caseId || caseInfo.caseKey || `case-${globalIndex}-${globalIndex}`;
                            const item = makeAccordionItem(domId, caseInfo.title || caseInfo.name || `Case ${domId}`);
                            item.dataset.status = 'queued';
                            if (caseInfo.caseId) item.dataset.caseId = String(caseInfo.caseId);
                            if (caseInfo.caseKey) item.dataset.caseKey = String(caseInfo.caseKey);
                            if (caseInfo.requestId) item.dataset.requestId = String(caseInfo.requestId);
                            if (caseInfo.envId !== undefined && caseInfo.envId !== null && caseInfo.envId !== '') item.dataset.environmentId = String(caseInfo.envId);

                            // store mapping so after ordering we can reference the container
                            const key = caseInfo.caseId || (`__idx_${globalIndex}`);
                            const infoCopy = Object.assign({}, caseInfo, { originalIndex: globalIndex, container: item });
                            allCases.push(infoCopy);
                            caseInfoByKey.set(key, infoCopy);
                            childList.appendChild(item);
                            globalIndex += 1;
                        });

                        list.appendChild(parent);
                    });

                    // close handler
                    const close = modal.querySelector('#scenario-multi-response-close');
                    if (close) close.addEventListener('click', () => { closeModal(modal); setTimeout(() => modal.remove(), 250); });
                    modal.addEventListener('click', (ev2) => { if (ev2.target === modal) { closeModal(modal); setTimeout(() => modal.remove(), 250); } });

                    openModal(modal);
                    try { refreshScenarioCounts(modal); } catch (_e) { }
                    try { updateModalTotals(modal); } catch (_e) { }

                    // Flatten and order by dependency then run sequentially
                    const ordered = orderCasesByDependency(allCases.slice());
                    const caseInfoById = new Map();
                    ordered.forEach((ci) => { if (ci.caseId) caseInfoById.set(ci.caseId, ci); });

                    const autoClose = options && typeof options.autoCloseOnFinish === 'boolean' ? options.autoCloseOnFinish : false;

                    // Create an AutomationReport before running so all results can be associated.
                    modal.__automation_report_promise = (async () => {
                        try {
                            const triggeredIn = (options && options.title) ? options.title : 'ui-multi-run';
                            let csrftoken = null;
                            try {
                                const name = 'csrftoken';
                                const cparts = document.cookie.split(';').map(s => s.trim()).filter(Boolean);
                                for (const p of cparts) { if (p.startsWith(name + '=')) { csrftoken = decodeURIComponent(p.split('=')[1]); break; } }
                            } catch (e) { csrftoken = null; }
                            const resp = await fetch(FINALIZE_URL.replace('/finalize/', '/create/'), {
                                method: 'POST',
                                credentials: 'same-origin',
                                headers: { 'Content-Type': 'application/json', ...(csrftoken ? { 'X-CSRFToken': csrftoken } : {}) },
                                body: JSON.stringify({ triggered_in: triggeredIn }),
                            });
                            if (!resp.ok) return null;
                            const body = await resp.json();
                            if (body && body.id) {
                                try { modal.__automation_report_id = Number(body.id); } catch (_e) { }
                                try { modal.dataset.automationReportId = String(body.id); } catch (_e) { }
                                try { window.__lastAutomationReportId = Number(body.id); } catch (_e) { }
                                try { console.log('[automation] created automation report', body); } catch (_e) { }
                                return Number(body.id);
                            }
                            return null;
                        } catch (_err) {
                            console.warn('[automation] failed to create automation report before batch', _err);
                            return null;
                        }
                    })();

                    (async () => {
                        try {
                            if (modal && modal.__automation_report_promise) {
                                try { await modal.__automation_report_promise; } catch (_e) { /* ignore create errors */ }
                            }
                        } catch (_e) { /* ignore */ }
                        return runSelectedCasesSequentially(ordered, caseInfoById, modal);
                    })()
                        .then(() => {
                            try { if (autoClose) { closeModal(modal); setTimeout(() => modal.remove(), 250); } } catch (_e) { }
                            try { refreshScenarioCounts(modal); } catch (_e) { }
                            try { updateModalTotals(modal); } catch (_e) { }
                            try { console.log('[automation] scenario totals', collectAllScenarioTotals(modal)); } catch (_e) { }

                            // Persist final totals server-side if we observed an automation_report
                            try {
                                const reportId = modal && modal.__automation_report_id ? modal.__automation_report_id : null;
                                if (reportId) {
                                    (async () => {
                                        try {
                                            let csrftoken = null;
                                            try {
                                                const name = 'csrftoken';
                                                const cparts = document.cookie.split(';').map(s => s.trim()).filter(Boolean);
                                                for (const p of cparts) { if (p.startsWith(name + '=')) { csrftoken = decodeURIComponent(p.split('=')[1]); break; } }
                                            } catch (e) { csrftoken = null; }
                                            const totalsPayload = collectAllScenarioTotals(modal).totals || { passed: 0, failed: 0, blocked: 0, total: 0 };
                                            const detailUrl = `/api/core/automation-report/${reportId}/`;
                                            const patchBody = {
                                                total_passed: Number(totalsPayload.passed || 0),
                                                total_failed: Number(totalsPayload.failed || 0),
                                                total_blocked: Number(totalsPayload.blocked || 0),
                                                finished: (new Date()).toISOString(),
                                            };
                                            try { console.log('[automation] PATCH automation report', detailUrl, patchBody); } catch (_e) { }
                                            const resp = await fetch(detailUrl, {
                                                method: 'PATCH',
                                                credentials: 'same-origin',
                                                headers: { 'Content-Type': 'application/json', ...(csrftoken ? { 'X-CSRFToken': csrftoken } : {}) },
                                                body: JSON.stringify(patchBody),
                                            });
                                            try {
                                                const body = await resp.json();
                                                console.log('[automation] finalize report response', body);
                                            } catch (_e) { /* ignore parse errors */ }
                                        } catch (err) {
                                            console.warn('[automation] failed to finalize automation report', err);
                                        }
                                    })();
                                } else {
                                    try { console.log('[automation] no automation_report id observed; skipping finalize'); } catch (_e) { }
                                }
                            } catch (_e) { /* ignore finalize errors */ }

                            resolve(true);
                        })
                        .catch((err) => {
                            try { if (autoClose) { closeModal(modal); setTimeout(() => modal.remove(), 250); } } catch (_e) { }
                            try { refreshScenarioCounts(modal); } catch (_e) { }
                            try { updateModalTotals(modal); } catch (_e) { }
                            try { console.log('[automation] scenario totals (error)', collectAllScenarioTotals(modal)); } catch (_e) { }
                            reject(err);
                        });
                } catch (err) {
                    reject(err);
                }
            });
        };
    }
    // Provide a module-grouped runner which shows a parent accordion per module,
    // scenarios nested inside, and cases under each scenario.
    if (!window.__automationMultiRunner.runModuleBatch || typeof window.__automationMultiRunner.runModuleBatch !== 'function') {
        window.__automationMultiRunner.runModuleBatch = function runModuleBatch(modules, options) {
            return new Promise((resolve, reject) => {
                try {
                    if (!Array.isArray(modules) || !modules.length) {
                        resolve(null);
                        return;
                    }

                    const existing = document.getElementById('module-multi-response-modal');
                    if (existing) existing.remove();

                    const modal = document.createElement('div');
                    modal.className = 'modal multi-run';
                    modal.id = 'module-multi-response-modal';
                    modal.setAttribute('aria-hidden', 'true');
                    modal.tabIndex = -1;
                    const title = options && options.title ? options.title : 'Run Modules';
                    modal.innerHTML = `
                        <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="module-multi-response-title">
                            <div class="modal-header">
                                <h3 id="module-multi-response-title">${escapeHtml(title)}</h3>
                                <button type="button" id="module-multi-response-close" class="modal-close" aria-label="Close">×</button>
                            </div>
                            <div class="modal-body">
                                <div id="module-multi-list" class="multi-list"></div>
                            </div>
                        </div>
                    `;
                    document.body.appendChild(modal);

                    try {
                        const dialogEl = modal.querySelector('.modal-dialog');
                        if (dialogEl) {
                            dialogEl.style.cssText = 'position:relative;margin:1.5rem auto;width:70vw;max-width:1200px;border-radius:10px;box-shadow:var(--automation-shadow);';
                        }
                        const bodyEl = modal.querySelector('.modal-body');
                        if (bodyEl) {
                            bodyEl.style.cssText = 'max-height:70vh;overflow:auto;';
                        }
                    } catch (e) { /* ignore */ }

                    // Attempt to create an AutomationReport for this project-run modal
                    try {
                        (async () => {
                            try {
                                try { console.log('[automation] project run modal created, attempting automation report create'); } catch (_e) { }
                                if (typeof window !== 'undefined' && typeof window.__automationCreateReport === 'function') {
                                    const triggeredIn = (options && options.title) ? options.title : 'ui-project-run';
                                    const id = await window.__automationCreateReport(triggeredIn);
                                    if (id) {
                                        try { modal.__automation_report_id = Number(id); } catch (_e) { }
                                        try { modal.dataset.automationReportId = String(id); } catch (_e) { }
                                        try { window.__lastAutomationReportId = Number(id); } catch (_e) { }
                                        try { const statusEl = modal.querySelector && modal.querySelector('.multi-project-status'); if (statusEl) statusEl.textContent = `Report: ${String(id)}`; } catch (_e) { }
                                        try { console.log('[automation] project modal created automation report', id); } catch (_e) { }
                                    }
                                } else {
                                    try { console.log('[automation] __automationCreateReport helper not available for project modal'); } catch (_e) { }
                                }
                            } catch (_e) { /* ignore */ }
                        })();
                    } catch (_e) { /* ignore */ }

                    const list = modal.querySelector('#module-multi-list');
                    const allCases = [];
                    let globalIndex = 0;

                    modules.forEach((moduleObj, mIdx) => {
                        const moduleId = moduleObj && (moduleObj.id || moduleObj.moduleId || moduleObj.module_id) ? String(moduleObj.id || moduleObj.moduleId || moduleObj.module_id) : `module-${mIdx}`;
                        const moduleTitle = moduleObj && (moduleObj.title || moduleObj.name) ? String(moduleObj.title || moduleObj.name) : `Module ${moduleId}`;

                        const moduleContainer = document.createElement('div');
                        moduleContainer.className = 'multi-module';
                        const headerId = `module-${moduleId}-header`;
                        const bodyId = `module-${moduleId}-body`;
                        moduleContainer.innerHTML = `
                            <div class="multi-module-header" id="${headerId}" role="button" aria-expanded="false" tabindex="0">
                                <span class="multi-module-caret">▶</span><span class="multi-module-title">${escapeHtml(moduleTitle)}</span><span class="multi-module-counts" aria-hidden="true"></span><span class="multi-module-status" aria-hidden="true"></span>
                            </div>
                            <div class="multi-module-body" id="${bodyId}" hidden>
                                <div class="multi-list module-scenario-list"></div>
                            </div>
                        `;
                        const moduleHeader = moduleContainer.querySelector('.multi-module-header');
                        const moduleBody = moduleContainer.querySelector('.multi-module-body');
                        const scenariosList = moduleContainer.querySelector('.module-scenario-list');

                        // toggle
                        moduleHeader.addEventListener('click', () => {
                            const expanded = moduleHeader.getAttribute('aria-expanded') === 'true';
                            moduleHeader.setAttribute('aria-expanded', expanded ? 'false' : 'true');
                            moduleBody.hidden = expanded ? true : false;
                            try { moduleHeader.classList.toggle('is-expanded', !expanded); } catch (_e) { }
                        });
                        moduleHeader.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); moduleHeader.click(); } });

                        // append scenarios
                        const scenarios = Array.isArray(moduleObj.scenarios) ? moduleObj.scenarios : [];
                        scenarios.forEach((scenario, sIdx) => {
                            const scenarioId = scenario && (scenario.id || scenario.scenarioId || scenario.scenario_id) ? String(scenario.id || scenario.scenarioId || scenario.scenario_id) : `m${mIdx}-s${sIdx}`;
                            const scenarioTitle = scenario && (scenario.title || scenario.name) ? String(scenario.title || scenario.name) : `Scenario ${scenarioId}`;

                            const parent = document.createElement('div');
                            parent.className = 'multi-scenario';
                            const sHeaderId = `scenario-${scenarioId}-header`;
                            const sBodyId = `scenario-${scenarioId}-body`;
                            parent.innerHTML = `
                                <div class="multi-scenario-header" id="${sHeaderId}" role="button" aria-expanded="false" tabindex="0">
                                    <span class="multi-scenario-caret">▶</span><span class="multi-scenario-title">${escapeHtml(scenarioTitle)}</span><span class="multi-scenario-counts" aria-hidden="true"></span><span class="multi-scenario-status" aria-hidden="true"></span>
                                </div>
                                <div class="multi-scenario-body" id="${sBodyId}" hidden>
                                    <div class="multi-list scenario-case-list"></div>
                                </div>
                            `;
                            const sHeader = parent.querySelector('.multi-scenario-header');
                            const sBody = parent.querySelector('.multi-scenario-body');
                            const childList = parent.querySelector('.scenario-case-list');
                            sHeader.addEventListener('click', () => {
                                const expanded = sHeader.getAttribute('aria-expanded') === 'true';
                                sHeader.setAttribute('aria-expanded', expanded ? 'false' : 'true');
                                sBody.hidden = expanded ? true : false;
                                try { sHeader.classList.toggle('is-expanded', !expanded); } catch (_e) { }
                            });
                            sHeader.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); sHeader.click(); } });

                            const cases = Array.isArray(scenario.cases) ? scenario.cases : [];
                            cases.forEach((caseInfo) => {
                                const domId = caseInfo.caseId || caseInfo.caseKey || `case-${globalIndex}-${globalIndex}`;
                                const item = makeAccordionItem(domId, caseInfo.title || caseInfo.name || `Case ${domId}`);
                                item.dataset.status = 'queued';
                                if (caseInfo.caseId) item.dataset.caseId = String(caseInfo.caseId);
                                if (caseInfo.caseKey) item.dataset.caseKey = String(caseInfo.caseKey);
                                if (caseInfo.requestId) item.dataset.requestId = String(caseInfo.requestId);
                                if (caseInfo.envId !== undefined && caseInfo.envId !== null && caseInfo.envId !== '') item.dataset.environmentId = String(caseInfo.envId);

                                const key = caseInfo.caseId || (`__idx_${globalIndex}`);
                                const infoCopy = Object.assign({}, caseInfo, { originalIndex: globalIndex, container: item });
                                allCases.push(infoCopy);
                                childList.appendChild(item);
                                globalIndex += 1;
                            });

                            scenariosList.appendChild(parent);
                        });

                        list.appendChild(moduleContainer);
                    });

                    // close handlers
                    const close = modal.querySelector('#module-multi-response-close');
                    if (close) close.addEventListener('click', () => { closeModal(modal); setTimeout(() => modal.remove(), 250); });
                    modal.addEventListener('click', (ev2) => { if (ev2.target === modal) { closeModal(modal); setTimeout(() => modal.remove(), 250); } });

                    openModal(modal);
                    try { refreshScenarioCounts(modal); } catch (_e) { }
                    try { updateModalTotals(modal); } catch (_e) { }

                    // Flatten and order by dependency then run sequentially
                    const ordered = orderCasesByDependency(allCases.slice());
                    const caseInfoById = new Map();
                    ordered.forEach((ci) => { if (ci.caseId) caseInfoById.set(ci.caseId, ci); });

                    const autoClose = options && typeof options.autoCloseOnFinish === 'boolean' ? options.autoCloseOnFinish : false;
                    runSelectedCasesSequentially(ordered, caseInfoById, modal)
                        .then(() => {
                            try { if (autoClose) { closeModal(modal); setTimeout(() => modal.remove(), 250); } } catch (_e) { }
                            try { refreshScenarioCounts(modal); } catch (_e) { }
                            try { updateModalTotals(modal); } catch (_e) { }
                            try { console.log('[automation] scenario totals', collectAllScenarioTotals(modal)); } catch (_e) { }
                            resolve(true);
                        }).catch((err) => {
                            try { if (autoClose) { closeModal(modal); setTimeout(() => modal.remove(), 250); } } catch (_e) { }
                            try { refreshScenarioCounts(modal); } catch (_e) { }
                            try { updateModalTotals(modal); } catch (_e) { }
                            try { console.log('[automation] scenario totals (error)', collectAllScenarioTotals(modal)); } catch (_e) { }
                            reject(err);
                        });
                } catch (err) {
                    reject(err);
                }
            });
        };
    }
    // Provide a project-grouped runner: project -> modules -> scenarios -> cases
    if (!window.__automationMultiRunner.runProjectBatch || typeof window.__automationMultiRunner.runProjectBatch !== 'function') {
        window.__automationMultiRunner.runProjectBatch = function runProjectBatch(projects, options) {
            return new Promise(async (resolve, reject) => {
                try {
                    if (!Array.isArray(projects) || !projects.length) {
                        resolve(null);
                        return;
                    }

                    const existing = document.getElementById('project-multi-response-modal');
                    if (existing) existing.remove();

                    const modal = document.createElement('div');
                    modal.className = 'modal multi-run';
                    modal.id = 'project-multi-response-modal';
                    modal.setAttribute('aria-hidden', 'true');
                    modal.tabIndex = -1;
                    const title = options && options.title ? options.title : 'Run Projects';
                    modal.innerHTML = `
                        <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="project-multi-response-title">
                            <div class="modal-header">
                                <h3 id="project-multi-response-title">${escapeHtml(title)}</h3>
                                <button type="button" id="project-multi-response-close" class="modal-close" aria-label="Close">×</button>
                            </div>
                            <div class="modal-body">
                                <div id="project-multi-list" class="multi-list"></div>
                            </div>
                        </div>
                    `;

                    document.body.appendChild(modal);

                    // Block here and create the AutomationReport before rendering
                    // the modal and starting any runs. This guarantees the report
                    // id exists and can be attached to execute payloads.
                    try {
                        try { console.log('[automation] runProjectBatch: blocking create automation report'); } catch (_e) { }
                        if (typeof window !== 'undefined' && typeof window.__automationCreateReport === 'function') {
                            try {
                                const triggeredIn = (options && options.title) ? options.title : 'ui-project-run-blocking';
                                try { console.log('[automation] runProjectBatch: calling __automationCreateReport (blocking)', triggeredIn); } catch (_e) { }
                                const id = await window.__automationCreateReport(triggeredIn);
                                if (id) {
                                    try { modal.__automation_report_id = Number(id); } catch (_e) { }
                                    try { modal.dataset.automationReportId = String(id); } catch (_e) { }
                                    try { window.__lastAutomationReportId = Number(id); } catch (_e) { }
                                    try { const badge = modal.querySelector && modal.querySelector('#automation-report-badge'); if (badge) badge.textContent = `Report: ${String(id)}`; } catch (_e) { }
                                    try { console.log('[automation] runProjectBatch: created automation report (blocking)', id); } catch (_e) { }
                                } else {
                                    try { console.warn('[automation] runProjectBatch: create returned no id'); } catch (_e) { }
                                }
                            } catch (_err) {
                                try { console.warn('[automation] runProjectBatch: create errored', _err); } catch (_e) { }
                            }
                        } else {
                            try { console.log('[automation] runProjectBatch: __automationCreateReport helper not available (blocking)'); } catch (_e) { }
                        }
                    } catch (_e) { /* ignore */ }

                    try {
                        const dialogEl = modal.querySelector('.modal-dialog');
                        if (dialogEl) {
                            dialogEl.style.cssText = 'position:relative;margin:1.5rem auto;width:70vw;max-width:1200px;border-radius:10px;box-shadow:var(--automation-shadow);';
                        }
                        const bodyEl = modal.querySelector('.modal-body');
                        if (bodyEl) {
                            bodyEl.style.cssText = 'max-height:70vh;overflow:auto;';
                        }
                    } catch (e) { /* ignore */ }

                    const list = modal.querySelector('#project-multi-list');
                    const allCases = [];
                    let globalIndex = 0;

                    projects.forEach((projectObj, pIdx) => {
                        const projectId = projectObj && (projectObj.id || projectObj.projectId || projectObj.project_id) ? String(projectObj.id || projectObj.projectId || projectObj.project_id) : `project-${pIdx}`;
                        const projectTitle = projectObj && (projectObj.title || projectObj.name) ? String(projectObj.title || projectObj.name) : `Project ${projectId}`;

                        const projectContainer = document.createElement('div');
                        projectContainer.className = 'multi-project';
                        const headerId = `project-${projectId}-header`;
                        const bodyId = `project-${projectId}-body`;
                        projectContainer.innerHTML = `
                            <div class="multi-project-header" id="${headerId}" role="button" aria-expanded="false" tabindex="0">
                                <span class="multi-project-caret">▶</span>
                                <span class="multi-project-title">${escapeHtml(projectTitle)}</span>
                                <span class="multi-project-counts" aria-hidden="true"></span>
                                <span class="multi-project-status" aria-hidden="true"></span>
                            </div>
                            <div class="multi-project-body" id="${bodyId}" hidden>
                                <div class="multi-list project-module-list"></div>
                            </div>
                        `;
                        const projectHeader = projectContainer.querySelector('.multi-project-header');
                        const projectBody = projectContainer.querySelector('.multi-project-body');
                        const modulesList = projectContainer.querySelector('.project-module-list');
                        projectHeader.addEventListener('click', () => {
                            const expanded = projectHeader.getAttribute('aria-expanded') === 'true';
                            projectHeader.setAttribute('aria-expanded', expanded ? 'false' : 'true');
                            projectBody.hidden = expanded ? true : false;
                            try { projectHeader.classList.toggle('is-expanded', !expanded); } catch (_e) { }
                        });
                        projectHeader.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); projectHeader.click(); } });

                        const modules = Array.isArray(projectObj.modules) ? projectObj.modules : [];
                        modules.forEach((moduleObj, mIdx) => {
                            const moduleId = moduleObj && (moduleObj.id || moduleObj.moduleId || moduleObj.module_id) ? String(moduleObj.id || moduleObj.moduleId || moduleObj.module_id) : `p${pIdx}-m${mIdx}`;
                            const moduleTitle = moduleObj && (moduleObj.title || moduleObj.name) ? String(moduleObj.title || moduleObj.name) : `Module ${moduleId}`;

                            const moduleContainer = document.createElement('div');
                            moduleContainer.className = 'multi-module';
                            const mHeaderId = `module-${moduleId}-header`;
                            const mBodyId = `module-${moduleId}-body`;
                            moduleContainer.innerHTML = `
                                <div class="multi-module-header" id="${mHeaderId}" role="button" aria-expanded="false" tabindex="0">
                                    <span class="multi-module-caret">▶</span>
                                    <span class="multi-module-title">${escapeHtml(moduleTitle)}</span>
                                    <span class="multi-module-counts" aria-hidden="true"></span>
                                    <span class="multi-module-status" aria-hidden="true"></span>
                                </div>
                                <div class="multi-module-body" id="${mBodyId}" hidden>
                                    <div class="multi-list module-scenario-list"></div>
                                </div>
                            `;
                            const mHeader = moduleContainer.querySelector('.multi-module-header');
                            const mBody = moduleContainer.querySelector('.multi-module-body');
                            const scenariosList = moduleContainer.querySelector('.module-scenario-list');
                            mHeader.addEventListener('click', () => {
                                const expanded = mHeader.getAttribute('aria-expanded') === 'true';
                                mHeader.setAttribute('aria-expanded', expanded ? 'false' : 'true');
                                mBody.hidden = expanded ? true : false;
                                try { mHeader.classList.toggle('is-expanded', !expanded); } catch (_e) { }
                            });
                            mHeader.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); mHeader.click(); } });

                            const scenarios = Array.isArray(moduleObj.scenarios) ? moduleObj.scenarios : [];
                            scenarios.forEach((scenario, sIdx) => {
                                const scenarioId = scenario && (scenario.id || scenario.scenarioId || scenario.scenario_id) ? String(scenario.id || scenario.scenarioId || scenario.scenario_id) : `p${pIdx}-m${mIdx}-s${sIdx}`;
                                const scenarioTitle = scenario && (scenario.title || scenario.name) ? String(scenario.title || scenario.name) : `Scenario ${scenarioId}`;

                                const parent = document.createElement('div');
                                parent.className = 'multi-scenario';
                                const sHeaderId = `scenario-${scenarioId}-header`;
                                const sBodyId = `scenario-${scenarioId}-body`;
                                parent.innerHTML = `
                                    <div class="multi-scenario-header" id="${sHeaderId}" role="button" aria-expanded="false" tabindex="0">
                                        <span class="multi-scenario-caret">▶</span>
                                        <span class="multi-scenario-title">${escapeHtml(scenarioTitle)}</span>
                                        <span class="multi-scenario-counts" aria-hidden="true"></span>
                                        <span class="multi-scenario-status" aria-hidden="true"></span>
                                    </div>
                                    <div class="multi-scenario-body" id="${sBodyId}" hidden>
                                        <div class="multi-list scenario-case-list"></div>
                                    </div>
                                `;
                                const sHeader = parent.querySelector('.multi-scenario-header');
                                const sBody = parent.querySelector('.multi-scenario-body');
                                const childList = parent.querySelector('.scenario-case-list');
                                sHeader.addEventListener('click', () => {
                                    const expanded = sHeader.getAttribute('aria-expanded') === 'true';
                                    sHeader.setAttribute('aria-expanded', expanded ? 'false' : 'true');
                                    sBody.hidden = expanded ? true : false;
                                    try { sHeader.classList.toggle('is-expanded', !expanded); } catch (_e) { }
                                });
                                sHeader.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); sHeader.click(); } });

                                const cases = Array.isArray(scenario.cases) ? scenario.cases : [];
                                cases.forEach((caseInfo) => {
                                    const domId = caseInfo.caseId || caseInfo.caseKey || `case-${globalIndex}-${globalIndex}`;
                                    const item = makeAccordionItem(domId, caseInfo.title || caseInfo.name || `Case ${domId}`);
                                    item.dataset.status = 'queued';
                                    if (caseInfo.caseId) item.dataset.caseId = String(caseInfo.caseId);
                                    if (caseInfo.caseKey) item.dataset.caseKey = String(caseInfo.caseKey);
                                    if (caseInfo.requestId) item.dataset.requestId = String(caseInfo.requestId);
                                    if (caseInfo.envId !== undefined && caseInfo.envId !== null && caseInfo.envId !== '') item.dataset.environmentId = String(caseInfo.envId);

                                    const key = caseInfo.caseId || (`__idx_${globalIndex}`);
                                    const infoCopy = Object.assign({}, caseInfo, { originalIndex: globalIndex, container: item });
                                    allCases.push(infoCopy);
                                    childList.appendChild(item);
                                    globalIndex += 1;
                                });

                                scenariosList.appendChild(parent);
                            });

                            modulesList.appendChild(moduleContainer);
                        });

                        list.appendChild(projectContainer);
                    });

                    // close handlers
                    const close = modal.querySelector('#project-multi-response-close');
                    if (close) close.addEventListener('click', () => { closeModal(modal); setTimeout(() => modal.remove(), 250); });
                    modal.addEventListener('click', (ev2) => { if (ev2.target === modal) { closeModal(modal); setTimeout(() => modal.remove(), 250); } });

                    openModal(modal);
                    try { refreshScenarioCounts(modal); } catch (_e) { }
                    try { updateModalTotals(modal); } catch (_e) { }

                    // Flatten and order by dependency then run sequentially
                    const ordered = orderCasesByDependency(allCases.slice());
                    const caseInfoById = new Map();
                    ordered.forEach((ci) => { if (ci.caseId) caseInfoById.set(ci.caseId, ci); });

                    const autoClose = options && typeof options.autoCloseOnFinish === 'boolean' ? options.autoCloseOnFinish : false;

                    // If a create promise exists, await it so the AutomationReport id
                    // is available to each execute payload. This prevents races where
                    // runs start before the report is created.
                    (async () => {
                        try {
                            if (modal && modal.__automation_report_promise) {
                                try { await modal.__automation_report_promise; } catch (_e) { /* ignore */ }
                            }
                        } catch (_e) { /* ignore */ }
                        return runSelectedCasesSequentially(ordered, caseInfoById, modal);
                    })()
                        .then(async () => {
                            try { if (autoClose) { closeModal(modal); setTimeout(() => modal.remove(), 250); } } catch (_e) { }
                            try { refreshScenarioCounts(modal); } catch (_e) { }
                            try { updateModalTotals(modal); } catch (_e) { }
                            try { console.log('[automation] scenario totals', collectAllScenarioTotals(modal)); } catch (_e) { }
                            // Attempt to finalize the AutomationReport for this modal
                            try {
                                const totals = collectAllScenarioTotals(modal) || { totals: { passed: 0, failed: 0, blocked: 0 } };
                                const rid = modal && modal.dataset && modal.dataset.automationReportId ? modal.dataset.automationReportId : (window.__lastAutomationReportId || null);
                                if (rid && typeof window.__automationFinalizeReport === 'function') {
                                    try { console.log('[automation] runProjectBatch: finalizing automation report', rid, totals.totals); } catch (_e) { }
                                    try { await window.__automationFinalizeReport(Number(rid), totals.totals); } catch (_e) { try { console.warn('[automation] runProjectBatch: finalize failed', _e); } catch (_e2) { } }
                                }
                            } catch (_e) { /* ignore finalize errors */ }
                            resolve(true);
                        })
                        .catch((err) => {
                            try { if (autoClose) { closeModal(modal); setTimeout(() => modal.remove(), 250); } } catch (_e) { }
                            try { refreshScenarioCounts(modal); } catch (_e) { }
                            try { updateModalTotals(modal); } catch (_e) { }
                            try { console.log('[automation] scenario totals (error)', collectAllScenarioTotals(modal)); } catch (_e) { }
                            reject(err);
                        });
                } catch (err) {
                    reject(err);
                }
            });
        };
    }
    function init() {
        // Delegated controls for view/mode/toggle inside the multi modal
        document.addEventListener('click', function (ev) {
            const t = ev.target;
            if (!t) return;
            // toggle-section
            const toggleBtn = t.closest && t.closest('button[data-action="toggle-section"]');
            if (toggleBtn) {
                const targetId = toggleBtn.getAttribute('data-target');
                if (!targetId) return;
                const el = document.getElementById(targetId);
                if (!el) return;
                if (el.hidden || el.style.display === 'none') { el.hidden = false; el.style.display = ''; }
                else { el.hidden = true; el.style.display = 'none'; }
                return;
            }

            // response body view buttons
            const viewBtn = t.closest && t.closest('button[data-response-body-view]');
            if (viewBtn) {
                const view = viewBtn.getAttribute('data-response-body-view');
                if (!view) return;
                const controls = viewBtn.closest && viewBtn.closest('.response-body__controls');
                if (!controls) return;
                Array.from(controls.querySelectorAll('button[data-response-body-view]')).forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-pressed', 'false'); });
                viewBtn.classList.add('is-active'); viewBtn.setAttribute('aria-pressed', 'true');
                const multiItem = viewBtn.closest && viewBtn.closest('.multi-item');
                if (multiItem) try { renderPanel(multiItem); } catch (e) { }
                return;
            }

            // response body mode buttons
            const modeBtn = t.closest && t.closest('button[data-response-body-mode]');
            if (modeBtn) {
                const mode = modeBtn.getAttribute('data-response-body-mode');
                if (!mode) return;
                const controls = modeBtn.closest && modeBtn.closest('.response-body__modes');
                if (!controls) return;
                Array.from(controls.querySelectorAll('button[data-response-body-mode]')).forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-pressed', 'false'); });
                modeBtn.classList.add('is-active'); modeBtn.setAttribute('aria-pressed', 'true');
                const multiItem2 = modeBtn.closest && modeBtn.closest('.multi-item');
                if (multiItem2) try { renderPanel(multiItem2); } catch (e) { }
                return;
            }
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

})();
