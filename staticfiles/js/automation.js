(function () {
    const shouldMirrorAutomationLog = (level) => {
        if (level === 'error') {
            return true;
        }
        try {
            return Boolean(typeof window !== 'undefined' && window.__automationDebugMode);
        } catch (_error) {
            return false;
        }
    };

    const automationLog = (level, ...args) => {
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

    const escapeHtml = (value) => {
        if (value === null || value === undefined) {
            return "";
        }
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    };

    const splitList = (raw) => {
        if (!raw) {
            return [];
        }
        return raw
            .split(/[\,\n]/)
            .map((item) => item.trim())
            .filter(Boolean);
    };

    const sanitizeRichText = (value) => {
        if (!value) {
            return '';
        }
        const html = String(value);
        if (window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
            const config = {
                USE_PROFILES: { html: true },
                ALLOWED_URI_REGEXP: /^(?!(?:javascript|data):)/i,
                ADD_ATTR: ['style', 'class', 'target', 'rel'],
                ALLOW_ARIA_ATTR: true,
                ALLOW_DATA_ATTR: true,
            };
            return window.DOMPurify.sanitize(html, config);
        }
        return html;
    };

    const extractPlainText = (value) => {
        if (!value) {
            return '';
        }
        const temp = document.createElement('div');
        temp.innerHTML = value;
        return (temp.textContent || temp.innerText || '').trim();
    };

    const getCsrfToken = () => {
        const name = "csrftoken=";
        const cookies = document.cookie ? document.cookie.split(";") : [];
        for (let i = 0; i < cookies.length; i += 1) {
            const cookie = cookies[i].trim();
            if (cookie.startsWith(name)) {
                return decodeURIComponent(cookie.substring(name.length));
            }
        }
        const meta = document.querySelector('meta[name="csrf-token"]');
        if (meta) {
            return meta.getAttribute('content') || '';
        }
        return '';
    };

    const flattenMessages = (value) => {
        if (!value) {
            return [];
        }
        if (Array.isArray(value)) {
            return value.reduce((acc, item) => acc.concat(flattenMessages(item)), []);
        }
        if (typeof value === 'object') {
            return Object.values(value).reduce((acc, item) => acc.concat(flattenMessages(item)), []);
        }
        return [String(value)];
    };

    const parseJsonTextarea = (raw, fieldLabel) => {
        if (!raw || !raw.trim()) {
            return {};
        }
        try {
            const value = JSON.parse(raw);
            return value && typeof value === 'object' ? value : {};
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Invalid JSON value';
            throw new Error(`${fieldLabel}: ${message}`);
        }
    };

    const coerceExpectedResultValue = (raw) => {
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
                // fall through to return raw string
            }
        }
        return trimmed;
    };

    const stringifyExpectedResultValue = (value) => {
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

    const normalizeExpectedResultsEntries = (value) => {
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
                    entries.push({ [key]: coerceExpectedResultValue(valuePart) });
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
                return;
            }
        });
        return entries;
    };

    const parseExpectedResultsTextarea = (raw) => {
        if (!raw || !raw.trim()) {
            return [];
        }
        const lines = raw.split(/\n/);
        const entries = [];
        lines.forEach((line, idx) => {
            const trimmed = line.trim();
            if (!trimmed) {
                return;
            }
            if (trimmed.startsWith('#')) {
                const note = trimmed.slice(1).trim();
                if (note) {
                    entries.push({ note });
                }
                return;
            }
            let separatorIndex = trimmed.indexOf(':');
            if (separatorIndex === -1) {
                separatorIndex = trimmed.indexOf('=');
            }
            if (separatorIndex === -1) {
                throw new Error(`Expected result line ${idx + 1} must use "key: value" or "key=value" format.`);
            }
            const key = trimmed.slice(0, separatorIndex).trim();
            if (!key) {
                throw new Error(`Expected result line ${idx + 1} must include a key before the separator.`);
            }
            const valuePart = trimmed.slice(separatorIndex + 1).trim();
            entries.push({ [key]: coerceExpectedResultValue(valuePart) });
        });
        return entries;
    };

    const formatExpectedResultsTextarea = (entries) => {
        if (!Array.isArray(entries) || !entries.length) {
            return '';
        }
        const lines = [];
        entries.forEach((entry) => {
            if (!entry && entry !== 0) {
                return;
            }
            if (typeof entry === 'string') {
                if (entry.trim()) {
                    lines.push(entry.trim());
                }
                return;
            }
            if (entry && typeof entry === 'object') {
                const keys = Object.keys(entry);
                if (!keys.length) {
                    return;
                }
                if (keys.length === 1) {
                    const key = keys[0];
                    if (key === 'note') {
                        const noteVal = stringifyExpectedResultValue(entry[key]);
                        if (noteVal) {
                            lines.push(`# ${noteVal}`);
                        }
                    } else {
                        lines.push(`${key}: ${stringifyExpectedResultValue(entry[key])}`);
                    }
                    return;
                }
                keys.forEach((key) => {
                    if (key === 'note') {
                        const noteVal = stringifyExpectedResultValue(entry[key]);
                        if (noteVal) {
                            lines.push(`# ${noteVal}`);
                        }
                    } else {
                        lines.push(`${key}: ${stringifyExpectedResultValue(entry[key])}`);
                    }
                });
            }
        });
        return lines.join('\n');
    };

    window.__automationHelpers = Object.assign({}, window.__automationHelpers || {}, {
        parseExpectedResultsTextarea,
        formatExpectedResultsTextarea,
        normalizeExpectedResultsEntries,
        coerceExpectedResultValue,
        stringifyExpectedResultValue,
    });

    const formatStructuredValue = (value) => {
        if (value === null || value === undefined) {
            return '';
        }
        if (typeof value === 'object' && !Array.isArray(value)) {
            const keys = Object.keys(value);
            if (keys.length === 1) {
                const key = keys[0];
                if (key === 'note') {
                    return formatStructuredValue(value[key]);
                }
                return `${key}: ${formatStructuredValue(value[key])}`;
            }
        }
        if (typeof value === 'string') {
            return value;
        }
        if (Array.isArray(value)) {
            return value.map((item) => formatStructuredValue(item)).filter(Boolean).join(', ');
        }
        try {
            return JSON.stringify(value);
        } catch (_err) {
            return String(value);
        }
    };

    const debounce = (fn, delay) => {
        let timeoutId;
        return (...args) => {
            window.clearTimeout(timeoutId);
            timeoutId = window.setTimeout(() => fn(...args), delay);
        };
    };

    const formatDateTime = (value) => {
        if (!value) {
            return "--";
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return "--";
        }
        return date.toLocaleString();
    };

    document.addEventListener('DOMContentLoaded', () => {
        automationLog('info', '[automation] automation.js DOMContentLoaded handler running');
        const root = document.getElementById('automation-app');
        if (!root) {
            return;
        }

        const responseCloseBtn = document.getElementById('testcase-response-close');
        if (responseCloseBtn) {
            responseCloseBtn.addEventListener('click', () => {
                try {
                    if (window.__automationTestcaseControls && typeof window.__automationTestcaseControls.closeModal === 'function') {
                        window.__automationTestcaseControls.closeModal();
                    }
                } catch (_error) {
                    /* ignore close errors */
                }
            });
        }

        const readScriptJson = (id) => {
            const node = document.getElementById(id);
            if (!node) {
                return null;
            }
            const payload = node.textContent || node.innerText || 'null';
            try {
                return JSON.parse(payload);
            } catch (error) {
                // eslint-disable-next-line no-console
                console.warn(`[automation] Failed to parse ${id}:`, error);
                return null;
            }
        };

        const initialPlans = readScriptJson('automation-initial-plans') || [];
        const apiEndpoints = readScriptJson('automation-api-endpoints') || {};

        const els = {
            status: root.querySelector('[data-role="status"]'),
            planList: root.querySelector('[data-role="plan-list"]'),
            scenarioList: root.querySelector('[data-role="scenario-list"]'),
            scenarioTableBody: root.querySelector('[data-role="scenario-table-body"]'),
            caseList: root.querySelector('[data-role="case-list"]'),
            maintenanceList: root.querySelector('[data-role="maintenance-list"]'),
            planName: root.querySelector('[data-role="selected-plan-name"]'),
            scenarioName: root.querySelector('[data-role="selected-scenario-name"]'),
            caseSummary: root.querySelector('[data-role="case-summary"]'),
            planForm: document.getElementById('automation-plan-form'),
            scenarioForm: document.getElementById('automation-scenario-form'),
            scenarioSearch: document.getElementById('scenario-search'),
            scenarioPlan: document.getElementById('scenario-plan'),
            caseForm: document.getElementById('automation-case-form'),
            casePlanSelect: document.getElementById('case-plan-select'),
            caseModuleSelect: document.getElementById('case-module-select'),
            caseScenarioSelect: document.getElementById('case-scenario-select'),
            // modal elements (selectors present in Test Cases template)
            caseSelectionModal: document.querySelector('[data-role="case-selection-modal"]'),
            caseSelectionModalDialog: document.querySelector('[data-role="case-selection-modal-dialog"]'),
            modalCasePlan: document.querySelector('[data-role="modal-case-plan"]'),
            modalCaseModule: document.querySelector('[data-role="modal-case-module"]'),
            modalCaseScenario: document.querySelector('[data-role="modal-case-scenario"]'),
            caseSelectionContinue: document.getElementById('case-selection-continue'),
            caseSelectedScenarioHidden: document.getElementById('case-selected-scenario-id'),
            maintenanceForm: document.getElementById('automation-maintenance-form'),
            planModal: root.querySelector('[data-role="plan-modal"]'),
            planModalDialog: root.querySelector('[data-role="plan-modal-dialog"]'),
            planModalTrigger: root.querySelector('[data-action="open-plan-modal"]'),
            planFormReset: root.querySelector('[data-action="reset-plan-form"]'),
            scenarioFormReset: root.querySelector('[data-action="reset-scenario-form"]'),
            caseFormReset: root.querySelector('[data-action="reset-case-form"]'),
            maintenanceFormReset: root.querySelector('[data-action="reset-maintenance-form"]'),
            planRiskMatrix: document.getElementById('plan-risk-matrix'),
        };

        const planModalCloseButtons = Array.from(root.querySelectorAll('[data-action="close-plan-modal"]'));
        const body = document.body;

        const dependencyControls = {
            checkbox: document.getElementById('module-add-case-requires-dependency'),
            fields: Array.from(document.querySelectorAll('[data-role="dependency-fields"]')),
            select: document.getElementById('module-add-case-dependency-id'),
            key: document.getElementById('module-add-case-dependency-key'),
        };
        const dependencyOptionsCache = new Map();

        const ensureTrailingSlash = (value) => {
            if (!value) {
                return '';
            }
            return value.endsWith('/') ? value : `${value}/`;
        };

        const buildUrl = (base, params) => {
            if (!params) {
                return base;
            }
            const searchParams = new URLSearchParams();
            Object.entries(params).forEach(([key, raw]) => {
                if (raw === undefined || raw === null) {
                    return;
                }
                const value = String(raw);
                if (!value.trim()) {
                    return;
                }
                searchParams.append(key, value);
            });
            const suffix = searchParams.toString();
            if (!suffix) {
                return base;
            }
            return `${base}?${suffix}`;
        };

        const getCasesEndpoint = () => ensureTrailingSlash(apiEndpoints.cases || '/api/core/test-cases/');

        const toggleDependencyFields = (force, options = {}) => {
            const settings = { preserveValues: false, ...options };
            const show = typeof force === 'boolean'
                ? force
                : !!(dependencyControls.checkbox && dependencyControls.checkbox.checked);
            dependencyControls.fields.forEach((node) => {
                if (!node) {
                    return;
                }
                node.hidden = !show;
            });
            if (dependencyControls.select) {
                dependencyControls.select.disabled = !show;
                if (!show && !settings.preserveValues) {
                    dependencyControls.select.value = '';
                }
            }
            if (dependencyControls.key) {
                dependencyControls.key.disabled = !show;
                if (!show && !settings.preserveValues) {
                    dependencyControls.key.value = '';
                }
            }
        };

        const extractCases = (payload) => {
            if (!payload) {
                return [];
            }
            if (Array.isArray(payload)) {
                return payload;
            }
            if (payload && Array.isArray(payload.results)) {
                return payload.results;
            }
            return [];
        };

        const loadDependencyOptions = async (scenarioId, excludeId = null) => {
            if (!dependencyControls.select) {
                return;
            }
            const select = dependencyControls.select;
            select.innerHTML = '<option value="">(no dependency)</option>';
            if (!scenarioId) {
                select.disabled = true;
                return;
            }
            const allowSelection = !!(dependencyControls.checkbox && dependencyControls.checkbox.checked);
            select.disabled = !allowSelection;
            const cacheKey = Number.isFinite(Number(scenarioId)) ? Number(scenarioId) : String(scenarioId);
            let cached = dependencyOptionsCache.get(cacheKey);
            if (!cached) {
                try {
                    const url = buildUrl(getCasesEndpoint(), { scenario: scenarioId });
                    const resp = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
                    if (!resp.ok) {
                        throw new Error(`Failed to load dependency options (${resp.status})`);
                    }
                    const data = await resp.json().catch(() => null);
                    cached = extractCases(data);
                } catch (error) {
                    cached = [];
                    try {
                        // eslint-disable-next-line no-console
                        console.warn('[automation] Unable to load dependency options:', error);
                    } catch (err) {
                        /* ignore */
                    }
                }
                dependencyOptionsCache.set(cacheKey, cached || []);
            }
            (cached || []).forEach((testCase) => {
                if (!testCase || testCase.id === undefined || testCase.id === null) {
                    return;
                }
                if (excludeId && Number(testCase.id) === Number(excludeId)) {
                    return;
                }
                const option = document.createElement('option');
                option.value = testCase.id;
                const parts = [];
                if (testCase.testcase_id) {
                    parts.push(testCase.testcase_id);
                }
                if (testCase.title) {
                    parts.push(testCase.title);
                }
                if (!parts.length) {
                    parts.push(`Case #${testCase.id}`);
                }
                option.textContent = parts.join(' — ');
                select.appendChild(option);
            });
        };

        if (dependencyControls.checkbox) {
            dependencyControls.checkbox.addEventListener('change', () => {
                const checked = !!dependencyControls.checkbox.checked;
                toggleDependencyFields(checked, { preserveValues: true });
                if (checked) {
                    const scenarioInput = document.getElementById('module-add-case-scenario-id');
                    const hiddenId = document.getElementById('module-add-case-testcase-id');
                    const scenarioId = scenarioInput && scenarioInput.value ? scenarioInput.value : null;
                    if (scenarioId) {
                        const exclude = hiddenId && hiddenId.value ? hiddenId.value : null;
                        loadDependencyOptions(scenarioId, exclude);
                    }
                }
            });
        }

        toggleDependencyFields(false, { preserveValues: true });

        const inputs = {
            plan: {
                name: document.getElementById('plan-name'),
                objective: document.getElementById('plan-objective-editor'),
                description: document.getElementById('plan-description'),
                scopeIn: document.getElementById('plan-scope-in'),
                scopeOut: document.getElementById('plan-scope-out'),
                tools: document.getElementById('plan-tools'),
                functional: document.getElementById('plan-functional'),
                nonFunctional: document.getElementById('plan-non-functional'),
                testers: document.getElementById('plan-testers'),
                approver: document.getElementById('plan-approver'),
                kickoff: document.getElementById('plan-kickoff'),
                signoff: document.getElementById('plan-signoff'),
            },
            scenario: {
                title: document.getElementById('scenario-title'),
                description: document.getElementById('scenario-description'),
                preconditions: document.getElementById('scenario-preconditions'),
                postconditions: document.getElementById('scenario-postconditions'),
                tags: document.getElementById('scenario-tags'),
            },
            case: {
                title: document.getElementById('case-title'),
                description: document.getElementById('case-description'),
                steps: document.getElementById('case-steps'),
                expected: document.getElementById('case-expected'),
                precondition: document.getElementById('case-precondition'),
                requirements: document.getElementById('case-requirements'),
                dynamic: document.getElementById('case-dynamic'),
                priority: document.getElementById('case-priority'),
                responseEncrypted: document.getElementById('case-response-encrypted'),
            },
            maintenance: {
                version: document.getElementById('maintenance-version'),
                summary: document.getElementById('maintenance-summary'),
                effectiveDate: document.getElementById('maintenance-date'),
                updatedBy: document.getElementById('maintenance-updated'),
                approvedBy: document.getElementById('maintenance-approved'),
                updates: document.getElementById('maintenance-updates'),
            },
        };

        // Helper: populate cascading selects for creating a case
        const populateCasePlanModuleScenarioSelects = () => {
            try {
                const planSelect = els.casePlanSelect;
                const moduleSelect = els.caseModuleSelect;
                const scenarioSelect = els.caseScenarioSelect;
                // populate plans
                if (planSelect) {
                    planSelect.innerHTML = '';
                    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = '(select a plan)'; planSelect.appendChild(placeholder);
                    state.plans.forEach((p) => {
                        const opt = document.createElement('option'); opt.value = p.id; opt.textContent = p.name || `Plan ${p.id}`; planSelect.appendChild(opt);
                    });
                }
                // clear modules/scenarios
                if (moduleSelect) {
                    moduleSelect.innerHTML = '';
                    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = '(select module)'; moduleSelect.appendChild(placeholder);
                    moduleSelect.disabled = true;
                }
                if (scenarioSelect) {
                    scenarioSelect.innerHTML = '';
                    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = '(select scenario)'; scenarioSelect.appendChild(placeholder);
                    scenarioSelect.disabled = true;
                }
            } catch (e) { /* ignore */ }
        };

        // Populate modal selects (separate elements) using state.plans and initialModules
        const populateModalCaseSelects = () => {
            try {
                const planSelect = els.modalCasePlan || document.getElementById('modal-case-plan');
                const moduleSelect = els.modalCaseModule || document.getElementById('modal-case-module');
                const scenarioSelect = els.modalCaseScenario || document.getElementById('modal-case-scenario');
                // If we don't have plans from the initial payload, try to fetch them now.
                const ensurePlans = async () => {
                    if (Array.isArray(state.plans) && state.plans.length) return;
                    try {
                        setStatus('Loading plans…', 'info');
                        const resp = await fetch(apiEndpoints.plans || '/api/core/test-plans/', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
                        if (!resp.ok) throw new Error('Failed to load plans');
                        const data = await resp.json();
                        state.plans = normalizePlans(Array.isArray(data) ? data : []);
                        setStatus('', 'info');
                    } catch (err) {
                        setStatus('Unable to load plans.', 'error');
                    }
                };
                // kick off fetch if needed and wait for it to finish before populating
                const ready = Array.isArray(state.plans) && state.plans.length ? Promise.resolve() : ensurePlans();
                if (planSelect) {
                    planSelect.innerHTML = '';
                    const ph = document.createElement('option'); ph.value = ''; ph.textContent = '(select a plan)'; planSelect.appendChild(ph);
                    ready.then(() => {
                        (state.plans || []).forEach((p) => {
                            const opt = document.createElement('option'); opt.value = p.id; opt.textContent = p.name || `Plan ${p.id}`; planSelect.appendChild(opt);
                        });
                    }).catch(() => { /* ignore */ });
                }
                if (moduleSelect) {
                    moduleSelect.innerHTML = '';
                    const ph2 = document.createElement('option'); ph2.value = ''; ph2.textContent = '(select module)'; moduleSelect.appendChild(ph2);
                    moduleSelect.disabled = true;
                }
                if (scenarioSelect) {
                    scenarioSelect.innerHTML = '';
                    const ph3 = document.createElement('option'); ph3.value = ''; ph3.textContent = '(select scenario)'; scenarioSelect.appendChild(ph3);
                    scenarioSelect.disabled = true;
                }
            } catch (e) { /* ignore */ }
        };

        // Mirror behavior of test-modules plan filter: populate modal plan select
        try {
            const modalPlanEl = els.modalCasePlan || document.getElementById('modal-case-plan');
            if (modalPlanEl) {
                // clear then populate using initialPlans for consistency with Data Management
                modalPlanEl.innerHTML = '<option value="">(select a plan)</option>';
                (initialPlans || []).forEach((p) => {
                    const opt = document.createElement('option');
                    opt.value = p.id || '';
                    opt.textContent = p.name || p.title || `Plan ${p.id}`;
                    modalPlanEl.appendChild(opt);
                });
                // existing change handlers (declared elsewhere) will handle module/scenario updates
            }
        } catch (e) { /* ignore */ }

        // Accessibility helpers: manage inert (or fallback) on background when modal is open.
        const _inertTargets = [];
        let _previouslyFocused = null;

        const _applyInert = (root, enable = true) => {
            try {
                const appRoot = document.getElementById('automation-app') || document.body;
                // we will set inert on all direct children of body except the modal container
                const exceptions = [els.caseSelectionModal];
                const nodes = Array.from(document.body.children).filter((n) => !exceptions.includes(n));
                // clear previous list first when disabling
                if (!enable) {
                    _inertTargets.forEach((n) => {
                        try {
                            if ('inert' in n) n.inert = false;
                            n.removeAttribute('aria-hidden');
                            // remove tabindex fallback markers
                            n.querySelectorAll && n.querySelectorAll('[data-inert-fallback]').forEach((el) => {
                                el.removeAttribute('tabindex');
                                el.removeAttribute('data-inert-fallback');
                            });
                        } catch (e) { /* ignore */ }
                    });
                    _inertTargets.length = 0;
                    return;
                }
                nodes.forEach((node) => {
                    try {
                        // If the node contains the currently focused element, skip setting inert to avoid hiding focused element.
                        const active = document.activeElement;
                        if (active && node.contains(active)) {
                            // instead of making it inert, we leave it alone to avoid violating aria-hidden rules
                            return;
                        }
                        if ('inert' in node) {
                            node.inert = true;
                        } else {
                            // fallback: mark aria-hidden and remove tabbable by setting tabindex on focusable descendants
                            node.setAttribute('aria-hidden', 'true');
                            // add tabindex=-1 to focusable elements so they cannot be focused
                            const focusable = node.querySelectorAll('a, button, input, select, textarea, [tabindex]');
                            focusable.forEach((el) => {
                                try {
                                    // only add fallback if element is currently focusable
                                    if (!el.hasAttribute('data-inert-fallback')) {
                                        el.setAttribute('data-inert-fallback', 'true');
                                        // store previous tabindex if needed
                                        el.setAttribute('tabindex', '-1');
                                    }
                                } catch (e) { /* ignore */ }
                            });
                        }
                        _inertTargets.push(node);
                    } catch (e) { /* ignore */ }
                });
            } catch (e) { /* ignore */ }
        };

        const openCaseSelectionModal = () => {
            try {
                automationLog('debug', '[automation] openCaseSelectionModal invoked');
                if (!els.caseSelectionModal) return;
                // Fetch latest plans from API before populating modal so the
                // options reflect the current server state. We do this even if
                // state.plans exists to ensure freshness.
                (async () => {
                    automationLog('debug', '[automation] fetching plans for modal from', apiEndpoints.plans || '/api/core/test-plans/');
                    try {
                        setStatus('Loading test plans…', 'info');
                        const resp = await fetch(apiEndpoints.plans || '/api/core/test-plans/', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
                        if (resp.ok) {
                            const data = await resp.json();
                            state.plans = normalizePlans(Array.isArray(data) ? data : []);
                        } else {
                            console.warn('[automation] fetch plans failed', resp.status);
                        }
                    } catch (err) {
                        setStatus('Unable to load test plans.', 'error');
                    } finally {
                        setStatus('', 'info');
                    }
                    // populate options freshly (will use state.plans)
                    try { populateModalCaseSelects(); } catch (e) { automationLog('debug', '[automation] populateModalCaseSelects error', e); }
                    // If the page has a selected plan, auto-select it in the modal
                    try {
                        const modalPlanElAuto = document.getElementById('modal-case-plan') || els.modalCasePlan;
                        if (modalPlanElAuto && state.selectedPlanId) {
                            modalPlanElAuto.value = String(state.selectedPlanId);
                            // trigger change so module list is populated/enabled
                            modalPlanElAuto.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    } catch (e) { /* ignore */ }
                    automationLog('debug', '[automation] modal open - state.plans length', Array.isArray(state.plans) ? state.plans.length : 0, 'initialModules length', Array.isArray(initialModules) ? initialModules.length : 0);
                    // remember currently focused element so we can restore focus on close
                    _previouslyFocused = document.activeElement;
                    // show modal element (make it focusable)
                    els.caseSelectionModal.hidden = false;
                    // show explicit overlay (if present)
                    try { const overlay = els.caseSelectionModal.querySelector('[data-role="case-selection-overlay"]'); if (overlay) overlay.hidden = false; } catch (e) { }
                    document.body.classList.add('automation-modal-open');
                    // focus the modal dialog container first (so activeElement is inside modal)
                    window.requestAnimationFrame(() => {
                        try {
                            if (els.caseSelectionModal && els.caseSelectionModal.focus) {
                                els.caseSelectionModal.focus();
                            } else if (els.caseSelectionModalDialog && els.caseSelectionModalDialog.focus) {
                                els.caseSelectionModalDialog.focus();
                            }
                        } catch (e) { /* ignore */ }
                        // after focus has moved into the modal, mark background inert
                        window.requestAnimationFrame(() => {
                            _applyInert(document.body, true);
                            // then focus the first control inside modal
                            try { if (els.modalCasePlan) els.modalCasePlan.focus(); } catch (e) { /* ignore */ }
                        });
                    });
                })();
            } catch (e) { /* ignore */ }
        };

        const closeCaseSelectionModal = () => {
            try {
                if (!els.caseSelectionModal) return;
                // remove inert from background before hiding modal so focus restoration won't be hidden
                _applyInert(document.body, false);
                els.caseSelectionModal.hidden = true;
                try { const overlay = els.caseSelectionModal.querySelector('[data-role="case-selection-overlay"]'); if (overlay) overlay.hidden = true; } catch (e) { }
                document.body.classList.remove('automation-modal-open');
                // restore focus to previously focused element if still in document
                try {
                    if (_previouslyFocused && typeof _previouslyFocused.focus === 'function') {
                        _previouslyFocused.focus();
                    }
                } catch (e) { /* ignore */ }
                _previouslyFocused = null;
            } catch (e) { /* ignore */ }
        };

        // update module options when plan changes
        const updateCaseModulesForPlan = (planId) => {
            try {
                const moduleSelect = els.caseModuleSelect;
                const scenarioSelect = els.caseScenarioSelect;
                if (!moduleSelect) return;
                moduleSelect.innerHTML = '';
                const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = '(select module)'; moduleSelect.appendChild(placeholder);
                // Gather modules referenced by scenarios for the plan, or fall back to initialModules
                let modules = [];
                const planObj = state.plans.find((p) => String(p.id) === String(planId));
                if (planObj && Array.isArray(planObj.scenarios)) {
                    const seen = new Set();
                    planObj.scenarios.forEach((s) => {
                        const mid = s && (s.module || s.module_id);
                        if (mid && !seen.has(String(mid))) {
                            seen.add(String(mid));
                            const m = initialModules.find((im) => String(im.id) === String(mid));
                            if (m) modules.push(m);
                        }
                    });
                }
                // If no modules found via scenarios, include all initialModules
                if (!modules.length) modules = Array.isArray(initialModules) ? initialModules.slice() : [];
                modules.forEach((m) => {
                    const opt = document.createElement('option'); opt.value = m.id; opt.textContent = m.title || `Module ${m.id}`; moduleSelect.appendChild(opt);
                });
                moduleSelect.disabled = !modules.length;
                // reset scenarios
                if (scenarioSelect) {
                    scenarioSelect.innerHTML = '';
                    const ph = document.createElement('option'); ph.value = ''; ph.textContent = '(select scenario)'; scenarioSelect.appendChild(ph);
                    scenarioSelect.disabled = true;
                }
            } catch (e) { /* ignore */ }
        };

        const updateCaseScenariosForModule = (planId, moduleId) => {
            try {
                const scenarioSelect = els.caseScenarioSelect;
                if (!scenarioSelect) return;
                scenarioSelect.innerHTML = '';
                const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = '(select scenario)'; scenarioSelect.appendChild(placeholder);
                let scenarios = [];
                const planObj = state.plans.find((p) => String(p.id) === String(planId));
                if (planObj && Array.isArray(planObj.scenarios)) {
                    scenarios = planObj.scenarios.filter((s) => String(s.module || s.module_id || '') === String(moduleId));
                }
                scenarios.forEach((s) => {
                    const opt = document.createElement('option'); opt.value = s.id; opt.textContent = s.title || `Scenario ${s.id}`; scenarioSelect.appendChild(opt);
                });
                scenarioSelect.disabled = !scenarios.length;
            } catch (e) { /* ignore */ }
        };

        // Modal-specific change listeners
        try {
            const modalPlanEl = els.modalCasePlan || document.getElementById('modal-case-plan');
            const modalModuleEl = els.modalCaseModule || document.getElementById('modal-case-module');
            const modalScenarioEl = els.modalCaseScenario || document.getElementById('modal-case-scenario');
            if (modalPlanEl) {
                modalPlanEl.addEventListener('change', (ev) => {
                    const pid = (ev.currentTarget && ev.currentTarget.value) ? ev.currentTarget.value : (modalPlanEl.value || null);
                    automationLog('debug', '[automation] modalPlan change invoked', { pid: pid, statePlansLength: Array.isArray(state.plans) ? state.plans.length : 0 });
                    // update state selected plan similar to main scenarioPlan handler
                    try {
                        if (!pid) {
                            state.selectedPlanId = null;
                        } else {
                            state.selectedPlanId = Number(pid);
                        }
                    } catch (ie) { /* ignore */ }
                    // reuse logic: update modal module list based on plan
                    try {
                        // re-query elements at handler time to avoid stale references
                        const moduleSelect = document.getElementById('modal-case-module') || modalModuleEl;
                        const modalScenarioElLocal = document.getElementById('modal-case-scenario') || modalScenarioEl;
                        automationLog('debug', '[automation] modalPlan handler elements', { moduleSelectPresent: !!moduleSelect, modalScenarioPresent: !!modalScenarioElLocal });
                        if (!moduleSelect) return;
                        moduleSelect.innerHTML = '';
                        const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = '(select module)'; moduleSelect.appendChild(placeholder);
                        let modules = [];
                        const planObj = state.plans.find((p) => String(p.id) === String(pid));
                        if (planObj && Array.isArray(planObj.scenarios)) {
                            const seen = new Set();
                            planObj.scenarios.forEach((s) => {
                                const mid = s && (s.module || s.module_id);
                                if (mid && !seen.has(String(mid))) {
                                    seen.add(String(mid));
                                    const m = initialModules.find((im) => String(im.id) === String(mid));
                                    if (m) modules.push(m);
                                }
                            });
                        }
                        if (!modules.length) modules = Array.isArray(initialModules) ? initialModules.slice() : [];
                        automationLog('debug', '[automation] modalPlan computed modules', { modulesCount: modules.length, modulesSample: modules.length ? modules.slice(0, 3) : [] });
                        modules.forEach((m) => {
                            const opt = document.createElement('option'); opt.value = m.id; opt.textContent = m.title || `Module ${m.id}`; moduleSelect.appendChild(opt);
                        });
                        // enable module select when a plan is selected (mirror main page behaviour)
                        try { moduleSelect.disabled = !modules.length; } catch (_err) { moduleSelect.disabled = !modules.length; }
                        // reset scenario select
                        if (modalScenarioElLocal) {
                            modalScenarioElLocal.innerHTML = '';
                            const ph = document.createElement('option'); ph.value = ''; ph.textContent = '(select scenario)'; modalScenarioElLocal.appendChild(ph);
                            modalScenarioElLocal.disabled = true;
                        }
                        // fetch scenarios for this plan from API and attach to state so scenario options are accurate
                        (async () => {
                            try {
                                if (!state.selectedPlanId) return;
                                const base = apiEndpoints.scenarios || '/api/core/test-scenarios/';
                                const url = `${base}?plan=${encodeURIComponent(state.selectedPlanId)}`;
                                const resp = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
                                if (!resp.ok) throw new Error(`Failed to fetch scenarios: ${resp.status}`);
                                const data = await resp.json();
                                const normalized = Array.isArray(data) ? data.map(normalizeScenario) : [];
                                automationLog('debug', '[automation] modalPlan fetched scenarios', { url, count: normalized.length, sample: normalized.length ? normalized[0] : null });
                                // attach to the plan in state; if the plan isn't present
                                // create a minimal plan entry so downstream code (module
                                // computation) can use the attached scenarios.
                                let p = state.plans.find((pp) => Number(pp.id) === Number(state.selectedPlanId));
                                if (p) {
                                    p.scenarios = normalized;
                                } else if (state.selectedPlanId) {
                                    try {
                                        const newPlan = normalizePlan({ id: Number(state.selectedPlanId), name: `Plan ${state.selectedPlanId}`, scenarios: normalized });
                                        state.plans.push(newPlan);
                                        p = newPlan;
                                    } catch (err) { /* ignore */ }
                                }
                                // Recompute modules from the newly attached scenarios and populate the module select
                                try {
                                    const moduleSelectRef = moduleSelect; // re-queried earlier in handler
                                    if (moduleSelectRef && p && Array.isArray(p.scenarios)) {
                                        // collect unique module ids from scenarios
                                        const seen3 = new Set();
                                        const moduleIds = [];
                                        p.scenarios.forEach((s) => {
                                            const mid2 = s && (s.module || s.module_id);
                                            if (mid2 && !seen3.has(String(mid2))) {
                                                seen3.add(String(mid2));
                                                moduleIds.push(String(mid2));
                                            }
                                        });
                                        // try to map to initialModules; if none exist, build minimal module objects from ids
                                        const modulesFromFetch = moduleIds.map((mid) => {
                                            const m = initialModules.find((im) => String(im.id) === String(mid));
                                            if (m) return m;
                                            return { id: mid, title: `Module ${mid}` };
                                        });
                                        automationLog('debug', '[automation] modulesFromFetch after fetch', modulesFromFetch.length, modulesFromFetch.slice(0, 3));
                                        moduleSelectRef.innerHTML = '';
                                        const placeholder2 = document.createElement('option'); placeholder2.value = ''; placeholder2.textContent = '(select module)'; moduleSelectRef.appendChild(placeholder2);
                                        modulesFromFetch.forEach((m) => {
                                            const opt2 = document.createElement('option'); opt2.value = m.id; opt2.textContent = m.title || `Module ${m.id}`; moduleSelectRef.appendChild(opt2);
                                        });
                                        try { moduleSelectRef.disabled = !modulesFromFetch.length; } catch (_err) { moduleSelectRef.disabled = !modulesFromFetch.length; }
                                    }
                                } catch (err) { /* ignore */ }
                            } catch (err) { /* ignore */ }
                        })();
                    } catch (e) { /* ignore */ }
                });
            }
            if (modalModuleEl) {
                modalModuleEl.addEventListener('change', (ev) => {
                    // re-query elements to ensure handlers operate on current DOM
                    const modalPlanElLocal = document.getElementById('modal-case-plan') || modalPlanEl;
                    const modalModuleElLocal = document.getElementById('modal-case-module') || modalModuleEl;
                    const modalScenarioElLocal = document.getElementById('modal-case-scenario') || modalScenarioEl;
                    const pid = (modalPlanElLocal && modalPlanElLocal.value) ? modalPlanElLocal.value : null;
                    const mid = (ev.currentTarget && ev.currentTarget.value) ? ev.currentTarget.value : (modalModuleElLocal.value || null);
                    if (!mid) {
                        if (modalScenarioElLocal) modalScenarioElLocal.disabled = true;
                        return;
                    }
                    try {
                        // try to load scenarios from cached plan data
                        let scenarios = [];
                        const planObj = state.plans.find((p) => String(p.id) === String(pid));
                        if (planObj && Array.isArray(planObj.scenarios)) {
                            planObj.scenarios.forEach((s) => {
                                if (String(s.module || s.module_id || '') === String(mid)) scenarios.push(s);
                            });
                        }
                        // If no scenarios available locally, fetch from API filtered by module and plan
                        if (!scenarios.length) {
                            (async () => {
                                try {
                                    const base = apiEndpoints.scenarios || '/api/core/test-scenarios/';
                                    const params = new URLSearchParams();
                                    if (mid) params.append('module', String(mid));
                                    if (pid) params.append('plan', String(pid));
                                    const url = params.toString() ? `${base}?${params.toString()}` : base;
                                    automationLog('debug', '[automation] modal module fetch', { pid, mid, url });
                                    const resp = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
                                    if (!resp.ok) throw new Error(`Failed to fetch scenarios for module: ${resp.status}`);
                                    const data = await resp.json();
                                    const normalized = Array.isArray(data) ? data.map(normalizeScenario) : [];
                                    scenarios = normalized;
                                    automationLog('debug', '[automation] modal module fetch result', { count: normalized.length, sample: normalized.length ? normalized[0] : null });
                                    // attach to plan if selected
                                    if (pid) {
                                        const p = state.plans.find((pp) => Number(pp.id) === Number(pid));
                                        if (p) p.scenarios = normalized;
                                        // Recompute modules from the newly attached scenarios and
                                        // populate the module select so the user sees options
                                        // immediately after the fetch completes.
                                        try {
                                            let modulesFromFetch = [];
                                            if (p && Array.isArray(p.scenarios)) {
                                                const seen2 = new Set();
                                                p.scenarios.forEach((s) => {
                                                    const mid2 = s && (s.module || s.module_id);
                                                    if (mid2 && !seen2.has(String(mid2))) {
                                                        seen2.add(String(mid2));
                                                        const m2 = initialModules.find((im) => String(im.id) === String(mid2));
                                                        if (m2) modulesFromFetch.push(m2);
                                                    }
                                                });
                                            }
                                            if (!modulesFromFetch.length) modulesFromFetch = Array.isArray(initialModules) ? initialModules.slice() : [];
                                            automationLog('debug', '[automation] modalPlan populate modules after fetch', { modulesCount: modulesFromFetch.length, sample: modulesFromFetch.slice(0, 3) });
                                            if (modalModuleElLocal) {
                                                modalModuleElLocal.innerHTML = '';
                                                const placeholder2 = document.createElement('option'); placeholder2.value = ''; placeholder2.textContent = '(select module)'; modalModuleElLocal.appendChild(placeholder2);
                                                modulesFromFetch.forEach((m) => {
                                                    const opt2 = document.createElement('option'); opt2.value = m.id; opt2.textContent = m.title || `Module ${m.id}`; modalModuleElLocal.appendChild(opt2);
                                                });
                                                try { modalModuleElLocal.disabled = !modulesFromFetch.length; } catch (_err2) { modalModuleElLocal.disabled = !modulesFromFetch.length; }
                                            }
                                            if (modalScenarioElLocal) {
                                                modalScenarioElLocal.innerHTML = '';
                                                const ph2 = document.createElement('option'); ph2.value = ''; ph2.textContent = '(select scenario)'; modalScenarioElLocal.appendChild(ph2);
                                                modalScenarioElLocal.disabled = true;
                                            }
                                        } catch (err) { /* ignore */ }
                                    }
                                } catch (err) {
                                    automationLog('debug', '[automation] modal module fetch error', err);
                                } finally {
                                    // populate modal scenario select
                                    if (modalScenarioEl) {
                                        modalScenarioEl.innerHTML = '';
                                        const ph = document.createElement('option'); ph.value = ''; ph.textContent = '(select scenario)'; modalScenarioEl.appendChild(ph);
                                        scenarios.forEach((s) => {
                                            const opt = document.createElement('option'); opt.value = s.id; opt.textContent = s.title || `Scenario ${s.id}`; modalScenarioEl.appendChild(opt);
                                        });
                                        modalScenarioEl.disabled = !scenarios.length;
                                    }
                                }
                            })();
                            return; // async path will populate select
                        }
                        // populate from local scenarios
                        if (modalScenarioEl) {
                            modalScenarioEl.innerHTML = '';
                            const ph = document.createElement('option'); ph.value = ''; ph.textContent = '(select scenario)'; modalScenarioEl.appendChild(ph);
                            scenarios.forEach((s) => {
                                const opt = document.createElement('option'); opt.value = s.id; opt.textContent = s.title || `Scenario ${s.id}`; modalScenarioEl.appendChild(opt);
                            });
                            modalScenarioEl.disabled = !scenarios.length;
                        }
                    } catch (e) { /* ignore */ }
                });
            }
            if (els.caseSelectionContinue) {
                els.caseSelectionContinue.addEventListener('click', (ev) => {
                    try {
                        const selectedScenario = els.modalCaseScenario && els.modalCaseScenario.value ? els.modalCaseScenario.value : null;
                        if (!selectedScenario) {
                            setStatus('Please select a scenario before continuing.', 'error');
                            return;
                        }
                        // set hidden input used by form submit
                        if (els.caseSelectedScenarioHidden) els.caseSelectedScenarioHidden.value = selectedScenario;
                        // also set the visible caseScenarioSelect if present (for compatibility)
                        if (els.caseScenarioSelect) {
                            // ensure option exists
                            const exists = Array.from(els.caseScenarioSelect.options).some((o) => String(o.value) === String(selectedScenario));
                            if (!exists) {
                                // try to find label from state
                                let label = `Scenario ${selectedScenario}`;
                                for (const p of state.plans) {
                                    if (Array.isArray(p.scenarios)) {
                                        const s = p.scenarios.find((sc) => String(sc.id) === String(selectedScenario));
                                        if (s) { label = s.title || label; break; }
                                    }
                                }
                                const opt = document.createElement('option'); opt.value = selectedScenario; opt.textContent = label; els.caseScenarioSelect.appendChild(opt);
                            }
                            els.caseScenarioSelect.value = selectedScenario;
                            els.caseScenarioSelect.disabled = false;
                        }
                        // Update client-side selection state so renderers show the selected scenario
                        try {
                            // modal plan select may contain the selected plan id
                            const modalPlanVal = (els.modalCasePlan && els.modalCasePlan.value) ? els.modalCasePlan.value : (document.getElementById('modal-case-plan') && document.getElementById('modal-case-plan').value) || null;
                            if (modalPlanVal) {
                                state.selectedPlanId = Number(modalPlanVal);
                            }
                            state.selectedScenarioId = Number(selectedScenario);
                        } catch (e) { /* ignore */ }
                        // enable form fieldset
                        if (els.caseForm) {
                            const fieldset = els.caseForm.querySelector('fieldset'); if (fieldset) fieldset.disabled = false;
                        }
                        // show the test cases panel container if hidden
                        try {
                            const panel = document.getElementById('test-cases-panel-container');
                            if (panel) panel.style.display = '';
                        } catch (ie) { /* ignore */ }
                        // Convert the Test Cases panel into a scenarios-style table layout
                        try {
                            const panel = document.querySelector('.automation-panel[data-panel="cases"]');
                            if (panel) {
                                // clear existing contents
                                panel.innerHTML = '';
                                // inject header + controls similar to scenarios panel
                                panel.innerHTML = `
                                    <div class="panel-header">
                                        <h2 id="headline-cases">Test Cases</h2>
                                        <div class="panel-controls">
                                            <div class="case-breadcrumb-label" aria-hidden="true">plan &middot; modules &middot; scenarios</div>
                                            <input type="search" id="case-search" class="automation-search" placeholder="Search cases" aria-label="Search cases">
                                            <button type="button" class="btn-primary" id="open-new-case">New Test Case</button>
                                        </div>
                                    </div>
                                    <div class="card table-card automation-table-card" aria-live="polite">
                                        <table class="table-modern automation-table" aria-label="Test cases">
                                            <thead>
                                                <tr>
                                                    <th scope="col" class="col-checkbox">
                                                        <label class="case-checkbox-label">
                                                            <input id="select-all-cases" type="checkbox" aria-label="Select all test cases">
                                                            <span class="fake-checkbox" aria-hidden="true"></span>
                                                        </label>
                                                    </th>
                                                    <th scope="col">ID</th>
                                                    <th scope="col">Title</th>
                                                    <th scope="col">Description</th>
                                                    <th scope="col">Created</th>
                                                    <th scope="col">Updated</th>
                                                    <th scope="col">Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody data-role="case-table-body">
                                                <tr><td colspan="7" class="empty">Loading test cases…</td></tr>
                                            </tbody>
                                        </table>
                                    </div>
                                `;
                                // populate breadcrumb label with actual selected names
                                try {
                                    const crumb = panel.querySelector('.case-breadcrumb-label');
                                    if (crumb) {
                                        // plan name
                                        let planName = '—';
                                        try {
                                            const p = state.plans.find((pp) => Number(pp.id) === Number(state.selectedPlanId));
                                            if (p) planName = p.name || p.title || `Plan ${p.id}`;
                                        } catch (e) { /* ignore */ }
                                        // initialize checkbox wiring for the new header if present
                                        try { initCaseCheckboxes(); } catch (e) { /* ignore */ }
                                        // scenario title and module name
                                        let scenarioTitle = '—';
                                        let moduleName = '—';
                                        try {
                                            const s = (function () {
                                                const plan = state.plans.find((pp) => Number(pp.id) === Number(state.selectedPlanId));
                                                if (!plan || !Array.isArray(plan.scenarios)) return null;
                                                return plan.scenarios.find((sc) => Number(sc.id) === Number(state.selectedScenarioId)) || null;
                                            }());
                                            if (s) {
                                                scenarioTitle = s.title || `Scenario ${s.id}`;
                                                // module id may be in s.module or s.module_id
                                                const mid = s.module || s.module_id || null;
                                                if (mid) {
                                                    const mObj = initialModules.find((m) => Number(m.id) === Number(mid));
                                                    if (mObj) moduleName = mObj.title || `Module ${mObj.id}`;
                                                    else moduleName = `Module ${mid}`;
                                                } else {
                                                    moduleName = '—';
                                                }
                                            }
                                        } catch (e) { /* ignore */ }
                                        crumb.textContent = `${planName} · ${moduleName} · ${scenarioTitle}`;
                                    }
                                } catch (e) { /* ignore */ }
                                // attach handler to the New Test Case button so it opens the add-case modal
                                try {
                                    const newCaseBtn = panel.querySelector('#open-new-case');
                                    if (newCaseBtn) {
                                        newCaseBtn.addEventListener('click', (ev) => {
                                            try {
                                                ev.preventDefault();
                                                const sid = state.selectedScenarioId || null;
                                                const caseModal = document.querySelector('[data-role="module-add-case-modal"]');
                                                if (caseModal) {
                                                    const hid = document.getElementById('module-add-case-scenario-id'); if (hid) hid.value = sid || '';
                                                    // ensure modal title reflects creation
                                                    const modalTitle = document.getElementById('module-add-case-modal-title');
                                                    if (modalTitle) modalTitle.textContent = 'Add Test Case';
                                                    if (typeof toggleDependencyFields === 'function') toggleDependencyFields(false);
                                                    if (sid && typeof loadDependencyOptions === 'function') loadDependencyOptions(sid);
                                                    caseModal.hidden = false; body.classList.add('automation-modal-open');
                                                    const titleInput = document.getElementById('module-add-case-title'); if (titleInput) titleInput.focus();
                                                } else {
                                                    setStatus('Unable to open test case modal.', 'error');
                                                }
                                            } catch (err) { /* ignore */ }
                                        });
                                    }
                                } catch (_err) { /* ignore */ }
                            }
                        } catch (e) { /* ignore */ }
                        // re-render UI so cases for the selected scenario are shown (table body will be populated)
                        try { renderAll(); } catch (e) { try { renderCaseList(); } catch (_e) { /* ignore */ } }
                        // close modal
                        closeCaseSelectionModal();
                        // focus title input
                        if (inputs.case.title) inputs.case.title.focus();
                        setStatus('Scenario selected. You may now fill and save the test case.', 'success');
                    } catch (e) { /* ignore */ }
                });
            }
            // Prevent closing the selection modal by clicking outside or on 'close' actions.
            // The modal is intentionally modal — user must choose a scenario and click Continue.
            root.addEventListener('click', (ev) => {
                if (!els.caseSelectionModal || els.caseSelectionModal.hidden) return;
                const close = ev.target.closest('[data-action="close-case-selection"]');
                if (close) {
                    // ignore close clicks while our modal is open
                    ev.preventDefault();
                    ev.stopPropagation();
                }
                // prevent clicks on the overlay from closing the modal
                const insideDialog = ev.target.closest('[data-role="case-selection-modal-dialog"]');
                if (!insideDialog) {
                    // absorb the click
                    ev.preventDefault();
                    ev.stopPropagation();
                }
            });

            // Prevent Escape key from closing the modal when it's open
            document.addEventListener('keydown', (ev) => {
                // attach handler to the case search input (ensure element exists)
                try {
                    const caseSearchElLocal = panel.querySelector('#case-search');
                    if (caseSearchElLocal && !caseSearchElLocal.dataset._searchAttached) {
                        caseSearchElLocal.dataset._searchAttached = '1';
                        caseSearchElLocal.addEventListener('input', debounce(async (ev) => {
                            const q = (caseSearchElLocal.value || '').trim();
                            state._caseSearch = q.toLowerCase();
                            if (!q) {
                                state._caseSearchResults = null;
                                try { renderCaseList(); } catch (e) { /* ignore */ }
                                return;
                            }
                            try {
                                setStatus('Searching cases...', 'info');
                                const base = apiEndpoints.cases || '/api/core/test-cases/';
                                // include scenario filter when available
                                try {
                                    const params = new URLSearchParams();
                                    params.append('search', String(q));
                                    if (state && state.selectedScenarioId) params.append('scenario', String(state.selectedScenarioId));
                                    const query = params.toString();
                                    const computed = query ? `${base}?${query}` : base;
                                    // store computed URL on window as a fallback for other scopes
                                    window.__automation_case_search_url = computed;
                                } catch (e) {
                                    window.__automation_case_search_url = `${base}?search=${encodeURIComponent(q)}`;
                                }
                                const url = window.__automation_case_search_url;
                                const resp = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
                                if (!resp.ok) throw new Error('Search failed');
                                const data = await resp.json();
                                state._caseSearchResults = Array.isArray(data) ? data : [];
                                setStatus('', 'info');
                                try { renderCaseList(); } catch (e) { /* ignore */ }
                            } catch (err) {
                                setStatus('Case search failed.', 'error');
                            }
                        }, 300));
                    }
                } catch (e) { /* ignore */ }
                if (!els.caseSelectionModal || els.caseSelectionModal.hidden) return;
                if (ev.key === 'Escape' || ev.key === 'Esc') {
                    ev.preventDefault();
                    ev.stopPropagation();
                    setStatus('Please select a scenario and click Continue to proceed.', 'info');
                }
            });
            // wire open modal button if present on page
            const openModalBtn = document.getElementById('open-case-selection-modal');
            if (openModalBtn) {
                openModalBtn.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    openCaseSelectionModal();
                });
            }
            // Delegated fallback: catch clicks on the open modal button even if
            // the direct binding above was not executed or the element was
            // dynamic. This ensures the modal opens on click.
            root.addEventListener('click', (ev) => {
                const btn = ev.target.closest && ev.target.closest('#open-case-selection-modal');
                if (btn) {
                    try { ev.preventDefault(); } catch (e) { }
                    try { openCaseSelectionModal(); } catch (e) { /* ignore */ }
                }
            });
        } catch (e) { /* ignore */ }

        // populate plan and module selects for scenarios panel
        const populateScenarioPlanAndModule = () => {
            try {
                const planSelect = els.scenarioPlan;
                const moduleFilter = document.getElementById('module-filter');
                const moduleSelect = document.getElementById('scenario-module');
                // populate plans
                if (planSelect) {
                    planSelect.innerHTML = '';
                    const placeholder = document.createElement('option');
                    placeholder.value = '';
                    placeholder.textContent = '— Select plan —';
                    planSelect.appendChild(placeholder);
                    state.plans.forEach((p) => {
                        const opt = document.createElement('option');
                        opt.value = p.id;
                        opt.textContent = p.name || `Plan ${p.id}`;
                        planSelect.appendChild(opt);
                    });
                }
                // populate module filter with initialModules (keep disabled until plan selected)
                if (moduleFilter) {
                    // leave first placeholder option intact, then append modules
                    const first = moduleFilter.querySelector('option');
                    moduleFilter.innerHTML = '';
                    if (first) moduleFilter.appendChild(first);
                    const allOpt = document.createElement('option'); allOpt.value = ''; allOpt.textContent = 'All modules'; moduleFilter.appendChild(allOpt);
                    if (Array.isArray(initialModules)) {
                        initialModules.forEach((m) => {
                            const opt = document.createElement('option'); opt.value = m.id; opt.textContent = m.title || m.name || `Module ${m.id}`;
                            moduleFilter.appendChild(opt);
                        });
                    }
                }
                // populate scenario module select in the create form
                if (moduleSelect) {
                    moduleSelect.innerHTML = '';
                    const none = document.createElement('option'); none.value = ''; none.textContent = '(none)'; moduleSelect.appendChild(none);
                    if (Array.isArray(initialModules)) {
                        initialModules.forEach((m) => {
                            const opt = document.createElement('option'); opt.value = m.id; opt.textContent = m.title || m.name || `Module ${m.id}`;
                            moduleSelect.appendChild(opt);
                        });
                    }
                }
            } catch (e) { /* ignore */ }
        };

        // Stepper state for multi-step plan creation
        let planDraftId = null;
        let currentPlanStep = 1;
        const planSteps = Array.from(document.querySelectorAll('.plan-step'));
        const maxPlanSteps = planSteps.length || 5;

        const elsExtra = {
            planPrev: root.querySelector('[data-action="plan-prev"]'),
            planSubmit: document.getElementById('plan-submit'),
        };

        const showPlanStep = (step) => {
            planSteps.forEach((node) => {
                const s = Number(node.dataset.step || 0);
                node.hidden = s !== step;
            });
            currentPlanStep = step;
            // update buttons
            if (elsExtra.planPrev) {
                elsExtra.planPrev.hidden = step <= 1;
            }
            if (elsExtra.planSubmit) {
                elsExtra.planSubmit.textContent = step < maxPlanSteps ? 'Next' : 'Save';
            }
        };

        const resetPlanStepper = () => {
            planDraftId = null;
            showPlanStep(1);
        };

        const objectiveTextarea = inputs.plan.objective;
        let objectiveEditor = null;
        let objectiveEditorAttempts = 0;
        const MAX_OBJECTIVE_EDITOR_ATTEMPTS = 20;

        const initObjectiveEditor = () => {
            if (!objectiveTextarea) {
                return;
            }
            if (window.tinymce && typeof window.tinymce.get === 'function') {
                const existing = window.tinymce.get(objectiveTextarea.id);
                if (existing) {
                    objectiveEditor = existing;
                    return;
                }
            }
            if (typeof window.tinymce === 'undefined') {
                if (objectiveEditorAttempts < MAX_OBJECTIVE_EDITOR_ATTEMPTS) {
                    objectiveEditorAttempts += 1;
                    window.setTimeout(initObjectiveEditor, 150 * objectiveEditorAttempts);
                } else {
                    // eslint-disable-next-line no-console
                    console.warn('[automation] TinyMCE library unavailable after retries.');
                }
                return;
            }
            objectiveEditorAttempts = 0;
            const placeholder = objectiveTextarea.dataset.placeholder || objectiveTextarea.getAttribute('placeholder') || '';
            window.tinymce.init({
                target: objectiveTextarea,
                menubar: false,
                branding: false,
                statusbar: false,
                plugins: 'lists link table autoresize',
                toolbar:
                    'undo redo | blocks | bold italic underline | alignleft aligncenter alignright | bullist numlist | link table | removeformat',
                placeholder,
                resize: false,
                block_formats: 'Paragraph=p;Heading 1=h1;Heading 2=h2;Heading 3=h3;Heading 4=h4',
                min_height: 220,
                content_style:
                    'body { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #2b1b00; }',
                setup(editor) {
                    objectiveEditor = editor;
                    editor.on('init', () => {
                        const initialValue = sanitizeRichText(objectiveTextarea.value || '');
                        if (initialValue) {
                            editor.setContent(initialValue);
                            objectiveTextarea.value = initialValue;
                        } else {
                            editor.setContent('');
                            objectiveTextarea.value = '';
                        }
                        const fieldWrapper = objectiveTextarea.closest('.rich-text-field');
                        if (fieldWrapper) {
                            fieldWrapper.classList.add('rich-text-field--enhanced');
                        }
                    });
                    const syncValue = () => {
                        const content = sanitizeRichText(editor.getContent({ format: 'html' }) || '');
                        objectiveTextarea.value = content;
                    };
                    editor.on('change keyup paste blur setcontent', syncValue);
                    editor.on('remove', () => {
                        objectiveEditor = null;
                    });
                },
            });
        };

        const getObjectiveEditor = () => objectiveEditor;

        const resetObjectiveEditor = () => {
            const editor = getObjectiveEditor();
            if (editor && typeof editor.setContent === 'function') {
                editor.setContent('');
            }
            if (objectiveTextarea) {
                objectiveTextarea.value = '';
            }
        };

        const readObjectiveContent = () => {
            const editor = getObjectiveEditor();
            if (editor && typeof editor.getContent === 'function') {
                const rawHtml = editor.getContent({ format: 'html' }) || '';
                const sanitized = sanitizeRichText(rawHtml);
                const plain = extractPlainText(sanitized);
                if (sanitized !== rawHtml && typeof editor.setContent === 'function') {
                    editor.setContent(sanitized);
                }
                if (objectiveTextarea) {
                    objectiveTextarea.value = sanitized;
                }
                if (!plain) {
                    return { html: '', plain: '' };
                }
                return { html: sanitized, plain };
            }
            if (!objectiveTextarea) {
                return { html: '', plain: '' };
            }
            const raw = objectiveTextarea.value || '';
            const sanitized = sanitizeRichText(raw);
            const plain = extractPlainText(sanitized);
            objectiveTextarea.value = sanitized;
            if (!plain) {
                return { html: '', plain: '' };
            }
            return { html: sanitized, plain };
        };

        const normalizePlan = (plan) => {
            if (!plan || typeof plan !== 'object') {
                return plan;
            }
            const next = { ...plan };
            if (typeof next.objective === 'string') {
                const sanitizedObjective = sanitizeRichText(next.objective);
                next.objective = sanitizedObjective;
                next.objective_plain = extractPlainText(sanitizedObjective);
            } else {
                next.objective = '';
                next.objective_plain = '';
            }
            if (Array.isArray(next.scenarios)) {
                next.scenarios = next.scenarios.map((scenario) => ({ ...scenario }));
            }
            if (Array.isArray(next.scopes)) {
                next.scopes = next.scopes.map((scope) => ({ ...scope }));
            } else if (!next.scopes) {
                next.scopes = [];
            }
            // legacy: TestPlan.risk_mitigations was removed in favor of
            // RiskAndMitigationPlan.plan FK. Clients should use
            // risk_mitigation_details (nested objects) or the injected
            // `automation-initial-risk-mitigations` payload when needed.
            if (Array.isArray(next.risk_mitigation_details)) {
                next.risk_mitigation_details = next.risk_mitigation_details.map((entry) => ({ ...entry }));
            } else if (!next.risk_mitigation_details) {
                next.risk_mitigation_details = [];
            }
            if (Array.isArray(next.modules_under_test)) {
                next.modules_under_test = [...next.modules_under_test];
            }
            // preserve testing types structure
            if (next.testing_types && typeof next.testing_types === 'object') {
                // shallow copy categories and arrays to avoid mutating original
                const copy = {};
                if (Array.isArray(next.testing_types.functional)) {
                    copy.functional = [...next.testing_types.functional];
                } else {
                    copy.functional = [];
                }
                if (Array.isArray(next.testing_types.non_functional)) {
                    copy.non_functional = [...next.testing_types.non_functional];
                } else {
                    copy.non_functional = [];
                }
                next.testing_types = copy;
            } else if (!next.testing_types) {
                next.testing_types = { functional: [], non_functional: [] };
            }
            if (Array.isArray(next.testers)) {
                next.testers = [...next.testers];
            }
            return next;
        };

        // Normalize scenario shape returned by the API so client-side code can
        // reliably compare module and plan ids. Some API responses include
        // nested objects for `module` or `plan` (e.g. { module: { id: 1, title: '...' } })
        // which breaks equality checks like `String(s.module) === moduleFilterVal`.
        const normalizeScenario = (s) => {
            if (!s || typeof s !== 'object') return s;
            const next = { ...s };
            try {
                if (next.module && typeof next.module === 'object') {
                    // prefer id, fallback to pk
                    next.module = next.module.id || next.module.pk || null;
                }
            } catch (e) { /* ignore */ }
            try {
                if (next.plan && typeof next.plan === 'object') {
                    next.plan = next.plan.id || next.plan.pk || null;
                }
            } catch (e) { /* ignore */ }
            // Support APIs that return module_id / plan_id instead of module/plan
            try {
                if ((next.module === undefined || next.module === null) && (next.module_id !== undefined)) {
                    next.module = next.module_id;
                }
            } catch (e) { /* ignore */ }
            try {
                if ((next.plan === undefined || next.plan === null) && (next.plan_id !== undefined)) {
                    next.plan = next.plan_id;
                }
            } catch (e) { /* ignore */ }
            return next;
        };

        const normalizePlans = (plans) => (Array.isArray(plans) ? plans.map(normalizePlan) : []);

        const initialModules = readScriptJson('automation-initial-modules') || [];

        const state = {
            plans: normalizePlans(initialPlans),
            selectedPlanId: null,
            selectedScenarioId: null,
            editingPlan: false,
        };

        // Debug: expose the initial plans we were given server-side so we can
        // confirm in browser console whether the payload arrived correctly.
        try {
            automationLog('debug', '[automation] initialPlans length:', (state.plans || []).length, 'sample:', (state.plans || []).slice(0, 3));
        } catch (e) { /* ignore */ }

        const getSelectedPlan = () => state.plans.find((plan) => Number(plan.id) === Number(state.selectedPlanId)) || null;

        const getSelectedScenario = () => {
            const plan = getSelectedPlan();
            if (!plan || !Array.isArray(plan.scenarios)) {
                return null;
            }
            return plan.scenarios.find((scenario) => Number(scenario.id) === Number(state.selectedScenarioId)) || null;
        };

        const setStatus = (message, variant = 'info') => {
            if (!els.status) {
                return;
            }
            if (!message) {
                els.status.textContent = '';
                els.status.hidden = true;
                return;
            }
            els.status.hidden = false;
            els.status.dataset.variant = variant;
            els.status.textContent = message;
        };

        // Lightweight toast helper for transient messages
        const showToast = (message, timeout = 3000) => {
            try {
                let container = document.getElementById('automation-toast-container');
                if (!container) {
                    container = document.createElement('div');
                    container.id = 'automation-toast-container';
                    container.style.position = 'fixed';
                    container.style.right = '16px';
                    container.style.bottom = '16px';
                    container.style.zIndex = 99999;
                    document.body.appendChild(container);
                }
                const node = document.createElement('div');
                node.className = 'automation-toast';
                node.style.background = 'rgba(0,0,0,0.8)';
                node.style.color = '#fff';
                node.style.padding = '8px 12px';
                node.style.marginTop = '8px';
                node.style.borderRadius = '4px';
                node.style.fontSize = '13px';
                node.textContent = message;
                container.appendChild(node);
                window.setTimeout(() => {
                    try { container.removeChild(node); } catch (e) { /* ignore */ }
                }, timeout);
            } catch (e) { /* ignore */ }
        };

        // populate module filter and scenario form module select
        const populateModuleSelects = () => {
            try {
                const filter = document.getElementById('module-filter');
                const select = document.getElementById('scenario-module');
                if (!Array.isArray(initialModules)) return;
                // clear existing options except the placeholder
                if (filter) {
                    // keep first option (All modules)
                    const first = filter.querySelector('option');
                    filter.innerHTML = '';
                    if (first) filter.appendChild(first);
                    const opt = document.createElement('option'); opt.value = ''; opt.textContent = 'All modules'; filter.appendChild(opt); // ensure placeholder
                }
                if (select) {
                    select.innerHTML = '';
                    const none = document.createElement('option'); none.value = ''; none.textContent = '(none)'; select.appendChild(none);
                }
                initialModules.forEach((m) => {
                    const option = document.createElement('option');
                    option.value = m.id;
                    option.textContent = m.title || m.name || `Module ${m.id}`;
                    if (filter) filter.appendChild(option.cloneNode(true));
                    if (select) select.appendChild(option.cloneNode(true));
                });
            } catch (e) { /* ignore */ }
        };

        // call once on init
        populateModuleSelects();
        populateScenarioPlanAndModule();

        // Hide Test Cases panel on init if no scenario is selected
        try {
            const panel = document.getElementById('test-cases-panel-container');
            if (panel) {
                const selected = getSelectedScenario();
                if (!selected) panel.style.display = 'none';
            }
        } catch (e) { /* ignore */ }

        const focusPlanRow = (planId) => {
            if (!els.planList || typeof planId === 'undefined' || planId === null) {
                return;
            }
            const selector = `[data-plan-id="${planId}"]`;
            const row = els.planList.querySelector(selector);
            if (row) {
                row.focus();
            }
        };

        // handle scenario plan selection enabling module filter
        if (els.scenarioPlan) {
            els.scenarioPlan.addEventListener('change', (ev) => {
                const val = els.scenarioPlan.value;
                const moduleFilter = document.getElementById('module-filter');
                if (!val) {
                    // no plan selected -> disable module filter
                    if (moduleFilter) moduleFilter.disabled = true;
                    // clear scenario list message
                    state.selectedPlanId = null;
                } else {
                    if (moduleFilter) moduleFilter.disabled = false;
                    // select plan in state and re-render
                    state.selectedPlanId = Number(val);
                    // when selecting a plan, choose first scenario if present
                    const plan = state.plans.find(p => Number(p.id) === Number(val));
                    state.selectedScenarioId = plan && Array.isArray(plan.scenarios) && plan.scenarios.length ? plan.scenarios[0].id : null;
                }
                automationLog('debug', '[automation] plan changed', { selectedPlanId: state.selectedPlanId, selectedScenarioId: state.selectedScenarioId });
                // load scenarios for this plan from the API and attach them to the
                // selected plan so the table shows up-to-date data for the plan.
                (async () => {
                    const pid = state.selectedPlanId;
                    if (!pid) {
                        renderAll();
                        return;
                    }
                    try {
                        setStatus('Loading scenarios for selected plan…', 'info');
                        const base = apiEndpoints.scenarios || '/api/core/test-scenarios/';
                        const url = `${base}?plan=${encodeURIComponent(pid)}`;
                        const resp = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
                        if (!resp.ok) throw new Error(`Failed to fetch scenarios: ${resp.status}`);
                        const data = await resp.json();
                        // normalize scenarios so module/plan are ids (not nested objects)
                        const normalized = Array.isArray(data) ? data.map(normalizeScenario) : [];
                        // attach to the plan in state
                        const planObj = state.plans.find((p) => Number(p.id) === Number(pid));
                        if (planObj) {
                            planObj.scenarios = normalized;
                            state.selectedScenarioId = planObj.scenarios.length ? planObj.scenarios[0].id : null;
                        }
                        renderAll();
                        setStatus('', 'info');
                    } catch (err) {
                        setStatus(err instanceof Error ? err.message : 'Unable to load scenarios for plan.', 'error');
                        // still render whatever we have
                        renderAll();
                    }
                    // update New Scenario button state when plan changes
                    try { syncNewScenarioButtonState(); } catch (e) { }
                })();
            });
        }

        // wire scenario search input
        if (els.scenarioSearch) {
            els.scenarioSearch.addEventListener('input', debounce((ev) => {
                // simple client-side filter; store in a temp and re-render
                const q = (els.scenarioSearch.value || '').trim().toLowerCase();
                // apply filter by adjusting rendering: set a temporary property
                state._scenarioSearch = q;
                renderScenarioList();
            }, 200));
        }

        // wire case search input (search by testcase_id, title, description)
        try {
            const caseSearchEl = document.getElementById('case-search');
            if (caseSearchEl) {
                caseSearchEl.addEventListener('input', debounce(async (ev) => {
                    const q = (caseSearchEl.value || '').trim();
                    state._caseSearch = q.toLowerCase();
                    // If empty, clear remote results and re-render scenario view
                    if (!q) {
                        state._caseSearchResults = null;
                        try { renderCaseList(); } catch (e) { /* ignore */ }
                        return;
                    }
                    // perform server-side search to allow cross-scenario results
                    try {
                        setStatus('Searching cases...', 'info');
                        const base = apiEndpoints.cases || '/api/core/test-cases/';
                        // include scenario filter when available
                        try {
                            const params = new URLSearchParams();
                            params.append('search', String(q));
                            if (state && state.selectedScenarioId) params.append('scenario', String(state.selectedScenarioId));
                            const query = params.toString();
                            const computed = query ? `${base}?${query}` : base;
                            window.__automation_case_search_url = computed;
                        } catch (e) {
                            window.__automation_case_search_url = `${base}?search=${encodeURIComponent(q)}`;
                        }
                        const url = window.__automation_case_search_url || (function () { try { const p = new URLSearchParams(); p.append('search', String(q)); if (state && state.selectedScenarioId) p.append('scenario', String(state.selectedScenarioId)); const qstr = p.toString(); return qstr ? `${base}?${qstr}` : base; } catch (err) { return `${base}?search=${encodeURIComponent(q)}`; } })();
                        const resp = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
                        if (!resp.ok) throw new Error('Search failed');
                        const data = await resp.json();
                        // normalize data to an array of case objects
                        state._caseSearchResults = Array.isArray(data) ? data : [];
                        setStatus('', 'info');
                        try { renderCaseList(); } catch (e) { /* ignore */ }
                    } catch (err) {
                        setStatus('Case search failed.', 'error');
                    }
                }, 300));
            }
        } catch (e) { /* ignore */ }

        // Delegated handler: ensure any input with class 'automation-search' triggers
        // the case search logic even if the input was injected after script ran.
        document.addEventListener('input', debounce(async (ev) => {
            try {
                const el = ev.target;
                if (!el || !el.classList || !el.classList.contains('automation-search')) return;
                // Only handle #case-search for now (other automation-search uses can be added)
                if (String(el.id || '') !== 'case-search') return;
                const q = (el.value || '').trim();
                state._caseSearch = q.toLowerCase();
                if (!q) {
                    state._caseSearchResults = null;
                    try { renderCaseList(); } catch (e) { /* ignore */ }
                    return;
                }
                try {
                    setStatus('Searching cases...', 'info');
                    const base = apiEndpoints.cases || '/api/core/test-cases/';
                    // include scenario filter when available
                    const url = (function () { try { const params = new URLSearchParams(); params.append('search', String(q)); if (state && state.selectedScenarioId) params.append('scenario', String(state.selectedScenarioId)); const qstr = params.toString(); return qstr ? `${base}?${qstr}` : base; } catch (err) { return `${base}?search=${encodeURIComponent(q)}`; } })();
                    const resp = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
                    if (!resp.ok) throw new Error('Search failed');
                    const data = await resp.json();
                    state._caseSearchResults = Array.isArray(data) ? data : [];
                    setStatus('', 'info');
                    try { renderCaseList(); } catch (e) { /* ignore */ }
                } catch (err) {
                    setStatus('Case search failed.', 'error');
                    automationLog('error', '[automation] delegated case search error', err);
                }
            } catch (e) { /* ignore */ }
        }, 300));

        // New Scenario button should use the same modal flow as Add Scenario in Data Management
        const openNewScenarioButton = document.getElementById('open-new-scenario');
        if (openNewScenarioButton) {
            openNewScenarioButton.addEventListener('click', (ev) => {
                // ensure a plan and module are selected
                const planId = state.selectedPlanId || (els.scenarioPlan && els.scenarioPlan.value ? Number(els.scenarioPlan.value) : null);
                const moduleFilter = document.getElementById('module-filter');
                const mid = moduleFilter && moduleFilter.value ? Number(moduleFilter.value) : null;
                // Debug: log the user click and current selection so it's visible in Console
                automationLog('info', '[automation] open-new-scenario clicked', { planIdCandidate: planId, moduleFilterValue: mid });
                if (!planId) {
                    setStatus('Please select a plan before creating a scenario.', 'error');
                    showToast('Please select a plan before creating a scenario.');
                    return;
                }
                if (!mid) {
                    setStatus('Please select a module before creating a scenario.', 'error');
                    showToast('Please select a module before creating a scenario.');
                    return;
                }
                // Dispatch a custom event which data_management.js listens for.
                try {
                    const ev = new CustomEvent('open-module-scenario', { detail: { mode: 'create', moduleId: mid } });
                    document.dispatchEvent(ev);
                    automationLog('info', '[automation] dispatched open-module-scenario', { detail: ev.detail });
                } catch (e) {
                    // fallback to direct open if event fails
                    try {
                        if (typeof window.openModuleScenarioModal === 'function') {
                            window.openModuleScenarioModal('create', mid);
                        } else {
                            const modal = document.querySelector('[data-role="module-add-scenario-modal"]');
                            if (modal) {
                                const moduleInput = document.getElementById('module-add-scenario-module-id'); if (moduleInput) moduleInput.value = mid || '';
                                modal.hidden = false; body.classList.add('automation-modal-open');
                                const titleInput = document.getElementById('module-add-scenario-title'); if (titleInput) titleInput.focus();
                            }
                        }
                        automationLog('info', '[automation] fallback opened modal directly', { moduleId: mid });
                    } catch (err) { /* ignore */ }
                }
            });
        }

        // Keep New Scenario button enabled only when both plan and module are selected
        const syncNewScenarioButtonState = () => {
            try {
                const btn = document.getElementById('open-new-scenario');
                if (!btn) return;
                // Keep the button enabled so clicks are always possible. Validation
                // for missing plan/module occurs when the button is clicked which
                // will show a toast and prevent opening the modal.
                btn.disabled = false;
            } catch (e) { /* ignore */ }
        };

        // call on init and when plan/module changes
        syncNewScenarioButtonState();

        // Listen for module changes from data-management so we can refresh
        // the scenarios table when modules or scenarios are created/updated.
        try {
            document.addEventListener('test-modules-changed', (ev) => {
                try {
                    automationLog('info', '[automation] test-modules-changed received', ev && ev.detail ? ev.detail : null);
                    // Re-fetch scenarios for the currently selected plan so the
                    // table reflects the latest server state.
                    const pid = state.selectedPlanId || (els.scenarioPlan && els.scenarioPlan.value ? Number(els.scenarioPlan.value) : null);
                    if (!pid) return;
                    // Trigger the same code path as plan change to fetch and render
                    (async () => {
                        try {
                            setStatus('Refreshing scenarios…', 'info');
                            const base = apiEndpoints.scenarios || '/api/core/test-scenarios/';
                            const url = `${base}?plan=${encodeURIComponent(pid)}`;
                            const resp = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
                            if (!resp.ok) throw new Error(`Failed to fetch scenarios: ${resp.status}`);
                            const data = await resp.json();
                            const normalized = Array.isArray(data) ? data.map(normalizeScenario) : [];
                            const planObj = state.plans.find((p) => Number(p.id) === Number(pid));
                            if (planObj) {
                                planObj.scenarios = normalized;
                                state.selectedScenarioId = planObj.scenarios.length ? planObj.scenarios[0].id : null;
                            }
                            renderAll();
                            setStatus('', 'info');
                        } catch (err) {
                            setStatus(err instanceof Error ? err.message : 'Unable to refresh scenarios.', 'error');
                        }
                    })();
                } catch (e) { /* ignore */ }
            });
        } catch (e) { /* ignore */ }

        const openPlanModal = () => {
            if (!els.planModal) {
                return;
            }
            els.planModal.hidden = false;
            body.classList.add('automation-modal-open');
            initObjectiveEditor();
            const focusTarget = inputs.plan.name;
            window.requestAnimationFrame(() => {
                if (focusTarget) {
                    focusTarget.focus();
                }
            });
        };

        const openPlanEdit = async (plan) => {
            // Debug: log when the edit modal is opened and whether details exist
            automationLog('debug', '[automation] openPlanEdit called', { id: plan && plan.id, hasDetails: Array.isArray(plan && plan.risk_mitigation_details) && plan.risk_mitigation_details.length });
            if (!plan) return;
            // Ensure we have the full plan detail (including risk_mitigation_details)
            // The list endpoint may not include nested mapping details, so fetch
            // the detail endpoint when needed to populate the mapping table.
            try {
                const hasDetails = Array.isArray(plan.risk_mitigation_details) && plan.risk_mitigation_details.length;
                if (!hasDetails && plan.id) {
                    const base = apiEndpoints.plans || '/api/core/test-plans/';
                    const url = `${base}${plan.id}/`;
                    const resp = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
                    if (resp && resp.ok) {
                        const data = await resp.json();
                        if (data && typeof data === 'object') {
                            // normalize fetched plan so nested arrays and fields
                            // (notably risk_mitigation_details) are in the shape
                            // our renderer expects.
                            plan = normalizePlan(data);
                            // update cached state entry if present
                            try {
                                const idx = state.plans.findIndex((p) => p.id === plan.id);
                                if (idx !== -1) state.plans[idx] = plan;
                            } catch (ignore) { }
                        }
                    }
                }
            } catch (ignore) {
                // ignore fetch errors and continue with whatever plan data we have
            }
            state.editingPlan = true;
            state.viewingPlan = false;
            planDraftId = plan.id;
            // populate fields for step 1
            if (inputs.plan.name) inputs.plan.name.value = plan.name || '';
            if (inputs.plan.description) inputs.plan.description.value = plan.description || '';
            // scopes
            const scopes = Array.isArray(plan.scopes) ? plan.scopes : [];
            const inScope = scopes.filter(s => s.category === 'in_scope').map(s => s.item || '').join('\n');
            const outScope = scopes.filter(s => s.category === 'out_scope').map(s => s.item || '').join('\n');
            if (inputs.plan.scopeIn) inputs.plan.scopeIn.value = inScope;
            if (inputs.plan.scopeOut) inputs.plan.scopeOut.value = outScope;
            // testing timeline & simple lists
            if (inputs.plan.modules) inputs.plan.modules.value = Array.isArray(plan.modules_under_test) ? plan.modules_under_test.join(',') : '';
            if (inputs.plan.tools) inputs.plan.tools.value = Array.isArray(plan.tools) ? plan.tools.join(',') : '';
            // testing types: fill comma-separated inputs
            if (inputs.plan.functional) {
                const f = plan.testing_types && Array.isArray(plan.testing_types.functional) ? plan.testing_types.functional.join(',') : '';
                inputs.plan.functional.value = f;
            }
            if (inputs.plan.nonFunctional) {
                const nf = plan.testing_types && Array.isArray(plan.testing_types.non_functional) ? plan.testing_types.non_functional.join(',') : '';
                inputs.plan.nonFunctional.value = nf;
            }
            if (inputs.plan.testers) inputs.plan.testers.value = Array.isArray(plan.testers) ? plan.testers.join(',') : '';
            if (inputs.plan.approver) inputs.plan.approver.value = plan.approver || '';
            if (inputs.plan.kickoff) inputs.plan.kickoff.value = plan.testing_timeline ? (plan.testing_timeline.kickoff || '') : '';
            if (inputs.plan.signoff) inputs.plan.signoff.value = plan.testing_timeline ? (plan.testing_timeline.signoff || '') : '';
            // objective
            const editor = getObjectiveEditor();
            if (editor && typeof editor.setContent === 'function') {
                editor.setContent(plan.objective || '');
            } else if (inputs.plan.objective) {
                inputs.plan.objective.value = plan.objective || '';
            }
            showPlanStep(1);
            openPlanModal();
            // render risk matrix checkboxes for step 4
            renderPlanRiskMatrix(plan);
        };

        const openPlanView = async (plan) => {
            if (!plan) return;
            // Fetch detail if needed
            try {
                const hasDetails = Array.isArray(plan.risk_mitigation_details) && plan.risk_mitigation_details.length;
                if (!hasDetails && plan.id) {
                    const base = apiEndpoints.plans || '/api/core/test-plans/';
                    const url = `${base}${plan.id}/`;
                    const resp = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
                    if (resp && resp.ok) {
                        const data = await resp.json();
                        if (data && typeof data === 'object') plan = data;
                    }
                }
            } catch (e) { /* ignore */ }
            // Populate modal fields but keep it read-only
            state.editingPlan = false;
            state.viewingPlan = true;
            planDraftId = null;
            if (inputs.plan.name) { inputs.plan.name.value = plan.name || ''; inputs.plan.name.disabled = true; }
            if (inputs.plan.description) { inputs.plan.description.value = plan.description || ''; inputs.plan.description.disabled = true; }
            if (inputs.plan.scopeIn) { inputs.plan.scopeIn.value = Array.isArray(plan.scopes) ? plan.scopes.filter(s => s.category === 'in_scope').map(s => s.item).join('\n') : ''; inputs.plan.scopeIn.disabled = true; }
            if (inputs.plan.scopeOut) { inputs.plan.scopeOut.value = Array.isArray(plan.scopes) ? plan.scopes.filter(s => s.category === 'out_scope').map(s => s.item).join('\n') : ''; inputs.plan.scopeOut.disabled = true; }
            if (inputs.plan.modules) { inputs.plan.modules.value = Array.isArray(plan.modules_under_test) ? plan.modules_under_test.join(',') : ''; inputs.plan.modules.disabled = true; }
            if (inputs.plan.tools) { inputs.plan.tools.value = Array.isArray(plan.tools) ? plan.tools.join(',') : ''; inputs.plan.tools.disabled = true; }
            if (inputs.plan.testers) { inputs.plan.testers.value = Array.isArray(plan.testers) ? plan.testers.join(',') : ''; inputs.plan.testers.disabled = true; }
            if (inputs.plan.approver) { inputs.plan.approver.value = plan.approver || ''; inputs.plan.approver.disabled = true; }
            // objective: set read-only content
            const editor = getObjectiveEditor();
            if (editor && typeof editor.setContent === 'function') {
                editor.setContent(plan.objective || '');
                // if the editor supports disabling, try to set readonly
                if (typeof editor.mode === 'function') {
                    try { editor.mode.set('readonly'); } catch (ignore) { }
                }
            } else if (inputs.plan.objective) { inputs.plan.objective.value = plan.objective || ''; inputs.plan.objective.disabled = true; }
            showPlanStep(1);
            openPlanModal();
            renderPlanRiskMatrix(plan);
        };

        const enablePlanInputs = () => {
            try {
                if (inputs && inputs.plan) {
                    Object.values(inputs.plan).forEach((node) => {
                        if (node && typeof node === 'object' && 'disabled' in node) node.disabled = false;
                    });
                }
                const editor = getObjectiveEditor();
                if (editor && typeof editor.setContent === 'function') {
                    // no-op for enabling; editor may be interactive by default
                }
            } catch (e) { }
            state.viewingPlan = false;
        };

        const renderPlanRiskMatrix = async (plan) => {
            // Normalize incoming plan object early so downstream logic can
            // rely on consistent shapes (notably risk_mitigation_details).
            plan = normalizePlan(plan);
            // Debug: log invocation and basic plan/risk state as well as the
            // presence/size of page-injected mapping payloads which we prefer.
            try {
                const hasDetails = Array.isArray(plan && plan.risk_mitigation_details) && plan.risk_mitigation_details.length;
                const selNode = document.getElementById('automation-initial-risk-mitigations-for-selected');
                const byPlanNode = document.getElementById('automation-initial-risk-mitigations-by-plan');
                const allNode = document.getElementById('automation-initial-risk-mitigations');
                let selLen = null; let byPlanLen = null; let allLen = null;
                try { selLen = selNode ? (JSON.parse(selNode.textContent || selNode.innerText || '[]') || []).length : null; } catch (_e) { selLen = 'parse-error'; }
                try { byPlanLen = byPlanNode ? Object.keys(JSON.parse(byPlanNode.textContent || byPlanNode.innerText || '{}') || {}).reduce((acc, k) => acc + ((JSON.parse(byPlanNode.textContent || byPlanNode.innerText || '{}') || {})[k] || []).length, 0) : null; } catch (_e) { byPlanLen = 'parse-error'; }
                try { allLen = allNode ? (JSON.parse(allNode.textContent || allNode.innerText || '[]') || []).length : null; } catch (_e) { allLen = 'parse-error'; }
                automationLog('debug', '[automation] renderPlanRiskMatrix called', { id: plan && plan.id, hasDetails, injected: { selectedForPlan: selLen, byPlanTotal: byPlanLen, allMappings: allLen } });
            } catch (e) { /* ignore logging errors */ }
            if (!els.planRiskMatrix) return;
            // Ensure we have detailed mapping objects for the plan. If the plan
            // only contains mapping ids (from the list endpoint), fetch the
            // detail endpoint so we can render the mapping rows immediately.
            try {
                const hasDetails = Array.isArray(plan && plan.risk_mitigation_details) && plan.risk_mitigation_details.length;
                // If the plan doesn't include nested details, attempt to fetch
                // them from the per-plan mapping endpoint which accepts ?plan=<id>.
                if (!hasDetails && plan && plan.id) {
                    const mappingsUrlBase = apiEndpoints.risk_mitigations || '/api/core/risk-and-mitigation-plans/';
                    const url = `${mappingsUrlBase}?plan=${encodeURIComponent(plan.id)}`;
                    try {
                        // Debug: log the exact URL we're about to request so we can
                        // verify the plan query parameter is present.
                        automationLog('debug', '[automation] fetching per-plan mappings', { mappingsUrlBase, url, planId: plan.id });
                        const resp = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
                        if (resp) {
                            if (resp.status === 401) {
                                // Authentication required — show a helpful message
                                // in the mapping table rather than the generic empty
                                // message so the user knows to sign in.
                                try {
                                    const mappingTbody = document.querySelector('[data-role="mapping-list"]');
                                    if (mappingTbody) mappingTbody.innerHTML = '<tr><td colspan="7" class="empty">Please sign in to view risk-to-mitigation links.</td></tr>';
                                } catch (err) { /* ignore */ }
                            } else if (resp.ok) {
                                const data = await resp.json();
                                if (Array.isArray(data) && data.length) {
                                    // The mapping endpoint returns an array of mapping
                                    // objects for the plan — treat these as authoritative
                                    // details for the mapping table.
                                    plan = normalizePlan({ ...plan, risk_mitigation_details: data });
                                    try {
                                        const idx = state.plans.findIndex((p) => p.id === plan.id);
                                        if (idx !== -1) state.plans[idx] = plan;
                                    } catch (ignore) { }
                                } else {
                                    // As a fallback, try the plan detail endpoint which
                                    // may include nested risk_mitigation_details.
                                    const base = apiEndpoints.plans || '/api/core/test-plans/';
                                    const detailUrl = `${base}${plan.id}/`;
                                    const dResp = await fetch(detailUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
                                    if (dResp && dResp.ok) {
                                        const dData = await dResp.json();
                                        if (dData && typeof dData === 'object') {
                                            plan = normalizePlan(dData);
                                            try {
                                                const idx2 = state.plans.findIndex((p) => p.id === plan.id);
                                                if (idx2 !== -1) state.plans[idx2] = plan;
                                            } catch (ignore) { }
                                        }
                                    }
                                }
                                // Immediately attach search handler to #case-search if present (guarded)
                                try {
                                    const caseSearchElImmediate = panel.querySelector('#case-search');
                                    if (caseSearchElImmediate && !caseSearchElImmediate.dataset._searchAttached) {
                                        caseSearchElImmediate.dataset._searchAttached = '1';
                                        caseSearchElImmediate.addEventListener('input', debounce(async (ev) => {
                                            const q = (caseSearchElImmediate.value || '').trim();
                                            state._caseSearch = q.toLowerCase();
                                            if (!q) {
                                                state._caseSearchResults = null;
                                                try { renderCaseList(); } catch (e) { /* ignore */ }
                                                return;
                                            }
                                            try {
                                                setStatus('Searching cases...', 'info');
                                                const base = apiEndpoints.cases || '/api/core/test-cases/';
                                                // include scenario filter when available
                                                const url = (function () { try { const params = new URLSearchParams(); params.append('search', String(q)); if (state && state.selectedScenarioId) params.append('scenario', String(state.selectedScenarioId)); const qstr = params.toString(); return qstr ? `${base}?${qstr}` : base; } catch (err) { return `${base}?search=${encodeURIComponent(q)}`; } })();
                                                const resp = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
                                                if (!resp.ok) throw new Error('Search failed');
                                                const data = await resp.json();
                                                state._caseSearchResults = Array.isArray(data) ? data : [];
                                                setStatus('', 'info');
                                                try { renderCaseList(); } catch (e) { /* ignore */ }
                                            } catch (err) {
                                                setStatus('Case search failed.', 'error');
                                            }
                                        }, 300));
                                    }
                                } catch (e) { /* ignore */ }
                            }
                        }
                    } catch (ignore) { }
                }
            } catch (ignore) { }
            // try to fetch risks/mitigations if not available
            const fetchUrl = (path) => apiEndpoints[path] || '';
            let risks = [];
            try {
                const rUrl = fetchUrl('risks');
                if (rUrl) {
                    const resp = await fetch(rUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
                    if (resp.ok) risks = await resp.json();
                }
            } catch (_err) {
                risks = [];
            }
            if (!risks.length) {
                // try to use data injected on page if present
                try {
                    const node = document.getElementById('automation-initial-risks');
                    if (node) risks = JSON.parse(node.textContent || node.innerText || '[]');
                } catch (_e) {
                    risks = [];
                }
            }
            if (!risks.length) {
                els.planRiskMatrix.innerHTML = '<p class="empty">No risks available. Create risks in the Data Management panel first.</p>';
                return;
            }
            // plan.risk_mitigations contains mapping ids (RiskAndMitigationPlan ids),
            // while risk_mitigation_details contains objects with the actual risk id
            // in the `risk` property. Prefer deriving linked risk ids from
            // risk_mitigation_details so the matrix can compare against Risk ids.
            let linked = [];
            if (Array.isArray(plan.risk_mitigation_details) && plan.risk_mitigation_details.length) {
                linked = plan.risk_mitigation_details.map((d) => d && d.risk).filter(Boolean);
            } else {
                // Prefer the injected per-selected-plan payload (fast, exact)
                try {
                    const selNode = document.getElementById('automation-initial-risk-mitigations-for-selected');
                    if (selNode) {
                        const sel = JSON.parse(selNode.textContent || selNode.innerText || '[]');
                        if (Array.isArray(sel) && sel.length) {
                            linked = sel.map((m) => m && m.risk).filter(Boolean);
                        }
                    }
                } catch (_e) { /* ignore parsing errors */ }
                // Next, try per-plan map object
                if (!linked.length) {
                    try {
                        const byPlanNode = document.getElementById('automation-initial-risk-mitigations-by-plan');
                        if (byPlanNode) {
                            const mapObj = JSON.parse(byPlanNode.textContent || byPlanNode.innerText || '{}');
                            const arr = mapObj && (mapObj[String(plan.id)] || mapObj[plan.id]) ? (mapObj[String(plan.id)] || mapObj[plan.id]) : [];
                            if (Array.isArray(arr) && arr.length) {
                                linked = arr.map((m) => m && m.risk).filter(Boolean);
                            }
                        }
                    } catch (_e) { /* ignore */ }
                }
                // Fallback: try to resolve from the full page-injected initial mappings
                if (!linked.length) {
                    try {
                        const node = document.getElementById('automation-initial-risk-mitigations');
                        if (node) {
                            const allMappings = JSON.parse(node.textContent || node.innerText || '[]');
                            if (Array.isArray(allMappings) && allMappings.length) {
                                const forPlan = allMappings.filter((m) => m && Number(m.plan) === Number(plan.id));
                                linked = forPlan.map((m) => m && m.risk).filter(Boolean);
                            }
                        }
                    } catch (_e) {
                        linked = [];
                    }
                }
            }
            const rows = risks.map((risk) => {
                const checked = linked.includes(risk.id) ? 'checked' : '';
                return `<label class="plan-risk-row"><input type="checkbox" data-role="plan-risk-checkbox" value="${risk.id}" ${checked}> ${escapeHtml(risk.title || '')}</label>`;
            }).join('');
            els.planRiskMatrix.innerHTML = `<div class="plan-risk-list">${rows}</div>`;

            // Also populate the detailed mapping table (used in the plan modal)
            // if present on the page. This table is normally managed by the
            // data-management module, but on the Test Plan modal that module
            // may not be initialised. Populate it from the plan's
            // risk_mitigation_details so users can see linked mitigations.
            try {
                const mappingTbody = document.querySelector('[data-role="mapping-list"]');
                if (mappingTbody) {
                    automationLog('debug', '[automation] mapping tbody found on page');
                    // Prefer the detailed objects on the plan, but fall back to
                    // resolving mapping ids against the page-injected initial
                    // risk mitigations if the details are not present. This
                    // covers cases where the list endpoint doesn't include
                    // nested objects or a detail fetch failed due to auth.
                    let details = Array.isArray(plan.risk_mitigation_details) ? plan.risk_mitigation_details : [];
                    let detailsSource = Array.isArray(plan.risk_mitigation_details) && plan.risk_mitigation_details.length ? 'details' : null;
                    if (!details.length) {
                        // Prefer selected-plan injected mappings
                        try {
                            const selNode = document.getElementById('automation-initial-risk-mitigations-for-selected');
                            if (selNode) {
                                const sel = JSON.parse(selNode.textContent || selNode.innerText || '[]');
                                if (Array.isArray(sel) && sel.length) { details = sel; detailsSource = 'selected'; }
                            }
                        } catch (_e) { /* ignore */ }
                    }
                    if (!details.length) {
                        // Next prefer the by-plan mapping map
                        try {
                            const byPlanNode = document.getElementById('automation-initial-risk-mitigations-by-plan');
                            if (byPlanNode) {
                                const mapObj = JSON.parse(byPlanNode.textContent || byPlanNode.innerText || '{}');
                                const arr = mapObj && (mapObj[String(plan.id)] || mapObj[plan.id]) ? (mapObj[String(plan.id)] || mapObj[plan.id]) : [];
                                if (Array.isArray(arr) && arr.length) { details = arr; detailsSource = 'by-plan'; }
                            }
                        } catch (_e) { /* ignore */ }
                    }
                    if (!details.length) {
                        try {
                            const node = document.getElementById('automation-initial-risk-mitigations');
                            if (node) {
                                const allMappings = JSON.parse(node.textContent || node.innerText || '[]');
                                if (Array.isArray(allMappings) && allMappings.length) {
                                    details = allMappings.filter((m) => m && Number(m.plan) === Number(plan.id));
                                    if (details.length) detailsSource = 'all-mappings';
                                }
                            }
                        } catch (_e) {
                            details = [];
                        }
                    }
                    if (!details.length) {
                        automationLog('debug', '[automation] mapping details resolved: none');
                        // Additional debug info to help diagnose why mappings are
                        // empty: dump page-injected mappings and plan id.
                        try {
                            const nodeAll = document.getElementById('automation-initial-risk-mitigations');
                            const allText = nodeAll ? (nodeAll.textContent || nodeAll.innerText || '') : '';
                            automationLog('debug', '[automation] fallback allMappings length', allText ? (JSON.parse(allText) || []).length : 0, 'planId', plan && plan.id);
                        } catch (err) { automationLog('debug', '[automation] error parsing fallback mappings', err); }
                        mappingTbody.innerHTML = '<tr><td colspan="7" class="empty">No risk to mitigation links found for the current filters.</td></tr>';
                        // If mappings were not available yet due to a race, try a
                        // single delayed retry to populate the table.
                        setTimeout(() => {
                            try {
                                const node = document.getElementById('automation-initial-risk-mitigations');
                                if (node) {
                                    const allMappings = JSON.parse(node.textContent || node.innerText || '[]');
                                    const forPlan = Array.isArray(allMappings) ? allMappings.filter((m) => m && Number(m.plan) === Number(plan.id)) : [];
                                    if (forPlan.length) {
                                        automationLog('debug', '[automation] retry: found fallback mappings after delay', forPlan.length);
                                        // Dedupe by mapping id in case the details got
                                        // populated elsewhere and to avoid rendering
                                        // duplicate rows when the same mapping appears
                                        // in multiple payloads.
                                        const seen = new Set();
                                        const uniqueForPlan = [];
                                        forPlan.forEach((m) => {
                                            const key = m && (m.id || m.pk || m.mapping_id) ? String(m.id || m.pk || m.mapping_id) : null;
                                            if (!key) return;
                                            if (!seen.has(key)) {
                                                seen.add(key);
                                                uniqueForPlan.push(m);
                                            }
                                        });

                                        const retryRows = uniqueForPlan
                                            .map((m, idx) => {
                                                const riskTitle = m.risk_title ? escapeHtml(m.risk_title) : 'Untitled';
                                                const mitigationTitle = m.mitigation_plan_title ? escapeHtml(m.mitigation_plan_title) : 'Untitled';
                                                const impact = m.impact ? escapeHtml(m.impact) : '&mdash;';
                                                const updated = m.updated_at ? formatDateTime(m.updated_at) : '&mdash;';
                                                return `
                                                    <tr data-mapping-id="${m.id}" data-source="all-mappings">
                                                        <td data-label="#">${idx + 1}</td>
                                                        <td data-label="Risk"><strong>${riskTitle}</strong>${m.risk_description ? `<div class="table-secondary">${escapeHtml(m.risk_description)}</div>` : ''}</td>
                                                        <td data-label="Mitigation Plan"><strong>${mitigationTitle}</strong>${m.mitigation_plan_description ? `<div class="table-secondary">${escapeHtml(m.mitigation_plan_description)}</div>` : ''}</td>
                                                        <td data-label="Impact">${impact}</td>
                                                        <td data-label="Linked">&check;</td>
                                                        <td data-label="Updated">${updated}</td>
                                                        <td data-label="Actions"><div class="table-action-group"><button type="button" class="action-button" data-action="view-mapping" data-id="${m.id}">View</button></div></td>
                                                    </tr>
                                                `;
                                            })
                                            .join('');
                                        // Only replace the tbody if we still have the
                                        // placeholder / empty row to avoid duplicating
                                        // rows that may have been inserted by another
                                        // module.
                                        const existing = mappingTbody.querySelectorAll('tr[data-mapping-id]');
                                        if (!existing || existing.length === 0) {
                                            mappingTbody.innerHTML = retryRows;
                                        } else {
                                            automationLog('debug', '[automation] retry: mapping table already populated, skipping overwrite', { existing: existing.length });
                                        }
                                    }
                                }
                            } catch (err) {
                                /* ignore retry errors */
                            }
                        }, 250);
                    } else {
                        automationLog('debug', '[automation] mapping details resolved', { count: details.length });
                        // Dedupe details by mapping id to avoid rendering
                        // duplicate rows if entries come from multiple
                        // sources (nested details, by-plan map, full list).
                        const seen = new Set();
                        const uniqueDetails = [];
                        details.forEach((m) => {
                            const key = m && (m.id || m.pk || m.mapping_id) ? String(m.id || m.pk || m.mapping_id) : null;
                            if (!key) return;
                            if (!seen.has(key)) {
                                seen.add(key);
                                uniqueDetails.push(m);
                            }
                        });

                        // Log the source and mapping ids for diagnostic purposes
                        try {
                            automationLog('debug', '[automation] mapping rows source', { source: detailsSource || 'unknown', ids: uniqueDetails.map((m) => m && m.id) });
                        } catch (err) { /* ignore */ }

                        const mapRows = uniqueDetails
                            .map((m, idx) => {
                                const riskTitle = m.risk_title ? escapeHtml(m.risk_title) : 'Untitled';
                                const mitigationTitle = m.mitigation_plan_title ? escapeHtml(m.mitigation_plan_title) : 'Untitled';
                                const impact = m.impact ? escapeHtml(m.impact) : '&mdash;';
                                const updated = m.updated_at ? formatDateTime(m.updated_at) : '&mdash;';
                                return `
                                    <tr data-mapping-id="${m.id}" data-source="${detailsSource || 'unknown'}">
                                        <td data-label="#">${idx + 1}</td>
                                        <td data-label="Risk">
                                            <strong>${riskTitle}</strong>
                                            ${m.risk_description ? `<div class="table-secondary">${escapeHtml(m.risk_description)}</div>` : ''}
                                        </td>
                                        <td data-label="Mitigation Plan">
                                            <strong>${mitigationTitle}</strong>
                                            ${m.mitigation_plan_description ? `<div class="table-secondary">${escapeHtml(m.mitigation_plan_description)}</div>` : ''}
                                        </td>
                                        <td data-label="Impact">${impact}</td>
                                        <td data-label="Linked">&check;</td>
                                        <td data-label="Updated">${updated}</td>
                                        <td data-label="Actions">
                                            <div class="table-action-group">
                                                <button type="button" class="action-button" data-action="view-mapping" data-id="${m.id}">View</button>
                                            </div>
                                        </td>
                                    </tr>
                                `;
                            })
                            .join('');
                        mappingTbody.innerHTML = mapRows;
                    }
                }
            } catch (e) {
                // ignore errors updating auxiliary mapping table
            }
        };

        const closePlanModal = (options = {}) => {
            const { resetForm = false, returnFocus = true } = options;
            if (!els.planModal) {
                return;
            }
            els.planModal.hidden = true;
            body.classList.remove('automation-modal-open');
            if (resetForm && els.planForm) {
                els.planForm.reset();
                resetObjectiveEditor();
            }
            // if we were viewing a plan, re-enable inputs
            try {
                if (state.viewingPlan) enablePlanInputs();
            } catch (e) { }
            if (returnFocus && els.planModalTrigger) {
                els.planModalTrigger.focus();
            }
        };

        const handlePlanModalEscape = (event) => {
            if (event.key === 'Escape' && els.planModal && !els.planModal.hidden) {
                event.preventDefault();
                closePlanModal({ resetForm: true, returnFocus: true });
            }
        };

        const formatScopePreview = (items) => {
            if (!items.length) {
                return '';
            }
            const previewItems = items.slice(0, 3).map((value) => escapeHtml(value));
            let summary = previewItems.join(', ');
            if (items.length > 3) {
                summary += ` +${items.length - 3} more`;
            }
            return summary;
        };

        const buildScopePreview = (plan) => {
            if (!plan || typeof plan !== 'object') {
                return '';
            }
            const scopes = Array.isArray(plan.scopes) ? plan.scopes : [];
            if (!scopes.length) {
                return '';
            }
            const inScopeItems = [];
            const outScopeItems = [];
            scopes.forEach((entry) => {
                if (!entry || typeof entry !== 'object') {
                    return;
                }
                const value = typeof entry.item === 'string' ? entry.item.trim() : '';
                if (!value) {
                    return;
                }
                if (entry.category === 'out_scope') {
                    outScopeItems.push(value);
                } else if (entry.category === 'in_scope') {
                    inScopeItems.push(value);
                }
            });
            if (!inScopeItems.length && !outScopeItems.length) {
                return '';
            }
            const segments = [];
            if (inScopeItems.length) {
                segments.push(`<span class="scope-chip scope-chip--in">In: ${formatScopePreview(inScopeItems)}</span>`);
            }
            if (outScopeItems.length) {
                segments.push(`<span class="scope-chip scope-chip--out">Out: ${formatScopePreview(outScopeItems)}</span>`);
            }
            return segments.length ? `<div class="table-scope-preview">${segments.join('')}</div>` : '';
        };

        const buildRiskPreview = (plan) => {
            if (!plan || typeof plan !== 'object') {
                return '';
            }
            const linked = Array.isArray(plan.risk_mitigation_details) ? plan.risk_mitigation_details : [];
            if (!linked.length) {
                return '';
            }
            const summary = linked.length === 1 ? '1 linked risk' : `${linked.length} linked risks`;
            return `<div class="table-tertiary">${escapeHtml(summary)}</div>`;
        };

        const renderPlanList = () => {
            if (!els.planList) {
                return;
            }
            const tbody = els.planList;
            tbody.innerHTML = '';
            if (!state.plans.length) {
                const emptyRow = document.createElement('tr');
                emptyRow.className = 'empty-row';
                const cell = document.createElement('td');
                cell.colSpan = 7;
                cell.className = 'empty';
                cell.textContent = 'No test plans yet. Create one to kick off your automation cycle.';
                emptyRow.appendChild(cell);
                tbody.appendChild(emptyRow);
                return;
            }
            state.plans.forEach((plan) => {
                const row = document.createElement('tr');
                row.dataset.planId = String(plan.id);
                row.tabIndex = 0;
                const scenarioCount = Array.isArray(plan.scenarios) ? plan.scenarios.length : 0;
                const moduleCount = Array.isArray(plan.modules_under_test) ? plan.modules_under_test.length : 0;
                const testerCount = Array.isArray(plan.testers) ? plan.testers.length : 0;
                const timeline = plan.testing_timeline || {};
                const kickoff = timeline.kickoff || '—';
                const signoff = timeline.signoff || '—';
                const approver = plan.approver || '—';
                const scopePreview = buildScopePreview(plan);
                const riskPreview = buildRiskPreview(plan);

                if (plan.id === state.selectedPlanId) {
                    row.classList.add('is-active');
                    row.setAttribute('aria-selected', 'true');
                } else {
                    row.setAttribute('aria-selected', 'false');
                }

                row.innerHTML = `
                    <td data-label="Plan">
                        <strong>${escapeHtml(plan.name || 'Untitled plan')}</strong>
                        ${plan.description ? `<div class="table-secondary">${escapeHtml(plan.description)}</div>` : ''}
                        ${plan.objective ? `<div class="table-tertiary table-tertiary-rich">${plan.objective}</div>` : ''}
                        ${scopePreview}
                        ${riskPreview}
                    </td>
                    <td data-label="Scenarios">${scenarioCount}</td>
                    <td data-label="Modules">${moduleCount}</td>
                    <td data-label="Testers">${testerCount}</td>
                    <td data-label="Kickoff">${escapeHtml(kickoff)}</td>
                    <td data-label="Sign-off">${escapeHtml(signoff)}</td>
                    <td data-label="Approver">${escapeHtml(approver)}</td>
                    <td data-label="Actions">
                            <div class="table-action-group">
                                <button type="button" class="action-button" data-action="view-plan" data-plan-id="${plan.id}">View</button>
                                <button type="button" class="action-button" data-action="edit-plan" data-plan-id="${plan.id}">Edit</button>
                            </div>
                    </td>
                `;

                const selectPlan = () => {
                    if (state.selectedPlanId !== plan.id) {
                        state.selectedPlanId = plan.id;
                        const firstScenario = Array.isArray(plan.scenarios) && plan.scenarios.length ? plan.scenarios[0].id : null;
                        state.selectedScenarioId = firstScenario;
                        renderAll();
                    }
                };

                row.addEventListener('click', () => {
                    selectPlan();
                });

                row.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        selectPlan();
                    }
                });

                tbody.appendChild(row);
            });
        };

        const renderScenarioList = () => {
            // support pages that render scenarios in a table body (`scenarioTableBody`)
            // or a legacy `scenarioList` container. If neither exists, bail out.
            if (!els.scenarioTableBody && !els.scenarioList) {
                return;
            }
            const plan = getSelectedPlan();
            automationLog('debug', '[automation] renderScenarioList called', { selectedPlanId: state.selectedPlanId, plan: plan ? { id: plan.id, scenarios: Array.isArray(plan.scenarios) ? plan.scenarios.length : 0 } : null });
            if (els.planName) els.planName.textContent = plan ? plan.name : '—';
            // render into table body if present
            const tbody = els.scenarioTableBody;
            if (!plan) {
                const emptyTableHtml = '<tr><td colspan="6" class="empty">Select a plan to view scenarios.</td></tr>';
                const emptyListHtml = '<p class="empty">Select a plan to view scenarios.</p>';
                if (tbody) tbody.innerHTML = emptyTableHtml;
                if (els.scenarioList) els.scenarioList.innerHTML = emptyListHtml;
                return;
            }
            const scenarios = Array.isArray(plan.scenarios) ? plan.scenarios : [];
            automationLog('debug', '[automation] plan has scenarios count', scenarios.length);
            // Detailed per-scenario debug to surface module/plan shapes that
            // can break client-side filters when the API returns nested
            // objects instead of primitive ids.
            try {
                const details = scenarios.map((s) => ({ id: s && s.id, moduleValue: s && s.module, moduleType: s && s.module === null ? 'null' : typeof (s && s.module) }));
                automationLog('debug', '[automation] scenario module snapshot', details.slice(0, 50));
            } catch (err) {
                automationLog('debug', '[automation] error while snapshotting scenario modules', err);
            }
            // apply scenario search filter (from header)
            const q = state._scenarioSearch || '';
            const moduleFilterVal = (document.getElementById('module-filter') && document.getElementById('module-filter').value) ? String(document.getElementById('module-filter').value) : '';
            automationLog('debug', '[automation] applying filters', { search: q, moduleFilterVal });
            const filtered = scenarios.filter((s) => {
                if (q) {
                    const lower = q;
                    const match = (s.title || '').toLowerCase().includes(lower) || (s.description || '').toLowerCase().includes(lower) || (Array.isArray(s.tags) ? s.tags.join(' ').toLowerCase().includes(lower) : false);
                    if (!match) return false;
                }
                if (moduleFilterVal) {
                    // module filter expects module id match
                    // Log a per-item comparison to help debugging mismatches.
                    automationLog('debug', '[automation] module filter compare', { scenarioId: s && s.id, scenarioModule: s && s.module, cmpTo: moduleFilterVal, eq: String(s && s.module || '') === String(moduleFilterVal) });
                    return String(s.module || '') === String(moduleFilterVal);
                }
                return true;
            });
            if (!filtered.length) {
                if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="empty">No scenarios match the current filters for this plan.</td></tr>';
                else els.scenarioList.innerHTML = '<p class="empty">No scenarios match the current filters for this plan.</p>';
                return;
            }
            if (!scenarios.length) {
                if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="empty">No scenarios created yet for this plan.</td></tr>';
                else els.scenarioList.innerHTML = '<p class="empty">No scenarios created yet for this plan.</p>';
                return;
            }
            if (tbody) {
                const rows = filtered.map((scenario) => {
                    const module = initialModules.find((m) => Number(m.id) === Number(scenario.module));
                    const moduleLabel = module ? (module.title || module.name || `Module ${module.id}`) : '';
                    return `
                        <tr data-scenario-id="${scenario.id}">
                            <td>${escapeHtml(scenario.title || '')}</td>
                            <td>${escapeHtml(scenario.description || '')}</td>
                            <td>${escapeHtml(moduleLabel)}</td>
                            <td>${escapeHtml(formatDateTime(scenario.created_at || null))}</td>
                            <td>${escapeHtml(formatDateTime(scenario.updated_at || null))}</td>
                            <td>
                                <div class="table-action-group">
                                    <button type="button" class="action-button" data-action="view-scenario" data-scenario-id="${scenario.id}">View</button>
                                    <button type="button" class="action-button" data-action="edit-scenario" data-scenario-id="${scenario.id}">Edit</button>
                                    <button type="button" class="action-button" data-action="add-case" data-scenario-id="${scenario.id}">Add Case</button>
                                    <button type="button" class="action-button" data-action="delete-scenario" data-scenario-id="${scenario.id}" data-variant="danger">Delete</button>
                                </div>
                            </td>
                        </tr>
                    `;
                }).join('');
                tbody.innerHTML = rows;
                return;
            }
        };

        // wire module-filter change to re-render scenarios when user selects a module
        const moduleFilterEl = document.getElementById('module-filter');
        if (moduleFilterEl) {
            moduleFilterEl.addEventListener('change', (ev) => {
                const midRaw = moduleFilterEl.value;
                const mid = midRaw ? Number(midRaw) : null;
                automationLog('debug', '[automation] module filter changed', { value: mid });
                (async () => {
                    try {
                        setStatus('Loading scenarios for module…', 'info');
                        const base = apiEndpoints.scenarios || '/api/core/test-scenarios/';
                        let url = base;
                        const params = new URLSearchParams();
                        if (mid) params.append('module', String(mid));
                        if (state.selectedPlanId) params.append('plan', String(state.selectedPlanId));
                        const query = params.toString();
                        if (query) url = `${base}?${query}`;
                        const resp = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
                        if (!resp.ok) throw new Error(`Failed to fetch scenarios for module: ${resp.status}`);
                        const data = await resp.json();
                        // normalize scenarios so module/plan are ids (not nested objects)
                        const normalized = Array.isArray(data) ? data.map(normalizeScenario) : [];
                        automationLog('debug', '[automation] module scenarios fetched', { count: normalized.length, sample: normalized.length ? normalized[0] : null });
                        // Extra diagnostic: log module value/types for each returned scenario
                        try {
                            const moduleSnapshot = normalized.map((s) => ({ id: s && s.id, module: s && s.module, moduleType: s && s.module === null ? 'null' : typeof (s && s.module) }));
                            automationLog('debug', '[automation] module scenarios normalized snapshot', moduleSnapshot.slice(0, 200));
                            // show what would be matched for the currently selected module
                            const moduleMatches = normalized.filter((s) => String(s.module || '') === String(mid));
                            automationLog('debug', '[automation] module filter matching preview', { requestedModule: mid, matchedCount: moduleMatches.length, sample: moduleMatches.length ? moduleMatches[0] : null });
                        } catch (err) {
                            automationLog('debug', '[automation] error while producing module snapshots', err);
                        }
                        // If there's a selected plan, attach returned scenarios to it.
                        if (state.selectedPlanId) {
                            const planObj = state.plans.find((p) => Number(p.id) === Number(state.selectedPlanId));
                            if (planObj) {
                                planObj.scenarios = normalized;
                                state.selectedScenarioId = planObj.scenarios.length ? planObj.scenarios[0].id : null;
                            } else {
                                // Client-side plan cache didn't contain the selected
                                // plan id (possible if plans were refreshed elsewhere).
                                // Fall back to rendering the fetched scenarios as a
                                // temporary filtered list so the user sees results.
                                const virtualPlan = { id: '__virtual__', name: 'Filtered', scenarios: normalized };
                                if (els.planName) els.planName.textContent = virtualPlan.name;
                                const tbody = els.scenarioTableBody;
                                if (!virtualPlan.scenarios.length) {
                                    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="empty">No scenarios match the current filters.</td></tr>';
                                } else {
                                    const rows = virtualPlan.scenarios.map((scenario) => {
                                        const module = initialModules.find((m) => Number(m.id) === Number(scenario.module));
                                        const moduleLabel = module ? (module.title || module.name || `Module ${module.id}`) : '';
                                        return `
                                            <tr data-scenario-id="${scenario.id}">
                                                <td>${escapeHtml(scenario.title || '')}</td>
                                                <td>${escapeHtml(scenario.description || '')}</td>
                                                <td>${escapeHtml(moduleLabel)}</td>
                                                <td>${escapeHtml(formatDateTime(scenario.created_at || null))}</td>
                                                <td>${escapeHtml(formatDateTime(scenario.updated_at || null))}</td>
                                                <td>
                                                    <div class="table-action-group">
                                                        <button type="button" class="action-button" data-action="view-scenario" data-scenario-id="${scenario.id}">View</button>
                                                        <button type="button" class="action-button" data-action="edit-scenario" data-scenario-id="${scenario.id}">Edit</button>
                                                        <button type="button" class="action-button" data-action="add-case" data-scenario-id="${scenario.id}">Add Case</button>
                                                        <button type="button" class="action-button" data-action="delete-scenario" data-scenario-id="${scenario.id}" data-variant="danger">Delete</button>
                                                    </div>
                                                </td>
                                            </tr>
                                        `;
                                    }).join('');
                                    tbody.innerHTML = rows;
                                }
                            }
                        } else {
                            // No selected plan: temporarily render returned scenarios as if
                            // they belong to a virtual plan object so the table shows them.
                            const virtualPlan = { id: '__virtual__', name: 'Filtered', scenarios: Array.isArray(data) ? data : [] };
                            // render directly using a small helper
                            if (els.planName) els.planName.textContent = virtualPlan.name;
                            const tbody = els.scenarioTableBody;
                            if (!virtualPlan.scenarios.length) {
                                if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="empty">No scenarios match the current filters.</td></tr>';
                            } else {
                                const rows = virtualPlan.scenarios.map((scenario) => {
                                    const module = initialModules.find((m) => Number(m.id) === Number(scenario.module));
                                    const moduleLabel = module ? (module.title || module.name || `Module ${module.id}`) : '';
                                    return `
                                        <tr data-scenario-id="${scenario.id}">
                                            <td>${escapeHtml(scenario.title || '')}</td>
                                            <td>${escapeHtml(scenario.description || '')}</td>
                                            <td>${escapeHtml(moduleLabel)}</td>
                                            <td>${escapeHtml(formatDateTime(scenario.created_at || null))}</td>
                                            <td>${escapeHtml(formatDateTime(scenario.updated_at || null))}</td>
                                            <td>
                                                <div class="table-action-group">
                                                    <button type="button" class="action-button" data-action="view-scenario" data-scenario-id="${scenario.id}">View</button>
                                                    <button type="button" class="action-button" data-action="edit-scenario" data-scenario-id="${scenario.id}">Edit</button>
                                                    <button type="button" class="action-button" data-action="add-case" data-scenario-id="${scenario.id}">Add Case</button>
                                                    <button type="button" class="action-button" data-action="delete-scenario" data-scenario-id="${scenario.id}" data-variant="danger">Delete</button>
                                                </div>
                                            </td>
                                        </tr>
                                    `;
                                }).join('');
                                tbody.innerHTML = rows;
                            }
                        }
                        renderAll();
                        setStatus('', 'info');
                        // update New Scenario button state when module changes
                        try { syncNewScenarioButtonState(); } catch (e) { }
                    } catch (err) {
                        setStatus(err instanceof Error ? err.message : 'Unable to load module scenarios.', 'error');
                        renderAll();
                    }
                })();
            });
        }

        // Ensure header and row checkboxes are wired up and keep header state in sync
        // NOTE: The canonical implementation lives in the page inline script which
        // exposes `window.syncCaseSelectionState`. To avoid duplicate listeners
        // we delegate to that implementation when available. This function now
        // performs a minimal sync fallback when not present.
        const initCaseCheckboxes = () => {
            // Prefer the centralized sync function when available
            if (window && typeof window.syncCaseSelectionState === 'function') {
                try { window.syncCaseSelectionState(); } catch (e) { /* ignore */ }
                return;
            }

            // Safe fallback: compute header checked/indeterminate state without
            // attaching new event listeners (keeps behavior consistent).
            const selectAll = document.getElementById('select-all-cases');
            const tbody = document.querySelector('tbody[data-role="case-table-body"]');
            if (!selectAll || !tbody) return;

            try {
                const boxes = Array.from(tbody.querySelectorAll('input.case-checkbox'));
                const checked = boxes.filter(b => b.checked).length;
                selectAll.disabled = boxes.length === 0;
                selectAll.checked = boxes.length > 0 && checked === boxes.length;
                selectAll.indeterminate = checked > 0 && checked < boxes.length;
                // mark initialized so callers don't re-run heavy initialization
                selectAll.dataset.caseCheckboxInit = '1';
                // expose for backwards-compatibility
                try { window.initCaseCheckboxes = initCaseCheckboxes; } catch (e) { }
            } catch (e) { /* ignore */ }
        };

        const renderCaseList = () => {
            if (!els.caseList) {
                return;
            }
            const scenario = getSelectedScenario();
            if (els.scenarioName) {
                els.scenarioName.textContent = scenario ? scenario.title : '—';
            }
            if (els.caseSummary) {
                if (!scenario) {
                    els.caseSummary.innerHTML = '<p class="empty">Choose a scenario to inspect detailed test cases.</p>';
                } else {
                    const caseCount = Array.isArray(scenario.cases) ? scenario.cases.length : 0;
                    const pre = scenario.preconditions ? escapeHtml(scenario.preconditions) : '—';
                    const post = scenario.postconditions ? escapeHtml(scenario.postconditions) : '—';
                    els.caseSummary.innerHTML = `
                        <strong>${caseCount} test case${caseCount === 1 ? '' : 's'} in scope.</strong>
                        <div>Preconditions: ${pre}</div>
                        <div>Postconditions: ${post}</div>
                    `;
                }
            }

            els.caseList.innerHTML = '';
            if (!scenario) {
                els.caseList.innerHTML = '<p class="empty">No scenario selected.</p>';
                return;
            }
            // If the cases panel has been converted to a table layout (copied from scenarios)
            // render rows into the table body instead of card-based list.
            const caseTbody = document.querySelector('[data-role="case-table-body"]');
            if (caseTbody) {
                let cases = [];
                // If remote search results are present, render those (cross-scenario)
                if (Array.isArray(state._caseSearchResults)) {
                    cases = state._caseSearchResults;
                } else {
                    cases = Array.isArray(scenario.cases) ? scenario.cases : [];
                    // apply client-side case search filter if provided
                    try {
                        const q = state._caseSearch || '';
                        if (q) {
                            const lower = String(q).toLowerCase();
                            cases = cases.filter((c) => {
                                const idLabel = (c.testcase_id || String(c.id || '')).toLowerCase();
                                const title = (c.title || '').toLowerCase();
                                const desc = (c.description || '').toLowerCase();
                                return idLabel.includes(lower) || title.includes(lower) || desc.includes(lower);
                            });
                        }
                    } catch (e) { /* ignore */ }
                }
                if (!cases.length) {
                    caseTbody.innerHTML = '<tr><td colspan="7" class="empty">No test cases found. Capture one using the form below.</td></tr>';
                    return;
                }
                const rows = cases.map((testCase) => {
                    const idLabel = escapeHtml(testCase.testcase_id || testCase.id || '');
                    const title = escapeHtml(testCase.title || 'Untitled case');
                    const desc = escapeHtml(testCase.description || '');
                    const created = escapeHtml(formatDateTime(testCase.created_at || null));
                    const updated = escapeHtml(formatDateTime(testCase.updated_at || null));
                    const requiresDependencyAttr = testCase.requires_dependency ? '1' : '0';
                    const dependencyIdAttr = testCase.test_case_dependency || testCase.test_case_dependency_id || '';
                    const dependencyKeyAttr = escapeHtml(testCase.dependency_response_key || '');
                    const expectedAttr = escapeHtml(JSON.stringify(testCase.expected_results || []));
                    const responseEncryptedAttr = testCase.is_response_encrypted ? 'true' : 'false';
                    return `
                        <tr data-case-id="${testCase.id || ''}" data-scenario-id="${testCase.scenario || testCase.scenario_id || ''}" data-requires-dependency="${requiresDependencyAttr}" data-dependency-id="${dependencyIdAttr}" data-dependency-key="${dependencyKeyAttr}" data-expected-results="${expectedAttr}" data-response-encrypted="${responseEncryptedAttr}">
                            <td>
                                <label class="case-checkbox-label">
                                    <input type="checkbox" class="case-checkbox" data-case-id="${testCase.id || ''}" aria-label="Select test case ${idLabel}" />
                                    <span class="fake-checkbox" aria-hidden="true"></span>
                                </label>
                            </td>
                            <td>${idLabel}</td>
                            <td>${title}</td>
                            <td>${desc}</td>
                            <td>${created}</td>
                            <td>${updated}</td>
                            <td>
                                <div class="table-action-group">
                                    <button type="button" class="action-button" data-action="view-case" data-case-id="${testCase.id || ''}" data-related-api-request-name="${escapeHtml(testCase.related_api_request_name || '')}">View</button>
                                    <button type="button" class="action-button" data-action="edit-case" data-case-id="${testCase.id || ''}" data-related-api-request-name="${escapeHtml(testCase.related_api_request_name || '')}">Edit</button>
                                    ${testCase.related_api_request ? `<button type="button" class="action-button" data-action="run-case" data-case-id="${testCase.id || ''}" data-request-id="${testCase.related_api_request || ''}" data-expected-results="${expectedAttr}" data-response-encrypted="${responseEncryptedAttr}" title="Run related API request" onclick="if (window.__automationTestcaseControls) { window.__automationTestcaseControls.runCaseFromElement(this); }">Run</button>` : ''}
                                    <button type="button" class="action-button" data-action="delete-case" data-case-id="${testCase.id || ''}" data-variant="danger">Delete</button>
                                </div>
                            </td>
                        </tr>
                    `;
                }).join('');
                caseTbody.innerHTML = rows;
                // ensure header checkbox is wired to these new rows
                try { initCaseCheckboxes(); } catch (e) { /* ignore */ }
                return;
            }
            const cases = Array.isArray(scenario.cases) ? scenario.cases : [];
            if (!cases.length) {
                els.caseList.innerHTML = '<p class="empty">No test cases found. Capture one using the form below.</p>';
                return;
            }
            const wrapper = document.createElement('div');
            wrapper.className = 'automation-case-list';
            cases.forEach((testCase) => {
                const card = document.createElement('article');
                card.className = 'automation-case-card';
                const steps = Array.isArray(testCase.steps) ? testCase.steps : [];
                const expected = normalizeExpectedResultsEntries(Array.isArray(testCase.expected_results) ? testCase.expected_results : []);
                const dynamic = testCase.dynamic_variables || {};
                card.innerHTML = `
                    <header>
                        <h3>${escapeHtml(testCase.title || 'Untitled case')}</h3>
                        <div class="case-meta">Priority: ${escapeHtml(testCase.priority || '—')} · Owner: ${escapeHtml(testCase.owner || '—')}</div>
                    </header>
                    ${testCase.description ? `<p>${escapeHtml(testCase.description)}</p>` : ''}
                    ${steps.length ? `<div><strong>Steps</strong><ol class="case-detail-list">${steps.map((step, index) => `<li>Step ${index + 1}: ${escapeHtml(formatStructuredValue(step))}</li>`).join('')}</ol></div>` : ''}
                    ${expected.length ? `<div><strong>Expected</strong><ul class="case-detail-list">${expected.map((item) => `<li>${escapeHtml(formatStructuredValue(item))}</li>`).join('')}</ul></div>` : ''}
                    ${Object.keys(dynamic).length ? `<div><strong>Dynamic variables</strong><pre>${escapeHtml(JSON.stringify(dynamic, null, 2))}</pre></div>` : ''}
                `;
                wrapper.appendChild(card);
            });
            els.caseList.appendChild(wrapper);
        };

        const renderMaintenance = () => {
            if (!els.maintenanceList) {
                return;
            }
            const plan = getSelectedPlan();
            els.maintenanceList.innerHTML = '';
            if (!plan) {
                els.maintenanceList.innerHTML = '<p class="empty">Select a plan to review maintenance updates.</p>';
                return;
            }
            const maint = Array.isArray(plan.maintenances) ? plan.maintenances : [];
            if (!maint.length) {
                els.maintenanceList.innerHTML = '<p class="empty">No maintenance entries logged for this plan.</p>';
                return;
            }
            const fragment = document.createDocumentFragment();
            maint.forEach((entry) => {
                const node = document.createElement('article');
                node.className = 'automation-timeline-entry';
                const effective = entry.effective_date ? new Date(entry.effective_date).toLocaleDateString() : '—';
                const summary = escapeHtml(entry.summary || '');
                const updates = entry.updates && Object.keys(entry.updates).length ? `<pre>${escapeHtml(JSON.stringify(entry.updates, null, 2))}</pre>` : '';
                node.innerHTML = `
                    <strong>Version ${escapeHtml(entry.version || '')}</strong>
                    <small>${effective} · Updated by ${escapeHtml(entry.updated_by || '—')} · Approved by ${escapeHtml(entry.approved_by || '—')}</small>
                    <p>${summary}</p>
                    ${updates}
                `;
                fragment.appendChild(node);
            });
            els.maintenanceList.appendChild(fragment);
        };

        const renderAll = () => {
            renderPlanList();
            renderScenarioList();
            renderCaseList();
            renderMaintenance();
            syncFormStates();
        };

        const initialSelection = () => {
            if (state.plans.length) {
                state.selectedPlanId = state.plans[0].id;
                const firstScenario = Array.isArray(state.plans[0].scenarios) && state.plans[0].scenarios.length ? state.plans[0].scenarios[0].id : null;
                state.selectedScenarioId = firstScenario;
            }
        };

        const syncFormStates = () => {
            const plan = getSelectedPlan();
            const scenario = getSelectedScenario();

            if (els.planFormReset) {
                els.planFormReset.disabled = !els.planForm || !els.planForm.elements.length;
            }
            if (els.scenarioFormReset) {
                els.scenarioFormReset.disabled = !scenario;
            }
            if (els.caseFormReset) {
                els.caseFormReset.disabled = !scenario;
            }
            if (els.maintenanceFormReset) {
                els.maintenanceFormReset.disabled = !plan;
            }

            if (els.scenarioForm) {
                const fieldset = els.scenarioForm.querySelector('fieldset');
                if (fieldset) {
                    fieldset.disabled = !plan;
                }
            }
            if (els.caseForm) {
                const fieldset = els.caseForm.querySelector('fieldset');
                if (fieldset) {
                    fieldset.disabled = !scenario;
                }
            }
            if (els.maintenanceForm) {
                const fieldset = els.maintenanceForm.querySelector('fieldset');
                if (fieldset) {
                    fieldset.disabled = !plan;
                }
            }
        };

        const refreshPlans = async (options = {}) => {
            const { selectPlanId, selectScenarioId, silent } = options;
            try {
                if (!silent) {
                    setStatus('Refreshing test plans…', 'info');
                }
                const response = await fetch(apiEndpoints.plans || '/api/core/test-plans/', {
                    headers: { Accept: 'application/json' },
                    credentials: 'same-origin',
                });
                if (!response.ok) {
                    throw new Error('Unable to load test plans.');
                }
                const data = await response.json();
                state.plans = normalizePlans(data);

                let nextPlanId = typeof selectPlanId !== 'undefined' ? selectPlanId : state.selectedPlanId;
                if (!state.plans.some((plan) => plan.id === nextPlanId)) {
                    nextPlanId = state.plans.length ? state.plans[0].id : null;
                }
                state.selectedPlanId = nextPlanId;

                const currentPlan = getSelectedPlan();
                let nextScenarioId = typeof selectScenarioId !== 'undefined' ? selectScenarioId : state.selectedScenarioId;
                if (!currentPlan || !Array.isArray(currentPlan.scenarios) || !currentPlan.scenarios.some((scenario) => scenario.id === nextScenarioId)) {
                    nextScenarioId = currentPlan && Array.isArray(currentPlan.scenarios) && currentPlan.scenarios.length ? currentPlan.scenarios[0].id : null;
                }
                state.selectedScenarioId = nextScenarioId;

                renderAll();
                if (!silent) {
                    setStatus('Plans updated successfully.', 'success');
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to refresh plans.';
                setStatus(message, 'error');
            }
        };

        // Delegated event handling for scenario action buttons in table
        const scenarioTable = () => document.querySelector('[data-role="scenario-table-body"]');
        if (scenarioTable) {
            document.addEventListener('click', async (ev) => {
                const target = ev.target;
                if (!target) return;
                // Only handle clicks that originate from within the scenario table body.
                // This prevents duplicate handling when other modules (e.g. data_management)
                // also listen for the same data-action values on the same page.
                const trigger = target.closest('[data-action]');
                if (!trigger) return;
                const tableEl = scenarioTable();
                if (!tableEl || !tableEl.contains(trigger)) return; // ignore clicks outside our table
                const action = trigger.dataset && trigger.dataset.action ? trigger.dataset.action : null;
                if (!action) return;
                if (!['view-scenario', 'edit-scenario', 'add-case', 'delete-scenario'].includes(action)) return;
                const sid = trigger.dataset && trigger.dataset.scenarioId ? trigger.dataset.scenarioId : null;
                if (!sid) return;
                ev.preventDefault();
                if (action === 'view-scenario' || action === 'edit-scenario') {
                    // reuse existing openPlanModal / view handlers - for simplicity
                    // fetch scenario detail and open a simple modal via existing plan modal if present
                    try {
                        const url = `${apiEndpoints.scenarios || '/api/core/test-scenarios/'}${sid}/`;
                        const resp = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
                        if (resp && resp.ok) {
                            const data = await resp.json();
                            // open module add scenario modal in view/edit mode
                            const mode = action === 'view-scenario' ? 'view' : 'edit';
                            // Prefer the shared modal API so the Data Management module's
                            // internal state (moduleScenarioModalMode / moduleScenarioCurrentId)
                            // is updated correctly. Fall back to manual population if the
                            // helper is not available for some reason.
                            try {
                                const normalizedScenario = typeof normalizeScenario === 'function' ? normalizeScenario(data) : data;
                                if (typeof window.openModuleScenarioModal === 'function') {
                                    window.openModuleScenarioModal(mode, normalizedScenario.module || null, normalizedScenario);
                                } else {
                                    const modal = document.querySelector('[data-role="module-add-scenario-modal"]');
                                    if (modal) {
                                        // populate fields as a graceful fallback
                                        const moduleInput = document.getElementById('module-add-scenario-module-id'); if (moduleInput) moduleInput.value = normalizedScenario.module || '';
                                        const titleInput = document.getElementById('module-add-scenario-title'); if (titleInput) titleInput.value = normalizedScenario.title || '';
                                        const descInput = document.getElementById('module-add-scenario-description'); if (descInput) descInput.value = normalizedScenario.description || '';
                                        const pre = document.getElementById('module-add-scenario-precondition'); if (pre) pre.value = normalizedScenario.preconditions || '';
                                        const post = document.getElementById('module-add-scenario-postconditions'); if (post) post.value = normalizedScenario.postconditions || '';
                                        const tags = document.getElementById('module-add-scenario-tags'); if (tags) tags.value = Array.isArray(normalizedScenario.tags) ? normalizedScenario.tags.join(',') : (normalizedScenario.tags || '');
                                        // set readonly for view
                                        const readOnly = mode === 'view';
                                        [titleInput, descInput, pre, post, tags].forEach((n) => { if (n) { n.readOnly = readOnly; n.disabled = readOnly; } });
                                        const submit = modal.querySelector('button[type="submit"]'); if (submit) submit.hidden = readOnly;
                                        modal.hidden = false; body.classList.add('automation-modal-open');
                                    }
                                }
                            } catch (err) {
                                // if anything goes wrong, try the basic fallback
                                const modal = document.querySelector('[data-role="module-add-scenario-modal"]');
                                if (modal) modal.hidden = false;
                                body.classList.add('automation-modal-open');
                            }
                        }
                    } catch (err) { /* ignore */ }
                } else if (action === 'add-case') {
                    // open add case modal and prefill scenario id
                    const caseModal = document.querySelector('[data-role="module-add-case-modal"]');
                    if (caseModal) {
                        const hid = document.getElementById('module-add-case-scenario-id'); if (hid) hid.value = sid;
                        // If the trigger included a related API request name, show it
                        try {
                            const name = trigger && trigger.dataset && trigger.dataset.relatedApiRequestName ? trigger.dataset.relatedApiRequestName : null;
                            const relatedLabel = document.getElementById('module-related-api-request-label');
                            if (name && relatedLabel) {
                                relatedLabel.textContent = `Selected API Request: ${name}`;
                            }
                        } catch (e) { /* ignore */ }
                        caseModal.hidden = false; body.classList.add('automation-modal-open');
                    }
                } else if (action === 'delete-scenario') {
                    // confirm and delete
                    if (!confirm('Are you sure you want to delete this scenario?')) return;
                    try {
                        const delUrl = `${apiEndpoints.scenarios || '/api/core/test-scenarios/'}${sid}/`;
                        const resp = await fetch(delUrl, { method: 'DELETE', credentials: 'same-origin', headers: { 'X-CSRFToken': getCsrfToken() } });
                        if (resp && (resp.status === 204 || resp.ok)) {
                            setStatus('Scenario deleted.', 'success');
                            // refresh plans to update UI
                            await refreshPlans({ silent: true });
                        } else {
                            setStatus('Failed to delete scenario.', 'error');
                        }
                    } catch (err) {
                        setStatus('Failed to delete scenario.', 'error');
                    }
                }
            });
        }

        const submitJson = async (url, payload, method = 'POST') => {
            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                    Accept: 'application/json',
                },
                credentials: 'same-origin',
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                let detail = 'Request failed.';
                try {
                    const errorBody = await response.json();
                    if (errorBody && typeof errorBody === 'object') {
                        const messages = flattenMessages(errorBody);
                        if (messages.length) {
                            detail = messages.join(' ');
                        }
                    }
                } catch (_error) {
                    // ignore
                }
                throw new Error(detail);
            }
            return response.json();
        };

        // Delegated handler for dynamically injected "New Test Case" button
        document.addEventListener('click', (ev) => {
            try {
                const btn = ev.target.closest && ev.target.closest('#open-new-case');
                if (!btn) return;
                ev.preventDefault();
                automationLog('debug', '[automation] #open-new-case clicked');
                setStatus('Opening New Test Case…', 'info');
                const sid = state.selectedScenarioId || null;
                const caseModal = document.querySelector('[data-role="module-add-case-modal"]');
                if (caseModal) {
                    const hid = document.getElementById('module-add-case-scenario-id'); if (hid) hid.value = sid || '';
                    caseModal.hidden = false; body.classList.add('automation-modal-open');
                    const titleInput = document.getElementById('module-add-case-title'); if (titleInput) titleInput.focus();
                    setStatus('', 'info');
                } else {
                    setStatus('Unable to find test case modal on the page.', 'error');
                }
            } catch (err) { /* ignore */ }
        });

        // Submit handler for Add Test Case modal form (so saving works when data_management.js is not loaded)
        try {
            const moduleAddCaseForm = document.getElementById('module-add-case-form');
            if (moduleAddCaseForm) {
                moduleAddCaseForm.addEventListener('submit', async (event) => {
                    try {
                        event.preventDefault();
                        const scenarioInput = document.getElementById('module-add-case-scenario-id');
                        const titleInput = document.getElementById('module-add-case-title');
                        const descInput = document.getElementById('module-add-case-description');
                        const stepsInput = document.getElementById('module-add-case-steps');
                        const expectedInput = document.getElementById('module-add-case-expected');
                        const priorityInput = document.getElementById('module-add-case-priority');
                        const responseEncryptedInput = document.getElementById('module-add-case-response-encrypted');
                        const requiresDependencyInput = document.getElementById('module-add-case-requires-dependency');
                        const dependencySelect = document.getElementById('module-add-case-dependency-id');
                        const dependencyKeyInput = document.getElementById('module-add-case-dependency-key');
                        // collection/request UI removed from modal
                        const testcaseIdInput = document.getElementById('module-add-case-testcase-id');
                        const sid = scenarioInput && scenarioInput.value ? Number(scenarioInput.value) : null;
                        if (!sid) {
                            setStatus('Scenario id missing for test case.', 'error');
                            return;
                        }
                        let expectedEntries = [];
                        try {
                            expectedEntries = parseExpectedResultsTextarea(expectedInput && expectedInput.value ? expectedInput.value : '');
                        } catch (parseError) {
                            const message = parseError instanceof Error ? parseError.message : 'Unable to parse expected results.';
                            setStatus(message, 'error');
                            return;
                        }
                        const payload = {
                            scenario: sid,
                            title: (titleInput && titleInput.value || '').trim(),
                            description: descInput && descInput.value || '',
                            steps: stepsInput && stepsInput.value ? stepsInput.value.split(/\n/).map((s) => s.trim()).filter(Boolean) : [],
                            expected_results: expectedEntries,
                            priority: priorityInput && priorityInput.value ? priorityInput.value : '',
                            precondition: (document.getElementById('module-add-case-precondition') && document.getElementById('module-add-case-precondition').value) || '',
                            requirements: (document.getElementById('module-add-case-requirements') && document.getElementById('module-add-case-requirements').value) || '',
                            is_response_encrypted: Boolean(responseEncryptedInput && responseEncryptedInput.checked),
                        };
                        const requiresDependency = !!(requiresDependencyInput && requiresDependencyInput.checked);
                        payload.requires_dependency = requiresDependency;
                        if (requiresDependency) {
                            const depValueRaw = dependencySelect && dependencySelect.value ? dependencySelect.value : '';
                            const depValue = depValueRaw ? Number(depValueRaw) : NaN;
                            if (!depValueRaw || Number.isNaN(depValue) || depValue <= 0) {
                                setStatus('Select a dependency test case before saving.', 'error');
                                return;
                            }
                            payload.test_case_dependency = depValue;
                            const depKey = dependencyKeyInput && dependencyKeyInput.value ? dependencyKeyInput.value.trim() : '';
                            if (!depKey) {
                                setStatus('Enter the dependency response key before saving.', 'error');
                                return;
                            }
                            payload.dependency_response_key = depKey;
                        } else {
                            payload.test_case_dependency = null;
                            payload.dependency_response_key = '';
                        }
                        // If the API Explorer selection exists, force-sync label -> hidden
                        // and include related_api_request in the payload.
                        try {
                            const hidden = document.getElementById('module-add-case-related-api-request-id');
                            const label = document.getElementById('module-related-api-request-label');
                            if (label && label.dataset && label.dataset.requestId) {
                                if (hidden) hidden.value = label.dataset.requestId;
                            }
                            if (hidden && hidden.value) {
                                const parsed = Number(hidden.value);
                                if (!Number.isNaN(parsed) && parsed > 0) payload.related_api_request = parsed;
                            }
                            automationLog('debug', '[automation][module] creating case payload.related_api_request=', payload.related_api_request);
                        } catch (e) { /* ignore */ }
                        if (!payload.title) {
                            setStatus('Test case title is required.', 'error');
                            return;
                        }
                        setStatus('Saving test case…', 'info');
                        const base = apiEndpoints.cases || '/api/core/test-cases/';
                        // If a testcase id is present, perform an update (PUT) instead of create (POST)
                        const isEdit = testcaseIdInput && testcaseIdInput.value;
                        const method = isEdit ? 'PUT' : 'POST';
                        const url = isEdit ? `${base}${encodeURIComponent(testcaseIdInput.value)}/` : base;
                        const resp = await fetch(url, {
                            method,
                            credentials: 'same-origin',
                            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken(), Accept: 'application/json' },
                            body: JSON.stringify(payload),
                        });
                        if (!resp.ok) {
                            const body = await resp.text().catch(() => null);
                            throw new Error(`Failed to save test case: ${resp.status}${body ? ' - ' + body : ''}`);
                        }
                        const result = await resp.json().catch(() => null);
                        // close modal and reset
                        const modal = document.querySelector('[data-role="module-add-case-modal"]');
                        if (modal) {
                            modal.hidden = true; body.classList.remove('automation-modal-open');
                        }
                        // clear edit marker if present
                        if (testcaseIdInput) testcaseIdInput.value = '';
                        moduleAddCaseForm.reset();
                        if (typeof toggleDependencyFields === 'function') toggleDependencyFields(false);
                        dependencyOptionsCache.delete(Number.isFinite(sid) ? Number(sid) : String(sid));
                        setStatus('Test case saved.', 'success');
                        // Refresh plans/scenarios so the case updates appear in the table
                        try {
                            await refreshPlans({ silent: true });
                        } catch (e) {
                            try { renderAll(); } catch (_e) { }
                        }
                    } catch (err) {
                        setStatus(err instanceof Error ? err.message : 'Unable to save test case.', 'error');
                    }
                });
                // Safety-net: ensure module related_api_request hidden input is synced
                // from visible label before any submit handlers run (capture phase).
                moduleAddCaseForm.addEventListener('submit', (ev) => {
                    try {
                        const hidden = document.getElementById('module-add-case-related-api-request-id');
                        const label = document.getElementById('module-related-api-request-label');
                        if (label && label.dataset && label.dataset.requestId) {
                            if (hidden) hidden.value = label.dataset.requestId;
                        }
                    } catch (e) { /* ignore */ }
                }, true);
            }
        } catch (e) { /* ignore */ }

        // Delegated event handling for case table action buttons (view/edit/delete)
        try {
            const caseTable = () => document.querySelector('[data-role="case-table-body"]');
            if (caseTable) {
                document.addEventListener('click', async (ev) => {
                    const target = ev.target;
                    if (!target) return;
                    const trigger = target.closest && target.closest('[data-action]');
                    if (!trigger) return;
                    const tableEl = caseTable();
                    if (!tableEl || !tableEl.contains(trigger)) return; // ignore clicks outside our table
                    const action = trigger.dataset && trigger.dataset.action ? trigger.dataset.action : null;
                    if (!action) return;
                    if (!['view-case', 'edit-case', 'delete-case'].includes(action)) return;
                    const cid = trigger.dataset && trigger.dataset.caseId ? trigger.dataset.caseId : null;
                    if (!cid) return;
                    ev.preventDefault();
                    if (action === 'delete-case') {
                        if (!confirm('Are you sure you want to delete this test case?')) return;
                        try {
                            const delUrl = `${apiEndpoints.cases || '/api/core/test-cases/'}${cid}/`;
                            const resp = await fetch(delUrl, { method: 'DELETE', credentials: 'same-origin', headers: { 'X-CSRFToken': getCsrfToken() } });
                            if (resp && (resp.status === 204 || resp.ok)) {
                                setStatus('Test case deleted.', 'success');
                                await refreshPlans({ silent: true });
                            } else {
                                setStatus('Failed to delete test case.', 'error');
                            }
                        } catch (err) {
                            setStatus('Failed to delete test case.', 'error');
                        }
                        return;
                    }
                    // For view/edit, fetch case detail and populate modal
                    try {
                        const url = `${apiEndpoints.cases || '/api/core/test-cases/'}${cid}/`;
                        const resp = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
                        if (!resp.ok) throw new Error('Failed to load test case.');
                        const data = await resp.json();
                        const caseModal = document.querySelector('[data-role="module-add-case-modal"]');
                        const form = document.getElementById('module-add-case-form');
                        if (!caseModal || !form) {
                            setStatus('Unable to open test case editor.', 'error');
                            return;
                        }
                        // ensure hidden testcase id exists on form
                        let hid = document.getElementById('module-add-case-testcase-id');
                        if (!hid) {
                            hid = document.createElement('input');
                            hid.type = 'hidden';
                            hid.id = 'module-add-case-testcase-id';
                            // Do NOT set name to 'testcase_id' — we must not send the
                            // model's testcase_id field in the request body. This
                            // hidden input is only used client-side to indicate
                            // edit mode and store the case PK for the URL.
                            form.appendChild(hid);
                        }
                        hid.value = data && (data.id || data.pk) ? (data.id || data.pk) : '';
                        // populate fields
                        const scenarioInput = document.getElementById('module-add-case-scenario-id'); if (scenarioInput) scenarioInput.value = data && (data.scenario || data.scenario_id) ? (data.scenario || data.scenario_id) : '';
                        if (scenarioInput && typeof loadDependencyOptions === 'function') await loadDependencyOptions(Number(scenarioInput.value || data.scenario || data.scenario_id || 0), data && data.id);
                        const titleInput = document.getElementById('module-add-case-title'); if (titleInput) titleInput.value = data && data.title ? data.title : '';
                        const descInput = document.getElementById('module-add-case-description'); if (descInput) descInput.value = data && data.description ? data.description : '';
                        const stepsInput = document.getElementById('module-add-case-steps'); if (stepsInput) stepsInput.value = Array.isArray(data && data.steps ? data.steps : []) ? (data.steps || []).join('\n') : (data.steps || '');
                        const expectedInput = document.getElementById('module-add-case-expected'); if (expectedInput) {
                            const normalizedExpected = Array.isArray(data && data.expected_results ? data.expected_results : [])
                                ? data.expected_results
                                : normalizeExpectedResultsEntries(data && data.expected_results ? data.expected_results : []);
                            expectedInput.value = formatExpectedResultsTextarea(normalizedExpected);
                        }
                        const priorityInput = document.getElementById('module-add-case-priority'); if (priorityInput) priorityInput.value = data && data.priority ? data.priority : '';
                        const preconditionsInput = document.getElementById('module-add-case-precondition'); if (preconditionsInput) preconditionsInput.value = data && data.precondition ? data.precondition : '';
                        const requirementsInput = document.getElementById('module-add-case-requirements'); if (requirementsInput) requirementsInput.value = data && data.requirements ? data.requirements : '';
                        const responseEncryptedInput = document.getElementById('module-add-case-response-encrypted'); if (responseEncryptedInput) responseEncryptedInput.checked = Boolean(data && data.is_response_encrypted);
                        const dependencyCheckbox = document.getElementById('module-add-case-requires-dependency');
                        const dependencySelect = document.getElementById('module-add-case-dependency-id');
                        const dependencyKeyInput = document.getElementById('module-add-case-dependency-key');
                        if (dependencyCheckbox) dependencyCheckbox.checked = Boolean(data && data.requires_dependency);
                        if (typeof toggleDependencyFields === 'function') toggleDependencyFields(Boolean(data && data.requires_dependency), { preserveValues: true });
                        if (dependencySelect) {
                            await loadDependencyOptions(data && (data.scenario || data.scenario_id), data && data.id);
                            const depId = data && data.test_case_dependency ? data.test_case_dependency : data && data.test_case_dependency_id ? data.test_case_dependency_id : null;
                            dependencySelect.value = depId ? String(depId) : '';
                        }
                        if (dependencyKeyInput) dependencyKeyInput.value = data && data.dependency_response_key ? data.dependency_response_key : '';
                        // Populate related_api_request hidden input and visible label
                        try {
                            const relatedId = (data && (data.related_api_request || data.related_api_request_id)) ? (data.related_api_request || data.related_api_request_id) : null;
                            const hiddenRelated = document.getElementById('module-add-case-related-api-request-id');
                            const relatedLabel = document.getElementById('module-related-api-request-label');
                            if (hiddenRelated) hiddenRelated.value = relatedId ? String(relatedId) : '';
                            if (relatedLabel) {
                                if (relatedId) {
                                    // Prefer server-supplied name; if missing, fall back to any
                                    // value the trigger may have provided on click.
                                    const triggerName = trigger && trigger.dataset && trigger.dataset.relatedApiRequestName ? trigger.dataset.relatedApiRequestName : null;
                                    relatedLabel.textContent = data.related_api_request_name || triggerName || `Request #${relatedId}`;
                                    relatedLabel.dataset.requestId = relatedId;
                                } else {
                                    relatedLabel.textContent = 'No API request selected';
                                    delete relatedLabel.dataset.requestId;
                                }
                            }
                        } catch (e) { /* ignore */ }
                        // set modal title based on action
                        const modalTitle = document.getElementById('module-add-case-modal-title');
                        if (modalTitle) modalTitle.textContent = (action === 'view-case') ? 'Test Case Details' : 'Update Test Case';
                        // show modal
                        caseModal.hidden = false; body.classList.add('automation-modal-open');
                        // set read-only if view
                        const isView = action === 'view-case';
                        // hide API Explorer button when viewing a case and update label format
                        try {
                            const openApiBtn = document.getElementById('module-open-api-explorer');
                            const relatedLabelElem = document.getElementById('module-related-api-request-label');
                            const hiddenRelated = document.getElementById('module-add-case-related-api-request-id');
                            if (isView) {
                                if (openApiBtn) openApiBtn.hidden = true;
                                if (relatedLabelElem) {
                                    const name = (data && (data.related_api_request_name)) ? data.related_api_request_name : (hiddenRelated && hiddenRelated.value ? `Request #${hiddenRelated.value}` : 'No API request selected');
                                    relatedLabelElem.textContent = `Selected API Request: ${name}`;
                                }
                            } else {
                                if (openApiBtn) openApiBtn.hidden = false;
                            }
                        } catch (e) { /* ignore */ }
                        const editableFields = [titleInput, descInput, stepsInput, expectedInput, priorityInput, preconditionsInput, requirementsInput, dependencySelect, dependencyKeyInput, responseEncryptedInput];
                        editableFields.forEach((n) => { if (n) { if (n.tagName === 'SELECT') { n.disabled = isView; } else { n.readOnly = isView; n.disabled = isView; } } });
                        if (dependencyCheckbox) dependencyCheckbox.disabled = isView;
                        const submit = form.querySelector('button[type="submit"]'); if (submit) submit.hidden = isView;
                    } catch (err) {
                        setStatus(err instanceof Error ? err.message : 'Unable to open test case.', 'error');
                    }
                });
            }
        } catch (e) { /* ignore */ }

        // Close handler for Add Test Case modal when page uses automation.js (Test Cases page)
        // The template uses data-action="close-module-add-case-modal" on backdrop/close/cancel
        // but automation.js did not previously listen for it. Add a small delegated handler
        // so the modal closes and the form resets when those elements are clicked.
        document.addEventListener('click', (ev) => {
            try {
                const trigger = ev.target && ev.target.closest && ev.target.closest('[data-action="close-module-add-case-modal"]');
                if (!trigger) return;
                ev.preventDefault();
                const modal = document.querySelector('[data-role="module-add-case-modal"]');
                if (modal) {
                    modal.hidden = true;
                    body.classList.remove('automation-modal-open');
                }
                const form = document.getElementById('module-add-case-form');
                if (form) form.reset();
            } catch (e) { /* ignore */ }
        });

        // API Explorer: modal to browse collections/directories/requests and select one
        const openApiExplorer = async (opts = {}) => {
            // opts.success: callback(requestId, label)
            // Create modal elements lazily
            let modal = document.querySelector('[data-role="api-explorer-modal"]');
            if (!modal) {
                modal = document.createElement('dialog');
                modal.className = 'automation-modal';
                modal.setAttribute('data-role', 'api-explorer-modal');
                modal.innerHTML = `
                    <div class="automation-modal__backdrop" data-action="close-api-explorer"></div>
                    <div class="automation-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="api-explorer-title">
                        <header class="automation-modal__header">
                            <h2 id="api-explorer-title">API Collections</h2>
                            <button type="button" class="automation-modal__close" data-action="close-api-explorer" aria-label="Close">&times;</button>
                        </header>
                        <div class="automation-modal__body" style="max-height:60vh; overflow:auto; padding:1rem;">
                            <div id="api-explorer-tree">Loading…</div>
                        </div>
                        <div class="automation-modal__footer">
                            <button type="button" class="btn-secondary" data-action="clear-api-selection">Clear</button>
                            <button type="button" class="btn-primary" data-action="confirm-api-selection">Select</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
            }
            const treeContainer = modal.querySelector('#api-explorer-tree');
            let selectedNode = null;

            const renderTree = (collections) => {
                treeContainer.innerHTML = '';
                const ul = document.createElement('ul');
                ul.className = 'api-explorer-root';
                collections.forEach((col) => {
                    const colLi = document.createElement('li');
                    colLi.className = 'api-collection-node';
                    const colHeader = document.createElement('div');
                    colHeader.className = 'node-header';
                    const toggle = document.createElement('button');
                    toggle.type = 'button';
                    toggle.className = 'node-toggle';
                    toggle.textContent = '▸';
                    const title = document.createElement('span');
                    title.textContent = col.name || `Collection ${col.id}`;
                    title.style.marginLeft = '0.5rem';
                    colHeader.appendChild(toggle);
                    colHeader.appendChild(title);
                    colLi.appendChild(colHeader);
                    const colChildren = document.createElement('div');
                    colChildren.className = 'node-children';
                    colChildren.style.display = 'none';
                    // directories
                    const dirs = Array.isArray(col.directories) ? col.directories : [];
                    // group top-level requests (no directory) and directories
                    const topRequests = (Array.isArray(col.requests) ? col.requests : []).filter((r) => !r.directory_id);
                    const createRequestList = (requests) => {
                        const rUl = document.createElement('ul');
                        requests.forEach((r) => {
                            const rLi = document.createElement('li');
                            rLi.className = 'api-request-node';
                            rLi.dataset.requestId = r.id;
                            // checkbox for single selection
                            const cb = document.createElement('input');
                            cb.type = 'checkbox';
                            cb.className = 'request-checkbox';
                            cb.id = `api-request-${r.id}`;
                            cb.dataset.requestId = r.id;
                            // plain text label (not styled as a button)
                            const label = document.createElement('label');
                            label.htmlFor = cb.id;
                            label.className = 'request-label';
                            label.textContent = `${r.name || ('Request ' + r.id)} ${r.method ? '(' + r.method + ')' : ''}`;
                            // when checkbox changes, enforce single-select behavior
                            cb.addEventListener('change', (ev) => {
                                try {
                                    const allCheckboxes = modal.querySelectorAll('.request-checkbox');
                                    const allToggles = modal.querySelectorAll('.node-toggle');
                                    const colNode = cb.closest('.api-collection-node');
                                    if (cb.checked) {
                                        // set selection
                                        selectedNode = rLi;
                                        // disable all other checkboxes
                                        allCheckboxes.forEach((other) => {
                                            if (other !== cb) {
                                                other.disabled = true;
                                                const otherLabel = modal.querySelector(`label[for="${other.id}"]`);
                                                if (otherLabel) otherLabel.classList.add('disabled');
                                            }
                                        });
                                        // disable toggles for collections/folders outside this collection
                                        allToggles.forEach((t) => {
                                            const parentCol = t.closest('.api-collection-node');
                                            if (parentCol && parentCol !== colNode) {
                                                t.disabled = true;
                                                t.classList.add('disabled');
                                            } else {
                                                t.disabled = false;
                                                t.classList.remove('disabled');
                                            }
                                        });
                                        label.classList.add('selected');
                                    } else {
                                        // clear selection and re-enable everything
                                        selectedNode = null;
                                        allCheckboxes.forEach((other) => {
                                            other.disabled = false;
                                            const otherLabel = modal.querySelector(`label[for="${other.id}"]`);
                                            if (otherLabel) otherLabel.classList.remove('disabled');
                                        });
                                        allToggles.forEach((t) => { t.disabled = false; t.classList.remove('disabled'); });
                                        label.classList.remove('selected');
                                    }
                                } catch (e) { /* ignore */ }
                            });

                            rLi.appendChild(cb);
                            rLi.appendChild(label);
                            rUl.appendChild(rLi);
                        });
                        return rUl;
                    };
                    if (topRequests.length) {
                        const h = document.createElement('div'); h.className = 'node-section-title'; h.textContent = 'Requests (root)'; colChildren.appendChild(h);
                        colChildren.appendChild(createRequestList(topRequests));
                    }
                    // build directory tree (flat list with parent references) into nested structure
                    const dirMap = new Map();
                    dirs.forEach((d) => { dirMap.set(d.id, Object.assign({}, d, { children: [] })); });
                    dirs.forEach((d) => { if (d.parent_id && dirMap.has(d.parent_id)) { dirMap.get(d.parent_id).children.push(dirMap.get(d.id)); } });
                    // find roots
                    const dirRoots = Array.from(dirMap.values()).filter((d) => !d.parent_id);
                    const requestsByDir = {};
                    (Array.isArray(col.requests) ? col.requests : []).forEach((r) => {
                        if (r.directory_id) {
                            requestsByDir[r.directory_id] = requestsByDir[r.directory_id] || [];
                            requestsByDir[r.directory_id].push(r);
                        }
                    });

                    const renderDirectory = (d) => {
                        const li = document.createElement('li');
                        li.className = 'api-dir-node';
                        const header = document.createElement('div'); header.className = 'node-header';
                        const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'node-toggle'; toggle.textContent = '▸';
                        const name = document.createElement('span'); name.textContent = d.name || ('Dir ' + d.id); name.style.marginLeft = '0.5rem';
                        header.appendChild(toggle); header.appendChild(name);
                        li.appendChild(header);
                        const inner = document.createElement('div'); inner.className = 'node-children'; inner.style.display = 'none';
                        // requests in this dir
                        const reqs = requestsByDir[d.id] || [];
                        if (reqs.length) inner.appendChild(createRequestList(reqs));
                        if (Array.isArray(d.children) && d.children.length) {
                            const dirUl = document.createElement('ul');
                            d.children.forEach((child) => dirUl.appendChild(renderDirectory(child)));
                            inner.appendChild(dirUl);
                        }
                        li.appendChild(inner);
                        // toggling
                        toggle.addEventListener('click', () => {
                            if (inner.style.display === 'none') { inner.style.display = ''; toggle.textContent = '▾'; } else { inner.style.display = 'none'; toggle.textContent = '▸'; }
                        });
                        return li;
                    };

                    if (dirRoots.length) {
                        const dirSection = document.createElement('div'); dirSection.className = 'node-section';
                        const du = document.createElement('ul'); dirRoots.forEach((dr) => du.appendChild(renderDirectory(dr)));
                        colChildren.appendChild(du);
                    }

                    colLi.appendChild(colChildren);
                    // header toggle
                    toggle.addEventListener('click', () => {
                        if (colChildren.style.display === 'none') { colChildren.style.display = ''; toggle.textContent = '▾'; } else { colChildren.style.display = 'none'; toggle.textContent = '▸'; }
                    });

                    // selection is handled by checkboxes on request nodes; no click handler needed here

                    ul.appendChild(colLi);
                });
                treeContainer.appendChild(ul);
            };

            // fetch collections
            try {
                treeContainer.textContent = 'Loading API collections…';
                const resp = await fetch((apiEndpoints.collections || '/api/core/collections/'), { credentials: 'same-origin', headers: { Accept: 'application/json' } });
                if (!resp.ok) throw new Error('Failed to load collections');
                const data = await resp.json();
                const normalized = Array.isArray(data) ? data : [];
                renderTree(normalized);
                // initialize selection from form hidden inputs so reopening preserves choice
                try {
                    const origin = opts.origin || 'case';
                    const hiddenId = origin === 'module' ? 'module-add-case-related-api-request-id' : 'case-related-api-request-id';
                    const hidden = document.getElementById(hiddenId);
                    if (hidden && hidden.value) {
                        const parsed = Number(hidden.value);
                        if (!Number.isNaN(parsed) && parsed > 0) {
                            const cb = modal.querySelector(`#api-request-${parsed}`);
                            if (cb) {
                                cb.checked = true;
                                const rLi = cb.closest('.api-request-node');
                                selectedNode = rLi;
                                const allCheckboxes = modal.querySelectorAll('.request-checkbox');
                                const allToggles = modal.querySelectorAll('.node-toggle');
                                const colNode = cb.closest('.api-collection-node');
                                allCheckboxes.forEach((other) => {
                                    if (other !== cb) {
                                        other.disabled = true;
                                        const otherLabel = modal.querySelector(`label[for="${other.id}"]`);
                                        if (otherLabel) otherLabel.classList.add('disabled');
                                    }
                                });
                                allToggles.forEach((t) => {
                                    const parentCol = t.closest('.api-collection-node');
                                    if (parentCol && parentCol !== colNode) {
                                        t.disabled = true; t.classList.add('disabled');
                                    } else { t.disabled = false; t.classList.remove('disabled'); }
                                });
                                const label = rLi.querySelector('.request-label'); if (label) label.classList.add('selected');
                            }
                        }
                    }
                } catch (e) { /* ignore */ }
            } catch (err) {
                treeContainer.textContent = 'Unable to load API collections.';
            }

            // open modal
            modal.hidden = false; body.classList.add('automation-modal-open');

            // Clear / Confirm handlers
            const confirmBtn = modal.querySelector('[data-action="confirm-api-selection"]');
            const clearBtn = modal.querySelector('[data-action="clear-api-selection"]');
            const closeHandler = (ev) => {
                const trigger = ev.target && ev.target.closest && ev.target.closest('[data-action="close-api-explorer"]');
                if (!trigger) return;
                modal.hidden = true; body.classList.remove('automation-modal-open');
            };
            modal.addEventListener('click', closeHandler);
            if (clearBtn) {
                clearBtn.onclick = () => {
                    try {
                        // clear modal selection
                        const allCheckboxes = modal.querySelectorAll('.request-checkbox');
                        allCheckboxes.forEach((cb) => { cb.checked = false; cb.disabled = false; const lab = modal.querySelector(`label[for="${cb.id}"]`); if (lab) { lab.classList.remove('disabled'); lab.classList.remove('selected'); } });
                        const allToggles = modal.querySelectorAll('.node-toggle'); allToggles.forEach((t) => { t.disabled = false; t.classList.remove('disabled'); });
                        selectedNode = null;
                        // clear associated form hidden input and visible label
                        const origin = opts.origin || 'case';
                        if (origin === 'module') {
                            const hidden = document.getElementById('module-add-case-related-api-request-id');
                            const label = document.getElementById('module-related-api-request-label');
                            if (hidden) hidden.value = '';
                            if (label) label.textContent = 'No API request selected';
                        } else {
                            const hidden = document.getElementById('case-related-api-request-id');
                            const label = document.getElementById('case-related-api-request-label');
                            if (hidden) hidden.value = '';
                            if (label) label.textContent = 'No API request selected';
                        }
                    } catch (e) { /* ignore */ }
                };
            }
            if (confirmBtn) {
                confirmBtn.onclick = () => {
                    if (!selectedNode) {
                        // nothing selected
                        modal.hidden = true; body.classList.remove('automation-modal-open');
                        return;
                    }
                    const rid = selectedNode.dataset.requestId;
                    // grab the visible label from the selected node (name + method)
                    const visibleLabel = (selectedNode.querySelector('.request-label') && selectedNode.querySelector('.request-label').textContent) || `Request #${rid}`;
                    // determine which form opened the explorer
                    const origin = opts.origin || 'case';
                    if (origin === 'module') {
                        const hidden = document.getElementById('module-add-case-related-api-request-id');
                        const label = document.getElementById('module-related-api-request-label');
                        if (hidden) hidden.value = rid;
                        if (label) { label.textContent = visibleLabel; label.dataset.requestId = rid; }
                        automationLog('debug', '[api-explorer] confirm origin=module rid=', rid, 'hiddenExists=', !!hidden, 'labelExists=', !!label);
                        if (label && label.dataset) automationLog('debug', '[api-explorer] module label.dataset.requestId=', label.dataset.requestId);
                    } else {
                        const hidden = document.getElementById('case-related-api-request-id');
                        const label = document.getElementById('case-related-api-request-label');
                        if (hidden) hidden.value = rid;
                        if (label) { label.textContent = visibleLabel; label.dataset.requestId = rid; }
                        automationLog('debug', '[api-explorer] confirm origin=case rid=', rid, 'hiddenExists=', !!hidden, 'labelExists=', !!label);
                        if (label && label.dataset) automationLog('debug', '[api-explorer] case label.dataset.requestId=', label.dataset.requestId);
                    }
                    modal.hidden = true; body.classList.remove('automation-modal-open');
                    if (typeof opts.success === 'function') opts.success(rid);
                };
            }
        };

        // Open explorer from page buttons
        document.addEventListener('click', (ev) => {
            const btn = ev.target && ev.target.closest && (ev.target.closest('#open-api-explorer') || ev.target.closest('#module-open-api-explorer'));
            if (!btn) return;
            ev.preventDefault();
            const origin = btn.id === 'module-open-api-explorer' ? 'module' : 'case';
            openApiExplorer({ origin });
        });

        const handlePlanSubmit = async (event) => {
            event.preventDefault();
            if (!els.planForm) {
                return;
            }
            // If we're viewing a plan (read-only), do not submit to server — just advance steps locally
            if (state.viewingPlan) {
                if (currentPlanStep < maxPlanSteps) {
                    showPlanStep(currentPlanStep + 1);
                } else {
                    // closing after final view step
                    closePlanModal({ resetForm: true, returnFocus: false });
                    resetPlanStepper();
                }
                return;
            }
            try {
                setStatus('Saving test plan…', 'info');

                const baseUrl = apiEndpoints.plans || '/api/core/test-plans/';
                const planDetailUrl = (id) => `${baseUrl}${id}/`;

                // Build payload depending on the current step
                let payload = {};
                if (currentPlanStep === 1) {
                    payload = {
                        name: (inputs.plan.name.value || '').trim(),
                        description: (inputs.plan.description.value || '').trim(),
                    };
                    if (!payload.name) {
                        throw new Error('Plan name is required.');
                    }

                    if (state.editingPlan && planDraftId) {
                        // update existing plan basic info and advance
                        await submitJson(planDetailUrl(planDraftId), payload, 'PATCH');
                        showPlanStep(2);
                        setStatus('Basic info updated. Continue to Objective.', 'success');
                        return;
                    }

                    // Create initial draft
                    const created = await submitJson(baseUrl, payload);
                    planDraftId = created.id;
                    // advance to next step
                    showPlanStep(2);
                    setStatus('Basic info saved. Continue to Objective.', 'success');
                    return;
                }

                // For steps > 1 we require a draft id
                if (!planDraftId) {
                    throw new Error('No draft plan found. Start from step 1.');
                }

                if (currentPlanStep === 2) {
                    const objectiveContent = readObjectiveContent();
                    if (!objectiveContent.plain) {
                        throw new Error('Plan objective is required.');
                    }
                    payload.objective = objectiveContent.html;
                }

                if (currentPlanStep === 3) {
                    const scopeInRaw = inputs.plan.scopeIn ? inputs.plan.scopeIn.value : '';
                    const scopeOutRaw = inputs.plan.scopeOut ? inputs.plan.scopeOut.value : '';
                    const scopeItems = [];
                    splitList(scopeInRaw).forEach((item) => {
                        scopeItems.push({ category: 'in_scope', item });
                    });
                    splitList(scopeOutRaw).forEach((item) => {
                        scopeItems.push({ category: 'out_scope', item });
                    });
                    payload.scopes = scopeItems;
                }

                if (currentPlanStep === 4) {
                    if (els.planRiskMatrix) {
                        // Risk -> Mitigation links are separate resources (RiskAndMitigationPlan)
                        // that reference the plan via a FK. Creating/updating those links
                        // is handled via the Data Management module's endpoints. Do not
                        // include `risk_mitigations` on the plan payload anymore.
                    }
                }

                if (currentPlanStep === 5) {
                    payload = {
                        modules_under_test: splitList(inputs.plan.modules.value),
                        testing_types: {
                            functional: splitList(inputs.plan.functional.value),
                            non_functional: splitList(inputs.plan.nonFunctional.value),
                        },
                        tools: splitList(inputs.plan.tools.value),
                        testers: splitList(inputs.plan.testers.value),
                        approver: (inputs.plan.approver.value || '').trim(),
                        testing_timeline: {},
                    };
                    if (inputs.plan.kickoff.value) {
                        payload.testing_timeline.kickoff = inputs.plan.kickoff.value;
                    }
                    if (inputs.plan.signoff.value) {
                        payload.testing_timeline.signoff = inputs.plan.signoff.value;
                    }
                }

                // PATCH the draft (use PATCH so partial updates are accepted)
                await submitJson(planDetailUrl(planDraftId), payload, 'PATCH');

                if (currentPlanStep < maxPlanSteps) {
                    showPlanStep(currentPlanStep + 1);
                    setStatus(`Step ${currentPlanStep} saved.`, 'success');
                } else {
                    // final step completed
                    await refreshPlans({ selectPlanId: planDraftId, silent: true });
                    closePlanModal({ resetForm: true, returnFocus: false });
                    focusPlanRow(planDraftId);
                    setStatus('Test plan created.', 'success');
                    resetPlanStepper();
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unable to save plan.';
                setStatus(message, 'error');
            }
        };

        // module add scenario form is handled by data_management.js; no duplicate handler here

        const handleScenarioSubmit = async (event) => {
            event.preventDefault();
            if (!els.scenarioForm) {
                return;
            }
            const plan = getSelectedPlan();
            if (!plan) {
                setStatus('Select a plan before adding scenarios.', 'error');
                return;
            }
            try {
                const payload = {
                    plan: plan.id,
                    module: (document.getElementById('scenario-module') && document.getElementById('scenario-module').value) || null,
                    title: (inputs.scenario.title.value || '').trim(),
                    description: inputs.scenario.description.value || '',
                    preconditions: inputs.scenario.preconditions.value || '',
                    postconditions: inputs.scenario.postconditions.value || '',
                    tags: splitList(inputs.scenario.tags.value),
                };
                if (!payload.title) {
                    throw new Error('Scenario title is required.');
                }
                const created = await submitJson(apiEndpoints.scenarios || '/api/core/test-scenarios/', payload);
                els.scenarioForm.reset();
                setStatus('Scenario saved.', 'success');
                await refreshPlans({ selectPlanId: plan.id, selectScenarioId: created.id, silent: true });
                setStatus('Scenario saved.', 'success');
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unable to create scenario.';
                setStatus(message, 'error');
            }
        };

        const handleCaseSubmit = async (event) => {
            event.preventDefault();
            if (!els.caseForm) {
                return;
            }
            // Allow using a selected scenario from the cascading selects if present,
            // otherwise fallback to the current selected scenario in the main UI.
            let scenario = null;
            try {
                const sel = els.caseScenarioSelect && els.caseScenarioSelect.value ? els.caseScenarioSelect.value : null;
                if (sel) {
                    // find scenario in state.plans
                    for (const p of state.plans) {
                        if (Array.isArray(p.scenarios)) {
                            const found = p.scenarios.find((s) => String(s.id) === String(sel));
                            if (found) { scenario = found; break; }
                        }
                    }
                }
            } catch (e) { /* ignore */ }
            if (!scenario) {
                scenario = getSelectedScenario();
            }
            if (!scenario) {
                setStatus('Select a scenario to attach the test case.', 'error');
                return;
            }
            try {
                const steps = splitList(inputs.case.steps.value).map((value, index) => ({ order: index + 1, action: value }));
                let expected = [];
                try {
                    expected = parseExpectedResultsTextarea(inputs.case.expected.value);
                } catch (parseError) {
                    throw parseError;
                }
                const dynamic = parseJsonTextarea(inputs.case.dynamic.value, 'Dynamic variables');
                const payload = {
                    scenario: scenario.id,
                    title: (inputs.case.title.value || '').trim(),
                    description: inputs.case.description.value || '',
                    steps,
                    expected_results: expected,
                    dynamic_variables: dynamic,
                    priority: inputs.case.priority.value || '',
                    precondition: (document.getElementById('case-precondition') && document.getElementById('case-precondition').value) || '',
                    requirements: (document.getElementById('case-requirements') && document.getElementById('case-requirements').value) || '',
                    is_response_encrypted: Boolean(inputs.case.responseEncrypted && inputs.case.responseEncrypted.checked),
                };
                // If an API request was selected via the explorer, include it.
                // Force-sync visible label.dataset.requestId into the hidden input
                // to guard against other code clearing the hidden input between
                // explorer confirm and form serialization.
                try {
                    const hidden = document.getElementById('case-related-api-request-id');
                    const label = document.getElementById('case-related-api-request-label');
                    // prefer the hidden input if present
                    if (label && label.dataset && label.dataset.requestId) {
                        // write back into hidden input (force-sync)
                        if (hidden) hidden.value = label.dataset.requestId;
                    }
                    // now read from hidden input
                    if (hidden && hidden.value) {
                        const parsedId = Number(hidden.value);
                        if (!Number.isNaN(parsedId) && parsedId > 0) {
                            payload.related_api_request = parsedId;
                        }
                    }
                    automationLog('debug', '[handleCaseSubmit] after sync hidden value=', hidden && hidden.value, 'label.dataset.requestId=', label && label.dataset && label.dataset.requestId);
                    automationLog('debug', '[automation] creating case payload.related_api_request=', payload.related_api_request);
                } catch (e) { /* ignore */ }
                if (!payload.title) {
                    throw new Error('Test case title is required.');
                }
                // DEBUG ALERT: show exact payload being sent (temporary)
                try { alert('[DEBUG] Sending payload to /api/core/test-cases/ :\n' + JSON.stringify(payload, null, 2)); } catch (e) { /* ignore */ }
                await submitJson(apiEndpoints.cases || '/api/core/test-cases/', payload);
                els.caseForm.reset();
                setStatus('Test case added.', 'success');
                const plan = getSelectedPlan();
                await refreshPlans({
                    selectPlanId: plan ? plan.id : undefined,
                    selectScenarioId: scenario.id,
                    silent: true,
                });
                setStatus('Test case added.', 'success');
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unable to create test case.';
                setStatus(message, 'error');
            }
        };

        const handleMaintenanceSubmit = async (event) => {
            event.preventDefault();
            if (!els.maintenanceForm) {
                return;
            }
            const plan = getSelectedPlan();
            if (!plan) {
                setStatus('Select a plan before logging maintenance.', 'error');
                return;
            }
            try {
                const payload = {
                    plan: plan.id,
                    version: (inputs.maintenance.version.value || '').trim(),
                    summary: (inputs.maintenance.summary.value || '').trim(),
                    effective_date: inputs.maintenance.effectiveDate.value || null,
                    updated_by: (inputs.maintenance.updatedBy.value || '').trim(),
                    approved_by: (inputs.maintenance.approvedBy.value || '').trim(),
                    updates: parseJsonTextarea(inputs.maintenance.updates.value, 'Maintenance notes'),
                };
                if (!payload.version) {
                    throw new Error('Version label is required.');
                }
                if (!payload.summary) {
                    throw new Error('Summary is required.');
                }
                await submitJson(apiEndpoints.maintenances || '/api/core/test-plan-maintenances/', payload);
                els.maintenanceForm.reset();
                setStatus('Maintenance entry recorded.', 'success');
                await refreshPlans({ selectPlanId: plan.id, silent: true });
                setStatus('Maintenance entry recorded.', 'success');
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unable to create maintenance entry.';
                setStatus(message, 'error');
            }
        };

        if (els.planForm) {
            els.planForm.addEventListener('submit', handlePlanSubmit);
            els.planForm.addEventListener('reset', () => {
                window.setTimeout(() => {
                    resetObjectiveEditor();
                    resetPlanStepper();
                }, 0);
            });
        }
        if (els.scenarioForm) {
            els.scenarioForm.addEventListener('submit', handleScenarioSubmit);
        }
        if (els.caseForm) {
            els.caseForm.addEventListener('submit', handleCaseSubmit);
            // Safety-net: ensure hidden related_api_request is synced from visible label
            // before any submit handler runs (capture phase).
            els.caseForm.addEventListener('submit', (ev) => {
                try {
                    const hidden = document.getElementById('case-related-api-request-id');
                    const label = document.getElementById('case-related-api-request-label');
                    if (label && label.dataset && label.dataset.requestId) {
                        if (hidden) hidden.value = label.dataset.requestId;
                    }
                } catch (e) { /* ignore */ }
            }, true);
        }
        if (els.maintenanceForm) {
            els.maintenanceForm.addEventListener('submit', handleMaintenanceSubmit);
        }
        // Wire cascading selects for case creation: Plan -> Module -> Scenario
        try {
            if (els.casePlanSelect) {
                els.casePlanSelect.addEventListener('change', (ev) => {
                    const val = els.casePlanSelect.value || null;
                    if (!val) {
                        if (els.caseModuleSelect) els.caseModuleSelect.disabled = true;
                        if (els.caseScenarioSelect) els.caseScenarioSelect.disabled = true;
                        return;
                    }
                    updateCaseModulesForPlan(val);
                });
            }
            if (els.caseModuleSelect) {
                els.caseModuleSelect.addEventListener('change', (ev) => {
                    const planVal = els.casePlanSelect && els.casePlanSelect.value ? els.casePlanSelect.value : null;
                    const mod = els.caseModuleSelect.value || null;
                    if (!mod) {
                        if (els.caseScenarioSelect) els.caseScenarioSelect.disabled = true;
                        return;
                    }
                    updateCaseScenariosForModule(planVal, mod);
                });
            }
            if (els.caseScenarioSelect) {
                els.caseScenarioSelect.addEventListener('change', (ev) => {
                    // Enable or disable the case form depending on selection
                    const chosen = els.caseScenarioSelect.value;
                    const fieldset = els.caseForm ? els.caseForm.querySelector('fieldset') : null;
                    if (fieldset) fieldset.disabled = !chosen;
                });
            }
            // initialize selects
            populateCasePlanModuleScenarioSelects();
        } catch (e) { /* ignore */ }
        if (els.planModalTrigger) {
            els.planModalTrigger.addEventListener('click', (event) => {
                event.preventDefault();
                openPlanModal();
            });
        }
        if (elsExtra.planPrev) {
            elsExtra.planPrev.addEventListener('click', (event) => {
                event.preventDefault();
                const prev = Math.max(1, currentPlanStep - 1);
                showPlanStep(prev);
            });
        }
        root.addEventListener('click', (event) => {
            const openTrigger = event.target.closest('[data-action="open-plan-modal"]');
            if (openTrigger) {
                event.preventDefault();
                openPlanModal();
                return;
            }
            const viewTrigger = event.target.closest('[data-action="view-plan"]');
            if (viewTrigger) {
                event.preventDefault();
                const pid = viewTrigger.dataset.planId ? Number(viewTrigger.dataset.planId) : null;
                if (pid) {
                    const plan = state.plans.find(p => p.id === pid);
                    if (plan) openPlanView(plan);
                }
                return;
            }
            const editTrigger = event.target.closest('[data-action="edit-plan"]');
            if (editTrigger) {
                event.preventDefault();
                const pid = editTrigger.dataset.planId ? Number(editTrigger.dataset.planId) : null;
                if (pid) {
                    const plan = state.plans.find(p => p.id === pid);
                    if (plan) openPlanEdit(plan);
                }
                return;
            }
        });
        planModalCloseButtons.forEach((node) => {
            node.addEventListener('click', (event) => {
                event.preventDefault();
                closePlanModal({ resetForm: true, returnFocus: true });
                resetPlanStepper();
            });
        });
        document.addEventListener('keydown', handlePlanModalEscape);

        initObjectiveEditor();
        // Always attempt to load scenarios directly from the scenarios API on
        // initialization. This guarantees a network call to /api/core/test-scenarios/
        // so the Scenarios table can be populated even when the server-rendered
        // `initial_plans` payload lacks nested scenarios.
        const loadScenariosDirect = async () => {
            try {
                const scenariosUrl = apiEndpoints.scenarios || '/api/core/test-scenarios/';
                // debug log so you can see this attempt in the console
                automationLog('debug', '[automation] attempting to load scenarios from', scenariosUrl);
                setStatus('Loading scenarios…', 'info');
                const resp = await fetch(scenariosUrl, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
                if (!resp.ok) throw new Error(`Failed to load scenarios: ${resp.status}`);
                const scenarios = await resp.json();
                // normalize fetched scenarios
                const normalized = Array.isArray(scenarios) ? scenarios.map(normalizeScenario) : [];
                automationLog('debug', '[automation] scenarios fetched', Array.isArray(normalized) ? normalized.length : typeof normalized);
                // If we don't have plans on the client, fetch them first so we
                // can attach scenarios to real plan objects and set a selected
                // plan id. This covers cases where `initial_plans` was empty.
                if (!Array.isArray(state.plans) || !state.plans.length) {
                    try {
                        automationLog('debug', '[automation] no plans present, fetching plans before attaching scenarios');
                        await refreshPlans({ silent: true });
                    } catch (err) {
                        console.warn('[automation] failed to refresh plans before attaching scenarios', err);
                    }
                }
                // attach scenarios to plans by matching plan id
                if (Array.isArray(scenarios) && Array.isArray(state.plans)) {
                    state.plans.forEach((plan) => {
                        const pid = plan && plan.id ? plan.id : null;
                        plan.scenarios = normalized.filter((s) => Number(s.plan) === Number(pid));
                    });
                }
                initialSelection();
                renderAll();
                setStatus('', 'info');
            } catch (err) {
                console.warn('[automation] direct scenarios load failed, falling back to refreshPlans()', err);
                // fallback to refreshing plans (which may include nested scenarios)
                try {
                    await refreshPlans({ silent: false });
                } catch (_err) {
                    // if that fails, render with whatever we have and show error
                    initialSelection();
                    renderAll();
                }
            }
        };

        // fire the direct scenarios loader unconditionally
        loadScenariosDirect();
    });
})();
