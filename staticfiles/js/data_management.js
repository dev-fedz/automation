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
        const root = document.getElementById("data-management-app");
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

    const initialRisks = readScriptJson("automation-initial-risks") || [];
    const initialMitigations = readScriptJson("automation-initial-mitigation-plans") || [];
    const initialMappings = readScriptJson("automation-initial-risk-mitigations") || [];
    const initialSection = readScriptJson("data-management-initial-section") || "";
        const apiEndpoints = readScriptJson("automation-api-endpoints") || {};

        const endpoints = {
            risks: ensureTrailingSlash(apiEndpoints.risks || ""),
            mitigations: ensureTrailingSlash(apiEndpoints.mitigation_plans || ""),
            mappings: ensureTrailingSlash(apiEndpoints.risk_mitigations || ""),
        };

        if (!endpoints.risks || !endpoints.mitigations || !endpoints.mappings) {
            // eslint-disable-next-line no-console
            console.warn("[data-management] Missing API endpoints. Aborting module initialisation.");
            return;
        }

        const els = {
            status: root.querySelector('[data-role="status"]'),
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
        };

        const body = document.body;

        const state = {
            risks: Array.isArray(initialRisks) ? initialRisks : [],
            mitigationPlans: Array.isArray(initialMitigations) ? initialMitigations : [],
            mappings: Array.isArray(initialMappings) ? initialMappings : [],
            riskModalMode: "create",
            riskCurrentId: null,
            mitigationModalMode: "create",
            mitigationCurrentId: null,
            mappingModalMode: "create",
            mappingCurrentId: null,
            riskSearch: "",
            mitigationSearch: "",
            mappingSearch: "",
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

        const renderRisks = () => {
            if (!els.riskList) {
                return;
            }
            if (!state.risks.length) {
                els.riskList.innerHTML = '<tr><td colspan="3" class="empty">No risks match the current filters.</td></tr>';
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
                els.mitigationList.innerHTML = '<tr><td colspan="3" class="empty">No mitigation plans match the current filters.</td></tr>';
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

        const openMappingModal = (mode, mapping = null) => {
            if (!els.mappingModal) {
                return;
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
            const id = trigger.dataset.id ? Number(trigger.dataset.id) : null;

            switch (action) {
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
                        await Promise.all([loadRisks(), loadMitigationPlans(), loadMappings()]);
                        setStatus("Data refreshed.", "success");
                    } catch (error) {
                        setStatus(error.message, "error");
                    }
                    break;
                default:
                    break;
            }
        });

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

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                if (els.mappingModal && !els.mappingModal.hidden) {
                    closeMappingModal();
                } else if (els.mitigationModal && !els.mitigationModal.hidden) {
                    closeMitigationModal();
                } else if (els.riskModal && !els.riskModal.hidden) {
                    closeRiskModal();
                }
            }
        });
    });
})();
