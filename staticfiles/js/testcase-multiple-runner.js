// Multi-testcase runner: builds a modal with accordions for each selected case and runs their related API requests
(function () {
    'use strict';

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
    const DEFAULT_PRE_CONSOLE_MESSAGE = 'No pre-request console output.';
    const DEFAULT_POST_CONSOLE_MESSAGE = 'No post-request console output.';

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
                    <button type="button" id="testcase-multi-response-close" class="modal-close" aria-label="Close">×</button>
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
        } else {
            if (statusEl) {
                statusEl.textContent = 'Passed';
            }
            if (summaryEl) {
                const baseSummary = summaryEl.dataset.baseSummary || summaryEl.textContent.trim();
                summaryEl.textContent = baseSummary ? `${baseSummary} · Completed.` : 'Completed.';
            }
            container.dataset.status = 'passed';
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
            const resp = await fetch(POST_URL, {
                method: 'POST',
                credentials: 'same-origin',
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

    async function runSelectedCasesSequentially(caseList, caseInfoById) {
        const resultsByCaseId = new Map();
        let haltReason = null;

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

                    runSelectedCasesSequentially(ordered, caseInfoById)
                        .then(() => { try { closeModal(modal); setTimeout(() => modal.remove(), 250); } catch (_e) { }; resolve(true); })
                        .catch((err) => { try { closeModal(modal); setTimeout(() => modal.remove(), 250); } catch (_e) { }; reject(err); });
                } catch (err) {
                    reject(err);
                }
            });
        };
        // mark initialized flag
        window.__automationMultiRunner._initialized = true;
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
