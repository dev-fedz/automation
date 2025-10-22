// Single-file testcase runner implementation
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

    let _lastResponse = { text: '', json: null };
    let _currentView = 'json';
    let _currentMode = 'pretty';

    function openModal() {
        const modal = document.getElementById('testcase-response-modal');
        if (!modal) return null;
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
        const loading = document.getElementById('testcase-response-loading');
        if (loading) loading.hidden = false;
        const content = document.getElementById('testcase-response-content');
        if (content) content.hidden = true;
        return modal;
    }

    function closeModal() {
        const modal = document.getElementById('testcase-response-modal');
        if (!modal) return;
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
    }

    function setSummary(text) {
        const el = document.getElementById('testcase-response-summary');
        if (el) el.textContent = text || '';
    }

    function setHeaders(obj) {
        const el = document.getElementById('testcase-response-headers');
        if (!el) return;
        try {
            el.textContent = JSON.stringify(obj || {}, null, 2);
        } catch (e) {
            el.textContent = String(obj || '');
        }
    }

    function setBody(bodyText, jsonObj) {
        const el = document.getElementById('testcase-response-body');
        const preview = document.getElementById('testcase-response-preview');
        if (!el) return;
        if (jsonObj !== null && jsonObj !== undefined) {
            try {
                el.textContent = JSON.stringify(jsonObj, null, 2);
            } catch (e) {
                el.textContent = String(jsonObj);
            }
            if (preview) preview.hidden = true;
            return;
        }
        try {
            const parsed = JSON.parse(bodyText || '');
            el.textContent = JSON.stringify(parsed, null, 2);
            if (preview) preview.hidden = true;
            return;
        } catch (e) {
            // not JSON
        }
        const looksLikeHtml = /<\s*html|<\s*div|<\s*span|<!DOCTYPE html/i.test(bodyText || '');
        if (looksLikeHtml && preview) {
            try {
                preview.hidden = false;
                if (preview.contentDocument) {
                    preview.contentDocument.open();
                    preview.contentDocument.write(bodyText || '');
                    preview.contentDocument.close();
                }
                el.textContent = (bodyText || '').slice(0, 20000);
            } catch (e) {
                preview.hidden = true;
                el.textContent = String(bodyText || '');
            }
            return;
        }
        el.textContent = String(bodyText || '');
        if (preview) preview.hidden = true;
    }

    function renderForTab(tab) {
        const pre = document.getElementById('testcase-response-body');
        const preview = document.getElementById('testcase-response-preview');
        if (!pre) return;
        switch (tab) {
            case 'json':
                if (_lastResponse.json) pre.textContent = JSON.stringify(_lastResponse.json, null, 2);
                else {
                    try {
                        pre.textContent = JSON.stringify(JSON.parse(_lastResponse.text || ''), null, 2);
                    } catch (e) {
                        pre.textContent = _lastResponse.text || '';
                    }
                }
                if (preview) preview.hidden = true;
                break;
            case 'xml':
                try {
                    const txt = _lastResponse.text || '';
                    pre.textContent = txt.replace(/>(\s*)</g, '>' + '\n' + '<').trim();
                } catch (e) {
                    pre.textContent = _lastResponse.text || '';
                }
                if (preview) preview.hidden = true;
                break;
            case 'html':
                if (_currentMode === 'preview') {
                    if (preview) {
                        try {
                            preview.hidden = false;
                            if (preview.contentDocument) {
                                preview.contentDocument.open();
                                preview.contentDocument.write(_lastResponse.text || '');
                                preview.contentDocument.close();
                            }
                        } catch (e) {
                            preview.hidden = true;
                        }
                        pre.textContent = (_lastResponse.text || '').slice(0, 20000);
                    }
                } else {
                    pre.textContent = _lastResponse.text || '';
                    if (preview) preview.hidden = true;
                }
                break;
            case 'pretty':
                if (_lastResponse.json) pre.textContent = JSON.stringify(_lastResponse.json, null, 2);
                else pre.textContent = _lastResponse.text || '';
                if (preview) preview.hidden = true;
                break;
            case 'raw':
                pre.textContent = _lastResponse.text || '';
                if (preview) preview.hidden = true;
                break;
            case 'preview':
                if (preview) {
                    try {
                        preview.hidden = false;
                        if (preview.contentDocument) {
                            preview.contentDocument.open();
                            preview.contentDocument.write(_lastResponse.text || '');
                            preview.contentDocument.close();
                        }
                    } catch (e) {
                        preview.hidden = true;
                    }
                    pre.textContent = (_lastResponse.text || '').slice(0, 20000);
                }
                break;
            default:
                pre.textContent = _lastResponse.text || '';
                if (preview) preview.hidden = true;
        }
    }

    async function runRequest(requestId) {
        openModal();
        setSummary('Running request...');
        const loading = document.getElementById('testcase-response-loading');
        if (loading) loading.hidden = false;
        const content = document.getElementById('testcase-response-content');
        if (content) content.hidden = true;

        let requestObj = null;
        try {
            const endpointsLocal = getJsonScript('automation-api-endpoints') || {};
            const requestsBase = endpointsLocal.requests || '/api/core/requests/';
            const reqUrl = requestsBase.endsWith('/') ? `${requestsBase}${requestId}/` : `${requestsBase}/${requestId}/`;
            const reqResp = await fetch(reqUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
            if (!reqResp.ok) throw new Error(`Unable to load request ${requestId}`);
            requestObj = await reqResp.json();
        } catch (err) {
            if (loading) loading.hidden = true;
            if (content) content.hidden = false;
            setSummary('Error');
            setHeaders({});
            setBody(String(err || 'Failed to load request details'));
            return;
        }

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

            try {
                const btn = document.querySelector(`button[data-action="run-case"][data-request-id="${requestId}"]`);
                const btnEnvId = btn ? btn.getAttribute('data-environment-id') : null;
                if (btnEnvId) {
                    const parsed = Number(btnEnvId);
                    payload.environment = Number.isFinite(parsed) ? parsed : btnEnvId;
                }
            } catch (e) { }

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
                    const endpointsLocal = getJsonScript('automation-api-endpoints') || {};
                    const collectionsBase = endpointsLocal.collections || '/api/core/collections/';
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
                            } catch (e) { }
                            if (!chosenEnv) chosenEnv = envs.find(e => e && e.variables && Object.prototype.hasOwnProperty.call(e.variables, 'non_realtime_mid') && Object.prototype.hasOwnProperty.call(e.variables, 'non_realtime_mkey')) || null;
                            if (!chosenEnv) chosenEnv = envs.find(e => e && e.variables && Object.prototype.hasOwnProperty.call(e.variables, 'non_realtime_mid')) || null;
                            if (!chosenEnv) chosenEnv = envs[0];
                            collectionVars = chosenEnv ? (chosenEnv.variables || {}) : {};
                            if ((!payload.environment || payload.environment === null || payload.environment === undefined) && chosenEnv && chosenEnv.id) payload.environment = chosenEnv.id;
                        }
                    }
                } catch (e) { }
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
                    } catch (e) { }
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
                            } catch (e) { }
                            return ov;
                        });
                    }
                    payload.body_transforms = cloned;
                }
            } catch (e) { }

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

        // CSRF
        let csrftoken = null;
        try {
            const name = 'csrftoken';
            const cparts = document.cookie.split(';').map(s => s.trim()).filter(Boolean);
            for (const p of cparts) {
                if (p.startsWith(name + '=')) {
                    csrftoken = decodeURIComponent(p.split('=')[1]);
                    break;
                }
            }
        } catch (e) {
            csrftoken = null;
        }

        try {
            if (payload.body_transforms) try { console.debug('testcase-run payload.body_transforms:', payload.body_transforms); } catch (e) { }
            else try { console.debug('testcase-run no body_transforms present'); } catch (e) { }

            const resp = await fetch(POST_URL, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    ...(csrftoken ? { 'X-CSRFToken': csrftoken } : {}),
                },
                body: JSON.stringify(payload),
            });

            const text = await resp.text();
            let data = null;
            try { data = JSON.parse(text); } catch (e) { data = null; }

            if (!resp.ok) {
                setSummary('Request failed: ' + resp.status + ' ' + resp.statusText);
                const loadingEl = document.getElementById('testcase-response-loading'); if (loadingEl) loadingEl.hidden = true;
                const contentEl = document.getElementById('testcase-response-content'); if (contentEl) contentEl.hidden = false;
                setHeaders(data && data.request_headers ? data.request_headers : {});
                setBody(data && data.error ? data.error : (text || ''), null);
                return;
            }

            const loadingEl = document.getElementById('testcase-response-loading'); if (loadingEl) loadingEl.hidden = true;
            const contentEl = document.getElementById('testcase-response-content'); if (contentEl) contentEl.hidden = false;

            const result = data || {};
            const statusCode = result.status_code || result.status || (result.response_status || null);
            const elapsed = result.elapsed_ms || result.response_time_ms || null;
            const resolvedUrl = result.resolved_url || (result.request && result.request.url) || '';
            setSummary('Status: ' + (statusCode || '') + (elapsed ? (' — ' + Math.round(elapsed) + 'ms') : '') + (resolvedUrl ? (' — ' + resolvedUrl) : ''));
            setHeaders(result.headers || result.response_headers || {});
            const bodyText = result.body || result.response_body || '';
            const jsonVal = result.json || null;
            _lastResponse.text = typeof bodyText === 'string' ? bodyText : (JSON.stringify(bodyText) || '');
            _lastResponse.json = jsonVal;
            setBody(_lastResponse.text, _lastResponse.json);
            renderForTab(_currentView);

            const assertionsEl = document.getElementById('testcase-response-assertions');
            if (assertionsEl) {
                assertionsEl.innerHTML = '';
                if (result.assertions_passed && result.assertions_passed.length) {
                    const ul = document.createElement('ul');
                    result.assertions_passed.forEach(a => { const li = document.createElement('li'); li.textContent = 'PASS: ' + (a || ''); ul.appendChild(li); });
                    assertionsEl.appendChild(ul);
                }
                if (result.assertions_failed && result.assertions_failed.length) {
                    const ul = document.createElement('ul');
                    result.assertions_failed.forEach(a => { const li = document.createElement('li'); li.textContent = 'FAIL: ' + (a || ''); ul.appendChild(li); });
                    assertionsEl.appendChild(ul);
                }
            }
        } catch (err) {
            const loadingEl = document.getElementById('testcase-response-loading'); if (loadingEl) loadingEl.hidden = true;
            const contentEl = document.getElementById('testcase-response-content'); if (contentEl) contentEl.hidden = false;
            setSummary('Error'); setHeaders({}); setBody(String(err || 'Request error'));
        }
    }

    function init() {
        document.addEventListener('click', function (ev) {
            const target = ev.target;
            if (!target) return;
            const btn = target.closest && target.closest('button[data-action="run-case"]');
            if (btn) {
                ev.preventDefault();
                const requestId = btn.getAttribute('data-request-id');
                if (!requestId) return;
                runRequest(requestId);
                return;
            }
        });

        const close = document.getElementById('testcase-response-close');
        if (close) close.addEventListener('click', closeModal);

        document.addEventListener('click', function (ev) {
            const t = ev.target;
            if (!t) return;
            const btn = t.closest && t.closest('button[data-action="toggle-section"]');
            if (btn) {
                const targetId = btn.getAttribute('data-target');
                if (!targetId) return;
                const el = document.getElementById(targetId);
                if (!el) return;
                if (el.hidden || el.style.display === 'none') { el.hidden = false; el.style.display = ''; }
                else { el.hidden = true; el.style.display = 'none'; }
                return;
            }

            const viewBtn = t.closest && t.closest('button[data-response-body-view]');
            if (viewBtn) {
                const view = viewBtn.getAttribute('data-response-body-view');
                if (!view) return;
                _currentView = view;
                const container = viewBtn.parentElement;
                if (container) Array.from(container.querySelectorAll('button[data-response-body-view]')).forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-pressed', 'false'); });
                viewBtn.classList.add('is-active'); viewBtn.setAttribute('aria-pressed', 'true');
                try { renderForTab(_currentView); } catch (e) { }
                return;
            }

            const modeBtn = t.closest && t.closest('button[data-response-body-mode]');
            if (modeBtn) {
                const mode = modeBtn.getAttribute('data-response-body-mode');
                if (!mode) return;
                _currentMode = mode;
                const container = modeBtn.parentElement;
                if (container) Array.from(container.querySelectorAll('button[data-response-body-mode]')).forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-pressed', 'false'); });
                modeBtn.classList.add('is-active'); modeBtn.setAttribute('aria-pressed', 'true');
                try {
                    if (_currentMode === 'preview') renderForTab('preview'); else renderForTab(_currentView);
                } catch (e) { }
                return;
            }
        });

        let activeResizer = null;
        let startY = 0;
        let startHeight = 0;
        document.addEventListener('mousedown', function (ev) {
            const r = ev.target && ev.target.closest && ev.target.closest('.resizer');
            if (!r) return;
            const targetId = r.getAttribute('data-resize-target');
            if (!targetId) return;
            const target = document.getElementById(targetId);
            if (!target) return;
            activeResizer = { target };
            startY = ev.clientY;
            startHeight = target.getBoundingClientRect().height;
            ev.preventDefault();
        });
        document.addEventListener('mousemove', function (ev) {
            if (!activeResizer) return;
            try {
                const dy = ev.clientY - startY;
                const newH = Math.max(20, startHeight + dy);
                activeResizer.target.style.height = newH + 'px';
                activeResizer.target.style.maxHeight = 'none';
            } catch (e) { }
        });
        document.addEventListener('mouseup', function () { if (activeResizer) activeResizer = null; });

        document.addEventListener('click', function (ev) {
            const modal = document.getElementById('testcase-response-modal');
            if (!modal || modal.hidden) return;
            if (ev.target === modal) { closeModal(); }
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

})();
