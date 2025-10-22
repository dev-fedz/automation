(function () {
    // Minimal runner for test-case "Run" button
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
    const executeUrl = endpoints.tester_execute || endpoints.tester_execute || window.__automation_execute_url || null;
    // fallback: look for known endpoint key used elsewhere
    const executeCandidate = endpoints['tester_execute'] || endpoints['tester.execute'] || endpoints['execute'] || null;

    const finalExecuteUrl = executeUrl || executeCandidate || (function () {
        // Check if a global URL is present in the page (some pages put api_endpoints differently)
        const el = document.getElementById('automation-api-endpoints');
        if (el) {
            try {
                const payload = JSON.parse(el.textContent || el.innerText || '{}');
                return payload['tester_execute'] || payload['tester.execute'] || payload['execute'] || payload['tester_execute_url'] || null;
            } catch (e) {
                return null;
            }
        }
        return null;
    })();

    // The app route for ad-hoc execution is mounted under /api/core/; use that as fallback
    const fallbackUrl = '/api/core/tester/execute/';
    const POST_URL = finalExecuteUrl || fallbackUrl;

    const qs = (obj) => Object.keys(obj).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k])).join('&');

    function findRunButtons() {
        return Array.from(document.querySelectorAll('button[data-action="run-case"]'));
    }

    function openModal() {
        const modal = document.getElementById('testcase-response-modal');
        if (!modal) return null;
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
        // ensure loading visible
        document.getElementById('testcase-response-loading').hidden = false;
        document.getElementById('testcase-response-content').hidden = true;
        return modal;
    }
    function closeModal() {
        const modal = document.getElementById('testcase-response-modal');
        if (!modal) return;
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
    }

    function setSummary(summaryText) {
        const el = document.getElementById('testcase-response-summary');
        if (el) el.textContent = summaryText || '';
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
            if (preview) { preview.hidden = true; }
            return;
        }
        // attempt to pretty print as JSON if possible
        try {
            const parsed = JSON.parse(bodyText || '');
            el.textContent = JSON.stringify(parsed, null, 2);
            if (preview) preview.hidden = true;
            return;
        } catch (e) {
            // not json
        }
        // If content looks like HTML, show preview iframe
        const looksLikeHtml = /<\s*html|<\s*div|<\s*span|<!DOCTYPE html/i.test(bodyText || '');
        if (looksLikeHtml && preview) {
            try {
                preview.hidden = false;
                const doc = preview.contentWindow || preview.contentDocument;
                if (preview.contentDocument) preview.contentDocument.open(), preview.contentDocument.write(bodyText || ''), preview.contentDocument.close();
                el.textContent = (bodyText || '').slice(0, 20000);
            } catch (e) {
                preview.hidden = true;
                el.textContent = String(bodyText || '');
            }
            return;
        }
        // fallback: display raw text
        el.textContent = String(bodyText || '');
        if (preview) preview.hidden = true;
    }

    async function runRequest(requestId) {
        const modal = openModal();
        setSummary('Running request...');
        document.getElementById('testcase-response-loading').hidden = false;
        document.getElementById('testcase-response-content').hidden = true;

        // First, fetch the ApiRequest details so we can provide a full payload
        // to the ad-hoc execute endpoint (the endpoint requires a URL).
        let requestObj = null;
        try {
            const endpoints = getJsonScript('automation-api-endpoints') || {};
            const requestsBase = endpoints.requests || '/api/core/requests/';
            const reqUrl = requestsBase.endsWith('/') ? `${requestsBase}${requestId}/` : `${requestsBase}/${requestId}/`;
            const reqResp = await fetch(reqUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
            if (!reqResp.ok) {
                throw new Error(`Unable to load request ${requestId}`);
            }
            requestObj = await reqResp.json();
        } catch (err) {
            document.getElementById('testcase-response-loading').hidden = true;
            document.getElementById('testcase-response-content').hidden = false;
            setSummary('Error');
            setHeaders({});
            setBody(String(err || 'Failed to load request details'));
            return;
        }

        // Build execute payload from the ApiRequest object
        const payload = { request_id: requestId };
        try {
            payload.method = requestObj.method || 'GET';
            payload.url = requestObj.url || '';
            payload.headers = requestObj.headers || {};
            // ApiRequest serializer uses 'query_params' name
            payload.params = requestObj.query_params || {};
            // Map body depending on body_type
            if (requestObj.body_type === 'json' && requestObj.body_json) {
                payload.json = requestObj.body_json;
            } else if (requestObj.body_type === 'form' && requestObj.body_form) {
                // convert object to form_data entries expected by the execute endpoint
                const formEntries = [];
                Object.entries(requestObj.body_form || {}).forEach(([k, v]) => {
                    formEntries.push({ key: k, type: 'text', value: v });
                });
                payload.form_data = formEntries;
            } else if (requestObj.body_type === 'raw' && requestObj.body_raw) {
                payload.body = requestObj.body_raw;
            }
            // timeout in seconds (ApiRequest stores ms)
            if (typeof requestObj.timeout_ms === 'number') {
                payload.timeout = Math.max(1, (requestObj.timeout_ms || 30000) / 1000);
            }
            if (requestObj.collection_id) {
                payload.collection_id = requestObj.collection_id;
            }
            // If the Run button has an explicit environment selection, prefer it
            try {
                const btn = document.querySelector(`button[data-action="run-case"][data-request-id="${requestId}"]`);
                const btnEnvId = btn ? btn.getAttribute('data-environment-id') : null;
                if (btnEnvId) {
                    // keep numeric id as number when possible
                    const parsed = Number(btnEnvId);
                    payload.environment = Number.isFinite(parsed) ? parsed : btnEnvId;
                }
            } catch (e) { /* ignore */ }
            // Resolve auth placeholders if necessary by inspecting collection environments
            const resolveTemplate = (v, vars) => {
                if (!v || typeof v !== 'string') return v;
                const m = v.match(/^\{\{\s*([\w\.\-]+)\s*\}\}$/);
                if (!m) return v;
                const key = m[1];
                if (vars && Object.prototype.hasOwnProperty.call(vars, key)) {
                    return vars[key];
                }
                return v;
            };
            // only fetch collection variables if auth fields contain templates
            let collectionVars = null;
            const needsResolve = () => {
                if (!requestObj) return false;
                try {
                    if (requestObj.auth_type === 'basic' && requestObj.auth_basic) {
                        const ab = requestObj.auth_basic || {};
                        const u = typeof ab.username === 'string' ? ab.username : '';
                        const p = typeof ab.password === 'string' ? ab.password : '';
                        if (/^\{\{.*\}\}$/.test(u) || /^\{\{.*\}\}$/.test(p)) return true;
                    }
                    if (requestObj.auth_type === 'bearer' && typeof requestObj.auth_bearer === 'string') {
                        if (/^\{\{.*\}\}$/.test(requestObj.auth_bearer)) return true;
                    }
                } catch (e) { /* ignore */ }
                return false;
            };
            if (requestObj.collection_id) {
                try {
                    const endpoints = getJsonScript('automation-api-endpoints') || {};
                    const collectionsBase = endpoints.collections || '/api/core/collections/';
                    const colUrl = collectionsBase.endsWith('/') ? `${collectionsBase}${requestObj.collection_id}/` : `${collectionsBase}/${requestObj.collection_id}/`;
                    const colResp = await fetch(colUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
                    if (colResp.ok) {
                        const colData = await colResp.json();
                        // collection.environments is an array of ApiEnvironment objects (with variables)
                        const envs = Array.isArray(colData.environments) ? colData.environments : [];
                        if (envs.length) {
                            // Prefer an explicit environment id set on the Run button
                            let chosenEnv = null;
                            try {
                                const btn = document.querySelector(`button[data-action="run-case"][data-request-id="${requestId}"]`);
                                const btnEnvId = btn ? btn.getAttribute('data-environment-id') : null;
                                if (btnEnvId) {
                                    const parsed = envs.find(e => String(e.id) === String(btnEnvId));
                                    if (parsed) chosenEnv = parsed;
                                }
                            } catch (e) { /* ignore */ }

                            // If no explicit button selection, prefer an environment that contains both
                            // non_realtime_mid and non_realtime_mkey (strong match). If none, fall back to
                            // any env that contains at least non_realtime_mid.
                            if (!chosenEnv) {
                                chosenEnv = envs.find(e => e && e.variables && Object.prototype.hasOwnProperty.call(e.variables, 'non_realtime_mid') && Object.prototype.hasOwnProperty.call(e.variables, 'non_realtime_mkey')) || null;
                            }
                            if (!chosenEnv) {
                                chosenEnv = envs.find(e => e && e.variables && Object.prototype.hasOwnProperty.call(e.variables, 'non_realtime_mid')) || null;
                            }

                            // fallback to first env
                            if (!chosenEnv) chosenEnv = envs[0];

                            collectionVars = chosenEnv.variables || {};
                            // include explicit environment id in payload so server uses it
                            // If the payload already contains an explicit environment (from the Run button),
                            // do not override it with the collection-chosen environment. This ensures the
                            // button-level selection is authoritative.
                            if ((!payload.environment || payload.environment === null || payload.environment === undefined) && chosenEnv && chosenEnv.id) {
                                payload.environment = chosenEnv.id;
                            }
                        }
                    }
                } catch (e) { /* ignore */ }
            }
            // apply resolution to auth fields
            if (requestObj.auth_type === 'basic' && requestObj.auth_basic) {
                const ab = requestObj.auth_basic || {};
                const resolvedUsername = resolveTemplate(typeof ab.username === 'string' ? ab.username : '', collectionVars);
                const resolvedPassword = resolveTemplate(typeof ab.password === 'string' ? ab.password : '', collectionVars);
                // include basic auth in headers if present
                if (resolvedUsername || resolvedPassword) {
                    try {
                        const token = btoa(`${resolvedUsername}:${resolvedPassword}`);
                        payload.headers = payload.headers || {};
                        payload.headers['Authorization'] = `Basic ${token}`;
                    } catch (e) { /* ignore */ }
                }
            }
            // If the ApiRequest contains body_transforms (overrides/signatures), include them in the execute payload.
            // For any override marked as isRandom, compute the final value here to preserve the randomization semantics
            // (server-side transform logic doesn't currently implement isRandom/charLimit client behavior).
            try {
                const transforms = requestObj.body_transforms || null;
                if (transforms && typeof transforms === 'object') {
                    // clone to avoid mutating original
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
                                    // remove helper fields so server sees only path/value/signature fields it expects
                                    delete ov.isRandom;
                                    delete ov.charLimit;
                                }
                            } catch (e) {
                                // ignore per-row errors
                            }
                            return ov;
                        });
                    }
                    payload.body_transforms = cloned;
                }
            } catch (e) { /* best-effort */ }
            if (requestObj.auth_type === 'bearer' && requestObj.auth_bearer) {
                const resolved = resolveTemplate(requestObj.auth_bearer, collectionVars);
                if (resolved) {
                    payload.headers = payload.headers || {};
                    payload.headers['Authorization'] = `Bearer ${resolved}`;
                }
            }
        } catch (e) {
            // best-effort: continue with minimal payload
        }

        let csrftoken = null;
        // try to read CSRF token from cookie
        try {
            const name = 'csrftoken';
            const cparts = document.cookie.split(';').map(s => s.trim()).filter(Boolean);
            for (const p of cparts) {
                if (p.startsWith(name + '=')) {
                    csrftoken = decodeURIComponent(p.split('=')[1]);
                    break;
                }
            }
        } catch (e) { csrftoken = null; }

        try {
            // Debugging: show what transforms will be posted (if any)
            if (payload.body_transforms) {
                try { console.debug('testcase-run payload.body_transforms:', payload.body_transforms); } catch (e) { }
            } else {
                try { console.debug('testcase-run no body_transforms present'); } catch (e) { }
            }

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
                document.getElementById('testcase-response-loading').hidden = true;
                document.getElementById('testcase-response-content').hidden = false;
                setHeaders(data && data.request_headers ? data.request_headers : {});
                setBody(data && data.error ? data.error : (text || ''), null);
                return;
            }

            // successful
            document.getElementById('testcase-response-loading').hidden = true;
            document.getElementById('testcase-response-content').hidden = false;

            // server returns {status_code, headers, body, json, elapsed_ms, resolved_url, request, ...}
            const result = data || {};
            const statusCode = result.status_code || result.status || (result.response_status || null);
            const elapsed = result.elapsed_ms || result.response_time_ms || null;
            const resolvedUrl = result.resolved_url || (result.request && result.request.url) || '';
            setSummary('Status: ' + (statusCode || '') + (elapsed ? (' — ' + Math.round(elapsed) + 'ms') : '') + (resolvedUrl ? (' — ' + resolvedUrl) : ''));
            setHeaders(result.headers || result.response_headers || {});
            setBody(result.body || result.response_body || '', result.json || null);
            // assertions are not executed client-side here; if server returns assertions info, show it
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
            document.getElementById('testcase-response-loading').hidden = true;
            document.getElementById('testcase-response-content').hidden = false;
            setSummary('Error');
            setHeaders({});
            setBody(String(err || 'Request error'));
        }
    }

    function init() {
        // Use event delegation so buttons added dynamically are handled.
        document.addEventListener('click', function (ev) {
            const target = ev.target;
            if (!target) return;
            // check for the button itself or an inner element inside the button
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
        // click outside modal to close
        document.addEventListener('click', function (ev) {
            const modal = document.getElementById('testcase-response-modal');
            if (!modal || modal.hidden) return;
            if (ev.target === modal) { closeModal(); }
        });
    }

    // initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
