(function () {
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

    const flattenMessages = (value) => {
        if (!value) {
            return [];
        }
        if (Array.isArray(value)) {
            return value.reduce((acc, item) => acc.concat(flattenMessages(item)), []);
        }
        if (typeof value === "object") {
            return Object.values(value).reduce((acc, item) => acc.concat(flattenMessages(item)), []);
        }
        return [String(value)];
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
            return meta.getAttribute("content") || "";
        }
        return "";
    };

    const ensureTrailingSlash = (value) => {
        if (!value) {
            return "";
        }
        return value.endsWith("/") ? value : `${value}/`;
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
            if (value.trim() === "") {
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

    const showToast = (message, variant = 'success') => {
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
            node.className = `automation-toast automation-toast--${variant}`;
            node.style.background = variant === 'error' ? 'rgba(208, 48, 48, 0.92)' : 'rgba(0, 0, 0, 0.85)';
            node.style.color = '#fff';
            node.style.padding = '9px 14px';
            node.style.marginTop = '8px';
            node.style.borderRadius = '4px';
            node.style.fontSize = '13px';
            node.textContent = message;
            container.appendChild(node);
            window.setTimeout(() => {
                try {
                    container.removeChild(node);
                } catch (err) {
                    /* ignore */
                }
            }, 3200);
        } catch (err) {
            /* ignore toast errors */
        }
    };

    const fallbackCoerceExpectedResultValue = (raw) => {
        if (raw === null || raw === undefined) {
            return "";
        }
        if (typeof raw !== "string") {
            return raw;
        }
        const trimmed = raw.trim();
        if (!trimmed) {
            return "";
        }
        if (/^(true|false)$/i.test(trimmed)) {
            return trimmed.toLowerCase() === "true";
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
        if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
            try {
                return JSON.parse(trimmed);
            } catch (error) {
                // ignore parse failure; return raw string below
            }
        }
        return trimmed;
    };

    const fallbackStringifyExpectedResultValue = (value) => {
        if (value === null) {
            return "null";
        }
        if (value === undefined) {
            return "";
        }
        if (typeof value === "string") {
            return value;
        }
        if (typeof value === "number" || typeof value === "boolean") {
            return String(value);
        }
        if (typeof value === "object") {
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

    const fallbackParseExpectedResultsTextarea = (raw) => {
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
            entries.push({ [key]: fallbackCoerceExpectedResultValue(valuePart) });
        });
        return entries;
    };

    const fallbackFormatExpectedResultsTextarea = (entries) => {
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
                        const noteVal = fallbackStringifyExpectedResultValue(entry[key]);
                        if (noteVal) {
                            lines.push(`# ${noteVal}`);
                        }
                    } else {
                        lines.push(`${key}: ${fallbackStringifyExpectedResultValue(entry[key])}`);
                    }
                    return;
                }
                keys.forEach((key) => {
                    if (key === 'note') {
                        const noteVal = fallbackStringifyExpectedResultValue(entry[key]);
                        if (noteVal) {
                            lines.push(`# ${noteVal}`);
                        }
                    } else {
                        lines.push(`${key}: ${fallbackStringifyExpectedResultValue(entry[key])}`);
                    }
                });
            }
        });
        return lines.join('\n');
    };

    const automationHelpers = window.__automationHelpers || {};
    const normalizeExpectedResultsEntries = automationHelpers.normalizeExpectedResultsEntries || fallbackNormalizeExpectedResultsEntries;
    const parseExpectedResultsTextarea = automationHelpers.parseExpectedResultsTextarea || fallbackParseExpectedResultsTextarea;
    const formatExpectedResultsTextarea = automationHelpers.formatExpectedResultsTextarea || fallbackFormatExpectedResultsTextarea;

    // Normalize scenario objects from the API so `module` and `project` are ids
    // (some API responses may return nested objects for these fields).
    const normalizeScenario = (s) => {
        if (!s || typeof s !== 'object') return s;
        const next = { ...s };
        try {
            if (next.module && typeof next.module === 'object') {
                next.module = next.module.id || next.module.pk || null;
            }
        } catch (e) { /* ignore */ }
        try {
            if (next.project && typeof next.project === 'object') {
                next.project = next.project.id || next.project.pk || null;
            }
        } catch (e) { /* ignore */ }
        // support module_id / project_id fields
        try {
            if ((next.module === undefined || next.module === null) && (next.module_id !== undefined)) {
                next.module = next.module_id;
            }
        } catch (e) { }
        try {
            if ((next.project === undefined || next.project === null) && (next.project_id !== undefined)) {
                next.project = next.project_id;
            }
        } catch (e) { }
        // Backwards compatibility: support legacy plan fields
        try {
            if ((next.project === undefined || next.project === null) && (next.plan !== undefined)) {
                next.project = next.plan;
            }
            if ((next.project_id === undefined || next.project_id === null) && (next.plan_id !== undefined)) {
                next.project_id = next.plan_id;
            }
        } catch (e) { /* ignore */ }

        // Scenario automation toggle (default True for backwards compatibility)
        try {
            if (typeof next.is_automated === 'undefined' || next.is_automated === null) {
                next.is_automated = true;
            } else {
                next.is_automated = Boolean(next.is_automated);
            }
        } catch (e) { /* ignore */ }
        return next;
    };

    const toKeyValueRows = (source) => {
        if (!source || typeof source !== "object") {
            return [{ key: "", value: "" }];
        }
        const rows = Object.entries(source).map(([key, value]) => ({
            key,
            value: value === null || value === undefined ? "" : String(value),
        }));
        if (!rows.length) {
            rows.push({ key: "", value: "" });
        }
        return rows;
    };

    const ensureKeyValueRows = (rows) => {
        if (!Array.isArray(rows) || !rows.length) {
            return [{ key: "", value: "" }];
        }
        return rows.map((row) => ({
            key: row && row.key ? String(row.key) : "",
            value: row && row.value !== undefined && row.value !== null ? String(row.value) : "",
        }));
    };

    const keyValueRowsToObject = (rows) => {
        const result = {};
        if (!Array.isArray(rows)) {
            return result;
        }
        rows.forEach((row) => {
            const key = row && row.key ? String(row.key).trim() : "";
            if (!key) {
                return;
            }
            result[key] = row && row.value !== undefined && row.value !== null ? String(row.value) : "";
        });
        return result;
    };

    const request = async (url, options = {}) => {
        const method = (options.method || "GET").toUpperCase();
        const headers = { ...(options.headers || {}) };
        const config = {
            credentials: "same-origin",
            ...options,
            method,
            headers,
        };
        if (method !== "GET" && method !== "HEAD") {
            headers["Content-Type"] = headers["Content-Type"] || "application/json";
            headers["X-CSRFToken"] = headers["X-CSRFToken"] || getCsrfToken();
        }
        const response = await fetch(url, config);
        if (response.ok) {
            if (response.status === 204) {
                return null;
            }
            const text = await response.text();
            return text ? JSON.parse(text) : null;
        }
        let messages = [];
        try {
            const data = await response.json();
            messages = flattenMessages(data);
        } catch (error) {
            // ignore JSON parse errors
        }
        const message = messages.length ? messages.join(" ") : `Request failed with status ${response.status}`;
        throw new Error(message);
    };

    const debounce = (fn, delay) => {
        let timeoutId;
        return (...args) => {
            window.clearTimeout(timeoutId);
            timeoutId = window.setTimeout(() => fn(...args), delay);
        };
    };

    document.addEventListener("DOMContentLoaded", () => {
        // support mounting the same module on both the dedicated Data Management
        // page (`data-management-app`) and the Test Plans page (`automation-app`).
        const root = document.getElementById("data-management-app") || document.getElementById("automation-app");
        if (!root) {
            return;
        }

        const readScriptJson = (id) => {
            const node = document.getElementById(id);
            if (!node) {
                return null;
            }
            const payload = node.textContent || node.innerText || "null";
            try {
                return JSON.parse(payload);
            } catch (error) {
                // eslint-disable-next-line no-console
                console.warn(`[data-management] Failed to parse ${id}:`, error);
                return null;
            }
        };

        let activeViewScenarioAttachCommentId = null;

        const initialEnvironments = readScriptJson("automation-initial-environments") || [];
        const initialRisks = readScriptJson("automation-initial-risks") || [];
        const initialMitigations = readScriptJson("automation-initial-mitigation-plans") || [];
        const initialMappings = readScriptJson("automation-initial-risk-mitigations") || [];
        const initialProjects = readScriptJson("automation-initial-plans") || [];
        const initialSection = readScriptJson("data-management-initial-section") || "";
        const apiEndpoints = readScriptJson("automation-api-endpoints") || {};

        const hasPermissionMarker = (id) => !!root.querySelector(`#${id}`);
        const canViewProjectModule = hasPermissionMarker('perm-can-view-project-module');
        const canChangeProjectModule = hasPermissionMarker('perm-can-change-project-module');
        const canDeleteProjectModule = hasPermissionMarker('perm-can-delete-project-module');
        const canCreateProjectScenario = hasPermissionMarker('perm-can-create-project-scenario');
        const canViewProjectScenario = hasPermissionMarker('perm-can-view-project-scenario');
        const canChangeProjectScenario = hasPermissionMarker('perm-can-change-project-scenario');
        const canDeleteProjectScenario = hasPermissionMarker('perm-can-delete-project-scenario');

        const endpoints = {
            environments: ensureTrailingSlash(apiEndpoints.environments || ""),
            risks: ensureTrailingSlash(apiEndpoints.risks || ""),
            mitigations: ensureTrailingSlash(apiEndpoints.mitigation_plans || ""),
            mappings: ensureTrailingSlash(apiEndpoints.risk_mitigations || ""),
            testTools: ensureTrailingSlash(apiEndpoints.test_tools || ""),
            testModules: ensureTrailingSlash(apiEndpoints.test_modules || ""),
            cases: ensureTrailingSlash(apiEndpoints.cases || ""),
            scenarios: ensureTrailingSlash(apiEndpoints.scenarios || ""),
        };

        const endpointRequirements = [];
        if (root.querySelector('[data-role="environment-list"]')) {
            endpointRequirements.push(["environments", "environments"]);
        }
        if (root.querySelector('[data-role="risk-list"]')) {
            endpointRequirements.push(["risks", "risks"]);
        }
        if (root.querySelector('[data-role="mitigation-list"]')) {
            endpointRequirements.push(["mitigations", "mitigation plans"]);
        }
        if (root.querySelector('[data-role="mapping-list"]')) {
            endpointRequirements.push(["mappings", "risk mitigations"]);
        }
        if (root.querySelector('[data-role="test-tools-list"]')) {
            endpointRequirements.push(["testTools", "test tools"]);
        }
        if (root.querySelector('[data-role="test-modules-list"]')) {
            endpointRequirements.push(["testModules", "test modules"]);
            endpointRequirements.push(["scenarios", "test scenarios"]);
            endpointRequirements.push(["cases", "test cases"]);
        }

        const missingEndpoints = endpointRequirements.filter(([key]) => !endpoints[key]);
        if (missingEndpoints.length) {
            const labels = missingEndpoints.map(([, label]) => label).join(", ");
            try {
                // eslint-disable-next-line no-console
                console.warn(`[data-management] Missing API endpoints for: ${labels}. Aborting module initialisation.`);
            } catch (error) {
                /* ignore */
            }
            return;
        }

        const els = {
            status: root.querySelector('[data-role="status"]'),
            environmentList: root.querySelector('[data-role="environment-list"]'),
            environmentSearch: root.querySelector('[data-role="environment-search"]'),
            environmentModal: root.querySelector('[data-role="environment-modal"]'),
            environmentForm: document.getElementById("environment-form"),
            environmentName: document.getElementById("environment-name"),
            environmentDescription: document.getElementById("environment-description"),
            environmentVariableRows: root.querySelector('[data-role="environment-variable-rows"]'),
            environmentHeaderRows: root.querySelector('[data-role="environment-header-rows"]'),
            environmentAddVariable: root.querySelector('[data-role="environment-add-variable"]'),
            environmentAddHeader: root.querySelector('[data-role="environment-add-header"]'),
            environmentSubmit: root.querySelector('[data-role="environment-submit"]'),
            environmentMeta: root.querySelector('[data-role="environment-meta"]'),
            environmentCreated: root.querySelector('[data-role="environment-created"]'),
            environmentUpdated: root.querySelector('[data-role="environment-updated"]'),
            metricEnvironments: root.querySelector('[data-role="metric-environments"]'),
            riskList: root.querySelector('[data-role="risk-list"]'),
            mitigationList: root.querySelector('[data-role="mitigation-list"]'),
            mappingList: root.querySelector('[data-role="mapping-list"]'),
            riskSearch: root.querySelector('[data-role="risk-search"]'),
            mitigationSearch: root.querySelector('[data-role="mitigation-search"]'),
            mappingSearch: root.querySelector('[data-role="mapping-search"]'),
            riskModal: root.querySelector('[data-role="risk-modal"]'),
            mitigationModal: root.querySelector('[data-role="mitigation-modal"]'),
            mappingModal: root.querySelector('[data-role="mapping-modal"]'),
            riskForm: document.getElementById("risk-form"),
            mitigationForm: document.getElementById("mitigation-form"),
            mappingForm: document.getElementById("mapping-form"),
            riskSubmit: root.querySelector('[data-role="risk-submit"]'),
            mitigationSubmit: root.querySelector('[data-role="mitigation-submit"]'),
            mappingSubmit: root.querySelector('[data-role="mapping-submit"]'),
            riskTitle: document.getElementById("risk-title"),
            riskDescription: document.getElementById("risk-description"),
            mitigationTitle: document.getElementById("mitigation-title"),
            mitigationDescription: document.getElementById("mitigation-description"),
            mappingRiskSelect: root.querySelector('[data-role="mapping-risk-select"]'),
            mappingMitigationSelect: root.querySelector('[data-role="mapping-mitigation-select"]'),
            mappingImpact: document.getElementById("mapping-impact"),
            testToolsList: root.querySelector('[data-role="test-tools-list"]'),
            testToolsSearch: root.querySelector('[data-role="test-tools-search"]'),
            testToolsModal: root.querySelector('[data-role="test-tools-modal"]'),
            testToolsForm: document.getElementById("test-tools-form"),
            testToolsTitle: document.getElementById("test-tools-title"),
            testToolsDescription: document.getElementById("test-tools-description"),
            testToolsSubmit: root.querySelector('[data-role="test-tools-submit"]'),
            testToolsMeta: root.querySelector('[data-role="test-tools-meta"]'),
            testToolsCreated: root.querySelector('[data-role="test-tools-created"]'),
            testToolsUpdated: root.querySelector('[data-role="test-tools-updated"]'),
            testModulesList: root.querySelector('[data-role="test-modules-list"]'),
            testModulesSearch: root.querySelector('[data-role="test-modules-search"]'),
            testModulesModal: root.querySelector('[data-role="test-modules-modal"]'),
            testModulesForm: document.getElementById("test-modules-form"),
            testModulesTitle: document.getElementById("test-modules-title"),
            testModulesDescription: document.getElementById("test-modules-description"),
            testModulesProject: document.getElementById("test-modules-project"),
            testModulesFilterProject: document.getElementById("test-modules-filter-project"),
            testModulesSubmit: root.querySelector('[data-role="test-modules-submit"]'),
            testModulesMeta: root.querySelector('[data-role="test-modules-meta"]'),
            testModulesCreated: root.querySelector('[data-role="test-modules-created"]'),
            testModulesUpdated: root.querySelector('[data-role="test-modules-updated"]'),
        };

        const body = document.body;

        const state = {
            environments: Array.isArray(initialEnvironments) ? initialEnvironments : [],
            risks: Array.isArray(initialRisks) ? initialRisks : [],
            mitigationPlans: Array.isArray(initialMitigations) ? initialMitigations : [],
            mappings: Array.isArray(initialMappings) ? initialMappings : [],
            environmentModalMode: "create",
            environmentCurrentId: null,
            environmentForm: null,
            testModules: [],
            testModulesSearch: "",
            environmentSearch: "",
            riskModalMode: "create",
            riskCurrentId: null,
            mitigationModalMode: "create",
            mitigationCurrentId: null,
            testModulesModalMode: "create",
            mappingModalMode: "create",
            testModulesCurrentId: null,
            mappingCurrentId: null,
            riskSearch: "",
            mitigationSearch: "",
            mappingSearch: "",
            testTools: Array.isArray(readScriptJson("automation-initial-test-tools")) ? readScriptJson("automation-initial-test-tools") : [],
            testToolsModalMode: "create",
            testToolsCurrentId: null,
            testToolsSearch: "",
            moduleScenarioSearch: {},
            moduleScenarioModalMode: 'create',
            moduleScenarioCurrentId: null,
            moduleScenarioSubmitting: false,
        };

        const setStatus = (message, variant = "info") => {
            if (!els.status) {
                return;
            }
            if (!message) {
                els.status.dataset.variant = "info";
                els.status.textContent = "";
                els.status.hidden = true;
                return;
            }
            els.status.hidden = false;
            els.status.dataset.variant = variant;
            els.status.textContent = message;
        };

        const setViewScenarioSaveVisible = (modalEl, visible) => {
            try {
                if (!modalEl) return;
                const row = modalEl.querySelector('#module-view-scenario-save-row');
                if (!row) return;
                row.hidden = !visible;
                try { row.style.display = visible ? '' : 'none'; } catch (e) { /* ignore */ }
            } catch (e) { /* ignore */ }
        };

        const exitViewScenarioDescriptionEdit = (modalEl) => {
            if (!modalEl) return;

            let rawHtml = '';
            try {
                const descEl = modalEl.querySelector('#module-add-scenario-description') || document.getElementById('module-add-scenario-description');
                if (descEl) {
                    rawHtml = (descEl.dataset && typeof descEl.dataset.rawHtml === 'string')
                        ? descEl.dataset.rawHtml
                        : (descEl.value || '');
                }
            } catch (e) { /* ignore */ }

            try { removeScenarioDescriptionEditor(); } catch (e) { /* ignore */ }
            try {
                const tox = modalEl.querySelector('.tox-tinymce');
                if (tox && tox.parentNode) tox.parentNode.removeChild(tox);
            } catch (e) { /* ignore */ }

            try {
                const descEl = modalEl.querySelector('#module-add-scenario-description') || document.getElementById('module-add-scenario-description');
                if (descEl) {
                    descEl.readOnly = true;
                    descEl.disabled = false;
                    descEl.value = htmlToFormattedText(rawHtml || '');
                    autosizeTextareaToContent(descEl, { minRows: 12 });
                }
            } catch (e) { /* ignore */ }

            try { setViewScenarioSaveVisible(modalEl, false); } catch (e) { /* ignore */ }
            try {
                const submit = modalEl.querySelector('button[type="submit"]');
                if (submit) submit.hidden = true;
            } catch (e) { /* ignore */ }
        };

        const highlightSection = (section) => {
            if (!section) {
                return;
            }
            const normalized = String(section).toLowerCase();
            const target = root.querySelector(`[data-section="${normalized}"]`);
            if (!target) {
                return;
            }
            target.classList.add("is-highlighted");
            target.scrollIntoView({ behavior: "smooth", block: "start" });
            window.setTimeout(() => {
                target.classList.remove("is-highlighted");
            }, 1600);
        };

        const applyHashSection = () => {
            const hash = window.location.hash ? window.location.hash.replace(/^#/, "") : "";
            highlightSection(hash);
        };

        const focusEnvironmentRow = (group, index) => {
            const container = group === "variables" ? els.environmentVariableRows : els.environmentHeaderRows;
            if (!container) {
                return;
            }
            const selector = `[data-group="${group}"][data-field="key"][data-index="${index}"]`;
            const target = container.querySelector(selector);
            if (target && typeof target.focus === "function") {
                target.focus();
            }
        };

        const renderEnvironmentRows = (group) => {
            const container = group === "variables" ? els.environmentVariableRows : els.environmentHeaderRows;
            if (!container || !state.environmentForm) {
                return;
            }
            const rows = Array.isArray(state.environmentForm[group]) ? state.environmentForm[group] : [];
            const readOnly = state.environmentModalMode === "view";
            if (!rows.length) {
                const emptyText = group === "variables" ? "No variables defined." : "No headers defined.";
                container.innerHTML = `<tr><td colspan="3" class="empty">${emptyText}</td></tr>`;
                return;
            }
            const markup = rows
                .map((row, index) => {
                    const keyValue = escapeHtml(row.key || "");
                    const valueValue = escapeHtml(row.value || "");
                    const removeCell = readOnly
                        ? "&mdash;"
                        : `<button type="button" class="btn-tertiary" data-action="environment-remove-row" data-group="${group}" data-index="${index}">Remove</button>`;
                    return (
                        `\n                        <tr data-index="${index}">\n` +
                        `                            <td data-label="Key">\n` +
                        `                                <input type="text" data-group="${group}" data-field="key" data-index="${index}" value="${keyValue}"${readOnly ? " readonly" : ""}>\n` +
                        "                            </td>\n" +
                        `                            <td data-label="Value">\n` +
                        `                                <input type="text" data-group="${group}" data-field="value" data-index="${index}" value="${valueValue}"${readOnly ? " readonly" : ""}>\n` +
                        "                            </td>\n" +
                        `                            <td data-label="Actions">${removeCell}</td>\n` +
                        "                        </tr>\n"
                    );
                })
                .join("");
            container.innerHTML = markup;
        };

        const renderEnvironmentMeta = () => {
            if (!els.environmentMeta || !state.environmentForm) {
                return;
            }
            const createdText = state.environmentForm.createdAt ? formatDateTime(state.environmentForm.createdAt) : null;
            const updatedText = state.environmentForm.updatedAt ? formatDateTime(state.environmentForm.updatedAt) : null;
            if (createdText || updatedText) {
                els.environmentMeta.hidden = false;
                if (els.environmentCreated) {
                    els.environmentCreated.textContent = createdText || "--";
                }
                if (els.environmentUpdated) {
                    els.environmentUpdated.textContent = updatedText || "--";
                }
            } else {
                els.environmentMeta.hidden = true;
            }
        };

        const renderTestToolsList = () => {
            if (!els.testToolsList) {
                return;
            }
            const filtered = state.testTools.filter((tool) => {
                const q = state.testToolsSearch.toLowerCase();
                if (!q) return true;
                return (tool.title || "").toLowerCase().includes(q) || (tool.description || "").toLowerCase().includes(q);
            });
            if (!filtered.length) {
                els.testToolsList.innerHTML = '<tr><td colspan="4" class="empty">No test tools match the current filters.</td></tr>';
                return;
            }
            const rows = filtered
                .map((tool) => `
                    <tr data-tool-id="${tool.id}">
                        <td>${escapeHtml(tool.title || "")}</td>
                        <td>${escapeHtml(tool.description || "")}</td>
                        <td>${escapeHtml(tool.updated_at || "--")}</td>
                        <td>
                            <div class="table-action-group">
                                <button type="button" class="action-button" data-action="view-test-tool" data-tool-id="${tool.id}">View</button>
                                <button type="button" class="action-button" data-action="edit-test-tool" data-tool-id="${tool.id}">Edit</button>
                                <button type="button" class="action-button" data-action="delete-test-tool" data-tool-id="${tool.id}" data-variant="danger">Delete</button>
                            </div>
                        </td>
                    </tr>
                `)
                .join("");
            els.testToolsList.innerHTML = rows;
        };

        const renderTestModulesList = () => {
            if (!els.testModulesList) {
                return;
            }
            let filtered = state.testModules.filter((m) => {
                const q = state.testModulesSearch.toLowerCase();
                if (!q) return true;
                return (m.title || "").toLowerCase().includes(q) || (m.description || "").toLowerCase().includes(q) || String(m.project_id || "").toLowerCase().includes(q);
            });
            // apply project filter if selected
            if (els.testModulesFilterProject && els.testModulesFilterProject.value) {
                const projectVal = Number(els.testModulesFilterProject.value);
                filtered = filtered.filter((m) => Number(m.project_id) === projectVal);
            }
            if (!filtered.length) {
                els.testModulesList.innerHTML = '<tr><td colspan="7" class="empty">No test modules match the current filters.</td></tr>';
                return;
            }
            // render modules as collapsible rows with a nested sublist for scenarios
            const rows = filtered
                .map((m) => {
                    const project = initialProjects.find((p) => Number(p.id) === Number(m.project_id));
                    const projectLabel = project ? (project.name || project.title || `Project ${project.id}`) : "";
                    const scenariosAll = Array.isArray(m.scenarios) ? m.scenarios : [];
                    const query = state.moduleScenarioSearch && state.moduleScenarioSearch[m.id] ? String(state.moduleScenarioSearch[m.id]).toLowerCase() : '';
                    const scenarios = query ? scenariosAll.filter((s) => {
                        const q = query;
                        return (s.title || '').toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q);
                    }) : scenariosAll;
                    const scenarioRows = scenarios
                        .map((s) => `
                            <tr class="module-scenario-row" data-scenario-id="${s.id}">
                                <td class="scenario-title">${escapeHtml(s.title || '')}</td>
                                <td class="scenario-description" style="white-space: pre-wrap;">${s.description ? `<div class="table-secondary">${escapeHtml(htmlToFormattedText(s.description))}</div>` : '—'}</td>
                                <td class="scenario-created">${escapeHtml(formatDateTime(s.created_at || null))}</td>
                                <td class="scenario-updated">${escapeHtml(formatDateTime(s.updated_at || null))}</td>
                                <td class="scenario-actions">
                                    <div class="table-action-group">
                                        ${canViewProjectScenario ? `<button type="button" class="action-button" data-action="view-scenario" data-scenario-id="${s.id}">View</button>` : ''}
                                        ${canChangeProjectScenario ? `<button type="button" class="action-button" data-action="edit-scenario" data-scenario-id="${s.id}">Edit</button>` : ''}
                                        ${canDeleteProjectScenario ? `<button type="button" class="action-button" data-action="delete-scenario" data-scenario-id="${s.id}" data-variant="danger">Delete</button>` : ''}
                                    </div>
                                </td>
                            </tr>
                        `)
                        .join("");
                    return `
                    <tr class="module-row" data-module-id="${m.id}">
                        <td class="col-collapse">
                            <button type="button" class="btn-icon module-toggle" aria-expanded="false" data-action="toggle-module" data-module-id="${m.id}" aria-label="Toggle scenarios for ${escapeHtml(m.title || '')}">▸</button>
                        </td>
                        <td>${escapeHtml(m.title || "")}</td>
                        <td>${escapeHtml(m.description || "")}</td>
                        <td>${escapeHtml(projectLabel)}</td>
                        <td>${escapeHtml(formatDateTime(m.created_at || null))}</td>
                        <td>${escapeHtml(formatDateTime(m.updated_at || null))}</td>
                        <td>
                            <div class="table-action-group">
                                ${canViewProjectModule ? `<button type="button" class="action-button" data-action="view-test-module" data-module-id="${m.id}">View</button>` : ''}
                                ${canChangeProjectModule ? `<button type="button" class="action-button" data-action="edit-test-module" data-module-id="${m.id}">Edit</button>` : ''}
                                ${canDeleteProjectModule ? `<button type="button" class="action-button" data-action="delete-test-module" data-module-id="${m.id}" data-variant="danger">Delete</button>` : ''}
                            </div>
                        </td>
                    </tr>
                        <tr class="module-row-body" data-module-body-for="${m.id}" hidden>
                        <td colspan="7">
                            <div class="module-body">
                                <div class="module-body-actions">
                                    <input type="search" class="automation-search" placeholder="Search scenarios" data-action="module-scenario-search" data-module-id="${m.id}" value="${escapeHtml(state.moduleScenarioSearch && state.moduleScenarioSearch[m.id] ? state.moduleScenarioSearch[m.id] : '')}">
                                    ${canCreateProjectScenario ? `<button type="button" class="btn-primary" data-action="add-scenario-to-module" data-module-id="${m.id}">Add Scenario</button>` : ''}
                                </div>
                                <div class="module-scenarios-wrapper">
                                    <table class="module-scenarios-table">
                                            <thead>
                                                <tr>
                                                    <th>Title</th>
                                                    <th>Description</th>
                                                    <th>Created</th>
                                                    <th>Updated</th>
                                                    <th>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                ${scenarioRows || '<tr><td colspan="5" class="empty">No scenarios yet.</td></tr>'}
                                            </tbody>
                                        </table>
                                </div>
                            </div>
                        </td>
                    </tr>
                `;
                })
                .join("");
            els.testModulesList.innerHTML = rows;
        };

        // Toggle module collapse/expand (supports lazy-loading scenarios on first expand)
        const toggleModule = async (moduleId, expand) => {
            const row = els.testModulesList.querySelector(`[data-module-id="${moduleId}"]`);
            if (!row) return;
            const btn = row.querySelector('[data-action="toggle-module"]');
            // the body is rendered in the following sibling tr with data-module-body-for
            const bodyRow = els.testModulesList.querySelector(`tr.module-row-body[data-module-body-for="${moduleId}"]`);
            const body = bodyRow ? bodyRow.querySelector('.module-body') : null;
            if (!body || !btn) return;
            const isExpanded = btn.getAttribute('aria-expanded') === 'true';
            const willExpand = typeof expand === 'boolean' ? expand : !isExpanded;

            // find module object in state
            const moduleObj = state.testModules.find((m) => Number(m.id) === Number(moduleId));

            if (willExpand) {
                // if scenarios not loaded yet, fetch them
                if (moduleObj && !moduleObj._scenarios_loaded) {
                    try {
                        setStatus('Loading scenarios…', 'info');
                        const url = endpoints.scenarios || (apiEndpoints.scenarios ? ensureTrailingSlash(apiEndpoints.scenarios) : '/api/core/test-scenarios/');
                        const data = await request(buildUrl(url, { module: moduleId }), { method: 'GET' });
                        moduleObj.scenarios = Array.isArray(data) ? data.map(normalizeScenario) : [];
                        moduleObj._scenarios_loaded = true;
                        // re-render list so scenarios appear in the DOM
                        renderTestModulesList();
                        // after re-render, find the new row/button and expand it
                        const newRow = els.testModulesList.querySelector(`[data-module-id="${moduleId}"]`);
                        const newBtn = newRow ? newRow.querySelector('[data-action="toggle-module"]') : null;
                        const newBodyRow = els.testModulesList.querySelector(`tr.module-row-body[data-module-body-for="${moduleId}"]`);
                        if (newBodyRow) newBodyRow.hidden = false;
                        if (newBtn) {
                            newBtn.setAttribute('aria-expanded', 'true');
                            newBtn.textContent = '▾';
                        }
                        setStatus('', 'info');
                        return;
                    } catch (err) {
                        setStatus(err instanceof Error ? err.message : 'Failed to load scenarios.', 'error');
                        return;
                    }
                }
                // if already loaded, just reveal body
                bodyRow.hidden = false;
                btn.setAttribute('aria-expanded', 'true');
                btn.textContent = '▾';
            } else {
                bodyRow.hidden = true;
                btn.setAttribute('aria-expanded', 'false');
                btn.textContent = '▸';
            }
        };

        // Ensure a module row is expanded after a render (keeps UI stable after updates)
        const ensureModuleExpanded = (moduleId) => {
            // defensive: if the modules list element is not present on the page,
            // bail out early to avoid calling querySelector on null.
            if (!els.testModulesList) return;
            // find the row/button in the current DOM and expand it
            const row = els.testModulesList.querySelector(`[data-module-id="${moduleId}"]`);
            if (!row) return;
            const btn = row.querySelector('[data-action="toggle-module"]');
            const bodyRow = els.testModulesList.querySelector(`tr.module-row-body[data-module-body-for="${moduleId}"]`);
            if (!btn || !bodyRow) return;
            bodyRow.hidden = false;
            btn.setAttribute('aria-expanded', 'true');
            btn.textContent = '▾';
        };

        const htmlToFormattedText = (value) => {
            if (!value) {
                return '';
            }
            if (typeof document === 'undefined' || !document.createElement) {
                return String(value);
            }

            const container = document.createElement('div');
            container.innerHTML = String(value);

            const out = [];
            const listStack = [];

            const pushText = (text, { preserveWhitespace } = {}) => {
                if (!text) return;
                if (preserveWhitespace) {
                    out.push(text);
                    return;
                }
                out.push(String(text).replace(/[\t\f\v ]+/g, ' '));
            };

            const ensureNewline = (count = 1) => {
                const joined = out.join('');
                let existing = 0;
                for (let i = joined.length - 1; i >= 0; i -= 1) {
                    if (joined[i] === '\n') existing += 1;
                    else if (joined[i] === ' ') continue;
                    else break;
                }
                const needed = Math.max(0, count - existing);
                if (needed) out.push('\n'.repeat(needed));
            };

            const renderNode = (node, opts = {}) => {
                if (!node) return;
                const preserveWhitespace = !!opts.preserveWhitespace;
                if (node.nodeType === Node.TEXT_NODE) {
                    pushText(node.nodeValue || '', { preserveWhitespace });
                    return;
                }
                if (node.nodeType !== Node.ELEMENT_NODE) {
                    return;
                }

                const tag = (node.tagName || '').toUpperCase();
                if (tag === 'BR') {
                    out.push('\n');
                    return;
                }

                if (tag === 'PRE') {
                    ensureNewline(1);
                    pushText(node.textContent || '', { preserveWhitespace: true });
                    ensureNewline(1);
                    return;
                }

                if (tag === 'CODE') {
                    pushText(node.textContent || '', { preserveWhitespace });
                    return;
                }

                if (tag === 'UL' || tag === 'OL') {
                    ensureNewline(1);
                    listStack.push({ type: tag, counter: 0 });
                    const items = Array.from(node.children || []).filter((c) => (c.tagName || '').toUpperCase() === 'LI');
                    items.forEach((li) => {
                        const top = listStack[listStack.length - 1];
                        if (top.type === 'OL') {
                            top.counter += 1;
                        }
                        const depth = Math.max(0, listStack.length - 1);
                        const indent = '  '.repeat(depth);
                        const marker = top.type === 'OL' ? `${top.counter}. ` : '• ';
                        ensureNewline(1);
                        out.push(indent + marker);
                        let listMarkerPending = true;
                        Array.from(li.childNodes || []).forEach((child) => {
                            if (child && child.nodeType === Node.TEXT_NODE) {
                                const raw = child.nodeValue || '';
                                if (!raw.trim()) {
                                    return;
                                }
                            }
                            renderNode(child, { preserveWhitespace, listMarkerStart: listMarkerPending });
                            listMarkerPending = false;
                        });
                        ensureNewline(1);
                    });
                    listStack.pop();
                    ensureNewline(1);
                    return;
                }

                const isBlock = ['P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'BLOCKQUOTE'].includes(tag);
                if (isBlock) {
                    if (!opts.listMarkerStart) {
                        ensureNewline(1);
                    }
                    Array.from(node.childNodes || []).forEach((child) => {
                        renderNode(child, { preserveWhitespace });
                    });
                    ensureNewline(opts.listMarkerStart ? 1 : 2);
                    return;
                }

                Array.from(node.childNodes || []).forEach((child) => {
                    renderNode(child, { preserveWhitespace });
                });
            };

            Array.from(container.childNodes || []).forEach((child) => renderNode(child));

            let text = out.join('');
            text = text
                .replace(/[ \t]+\n/g, '\n')
                // Avoid a blank line directly before list markers.
                // Example: "Pre-conditions:\n\n1. Foo" -> "Pre-conditions:\n1. Foo"
                .replace(/\n{2,}(?=\s*(?:\d+\.\s|•\s))/g, '\n')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
            return text;
        };

        const autosizeTextareaToContent = (textareaEl, { minRows } = {}) => {
            if (!textareaEl) return;
            try {
                textareaEl.style.height = 'auto';
                textareaEl.style.overflowY = 'hidden';

                let minHeightPx = 0;
                if (minRows && typeof window !== 'undefined' && window.getComputedStyle) {
                    const cs = window.getComputedStyle(textareaEl);
                    let lineHeight = Number.parseFloat(cs.lineHeight);
                    if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
                        const fontSize = Number.parseFloat(cs.fontSize) || 0;
                        if (fontSize > 0) {
                            // Typical browser default for "normal" line-height.
                            lineHeight = fontSize * 1.2;
                        }
                    }
                    lineHeight = Number.isFinite(lineHeight) ? lineHeight : 0;
                    const paddingTop = Number.parseFloat(cs.paddingTop) || 0;
                    const paddingBottom = Number.parseFloat(cs.paddingBottom) || 0;
                    if (lineHeight > 0) {
                        minHeightPx = (lineHeight * Number(minRows)) + paddingTop + paddingBottom;
                    }
                }

                // Add a tiny buffer to avoid scrollbars due to rounding.
                const contentHeight = textareaEl.scrollHeight + 2;
                const targetHeight = Math.max(contentHeight, minHeightPx);
                textareaEl.style.height = `${targetHeight}px`;
            } catch (e) { /* ignore */ }
        };

        // TinyMCE for scenario description (Add/Edit Scenario modal)
        let scenarioDescriptionEditor = null;

        // TinyMCE for Test Case Description (Add Test Case modal)
        let moduleCaseDescriptionEditor = null;

        // TinyMCE for inline "Add Comment" in View Scenario
        let viewScenarioCommentEditor = null;

        // TinyMCE for inline Edit/Reply in View Scenario comments
        let viewScenarioInlineCommentEditor = null;

        const removeViewScenarioCommentEditor = () => {
            try {
                if (typeof tinymce !== 'undefined') {
                    try {
                        const byId = tinymce.get && tinymce.get('module-view-scenario-comment-content');
                        if (byId) tinymce.remove(byId);
                    } catch (e) { /* ignore */ }
                    try { tinymce.remove('#module-view-scenario-comment-content'); } catch (e) { /* ignore */ }
                }
            } catch (e) { /* ignore */ }
            viewScenarioCommentEditor = null;
            try {
                const el = document.getElementById('module-view-scenario-comment-content');
                if (el) {
                    el.style.display = '';
                    el.removeAttribute('aria-hidden');
                }
            } catch (e) { /* ignore */ }
        };

        const initViewScenarioCommentEditor = () => {
            const el = document.getElementById('module-view-scenario-comment-content');
            if (!el) return;
            removeViewScenarioCommentEditor();
            if (typeof tinymce === 'undefined') return;

            tinymce.init({
                target: el,
                height: 200,
                menubar: false,
                branding: false,
                plugins: [
                    'advlist', 'autolink', 'lists', 'link', 'charmap', 'preview',
                    'searchreplace', 'visualblocks', 'code', 'fullscreen',
                    'insertdatetime', 'table', 'help', 'wordcount'
                ],
                toolbar: 'undo redo | formatselect | bold italic underline strikethrough | ' +
                    'alignleft aligncenter alignright alignjustify | ' +
                    'bullist numlist outdent indent | forecolor backcolor | removeformat | help',
                content_style: 'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 14px }',
                setup(editor) {
                    viewScenarioCommentEditor = editor;
                    const sync = () => {
                        try { el.value = editor.getContent({ format: 'html' }) || ''; } catch (e) { /* ignore */ }
                    };
                    editor.on('change keyup paste blur setcontent', sync);
                    editor.on('remove', () => {
                        if (viewScenarioCommentEditor === editor) {
                            viewScenarioCommentEditor = null;
                        }
                    });
                },
            });
        };

        const removeViewScenarioInlineCommentEditor = () => {
            try {
                if (typeof tinymce !== 'undefined') {
                    try {
                        const byId = tinymce.get && tinymce.get('module-view-inline-comment-content');
                        if (byId) tinymce.remove(byId);
                    } catch (e) { /* ignore */ }
                    try { tinymce.remove('#module-view-inline-comment-content'); } catch (e) { /* ignore */ }
                }
            } catch (e) { /* ignore */ }
            viewScenarioInlineCommentEditor = null;
        };

        const removeModuleCaseDescriptionEditor = () => {
            try {
                if (typeof tinymce !== 'undefined') {
                    try {
                        const byId = tinymce.get && tinymce.get('module-add-case-description');
                        if (byId) tinymce.remove(byId);
                    } catch (e) { /* ignore */ }
                    try { tinymce.remove('#module-add-case-description'); } catch (e) { /* ignore */ }
                }
            } catch (e) { /* ignore */ }
            moduleCaseDescriptionEditor = null;
            try {
                const el = document.getElementById('module-add-case-description');
                if (el) {
                    el.style.display = '';
                    el.removeAttribute('aria-hidden');
                }
            } catch (e) { /* ignore */ }
        };

        const initModuleCaseDescriptionEditor = () => {
            const el = document.getElementById('module-add-case-description');
            if (!el) return;
            removeModuleCaseDescriptionEditor();
            if (typeof tinymce === 'undefined') return;

            tinymce.init({
                target: el,
                height: 200,
                menubar: false,
                branding: false,
                plugins: [
                    'advlist', 'autolink', 'lists', 'link', 'charmap', 'preview',
                    'searchreplace', 'visualblocks', 'code', 'fullscreen',
                    'insertdatetime', 'table', 'help', 'wordcount'
                ],
                toolbar: 'undo redo | formatselect | bold italic underline strikethrough | ' +
                    'alignleft aligncenter alignright alignjustify | ' +
                    'bullist numlist outdent indent | forecolor backcolor | removeformat | help',
                content_style: 'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 14px }',
                setup(editor) {
                    moduleCaseDescriptionEditor = editor;
                    editor.on('init', () => {
                        try {
                            editor.setContent(el.value || '');
                        } catch (e) { /* ignore */ }
                    });
                    const sync = () => {
                        try { el.value = editor.getContent({ format: 'html' }) || ''; } catch (e) { /* ignore */ }
                    };
                    editor.on('change keyup paste blur setcontent', sync);
                    editor.on('remove', () => {
                        if (moduleCaseDescriptionEditor === editor) {
                            moduleCaseDescriptionEditor = null;
                        }
                    });
                },
            });
        };

        const syncModuleCaseDescriptionFromEditor = () => {
            const el = document.getElementById('module-add-case-description');
            if (!el) return '';
            try {
                if (typeof tinymce !== 'undefined' && tinymce.get && tinymce.get('module-add-case-description')) {
                    el.value = tinymce.get('module-add-case-description').getContent({ format: 'html' }) || '';
                }
            } catch (e) { /* ignore */ }
            return el.value || '';
        };

        const ensureViewScenarioInlineEditor = (modalEl) => {
            if (!modalEl) return null;
            let editor = modalEl.querySelector('#module-view-inline-comment-editor');
            if (editor) return editor;

            editor = document.createElement('div');
            editor.id = 'module-view-inline-comment-editor';
            editor.className = 'automation-form';
            editor.style.display = 'none';
            editor.style.marginTop = '10px';
            editor.innerHTML = `
                <form id="module-view-inline-comment-form" data-mode="" data-comment-id="" data-parent-id="">
                    <div class="form-row">
                        <label id="module-view-inline-editor-label" for="module-view-inline-comment-content">Edit Comment</label>
                        <textarea id="module-view-inline-comment-content" name="content" rows="6" class="tinymce-editor"></textarea>
                    </div>
                    <div class="form-actions">
                        <button type="button" class="btn-primary" data-action="submit-view-scenario-inline-comment" id="module-view-inline-submit-btn">Save</button>
                        <button type="button" class="btn-secondary" data-action="cancel-view-scenario-inline-comment" id="module-view-inline-cancel-btn">Cancel</button>
                    </div>
                </form>
            `;

            const commentsContainer = modalEl.querySelector('#module-view-scenario-comments');
            if (commentsContainer && commentsContainer.parentNode) {
                commentsContainer.parentNode.insertBefore(editor, commentsContainer.nextSibling);
            } else {
                modalEl.appendChild(editor);
            }

            return editor;
        };

        const initViewScenarioInlineCommentEditor = ({ modalEl, contentHtml }) => {
            const editorWrapper = ensureViewScenarioInlineEditor(modalEl);
            if (!editorWrapper) return;
            const textarea = editorWrapper.querySelector('#module-view-inline-comment-content');
            if (!textarea) return;

            removeViewScenarioInlineCommentEditor();
            editorWrapper.style.display = 'block';

            if (typeof tinymce === 'undefined') {
                textarea.value = contentHtml || '';
                return;
            }

            tinymce.init({
                target: textarea,
                height: 200,
                menubar: false,
                branding: false,
                plugins: [
                    'advlist', 'autolink', 'lists', 'link', 'charmap', 'preview',
                    'searchreplace', 'visualblocks', 'code', 'fullscreen',
                    'insertdatetime', 'table', 'help', 'wordcount'
                ],
                toolbar: 'undo redo | formatselect | bold italic underline strikethrough | ' +
                    'alignleft aligncenter alignright alignjustify | ' +
                    'bullist numlist outdent indent | forecolor backcolor | removeformat | help',
                content_style: 'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 14px }',
                setup(editor) {
                    viewScenarioInlineCommentEditor = editor;
                    editor.on('init', () => {
                        try { editor.setContent(contentHtml || ''); } catch (e) { /* ignore */ }
                        try { editor.focus(); } catch (e) { /* ignore */ }
                    });
                    editor.on('remove', () => {
                        if (viewScenarioInlineCommentEditor === editor) {
                            viewScenarioInlineCommentEditor = null;
                        }
                    });
                },
            });
        };

        const updateThumbsUpButtonIcon = (buttonEl, isActive, likesCount = null) => {
            if (!buttonEl) return;
            const iconEl = buttonEl.querySelector('[data-role="thumbs-up-icon"]');
            if (!iconEl) return;
            const countEl = buttonEl.querySelector('[data-role="thumbs-up-count"]');

            buttonEl.dataset.liked = isActive ? 'true' : 'false';
            buttonEl.setAttribute('aria-pressed', isActive ? 'true' : 'false');

            const existingCountRaw = buttonEl.dataset.likesCount;
            const existingCount = Number.isFinite(parseInt(existingCountRaw, 10)) ? parseInt(existingCountRaw, 10) : null;
            let displayCount = typeof likesCount === 'number' ? likesCount : existingCount;

            if (isActive) {
                if (displayCount === null) displayCount = 1;
                if (displayCount < 1) displayCount = 1;
            }

            if (displayCount !== null && Number.isFinite(displayCount)) {
                buttonEl.dataset.likesCount = String(displayCount);
            }

            if (isActive) {
                iconEl.style.filter = '';
                iconEl.style.opacity = '1';
            } else {
                iconEl.style.filter = 'grayscale(1)';
                iconEl.style.opacity = '0.45';
            }

            if (countEl) {
                if (isActive && displayCount !== null && displayCount > 0) {
                    countEl.textContent = String(displayCount);
                    countEl.style.display = '';
                    countEl.style.marginLeft = '4px';
                    countEl.style.fontWeight = '600';
                } else {
                    countEl.style.display = 'none';
                }
            }
        };

        let activeEmojiPicker = null;

        const openEmojiPickerPopover = (anchorEl, initialReaction = '😊') => {
            return new Promise((resolve) => {
                if (!anchorEl) return resolve(null);

                // Close any existing picker
                if (activeEmojiPicker && typeof activeEmojiPicker.close === 'function') {
                    activeEmojiPicker.close();
                }

                const EMOJI_CATEGORIES = [
                    { key: 'people', label: 'People', icon: '🙂' },
                    { key: 'nature', label: 'Nature', icon: '🌲' },
                    { key: 'food', label: 'Food', icon: '🍔' },
                    { key: 'activity', label: 'Activity', icon: '⚽' },
                    { key: 'objects', label: 'Objects', icon: '💡' },
                    { key: 'symbols', label: 'Symbols', icon: '❤️' },
                    { key: 'flags', label: 'Flags', icon: '🏳️' },
                ];

                const EMOJI_DATA = [
                    // People
                    { e: '😀', n: 'grinning face', c: 'people' },
                    { e: '😃', n: 'grinning face with big eyes', c: 'people' },
                    { e: '😄', n: 'grinning face with smiling eyes', c: 'people' },
                    { e: '😁', n: 'beaming face with smiling eyes', c: 'people' },
                    { e: '😆', n: 'grinning squinting face', c: 'people' },
                    { e: '😅', n: 'grinning face with sweat', c: 'people' },
                    { e: '😂', n: 'face with tears of joy', c: 'people' },
                    { e: '🤣', n: 'rolling on the floor laughing', c: 'people' },
                    { e: '😊', n: 'smiling face with smiling eyes', c: 'people' },
                    { e: '🙂', n: 'slightly smiling face', c: 'people' },
                    { e: '😉', n: 'winking face', c: 'people' },
                    { e: '😍', n: 'smiling face with heart-eyes', c: 'people' },
                    { e: '😘', n: 'face blowing a kiss', c: 'people' },
                    { e: '😎', n: 'smiling face with sunglasses', c: 'people' },
                    { e: '🤔', n: 'thinking face', c: 'people' },
                    { e: '😮', n: 'face with open mouth', c: 'people' },
                    { e: '😢', n: 'crying face', c: 'people' },
                    { e: '😭', n: 'loudly crying face', c: 'people' },
                    { e: '😡', n: 'pouting face', c: 'people' },
                    { e: '👍', n: 'thumbs up', c: 'people' },
                    { e: '👎', n: 'thumbs down', c: 'people' },
                    { e: '👏', n: 'clapping hands', c: 'people' },
                    { e: '🙏', n: 'folded hands', c: 'people' },
                    { e: '👋', n: 'waving hand', c: 'people' },
                    { e: '🔥', n: 'fire', c: 'people' },

                    // Nature
                    { e: '🌲', n: 'tree', c: 'nature' },
                    { e: '🌿', n: 'herb', c: 'nature' },
                    { e: '🌸', n: 'cherry blossom', c: 'nature' },
                    { e: '🌼', n: 'blossom', c: 'nature' },
                    { e: '🌞', n: 'sun with face', c: 'nature' },
                    { e: '🌧️', n: 'cloud with rain', c: 'nature' },
                    { e: '🌈', n: 'rainbow', c: 'nature' },

                    // Food
                    { e: '🍔', n: 'hamburger', c: 'food' },
                    { e: '🍕', n: 'pizza', c: 'food' },
                    { e: '🍟', n: 'french fries', c: 'food' },
                    { e: '🍜', n: 'steaming bowl', c: 'food' },
                    { e: '🍣', n: 'sushi', c: 'food' },
                    { e: '☕', n: 'hot beverage', c: 'food' },

                    // Activity
                    { e: '⚽', n: 'soccer ball', c: 'activity' },
                    { e: '🏀', n: 'basketball', c: 'activity' },
                    { e: '🎾', n: 'tennis', c: 'activity' },
                    { e: '🎮', n: 'video game', c: 'activity' },
                    { e: '🎉', n: 'party popper', c: 'activity' },

                    // Objects
                    { e: '💡', n: 'light bulb', c: 'objects' },
                    { e: '🖥️', n: 'desktop computer', c: 'objects' },
                    { e: '📌', n: 'pushpin', c: 'objects' },
                    { e: '📎', n: 'paperclip', c: 'objects' },
                    { e: '🛠️', n: 'hammer and wrench', c: 'objects' },

                    // Symbols
                    { e: '❤️', n: 'red heart', c: 'symbols' },
                    { e: '✅', n: 'check mark button', c: 'symbols' },
                    { e: '❌', n: 'cross mark', c: 'symbols' },
                    { e: '⭐', n: 'star', c: 'symbols' },
                    { e: '🚀', n: 'rocket', c: 'symbols' },

                    // Flags
                    { e: '🏳️', n: 'white flag', c: 'flags' },
                    { e: '🏁', n: 'chequered flag', c: 'flags' },
                ];

                const modalRoot = anchorEl.closest('[data-role="module-add-scenario-modal"]') || document.body;
                const pop = document.createElement('div');
                pop.setAttribute('role', 'dialog');
                pop.setAttribute('aria-label', 'Emoji picker');
                pop.style.position = 'absolute';
                pop.style.zIndex = '9999';
                pop.style.background = '#fff';
                pop.style.border = '1px solid rgba(0,0,0,0.12)';
                pop.style.borderRadius = '10px';
                pop.style.boxShadow = 'var(--automation-shadow, 0 10px 24px -12px rgba(0,0,0,0.25))';
                pop.style.width = '320px';
                pop.style.maxWidth = 'calc(100vw - 24px)';
                pop.style.maxHeight = '360px';
                pop.style.overflow = 'hidden';

                const header = document.createElement('div');
                header.style.padding = '10px';
                header.style.borderBottom = '1px solid rgba(0,0,0,0.08)';
                header.style.display = 'grid';
                header.style.gap = '8px';

                const search = document.createElement('input');
                search.type = 'search';
                search.placeholder = 'Search...';
                search.value = '';
                search.style.width = '100%';
                search.style.padding = '8px 10px';
                search.style.borderRadius = '8px';
                search.style.border = '1px solid rgba(0,0,0,0.18)';

                const cats = document.createElement('div');
                cats.style.display = 'flex';
                cats.style.alignItems = 'center';
                cats.style.gap = '6px';
                cats.style.overflowX = 'auto';
                cats.style.paddingBottom = '2px';

                const bodyEl = document.createElement('div');
                bodyEl.style.padding = '10px';
                bodyEl.style.overflow = 'auto';
                bodyEl.style.maxHeight = '290px';

                const grid = document.createElement('div');
                grid.style.display = 'grid';
                grid.style.gridTemplateColumns = 'repeat(8, 1fr)';
                grid.style.gap = '6px';

                let activeCategory = 'people';

                const renderGrid = () => {
                    const q = (search.value || '').trim().toLowerCase();
                    grid.innerHTML = '';

                    const filtered = EMOJI_DATA.filter((item) => {
                        if (activeCategory && item.c !== activeCategory) return false;
                        if (!q) return true;
                        return item.n.includes(q) || item.e.includes(q);
                    });

                    filtered.forEach((item) => {
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.textContent = item.e;
                        btn.title = item.n;
                        btn.style.border = 'none';
                        btn.style.background = 'transparent';
                        btn.style.cursor = 'pointer';
                        btn.style.fontSize = '20px';
                        btn.style.lineHeight = '1';
                        btn.style.padding = '6px';
                        btn.style.borderRadius = '8px';
                        btn.addEventListener('mouseenter', () => {
                            btn.style.background = 'rgba(0,0,0,0.06)';
                        });
                        btn.addEventListener('mouseleave', () => {
                            btn.style.background = 'transparent';
                        });
                        btn.addEventListener('click', () => {
                            close(item.e);
                        });
                        grid.appendChild(btn);
                    });
                };

                const setActiveCategory = (catKey) => {
                    activeCategory = catKey;
                    Array.from(cats.querySelectorAll('button[data-cat]')).forEach((b) => {
                        const isActive = b.getAttribute('data-cat') === catKey;
                        b.style.opacity = isActive ? '1' : '0.55';
                        b.style.background = isActive ? 'rgba(0,0,0,0.06)' : 'transparent';
                    });
                    renderGrid();
                };

                EMOJI_CATEGORIES.forEach((cat) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.setAttribute('data-cat', cat.key);
                    btn.title = cat.label;
                    btn.textContent = cat.icon;
                    btn.style.border = 'none';
                    btn.style.background = 'transparent';
                    btn.style.cursor = 'pointer';
                    btn.style.padding = '6px';
                    btn.style.borderRadius = '8px';
                    btn.style.fontSize = '18px';
                    btn.style.opacity = cat.key === activeCategory ? '1' : '0.55';
                    btn.addEventListener('click', () => setActiveCategory(cat.key));
                    cats.appendChild(btn);
                });

                header.appendChild(search);
                header.appendChild(cats);
                bodyEl.appendChild(grid);
                pop.appendChild(header);
                pop.appendChild(bodyEl);

                const close = (value = null) => {
                    cleanup();
                    resolve(value);
                };

                const onDocMouseDown = (ev) => {
                    const t = ev.target;
                    if (!t) return;
                    if (pop.contains(t) || anchorEl.contains(t)) return;
                    close(null);
                };

                const onDocKeyDown = (ev) => {
                    if (ev.key === 'Escape') {
                        ev.preventDefault();
                        close(null);
                    }
                };

                const cleanup = () => {
                    document.removeEventListener('mousedown', onDocMouseDown, true);
                    document.removeEventListener('keydown', onDocKeyDown, true);
                    if (pop && pop.parentNode) pop.parentNode.removeChild(pop);
                    activeEmojiPicker = null;
                };

                // Position
                modalRoot.appendChild(pop);
                const r = anchorEl.getBoundingClientRect();
                const rootR = modalRoot === document.body ? { left: 0, top: 0 } : modalRoot.getBoundingClientRect();
                const left = Math.min(Math.max(8, r.left - rootR.left), (window.innerWidth - 340));
                const top = Math.max(8, r.bottom - rootR.top + 8);
                pop.style.left = `${left}px`;
                pop.style.top = `${top}px`;

                activeEmojiPicker = { close };
                document.addEventListener('mousedown', onDocMouseDown, true);
                document.addEventListener('keydown', onDocKeyDown, true);

                // initial render
                renderGrid();
                setActiveCategory('people');
                try {
                    void initialReaction;
                } catch (e) { /* ignore */ }

                // focus search
                setTimeout(() => {
                    try { search.focus(); } catch (_) { }
                }, 0);
            });
        };

        // Scenario Comments Modal (shared with Projects > Scenarios)
        const getScenarioCommentsCurrentUserId = () => {
            try {
                const el = document.getElementById('automation-app') || document.getElementById('data-management-app');
                const raw = el && el.dataset ? el.dataset.currentUserId : null;
                if (!raw || raw === 'null') return null;
                const id = parseInt(raw, 10);
                return Number.isFinite(id) ? id : null;
            } catch (e) {
                return null;
            }
        };

        const loadCommentsForScenarioCommentsModal = async (scenarioId) => {
            const modal = document.querySelector('[data-role="scenario-comments-modal"]');
            const commentsList = document.getElementById('comments-list');
            if (!modal || !commentsList) return;

            if (!scenarioId && scenarioId !== 0) {
                commentsList.innerHTML = '<div class="comment-empty">No scenario selected.</div>';
                return;
            }

            commentsList.innerHTML = '<div class="comment-empty">Loading comments…</div>';
            const currentUserId = getScenarioCommentsCurrentUserId();

            try {
                const url = `/api/core/scenario-comments/?scenario=${encodeURIComponent(String(scenarioId))}`;
                const comments = await request(url, { method: 'GET' });
                const list = Array.isArray(comments) ? comments : [];

                const renderComment = (comment, isReply = false) => {
                    if (!comment) return '';

                    const canEdit = currentUserId && Number(comment.user) === Number(currentUserId);
                    const editBtn = canEdit ? `
                        <button type="button" class="comment-action-btn" data-action="edit-comment" data-comment-id="${escapeHtml(comment.id || '')}" title="Edit">
                            <span>✏️</span>
                        </button>` : '';
                    const deleteBtn = canEdit ? `
                        <button type="button" class="comment-action-btn" data-action="delete-comment" data-comment-id="${escapeHtml(comment.id || '')}" title="Delete">
                            <span>🗑️</span>
                        </button>` : '';

                    const isLiked = !!comment.user_has_liked;
                    const likesCount = typeof comment.likes_count === 'number' ? comment.likes_count : 0;
                    const thumbsUpIconStyle = isLiked ? '' : 'filter: grayscale(1); opacity: 0.45;';
                    const thumbsUpCountStyle = (isLiked && likesCount > 0) ? 'margin-left: 4px; font-weight: 600;' : 'display: none;';

                    const userReaction = (comment.user_reaction || '').trim();
                    const reactionsSummary = Array.isArray(comment.reactions_summary) ? comment.reactions_summary : [];
                    const reactionsSummaryText = reactionsSummary
                        .filter((x) => x && x.reaction && typeof x.count === 'number' && x.count > 0)
                        .map((x) => `${x.reaction} ${x.count}`)
                        .join(' ');
                    const reactionDisplayText = reactionsSummaryText || '😊';

                    const repliesHtml = (!isReply && Array.isArray(comment.replies) && comment.replies.length > 0)
                        ? `<div class="comment-replies">${comment.replies.map((reply) => renderComment(reply, true)).join('')}</div>`
                        : '';

                    const rawHtml = normalizeCommentHtmlForDisplay(comment.content || '');

                    return `
                        <div class="comment-item ${isReply ? 'comment-reply' : ''}" data-comment-id="${escapeHtml(comment.id || '')}" data-comment-user="${escapeHtml(comment.user || '')}">
                            <div class="comment-header">
                                <span class="comment-author">${escapeHtml(comment.user_name || comment.user_email || 'Unknown')}${comment.is_edited ? ' (edited)' : ''}</span>
                                <span class="comment-date">${escapeHtml(formatDateTime(comment.created_at || null))}</span>
                            </div>
                            <div class="comment-content" data-comment-content>${rawHtml || ''}</div>
                            <div class="comment-actions">
                                ${!isReply ? `<button type="button" class="comment-action-btn" data-action="reply-comment" data-comment-id="${escapeHtml(comment.id || '')}" title="Reply"><span>↩️</span></button>` : ''}
                                <button type="button" class="comment-action-btn" data-action="thumbs-up-comment" data-comment-id="${escapeHtml(comment.id || '')}" data-liked="${isLiked ? 'true' : 'false'}" data-likes-count="${escapeHtml(String(likesCount))}" aria-pressed="${isLiked ? 'true' : 'false'}" title="Thumbs Up">
                                    <span data-role="thumbs-up-icon" style="${thumbsUpIconStyle}">👍</span>
                                    <span data-role="thumbs-up-count" style="${thumbsUpCountStyle}">${escapeHtml(String(likesCount))}</span>
                                </button>
                                <button type="button" class="comment-action-btn" data-action="add-reaction-comment" data-comment-id="${escapeHtml(comment.id || '')}" data-user-reaction="${escapeHtml(userReaction)}" title="Add Reaction">
                                    <span data-role="reaction-display">${escapeHtml(reactionDisplayText)}</span>
                                </button>
                                ${editBtn}
                                ${deleteBtn}
                            </div>
                            ${repliesHtml}
                        </div>
                    `;
                };

                commentsList.innerHTML = list.length
                    ? list.map((c) => renderComment(c, false)).join('')
                    : '<div class="comment-empty">No comments yet. Be the first to comment!</div>';
            } catch (e) {
                commentsList.innerHTML = '<div class="comment-empty">Failed to load comments.</div>';
            }
        };

        const closeScenarioCommentsModal = () => {
            const modal = document.querySelector('[data-role="scenario-comments-modal"]');
            if (modal) {
                modal.hidden = true;
                body.classList.remove('automation-modal-open');
            }
            try {
                if (typeof tinymce !== 'undefined') {
                    tinymce.remove('#comment-content');
                    tinymce.remove('#inline-comment-content');
                }
            } catch (e) { /* ignore */ }

            try {
                const addForm = document.getElementById('add-comment-form');
                if (addForm) addForm.style.display = 'none';
                const inlineEditor = document.getElementById('inline-comment-editor');
                if (inlineEditor) inlineEditor.style.display = 'none';
            } catch (e) { /* ignore */ }
        };

        const openScenarioCommentsModal = async (scenarioId) => {
            const modal = document.querySelector('[data-role="scenario-comments-modal"]');
            if (!modal) return;

            const scenarioIdInput = document.getElementById('comment-scenario-id');
            const addForm = document.getElementById('add-comment-form');
            const inlineEditor = document.getElementById('inline-comment-editor');
            const commentContent = document.getElementById('comment-content');

            if (scenarioIdInput) scenarioIdInput.value = String(scenarioId || '');
            if (addForm) addForm.style.display = 'none';
            if (inlineEditor) inlineEditor.style.display = 'none';
            if (commentContent) commentContent.value = '';

            await loadCommentsForScenarioCommentsModal(scenarioId);

            modal.hidden = false;
            body.classList.add('automation-modal-open');
        };

        const initScenarioCommentsInlineEditor = (mode, commentId, content = '', parentCommentId = null) => {
            const inlineEditor = document.getElementById('inline-comment-editor');
            const inlineForm = document.getElementById('inline-comment-form');
            const inlineLabel = document.getElementById('inline-editor-label');
            const inlineSubmitBtn = document.getElementById('inline-submit-btn');
            if (!inlineEditor || !inlineForm) return;

            inlineEditor.style.display = 'none';
            try {
                if (typeof tinymce !== 'undefined') {
                    tinymce.remove('#inline-comment-content');
                }
            } catch (e) { /* ignore */ }

            inlineForm.setAttribute('data-mode', mode);
            inlineForm.setAttribute('data-comment-id', commentId || '');
            inlineForm.setAttribute('data-parent-id', parentCommentId || '');

            if (mode === 'edit') {
                if (inlineLabel) inlineLabel.textContent = 'Edit Comment';
                if (inlineSubmitBtn) inlineSubmitBtn.textContent = 'Update Comment';
            } else if (mode === 'reply') {
                if (inlineLabel) inlineLabel.textContent = 'Reply to Comment';
                if (inlineSubmitBtn) inlineSubmitBtn.textContent = 'Post Reply';
            }

            const anchorId = commentId || parentCommentId;
            const commentItem = anchorId ? document.querySelector(`[data-comment-id="${(typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(String(anchorId)) : String(anchorId)}"]`) : null;
            if (commentItem) {
                const actionsDiv = commentItem.querySelector('.comment-actions');
                if (actionsDiv) {
                    actionsDiv.after(inlineEditor);
                }
            }

            inlineEditor.style.display = 'block';
            const textarea = document.getElementById('inline-comment-content');

            if (typeof tinymce !== 'undefined') {
                tinymce.init({
                    selector: '#inline-comment-content',
                    height: 200,
                    menubar: false,
                    branding: false,
                    plugins: [
                        'advlist', 'autolink', 'lists', 'link', 'charmap', 'preview',
                        'searchreplace', 'visualblocks', 'code', 'fullscreen',
                        'insertdatetime', 'table', 'help', 'wordcount'
                    ],
                    toolbar: 'undo redo | formatselect | bold italic underline strikethrough | ' +
                        'alignleft aligncenter alignright alignjustify | ' +
                        'bullist numlist outdent indent | forecolor backcolor | removeformat | help',
                    content_style: 'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 14px }',
                    init_instance_callback(editor) {
                        try { editor.setContent(content || ''); } catch (e) { /* ignore */ }
                        try { editor.focus(); } catch (e) { /* ignore */ }
                    },
                });
            } else if (textarea) {
                textarea.value = content || '';
            }
        };

        // Open the shared Scenario Comments modal from View Scenario (Modules page)
        document.addEventListener('click', async (ev) => {
            const btn = ev && ev.target && ev.target.closest ? ev.target.closest('[data-action="open-scenario-comments-modal"]') : null;
            if (!btn) return;
            if (state.moduleScenarioModalMode !== 'view') return;
            if (!state.moduleScenarioCurrentId) return;
            ev.preventDefault();
            await openScenarioCommentsModal(state.moduleScenarioCurrentId);
        });

        // Scenario Comments modal UI events
        document.addEventListener('click', async (ev) => {
            const target = ev && ev.target && ev.target.closest ? ev.target.closest('[data-action],#add-comment-btn,#cancel-add-comment,#cancel-inline-comment') : null;
            if (!target) return;

            const modalRoot = target.closest('[data-role="scenario-comments-modal"]');
            if (!modalRoot) return;

            // Close
            if (target.matches('[data-action="close-scenario-comments-modal"]')) {
                ev.preventDefault();
                closeScenarioCommentsModal();
                return;
            }

            // Show add form
            if (target.id === 'add-comment-btn') {
                ev.preventDefault();
                const addForm = document.getElementById('add-comment-form');
                const inlineEditor = document.getElementById('inline-comment-editor');
                if (inlineEditor) inlineEditor.style.display = 'none';
                if (addForm) addForm.style.display = 'block';

                try {
                    if (typeof tinymce !== 'undefined') {
                        tinymce.remove('#comment-content');
                        tinymce.init({
                            selector: '#comment-content',
                            height: 220,
                            menubar: false,
                            branding: false,
                            plugins: [
                                'advlist', 'autolink', 'lists', 'link', 'charmap', 'preview',
                                'searchreplace', 'visualblocks', 'code', 'fullscreen',
                                'insertdatetime', 'table', 'help', 'wordcount'
                            ],
                            toolbar: 'undo redo | formatselect | bold italic underline strikethrough | ' +
                                'alignleft aligncenter alignright alignjustify | ' +
                                'bullist numlist outdent indent | forecolor backcolor | removeformat | help',
                            content_style: 'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 14px }',
                        });
                    }
                } catch (e) { /* ignore */ }
                return;
            }

            // Cancel add
            if (target.id === 'cancel-add-comment') {
                ev.preventDefault();
                const addForm = document.getElementById('add-comment-form');
                if (addForm) addForm.style.display = 'none';
                try {
                    if (typeof tinymce !== 'undefined') {
                        tinymce.remove('#comment-content');
                    }
                } catch (e) { /* ignore */ }
                return;
            }

            // Cancel inline
            if (target.id === 'cancel-inline-comment') {
                ev.preventDefault();
                const inlineEditor = document.getElementById('inline-comment-editor');
                if (inlineEditor) inlineEditor.style.display = 'none';
                try {
                    if (typeof tinymce !== 'undefined') {
                        tinymce.remove('#inline-comment-content');
                    }
                } catch (e) { /* ignore */ }
                return;
            }

            const action = target.dataset.action;
            const commentId = target.dataset.commentId;
            const scenarioIdInput = document.getElementById('comment-scenario-id');
            const scenarioId = scenarioIdInput ? scenarioIdInput.value : null;

            if (action === 'edit-comment' && commentId) {
                ev.preventDefault();
                const commentItem = document.querySelector(`[data-comment-id="${(typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(String(commentId)) : String(commentId)}"]`);
                const contentDiv = commentItem ? commentItem.querySelector('[data-comment-content]') : null;
                const currentContent = contentDiv ? (contentDiv.innerHTML || '') : '';
                initScenarioCommentsInlineEditor('edit', String(commentId), currentContent);
                return;
            }

            if (action === 'reply-comment' && commentId) {
                ev.preventDefault();
                initScenarioCommentsInlineEditor('reply', null, '', String(commentId));
                return;
            }

            if (action === 'delete-comment' && commentId) {
                ev.preventDefault();
                try {
                    if (!window.confirm('Are you sure you want to delete this comment?')) return;
                } catch (e) { /* ignore */ }

                try {
                    await request(`/api/core/scenario-comments/${encodeURIComponent(String(commentId))}/`, { method: 'DELETE' });
                    showToast('Comment deleted.', 'success');
                    if (scenarioId) await loadCommentsForScenarioCommentsModal(scenarioId);
                } catch (e) {
                    showToast(e instanceof Error ? e.message : 'Failed to delete comment.', 'error');
                }
                return;
            }

            if (action === 'thumbs-up-comment' && commentId) {
                ev.preventDefault();

                const wasLiked = target.dataset.liked === 'true';
                const wasLikesCountRaw = target.dataset.likesCount;
                const wasLikesCount = Number.isFinite(parseInt(wasLikesCountRaw, 10)) ? parseInt(wasLikesCountRaw, 10) : 0;
                const optimisticLiked = !wasLiked;
                const optimisticCount = optimisticLiked ? Math.max(1, wasLikesCount + 1) : Math.max(0, wasLikesCount - 1);
                updateThumbsUpButtonIcon(target, optimisticLiked, optimisticCount);

                try {
                    target.disabled = true;
                    const data = await request(`/api/core/scenario-comments/${encodeURIComponent(String(commentId))}/toggle_like/`, { method: 'POST' });
                    updateThumbsUpButtonIcon(target, !!(data && data.liked), data && typeof data.likes_count === 'number' ? data.likes_count : null);
                } catch (e) {
                    updateThumbsUpButtonIcon(target, wasLiked, wasLikesCount);
                    showToast(e instanceof Error ? e.message : 'Failed to toggle thumbs up.', 'error');
                } finally {
                    target.disabled = false;
                }
                return;
            }

            if (action === 'add-reaction-comment' && commentId) {
                ev.preventDefault();
                const current = (target.dataset.userReaction || '').trim() || '😊';
                const reaction = await openEmojiPickerPopover(target, current);
                if (!reaction) return;
                try {
                    target.disabled = true;
                    const data = await request(`/api/core/scenario-comments/${encodeURIComponent(String(commentId))}/set_reaction/`, {
                        method: 'POST',
                        body: JSON.stringify({ reaction }),
                    });

                    const displayEl = target.querySelector('[data-role="reaction-display"]');
                    const nextUserReaction = data && data.reacted ? (data.reaction || reaction) : '';
                    target.dataset.userReaction = nextUserReaction;
                    if (displayEl) {
                        const summary = (data && Array.isArray(data.reactions_summary)) ? data.reactions_summary : [];
                        const summaryText = summary
                            .filter((x) => x && x.reaction && typeof x.count === 'number' && x.count > 0)
                            .map((x) => `${x.reaction} ${x.count}`)
                            .join(' ');
                        displayEl.textContent = summaryText || '😊';
                    }
                    showToast(data && data.reacted ? 'Reaction saved.' : 'Reaction removed.', 'success');
                } catch (e) {
                    showToast(e instanceof Error ? e.message : 'Failed to add reaction.', 'error');
                } finally {
                    target.disabled = false;
                }
                return;
            }
        });

        document.addEventListener('submit', async (ev) => {
            const form = ev && ev.target ? ev.target : null;
            if (!form) return;

            const modalRoot = form.closest && form.closest('[data-role="scenario-comments-modal"]');
            if (!modalRoot) return;

            if (form.id === 'add-comment-form') {
                ev.preventDefault();
                const scenarioIdInput = document.getElementById('comment-scenario-id');
                const scenarioId = scenarioIdInput ? scenarioIdInput.value : null;
                if (!scenarioId) return;

                let content = '';
                try {
                    if (typeof tinymce !== 'undefined' && tinymce.get) {
                        const ed = tinymce.get('comment-content');
                        if (ed) content = ed.getContent({ format: 'html' }) || '';
                    }
                } catch (e) { /* ignore */ }
                if (!content) {
                    const textarea = document.getElementById('comment-content');
                    content = textarea ? (textarea.value || '').trim() : '';
                }
                if (!content) {
                    showToast('Please enter a comment.', 'error');
                    return;
                }

                try {
                    await request('/api/core/scenario-comments/', {
                        method: 'POST',
                        body: JSON.stringify({ scenario: scenarioId, content }),
                    });
                    showToast('Comment posted.', 'success');
                    const addForm = document.getElementById('add-comment-form');
                    if (addForm) addForm.style.display = 'none';
                    try {
                        if (typeof tinymce !== 'undefined') {
                            tinymce.remove('#comment-content');
                        }
                    } catch (e) { /* ignore */ }
                    await loadCommentsForScenarioCommentsModal(scenarioId);
                } catch (e) {
                    showToast(e instanceof Error ? e.message : 'Failed to post comment.', 'error');
                }
                return;
            }

            if (form.id === 'inline-comment-form') {
                ev.preventDefault();
                const scenarioIdInput = document.getElementById('comment-scenario-id');
                const scenarioId = scenarioIdInput ? scenarioIdInput.value : null;
                if (!scenarioId) return;

                const mode = form.getAttribute('data-mode') || '';
                const editId = form.getAttribute('data-comment-id') || '';
                const parentId = form.getAttribute('data-parent-id') || '';

                let content = '';
                try {
                    if (typeof tinymce !== 'undefined' && tinymce.get) {
                        const ed = tinymce.get('inline-comment-content');
                        if (ed) content = ed.getContent({ format: 'html' }) || '';
                    }
                } catch (e) { /* ignore */ }
                if (!content) {
                    const textarea = document.getElementById('inline-comment-content');
                    content = textarea ? (textarea.value || '').trim() : '';
                }
                if (!content) {
                    showToast('Please enter a comment.', 'error');
                    return;
                }

                try {
                    if (mode === 'edit') {
                        if (!editId) return;
                        await request(`/api/core/scenario-comments/${encodeURIComponent(String(editId))}/`, {
                            method: 'PATCH',
                            body: JSON.stringify({ content }),
                        });
                        showToast('Comment updated.', 'success');
                    } else if (mode === 'reply') {
                        if (!parentId) return;
                        await request('/api/core/scenario-comments/', {
                            method: 'POST',
                            body: JSON.stringify({ scenario: scenarioId, content, parent: parentId }),
                        });
                        showToast('Reply posted.', 'success');
                    } else {
                        return;
                    }

                    const inlineEditor = document.getElementById('inline-comment-editor');
                    if (inlineEditor) inlineEditor.style.display = 'none';
                    try {
                        if (typeof tinymce !== 'undefined') {
                            tinymce.remove('#inline-comment-content');
                        }
                    } catch (e) { /* ignore */ }

                    await loadCommentsForScenarioCommentsModal(scenarioId);
                } catch (e) {
                    showToast(e instanceof Error ? e.message : 'Failed to save comment.', 'error');
                }
            }
        });

        const normalizeCommentHtmlForDisplay = (value) => {
            if (!value) return '';
            try {
                const html = String(value);
                if (typeof document === 'undefined' || !document.createElement) return html;

                const wrapper = document.createElement('div');
                wrapper.innerHTML = html;

                const isEmptyBlock = (el) => {
                    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
                    const tag = (el.tagName || '').toUpperCase();
                    if (!['P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE'].includes(tag)) return false;

                    // Consider a block empty if it contains only whitespace, NBSPs, and/or <br>.
                    const clone = el.cloneNode(true);
                    try {
                        Array.from(clone.querySelectorAll('br')).forEach((br) => br.parentNode && br.parentNode.removeChild(br));
                    } catch (e) { /* ignore */ }
                    const hasRichChildren = !!(clone.querySelector && clone.querySelector('img,video,iframe,table,ul,ol'));
                    if (hasRichChildren) return false;
                    const text = (clone.textContent || '').replace(/\u00A0/g, ' ').trim();
                    return !text;
                };

                Array.from(wrapper.querySelectorAll('p,div,section,article,blockquote')).forEach((el) => {
                    if (isEmptyBlock(el)) {
                        try { el.parentNode && el.parentNode.removeChild(el); } catch (e) { /* ignore */ }
                    }
                });

                return wrapper.innerHTML;
            } catch (e) {
                return String(value);
            }
        };

        const renderCommentPlainHtml = (rawHtml) => {
            try {
                const plain = htmlToFormattedText(rawHtml || '');
                return escapeHtml(plain).replace(/\n/g, '<br>');
            } catch (e) {
                try {
                    return escapeHtml(String(rawHtml || '')).replace(/\n/g, '<br>');
                } catch (err) {
                    return '';
                }
            }
        };

        const loadScenarioCommentsForViewModal = async (scenarioId) => {
            const modal = document.querySelector('[data-role="module-add-scenario-modal"]');
            if (!modal) return;
            const row = modal.querySelector('#module-view-scenario-comments-row');
            const container = modal.querySelector('#module-view-scenario-comments');
            if (!row || !container) return;

            if (!scenarioId) {
                row.hidden = true;
                container.innerHTML = '';
                return;
            }

            row.hidden = false;
            container.innerHTML = '<div class="comment-empty">Loading comments…</div>';

            try {
                const url = `/api/core/scenario-comments/?scenario=${encodeURIComponent(String(scenarioId))}`;
                const comments = await request(url, { method: 'GET' });
                const list = Array.isArray(comments) ? comments : [];
                if (!list.length) {
                    container.innerHTML = '<div class="comment-empty">No comments yet.</div>';
                    return;
                }

                const currentUserId = (() => {
                    try {
                        const el = document.getElementById('automation-app') || document.getElementById('data-management-app');
                        const raw = el && el.dataset ? el.dataset.currentUserId : null;
                        if (!raw || raw === 'null') return null;
                        const id = parseInt(raw, 10);
                        return Number.isFinite(id) ? id : null;
                    } catch (e) {
                        return null;
                    }
                })();

                const getAttachmentExt = (name) => {
                    try {
                        const n = String(name || '');
                        const idx = n.lastIndexOf('.');
                        if (idx === -1) return '';
                        return n.slice(idx + 1).toLowerCase();
                    } catch (e) { return ''; }
                };

                const isImageAttachment = (att) => {
                    const ct = (att && att.content_type) ? String(att.content_type).toLowerCase() : '';
                    if (ct.startsWith('image/')) return true;
                    const ext = getAttachmentExt(att && att.original_name);
                    return ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);
                };

                const isVideoAttachment = (att) => {
                    const ct = (att && att.content_type) ? String(att.content_type).toLowerCase() : '';
                    if (ct.startsWith('video/')) return true;
                    const ext = getAttachmentExt(att && att.original_name);
                    return ['mp4', 'webm', 'mov'].includes(ext);
                };

                const attachmentTypeLabel = (att) => {
                    const ext = getAttachmentExt(att && att.original_name);
                    if (!ext) return 'FILE';
                    return String(ext).toUpperCase();
                };

                const attachmentStorageTag = (att) => {
                    if (!att) return '';
                    const raw = (att.storage_backend || att.storage || '').toString().toLowerCase();
                    if (raw === 's3') return 'S3';
                    if (raw === 'local') return 'Local';
                    if (raw) return raw.toUpperCase();
                    return '';
                };

                const renderComment = (comment, isReply = false) => {
                    if (!comment) return '';

                    const canEdit = currentUserId && Number(comment.user) === Number(currentUserId);
                    const editBtnDisabledAttr = canEdit ? '' : 'disabled aria-disabled="true"';
                    const deleteBtnDisabledAttr = canEdit ? '' : 'disabled aria-disabled="true"';
                    const editBtn = `
                        <button type="button" class="comment-action-btn" data-action="view-scenario-edit-comment" data-comment-id="${escapeHtml(comment.id || '')}" title="Edit" ${editBtnDisabledAttr}>
                            <span>✏️</span>
                        </button>`;
                    const deleteBtn = `
                        <button type="button" class="comment-action-btn" data-action="view-scenario-delete-comment" data-comment-id="${escapeHtml(comment.id || '')}" title="Delete" ${deleteBtnDisabledAttr}>
                            <span>🗑️</span>
                        </button>`;

                    const attachBtn = `
                        <button type="button" class="comment-action-btn" data-action="view-scenario-attach-comment" data-comment-id="${escapeHtml(comment.id || '')}" title="Attach file">
                            <span>📎</span>
                        </button>`;

                    const isLiked = !!comment.user_has_liked;
                    const likesCount = typeof comment.likes_count === 'number' ? comment.likes_count : 0;
                    const thumbsUpIconStyle = isLiked ? '' : 'filter: grayscale(1); opacity: 0.45;';
                    const thumbsUpCountStyle = (isLiked && likesCount > 0) ? 'margin-left: 4px; font-weight: 600;' : 'display: none;';

                    const userReaction = (comment.user_reaction || '').trim();
                    const reactionsSummary = Array.isArray(comment.reactions_summary) ? comment.reactions_summary : [];
                    const reactionsSummaryText = reactionsSummary
                        .filter((x) => x && x.reaction && typeof x.count === 'number' && x.count > 0)
                        .map((x) => `${x.reaction} ${x.count}`)
                        .join(' ');
                    const reactionDisplayText = reactionsSummaryText || '😊';

                    const repliesHtml = (!isReply && Array.isArray(comment.replies) && comment.replies.length > 0)
                        ? `<div class="comment-replies">${comment.replies.map((reply) => renderComment(reply, true)).join('')}</div>`
                        : '';

                    const rawCommentHtml = normalizeCommentHtmlForDisplay(comment.content || '');
                    const commentDisplayHtml = renderCommentPlainHtml(rawCommentHtml);

                    const atts = Array.isArray(comment.attachments) ? comment.attachments : [];
                    const images = atts.filter((a) => a && a.url && isImageAttachment(a));
                    const videos = atts.filter((a) => a && a.url && isVideoAttachment(a));
                    const docs = atts.filter((a) => {
                        if (!a || !a.url) return false;
                        return !(isImageAttachment(a) || isVideoAttachment(a));
                    });

                    const imagesHtml = images.length
                        ? `<div class="tc-attachments-grid" style="margin-top: 10px;">${images.map((a) => {
                            const url = String(a.url || '');
                            const name = String(a.original_name || 'Attachment');
                            const storageTag = attachmentStorageTag(a);
                            const title = storageTag ? `${name} (${storageTag})` : name;
                            return `
                                <a class="tc-attachment-tile" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="${escapeHtml(title)}">
                                    <img class="tc-attachment-thumb" src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy">
                                </a>
                            `;
                        }).join('')}</div>`
                        : '';

                    const videosHtml = videos.length
                        ? `<div style="margin-top: 10px;">${videos.map((a) => {
                            const url = String(a.url || '');
                            const name = String(a.original_name || 'Attachment');
                            const storageTag = attachmentStorageTag(a);
                            return `
                                <div style="margin-bottom: 10px;">
                                    <div style="margin-bottom: 6px;">
                                        <a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(name)}</a>
                                        ${storageTag ? `<span style="margin-left: 8px; font-weight: 700;">(${escapeHtml(storageTag)})</span>` : ''}
                                    </div>
                                    <video controls style="max-width: 100%;" src="${escapeHtml(url)}"></video>
                                </div>
                            `;
                        }).join('')}</div>`
                        : '';

                    const docsHtml = docs.length
                        ? `<div style="margin-top: 10px;">${docs.map((a) => {
                            const url = String(a.url || '');
                            const name = String(a.original_name || 'Attachment');
                            const label = attachmentTypeLabel(a);
                            const storageTag = attachmentStorageTag(a);
                            return `
                                <div style="margin-bottom: 6px;">
                                    <span style="display:inline-block; min-width: 52px; font-weight: 700;">${escapeHtml(label)}</span>
                                    <a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(name)}</a>
                                    ${storageTag ? `<span style="margin-left: 8px; font-weight: 700;">(${escapeHtml(storageTag)})</span>` : ''}
                                </div>
                            `;
                        }).join('')}</div>`
                        : '';

                    const attachmentsBlock = (atts.length)
                        ? `
                            <div class="automation-section-separator" aria-hidden="true" style="margin: 10px 0 8px;"></div>
                            <div>${imagesHtml}${videosHtml}${docsHtml}</div>
                        `
                        : '';

                    return `
                        <div class="comment-item ${isReply ? 'comment-reply' : ''}" data-comment-id="${escapeHtml(comment.id || '')}" data-comment-user="${escapeHtml(comment.user || '')}">
                            <div class="comment-header">
                                <span class="comment-author">${escapeHtml(comment.user_name || comment.user_email || 'Unknown')}${comment.is_edited ? ' (edited)' : ''}</span>
                                <span class="comment-date">${escapeHtml(formatDateTime(comment.created_at || null))}</span>
                            </div>
                            <div class="comment-content" data-comment-content data-raw-html="${escapeHtml(rawCommentHtml)}">${commentDisplayHtml}</div>
                            <div class="comment-actions">
                                <button type="button" class="comment-action-btn" data-action="view-scenario-reply-comment" data-comment-id="${escapeHtml(comment.id || '')}" title="Reply" ${isReply ? 'disabled aria-disabled="true"' : ''}><span>↩️</span></button>
                                <button type="button" class="comment-action-btn" data-action="view-scenario-thumbs-up-comment" data-comment-id="${escapeHtml(comment.id || '')}" data-liked="${isLiked ? 'true' : 'false'}" data-likes-count="${escapeHtml(String(likesCount))}" aria-pressed="${isLiked ? 'true' : 'false'}" title="Thumbs Up">
                                    <span data-role="thumbs-up-icon" style="${thumbsUpIconStyle}">👍</span>
                                    <span data-role="thumbs-up-count" style="${thumbsUpCountStyle}">${escapeHtml(String(likesCount))}</span>
                                </button>
                                <button type="button" class="comment-action-btn" data-action="view-scenario-add-reaction-comment" data-comment-id="${escapeHtml(comment.id || '')}" data-user-reaction="${escapeHtml(userReaction)}" title="Add Reaction">
                                    <span data-role="reaction-display">${escapeHtml(reactionDisplayText)}</span>
                                </button>
                                ${attachBtn}
                                ${editBtn}
                                ${deleteBtn}
                            </div>
                            ${attachmentsBlock}
                            ${repliesHtml}
                        </div>
                    `;
                };

                container.innerHTML = list.map((c) => renderComment(c, false)).join('');
            } catch (e) {
                container.innerHTML = '<div class="comment-empty">Failed to load comments.</div>';
            }
        };

        const removeScenarioDescriptionEditor = () => {
            try {
                if (typeof tinymce !== 'undefined') {
                    try {
                        const byId = tinymce.get && tinymce.get('module-add-scenario-description');
                        if (byId) {
                            tinymce.remove(byId);
                        }
                    } catch (e) { /* ignore */ }
                    tinymce.remove('#module-add-scenario-description');
                }
            } catch (e) { /* ignore */ }
            scenarioDescriptionEditor = null;

            // Ensure the underlying textarea is visible/usable again.
            try {
                const descEl = document.getElementById('module-add-scenario-description');
                if (descEl) {
                    descEl.style.display = '';
                    descEl.removeAttribute('aria-hidden');
                }
            } catch (e) { /* ignore */ }
        };

        const initScenarioDescriptionEditor = ({ readOnly, onInit } = {}) => {
            const descEl = document.getElementById('module-add-scenario-description');
            if (!descEl) return;
            // Always remove existing instances first to avoid duplicate inits
            removeScenarioDescriptionEditor();
            if (readOnly) return;
            if (typeof tinymce === 'undefined') return;

            tinymce.init({
                target: descEl,
                height: 220,
                min_height: 140,
                menubar: false,
                branding: false,
                // Enable TinyMCE resize handle via the status bar.
                statusbar: true,
                resize: true,
                plugins: [
                    'advlist', 'autolink', 'lists', 'link', 'charmap', 'preview',
                    'searchreplace', 'visualblocks', 'code', 'fullscreen',
                    'insertdatetime', 'table', 'help', 'wordcount'
                ],
                toolbar: 'undo redo | formatselect | bold italic underline strikethrough | ' +
                    'alignleft aligncenter alignright alignjustify | ' +
                    'bullist numlist outdent indent | forecolor backcolor | removeformat | help',
                content_style: 'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 14px }',
                setup(editor) {
                    scenarioDescriptionEditor = editor;
                    editor.on('init', () => {
                        const initialValue = descEl.value || '';
                        editor.setContent(initialValue);

                        try {
                            if (typeof onInit === 'function') {
                                onInit(editor);
                            }
                        } catch (e) { /* ignore */ }
                    });
                    const syncValue = () => {
                        try { descEl.value = editor.getContent({ format: 'html' }) || ''; } catch (e) { /* ignore */ }
                    };
                    editor.on('change keyup paste blur setcontent', syncValue);
                    editor.on('remove', () => {
                        if (scenarioDescriptionEditor === editor) {
                            scenarioDescriptionEditor = null;
                        }
                    });
                },
            });
        };

        // Open add/edit/view scenario modal for a given module id
        const openModuleScenarioModal = (mode, moduleId, scenario = null) => {
            const modal = document.querySelector('[data-role="module-add-scenario-modal"]');
            if (!modal) return;
            const dialog = modal.querySelector('.automation-modal__dialog');
            state.moduleScenarioModalMode = mode || 'create';
            state.moduleScenarioCurrentId = scenario && scenario.id ? scenario.id : null;
            // populate module hidden input
            const moduleInput = modal.querySelector('#module-add-scenario-module-id') || document.getElementById('module-add-scenario-module-id');
            if (moduleInput) moduleInput.value = moduleId || (scenario && scenario.module ? scenario.module : '');
            // populate fields
            const titleInput = modal.querySelector('#module-add-scenario-title') || document.getElementById('module-add-scenario-title');
            const descInput = modal.querySelector('#module-add-scenario-description') || document.getElementById('module-add-scenario-description');
            const isAutomatedInput = modal.querySelector('#module-add-scenario-is-automated') || document.getElementById('module-add-scenario-is-automated');
            if (scenario) {
                if (titleInput) titleInput.value = scenario.title || '';
                if (descInput) descInput.value = scenario.description || '';
                if (isAutomatedInput) isAutomatedInput.checked = (typeof scenario.is_automated !== 'undefined') ? Boolean(scenario.is_automated) : true;
            } else {
                if (titleInput) titleInput.value = '';
                if (descInput) descInput.value = '';
                if (isAutomatedInput) isAutomatedInput.checked = true;
            }
            const submit = modal.querySelector('button[type="submit"]');
            const cancelBtn = modal.querySelector('form#module-add-scenario-form [data-action="close-module-add-scenario-modal"]');
            const automatedRow = modal.querySelector('.form-row.dependency-toggle') || modal.querySelector('.dependency-toggle');
            // view mode => readonly fields and hide submit
            const readOnly = mode === 'view';

            // View Scenario has a dedicated Save row under Description.
            // It should only be shown when the description is editable (TinyMCE).
            setViewScenarioSaveVisible(modal, false);

            // Comments: use the shared Scenario Comments modal (same as Projects > Scenarios).
            try {
                const commentsBtn = modal.querySelector('#module-view-scenario-comments-btn');
                if (commentsBtn) {
                    commentsBtn.hidden = !readOnly;
                    commentsBtn.disabled = !(readOnly && scenario && scenario.id);
                }
            } catch (e) { /* ignore */ }

            // Legacy inline comments row (kept in template but unused).
            try {
                const row = modal.querySelector('#module-view-scenario-comments-row');
                const container = modal.querySelector('#module-view-scenario-comments');
                if (row && container) {
                    row.hidden = true;
                    try { row.style.display = 'none'; } catch (e) { /* ignore */ }
                    container.innerHTML = '';
                }
            } catch (e) { /* ignore */ }


            // Reset inline add-comment form (View Scenario only).
            try {
                const addForm = modal.querySelector('#module-view-scenario-add-comment-form');
                const scenarioIdInput = modal.querySelector('#module-view-scenario-comment-scenario-id');
                const contentTextarea = modal.querySelector('#module-view-scenario-comment-content');
                if (addForm) addForm.style.display = 'none';
                if (scenarioIdInput) scenarioIdInput.value = (readOnly && scenario && scenario.id) ? String(scenario.id) : '';
                if (contentTextarea) contentTextarea.value = '';
                removeViewScenarioCommentEditor();
            } catch (e) { /* ignore */ }

            // Hard guarantee: View mode must never show/attach TinyMCE.
            if (readOnly) {
                removeScenarioDescriptionEditor();
                if (descInput) {
                    try { descInput.classList.remove('tinymce-editor'); } catch (e) { /* ignore */ }
                }
            }

            // View Scenario should be wider for readability.
            if (dialog) {
                try {
                    dialog.style.width = readOnly ? '80vw' : '';
                    dialog.style.maxWidth = readOnly ? '80vw' : '';
                } catch (e) { /* ignore */ }
            }
            // For view mode, use readOnly (not disabled) so the field can still be
            // scrolled/selected, but cannot be edited.
            if (titleInput) { titleInput.readOnly = readOnly; titleInput.disabled = false; }
            if (descInput) {
                descInput.readOnly = readOnly;
                descInput.disabled = false;
                // Keep a comfortable baseline height across modes.
                const rows = 12;
                descInput.rows = rows;
                descInput.setAttribute('rows', String(rows));
            }
            if (readOnly && descInput && scenario) {
                // Keep the original HTML around so View mode can be promoted to Edit
                // (TinyMCE expects HTML, not the formatted plain-text view rendering).
                try { descInput.dataset.rawHtml = scenario.description || ''; } catch (e) { /* ignore */ }
                // Render TinyMCE HTML as formatted plain text for the view modal.
                descInput.value = htmlToFormattedText(scenario.description || '');
                autosizeTextareaToContent(descInput, { minRows: 12 });
            } else if (descInput) {
                try { delete descInput.dataset.rawHtml; } catch (e) { /* ignore */ }
                // Reset any previous autosize styles so TinyMCE/edit mode behaves normally.
                try {
                    descInput.style.height = '';
                    descInput.style.overflowY = '';
                } catch (e) { /* ignore */ }
            }
            if (isAutomatedInput) {
                isAutomatedInput.disabled = readOnly;
                // Hide the entire row in view mode.
                const row = (isAutomatedInput.closest && (isAutomatedInput.closest('.form-row') || isAutomatedInput.closest('.dependency-toggle'))) || null;
                if (row) {
                    row.hidden = readOnly;
                    try { row.style.display = readOnly ? 'none' : ''; } catch (e) { /* ignore */ }
                }
            }
            if (automatedRow) {
                automatedRow.hidden = readOnly;
                try { automatedRow.style.display = readOnly ? 'none' : ''; } catch (e) { /* ignore */ }
            }
            if (submit) submit.hidden = readOnly;
            if (cancelBtn) cancelBtn.hidden = readOnly;
            // set header title
            const header = modal.querySelector('#module-add-scenario-modal-title') || document.getElementById('module-add-scenario-modal-title');
            if (header) {
                if (mode === 'edit') header.textContent = 'Edit Scenario';
                else if (mode === 'view') header.textContent = 'View Scenario';
                else header.textContent = 'Add Scenario to Module';
            }
            modal.hidden = false;
            body.classList.add('automation-modal-open');
            // Enable rich-text editing for description on create/edit.
            // Keep plain textarea for view mode.
            try { initScenarioDescriptionEditor({ readOnly }); } catch (e) { /* ignore */ }

            // focus first input when not viewing
            if (!readOnly && titleInput) titleInput.focus();
        };

        // In View mode, clicking the description should open TinyMCE for the description
        // while keeping the modal as "View Scenario" (no full switch to Edit UI).
        try {
            const modal = document.querySelector('[data-role="module-add-scenario-modal"]');
            if (modal && !modal.dataset.scenarioDescClickBound) {
                modal.dataset.scenarioDescClickBound = '1';
                modal.addEventListener('click', async (ev) => {
                    const target = ev && ev.target ? ev.target : null;
                    if (!target) return;
                    const descEl = target.closest && target.closest('#module-add-scenario-description');
                    if (!descEl) return;
                    if (state.moduleScenarioModalMode !== 'view') return;

                    // Ensure we have a scenario id to update.
                    if (!state.moduleScenarioCurrentId) return;

                    // If already initialized, ensure the Save row is visible.
                    try {
                        if (typeof tinymce !== 'undefined' && tinymce.get && tinymce.get('module-add-scenario-description')) {
                            setViewScenarioSaveVisible(modal, true);
                            return;
                        }
                    } catch (e) { /* ignore */ }

                    // View Scenario: only allow showing Save when TinyMCE mode
                    // can be activated (i.e., description becomes editable).
                    if (typeof tinymce === 'undefined') {
                        return;
                    }

                    setViewScenarioSaveVisible(modal, false);

                    // Swap back to raw HTML and initialize TinyMCE.
                    try {
                        const rawHtml = descEl.dataset && typeof descEl.dataset.rawHtml === 'string' ? descEl.dataset.rawHtml : '';
                        descEl.value = rawHtml || '';
                        descEl.readOnly = false;
                        descEl.disabled = false;
                        descEl.style.height = '';
                        descEl.style.overflowY = '';
                    } catch (e) { /* ignore */ }

                    // Keep the modal header as View Scenario.
                    // Keep the bottom form submit hidden; show the Save row under
                    // Description once TinyMCE is actually active.
                    const submit = modal.querySelector('button[type="submit"]');
                    if (submit) submit.hidden = true;
                    const cancelBtn = modal.querySelector('form#module-add-scenario-form [data-action="close-module-add-scenario-modal"]');
                    if (cancelBtn) cancelBtn.hidden = true;

                    try {
                        initScenarioDescriptionEditor({
                            readOnly: false,
                            onInit: () => {
                                setViewScenarioSaveVisible(modal, true);
                            },
                        });
                    } catch (e) { /* ignore */ }
                });
            }
        } catch (e) { /* ignore */ }

        // In View mode, inline Add Comment should behave like the Comments modal:
        // show TinyMCE composer + Post + Cancel.
        try {
            const modal = document.querySelector('[data-role="module-add-scenario-modal"]');
            if (modal && !modal.dataset.viewScenarioInlineCommentBound) {
                modal.dataset.viewScenarioInlineCommentBound = '1';

                modal.addEventListener('click', async (ev) => {
                    const toggleBtn = ev && ev.target && ev.target.closest
                        ? ev.target.closest('[data-action="toggle-view-scenario-add-comment"]')
                        : null;
                    const saveBtn = ev && ev.target && ev.target.closest
                        ? ev.target.closest('[data-action="submit-view-scenario-save"]')
                        : null;
                    const cancelEditBtn = ev && ev.target && ev.target.closest
                        ? ev.target.closest('[data-action="cancel-view-scenario-edit"]')
                        : null;
                    const cancelBtn = ev && ev.target && ev.target.closest
                        ? ev.target.closest('[data-action="cancel-view-scenario-add-comment"]')
                        : null;
                    const postBtn = ev && ev.target && ev.target.closest
                        ? ev.target.closest('[data-action="post-view-scenario-add-comment"]')
                        : null;

                    const editCommentBtn = ev && ev.target && ev.target.closest
                        ? ev.target.closest('[data-action="view-scenario-edit-comment"]')
                        : null;
                    const replyCommentBtn = ev && ev.target && ev.target.closest
                        ? ev.target.closest('[data-action="view-scenario-reply-comment"]')
                        : null;
                    const deleteCommentBtn = ev && ev.target && ev.target.closest
                        ? ev.target.closest('[data-action="view-scenario-delete-comment"]')
                        : null;
                    const thumbsUpBtn = ev && ev.target && ev.target.closest
                        ? ev.target.closest('[data-action="view-scenario-thumbs-up-comment"]')
                        : null;
                    const addReactionBtn = ev && ev.target && ev.target.closest
                        ? ev.target.closest('[data-action="view-scenario-add-reaction-comment"]')
                        : null;
                    const attachCommentBtn = ev && ev.target && ev.target.closest
                        ? ev.target.closest('[data-action="view-scenario-attach-comment"]')
                        : null;
                    const cancelInlineBtn = ev && ev.target && ev.target.closest
                        ? ev.target.closest('[data-action="cancel-view-scenario-inline-comment"]')
                        : null;
                    const submitInlineBtn = ev && ev.target && ev.target.closest
                        ? ev.target.closest('[data-action="submit-view-scenario-inline-comment"]')
                        : null;

                    const handleCommentAction = async () => {
                        const anyBtn = editCommentBtn || replyCommentBtn || deleteCommentBtn || thumbsUpBtn || addReactionBtn || attachCommentBtn || cancelInlineBtn || submitInlineBtn;
                        if (!anyBtn) return false;

                        try {
                            ev.preventDefault();
                            ev.stopPropagation();
                        } catch (e) { /* ignore */ }

                        if (state.moduleScenarioModalMode !== 'view') return true;

                        const cssEscape = (val) => {
                            try {
                                if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(String(val));
                            } catch (e) { /* ignore */ }
                            return String(val).replace(/[^a-zA-Z0-9_\-]/g, '\\$&');
                        };

                        const editorWrapper = ensureViewScenarioInlineEditor(modal);
                        const inlineForm = editorWrapper ? editorWrapper.querySelector('#module-view-inline-comment-form') : null;
                        const inlineLabel = editorWrapper ? editorWrapper.querySelector('#module-view-inline-editor-label') : null;
                        const inlineSubmit = editorWrapper ? editorWrapper.querySelector('#module-view-inline-submit-btn') : null;

                        if (cancelInlineBtn) {
                            if (editorWrapper) editorWrapper.style.display = 'none';
                            removeViewScenarioInlineCommentEditor();
                            return true;
                        }

                        const commentId = anyBtn && anyBtn.dataset ? anyBtn.dataset.commentId : null;

                        if (attachCommentBtn && commentId) {
                            activeViewScenarioAttachCommentId = String(commentId);
                            const fileInput = modal.querySelector('#module-view-scenario-comment-attachments-input');
                            if (fileInput && typeof fileInput.click === 'function') {
                                try { fileInput.click(); } catch (e) { /* ignore */ }
                            }
                            return true;
                        }

                        if (editCommentBtn && commentId) {
                            const commentItem = modal.querySelector(`.comment-item[data-comment-id="${cssEscape(commentId)}"]`);
                            const contentDiv = commentItem ? commentItem.querySelector('[data-comment-content]') : null;
                            const currentContent = (contentDiv && contentDiv.dataset && typeof contentDiv.dataset.rawHtml === 'string')
                                ? contentDiv.dataset.rawHtml
                                : (contentDiv ? (contentDiv.innerHTML || '') : '');

                            if (inlineForm) {
                                inlineForm.setAttribute('data-mode', 'edit');
                                inlineForm.setAttribute('data-comment-id', String(commentId));
                                inlineForm.setAttribute('data-parent-id', '');
                            }
                            if (inlineLabel) inlineLabel.textContent = 'Edit Comment';
                            if (inlineSubmit) inlineSubmit.textContent = 'Update Comment';

                            try {
                                const actionsDiv = commentItem ? commentItem.querySelector('.comment-actions') : null;
                                if (actionsDiv && editorWrapper) actionsDiv.after(editorWrapper);
                            } catch (e) { /* ignore */ }

                            initViewScenarioInlineCommentEditor({ modalEl: modal, contentHtml: currentContent });
                            return true;
                        }

                        if (replyCommentBtn && commentId) {
                            const commentItem = modal.querySelector(`.comment-item[data-comment-id="${cssEscape(commentId)}"]`);

                            if (inlineForm) {
                                inlineForm.setAttribute('data-mode', 'reply');
                                inlineForm.setAttribute('data-comment-id', '');
                                inlineForm.setAttribute('data-parent-id', String(commentId));
                            }
                            if (inlineLabel) inlineLabel.textContent = 'Reply to Comment';
                            if (inlineSubmit) inlineSubmit.textContent = 'Post Reply';

                            try {
                                const actionsDiv = commentItem ? commentItem.querySelector('.comment-actions') : null;
                                if (actionsDiv && editorWrapper) actionsDiv.after(editorWrapper);
                            } catch (e) { /* ignore */ }

                            initViewScenarioInlineCommentEditor({ modalEl: modal, contentHtml: '' });
                            return true;
                        }

                        if (submitInlineBtn) {
                            if (!state.moduleScenarioCurrentId) return true;
                            if (!inlineForm) return true;
                            const mode = inlineForm.getAttribute('data-mode') || '';
                            const editId = inlineForm.getAttribute('data-comment-id') || '';
                            const parentId = inlineForm.getAttribute('data-parent-id') || '';

                            let content = '';
                            try {
                                if (typeof tinymce !== 'undefined' && tinymce.get) {
                                    const editor = tinymce.get('module-view-inline-comment-content');
                                    if (editor) content = editor.getContent() || '';
                                }
                            } catch (e) { /* ignore */ }

                            if (!content) {
                                const textarea = inlineForm.querySelector('#module-view-inline-comment-content');
                                content = textarea ? (textarea.value || '').trim() : '';
                            }

                            if (!content) {
                                showToast('Please enter a comment.', 'error');
                                return true;
                            }

                            try {
                                let url = '';
                                let method = 'POST';
                                let body = null;

                                if (mode === 'edit') {
                                    if (!editId) return true;
                                    url = `/api/core/scenario-comments/${encodeURIComponent(String(editId))}/`;
                                    method = 'PATCH';
                                    body = JSON.stringify({ content });
                                } else if (mode === 'reply') {
                                    if (!parentId) return true;
                                    url = '/api/core/scenario-comments/';
                                    method = 'POST';
                                    body = JSON.stringify({ scenario: state.moduleScenarioCurrentId, content, parent: parentId });
                                } else {
                                    return true;
                                }

                                submitInlineBtn.disabled = true;
                                await request(url, { method, body });
                                showToast(mode === 'edit' ? 'Comment updated.' : 'Reply posted.', 'success');
                                if (editorWrapper) editorWrapper.style.display = 'none';
                                removeViewScenarioInlineCommentEditor();
                                await loadScenarioCommentsForViewModal(state.moduleScenarioCurrentId);
                            } catch (e) {
                                showToast(e instanceof Error ? e.message : 'Failed to save comment.', 'error');
                            } finally {
                                submitInlineBtn.disabled = false;
                            }
                            return true;
                        }

                        if (deleteCommentBtn && commentId) {
                            try {
                                if (!window.confirm('Are you sure you want to delete this comment?')) return true;
                            } catch (e) { /* ignore */ }
                            try {
                                await request(`/api/core/scenario-comments/${encodeURIComponent(String(commentId))}/`, { method: 'DELETE' });
                                showToast('Comment deleted.', 'success');
                                await loadScenarioCommentsForViewModal(state.moduleScenarioCurrentId);
                            } catch (e) {
                                showToast(e instanceof Error ? e.message : 'Failed to delete comment.', 'error');
                            }
                            return true;
                        }

                        if (thumbsUpBtn && commentId) {
                            const url = `/api/core/scenario-comments/${encodeURIComponent(String(commentId))}/toggle_like/`;
                            const wasLiked = thumbsUpBtn.dataset.liked === 'true';
                            const wasLikesCountRaw = thumbsUpBtn.dataset.likesCount;
                            const wasLikesCount = Number.isFinite(parseInt(wasLikesCountRaw, 10)) ? parseInt(wasLikesCountRaw, 10) : 0;
                            const optimisticLiked = !wasLiked;
                            const optimisticCount = optimisticLiked ? Math.max(1, wasLikesCount + 1) : Math.max(0, wasLikesCount - 1);
                            updateThumbsUpButtonIcon(thumbsUpBtn, optimisticLiked, optimisticCount);
                            try {
                                thumbsUpBtn.disabled = true;
                                const data = await request(url, { method: 'POST' });
                                updateThumbsUpButtonIcon(thumbsUpBtn, !!(data && data.liked), data && typeof data.likes_count === 'number' ? data.likes_count : null);
                            } catch (e) {
                                updateThumbsUpButtonIcon(thumbsUpBtn, wasLiked, wasLikesCount);
                                showToast(e instanceof Error ? e.message : 'Failed to toggle thumbs up.', 'error');
                            } finally {
                                thumbsUpBtn.disabled = false;
                            }
                            return true;
                        }

                        if (addReactionBtn && commentId) {
                            const current = (addReactionBtn.dataset.userReaction || '').trim() || '😊';
                            const reaction = await openEmojiPickerPopover(addReactionBtn, current);
                            if (!reaction) return true;
                            try {
                                addReactionBtn.disabled = true;
                                const data = await request(`/api/core/scenario-comments/${encodeURIComponent(String(commentId))}/set_reaction/`, {
                                    method: 'POST',
                                    body: JSON.stringify({ reaction }),
                                });

                                const displayEl = addReactionBtn.querySelector('[data-role="reaction-display"]');
                                const nextUserReaction = data && data.reacted ? (data.reaction || reaction) : '';
                                addReactionBtn.dataset.userReaction = nextUserReaction;

                                if (displayEl) {
                                    const summary = (data && Array.isArray(data.reactions_summary)) ? data.reactions_summary : [];
                                    const summaryText = summary
                                        .filter((x) => x && x.reaction && typeof x.count === 'number' && x.count > 0)
                                        .map((x) => `${x.reaction} ${x.count}`)
                                        .join(' ');
                                    displayEl.textContent = summaryText || '😊';
                                }
                                showToast(data && data.reacted ? 'Reaction saved.' : 'Reaction removed.', 'success');
                            } catch (e) {
                                showToast(e instanceof Error ? e.message : 'Failed to add reaction.', 'error');
                            } finally {
                                addReactionBtn.disabled = false;
                            }
                            return true;
                        }

                        return true;
                    };

                    try {
                        const handled = await handleCommentAction();
                        if (handled) return;
                    } catch (e) { /* ignore */ }

                    if (cancelEditBtn) {
                        if (state.moduleScenarioModalMode !== 'view') return;
                        exitViewScenarioDescriptionEdit(modal);
                        return;
                    }

                    if (saveBtn) {
                        if (state.moduleScenarioModalMode !== 'view') return;
                        const form = modal.querySelector('#module-add-scenario-form') || document.getElementById('module-add-scenario-form');
                        if (!form) return;
                        try {
                            if (typeof form.requestSubmit === 'function') {
                                form.requestSubmit();
                                return;
                            }
                        } catch (e) { /* ignore */ }
                        try {
                            const submitEl = form.querySelector('button[type="submit"], input[type="submit"]');
                            if (submitEl && typeof submitEl.click === 'function') {
                                submitEl.click();
                                return;
                            }
                        } catch (e) { /* ignore */ }
                        try {
                            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                        } catch (e) { /* ignore */ }
                        return;
                    }

                    if (toggleBtn) {
                        if (state.moduleScenarioModalMode !== 'view') return;
                        if (!state.moduleScenarioCurrentId) return;
                        const addForm = modal.querySelector('#module-view-scenario-add-comment-form');
                        const scenarioIdInput = modal.querySelector('#module-view-scenario-comment-scenario-id');
                        if (!addForm || !scenarioIdInput) return;
                        scenarioIdInput.value = String(state.moduleScenarioCurrentId);
                        addForm.style.display = '';
                        try { initViewScenarioCommentEditor(); } catch (e) { /* ignore */ }
                        return;
                    }

                    if (cancelBtn) {
                        const addForm = modal.querySelector('#module-view-scenario-add-comment-form');
                        const textarea = modal.querySelector('#module-view-scenario-comment-content');
                        if (addForm) addForm.style.display = 'none';
                        if (textarea) textarea.value = '';
                        removeViewScenarioCommentEditor();
                        return;
                    }

                    if (postBtn) {
                        if (state.moduleScenarioModalMode !== 'view') return;
                        if (!state.moduleScenarioCurrentId) return;

                        const scenarioId = state.moduleScenarioCurrentId;
                        const textarea = modal.querySelector('#module-view-scenario-comment-content');
                        let contentHtml = textarea && textarea.value ? textarea.value : '';
                        try {
                            const ed = (typeof tinymce !== 'undefined' && tinymce.get)
                                ? tinymce.get('module-view-scenario-comment-content')
                                : null;
                            if (ed && typeof ed.getContent === 'function') {
                                try { if (typeof ed.save === 'function') ed.save(); } catch (e) { /* ignore */ }
                                contentHtml = ed.getContent({ format: 'html' }) || '';
                            }
                        } catch (e) { /* ignore */ }

                        if (!contentHtml || !String(contentHtml).trim()) {
                            showToast('Comment content is required.', 'error');
                            return;
                        }

                        (async () => {
                            try {
                                await request('/api/core/scenario-comments/', {
                                    method: 'POST',
                                    body: JSON.stringify({ scenario: scenarioId, content: contentHtml }),
                                });

                                // Reset composer
                                try {
                                    const addForm = modal.querySelector('#module-view-scenario-add-comment-form');
                                    if (addForm) addForm.style.display = 'none';
                                    if (textarea) textarea.value = '';
                                    removeViewScenarioCommentEditor();
                                } catch (e) { /* ignore */ }

                                // Refresh comments list
                                try { await loadScenarioCommentsForViewModal(scenarioId); } catch (e) { /* ignore */ }
                                showToast('Comment posted.', 'success');
                            } catch (e) {
                                showToast('Failed to post comment.', 'error');
                            }
                        })();
                    }
                });

                // Scenario comment attachments upload input
                try {
                    const fileInput = modal.querySelector('#module-view-scenario-comment-attachments-input');
                    if (fileInput && !fileInput.dataset.viewScenarioAttachBound) {
                        fileInput.dataset.viewScenarioAttachBound = '1';
                        fileInput.addEventListener('change', async () => {
                            const commentId = activeViewScenarioAttachCommentId;
                            activeViewScenarioAttachCommentId = null;
                            if (!commentId) {
                                try { fileInput.value = ''; } catch (e) { /* ignore */ }
                                return;
                            }

                            const selectedFiles = (() => {
                                try { return Array.from(fileInput.files || []); } catch (e) { return []; }
                            })();
                            if (!selectedFiles.length) {
                                try { fileInput.value = ''; } catch (e) { /* ignore */ }
                                return;
                            }

                            const url = `/api/core/scenario-comments/${encodeURIComponent(String(commentId))}/attachments/`;
                            const formData = new FormData();
                            selectedFiles.forEach((f) => formData.append('files', f));

                            try {
                                fileInput.disabled = true;
                                const resp = await fetch(url, {
                                    method: 'POST',
                                    credentials: 'same-origin',
                                    headers: { 'X-CSRFToken': getCsrfToken() },
                                    body: formData,
                                });
                                if (!resp.ok) {
                                    let msg = 'Upload failed.';
                                    try {
                                        const data = await resp.json();
                                        const messages = flattenMessages(data);
                                        if (messages && messages.length) msg = messages.join(' ');
                                    } catch (e) { /* ignore */ }
                                    throw new Error(msg);
                                }
                                showToast('Attachment uploaded.', 'success');
                                if (state.moduleScenarioCurrentId) {
                                    await loadScenarioCommentsForViewModal(state.moduleScenarioCurrentId);
                                }
                            } catch (e) {
                                showToast(e instanceof Error ? e.message : 'Failed to upload attachment.', 'error');
                            } finally {
                                try { fileInput.value = ''; } catch (e) { /* ignore */ }
                                fileInput.disabled = false;
                            }
                        });
                    }
                } catch (e) { /* ignore */ }
            }
        } catch (e) { /* ignore */ }

        // expose for other modules (e.g., automation.js) to reuse
        try {
            window.openModuleScenarioModal = openModuleScenarioModal;
        } catch (e) {
            // ignore if window not available
        }

        // Listen for a custom event so other scripts can request the modal
        // without depending on global function timing.
        try {
            document.addEventListener('open-module-scenario', (ev) => {
                try {
                    const detail = ev && ev.detail ? ev.detail : {};
                    const mode = detail.mode || 'create';
                    const moduleId = typeof detail.moduleId !== 'undefined' ? detail.moduleId : null;
                    try { console.info('[data-management] received open-module-scenario', { mode, moduleId }); } catch (e) { /* ignore */ }
                    openModuleScenarioModal(mode, moduleId || null);
                } catch (err) {
                    // ignore errors from handler
                }
            });
        } catch (err) {
            // ignore if document not available
        }

        const closeModuleAddScenarioModal = () => {
            const modal = document.querySelector('[data-role="module-add-scenario-modal"]');
            if (!modal) return;
            modal.hidden = true;
            body.classList.remove('automation-modal-open');
            // Cleanup TinyMCE instance for scenario description
            removeScenarioDescriptionEditor();
            // Cleanup inline comment editor (View Scenario)
            removeViewScenarioCommentEditor();
            removeViewScenarioInlineCommentEditor();
            try {
                const editorWrapper = modal.querySelector('#module-view-inline-comment-editor');
                if (editorWrapper) editorWrapper.style.display = 'none';
            } catch (e) { /* ignore */ }

            try {
                const input = modal.querySelector('#module-view-scenario-comment-attachments-input');
                if (input) input.value = '';
            } catch (e) { /* ignore */ }
            const form = document.getElementById('module-add-scenario-form');
            if (form) form.reset();
        };

        const closeModuleScenarioModal = () => {
            state.moduleScenarioModalMode = 'create';
            state.moduleScenarioCurrentId = null;
            closeModuleAddScenarioModal();
        };

        const handleModuleAddScenarioSubmit = async (event) => {
            console.debug('[data-management] handleModuleAddScenarioSubmit fired', { mode: state.moduleScenarioModalMode, currentId: state.moduleScenarioCurrentId });
            // prevent double-submit
            if (state.moduleScenarioSubmitting) {
                try { console.info('[data-management] submit ignored: already submitting'); } catch (e) { }
                event && event.preventDefault && event.preventDefault();
                return;
            }
            state.moduleScenarioSubmitting = true;
            // disable the Save button while submitting
            const saveBtn = (() => {
                try { return document.querySelector('[data-role="module-add-scenario-modal"] button[type="submit"], #module-add-scenario-form button[type="submit"]'); } catch (e) { return null; }
            })();
            if (saveBtn) saveBtn.disabled = true;
            event.preventDefault();
            const form = document.getElementById('module-add-scenario-form');
            if (!form) return;
            const abortScenarioSubmit = (message, focusId, options = {}) => {
                if (message) {
                    setStatus(message, 'error');
                }
                state.moduleScenarioSubmitting = false;
                if (saveBtn) saveBtn.disabled = false;
                if (focusId) {
                    const target = document.getElementById(focusId);
                    if (target && typeof target.focus === 'function') {
                        target.focus();
                    }
                    if (options.select && target && typeof target.select === 'function') {
                        target.select();
                    }
                }
            };
            const scenarioModalEl = (() => {
                try { return document.querySelector('[data-role="module-add-scenario-modal"]'); } catch (e) { return null; }
            })();
            const moduleInput = (scenarioModalEl && scenarioModalEl.querySelector('#module-add-scenario-module-id')) || document.getElementById('module-add-scenario-module-id');
            const titleInput = (scenarioModalEl && scenarioModalEl.querySelector('#module-add-scenario-title')) || document.getElementById('module-add-scenario-title');
            const descInput = (scenarioModalEl && scenarioModalEl.querySelector('#module-add-scenario-description')) || document.getElementById('module-add-scenario-description');
            const isAutomatedInput = (scenarioModalEl && scenarioModalEl.querySelector('#module-add-scenario-is-automated')) || document.getElementById('module-add-scenario-is-automated');
            const moduleId = moduleInput && moduleInput.value ? Number(moduleInput.value) : null;
            // Require module selection: New Scenario must be opened with a
            // module selected. If missing, surface an error and abort save.
            if (!moduleId) {
                abortScenarioSubmit('Please select a module before creating a scenario.');
                return;
            }
            const payload = {
                module: moduleId,
                project: null,
                title: (titleInput && titleInput.value || '').trim(),
                description: descInput && descInput.value || '',
                is_automated: Boolean(isAutomatedInput ? isAutomatedInput.checked : true),
            };

            // If the description editor is active, pull the latest HTML directly
            // from TinyMCE to avoid relying on async textarea sync.
            try {
                if (descInput && descInput.id && typeof tinymce !== 'undefined') {
                    const editorCandidates = [];
                    try {
                        if (scenarioDescriptionEditor && scenarioDescriptionEditor.id === descInput.id) {
                            editorCandidates.push(scenarioDescriptionEditor);
                        }
                    } catch (e) { /* ignore */ }
                    try {
                        if (tinymce.get) {
                            const byId = tinymce.get(descInput.id);
                            if (byId) editorCandidates.push(byId);
                        }
                    } catch (e) { /* ignore */ }
                    // Fallback: find editor by target element.
                    try {
                        if (Array.isArray(tinymce.editors)) {
                            const byTarget = tinymce.editors.find((x) => x && x.targetElm && x.targetElm.id === descInput.id) || null;
                            if (byTarget) editorCandidates.push(byTarget);
                        }
                    } catch (e) { /* ignore */ }

                    const ed = editorCandidates.find((x) => x && typeof x.getContent === 'function') || null;
                    if (ed) {
                        try { if (typeof ed.save === 'function') ed.save(); } catch (e) { /* ignore */ }
                        let html = '';
                        try { html = ed.getContent({ format: 'html' }) || ''; } catch (e) { /* ignore */ }
                        // Last-resort fallback: read the live iframe body.
                        try {
                            if (!html && typeof ed.getBody === 'function') {
                                const body = ed.getBody();
                                html = body && typeof body.innerHTML === 'string' ? body.innerHTML : html;
                            }
                        } catch (e) { /* ignore */ }
                        payload.description = html || '';
                        // Keep textarea in sync too (useful if editor is removed later)
                        descInput.value = payload.description;
                    }
                }
            } catch (e) { /* ignore */ }
            // Basic client-side validation: title required
            const titleVal = payload.title ? String(payload.title).trim() : '';
            if (!titleVal) {
                abortScenarioSubmit('Scenario title is required.', 'module-add-scenario-title', { select: true });
                return;
            }
            // try to infer project from module if available
            const moduleObj = moduleId ? state.testModules.find((m) => Number(m.id) === Number(moduleId)) : null;
            if (moduleObj && (moduleObj.project_id || moduleObj.plan_id)) {
                const rawProject = moduleObj.project_id || moduleObj.plan_id;
                const parsedProject = Number(rawProject);
                if (!Number.isNaN(parsedProject) && parsedProject > 0) {
                    payload.project = parsedProject;
                }
            }
            if (!payload.project) {
                abortScenarioSubmit('Assign the module to a project before creating scenarios.');
                return;
            }
            // Prevent duplicate scenario titles within the same project (client-side)
            try {
                if (moduleObj && Array.isArray(moduleObj.scenarios)) {
                    const exists = moduleObj.scenarios.some((s) => {
                        if (!s) return false;
                        const sTitle = String(s.title || '').trim().toLowerCase();
                        const newTitle = titleVal.toLowerCase();
                        // If editing, allow the same title for the current scenario id
                        if (state.moduleScenarioModalMode === 'edit' && state.moduleScenarioCurrentId && Number(state.moduleScenarioCurrentId) === Number(s.id)) {
                            return false;
                        }
                        return sTitle === newTitle;
                    });
                    if (exists) {
                        try { console.info('[data-management] duplicate scenario title prevented (client-side)'); } catch (e) { }
                        abortScenarioSubmit('A scenario with that title already exists in the selected project. Choose a different title.', 'module-add-scenario-title', { select: true });
                        return;
                    }
                }
            } catch (e) { /* ignore */ }
            const isUpdateMode = (state.moduleScenarioModalMode === 'edit' || state.moduleScenarioModalMode === 'view')
                && Boolean(state.moduleScenarioCurrentId);
            const scenarioMode = isUpdateMode ? 'edit' : 'create';
            const scenarioLabel = payload.title || 'this scenario';
            let scenarioConfirmed = true;
            try {
                const message = scenarioMode === 'edit'
                    ? `Are you sure you want to update the scenario "${scenarioLabel}"?`
                    : `Are you sure you want to create the scenario "${scenarioLabel}"?`;
                scenarioConfirmed = typeof window.confirm === 'function' ? window.confirm(message) : true;
            } catch (e) {
                scenarioConfirmed = true;
            }
            if (!scenarioConfirmed) {
                state.moduleScenarioSubmitting = false;
                if (saveBtn) saveBtn.disabled = false;
                return;
            }
            try {
                setStatus('Saving scenario…', 'info');
                try { console.info('[data-management] submitting scenario', { payloadPreview: { module: payload.module, title: payload.title, project: payload.project } }); } catch (e) { }
                const urlBase = endpoints.scenarios || (apiEndpoints.scenarios ? ensureTrailingSlash(apiEndpoints.scenarios) : '/api/core/test-scenarios/');
                if (isUpdateMode && state.moduleScenarioCurrentId) {
                    // update existing scenario
                    const editUrl = `${urlBase}${state.moduleScenarioCurrentId}/`;
                    const updated = await request(editUrl, { method: 'PATCH', body: JSON.stringify(payload) });

                    const keepModalOpen = state.moduleScenarioModalMode === 'view';
                    // Close the modal only for the explicit Edit flow.
                    // For View Scenario, keep it open and refresh UI in-place.
                    if (!keepModalOpen) {
                        // close modal immediately to ensure it hides even if later
                        // UI updates throw. Then refresh authoritative state first
                        // and ensure the module stays expanded so the collapsible
                        // does not close unexpectedly.
                        try { closeModuleScenarioModal(); } catch (e) { /* ignore */ }
                    }
                    try {
                        // Update the scenario in-place in local state so we don't
                        // replace the whole modules list (which can be filtered on
                        // the server and remove records unexpectedly).
                        if (moduleObj && Array.isArray(moduleObj.scenarios)) {
                            const normalizedUpdated = normalizeScenario(updated);
                            const idx = moduleObj.scenarios.findIndex((s) => Number(s.id) === Number(normalizedUpdated.id));
                            if (idx > -1) {
                                moduleObj.scenarios[idx] = normalizedUpdated;
                            } else {
                                moduleObj.scenarios.unshift(normalizedUpdated);
                            }
                            // re-render to show the updated row
                            renderTestModulesList();
                            // ensure module remains expanded
                            if (moduleId) ensureModuleExpanded(moduleId);
                        }
                        try { document.dispatchEvent(new CustomEvent('test-modules-changed', { detail: { moduleId } })); } catch (e) { }
                    } catch (e) {
                        try { console.info('[data-management] error updating state after update', { error: e && (e.message || e) }); } catch (err) { }
                    }

                    // Always return View Scenario back to textarea mode after a successful save.
                    if (keepModalOpen) {
                        try {
                            const normalizedUpdated = normalizeScenario(updated);
                            const modalEl = document.querySelector('[data-role="module-add-scenario-modal"]');
                            const submittedHtml = typeof payload.description === 'string' ? payload.description : '';
                            try { removeScenarioDescriptionEditor(); } catch (e) { /* ignore */ }
                            // Fallback: if TinyMCE container still exists, remove it.
                            try {
                                const tox = modalEl ? modalEl.querySelector('.tox-tinymce') : null;
                                if (tox && tox.parentNode) {
                                    tox.parentNode.removeChild(tox);
                                }
                            } catch (e) { /* ignore */ }

                            // TinyMCE teardown can replace the underlying textarea node;
                            // always re-query it after removal before updating.
                            const descEl = modalEl
                                ? (modalEl.querySelector('#module-add-scenario-description') || document.getElementById('module-add-scenario-description'))
                                : document.getElementById('module-add-scenario-description');
                            if (descEl) {
                                try {
                                    // Prefer the just-submitted payload HTML, fall back to the response.
                                    try {
                                        descEl.dataset.rawHtml = submittedHtml || normalizedUpdated.description || '';
                                    } catch (e) { /* ignore */ }
                                    descEl.readOnly = true;
                                    descEl.disabled = false;
                                    descEl.value = htmlToFormattedText(descEl.dataset.rawHtml || '');
                                    autosizeTextareaToContent(descEl, { minRows: 12 });
                                } catch (e) { /* ignore */ }
                            }
                            try {
                                const modalEl = document.querySelector('[data-role="module-add-scenario-modal"]');
                                const submit = modalEl ? modalEl.querySelector('button[type="submit"]') : null;
                                if (submit) submit.hidden = true;
                            } catch (e) { /* ignore */ }

                            // After saving, return to View state: hide the Save row
                            // under Description until the user clicks to edit again.
                            try { setViewScenarioSaveVisible(modalEl, false); } catch (e) { /* ignore */ }
                        } catch (e) { /* ignore */ }
                    }
                    const displayName = updated && updated.title ? updated.title : scenarioLabel;
                    setStatus('Scenario updated.', 'success');
                    showToast(`Scenario "${displayName}" updated successfully.`);
                } else {
                    const created = await request(urlBase, { method: 'POST', body: JSON.stringify(payload) });
                    // insert scenario into module's sublist in state and DOM
                    // close modal immediately to ensure it hides even if later
                    // UI updates throw. Then update client state and refresh.
                    try { closeModuleScenarioModal(); } catch (e) { /* ignore */ }
                    try {
                        // Insert created scenario into local module state when possible
                        const normalizedCreated = normalizeScenario(created);
                        if (moduleObj) {
                            moduleObj.scenarios = moduleObj.scenarios || [];
                            moduleObj.scenarios.unshift(normalizedCreated);
                            // re-render modules list and keep module expanded
                            renderTestModulesList();
                            if (moduleId) ensureModuleExpanded(moduleId);
                            try { document.dispatchEvent(new CustomEvent('test-modules-changed', { detail: { moduleId } })); } catch (e) { }
                        } else {
                            // fallback: reload authoritative modules list
                            try { await loadTestModules(); } catch (e) { /* ignore */ }
                            try { if (moduleId) ensureModuleExpanded(moduleId); } catch (e) { }
                            try { document.dispatchEvent(new CustomEvent('test-modules-changed', { detail: { moduleId } })); } catch (e) { }
                        }
                    } catch (e) {
                        try { console.info('[data-management] error in create flow', { error: e && (e.message || e) }); } catch (err) { }
                    }
                    const displayName = created && created.title ? created.title : scenarioLabel;
                    setStatus('Scenario saved.', 'success');
                    showToast(`Scenario "${displayName}" created successfully.`);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unable to save scenario.';
                // If the API returned a unique constraint error like "The fields project, title must make a unique set.",
                // surface a clearer message and focus the title input.
                if (message && (/unique set/i.test(message) || /fields\s+(plan|project),\s*title/i.test(message))) {
                    setStatus('A scenario with that title already exists in the selected project. Choose a different title.', 'error');
                    try { console.info('[data-management] server-side unique constraint detected'); } catch (e) { }
                    const t = document.getElementById('module-add-scenario-title');
                    if (t) {
                        // If the title exactly matches the attempted title, suggest a new unique one
                        try {
                            const current = (t.value || '').trim();
                            const base = (titleVal || '').trim();
                            if (current && base && current.toLowerCase() === base.toLowerCase()) {
                                try {
                                    // Look for existing titles in the same module or project and find numeric suffixes
                                    const candidates = [];
                                    const sourceList = (moduleId ? (state.testModules.find((m) => Number(m.id) === Number(moduleId)) || {}).scenarios : null) || [];
                                    // also consider freshly fetched scenarios if available in scope
                                    const pool = Array.isArray(sourceList) ? sourceList : [];
                                    pool.forEach((s) => {
                                        try {
                                            if (!s || !s.title) return;
                                            const tTitle = String(s.title).trim();
                                            // match titles that start with base (case-insensitive) and optionally have a " (n)" suffix
                                            // Build a safe regexp pattern from the base title
                                            const escapedBase = String(base).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                            const pattern = '^' + escapedBase.replace(/\s+/g, '\\s+') + '(?:\\s*\\((\\d+)\\))?\\s*$';
                                            const re = new RegExp(pattern, 'i');
                                            const m = tTitle.match(re);
                                            if (m) {
                                                const n = m[1] ? Number(m[1]) : 0;
                                                candidates.push(Number.isFinite(n) ? n : 0);
                                            }
                                        } catch (_e) { /* ignore per-item errors */ }
                                    });
                                    const maxExisting = candidates.length ? Math.max(...candidates) : 0;
                                    const next = maxExisting + 1;
                                    t.value = `${base}(${next})`;
                                } catch (_e) {
                                    // fallback to simple suggestion
                                    if (!/\(\d+\)\s*$/.test(current)) t.value = `${base}(1)`;
                                }
                            }
                        } catch (_e) { /* ignore */ }
                        try { t.focus(); t.select(); } catch (_e) { }
                    }
                    // Refresh scenarios from the server for the current project/module
                    try {
                        const scenariosBase = apiEndpoints.scenarios || '/api/core/test-scenarios/';
                        // prefer fetching by project if we have it, otherwise by module
                        const fetchUrl = payload && payload.project ? `${scenariosBase} ? project = ${encodeURIComponent(payload.project)
                            }` : `${scenariosBase}?module = ${encodeURIComponent(moduleId)} `;
                        try { console.info('[data-management] fetching latest scenarios after unique constraint', { fetchUrl }); } catch (e) { }
                        const latest = await request(fetchUrl, { method: 'GET' });
                        const normalized = Array.isArray(latest) ? latest.map(normalizeScenario) : [];
                        // update moduleObj.scenarios if possible
                        try {
                            const freshModuleObj = moduleId ? state.testModules.find((m) => Number(m.id) === Number(moduleId)) : null;
                            if (freshModuleObj) {
                                // if we fetched by project, filter to this module
                                freshModuleObj.scenarios = Array.isArray(normalized) ? normalized.filter((s) => Number(s.module) === Number(moduleId)) : [];
                                renderTestModulesList();
                                ensureModuleExpanded(moduleId);
                            } else {
                                // fallback: reload full modules list
                                await loadTestModules();
                            }
                        } catch (e) { /* ignore */ }
                    } catch (e) {
                        try { console.info('[data-management] failed to refresh scenarios after unique constraint', { error: e && (e.message || e) }); } catch (err) { }
                    }
                } else {
                    setStatus(message, 'error');
                    showToast(message, 'error');
                }
            } finally {
                // clear submitting state and re-enable button
                state.moduleScenarioSubmitting = false;
                try { if (saveBtn) saveBtn.disabled = false; } catch (e) { }
            }
        };

        // Wire module add scenario form submit once during initialization.
        // Previously this was incorrectly attached inside the keydown handler,
        // which meant the handler wasn't always registered when the user clicked
        // the Save button. Attach it once here so the form always works.
        // The form submit is handled via delegated listener below so we avoid
        // attaching a direct listener here which could run twice if the form
        // is submitted normally (both direct and delegated handlers fire).
        // Delegated submit handler: ensures the submit event is captured even if
        // the form element is re-rendered or replaced. This supports the New
        // Scenario flow where the modal may be opened from another page context.
        document.addEventListener('submit', (ev) => {
            const form = ev.target;
            if (!form || form.id !== 'module-add-scenario-form') return;
            try {
                handleModuleAddScenarioSubmit(ev);
            } catch (err) {
                // let other handlers run; surface error in UI
                setStatus(err instanceof Error ? err.message : 'Error saving scenario.', 'error');
            }
        });

        const loadTestTools = async () => {
            try {
                const url = buildUrl(endpoints.testTools, { search: state.testToolsSearch });
                const data = await request(url, { method: 'GET' });
                state.testTools = Array.isArray(data) ? data : [];
                renderTestToolsList();
            } catch (error) {
                // keep existing state if fetch fails
                renderTestToolsList();
            }
        };

        const loadTestModules = async () => {
            try {
                const params = { search: state.testModulesSearch };
                if (els.testModulesFilterProject && els.testModulesFilterProject.value) {
                    params.project = els.testModulesFilterProject.value;
                }
                const url = buildUrl(endpoints.testModules, params);
                const data = await request(url, { method: 'GET' });
                state.testModules = Array.isArray(data) ? data : [];
                renderTestModulesList();
            } catch (error) {
                renderTestModulesList();
            }
        };

        const openTestToolsModal = (mode, tool = null) => {
            if (!els.testToolsModal) return;
            state.testToolsModalMode = mode;
            if (mode === "create") {
                state.testToolsCurrentId = null;
                state.testToolsForm = { title: "", description: "" };
            } else if ((mode === "edit" || mode === "view") && tool) {
                state.testToolsCurrentId = tool.id;
                state.testToolsForm = { title: tool.title || "", description: tool.description || "", createdAt: tool.created_at, updatedAt: tool.updated_at };
            }
            if (els.testToolsTitle) {
                els.testToolsTitle.value = state.testToolsForm.title || "";
                els.testToolsTitle.readOnly = mode === "view";
            }
            if (els.testToolsDescription) {
                els.testToolsDescription.value = state.testToolsForm.description || "";
                els.testToolsDescription.readOnly = mode === "view";
            }
            if (els.testToolsSubmit) {
                els.testToolsSubmit.textContent = mode === "edit" ? "Update" : "Save";
                els.testToolsSubmit.hidden = mode === "view";
            }
            if (els.testToolsMeta) {
                if (state.testToolsForm.createdAt || state.testToolsForm.updatedAt) {
                    els.testToolsMeta.hidden = false;
                    if (els.testToolsCreated) els.testToolsCreated.textContent = state.testToolsForm.createdAt ? formatDateTime(state.testToolsForm.createdAt) : "--";
                    if (els.testToolsUpdated) els.testToolsUpdated.textContent = state.testToolsForm.updatedAt ? formatDateTime(state.testToolsForm.updatedAt) : "--";
                } else {
                    els.testToolsMeta.hidden = true;
                }
            }
            els.testToolsModal.hidden = false;
            body.classList.add("automation-modal-open");
            if (els.testToolsTitle) els.testToolsTitle.focus();
        };

        const openTestModulesModal = (mode, module = null) => {
            if (!els.testModulesModal) return;
            state.testModulesModalMode = mode;
            if (mode === "create") {
                state.testModulesCurrentId = null;
                state.testModulesForm = { title: "", description: "", project_id: null };
            } else if ((mode === "edit" || mode === "view") && module) {
                state.testModulesCurrentId = module.id;
                state.testModulesForm = {
                    title: module.title || "",
                    description: module.description || "",
                    createdAt: module.created_at,
                    updatedAt: module.updated_at,
                    project_id: module.project_id || module.plan_id || null,
                };
            }
            if (els.testModulesTitle) {
                els.testModulesTitle.value = state.testModulesForm.title || "";
                els.testModulesTitle.readOnly = mode === "view";
            }
            if (els.testModulesDescription) {
                els.testModulesDescription.value = state.testModulesForm.description || "";
                els.testModulesDescription.readOnly = mode === "view";
            }
            // populate projects select
            if (els.testModulesProject) {
                // clear existing
                els.testModulesProject.innerHTML = '<option value="">— Select project —</option>';
                initialProjects.forEach((p) => {
                    const opt = document.createElement('option');
                    opt.value = p.id || '';
                    opt.textContent = p.name || p.title || `Project ${p.id} `;
                    els.testModulesProject.appendChild(opt);
                });
                // set selected value when editing/viewing
                const selectedProjectId = state.testModulesForm && state.testModulesForm.project_id
                    ? String(state.testModulesForm.project_id)
                    : (module && (module.project_id || module.plan_id) ? String(module.project_id || module.plan_id) : '');
                els.testModulesProject.value = selectedProjectId || '';
                els.testModulesProject.disabled = mode === 'view';
            }
            if (els.testModulesSubmit) {
                els.testModulesSubmit.textContent = mode === "edit" ? "Update" : "Save";
                els.testModulesSubmit.hidden = mode === "view";
            }
            if (els.testModulesMeta) {
                if (state.testModulesForm.createdAt || state.testModulesForm.updatedAt) {
                    els.testModulesMeta.hidden = false;
                    if (els.testModulesCreated) els.testModulesCreated.textContent = state.testModulesForm.createdAt ? formatDateTime(state.testModulesForm.createdAt) : "--";
                    if (els.testModulesUpdated) els.testModulesUpdated.textContent = state.testModulesForm.updatedAt ? formatDateTime(state.testModulesForm.updatedAt) : "--";
                } else {
                    els.testModulesMeta.hidden = true;
                }
            }
            els.testModulesModal.hidden = false;
            body.classList.add("automation-modal-open");
            if (els.testModulesTitle) els.testModulesTitle.focus();
        };

        const closeTestModulesModal = () => {
            if (!els.testModulesModal) return;
            els.testModulesModal.hidden = true;
            body.classList.remove("automation-modal-open");
            if (els.testModulesForm) els.testModulesForm.reset && els.testModulesForm.reset();
            state.testModulesModalMode = "create";
            state.testModulesCurrentId = null;
        };

        const closeTestToolsModal = () => {
            if (!els.testToolsModal) return;
            els.testToolsModal.hidden = true;
            body.classList.remove("automation-modal-open");
            if (els.testToolsForm) els.testToolsForm.reset && els.testToolsForm.reset();
            state.testToolsModalMode = "create";
            state.testToolsCurrentId = null;
        };

        const handleTestToolsSubmit = async (event) => {
            event.preventDefault();
            try {
                setStatus("Saving tool…", "info");
                const payload = {
                    title: (els.testToolsTitle.value || "").trim(),
                    description: els.testToolsDescription.value || "",
                };
                if (!payload.title) throw new Error("Tool title is required.");
                const url = endpoints.testTools;
                const created = await request(url, { method: "POST", body: JSON.stringify(payload) });
                // refresh local state
                state.testTools.unshift(created);
                renderTestToolsList();
                closeTestToolsModal();
                setStatus("Tool saved.", "success");
            } catch (error) {
                const message = error instanceof Error ? error.message : "Unable to save tool.";
                setStatus(message, "error");
            }
        };

        const handleTestModulesSubmit = async (event) => {
            event.preventDefault();
            try {
                setStatus("Saving module…", "info");
                const payload = {
                    title: (els.testModulesTitle.value || "").trim(),
                    description: els.testModulesDescription.value || "",
                    project: (els.testModulesProject && els.testModulesProject.value) ? Number(els.testModulesProject.value) : null,
                };
                if (!payload.title) throw new Error("Module title is required.");
                const url = endpoints.testModules;
                const created = await request(url, { method: "POST", body: JSON.stringify(payload) });
                state.testModules.unshift(created);
                renderTestModulesList();
                closeTestModulesModal();
                setStatus("Module saved.", "success");
            } catch (error) {
                const message = error instanceof Error ? error.message : "Unable to save module.";
                setStatus(message, "error");
            }
        };

        const applyEnvironmentFormState = () => {
            if (!state.environmentForm) {
                return;
            }
            state.environmentForm.variables = ensureKeyValueRows(state.environmentForm.variables);
            state.environmentForm.headers = ensureKeyValueRows(state.environmentForm.headers);
            const readOnly = state.environmentModalMode === "view";
            if (els.environmentName) {
                els.environmentName.value = state.environmentForm.name || "";
                els.environmentName.readOnly = readOnly;
            }
            if (els.environmentDescription) {
                els.environmentDescription.value = state.environmentForm.description || "";
                els.environmentDescription.readOnly = readOnly;
            }
            if (els.environmentAddVariable) {
                els.environmentAddVariable.disabled = readOnly;
            }
            if (els.environmentAddHeader) {
                els.environmentAddHeader.disabled = readOnly;
            }
            if (els.environmentSubmit) {
                els.environmentSubmit.hidden = readOnly;
                els.environmentSubmit.textContent = state.environmentModalMode === "edit" ? "Update" : "Save";
            }
            renderEnvironmentRows("variables");
            renderEnvironmentRows("headers");
            renderEnvironmentMeta();
        };

        const openEnvironmentModal = (mode, environment = null) => {
            if (!els.environmentModal) {
                return;
            }
            state.environmentModalMode = mode;
            state.environmentCurrentId = environment ? environment.id : null;
            state.environmentForm = {
                name: environment && environment.name ? environment.name : "",
                description: environment && environment.description ? environment.description : "",
                variables: toKeyValueRows(environment ? environment.variables : null),
                headers: toKeyValueRows(environment ? environment.default_headers : null),
                createdAt: environment && environment.created_at ? environment.created_at : null,
                updatedAt: environment && environment.updated_at ? environment.updated_at : null,
            };
            const header = root.querySelector("#environment-modal-title");
            if (header) {
                if (mode === "edit") {
                    header.textContent = "Edit Environment";
                } else if (mode === "view") {
                    header.textContent = "View Environment";
                } else {
                    header.textContent = "New Environment";
                }
            }
            applyEnvironmentFormState();
            els.environmentModal.hidden = false;
            body.classList.add("automation-modal-open");
            if (mode !== "view" && els.environmentName) {
                window.requestAnimationFrame(() => {
                    els.environmentName.focus();
                });
            }
        };

        const closeEnvironmentModal = () => {
            closeModal(els.environmentModal);
            state.environmentModalMode = "create";
            state.environmentCurrentId = null;
            state.environmentForm = null;
            if (els.environmentSubmit) {
                els.environmentSubmit.hidden = false;
                els.environmentSubmit.textContent = "Save";
            }
        };

        const renderEnvironments = () => {
            if (!els.environmentList) {
                return;
            }
            if (els.metricEnvironments) {
                els.metricEnvironments.textContent = String(state.environments.length);
            }
            if (!state.environments.length) {
                els.environmentList.innerHTML = '<tr><td colspan="6" class="empty">No environments match the current filters.</td></tr>';
                return;
            }
            const rows = state.environments
                .map((env) => {
                    const name = env && env.name ? escapeHtml(env.name) : "Untitled";
                    const description = env && env.description ? escapeHtml(env.description) : "&mdash;";
                    const variableCount = env && env.variables && typeof env.variables === "object"
                        ? Object.keys(env.variables).length
                        : 0;
                    const headerCount = env && env.default_headers && typeof env.default_headers === "object"
                        ? Object.keys(env.default_headers).length
                        : 0;
                    const updatedText = escapeHtml(formatDateTime(env ? env.updated_at : null));
                    return (
                        `\n<tr data-environment-id="${env.id}">\n` +
                        `  <td data-label="Name">${name}</td>\n` +
                        `  <td data-label="Description">${description}</td>\n` +
                        `  <td data-label="Variables">${variableCount}</td>\n` +
                        `  <td data-label="Headers">${headerCount}</td>\n` +
                        `  <td data-label="Updated">${updatedText}</td>\n` +
                        `  <td data-label="Actions">\n` +
                        `    <div class="table-action-group">\n` +
                        `      <button type="button" class="action-button" data-action="view-environment" data-id="${env.id}">View</button>\n` +
                        `      <button type="button" class="action-button" data-action="edit-environment" data-id="${env.id}">Edit</button>\n` +
                        `      <button type="button" class="action-button" data-action="delete-environment" data-id="${env.id}" data-variant="danger">Delete</button>\n` +
                        `    </div>\n` +
                        `  </td>\n` +
                        `</tr>\n`
                    );
                })
                .join("");
            els.environmentList.innerHTML = rows;
        };

        const loadEnvironments = async () => {
            const url = buildUrl(endpoints.environments, { search: state.environmentSearch });
            const data = await request(url, { method: "GET" });
            state.environments = Array.isArray(data) ? data : [];
            renderEnvironments();
        };

        const handleEnvironmentFormInput = (event) => {
            if (!state.environmentForm || state.environmentModalMode === "view") {
                return;
            }
            const target = event.target;
            if (target === els.environmentDescription) {
                state.environmentForm.description = target.value;
                return;
            }
            const group = target.dataset.group;
            const field = target.dataset.field;
            if (!group || !field) {
                return;
            }
            const index = Number(target.dataset.index);
            if (!Number.isFinite(index)) {
                return;
            }
            const bucket = state.environmentForm[group];
            if (!Array.isArray(bucket) || !bucket[index]) {
                return;
            }
            bucket[index][field] = target.value;
        };

        const renderRisks = () => {
            if (!els.riskList) {
                return;
            }
            if (!state.risks.length) {
                els.riskList.innerHTML = '<tr><td colspan="5" class="empty">No risks match the current filters.</td></tr>';
                return;
            }
            const rows = state.risks
                .map((risk) => {
                    const title = risk.title ? escapeHtml(risk.title) : "Untitled";
                    const description = risk.description ? escapeHtml(risk.description) : "&mdash;";
                    return `
                                            < tr data - risk - id="${risk.id}" >
                            <td data-label="Title">${title}</td>
                            <td data-label="Description">${description}</td>
                            <td data-label="Created">${escapeHtml(formatDateTime(risk.created_at))}</td>
                            <td data-label="Updated">${escapeHtml(formatDateTime(risk.updated_at))}</td>
                            <td data-label="Actions">
                                <div class="table-action-group">
                                    <button type="button" class="action-button" data-action="view-risk" data-id="${risk.id}">View</button>
                                    <button type="button" class="action-button" data-action="edit-risk" data-id="${risk.id}">Edit</button>
                                    <button type="button" class="action-button" data-action="delete-risk" data-id="${risk.id}" data-variant="danger">Delete</button>
                                </div>
                            </td>
                        </tr >
            `;
                })
                .join("");
            els.riskList.innerHTML = rows;
        };

        const renderMitigationPlans = () => {
            if (!els.mitigationList) {
                return;
            }
            if (!state.mitigationPlans.length) {
                els.mitigationList.innerHTML = '<tr><td colspan="5" class="empty">No mitigation plans match the current filters.</td></tr>';
                return;
            }
            const rows = state.mitigationPlans
                .map((plan) => {
                    const title = plan.title ? escapeHtml(plan.title) : "Untitled";
                    const description = plan.description ? escapeHtml(plan.description) : "&mdash;";
                    return `
            < tr data - mitigation - id="${plan.id}" >
                            <td data-label="Title">${title}</td>
                            <td data-label="Description">${description}</td>
                            <td data-label="Created">${escapeHtml(formatDateTime(plan.created_at))}</td>
                            <td data-label="Updated">${escapeHtml(formatDateTime(plan.updated_at))}</td>
                            <td data-label="Actions">
                                <div class="table-action-group">
                                    <button type="button" class="action-button" data-action="view-mitigation" data-id="${plan.id}">View</button>
                                    <button type="button" class="action-button" data-action="edit-mitigation" data-id="${plan.id}">Edit</button>
                                    <button type="button" class="action-button" data-action="delete-mitigation" data-id="${plan.id}" data-variant="danger">Delete</button>
                                </div>
                            </td>
                        </tr >
            `;
                })
                .join("");
            els.mitigationList.innerHTML = rows;
        };

        const renderMappings = () => {
            if (!els.mappingList) {
                return;
            }
            if (!state.mappings.length) {
                els.mappingList.innerHTML = '<tr><td colspan="5" class="empty">No risk to mitigation links found for the current filters.</td></tr>';
                return;
            }
            const rows = state.mappings
                .map((mapping, index) => {
                    const riskTitle = mapping.risk_title ? escapeHtml(mapping.risk_title) : "Untitled";
                    const mitigationTitle = mapping.mitigation_plan_title ? escapeHtml(mapping.mitigation_plan_title) : "Untitled";
                    const impact = mapping.impact ? escapeHtml(mapping.impact) : "&mdash;";
                    return `
            < tr data - mapping - id="${mapping.id}" >
                            <td data-label="#">${index + 1}</td>
                            <td data-label="Risk">
                                <strong>${riskTitle}</strong>
                                ${mapping.risk_description ? `<div class="table-secondary">${escapeHtml(mapping.risk_description)}</div>` : ""}
                            </td>
                            <td data-label="Mitigation Plan">
                                <strong>${mitigationTitle}</strong>
                                ${mapping.mitigation_plan_description ? `<div class="table-secondary">${escapeHtml(mapping.mitigation_plan_description)}</div>` : ""}
                            </td>
                            <td data-label="Impact">${impact}</td>
                            <td data-label="Actions">
                                <div class="table-action-group">
                                    <button type="button" class="action-button" data-action="view-mapping" data-id="${mapping.id}">View</button>
                                    <button type="button" class="action-button" data-action="edit-mapping" data-id="${mapping.id}">Edit</button>
                                    <button type="button" class="action-button" data-action="delete-mapping" data-id="${mapping.id}" data-variant="danger">Delete</button>
                                </div>
                            </td>
                        </tr >
            `;
                })
                .join("");
            els.mappingList.innerHTML = rows;
        };

        const closeModal = (modal) => {
            if (!modal) {
                return;
            }
            modal.hidden = true;
            body.classList.remove("automation-modal-open");
        };

        const resetRiskFormState = () => {
            if (!els.riskForm) {
                return;
            }
            els.riskForm.reset();
            if (els.riskTitle) {
                els.riskTitle.readOnly = false;
                els.riskTitle.disabled = false;
            }
            if (els.riskDescription) {
                els.riskDescription.readOnly = false;
                els.riskDescription.disabled = false;
            }
            if (els.riskSubmit) {
                els.riskSubmit.hidden = false;
                els.riskSubmit.textContent = "Save";
            }
            const header = root.querySelector("#risk-modal-title");
            if (header) {
                header.textContent = "New Risk";
            }
        };

        const resetMitigationFormState = () => {
            if (!els.mitigationForm) {
                return;
            }
            els.mitigationForm.reset();
            if (els.mitigationTitle) {
                els.mitigationTitle.readOnly = false;
                els.mitigationTitle.disabled = false;
            }
            if (els.mitigationDescription) {
                els.mitigationDescription.readOnly = false;
                els.mitigationDescription.disabled = false;
            }
            if (els.mitigationSubmit) {
                els.mitigationSubmit.hidden = false;
                els.mitigationSubmit.textContent = "Save";
            }
            const header = root.querySelector("#mitigation-modal-title");
            if (header) {
                header.textContent = "New Mitigation Plan";
            }
        };

        const resetMappingFormState = () => {
            if (!els.mappingForm) {
                return;
            }
            els.mappingForm.reset();
            if (els.mappingRiskSelect) {
                els.mappingRiskSelect.disabled = false;
            }
            if (els.mappingMitigationSelect) {
                els.mappingMitigationSelect.disabled = false;
            }
            if (els.mappingImpact) {
                els.mappingImpact.readOnly = false;
                els.mappingImpact.disabled = false;
            }
            if (els.mappingSubmit) {
                els.mappingSubmit.hidden = false;
                els.mappingSubmit.textContent = "Save";
            }
            const header = root.querySelector("#mapping-modal-title");
            if (header) {
                header.textContent = "Link Risk to Mitigation";
            }
        };

        const openRiskModal = (mode, risk = null) => {
            if (!els.riskModal) {
                return;
            }
            resetRiskFormState();
            state.riskModalMode = mode;
            state.riskCurrentId = risk ? risk.id : null;
            if (mode === "edit" && risk) {
                if (els.riskTitle) {
                    els.riskTitle.value = risk.title || "";
                }
                if (els.riskDescription) {
                    els.riskDescription.value = risk.description || "";
                }
                if (els.riskSubmit) {
                    els.riskSubmit.textContent = "Update";
                }
                const header = root.querySelector("#risk-modal-title");
                if (header) {
                    header.textContent = "Edit Risk";
                }
            } else if (mode === "view" && risk) {
                if (els.riskTitle) {
                    els.riskTitle.value = risk.title || "";
                    els.riskTitle.readOnly = true;
                    els.riskTitle.disabled = true;
                }
                if (els.riskDescription) {
                    els.riskDescription.value = risk.description || "";
                    els.riskDescription.readOnly = true;
                    els.riskDescription.disabled = true;
                }
                if (els.riskSubmit) {
                    els.riskSubmit.hidden = true;
                }
                const header = root.querySelector("#risk-modal-title");
                if (header) {
                    header.textContent = "View Risk";
                }
            }
            els.riskModal.hidden = false;
            body.classList.add("automation-modal-open");
            if (els.riskTitle && els.riskSubmit && !els.riskSubmit.hidden) {
                window.requestAnimationFrame(() => {
                    els.riskTitle.focus();
                });
            }
        };

        const openMitigationModal = (mode, mitigation = null) => {
            if (!els.mitigationModal) {
                return;
            }
            resetMitigationFormState();
            state.mitigationModalMode = mode;
            state.mitigationCurrentId = mitigation ? mitigation.id : null;
            if (mode === "edit" && mitigation) {
                if (els.mitigationTitle) {
                    els.mitigationTitle.value = mitigation.title || "";
                }
                if (els.mitigationDescription) {
                    els.mitigationDescription.value = mitigation.description || "";
                }
                if (els.mitigationSubmit) {
                    els.mitigationSubmit.textContent = "Update";
                }
                const header = root.querySelector("#mitigation-modal-title");
                if (header) {
                    header.textContent = "Edit Mitigation Plan";
                }
            } else if (mode === "view" && mitigation) {
                if (els.mitigationTitle) {
                    els.mitigationTitle.value = mitigation.title || "";
                    els.mitigationTitle.readOnly = true;
                    els.mitigationTitle.disabled = true;
                }
                if (els.mitigationDescription) {
                    els.mitigationDescription.value = mitigation.description || "";
                    els.mitigationDescription.readOnly = true;
                    els.mitigationDescription.disabled = true;
                }
                if (els.mitigationSubmit) {
                    els.mitigationSubmit.hidden = true;
                }
                const header = root.querySelector("#mitigation-modal-title");
                if (header) {
                    header.textContent = "View Mitigation Plan";
                }
            }
            els.mitigationModal.hidden = false;
            body.classList.add("automation-modal-open");
            if (els.mitigationTitle && els.mitigationSubmit && !els.mitigationSubmit.hidden) {
                window.requestAnimationFrame(() => {
                    els.mitigationTitle.focus();
                });
            }
        };

        const populateMappingSelects = (selectedRiskId, selectedMitigationId) => {
            if (!els.mappingRiskSelect || !els.mappingMitigationSelect) {
                return;
            }
            const riskOptions = state.risks
                .map((risk) => `< option value = "${risk.id}" > ${escapeHtml(risk.title || "Untitled")}</option > `)
                .join("");
            const mitigationOptions = state.mitigationPlans
                .map((plan) => `< option value = "${plan.id}" > ${escapeHtml(plan.title || "Untitled")}</option > `)
                .join("");
            if (riskOptions) {
                els.mappingRiskSelect.innerHTML = riskOptions;
                if (selectedRiskId !== undefined && selectedRiskId !== null) {
                    els.mappingRiskSelect.value = String(selectedRiskId);
                } else {
                    els.mappingRiskSelect.selectedIndex = 0;
                }
                els.mappingRiskSelect.disabled = false;
            } else {
                els.mappingRiskSelect.innerHTML = '<option value="" disabled selected>No risks available</option>';
                els.mappingRiskSelect.disabled = true;
            }
            if (mitigationOptions) {
                els.mappingMitigationSelect.innerHTML = mitigationOptions;
                if (selectedMitigationId !== undefined && selectedMitigationId !== null) {
                    els.mappingMitigationSelect.value = String(selectedMitigationId);
                } else {
                    els.mappingMitigationSelect.selectedIndex = 0;
                }
                els.mappingMitigationSelect.disabled = false;
            } else {
                els.mappingMitigationSelect.innerHTML = '<option value="" disabled selected>No mitigation plans available</option>';
                els.mappingMitigationSelect.disabled = true;
            }
        };

        const openMappingModal = async (mode, mapping = null) => {
            if (!els.mappingModal) {
                return;
            }
            // If risks or mitigations are not loaded (e.g., when this module is mounted on
            // the Test Plans page and initial data wasn't injected), try to load them.
            if (!state.risks.length || !state.mitigationPlans.length || !state.mappings.length) {
                try {
                    // ensure the lists required by the mapping modal are loaded
                    await Promise.all([loadRisks(), loadMitigationPlans(), loadMappings()]);
                } catch (err) {
                    // ignore fetch errors here; we'll show the existing error below
                }
            }
            if (!state.risks.length || !state.mitigationPlans.length) {
                setStatus("Add at least one risk and mitigation plan before creating links.", "error");
                return;
            }
            resetMappingFormState();
            state.mappingModalMode = mode;
            state.mappingCurrentId = mapping ? mapping.id : null;
            populateMappingSelects(mapping ? mapping.risk : null, mapping ? mapping.mitigation_plan : null);
            if (mode === "edit" && mapping) {
                if (els.mappingSubmit) {
                    els.mappingSubmit.textContent = "Update";
                }
                if (els.mappingImpact) {
                    els.mappingImpact.value = mapping.impact || "";
                }
                const header = root.querySelector("#mapping-modal-title");
                if (header) {
                    header.textContent = "Edit Risk to Mitigation";
                }
            } else if (mode === "view" && mapping) {
                if (els.mappingRiskSelect) {
                    els.mappingRiskSelect.value = String(mapping.risk);
                    els.mappingRiskSelect.disabled = true;
                }
                if (els.mappingMitigationSelect) {
                    els.mappingMitigationSelect.value = String(mapping.mitigation_plan);
                    els.mappingMitigationSelect.disabled = true;
                }
                if (els.mappingImpact) {
                    els.mappingImpact.value = mapping.impact || "";
                    els.mappingImpact.readOnly = true;
                    els.mappingImpact.disabled = true;
                }
                if (els.mappingSubmit) {
                    els.mappingSubmit.hidden = true;
                }
                const header = root.querySelector("#mapping-modal-title");
                if (header) {
                    header.textContent = "View Linked Mitigation";
                }
            } else {
                if (els.mappingImpact) {
                    els.mappingImpact.value = "";
                }
            }
            els.mappingModal.hidden = false;
            body.classList.add("automation-modal-open");
            if (els.mappingRiskSelect && els.mappingSubmit && !els.mappingSubmit.hidden) {
                window.requestAnimationFrame(() => {
                    els.mappingRiskSelect.focus();
                });
            }
        };

        const loadRisks = async () => {
            const url = buildUrl(endpoints.risks, { search: state.riskSearch });
            const data = await request(url, { method: "GET" });
            state.risks = Array.isArray(data) ? data : [];
            renderRisks();
        };

        const loadMitigationPlans = async () => {
            const url = buildUrl(endpoints.mitigations, { search: state.mitigationSearch });
            const data = await request(url, { method: "GET" });
            state.mitigationPlans = Array.isArray(data) ? data : [];
            renderMitigationPlans();
        };

        const loadMappings = async () => {
            const url = buildUrl(endpoints.mappings, { search: state.mappingSearch });
            const data = await request(url, { method: "GET" });
            state.mappings = Array.isArray(data) ? data : [];
            renderMappings();
        };

        if (els.environmentSearch) {
            els.environmentSearch.value = state.environmentSearch;
            els.environmentSearch.addEventListener(
                "input",
                debounce(() => {
                    state.environmentSearch = (els.environmentSearch.value || "").trim();
                    loadEnvironments().catch((error) => setStatus(error.message, "error"));
                }, 250),
            );
        }

        if (els.riskSearch) {
            els.riskSearch.value = state.riskSearch;
            els.riskSearch.addEventListener(
                "input",
                debounce(() => {
                    state.riskSearch = (els.riskSearch.value || "").trim();
                    loadRisks().catch((error) => setStatus(error.message, "error"));
                }, 250),
            );
        }

        if (els.mitigationSearch) {
            els.mitigationSearch.value = state.mitigationSearch;
            els.mitigationSearch.addEventListener(
                "input",
                debounce(() => {
                    state.mitigationSearch = (els.mitigationSearch.value || "").trim();
                    loadMitigationPlans().catch((error) => setStatus(error.message, "error"));
                }, 250),
            );
        }

        if (els.mappingSearch) {
            els.mappingSearch.value = state.mappingSearch;
            els.mappingSearch.addEventListener(
                "input",
                debounce(() => {
                    state.mappingSearch = (els.mappingSearch.value || "").trim();
                    loadMappings().catch((error) => setStatus(error.message, "error"));
                }, 250),
            );
        }

        renderEnvironments();
        renderRisks();
        renderMitigationPlans();
        renderMappings();

        if (initialSection) {
            highlightSection(initialSection);
        }
        applyHashSection();
        window.addEventListener("hashchange", applyHashSection);

        const closeRiskModal = () => {
            closeModal(els.riskModal);
            resetRiskFormState();
            state.riskModalMode = "create";
            state.riskCurrentId = null;
        };

        const closeMitigationModal = () => {
            closeModal(els.mitigationModal);
            resetMitigationFormState();
            state.mitigationModalMode = "create";
            state.mitigationCurrentId = null;
        };

        const closeMappingModal = () => {
            closeModal(els.mappingModal);
            resetMappingFormState();
            state.mappingModalMode = "create";
            state.mappingCurrentId = null;
        };

        root.addEventListener("click", async (event) => {
            const trigger = event.target.closest("[data-action]");
            if (!trigger) {
                return;
            }
            // Only handle clicks that originated inside this module root to avoid
            // duplicate handling when multiple modules are mounted on the same page
            // (for example, automation.js + data_management.js). If the trigger is
            // not contained within our root, ignore it and allow other listeners to run.
            if (!root.contains(trigger)) {
                return;
            }
            // If the click originated inside the automation scenario table, let
            // the automation.js handler deal with it to avoid duplicate prompts
            // and duplicate DELETE requests. This supports pages where both
            // modules are mounted (automation + data-management).
            try {
                const automationScenarioTable = document.querySelector('[data-role="scenario-table-body"]');
                if (automationScenarioTable && automationScenarioTable.contains(trigger)) {
                    return;
                }
            } catch (e) { /* ignore */ }
            const action = trigger.dataset.action;
            // some tables use data-id, test-tools uses data-tool-id and modules use data-module-id — support all
            const rawId = trigger.dataset.id || trigger.dataset.toolId || trigger.dataset.moduleId || trigger.getAttribute('data-tool-id') || trigger.getAttribute('data-module-id');
            const id = rawId ? Number(rawId) : null;

            switch (action) {
                case "open-environment-modal":
                    event.preventDefault();
                    openEnvironmentModal("create");
                    break;
                case "close-environment-modal":
                    event.preventDefault();
                    closeEnvironmentModal();
                    break;
                case "view-environment": {
                    event.preventDefault();
                    const environment = state.environments.find((item) => item.id === id);
                    if (environment) {
                        openEnvironmentModal("view", environment);
                    }
                    break;
                }
                case "edit-environment": {
                    event.preventDefault();
                    const environment = state.environments.find((item) => item.id === id);
                    if (environment) {
                        openEnvironmentModal("edit", environment);
                    }
                    break;
                }
                case "delete-environment": {
                    event.preventDefault();
                    if (!id) {
                        break;
                    }
                    if (!window.confirm("Are you sure you want to delete this environment?")) {
                        break;
                    }
                    try {
                        await request(`${endpoints.environments}${id}/`, { method: "DELETE" });
                        setStatus("Environment deleted.", "success");
                        await loadEnvironments();
                    } catch (error) {
                        setStatus(error.message, "error");
                    }
                    break;
                }

                case "view-test-tool": {
                    event.preventDefault();
                    const tool = state.testTools.find((item) => item.id === id);
                    if (tool) {
                        openTestToolsModal("view", tool);
                    }
                    break;
                }
                case "add-scenario-to-module": {
                    event.preventDefault();
                    if (!id) break;
                    openModuleScenarioModal('create', id);
                    break;
                }
                case "toggle-module": {
                    event.preventDefault();
                    if (!id) break;
                    toggleModule(id);
                    break;
                }


                case "close-module-add-scenario-modal": {
                    event.preventDefault();
                    closeModuleScenarioModal();
                    break;
                }

                case "view-scenario": {
                    event.preventDefault();
                    const sid = trigger.dataset.scenarioId ? Number(trigger.dataset.scenarioId) : null;
                    if (!sid) break;
                    // find scenario in state across modules
                    let found = null;
                    state.testModules.forEach((m) => {
                        if (Array.isArray(m.scenarios)) {
                            const s = m.scenarios.find((sc) => Number(sc.id) === Number(sid));
                            if (s) {
                                found = { scenario: s, moduleId: m.id };
                            }
                        }
                    });
                    if (found) {
                        openModuleScenarioModal('view', found.moduleId, found.scenario);
                    } else {
                        // as a fallback, fetch scenario from API
                        (async () => {
                            try {
                                const urlBase = endpoints.scenarios || (apiEndpoints.scenarios ? ensureTrailingSlash(apiEndpoints.scenarios) : '/api/core/test-scenarios/');
                                const data = await request(`${urlBase}${sid}/`, { method: 'GET' });
                                openModuleScenarioModal('view', data.module || null, data);
                            } catch (err) {
                                setStatus(err instanceof Error ? err.message : 'Unable to fetch scenario.', 'error');
                            }
                        })();
                    }
                    break;
                }
                case "edit-scenario": {
                    event.preventDefault();
                    const sid = trigger.dataset.scenarioId ? Number(trigger.dataset.scenarioId) : null;
                    if (!sid) break;
                    let found = null;
                    state.testModules.forEach((m) => {
                        if (Array.isArray(m.scenarios)) {
                            const s = m.scenarios.find((sc) => Number(sc.id) === Number(sid));
                            if (s) found = { scenario: s, moduleId: m.id };
                        }
                    });
                    if (found) {
                        openModuleScenarioModal('edit', found.moduleId, found.scenario);
                    } else {
                        (async () => {
                            try {
                                const urlBase = endpoints.scenarios || (apiEndpoints.scenarios ? ensureTrailingSlash(apiEndpoints.scenarios) : '/api/core/test-scenarios/');
                                const data = await request(`${urlBase}${sid}/`, { method: 'GET' });
                                openModuleScenarioModal('edit', data.module || null, data);
                            } catch (err) {
                                setStatus(err instanceof Error ? err.message : 'Unable to fetch scenario.', 'error');
                            }
                        })();
                    }
                    break;
                }
                case "delete-scenario": {
                    event.preventDefault();
                    const sid = trigger.dataset.scenarioId ? Number(trigger.dataset.scenarioId) : null;
                    if (!sid) break;
                    if (!window.confirm('Are you sure you want to delete this scenario?')) break;
                    try {
                        const urlBase = endpoints.scenarios || (apiEndpoints.scenarios ? ensureTrailingSlash(apiEndpoints.scenarios) : '/api/core/test-scenarios/');
                        await request(`${urlBase}${sid}/`, { method: 'DELETE' });
                        // remove from state
                        let parentModuleId = null;
                        state.testModules.forEach((m) => {
                            if (Array.isArray(m.scenarios)) {
                                const idx = m.scenarios.findIndex((s) => Number(s.id) === Number(sid));
                                if (idx > -1) {
                                    parentModuleId = m.id;
                                    m.scenarios.splice(idx, 1);
                                }
                            }
                        });
                        renderTestModulesList();
                        // keep parent module expanded if known
                        if (parentModuleId) ensureModuleExpanded(parentModuleId);
                        setStatus('Scenario deleted.', 'success');
                        showToast('Scenario deleted.', 'success');
                        try { document.dispatchEvent(new CustomEvent('test-modules-changed', { detail: { moduleId: parentModuleId } })); } catch (e) { }
                    } catch (err) {
                        const message = err instanceof Error ? err.message : 'Unable to delete scenario.';
                        setStatus(message, 'error');
                        showToast(message, 'error');
                    }
                    break;
                }
                case "add-case": {
                    event.preventDefault();
                    const sid = trigger.dataset.scenarioId ? Number(trigger.dataset.scenarioId) : null;
                    if (!sid) break;
                    const modal = document.querySelector('[data-role="module-add-case-modal"]');
                    const input = document.getElementById('module-add-case-scenario-id');
                    if (input) input.value = sid;
                    toggleDependencyFields(false);
                    if (sid) loadDependencyOptions(sid);
                    if (modal) {
                        // ensure modal title reflects creation
                        const modalTitle = document.getElementById('module-add-case-modal-title');
                        if (modalTitle) modalTitle.textContent = 'Add Test Case';
                        try {
                            const desc = document.getElementById('module-add-case-description');
                            if (desc) desc.value = '';
                        } catch (e) { /* ignore */ }
                        try { initModuleCaseDescriptionEditor(); } catch (e) { /* ignore */ }
                        modal.hidden = false;
                        body.classList.add('automation-modal-open');
                        const title = document.getElementById('module-add-case-title');
                        if (title) title.focus();
                    }
                    break;
                }
                case "close-module-add-case-modal": {
                    event.preventDefault();
                    const modal = document.querySelector('[data-role="module-add-case-modal"]');
                    if (modal) {
                        modal.hidden = true;
                        body.classList.remove('automation-modal-open');
                        const form = document.getElementById('module-add-case-form');
                        if (form) form.reset();
                        toggleDependencyFields(false);
                        try { removeModuleCaseDescriptionEditor(); } catch (e) { /* ignore */ }
                    }
                    break;
                }

                case "edit-test-tool": {
                    event.preventDefault();
                    const tool = state.testTools.find((item) => item.id === id);
                    if (tool) {
                        openTestToolsModal("edit", tool);
                    }
                    break;
                }

                case "delete-test-tool": {
                    event.preventDefault();
                    if (!id) break;
                    if (!window.confirm("Are you sure you want to delete this tool?")) break;
                    try {
                        await request(`${endpoints.testTools}${id}/`, { method: "DELETE" });
                        setStatus("Tool deleted.", "success");
                        await loadTestTools();
                    } catch (error) {
                        setStatus(error.message, "error");
                    }
                    break;
                }
                case "view-test-module": {
                    event.preventDefault();
                    const module = state.testModules.find((item) => item.id === id);
                    if (module) {
                        openTestModulesModal("view", module);
                    }
                    break;
                }

                case "edit-test-module": {
                    event.preventDefault();
                    const module = state.testModules.find((item) => item.id === id);
                    if (module) {
                        openTestModulesModal("edit", module);
                    }
                    break;
                }

                case "delete-test-module": {
                    event.preventDefault();
                    if (!id) break;
                    if (!window.confirm("Are you sure you want to delete this module?")) break;
                    try {
                        await request(`${endpoints.testModules}${id}/`, { method: "DELETE" });
                        setStatus("Module deleted.", "success");
                        showToast("Module deleted.", "success");
                        await loadTestModules();
                    } catch (error) {
                        const message = error && error.message ? error.message : "Unable to delete module.";
                        setStatus(message, "error");
                        showToast(message, "error");
                    }
                    break;
                }
                case "environment-add-variable":
                    event.preventDefault();
                    if (!state.environmentForm || state.environmentModalMode === "view") {
                        break;
                    }
                    state.environmentForm.variables.push({ key: "", value: "" });
                    renderEnvironmentRows("variables");
                    window.requestAnimationFrame(() => {
                        focusEnvironmentRow("variables", state.environmentForm.variables.length - 1);
                    });
                    break;
                case "environment-add-header":
                    event.preventDefault();
                    if (!state.environmentForm || state.environmentModalMode === "view") {
                        break;
                    }
                    state.environmentForm.headers.push({ key: "", value: "" });
                    renderEnvironmentRows("headers");
                    window.requestAnimationFrame(() => {
                        focusEnvironmentRow("headers", state.environmentForm.headers.length - 1);
                    });
                    break;
                case "environment-remove-row": {
                    event.preventDefault();
                    if (!state.environmentForm || state.environmentModalMode === "view") {
                        break;
                    }
                    const group = trigger.dataset.group;
                    const index = Number(trigger.dataset.index);
                    if (!group || !Number.isFinite(index)) {
                        break;
                    }
                    const bucket = state.environmentForm[group];
                    if (!Array.isArray(bucket) || !bucket[index]) {
                        break;
                    }
                    bucket.splice(index, 1);
                    if (!bucket.length) {
                        bucket.push({ key: "", value: "" });
                    }
                    renderEnvironmentRows(group);
                    break;
                }
                case "open-risk-modal":
                    event.preventDefault();
                    openRiskModal("create");
                    break;
                case "close-risk-modal":
                    event.preventDefault();
                    closeRiskModal();
                    break;
                case "open-mitigation-modal":
                    event.preventDefault();
                    openMitigationModal("create");
                    break;
                case "close-mitigation-modal":
                    event.preventDefault();
                    closeMitigationModal();
                    break;
                case "open-mapping-modal":
                    event.preventDefault();
                    openMappingModal("create");
                    break;
                case "close-mapping-modal":
                    event.preventDefault();
                    closeMappingModal();
                    break;
                case "view-risk": {
                    event.preventDefault();
                    const risk = state.risks.find((item) => item.id === id);
                    if (risk) {
                        openRiskModal("view", risk);
                    }
                    break;
                }
                case "edit-risk": {
                    event.preventDefault();
                    const risk = state.risks.find((item) => item.id === id);
                    if (risk) {
                        openRiskModal("edit", risk);
                    }
                    break;
                }
                case "delete-risk": {
                    event.preventDefault();
                    if (!id) {
                        break;
                    }
                    if (!window.confirm("Are you sure you want to delete this risk?")) {
                        break;
                    }
                    try {
                        await request(`${endpoints.risks}${id}/`, { method: "DELETE" });
                        setStatus("Risk deleted.", "success");
                        await Promise.all([loadRisks(), loadMappings()]);
                    } catch (error) {
                        setStatus(error.message, "error");
                    }
                    break;
                }
                case "view-mitigation": {
                    event.preventDefault();
                    const mitigation = state.mitigationPlans.find((item) => item.id === id);
                    if (mitigation) {
                        openMitigationModal("view", mitigation);
                    }
                    break;
                }
                case "edit-mitigation": {
                    event.preventDefault();
                    const mitigation = state.mitigationPlans.find((item) => item.id === id);
                    if (mitigation) {
                        openMitigationModal("edit", mitigation);
                    }
                    break;
                }
                case "delete-mitigation": {
                    event.preventDefault();
                    if (!id) {
                        break;
                    }
                    if (!window.confirm("Are you sure you want to delete this mitigation plan?")) {
                        break;
                    }
                    try {
                        await request(`${endpoints.mitigations}${id}/`, { method: "DELETE" });
                        setStatus("Mitigation plan deleted.", "success");
                        await Promise.all([loadMitigationPlans(), loadMappings()]);
                    } catch (error) {
                        setStatus(error.message, "error");
                    }
                    break;
                }
                case "view-mapping": {
                    event.preventDefault();
                    const mapping = state.mappings.find((item) => item.id === id);
                    if (mapping) {
                        openMappingModal("view", mapping);
                    }
                    break;
                }
                case "edit-mapping": {
                    event.preventDefault();
                    const mapping = state.mappings.find((item) => item.id === id);
                    if (mapping) {
                        openMappingModal("edit", mapping);
                    }
                    break;
                }
                case "delete-mapping": {
                    event.preventDefault();
                    if (!id) {
                        break;
                    }
                    if (!window.confirm("Are you sure you want to delete this risk to mitigation link?")) {
                        break;
                    }
                    try {
                        await request(`${endpoints.mappings}${id}/`, { method: "DELETE" });
                        setStatus("Link deleted.", "success");
                        await loadMappings();
                    } catch (error) {
                        setStatus(error.message, "error");
                    }
                    break;
                }
                case "refresh-data":
                    event.preventDefault();
                    try {
                        await Promise.all([loadEnvironments(), loadRisks(), loadMitigationPlans(), loadMappings()]);
                        setStatus("Data refreshed.", "success");
                    } catch (error) {
                        setStatus(error.message, "error");
                    }
                    break;
                default:
                    break;
            }
        });

        // separate input handler for search inputs (we want debounce behaviour)
        root.addEventListener('input', debounce((event) => {
            const target = event.target;
            if (!target) return;
            const action = target.dataset && target.dataset.action;
            if (action === 'module-scenario-search') {
                const mid = target.dataset.moduleId ? Number(target.dataset.moduleId) : null;
                if (!mid) return;
                // capture caret/selection so we can restore it after re-render
                let selStart = null;
                let selEnd = null;
                try {
                    if (typeof target.selectionStart === 'number') {
                        selStart = target.selectionStart;
                        selEnd = target.selectionEnd;
                    }
                } catch (e) {
                    // ignore if not supported
                }
                state.moduleScenarioSearch[mid] = (target.value || '').trim();
                // re-render only modules list so filter applies
                renderTestModulesList();
                ensureModuleExpanded(mid);
                // restore focus & selection to the new input element (DOM was re-rendered)
                window.setTimeout(() => {
                    const newInput = root.querySelector(`[data-action="module-scenario-search"][data-module-id="${mid}"]`);
                    if (newInput) {
                        newInput.focus();
                        try {
                            if (selStart !== null && typeof newInput.setSelectionRange === 'function') {
                                newInput.setSelectionRange(selStart, selEnd);
                            }
                        } catch (err) {
                            // ignore selection restore errors
                        }
                    }
                }, 0);
            }
        }, 250));

        if (els.environmentForm) {
            els.environmentForm.addEventListener("input", handleEnvironmentFormInput);
            els.environmentForm.addEventListener("submit", async (event) => {
                event.preventDefault();
                if (!state.environmentForm) {
                    return;
                }
                const name = (state.environmentForm.name || "").trim();
                if (!name) {
                    setStatus("Environment name is required.", "error");
                    if (els.environmentName) {
                        els.environmentName.focus();
                    }
                    return;
                }
                const payload = {
                    name,
                    description: state.environmentForm.description || "",
                    variables: keyValueRowsToObject(state.environmentForm.variables),
                    default_headers: keyValueRowsToObject(state.environmentForm.headers),
                };
                try {
                    if (state.environmentModalMode === "edit" && state.environmentCurrentId) {
                        await request(`${endpoints.environments}${state.environmentCurrentId}/`, {
                            method: "PATCH",
                            body: JSON.stringify(payload),
                        });
                        setStatus("Environment updated successfully.", "success");
                    } else {
                        await request(endpoints.environments, {
                            method: "POST",
                            body: JSON.stringify(payload),
                        });
                        setStatus("Environment created successfully.", "success");
                    }
                    closeEnvironmentModal();
                    await loadEnvironments();
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    // Translate DB/DRF unique constraint message into a friendlier UX message
                    if (message && message.toLowerCase().includes('unique')) {
                        setStatus('This risk → mitigation link already exists.', 'error');
                    } else {
                        setStatus(message, 'error');
                    }
                    // Refresh mappings to reflect the true server state
                    try {
                        await loadMappings();
                    } catch (_err) {
                        // ignore
                    }
                }
            });
        }

        if (els.riskForm) {
            els.riskForm.addEventListener("submit", async (event) => {
                event.preventDefault();
                const title = els.riskTitle ? (els.riskTitle.value || "").trim() : "";
                const description = els.riskDescription ? (els.riskDescription.value || "").trim() : "";
                if (!title) {
                    setStatus("Risk title is required.", "error");
                    return;
                }
                const payload = { title, description };
                try {
                    if (state.riskModalMode === "edit" && state.riskCurrentId) {
                        await request(`${endpoints.risks}${state.riskCurrentId}/`, {
                            method: "PATCH",
                            body: JSON.stringify(payload),
                        });
                        setStatus("Risk updated successfully.", "success");
                    } else {
                        await request(endpoints.risks, {
                            method: "POST",
                            body: JSON.stringify(payload),
                        });
                        setStatus("Risk created successfully.", "success");
                    }
                    closeRiskModal();
                    await Promise.all([loadRisks(), loadMappings()]);
                } catch (error) {
                    setStatus(error.message, "error");
                }
            });
        }

        if (els.mitigationForm) {
            els.mitigationForm.addEventListener("submit", async (event) => {
                event.preventDefault();
                const title = els.mitigationTitle ? (els.mitigationTitle.value || "").trim() : "";
                const description = els.mitigationDescription ? (els.mitigationDescription.value || "").trim() : "";
                if (!title) {
                    setStatus("Mitigation title is required.", "error");
                    return;
                }
                const payload = { title, description };
                try {
                    if (state.mitigationModalMode === "edit" && state.mitigationCurrentId) {
                        await request(`${endpoints.mitigations}${state.mitigationCurrentId}/`, {
                            method: "PATCH",
                            body: JSON.stringify(payload),
                        });
                        setStatus("Mitigation plan updated successfully.", "success");
                    } else {
                        await request(endpoints.mitigations, {
                            method: "POST",
                            body: JSON.stringify(payload),
                        });
                        setStatus("Mitigation plan created successfully.", "success");
                    }
                    closeMitigationModal();
                    await Promise.all([loadMitigationPlans(), loadMappings()]);
                } catch (error) {
                    setStatus(error.message, "error");
                }
            });
        }

        if (els.mappingForm) {
            els.mappingForm.addEventListener("submit", async (event) => {
                event.preventDefault();
                const riskId = els.mappingRiskSelect ? els.mappingRiskSelect.value : "";
                const mitigationId = els.mappingMitigationSelect ? els.mappingMitigationSelect.value : "";
                const impact = els.mappingImpact ? (els.mappingImpact.value || "").trim() : "";
                if (!riskId) {
                    setStatus("Select a risk to link.", "error");
                    return;
                }
                if (!mitigationId) {
                    setStatus("Select a mitigation plan to link.", "error");
                    return;
                }
                const payload = {
                    risk: Number(riskId),
                    mitigation_plan: Number(mitigationId),
                    impact,
                };
                try {
                    if (state.mappingModalMode === "edit" && state.mappingCurrentId) {
                        await request(`${endpoints.mappings}${state.mappingCurrentId}/`, {
                            method: "PATCH",
                            body: JSON.stringify(payload),
                        });
                        setStatus("Link updated successfully.", "success");
                    } else {
                        await request(endpoints.mappings, {
                            method: "POST",
                            body: JSON.stringify(payload),
                        });
                        setStatus("Link created successfully.", "success");
                    }
                    closeMappingModal();
                    await loadMappings();
                } catch (error) {
                    setStatus(error.message, "error");
                }
            });
        }

        // Keep Escape key behaviour packed in a dedicated handler
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                if (els.environmentModal && !els.environmentModal.hidden) {
                    closeEnvironmentModal();
                } else if (els.mappingModal && !els.mappingModal.hidden) {
                    closeMappingModal();
                } else if (els.mitigationModal && !els.mitigationModal.hidden) {
                    closeMitigationModal();
                } else if (els.riskModal && !els.riskModal.hidden) {
                    closeRiskModal();
                }
            }

            // other Escape key handling (module add scenario form wiring moved
            // to initialization to avoid relying on keydown events)
        });

        // Test tools form wiring - initialize on DOMContentLoaded so buttons work immediately
        if (els.testToolsForm) {
            els.testToolsForm.addEventListener('submit', async (event) => {
                event.preventDefault();
                const title = els.testToolsTitle ? (els.testToolsTitle.value || '').trim() : '';
                const description = els.testToolsDescription ? (els.testToolsDescription.value || '').trim() : '';
                if (!title) {
                    setStatus('Tool title is required.', 'error');
                    return;
                }
                const payload = { title, description };
                try {
                    if (state.testToolsModalMode === 'edit' && state.testToolsCurrentId) {
                        const updated = await request(`${endpoints.testTools}${state.testToolsCurrentId}/`, { method: 'PATCH', body: JSON.stringify(payload) });
                        if (updated && typeof updated === 'object') {
                            const idx = state.testTools.findIndex((t) => Number(t.id) === Number(updated.id));
                            if (idx > -1) {
                                state.testTools[idx] = updated;
                            } else {
                                state.testTools.unshift(updated);
                            }
                        }
                        setStatus('Tool updated successfully.', 'success');
                    } else {
                        const created = await request(endpoints.testTools, { method: 'POST', body: JSON.stringify(payload) });
                        state.testTools.unshift(created);
                        setStatus('Tool created successfully.', 'success');
                    }
                    closeTestToolsModal();
                    renderTestToolsList();
                } catch (error) {
                    setStatus(error.message, 'error');
                }
            });
        }

        // Test modules form wiring - initialize on DOMContentLoaded so buttons work immediately
        if (els.testModulesForm) {
            els.testModulesForm.addEventListener('submit', async (event) => {
                event.preventDefault();
                const title = els.testModulesTitle ? (els.testModulesTitle.value || '').trim() : '';
                const description = els.testModulesDescription ? (els.testModulesDescription.value || '').trim() : '';
                if (!title) {
                    setStatus('Module title is required.', 'error');
                    return;
                }
                const payload = {
                    title,
                    description,
                    project: (els.testModulesProject && els.testModulesProject.value) ? Number(els.testModulesProject.value) : null,
                };
                const mode = (state.testModulesModalMode === 'edit' && state.testModulesCurrentId) ? 'edit' : 'create';
                const moduleLabel = title || 'this module';
                const confirmMessage = mode === 'edit'
                    ? `Are you sure you want to update the module "${moduleLabel}"?`
                    : `Are you sure you want to create the module "${moduleLabel}"?`;
                const confirmResult = typeof window.confirm === 'function' ? window.confirm(confirmMessage) : true;
                if (!confirmResult) {
                    return;
                }
                try {
                    if (mode === 'edit') {
                        const updated = await request(`${endpoints.testModules}${state.testModulesCurrentId}/`, { method: 'PATCH', body: JSON.stringify(payload) });
                        if (updated && typeof updated === 'object') {
                            const idx = state.testModules.findIndex((t) => Number(t.id) === Number(updated.id));
                            if (idx > -1) {
                                state.testModules[idx] = updated;
                            } else {
                                state.testModules.unshift(updated);
                            }
                        }
                        const displayName = updated && updated.title ? updated.title : moduleLabel;
                        setStatus('Module updated successfully.', 'success');
                        showToast(`Module "${displayName}" updated successfully.`);
                    } else {
                        const created = await request(endpoints.testModules, { method: 'POST', body: JSON.stringify(payload) });
                        state.testModules.unshift(created);
                        const displayName = created && created.title ? created.title : moduleLabel;
                        setStatus('Module created successfully.', 'success');
                        showToast(`Module "${displayName}" created successfully.`);
                    }
                    closeTestModulesModal();
                    renderTestModulesList();
                } catch (error) {
                    setStatus(error.message, 'error');
                }
            });
        }

        // module add case form wiring
        const dependencyControls = {
            checkbox: document.getElementById('module-add-case-requires-dependency'),
            fields: Array.from(document.querySelectorAll('[data-role="dependency-fields"]')),
            select: document.getElementById('module-add-case-dependency-id'),
            key: document.getElementById('module-add-case-dependency-key'),
        };
        const dependencyOptionsCache = new Map();

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

        const getCasesEndpoint = () => {
            if (endpoints.cases) {
                return endpoints.cases;
            }
            if (apiEndpoints.cases) {
                return ensureTrailingSlash(apiEndpoints.cases);
            }
            return '/api/core/test-cases/';
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
                    const raw = await request(url);
                    cached = extractCases(raw);
                } catch (error) {
                    cached = [];
                    try {
                        // eslint-disable-next-line no-console
                        console.warn('[data-management] Failed to load dependency options', error);
                    } catch (err) {
                        /* ignore */
                    }
                }
                dependencyOptionsCache.set(cacheKey, cached);
            }
            (cached || []).forEach((tc) => {
                if (!tc || tc.id === undefined || tc.id === null) {
                    return;
                }
                if (excludeId && Number(tc.id) === Number(excludeId)) {
                    return;
                }
                const opt = document.createElement('option');
                opt.value = tc.id;
                const parts = [];
                if (tc.testcase_id) {
                    parts.push(tc.testcase_id);
                }
                if (tc.title) {
                    parts.push(tc.title);
                }
                if (!parts.length) {
                    parts.push(`Case #${tc.id}`);
                }
                opt.textContent = parts.join(' — ');
                select.appendChild(opt);
            });
        };

        if (dependencyControls.checkbox) {
            dependencyControls.checkbox.addEventListener('change', () => {
                toggleDependencyFields(dependencyControls.checkbox.checked);
            });
        }

        toggleDependencyFields(false, { preserveValues: true });

        const moduleAddCaseForm = document.getElementById('module-add-case-form');
        if (moduleAddCaseForm) {
            moduleAddCaseForm.addEventListener('submit', async (event) => {
                event.preventDefault();
                const scenarioInput = document.getElementById('module-add-case-scenario-id');
                const titleInput = document.getElementById('module-add-case-title');
                const descInput = document.getElementById('module-add-case-description');
                const stepsInput = document.getElementById('module-add-case-steps');
                const expectedInput = document.getElementById('module-add-case-expected');
                const priorityInput = document.getElementById('module-add-case-priority');
                const requiresDependencyInput = document.getElementById('module-add-case-requires-dependency');
                const dependencySelect = document.getElementById('module-add-case-dependency-id');
                const dependencyKeyInput = document.getElementById('module-add-case-dependency-key');
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
                    description: syncModuleCaseDescriptionFromEditor(),
                    steps: stepsInput && stepsInput.value ? stepsInput.value.split(/\n/).map((s) => s.trim()).filter(Boolean) : [],
                    expected_results: expectedEntries,
                    priority: priorityInput && priorityInput.value ? priorityInput.value : '',
                };
                const requiresDependency = !!(requiresDependencyInput && requiresDependencyInput.checked);
                payload.requires_dependency = requiresDependency;
                if (requiresDependency) {
                    const dependencyRaw = dependencySelect && dependencySelect.value ? dependencySelect.value : '';
                    const dependencyValue = dependencyRaw ? Number(dependencyRaw) : NaN;
                    if (!dependencyRaw || Number.isNaN(dependencyValue) || dependencyValue <= 0) {
                        setStatus('Select a dependency test case before saving.', 'error');
                        return;
                    }
                    payload.test_case_dependency = dependencyValue;
                    const dependencyKey = dependencyKeyInput && dependencyKeyInput.value ? dependencyKeyInput.value.trim() : '';
                    if (!dependencyKey) {
                        setStatus('Enter the dependency response key before saving.', 'error');
                        return;
                    }
                    payload.dependency_response_key = dependencyKey;
                } else {
                    payload.test_case_dependency = null;
                    payload.dependency_response_key = '';
                }
                // If an API request was selected via the explorer, include it
                try {
                    // Force-sync label -> hidden input to ensure value is present
                    const hidden = document.getElementById('module-add-case-related-api-request-id');
                    const label = document.getElementById('module-related-api-request-label');
                    if (label && label.dataset && label.dataset.requestId) {
                        if (hidden) hidden.value = label.dataset.requestId;
                    }
                    if (hidden && hidden.value) {
                        const parsed = Number(hidden.value);
                        if (!Number.isNaN(parsed) && parsed > 0) payload.related_api_request = parsed;
                    }
                    try { console.debug('[data-management] creating module-case payload.related_api_request=', payload.related_api_request); } catch (e) { /* ignore */ }
                    // Debug: print hidden and label values for troubleshooting
                    try {
                        console.log('[moduleAddCase] hidden related input value=', document.getElementById('module-add-case-related-api-request-id') && document.getElementById('module-add-case-related-api-request-id').value);
                        const moduleLabel = document.getElementById('module-related-api-request-label');
                        console.log('[moduleAddCase] label dataset.requestId=', moduleLabel && moduleLabel.dataset && moduleLabel.dataset.requestId, 'label text=', moduleLabel && moduleLabel.textContent);
                    } catch (err) { /* ignore */ }
                } catch (e) { /* ignore */ }
                if (!payload.title) {
                    setStatus('Test case title is required.', 'error');
                    return;
                }
                try {
                    setStatus('Saving test case…', 'info');
                    const urlBase = endpoints.cases || (apiEndpoints.cases ? ensureTrailingSlash(apiEndpoints.cases) : '/api/core/test-cases/');
                    // DEBUG ALERT: show exact payload being sent (temporary)
                    try { alert('[DEBUG] Sending payload to ' + urlBase + ' :\n' + JSON.stringify(payload, null, 2)); } catch (e) { /* ignore */ }
                    const created = await request(urlBase, { method: 'POST', body: JSON.stringify(payload) });
                    // close modal and reset
                    const modal = document.querySelector('[data-role="module-add-case-modal"]');
                    if (modal) {
                        modal.hidden = true;
                        body.classList.remove('automation-modal-open');
                    }
                    try { removeModuleCaseDescriptionEditor(); } catch (e) { /* ignore */ }
                    moduleAddCaseForm.reset();
                    toggleDependencyFields(false);
                    dependencyOptionsCache.delete(Number.isFinite(Number(sid)) ? Number(sid) : String(sid));
                    setStatus('Test case saved.', 'success');
                    // optional: refresh modules or projects to show newly created case in related views
                    // if projects API is available, refresh project-derived metrics so counts update
                    if (endpoints.testModules) {
                        // try updating modules scenarios cache by reloading modules
                        await loadTestModules();
                    } else {
                        // fallback to refresh plans if available
                        try { await refreshPlans({ silent: true }); } catch (_) { }
                    }
                } catch (err) {
                    setStatus(err instanceof Error ? err.message : 'Unable to save test case.', 'error');
                }
            });
            // Safety-net: ensure module related_api_request hidden input is synced
            // from visible label before any submit handler runs (capture phase).
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

        // wire open/close triggers for test tools
        const testToolsOpenTrigger = root.querySelector('[data-action="open-test-tools-modal"]');
        const testToolsCloseTriggers = Array.from(root.querySelectorAll('[data-action="close-test-tools-modal"]'));
        if (testToolsOpenTrigger) testToolsOpenTrigger.addEventListener('click', (ev) => { ev.preventDefault(); openTestToolsModal('create'); });
        testToolsCloseTriggers.forEach((node) => node.addEventListener('click', (ev) => { ev.preventDefault(); closeTestToolsModal(); }));
        if (els.testToolsSearch) els.testToolsSearch.addEventListener('input', debounce((ev) => { state.testToolsSearch = (ev.target.value || '').trim(); renderTestToolsList(); }, 250));

        const testModulesOpenTrigger = root.querySelector('[data-action="open-test-modules-modal"]');
        const testModulesCloseTriggers = Array.from(root.querySelectorAll('[data-action="close-test-modules-modal"]'));
        if (testModulesOpenTrigger) testModulesOpenTrigger.addEventListener('click', (ev) => { ev.preventDefault(); openTestModulesModal('create'); });
        testModulesCloseTriggers.forEach((node) => node.addEventListener('click', (ev) => { ev.preventDefault(); closeTestModulesModal(); }));
        if (els.testModulesSearch) els.testModulesSearch.addEventListener('input', debounce((ev) => { state.testModulesSearch = (ev.target.value || '').trim(); renderTestModulesList(); }, 250));

        // populate project filter select
        if (els.testModulesFilterProject) {
            // clear then populate
            els.testModulesFilterProject.innerHTML = '<option value="">All projects</option>';
            initialProjects.forEach((p) => {
                const opt = document.createElement('option');
                opt.value = p.id || '';
                opt.textContent = p.name || p.title || `Project ${p.id}`;
                els.testModulesFilterProject.appendChild(opt);
            });
            els.testModulesFilterProject.addEventListener('change', () => {
                // reload modules when filter changes
                loadTestModules();
            });
        }

        // Initial fetch / render for test tools
        (async () => {
            try {
                // if backend endpoint present, load fresh list, otherwise use initial state
                if (endpoints.testTools) {
                    const data = await request(endpoints.testTools);
                    if (Array.isArray(data)) state.testTools = data;
                }
                renderTestToolsList();
                if (endpoints.testModules) {
                    const data = await request(endpoints.testModules);
                    if (Array.isArray(data)) state.testModules = data;
                }
                renderTestModulesList();
            } catch (_err) {
                renderTestToolsList();
                renderTestModulesList();
            }
        })();
    });
})();
