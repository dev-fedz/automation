// Multi-testcase runner: builds a modal with accordions for each selected case and runs their related API requests
(function () {
    'use strict';

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

    function createModal() {
        // remove existing if present
        const existing = document.getElementById('testcase-multi-response-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'testcase-multi-response-modal';
        modal.setAttribute('aria-hidden', 'true');
        modal.tabIndex = -1;

        modal.innerHTML = `
            <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="testcase-multi-response-title">
                <div class="modal-header">
                    <h3 id="testcase-multi-response-title">Run Selected Test Cases</h3>
                    <button type="button" id="testcase-multi-response-close" class="btn btn-tertiary">Close</button>
                </div>
                <div class="modal-body">
                    <div id="testcase-multi-list" class="multi-list"></div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        return modal;
    }

    function openModal(modal) {
        if (!modal) return;
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
    }

    function closeModal(modal) {
        if (!modal) return;
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
    }

    function makeAccordionItem(caseId, caseTitle) {
        const idSafe = String(caseId).replace(/[^a-zA-Z0-9\-_]/g, '-');
        const headerId = `tc-${idSafe}-header`;
        const bodyId = `tc-${idSafe}-body`;
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
                        <h4>Headers</h4>
                        <pre class="response-pre response-headers" data-min-height="80">{}</pre>
                    </div>
                    <div class="response-section">
                        <h4>Body</h4>
                        <pre class="response-pre response-body" data-min-height="100">{}</pre>
                        <iframe class="response-preview" title="Response preview" hidden></iframe>
                    </div>
                    <div class="response-section">
                        <h4>Assertions</h4>
                        <div class="assertions-list"></div>
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

    async function executeForPanel(requestId, envId, container) {
        const statusEl = container.querySelector('.multi-item-status');
        const loadingEl = container.querySelector('.response-loading');
        const contentEl = container.querySelector('.response-content');
        const summaryEl = container.querySelector('.response-summary');
        const headersEl = container.querySelector('.response-headers');
        const bodyEl = container.querySelector('.response-body');
        const preview = container.querySelector('.response-preview');
        const assertionsEl = container.querySelector('.assertions-list');

        if (!requestId) {
            statusEl.textContent = 'No related API request';
            loadingEl.hidden = true;
            contentEl.hidden = false;
            summaryEl.textContent = 'No request configured for this test case.';
            return;
        }

        statusEl.textContent = 'Loading request details…';

        // load request object
        let requestObj = null;
        try {
            const requestsBase = endpoints.requests || '/api/core/requests/';
            const reqUrl = requestsBase.endsWith('/') ? `${requestsBase}${requestId}/` : `${requestsBase}/${requestId}/`;
            const reqResp = await fetch(reqUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
            if (!reqResp.ok) throw new Error('Unable to load request');
            requestObj = await reqResp.json();
        } catch (err) {
            statusEl.textContent = 'Error loading request';
            loadingEl.hidden = true;
            contentEl.hidden = false;
            summaryEl.textContent = String(err || 'Failed to load request details');
            return;
        }

        statusEl.textContent = 'Running…';

        // build payload (simplified reuse of existing logic)
        const payload = { request_id: requestId };
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
            if (envId) payload.environment = envId;
            // simple auth handling
            if (requestObj.auth_type === 'basic' && requestObj.auth_basic) {
                try { const token = btoa(`${requestObj.auth_basic.username || ''}:${requestObj.auth_basic.password || ''}`); payload.headers = payload.headers || {}; payload.headers['Authorization'] = `Basic ${token}`; } catch (e) { }
            }
            if (requestObj.auth_type === 'bearer' && requestObj.auth_bearer) {
                payload.headers = payload.headers || {}; payload.headers['Authorization'] = `Bearer ${requestObj.auth_bearer}`;
            }
        } catch (e) { }

        // CSRF
        let csrftoken = null;
        try {
            const name = 'csrftoken';
            const cparts = document.cookie.split(';').map(s => s.trim()).filter(Boolean);
            for (const p of cparts) { if (p.startsWith(name + '=')) { csrftoken = decodeURIComponent(p.split('=')[1]); break; } }
        } catch (e) { csrftoken = null; }

        try {
            const resp = await fetch(POST_URL, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', ...(csrftoken ? { 'X-CSRFToken': csrftoken } : {}) },
                body: JSON.stringify(payload),
            });

            const text = await resp.text();
            let data = null; try { data = JSON.parse(text); } catch (e) { data = null; }

            if (!resp.ok) {
                statusEl.textContent = 'Request failed: ' + resp.status;
                loadingEl.hidden = true;
                contentEl.hidden = false;
                headersEl.textContent = JSON.stringify(data && data.request_headers ? data.request_headers : {}, null, 2);
                bodyEl.textContent = data && data.error ? data.error : (text || '');
                return;
            }

            const result = data || {};
            const statusCode = result.status_code || result.status || (result.response_status || null);
            const elapsed = result.elapsed_ms || result.response_time_ms || null;
            const resolvedUrl = result.resolved_url || (result.request && result.request.url) || '';
            summaryEl.textContent = 'Status: ' + (statusCode || '') + (elapsed ? (' — ' + Math.round(elapsed) + 'ms') : '') + (resolvedUrl ? (' — ' + resolvedUrl) : '');
            headersEl.textContent = JSON.stringify(result.headers || result.response_headers || {}, null, 2);
            const bodyText = result.body || result.response_body || '';
            // try JSON
            try { const parsed = typeof bodyText === 'string' ? JSON.parse(bodyText) : bodyText; bodyEl.textContent = JSON.stringify(parsed, null, 2); } catch (e) { bodyEl.textContent = String(bodyText || ''); }
            // preview if html
            const looksLikeHtml = /<\s*html|<\s*div|<\s*span|<!DOCTYPE html/i.test(String(bodyText || ''));
            if (looksLikeHtml && preview) {
                try { preview.hidden = false; if (preview.contentDocument) { preview.contentDocument.open(); preview.contentDocument.write(bodyText || ''); preview.contentDocument.close(); } }
                catch (e) { preview.hidden = true; }
            } else if (preview) preview.hidden = true;

            assertionsEl.innerHTML = '';
            if (result.assertions_passed && result.assertions_passed.length) {
                const ul = document.createElement('ul'); result.assertions_passed.forEach(a => { const li = document.createElement('li'); li.textContent = 'PASS: ' + (a || ''); ul.appendChild(li); }); assertionsEl.appendChild(ul);
            }
            if (result.assertions_failed && result.assertions_failed.length) {
                const ul = document.createElement('ul'); result.assertions_failed.forEach(a => { const li = document.createElement('li'); li.textContent = 'FAIL: ' + (a || ''); ul.appendChild(li); }); assertionsEl.appendChild(ul);
            }

            statusEl.textContent = 'Complete';
            loadingEl.hidden = true;
            contentEl.hidden = false;

        } catch (err) {
            statusEl.textContent = 'Error';
            loadingEl.hidden = true;
            contentEl.hidden = false;
            summaryEl.textContent = String(err || 'Request error');
        }
    }

    function collectSelectedCases() {
        const boxes = Array.from(document.querySelectorAll('input.case-checkbox')).filter(b => b.checked);
        const cases = [];
        boxes.forEach(b => {
            const caseId = b.getAttribute('data-case-id') || (b.closest && b.closest('tr') && b.closest('tr').getAttribute('data-case-id')) || null;
            let title = '';
            const tr = b.closest && b.closest('tr');
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
                if (btn) { requestId = btn.getAttribute('data-request-id'); envId = btn.getAttribute('data-environment-id'); }
            } catch (e) { }
            cases.push({ caseId, title, requestId, envId });
        });
        return cases;
    }

    function init() {
        document.addEventListener('click', function (ev) {
            const t = ev.target;
            if (!t) return;
            const btn = t.closest && t.closest('#run-cases-btn');
            if (!btn) return;

            ev.preventDefault();
            const selected = collectSelectedCases();
            if (!selected.length) return;

            const modal = createModal();
            const list = modal.querySelector('#testcase-multi-list');
            selected.forEach((c) => {
                const item = makeAccordionItem(c.caseId || ('case-' + Math.random().toString(36).slice(2)), c.title || 'Untitled');
                list.appendChild(item);
                // kick off execution async (don't await)
                (async () => { await executeForPanel(c.requestId, c.envId, item); })();
            });

            // close handler
            const close = modal.querySelector('#testcase-multi-response-close');
            if (close) close.addEventListener('click', () => { closeModal(modal); setTimeout(() => modal.remove(), 250); });

            // clicking backdrop closes
            modal.addEventListener('click', (ev2) => { if (ev2.target === modal) { closeModal(modal); setTimeout(() => modal.remove(), 250); } });

            openModal(modal);
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

})();
