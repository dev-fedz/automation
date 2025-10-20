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

        const initialEnvironments = readScriptJson("automation-initial-environments") || [];
        const initialRisks = readScriptJson("automation-initial-risks") || [];
        const initialMitigations = readScriptJson("automation-initial-mitigation-plans") || [];
        const initialMappings = readScriptJson("automation-initial-risk-mitigations") || [];
        const initialSection = readScriptJson("data-management-initial-section") || "";
        const apiEndpoints = readScriptJson("automation-api-endpoints") || {};

        const endpoints = {
            environments: ensureTrailingSlash(apiEndpoints.environments || ""),
            risks: ensureTrailingSlash(apiEndpoints.risks || ""),
            mitigations: ensureTrailingSlash(apiEndpoints.mitigation_plans || ""),
            mappings: ensureTrailingSlash(apiEndpoints.risk_mitigations || ""),
            testTools: ensureTrailingSlash(apiEndpoints.test_tools || ""),
        };

        if (!endpoints.environments || !endpoints.risks || !endpoints.mitigations || !endpoints.mappings) {
            // eslint-disable-next-line no-console
            console.warn("[data-management] Missing API endpoints. Aborting module initialisation.");
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
            environmentSearch: "",
            riskModalMode: "create",
            riskCurrentId: null,
            mitigationModalMode: "create",
            mitigationCurrentId: null,
            mappingModalMode: "create",
            mappingCurrentId: null,
            riskSearch: "",
            mitigationSearch: "",
            mappingSearch: "",
            testTools: Array.isArray(readScriptJson("automation-initial-test-tools")) ? readScriptJson("automation-initial-test-tools") : [],
            testToolsModalMode: "create",
            testToolsCurrentId: null,
            testToolsSearch: "",
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
                        `\n                        <tr data-environment-id="${env.id}">\n` +
                        `                            <td data-label="Name">${name}</td>\n` +
                        `                            <td data-label="Description">${description}</td>\n` +
                        `                            <td data-label="Variables">${variableCount}</td>\n` +
                        `                            <td data-label="Headers">${headerCount}</td>\n` +
                        `                            <td data-label="Updated">${updatedText}</td>\n` +
                        "                            <td data-label=\"Actions\">\n" +
                        "                                <div class=\"table-action-group\">\n" +
                        `                                    <button type="button" class="action-button" data-action="view-environment" data-id="${env.id}">View</button>\n` +
                        `                                    <button type="button" class="action-button" data-action="edit-environment" data-id="${env.id}">Edit</button>\n` +
                        `                                    <button type="button" class="action-button" data-action="delete-environment" data-id="${env.id}" data-variant="danger">Delete</button>\n` +
                        "                                </div>\n" +
                        "                            </td>\n" +
                        "                        </tr>\n"
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
            if (target === els.environmentName) {
                state.environmentForm.name = target.value;
                return;
            }
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
                        <tr data-risk-id="${risk.id}">
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
                        </tr>
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
                        <tr data-mitigation-id="${plan.id}">
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
                        </tr>
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
                        <tr data-mapping-id="${mapping.id}">
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
                        </tr>
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
                .map((risk) => `<option value="${risk.id}">${escapeHtml(risk.title || "Untitled")}</option>`)
                .join("");
            const mitigationOptions = state.mitigationPlans
                .map((plan) => `<option value="${plan.id}">${escapeHtml(plan.title || "Untitled")}</option>`)
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
            const action = trigger.dataset.action;
            // some tables use data-id, test-tools uses data-tool-id — support both
            const rawId = trigger.dataset.id || trigger.dataset.toolId || trigger.getAttribute('data-tool-id');
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

        // wire open/close triggers for test tools
        const testToolsOpenTrigger = root.querySelector('[data-action="open-test-tools-modal"]');
        const testToolsCloseTriggers = Array.from(root.querySelectorAll('[data-action="close-test-tools-modal"]'));
        if (testToolsOpenTrigger) testToolsOpenTrigger.addEventListener('click', (ev) => { ev.preventDefault(); openTestToolsModal('create'); });
        testToolsCloseTriggers.forEach((node) => node.addEventListener('click', (ev) => { ev.preventDefault(); closeTestToolsModal(); }));
        if (els.testToolsSearch) els.testToolsSearch.addEventListener('input', debounce((ev) => { state.testToolsSearch = (ev.target.value || '').trim(); renderTestToolsList(); }, 250));

        // Initial fetch / render for test tools
        (async () => {
            try {
                // if backend endpoint present, load fresh list, otherwise use initial state
                if (endpoints.testTools) {
                    const data = await request(endpoints.testTools);
                    if (Array.isArray(data)) state.testTools = data;
                }
                renderTestToolsList();
            } catch (_err) {
                renderTestToolsList();
            }
        })();
    });
})();
