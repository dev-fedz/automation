// Single-file testcase runner implementation
// Single-file testcase runner implementation
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

    let _lastResponse = { text: '', json: null };
    let _currentView = 'json';
    let _currentMode = 'pretty';
    let _currentExpectedResults = [];
    let _currentCaseOptions = {
        responseEncrypted: false,
    };
    let _lastFocusedBeforeModal = null;
    const DEFAULT_PRE_CONSOLE_MESSAGE = 'No pre-request console output.';
    const DEFAULT_POST_CONSOLE_MESSAGE = 'No post-request console output.';

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
                // fall through and return trimmed string
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
                const colonIndex = trimmed.indexOf(':');
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

    if (typeof window !== 'undefined') {
        if (window.__automationLastPreScript === undefined) {
            window.__automationLastPreScript = null;
        }
        if (window.__automationLastRequestSnapshot === undefined) {
            window.__automationLastRequestSnapshot = null;
        }
        if (window.__automationLastPayload === undefined) {
            window.__automationLastPayload = null;
        }
        if (window.__automationLastScriptStores === undefined) {
            window.__automationLastScriptStores = null;
        }
        if (!Array.isArray(window.__automationDiagnosticsLog)) {
            window.__automationDiagnosticsLog = [];
        }
    }

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
                    mirrorAutomationLog(level, '[automation][testcase-runner] ' + message);
                } else {
                    mirrorAutomationLog(level, '[automation][testcase-runner] ' + message, extra);
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

    const publishSingleRunDiagnostics = ({
        payload,
        requestSnapshot,
        scriptContext,
        scriptStores,
        overrides,
        stage,
    }) => {
        try {
            const preScriptSnapshot = scriptContext ? normalizeDiagnosticsValue(scriptContext) : null;
            const requestSnapshotClone = requestSnapshot ? normalizeDiagnosticsValue(requestSnapshot) : null;
            const payloadClone = normalizeDiagnosticsValue(payload);
            const storeClone = scriptStores ? normalizeDiagnosticsValue(scriptStores) : null;
            const overridesClone = overrides ? normalizeDiagnosticsValue(overrides) : null;

            window.__automationLastPreScript = preScriptSnapshot;
            window.__automationLastRequestSnapshot = requestSnapshotClone;
            window.__automationLastPayload = payloadClone;
            window.__automationLastScriptStores = storeClone;

            try {
                const log = window.__automationDiagnosticsLog;
                if (Array.isArray(log)) {
                    log.push({
                        type: 'single-run',
                        stage: stage || 'unknown',
                        timestamp: Date.now(),
                        payload: payloadClone,
                        request: requestSnapshotClone,
                        stores: storeClone,
                        overrides: overridesClone,
                    });
                    while (log.length > 50) {
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
            const next = {};
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
            // ignore collection errors
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
                // ignore resolution failure
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
                // ignore
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
                // ignore placeholder collection issues
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
            if (payload.body && typeof scriptHelpers.collectJsonTemplatePlaceholders === 'function') {
                const refs = scriptHelpers.collectJsonTemplatePlaceholders({ __body: payload.body }) || [];
                refs.forEach((ref) => {
                    if (!ref || !ref.key) {
                        return;
                    }
                    const value = getLookupValue(ref.key);
                    if (value === undefined) {
                        return;
                    }
                    const patternSource = String.raw`\\{\\{\\s*${escapeRegex(ref.key)}\\s*\\}\\}`;
                    const pattern = new RegExp(patternSource, 'g');
                    try {
                        payload.body = payload.body.replace(pattern, typeof value === 'string' ? value : String(value));
                    } catch (_replaceError) {
                        // ignore string replacement issues
                    }
                });
            }
        }

        return { overrides, stores: lookupStores };
    };
    const normalizeExpectedResultsEntries = automationHelpers.normalizeExpectedResultsEntries || fallbackNormalizeExpectedResultsEntries;
    const coerceExpectedResultValue = automationHelpers.coerceExpectedResultValue || fallbackCoerceExpectedResultValue;

    const splitPath = (path) => {
        if (!path) {
            return [];
        }
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
    };

    const getNestedValue = (data, path) => {
        const segments = splitPath(path);
        if (!segments.length) {
            return undefined;
        }
        let current = data;
        for (let i = 0; i < segments.length; i += 1) {
            if (current === null || current === undefined) {
                return undefined;
            }
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
    };

    const describeAssertionValue = (value) => {
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
    };

    const DECRYPTED_KEY_CANDIDATES = [
        'decrypteddata',
        'decryptedpayload',
        'decrypteddatabody',
        'decryptedresponse',
        'decryptedbody',
        'responsedecrypted',
        'bodydecrypted',
    ];

    const normalizeDecryptedKey = (key) => {
        if (!key && key !== 0) {
            return '';
        }
        return String(key)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '');
    };

    const parseDecryptedScalar = (value) => {
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
    };

    const tryParseDecryptedFromString = (value) => {
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
    };

    const findDecryptedValueInStore = (store) => {
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
    };

    const extractDecryptedPayload = ({ scriptContext, templatingStores, testsScript }) => {
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
    };

    const deepEqual = (left, right) => {
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
    };

    const valuesEqual = (actual, expected) => {
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
    };

    const extractExpectedAssertions = (entries) => {
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
    };

    const buildEvaluationContext = (runResult) => {
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
    };

    const evaluateExpectedResults = (entries, runResult) => {
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
    };

    const renderExpectedAssertions = (assertionsEl, evaluation) => {
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
            if ((trimmed.startsWith('{') || trimmed.startsWith('['))) {
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

    const applyEvaluationOutcome = (evaluation) => {
        const summaryEl = document.getElementById('testcase-response-summary');
        if (summaryEl && !summaryEl.dataset.baseSummary) {
            summaryEl.dataset.baseSummary = summaryEl.textContent ? summaryEl.textContent.trim() : '';
        }
        const assertionsEl = document.getElementById('testcase-response-assertions');
        renderExpectedAssertions(assertionsEl, evaluation);
        if (evaluation && evaluation.evaluated) {
            const failedCount = evaluation.assertions.filter((detail) => !detail.passed).length;
            const total = evaluation.assertions.length;
            const suffix = failedCount ? `Assertions failed (${failedCount}/${total}).` : 'Assertions passed.';
            if (summaryEl) {
                const baseSummary = summaryEl.dataset.baseSummary || '';
                summaryEl.textContent = baseSummary ? `${baseSummary} · ${suffix}` : suffix;
                summaryEl.classList.toggle('assertions-failed', failedCount > 0);
            }
        } else if (summaryEl) {
            const baseSummary = summaryEl.dataset.baseSummary || summaryEl.textContent.trim();
            summaryEl.textContent = baseSummary ? `${baseSummary} · Completed.` : 'Completed.';
            summaryEl.classList.remove('assertions-failed');
        }
    };

    function openModal() {
        const modal = document.getElementById('testcase-response-modal');
        if (!modal) return null;
        try {
            const activeEl = document.activeElement;
            if (activeEl && typeof activeEl.closest === 'function' && !modal.contains(activeEl)) {
                _lastFocusedBeforeModal = activeEl;
            } else if (activeEl && (!activeEl.closest || !modal.contains(activeEl))) {
                _lastFocusedBeforeModal = activeEl;
            }
        } catch (_error) {
            _lastFocusedBeforeModal = null;
        }
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
        const loading = document.getElementById('testcase-response-loading');
        if (loading) loading.hidden = false;
        const content = document.getElementById('testcase-response-content');
        if (content) content.hidden = true;
        window.setTimeout(() => {
            try {
                let focusTarget = modal.querySelector('.modal-close');
                if (!focusTarget) {
                    const dialog = modal.querySelector('.modal-dialog');
                    if (dialog) {
                        if (!dialog.hasAttribute('tabindex')) {
                            dialog.setAttribute('tabindex', '-1');
                        }
                        focusTarget = dialog;
                    }
                }
                if (!focusTarget) {
                    if (!modal.hasAttribute('tabindex')) {
                        modal.setAttribute('tabindex', '-1');
                    }
                    focusTarget = modal;
                }
                if (focusTarget && typeof focusTarget.focus === 'function') {
                    focusTarget.focus({ preventScroll: true });
                }
            } catch (_error) {
                /* ignore focus errors */
            }
        }, 0);
        return modal;
    }

    function closeModal() {
        const modal = document.getElementById('testcase-response-modal');
        if (!modal) return;
        try {
            const closeBtn = modal.querySelector('.modal-close');
            if (closeBtn && typeof closeBtn.blur === 'function') {
                closeBtn.blur();
            }
        } catch (_error) {
            /* ignore blur issues */
        }
        let restoreTarget = null;
        if (_lastFocusedBeforeModal) {
            try {
                if (typeof document.contains === 'function' && document.contains(_lastFocusedBeforeModal)) {
                    restoreTarget = _lastFocusedBeforeModal;
                } else if (document.body && typeof document.body.contains === 'function' && document.body.contains(_lastFocusedBeforeModal)) {
                    restoreTarget = _lastFocusedBeforeModal;
                }
            } catch (_error) {
                restoreTarget = null;
            }
        }
        if (!restoreTarget) {
            try {
                restoreTarget = document.querySelector('button[data-action="run-case"]');
            } catch (_error) {
                restoreTarget = null;
            }
        }
        if (restoreTarget && typeof restoreTarget.focus === 'function') {
            try {
                restoreTarget.focus({ preventScroll: true });
            } catch (_error) {
                try {
                    restoreTarget.focus();
                } catch (_err) {
                    /* ignore */
                }
            }
        }
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
        _lastFocusedBeforeModal = null;
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

    // Sanitize HTML before writing into the preview iframe to prevent
    // the embedded response from fetching external SPA client assets
    // (for example /_next chunks). This removes <script> tags and
    // modulepreload/preload <link> tags, and injects a restrictive
    // inline Content-Security-Policy into the document head.
    function sanitizeHtmlForPreview(html) {
        if (!html || typeof html !== 'string') return '';
        try {
            let s = html;
            // strip script tags
            s = s.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
            // remove modulepreload / preload links
            s = s.replace(/<link[^>]+rel=["']?(modulepreload|preload)["']?[^>]*>/gi, '');

            // Do NOT inject a CSP meta tag here — injecting restrictive CSPs can
            // block inline styles and images in legitimate preview documents and
            // lead to confusing errors. Stripping scripts and preload links is
            // sufficient to prevent the preview from attempting to load Next.js
            // client chunks.
            if (/<head[^>]*>/i.test(s)) {
                return s;
            }
            if (/<html[^>]*>/i.test(s)) {
                return s;
            }
            // wrap in minimal document if no html/head present
            return '<!doctype html><html><head></head><body>' + s + '</body></html>';
        } catch (e) {
            return '';
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
                    try {
                        preview.contentDocument.write(sanitizeHtmlForPreview(bodyText || ''));
                    } catch (e) {
                        // fallback to raw write if something unexpected happens
                        preview.contentDocument.write(bodyText || '');
                    }
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

    const stringifyConsoleArg = (value, seen) => {
        if (value === null || value === undefined) {
            return String(value);
        }
        const valueType = typeof value;
        if (valueType === 'string') {
            return value;
        }
        if (valueType === 'number' || valueType === 'boolean' || valueType === 'bigint') {
            return String(value);
        }
        if (value instanceof Error) {
            return value.stack || value.message || String(value);
        }
        if (valueType === 'function') {
            return `[function ${value.name || 'anonymous'}]`;
        }
        if (valueType === 'object') {
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
        let rawArgs = [];
        if (Array.isArray(entry.args) && entry.args.length) {
            rawArgs = entry.args;
        } else if (entry && typeof entry === 'object') {
            if (Object.prototype.hasOwnProperty.call(entry, 'message')) {
                rawArgs = [entry.message];
            } else if (Object.prototype.hasOwnProperty.call(entry, 'msg')) {
                rawArgs = [entry.msg];
            } else if (Object.prototype.hasOwnProperty.call(entry, 'data')) {
                rawArgs = [entry.data];
            }
        }
        if (!rawArgs.length) {
            rawArgs = [entry];
        }
        const seen = typeof WeakSet === 'function' ? new WeakSet() : null;
        const parts = rawArgs
            .map((value) => stringifyConsoleArg(value, seen))
            .filter((value) => value !== null && value !== undefined && value !== '')
            .map((value) => String(value));
        const message = parts.join(' ');
        if (!message) {
            return `[${level}]`;
        }
        return `[${level}] ${message}`;
    };

    const setConsoleSection = (elementId, logs, extraMessages, emptyMessage) => {
        const el = document.getElementById(elementId);
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
            el.textContent = emptyMessage;
            el.dataset.hasLogs = 'false';
        }
    };

    function setPreRequestLogs(logs, extraMessages) {
        setConsoleSection('testcase-pre-request-logs', logs, extraMessages, DEFAULT_PRE_CONSOLE_MESSAGE);
    }

    function setPostRequestLogs(logs, extraMessages) {
        setConsoleSection('testcase-post-request-logs', logs, extraMessages, DEFAULT_POST_CONSOLE_MESSAGE);
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
                                try {
                                    preview.contentDocument.write(sanitizeHtmlForPreview(_lastResponse.text || ''));
                                } catch (e) {
                                    preview.contentDocument.write(_lastResponse.text || '');
                                }
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
                            try {
                                preview.contentDocument.write(sanitizeHtmlForPreview(_lastResponse.text || ''));
                            } catch (e) {
                                preview.contentDocument.write(_lastResponse.text || '');
                            }
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
        const summaryEl = document.getElementById('testcase-response-summary');
        if (summaryEl) {
            delete summaryEl.dataset.baseSummary;
        }
        const loading = document.getElementById('testcase-response-loading');
        if (loading) loading.hidden = false;
        const content = document.getElementById('testcase-response-content');
        if (content) content.hidden = true;
        const assertionsEl = document.getElementById('testcase-response-assertions');
        if (assertionsEl) assertionsEl.innerHTML = '';

        let latestPreLogs = [];
        let latestPreExtras = [];
        let latestPostLogs = [];
        let latestPostExtras = [];
        const syncConsoleOutputs = () => {
            setPreRequestLogs(latestPreLogs, latestPreExtras);
            setPostRequestLogs(latestPostLogs, latestPostExtras);
        };
        syncConsoleOutputs();

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
        let overridesApplied = null;
        let scriptContext = null;
        let decryptedPayload = null;
        let requestSnapshot = null;
        const scriptHelpers = await ensureScriptRunnerReady();
        let selectedEnvironment = null;
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
                const m = v.match(/^\{\{\s*([\w\.]\-]+)\s*\}\}$/);
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
                            selectedEnvironment = chosenEnv;
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

        publishSingleRunDiagnostics({
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
            if (loading) loading.hidden = true;
            if (content) content.hidden = false;
            setSummary('Pre-request script unavailable');
            setHeaders({});
            setBody('Unable to execute the pre-request script because the script runner helpers failed to load. Refresh the page and try again.');
            applyEvaluationOutcome({ evaluated: false, passed: false, assertions: [] });
            latestPreLogs = [];
            latestPreExtras = ['Pre-request script unavailable.'];
            syncConsoleOutputs();
            return;
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
                if (scriptContext && Array.isArray(scriptContext.logs)) {
                    latestPreLogs = scriptContext.logs.slice();
                    latestPreExtras = [];
                    syncConsoleOutputs();
                }
            } catch (error) {
                if (loading) loading.hidden = true;
                if (content) content.hidden = false;
                const message = error instanceof Error ? error.message : String(error);
                setSummary('Pre-request script error');
                setHeaders({});
                setBody(`Pre-request script error: ${message}`);
                applyEvaluationOutcome({ evaluated: false, passed: false, assertions: [] });
                const existingLogs = scriptContext && Array.isArray(scriptContext.logs) ? scriptContext.logs.slice() : [];
                latestPreLogs = existingLogs;
                latestPreExtras = [`Pre-request script error: ${message}`];
                syncConsoleOutputs();
                return;
            }
        } else if (!requestSnapshot) {
            requestSnapshot = buildScriptRequestSnapshot(requestObj, scriptHelpers);
        }

        let templatingResult = null;
        if (scriptContext) {
            templatingResult = applyScriptContextToPayload(payload, scriptContext, scriptHelpers);
            if (templatingResult && templatingResult.overrides && Object.keys(templatingResult.overrides).length) {
                payload.overrides = { ...(payload.overrides || {}), ...templatingResult.overrides };
                overridesApplied = { ...(overridesApplied || {}), ...templatingResult.overrides };
            }
            try {
                publishSingleRunDiagnostics({
                    payload,
                    requestSnapshot,
                    scriptContext,
                    scriptStores: templatingResult ? templatingResult.stores : null,
                    overrides: overridesApplied,
                    stage: 'templating-applied',
                });
            } catch (_error) { /* ignore */ }
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
            mirrorAutomationLog('info', '[automation][testcase-runner] pre-request script logs', scriptContext.logs);
        }

        publishSingleRunDiagnostics({
            payload,
            requestSnapshot,
            scriptContext,
            scriptStores: templatingResult ? templatingResult.stores : null,
            overrides: overridesApplied,
            stage: 'pre-fetch',
        });

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
            if (payload.body_transforms) {
                mirrorAutomationLog('debug', 'testcase-run payload.body_transforms:', payload.body_transforms);
            } else {
                mirrorAutomationLog('debug', 'testcase-run no body_transforms present');
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
                if (!requestSnapshot) {
                    requestSnapshot = buildScriptRequestSnapshot(requestObj, scriptHelpers);
                }
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
                setSummary('Request failed: ' + resp.status + ' ' + resp.statusText);
                const loadingEl = document.getElementById('testcase-response-loading'); if (loadingEl) loadingEl.hidden = true;
                const contentEl = document.getElementById('testcase-response-content'); if (contentEl) contentEl.hidden = false;
                setHeaders(result && result.request_headers ? result.request_headers : {});
                setBody(result && result.error ? result.error : (text || ''), null);
                const preLogsForFailure = Array.isArray(result?.pre_request_logs)
                    ? result.pre_request_logs.slice()
                    : (Array.isArray(scriptContext?.logs) ? scriptContext.logs.slice() : []);
                const aggregatedPostLogs = [];
                if (Array.isArray(result?.tests_script?.logs)) {
                    aggregatedPostLogs.push(...result.tests_script.logs);
                }
                if (Array.isArray(result?.post_request_logs)) {
                    aggregatedPostLogs.push(...result.post_request_logs);
                }
                latestPreLogs = preLogsForFailure;
                latestPreExtras = [];
                latestPostLogs = aggregatedPostLogs;
                const postExtras = [];
                if (result?.tests_script && result.tests_script.error) {
                    postExtras.push(`Tests script error: ${result.tests_script.error}`);
                }
                if (result?.post_request_error) {
                    postExtras.push(`Post-request error: ${result.post_request_error}`);
                }
                latestPostExtras = postExtras;
                syncConsoleOutputs();
                return;
            }

            const loadingEl = document.getElementById('testcase-response-loading'); if (loadingEl) loadingEl.hidden = true;
            const contentEl = document.getElementById('testcase-response-content'); if (contentEl) contentEl.hidden = false;

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
            const expectedSource = Array.isArray(result.expected_results) ? result.expected_results : _currentExpectedResults;
            _currentExpectedResults = normalizeExpectedResultsEntries(expectedSource || []);
            if (_currentCaseOptions.responseEncrypted) {
                decryptedPayload = extractDecryptedPayload({
                    scriptContext,
                    templatingStores: templatingResult ? templatingResult.stores : null,
                    testsScript: result.tests_script,
                });
                if (decryptedPayload !== null && decryptedPayload !== undefined && decryptedPayload !== '') {
                    result.decrypted_payload = decryptedPayload;
                }
            }
            const evaluation = evaluateExpectedResults(_currentExpectedResults, {
                statusCode,
                elapsed,
                responseData: _lastResponse.json,
                responseText: _lastResponse.text,
                result,
                overridesApplied,
                decryptedData: decryptedPayload,
                responseEncrypted: Boolean(_currentCaseOptions.responseEncrypted),
            });
            applyEvaluationOutcome(evaluation);
            const preLogsForSuccess = Array.isArray(result?.pre_request_logs)
                ? result.pre_request_logs.slice()
                : (Array.isArray(scriptContext?.logs) ? scriptContext.logs.slice() : []);
            const aggregatedPostLogs = [];
            if (Array.isArray(result?.tests_script?.logs)) {
                aggregatedPostLogs.push(...result.tests_script.logs);
            }
            if (Array.isArray(result?.post_request_logs)) {
                aggregatedPostLogs.push(...result.post_request_logs);
            }
            latestPreLogs = preLogsForSuccess;
            latestPreExtras = [];
            latestPostLogs = aggregatedPostLogs;
            const postExtrasSuccess = [];
            if (result?.tests_script && result.tests_script.error) {
                postExtrasSuccess.push(`Tests script error: ${result.tests_script.error}`);
            }
            if (result?.post_request_error) {
                postExtrasSuccess.push(`Post-request error: ${result.post_request_error}`);
            }
            latestPostExtras = postExtrasSuccess;
            syncConsoleOutputs();
        } catch (err) {
            const loadingEl = document.getElementById('testcase-response-loading'); if (loadingEl) loadingEl.hidden = true;
            const contentEl = document.getElementById('testcase-response-content'); if (contentEl) contentEl.hidden = false;
            setSummary('Error'); setHeaders({}); setBody(String(err || 'Request error'));
            applyEvaluationOutcome({ evaluated: false, passed: false, assertions: [] });
            const message = err instanceof Error ? err.message : String(err || 'Request error');
            if (!latestPreLogs.length && Array.isArray(scriptContext?.logs)) {
                latestPreLogs = scriptContext.logs.slice();
            }
            if (!Array.isArray(latestPreExtras)) {
                latestPreExtras = [];
            }
            const postExtrasCatch = Array.isArray(latestPostExtras) ? latestPostExtras.slice() : [];
            postExtrasCatch.push(`Request error: ${message}`);
            latestPostExtras = postExtrasCatch;
            syncConsoleOutputs();
        }
    }

    function parseBooleanAttribute(value) {
        if (value === null || value === undefined) {
            return false;
        }
        const normalized = String(value).trim().toLowerCase();
        if (!normalized) {
            return false;
        }
        return normalized === 'true' || normalized === '1' || normalized === 'yes';
    }

    function runCaseFromElement(buttonElement) {
        if (!buttonElement || typeof buttonElement.getAttribute !== 'function') {
            return;
        }
        const requestId = buttonElement.getAttribute('data-request-id');
        if (!requestId) {
            return;
        }
        let row = null;
        try {
            row = typeof buttonElement.closest === 'function' ? buttonElement.closest('tr') : null;
        } catch (_error) {
            row = null;
        }
        let expectedRaw = null;
        try {
            const inlineExpected = buttonElement.getAttribute('data-expected-results');
            if (inlineExpected) {
                expectedRaw = inlineExpected;
            } else if (row && typeof row.getAttribute === 'function') {
                expectedRaw = row.getAttribute('data-expected-results') || null;
            }
        } catch (_error) {
            expectedRaw = null;
        }

        let responseEncrypted = false;
        try {
            let attr = buttonElement.getAttribute('data-response-encrypted');
            if ((attr === null || attr === undefined) && row && typeof row.getAttribute === 'function') {
                attr = row.getAttribute('data-response-encrypted');
            }
            if (attr !== null && attr !== undefined) {
                responseEncrypted = parseBooleanAttribute(attr);
            }
        } catch (_error) {
            responseEncrypted = false;
        }

        let requiresDependency = false;
        let dependencyId = '';
        let dependencyKey = '';
        try {
            let attr = buttonElement.getAttribute('data-requires-dependency');
            if ((attr === null || attr === undefined) && row && typeof row.getAttribute === 'function') {
                attr = row.getAttribute('data-requires-dependency');
            }
            requiresDependency = parseBooleanAttribute(attr);
            let depIdAttr = buttonElement.getAttribute('data-dependency-id');
            if ((!depIdAttr || depIdAttr === '0') && row && typeof row.getAttribute === 'function') {
                depIdAttr = row.getAttribute('data-dependency-id');
            }
            if (depIdAttr) {
                dependencyId = depIdAttr;
            }
            let depKeyAttr = buttonElement.getAttribute('data-dependency-key');
            if ((!depKeyAttr || depKeyAttr === '0') && row && typeof row.getAttribute === 'function') {
                depKeyAttr = row.getAttribute('data-dependency-key');
            }
            if (depKeyAttr) {
                dependencyKey = depKeyAttr;
            }
        } catch (_error) {
            requiresDependency = false;
            dependencyId = '';
            dependencyKey = '';
        }

        if (requiresDependency) {
            const messageParts = ['Run blocked: this test case requires a dependency and cannot run individually.'];
            if (dependencyId) {
                messageParts.push(`Dependency case: ${dependencyId}`);
            }
            if (dependencyKey) {
                messageParts.push(`Required key: ${dependencyKey}`);
            }
            const message = messageParts.join(' ');
            mirrorAutomationLog('warn', '[automation][testcase-runner] ' + message);
            try {
                if (typeof window !== 'undefined' && typeof window.alert === 'function') {
                    window.alert(message);
                }
            } catch (_alertError) {
                /* ignore alert issues */
            }
            return;
        }

        _currentCaseOptions = { responseEncrypted };
        _currentExpectedResults = normalizeExpectedResultsEntries(expectedRaw || []);
        // Prevent duplicate runs when the same button's click is handled both inline
        // (onclick attribute) and via delegated event listeners. Use a short
        // re-entrancy guard on the element's dataset.
        try {
            const ds = buttonElement.dataset || {};
            if (ds.automationRunning === '1') {
                // Already running — ignore duplicate invocation
                return;
            }
            if (ds) ds.automationRunning = '1';
        } catch (_e) {
            /* ignore dataset issues */
        }
        // Clear the guard when the runRequest promise settles.
        try {
            const p = runRequest(requestId);
            if (p && typeof p.finally === 'function') {
                p.finally(() => {
                    try {
                        if (buttonElement && buttonElement.dataset) delete buttonElement.dataset.automationRunning;
                    } catch (_err) { /* ignore */ }
                });
            } else {
                // Fallback: clear after short delay
                setTimeout(() => {
                    try { if (buttonElement && buttonElement.dataset) delete buttonElement.dataset.automationRunning; } catch (_err) { }
                }, 1500);
            }
        } catch (_e) {
            try { if (buttonElement && buttonElement.dataset) delete buttonElement.dataset.automationRunning; } catch (_err) { }
        }
    }

    function toggleSectionVisibility(targetId) {
        if (!targetId) {
            return;
        }
        const el = document.getElementById(targetId);
        if (!el) {
            return;
        }
        if (el.hidden || el.style.display === 'none') {
            el.hidden = false;
            el.style.display = '';
        } else {
            el.hidden = true;
            el.style.display = 'none';
        }
    }

    function setResponseView(view) {
        if (!view) {
            return;
        }
        _currentView = view;
        try {
            const buttons = document.querySelectorAll('button[data-response-body-view]');
            buttons.forEach((btn) => {
                const btnView = btn.getAttribute('data-response-body-view');
                if (btnView === view) {
                    btn.classList.add('is-active');
                    btn.setAttribute('aria-pressed', 'true');
                } else {
                    btn.classList.remove('is-active');
                    btn.setAttribute('aria-pressed', 'false');
                }
            });
        } catch (_error) {
            /* ignore UI sync issues */
        }
        try {
            renderForTab(_currentView);
        } catch (_error) {
            /* ignore render errors */
        }
    }

    function setResponseMode(mode) {
        if (!mode) {
            return;
        }
        _currentMode = mode;
        try {
            const buttons = document.querySelectorAll('button[data-response-body-mode]');
            buttons.forEach((btn) => {
                const btnMode = btn.getAttribute('data-response-body-mode');
                if (btnMode === mode) {
                    btn.classList.add('is-active');
                    btn.setAttribute('aria-pressed', 'true');
                } else {
                    btn.classList.remove('is-active');
                    btn.setAttribute('aria-pressed', 'false');
                }
            });
        } catch (_error) {
            /* ignore UI sync issues */
        }
        try {
            if (_currentMode === 'preview') {
                renderForTab('preview');
            } else {
                renderForTab(_currentView);
            }
        } catch (_error) {
            /* ignore render errors */
        }
    }

    function init() {
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
    }

    if (typeof window !== 'undefined') {
        window.__automationTestcaseControls = {
            runCaseFromElement,
            runRequest,
            toggleSectionVisibility,
            setResponseView,
            setResponseMode,
            closeModal,
        };
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

})();
