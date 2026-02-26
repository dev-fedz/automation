(function () {
    'use strict';

    const root = document.getElementById('automation-load-testing');
    if (!root) return;

    const getJsonScript = (id, fallback) => {
        try {
            const el = document.getElementById(id);
            if (!el) return fallback;
            return JSON.parse(el.textContent || el.innerText || 'null');
        } catch (_e) {
            return fallback;
        }
    };

    const escapeHtml = (value) => {
        const s = value === null || value === undefined ? '' : String(value);
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };

    const truncate = (value, max) => {
        const text = value ? String(value) : '';
        if (text.length <= max) return text;
        const limit = Math.max(0, max - 3);
        return `${text.slice(0, limit)}...`;
    };

    const readCsrfToken = () => {
        try {
            const name = 'csrftoken';
            const parts = document.cookie.split(';').map(s => s.trim()).filter(Boolean);
            for (const p of parts) {
                if (p.startsWith(name + '=')) {
                    return decodeURIComponent(p.split('=')[1]);
                }
            }
        } catch (_e) {
            // ignore
        }
        return null;
    };

    const endpoints = getJsonScript('automation-api-endpoints', {}) || {};
    const PROJECTS = getJsonScript('automation-loadtest-projects', []) || [];

    const api = {
        loadTests: endpoints.load_tests || '/api/core/load-tests/',
    };

    const state = {
        projects: Array.isArray(PROJECTS) ? PROJECTS : [],
        activeProjectId: null,
        activeModuleId: null,
        activeScenarioId: null,
        selectedProjectIds: new Set(),
        selectedModuleIds: new Set(),
        selectedScenarioIds: new Set(),
        selectedCaseIds: new Set(),
        runs: [],
        runsPollTimer: null,
        runsPollInFlight: false,
        pendingRunSelection: null,
        runsPage: 1,
        runsPerPage: 10,
    };

    const elements = {
        projectList: root.querySelector('[data-role="project-list"]'),
        moduleList: root.querySelector('[data-role="module-list"]'),
        scenarioList: root.querySelector('[data-role="scenario-list"]'),
        caseTable: root.querySelector('[data-role="case-table"]'),
        moduleSubtitle: root.querySelector('[data-role="module-subtitle"]'),
        scenarioSubtitle: root.querySelector('[data-role="scenario-subtitle"]'),
        status: root.querySelector('[data-role="status"]'),
        usersInput: document.querySelector('[data-role="users"]'),
        rampInput: document.querySelector('[data-role="ramp"]'),
        durationInput: document.querySelector('[data-role="duration"]'),
        durationUnit: document.querySelector('[data-role="duration-unit"]'),
        startButton: root.querySelector('[data-role="start-load-test"]'),
        configModal: document.getElementById('loadtest-config-modal'),
        runsList: root.querySelector('[data-role="runs-list"]'),
        moduleLoadAll: root.querySelector('[data-role="module-loadtest-all"]'),
        scenarioLoadAll: root.querySelector('[data-role="scenario-loadtest-all"]'),
    };

    const setStatus = (text, level) => {
        if (!elements.status) return;
        elements.status.textContent = text || '';
        elements.status.dataset.level = level || '';
    };

    const getProjectById = (id) => state.projects.find(p => String(p && p.id) === String(id));

    const getScenarioModuleId = (scenario) => {
        if (!scenario) return null;
        // In this codebase `TestScenarioSerializer` exposes `module_id` (read-only);
        // `module` is write-only, so it won't be present in the initial payload.
        const raw = (scenario.module_id !== undefined && scenario.module_id !== null)
            ? scenario.module_id
            : scenario.module;
        if (raw === null || raw === undefined || raw === '') return null;
        if (typeof raw === 'object' && raw !== null) {
            return raw.id !== undefined ? raw.id : null;
        }
        return raw;
    };

    const getProjectModules = (project) => {
        if (!project) return [];
        const modules = Array.isArray(project.test_modules) ? project.test_modules.slice() : [];
        modules.sort((a, b) => {
            const ta = String((a && (a.title || a.name)) || '').toLowerCase();
            const tb = String((b && (b.title || b.name)) || '').toLowerCase();
            if (ta < tb) return -1;
            if (ta > tb) return 1;
            return String(a && a.id).localeCompare(String(b && b.id));
        });
        return modules;
    };

    const getActiveProject = () => {
        if (!state.activeProjectId) return null;
        return getProjectById(state.activeProjectId);
    };

    const collectModulesForProject = (project) => {
        // Primary source: ProjectSerializer.test_modules
        const fromProject = getProjectModules(project);
        if (fromProject.length) {
            return fromProject.map((m) => ({
                id: m && m.id,
                title: (m && (m.title || m.name)) ? (m.title || m.name) : `Module ${m && m.id}`,
            }));
        }

        // Fallback: derive from scenario.module_id when project.test_modules is empty
        const modules = new Map();
        if (!project || !Array.isArray(project.scenarios)) return [];
        project.scenarios.forEach((s) => {
            const mid = getScenarioModuleId(s);
            if (mid === null || mid === undefined || mid === '') return;
            const key = String(mid);
            if (!modules.has(key)) {
                modules.set(key, { id: mid, title: `Module ${key}` });
            }
        });
        return Array.from(modules.values()).sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
    };

    const collectScenariosForProject = (project, moduleId) => {
        const scenarios = (project && Array.isArray(project.scenarios)) ? project.scenarios : [];
        if (!moduleId) return scenarios;
        return scenarios.filter(s => String(getScenarioModuleId(s) || '') === String(moduleId));
    };

    const collectCasesForScenario = (scenario) => {
        const cases = (scenario && Array.isArray(scenario.cases)) ? scenario.cases : [];
        return cases;
    };

    const buildCaseTable = (scenario, cases) => {
        const scenarioId = scenario && scenario.id !== undefined && scenario.id !== null ? String(scenario.id) : '';
        const table = document.createElement('table');
        table.className = 'table-modern automation-table';
        table.setAttribute('aria-label', 'Test cases');

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');

        const checkboxHeader = document.createElement('th');
        checkboxHeader.setAttribute('scope', 'col');
        checkboxHeader.className = 'col-checkbox';
        const headerLabel = document.createElement('label');
        headerLabel.className = 'case-checkbox-label';
        const selectAll = document.createElement('input');
        selectAll.type = 'checkbox';
        selectAll.id = 'select-all-cases';
        selectAll.dataset.action = 'select-all-cases';
        selectAll.setAttribute('aria-label', 'Select all test cases');
        const headerFakeCheckbox = document.createElement('span');
        headerFakeCheckbox.className = 'fake-checkbox';
        headerFakeCheckbox.setAttribute('aria-hidden', 'true');
        headerLabel.appendChild(selectAll);
        headerLabel.appendChild(headerFakeCheckbox);
        checkboxHeader.appendChild(headerLabel);
        headerRow.appendChild(checkboxHeader);

        const columns = ['ID', 'Title', 'Description', 'Updated', 'Actions'];
        columns.forEach((name) => {
            const th = document.createElement('th');
            th.setAttribute('scope', 'col');
            th.textContent = name;
            headerRow.appendChild(th);
        });

        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        cases.forEach((caseData) => {
            const tr = document.createElement('tr');
            const caseId = caseData && caseData.id !== undefined && caseData.id !== null ? String(caseData.id) : '';
            if (caseId) tr.dataset.caseId = caseId;
            if (scenarioId) tr.dataset.scenarioId = scenarioId;

            const checkboxCell = document.createElement('td');
            const checkboxLabel = document.createElement('label');
            checkboxLabel.className = 'case-checkbox-label';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'case-checkbox';
            checkbox.dataset.action = 'case-checkbox';
            checkbox.setAttribute('data-case-id', caseId || '');
            checkbox.setAttribute('aria-label', `Select test case ${caseData?.testcase_id || caseId || ''}`);
            if (caseId && state.selectedCaseIds.has(String(caseId))) {
                checkbox.checked = true;
            }
            const fakeCheckbox = document.createElement('span');
            fakeCheckbox.className = 'fake-checkbox';
            fakeCheckbox.setAttribute('aria-hidden', 'true');
            checkboxLabel.appendChild(checkbox);
            checkboxLabel.appendChild(fakeCheckbox);
            checkboxCell.appendChild(checkboxLabel);
            tr.appendChild(checkboxCell);

            const idCell = document.createElement('td');
            idCell.textContent = caseData?.testcase_id || caseId || '';
            tr.appendChild(idCell);

            const titleCell = document.createElement('td');
            titleCell.textContent = caseData?.title || 'Untitled case';
            tr.appendChild(titleCell);

            const descriptionCell = document.createElement('td');
            descriptionCell.textContent = truncate(caseData?.description || '', 120);
            tr.appendChild(descriptionCell);

            const updatedCell = document.createElement('td');
            updatedCell.textContent = caseData?.updated_at || caseData?.created_at || '';
            tr.appendChild(updatedCell);

            const actionsCell = document.createElement('td');
            const actionGroup = document.createElement('div');
            actionGroup.className = 'table-action-group';
            const loadTestBtn = document.createElement('button');
            loadTestBtn.type = 'button';
            loadTestBtn.className = 'action-button';
            loadTestBtn.dataset.action = 'case-loadtest';
            loadTestBtn.dataset.caseId = caseId || '';
            loadTestBtn.dataset.scenarioId = scenarioId || '';
            loadTestBtn.textContent = 'Load Test';
            if (!caseData?.related_api_request) {
                loadTestBtn.disabled = true;
                loadTestBtn.title = 'Link this test case to an API request to enable load tests.';
            }
            // Set default users=1 and duration=10s on click
            loadTestBtn.addEventListener('click', function (ev) {
                // Only set if the button is enabled
                if (!loadTestBtn.disabled) {
                    const usersInput = document.querySelector('[data-role="users"]');
                    const durationInput = document.querySelector('[data-role="duration"]');
                    const durationUnit = document.querySelector('[data-role="duration-unit"]');
                    if (usersInput) usersInput.value = 1;
                    if (durationInput) durationInput.value = 10;
                    if (durationUnit) durationUnit.value = 'seconds';
                }
            });
            actionGroup.appendChild(loadTestBtn);
            actionsCell.appendChild(actionGroup);
            tr.appendChild(actionsCell);

            tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        return table;
    };

    const renderProjects = () => {
        if (!elements.projectList) return;
        const html = (state.projects || []).map((p) => {
            const pid = p && p.id;
            const title = (p && (p.title || p.name)) ? (p.title || p.name) : `Project ${pid}`;
            const isActive = String(pid) === String(state.activeProjectId);
            const isChecked = state.selectedProjectIds.has(String(pid));
            return (
                `<div class="automation-item${isActive ? ' is-active' : ''} automation-item--selectable" data-action="project-select" data-project-id="${escapeHtml(pid)}">` +
                '<div class="automation-run__item-header">' +
                `<label class="automation-run__checkbox-group" for="automation-loadtest-project-${escapeHtml(pid)}" onclick="event.stopPropagation();">` +
                `<input type="checkbox" id="automation-loadtest-project-${escapeHtml(pid)}" data-action="project-checkbox" data-project-id="${escapeHtml(pid)}" ${isChecked ? 'checked' : ''}>` +
                '</label>' +
                `<span class="automation-run__item-select-label"><strong>${escapeHtml(title)}</strong></span>` +
                `<button type="button" class="action-button" data-action="project-loadtest" data-project-id="${escapeHtml(pid)}" onclick="event.stopPropagation();">Load Test</button>` +
                '</div>' +
                '</div>'
            );
        }).join('');
        elements.projectList.innerHTML = html || '<div class="empty-state">No projects found.</div>';
    };

    const renderModules = () => {
        if (!elements.moduleList) return;
        const project = getActiveProject();
        if (!project) {
            elements.moduleList.innerHTML = '<div class="empty-state">Select a project.</div>';
            if (elements.moduleSubtitle) elements.moduleSubtitle.textContent = '';
            if (elements.moduleLoadAll) elements.moduleLoadAll.style.display = 'none';
            return;
        }
        if (elements.moduleSubtitle) {
            const label = project.title || project.name || project.id;
            elements.moduleSubtitle.textContent = `Project: ${label}`;
        }

        const modules = collectModulesForProject(project);
        if (elements.moduleLoadAll) elements.moduleLoadAll.style.display = modules.length ? '' : 'none';

        const html = modules.map((m) => {
            const mid = m && m.id;
            const title = m && m.title ? m.title : `Module ${mid}`;
            const isActive = String(mid) === String(state.activeModuleId);
            const isChecked = state.selectedModuleIds.has(String(mid));
            return (
                `<div class="automation-item${isActive ? ' is-active' : ''} automation-item--selectable" data-action="module-select" data-module-id="${escapeHtml(mid)}">` +
                '<div class="automation-run__item-header">' +
                `<label class="automation-run__checkbox-group" for="automation-loadtest-module-${escapeHtml(mid)}" onclick="event.stopPropagation();">` +
                `<input type="checkbox" id="automation-loadtest-module-${escapeHtml(mid)}" data-action="module-checkbox" data-module-id="${escapeHtml(mid)}" ${isChecked ? 'checked' : ''}>` +
                '</label>' +
                `<span class="automation-run__item-select-label"><strong>${escapeHtml(title)}</strong></span>` +
                `<button type="button" class="action-button" data-action="module-loadtest" data-module-id="${escapeHtml(mid)}" onclick="event.stopPropagation();">Load Test</button>` +
                '</div>' +
                '</div>'
            );
        }).join('');

        elements.moduleList.innerHTML = html || '<div class="empty-state">No modules found for this project.</div>';
    };

    const renderScenarios = () => {
        if (!elements.scenarioList) return;
        const project = getActiveProject();
        if (!project) {
            elements.scenarioList.innerHTML = '<div class="empty-state">Select a project.</div>';
            if (elements.scenarioSubtitle) elements.scenarioSubtitle.textContent = '';
            if (elements.scenarioLoadAll) elements.scenarioLoadAll.style.display = 'none';
            return;
        }

        const scenarios = collectScenariosForProject(project, state.activeModuleId);
        if (elements.scenarioLoadAll) elements.scenarioLoadAll.style.display = scenarios.length ? '' : 'none';
        if (elements.scenarioSubtitle) {
            const base = project.title || project.name || project.id;
            const modText = state.activeModuleId ? ` · Module ${state.activeModuleId}` : '';
            elements.scenarioSubtitle.textContent = `Project: ${base}${modText}`;
        }

        const html = scenarios.map((s) => {
            const sid = s && s.id;
            const title = s && (s.title || s.name) ? (s.title || s.name) : `Scenario ${sid}`;
            const isActive = String(sid) === String(state.activeScenarioId);
            const isChecked = state.selectedScenarioIds.has(String(sid));
            return (
                `<div class="automation-item${isActive ? ' is-active' : ''} automation-item--selectable" data-action="scenario-select" data-scenario-id="${escapeHtml(sid)}">` +
                '<div class="automation-run__item-header">' +
                `<label class="automation-run__checkbox-group" for="automation-loadtest-scenario-${escapeHtml(sid)}" onclick="event.stopPropagation();">` +
                `<input type="checkbox" id="automation-loadtest-scenario-${escapeHtml(sid)}" data-action="scenario-checkbox" data-scenario-id="${escapeHtml(sid)}" ${isChecked ? 'checked' : ''}>` +
                '</label>' +
                `<span class="automation-run__item-select-label"><strong>${escapeHtml(title)}</strong></span>` +
                `<button type="button" class="action-button" data-action="scenario-loadtest" data-scenario-id="${escapeHtml(sid)}" onclick="event.stopPropagation();">Load Test</button>` +
                '</div>' +
                '</div>'
            );
        }).join('');

        elements.scenarioList.innerHTML = html || '<div class="empty-state">No scenarios found.</div>';
    };

    const renderCases = () => {
        if (!elements.caseTable) return;
        const project = getActiveProject();
        if (!project) {
            elements.caseTable.innerHTML = '<div class="empty-state">Select a project.</div>';
            return;
        }

        const scenarios = collectScenariosForProject(project, state.activeModuleId);
        const activeScenario = state.activeScenarioId
            ? (scenarios.find(s => String(s && s.id) === String(state.activeScenarioId)) || null)
            : null;

        if (!activeScenario) {
            elements.caseTable.innerHTML = '<p class="empty">Select a scenario to see its test cases.</p>';
            return;
        }

        const cases = collectCasesForScenario(activeScenario);
        if (!cases.length) {
            elements.caseTable.innerHTML = '<p class="empty">No test cases defined for this scenario.</p>';
            return;
        }

        elements.caseTable.innerHTML = '';
        elements.caseTable.appendChild(buildCaseTable(activeScenario, cases));
    };

    const determineSelection = (overrideScope, overrideIds) => {
        // Priority: explicit override > checked cases > checked scenarios > checked modules > checked projects
        if (overrideScope && overrideIds) {
            const selection = {};
            if (overrideScope === 'testcase') selection.testcase_ids = overrideIds;
            if (overrideScope === 'scenario') selection.scenario_ids = overrideIds;
            if (overrideScope === 'module') selection.module_ids = overrideIds;
            if (overrideScope === 'project') selection.project_ids = overrideIds;
            return { scope: overrideScope, selection };
        }

        const caseIds = Array.from(state.selectedCaseIds);
        if (caseIds.length) return { scope: 'testcase', selection: { testcase_ids: caseIds } };
        const scenarioIds = Array.from(state.selectedScenarioIds);
        if (scenarioIds.length) return { scope: 'scenario', selection: { scenario_ids: scenarioIds } };
        const moduleIds = Array.from(state.selectedModuleIds);
        if (moduleIds.length) return { scope: 'module', selection: { module_ids: moduleIds } };
        const projectIds = Array.from(state.selectedProjectIds);
        if (projectIds.length) return { scope: 'project', selection: { project_ids: projectIds } };

        // Fallback to active selection
        if (state.activeScenarioId) return { scope: 'scenario', selection: { scenario_ids: [String(state.activeScenarioId)] } };
        if (state.activeModuleId) return { scope: 'module', selection: { module_ids: [String(state.activeModuleId)] } };
        if (state.activeProjectId) return { scope: 'project', selection: { project_ids: [String(state.activeProjectId)] } };

        return { scope: 'project', selection: { project_ids: [] } };
    };

    const openConfigModal = (overrideScope, overrideIds) => {
        state.pendingRunSelection = { overrideScope: overrideScope || null, overrideIds: overrideIds || null };
        const modal = elements.configModal;
        if (!modal) {
            // fallback if modal missing
            executeLoadTest(overrideScope, overrideIds);
            return;
        }
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
        try {
            const usersEl = elements.usersInput;
            if (usersEl) usersEl.focus();
        } catch (_e) { /* ignore */ }
    };

    const closeConfigModal = () => {
        const modal = elements.configModal;
        if (!modal) return;
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
    };

    const executeLoadTest = async (overrideScope, overrideIds) => {
        const users = Math.max(1, Number(elements.usersInput && elements.usersInput.value ? elements.usersInput.value : 1));
        // Ramp input is interpreted as spawn rate (users/sec), matching Locust's --spawn-rate.
        const spawnRateInput = Number(elements.rampInput && elements.rampInput.value !== '' ? elements.rampInput.value : 0);
        const spawnRate = (!Number.isFinite(spawnRateInput) || spawnRateInput <= 0) ? users : Math.max(0.1, spawnRateInput);
        const durValue = Math.max(1, Number(elements.durationInput && elements.durationInput.value ? elements.durationInput.value : 1));
        const unit = elements.durationUnit && elements.durationUnit.value ? String(elements.durationUnit.value) : 'minutes';
        const durationSeconds = unit === 'hours'
            ? Math.round(durValue * 3600)
            : (unit === 'seconds' ? Math.round(durValue) : Math.round(durValue * 60));
        const derivedRampSeconds = Math.ceil(users / spawnRate);

        const sel = determineSelection(overrideScope, overrideIds);
        if (!sel.selection || (!sel.selection.testcase_ids && !sel.selection.scenario_ids && !sel.selection.module_ids && !sel.selection.project_ids)) {
            // allow empty selection only if user checked nothing; backend will reject.
        }

        // Use run menu's logic for environment_id resolution
        if (sel.selection && sel.selection.testcase_ids) {
            // Dynamically import run menu helpers if available
            let buildCaseDescriptor = null;
            let collectProjectCases = null;
            let collectModuleCases = null;
            let collectScenarioCases = null;
            try {
                buildCaseDescriptor = window.automationRunBuildCaseDescriptor || null;
                collectProjectCases = window.automationRunCollectProjectCases || null;
                collectModuleCases = window.automationRunCollectModuleCases || null;
                collectScenarioCases = window.automationRunCollectScenarioCases || null;
            } catch (_e) { /* ignore */ }

            const project = getActiveProject();
            let cases = [];
            if (buildCaseDescriptor && collectProjectCases) {
                cases = collectProjectCases(project);
            } else {
                // fallback to local logic
                const scenarios = collectScenariosForProject(project, state.activeModuleId);
                if (state.activeScenarioId) {
                    const activeScenario = scenarios.find(s => String(s && s.id) === String(state.activeScenarioId));
                    cases = collectCasesForScenario(activeScenario);
                } else {
                    cases = scenarios.flatMap(s => collectCasesForScenario(s));
                }
            }
            // Build testcase payloads with environment_id
            const testcasePayloads = sel.selection.testcase_ids.map(tcId => {
                const caseObj = cases.find(c => String(c.id) === String(tcId) || String(c.caseId) === String(tcId));
                return {
                    id: tcId,
                    environment_id: caseObj && (caseObj.environment_id || caseObj.envId) ? (caseObj.environment_id || caseObj.envId) : null,
                };
            });
            sel.selection.testcases = testcasePayloads;
        }

        // Print diagnostics: for each testcase, attempt to fetch linked request,
        // print resolved authorization, headers and any pre-request console logs.
        try {
            const endpointsLocal = getJsonScript('automation-api-endpoints') || {};
            const requestsBase = endpointsLocal.requests || '/api/core/requests/';
            const collectionsBase = endpointsLocal.collections || '/api/core/collections/';
            for (const tc of (sel.selection.testcases || [])) {
                try {
                    const caseId = tc && tc.id ? String(tc.id) : null;
                    const caseObj = (Array.isArray(state.projects) ? state.projects : []).flatMap(p => (Array.isArray(p.scenarios) ? p.scenarios : []).flatMap(s => (Array.isArray(s.cases) ? s.cases : []))).find(c => String(c.id) === String(caseId));
                    const reqId = caseObj && (caseObj.related_api_request || caseObj.requestId || null);
                    const envId = tc.environment_id || (caseObj && (caseObj.environment_id || caseObj.envId)) || null;
                    if (!reqId) {
                        console.info('[loadtest] testcase', caseId, 'has no linked API request');
                        continue;
                    }
                    const reqUrl = requestsBase.endsWith('/') ? `${requestsBase}${encodeURIComponent(String(reqId))}/` : `${requestsBase}/${encodeURIComponent(String(reqId))}/`;
                    let requestObj = null;
                    try {
                        const r = await fetch(reqUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
                        if (r.ok) requestObj = await r.json();
                    } catch (_e) { requestObj = null; }

                    console.group(`[loadtest] case ${caseId} -> request ${reqId}`);
                    console.log('resolved_environment_id:', envId);
                    if (!requestObj) {
                        console.warn('unable to fetch request details for', reqId);
                        console.groupEnd();
                        continue;
                    }

                    // Base headers from request definition
                    const baseHeaders = requestObj.headers ? { ...requestObj.headers } : {};

                    // If request belongs to a collection, try to determine collection variables
                    let collectionVars = null;
                    if (requestObj.collection_id) {
                        try {
                            const colUrl = collectionsBase.endsWith('/') ? `${collectionsBase}${encodeURIComponent(String(requestObj.collection_id))}/` : `${collectionsBase}/${encodeURIComponent(String(requestObj.collection_id))}/`;
                            const colResp = await fetch(colUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
                            if (colResp.ok) {
                                const colData = await colResp.json();
                                const envs = Array.isArray(colData.environments) ? colData.environments : [];
                                if (envs.length) {
                                    // attempt to match envId, else pick first
                                    let chosen = null;
                                    if (envId) chosen = envs.find(e => String(e.id) === String(envId)) || null;
                                    if (!chosen) chosen = envs[0];
                                    collectionVars = chosen ? (chosen.variables || {}) : {};
                                }
                            }
                        } catch (_e) { collectionVars = null; }
                    }

                    // Resolve auth headers (basic / bearer) similar to testcase-runner
                    const resolveTemplate = (v, vars) => {
                        if (!v || typeof v !== 'string') return v;
                        const m = v.match(/^\{\{\s*([\w\.\-]+)\s*\}\}$/);
                        if (!m) return v;
                        const key = m[1];
                        if (vars && Object.prototype.hasOwnProperty.call(vars, key)) return vars[key];
                        return v;
                    };

                    const headersResolved = { ...baseHeaders };
                    if (requestObj.auth_type === 'basic' && requestObj.auth_basic) {
                        try {
                            const ab = requestObj.auth_basic || {};
                            const resolvedUsername = resolveTemplate(typeof ab.username === 'string' ? ab.username : '', collectionVars);
                            const resolvedPassword = resolveTemplate(typeof ab.password === 'string' ? ab.password : '', collectionVars);
                            if (resolvedUsername || resolvedPassword) {
                                const token = btoa(`${resolvedUsername}:${resolvedPassword}`);
                                headersResolved['Authorization'] = `Basic ${token}`;
                            }
                        } catch (_e) { }
                    }
                    if (requestObj.auth_type === 'bearer' && requestObj.auth_bearer) {
                        try {
                            const resolved = resolveTemplate(requestObj.auth_bearer, collectionVars);
                            if (resolved) headersResolved['Authorization'] = `Bearer ${resolved}`;
                        } catch (_e) { }
                    }

                    console.log('request.definition.headers:', baseHeaders);
                    console.log('request.resolved.headers:', headersResolved);

                    // Pre-request script: if present, try to run via available script helpers
                    if (requestObj.pre_request_script && requestObj.pre_request_script.trim()) {
                        try {
                            const helpers = (window.__automationHelpers && window.__automationHelpers.scriptRunner) ? window.__automationHelpers.scriptRunner : null;
                            if (helpers && typeof helpers.runPreRequestScript === 'function') {
                                const requestSnapshot = (typeof helpers.buildScriptRequestSnapshot === 'function') ? helpers.buildScriptRequestSnapshot(requestObj, helpers) : null;
                                const environmentSnapshot = collectionVars ? { id: envId, variables: collectionVars } : null;
                                const scriptContext = await helpers.runPreRequestScript(requestObj.pre_request_script, {
                                    environmentId: envId ?? null,
                                    environmentSnapshot,
                                    requestSnapshot,
                                });
                                console.log('pre-request script logs:', Array.isArray(scriptContext && scriptContext.logs) ? scriptContext.logs : []);
                            } else {
                                console.log('pre-request script exists but script runner helpers unavailable. Script text:', requestObj.pre_request_script.slice(0, 400));
                            }
                        } catch (err) {
                            console.warn('pre-request script execution failed:', err && err.message ? err.message : err);
                        }
                    } else {
                        console.log('no pre-request script for this request');
                    }

                    console.groupEnd();
                } catch (_caseErr) {
                    try { console.warn('[loadtest] diagnostics error for testcase', tc && tc.id); } catch (_e) { }
                }
            }
        } catch (_diagErr) {
            try { console.warn('[loadtest] diagnostics failed', _diagErr); } catch (_e) { }
        }

        setStatus(`Starting load test… Users=${users} SpawnRate=${spawnRate.toFixed(2)}/s (Ramp≈${derivedRampSeconds}s) Duration=${durationSeconds}s`, 'info');

        const csrftoken = readCsrfToken();
        const resp = await fetch(api.loadTests, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                ...(csrftoken ? { 'X-CSRFToken': csrftoken } : {}),
            },
            body: JSON.stringify({
                name: '',
                scope: sel.scope,
                selection: sel.selection,
                users,
                spawn_rate: spawnRate,
                duration_seconds: durationSeconds,
            }),
        });

        let data = null;
        try { data = await resp.json(); } catch (_e) { data = null; }

        if (!resp.ok) {
            setStatus((data && data.error) ? String(data.error) : `Failed to start load test (${resp.status})`, 'error');
            await refreshRuns();
            return;
        }

        setStatus(`Load test started (Run #${data && data.id ? data.id : ''}).`, 'success');
        await refreshRuns();
    };

    const renderPagination = (totalPages) => {
        const currentPage = state.runsPage;
        let paginationHtml = '<div class="pagination" style="display: flex; justify-content: center; align-items: center; gap: 10px; margin-top: 20px; padding: 10px;">';

        // Previous button
        if (currentPage > 1) {
            paginationHtml += `<button type="button" class="btn-secondary" data-action="runs-prev-page" style="padding: 5px 10px;">Previous</button>`;
        }

        // Page numbers
        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(totalPages, currentPage + 2);

        if (startPage > 1) {
            paginationHtml += `<button type="button" class="btn-secondary" data-action="runs-go-to-page" data-page="1" style="padding: 5px 10px;">1</button>`;
            if (startPage > 2) {
                paginationHtml += '<span style="padding: 5px 10px;">...</span>';
            }
        }

        for (let i = startPage; i <= endPage; i++) {
            const isActive = i === currentPage;
            const activeClass = isActive ? 'btn-primary' : 'btn-secondary';
            paginationHtml += `<button type="button" class="${activeClass}" data-action="runs-go-to-page" data-page="${i}" style="padding: 5px 10px;">${i}</button>`;
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                paginationHtml += '<span style="padding: 5px 10px;">...</span>';
            }
            paginationHtml += `<button type="button" class="btn-secondary" data-action="runs-go-to-page" data-page="${totalPages}" style="padding: 5px 10px;">${totalPages}</button>`;
        }

        // Next button
        if (currentPage < totalPages) {
            paginationHtml += `<button type="button" class="btn-secondary" data-action="runs-next-page" style="padding: 5px 10px;">Next</button>`;
        }

        paginationHtml += '</div>';
        return paginationHtml;
    };

    const renderRuns = () => {
        if (!elements.runsList) return;
        const runs = Array.isArray(state.runs) ? state.runs : [];
        if (!runs.length) {
            elements.runsList.innerHTML = '<div class="empty-state">No load tests yet.</div>';
            return;
        }

        const totalPages = Math.ceil(runs.length / state.runsPerPage);
        const startIndex = (state.runsPage - 1) * state.runsPerPage;
        const endIndex = startIndex + state.runsPerPage;
        const paginatedRuns = runs.slice(startIndex, endIndex);

        const statusLabel = (value) => {
            const s = (value || '').toString().toLowerCase();
            if (!s) return '';
            if (s === 'created') return 'Created';
            if (s === 'running') return 'Running';
            if (s === 'finished') return 'Finished';
            if (s === 'stopped') return 'Stopped';
            if (s === 'failed') return 'Failed';
            if (s === 'error') return 'Error';
            return s.charAt(0).toUpperCase() + s.slice(1);
        };

        const html = paginatedRuns.map((r) => {
            const id = r.id;
            const status = statusLabel(r.status || '');
            const started = r.started_at ? new Date(r.started_at).toLocaleString() : '—';
            const finished = r.finished_at ? new Date(r.finished_at).toLocaleString() : '—';
            const report = r.report_html ? `<a href="${escapeHtml(r.report_html)}" target="_blank" rel="noopener">Report</a>` : '—';
            const log = r.log ? `<a href="${escapeHtml(r.log)}" target="_blank" rel="noopener">Log</a>` : '—';
            const stopBtn = String(r.status || '').toLowerCase() === 'running'
                ? `<button type="button" class="action-button" data-action="stop-run" data-run-id="${escapeHtml(id)}">Stop</button>`
                : '';
            return (
                '<div class="automation-item">' +
                '<div class="automation-run__item-header" style="justify-content: space-between;">' +
                `<div><strong>#${escapeHtml(id)}</strong> · <span class="badge">${escapeHtml(status)}</span><div class="muted" style="font-size: 12px; margin-top: 2px;">Users: ${escapeHtml(r.users)} · Ramp: ${escapeHtml(r.ramp_up_seconds)}s · Duration: ${escapeHtml(r.duration_seconds)}s</div></div>` +
                `<div style="display:flex; gap:10px; align-items:center;">` +
                `<span class="muted" style="font-size: 12px;">${escapeHtml(started)} → ${escapeHtml(finished)}</span>` +
                `${report} ${log} ${stopBtn}` +
                '</div>' +
                '</div>' +
                (r.error ? `<div class="muted" style="margin-top:6px; color:#b71c1c;">${escapeHtml(r.error)}</div>` : '') +
                '</div>'
            );
        }).join('');

        const paginationHtml = totalPages > 1 ? renderPagination(totalPages) : '';

        elements.runsList.innerHTML = html + paginationHtml;
    };

    const refreshRuns = async () => {
        if (state.runsPollInFlight) return;
        state.runsPollInFlight = true;
        try {
            const resp = await fetch(api.loadTests, {
                method: 'GET',
                credentials: 'same-origin',
                headers: { 'Accept': 'application/json' },
            });
            if (!resp.ok) throw new Error('Failed to load runs');
            const data = await resp.json();
            state.runs = Array.isArray(data) ? data : [];
            state.runsPage = 1; // Reset to first page when loading new data
            renderRuns();
        } catch (_e) {
            // keep old
            renderRuns();
        } finally {
            state.runsPollInFlight = false;
        }
    };

    const stopRun = async (runId) => {
        if (!runId) return;
        const csrftoken = readCsrfToken();
        const url = api.loadTests.endsWith('/')
            ? `${api.loadTests}${encodeURIComponent(String(runId))}/stop/`
            : `${api.loadTests}/${encodeURIComponent(String(runId))}/stop/`;

        setStatus(`Stopping load test #${runId}…`, 'info');
        try {
            const resp = await fetch(url, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Accept': 'application/json',
                    ...(csrftoken ? { 'X-CSRFToken': csrftoken } : {}),
                },
            });
            if (!resp.ok) throw new Error('Stop failed');
            setStatus(`Load test #${runId} stopped.`, 'success');
        } catch (_e) {
            setStatus(`Failed to stop load test #${runId}.`, 'error');
        }
        await refreshRuns();
    };

    const handleClick = async (ev) => {
        const target = ev.target;
        if (!target) return;

        // Support Run-style fake checkbox clicks
        try {
            if (target.matches && (target.matches('.fake-checkbox') || target.closest('.case-checkbox-label'))) {
                const label = target.closest('.case-checkbox-label');
                if (label) {
                    const input = label.querySelector('input[type="checkbox"]');
                    if (input && input instanceof HTMLInputElement && target !== input) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        input.checked = !input.checked;
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        return;
                    }
                }
            }
        } catch (_e) { /* ignore */ }

        const btn = target && target.closest ? target.closest('[data-action]') : null;
        if (!btn) return;
        const action = btn.getAttribute('data-action');

        if (action === 'project-select') {
            state.activeProjectId = btn.getAttribute('data-project-id');
            state.activeModuleId = null;
            state.activeScenarioId = null;
            state.selectedCaseIds.clear();
            renderProjects();
            renderModules();
            renderScenarios();
            renderCases();
            return;
        }
        if (action === 'project-checkbox') {
            const id = btn.getAttribute('data-project-id');
            const checked = btn.checked;
            if (checked) state.selectedProjectIds.add(String(id));
            else state.selectedProjectIds.delete(String(id));
            return;
        }
        if (action === 'project-loadtest') {
            const id = btn.getAttribute('data-project-id');
            await executeLoadTest('project', [String(id)]);
            return;
        }

        if (action === 'module-select') {
            state.activeModuleId = btn.getAttribute('data-module-id');
            state.activeScenarioId = null;
            state.selectedCaseIds.clear();
            renderModules();
            renderScenarios();
            renderCases();
            return;
        }
        if (action === 'module-checkbox') {
            const id = btn.getAttribute('data-module-id');
            const checked = btn.checked;
            if (checked) state.selectedModuleIds.add(String(id));
            else state.selectedModuleIds.delete(String(id));
            return;
        }
        if (action === 'module-loadtest') {
            const id = btn.getAttribute('data-module-id');
            await executeLoadTest('module', [String(id)]);
            return;
        }
        if (action === 'module-loadtest-all') {
            const project = getActiveProject();
            const modules = collectModulesForProject(project);
            const ids = modules.map(m => String(m.id));
            await executeLoadTest('module', ids);
            return;
        }

        if (action === 'scenario-select') {
            state.activeScenarioId = btn.getAttribute('data-scenario-id');
            state.selectedCaseIds.clear();
            renderScenarios();
            renderCases();
            return;
        }
        if (action === 'scenario-checkbox') {
            const id = btn.getAttribute('data-scenario-id');
            const checked = btn.checked;
            if (checked) state.selectedScenarioIds.add(String(id));
            else state.selectedScenarioIds.delete(String(id));
            return;
        }
        if (action === 'scenario-loadtest') {
            const id = btn.getAttribute('data-scenario-id');
            await executeLoadTest('scenario', [String(id)]);
            return;
        }
        if (action === 'scenario-loadtest-all') {
            const project = getActiveProject();
            const scenarios = collectScenariosForProject(project, state.activeModuleId);
            const ids = scenarios.map(s => String(s.id));
            await executeLoadTest('scenario', ids);
            return;
        }

        if (action === 'case-checkbox') {
            const id = btn.getAttribute('data-case-id');
            const checked = btn.checked;
            if (checked) state.selectedCaseIds.add(String(id));
            else state.selectedCaseIds.delete(String(id));
            return;
        }

        if (action === 'select-all-cases') {
            const checked = btn.checked;
            const tableRoot = elements.caseTable;
            const boxes = tableRoot ? Array.from(tableRoot.querySelectorAll('input.case-checkbox')) : [];
            boxes.forEach((cb) => {
                try {
                    cb.checked = checked;
                    const id = cb.getAttribute('data-case-id');
                    if (!id) return;
                    if (checked) state.selectedCaseIds.add(String(id));
                    else state.selectedCaseIds.delete(String(id));
                } catch (_e) { /* ignore */ }
            });
            return;
        }

        if (action === 'case-loadtest') {
            const id = btn.getAttribute('data-case-id');
            if (!id) return;
            await executeLoadTest('testcase', [String(id)]);
            return;
        }

        if (action === 'start-load-test') {
            openConfigModal(null, null);
            return;
        }

        if (action === 'loadtest-modal-close') {
            closeConfigModal();
            return;
        }

        if (action === 'loadtest-modal-run') {
            const pending = state.pendingRunSelection || { overrideScope: null, overrideIds: null };
            closeConfigModal();
            await executeLoadTest(pending.overrideScope, pending.overrideIds);
            return;
        }

        if (action === 'stop-run') {
            const id = btn.getAttribute('data-run-id');
            await stopRun(id);
            return;
        }

        if (action === 'runs-prev-page') {
            if (state.runsPage > 1) {
                state.runsPage--;
                renderRuns();
            }
            return;
        }

        if (action === 'runs-next-page') {
            const totalPages = Math.ceil((Array.isArray(state.runs) ? state.runs.length : 0) / state.runsPerPage);
            if (state.runsPage < totalPages) {
                state.runsPage++;
                renderRuns();
            }
            return;
        }

        if (action === 'runs-go-to-page') {
            const page = parseInt(btn.getAttribute('data-page'), 10);
            const totalPages = Math.ceil((Array.isArray(state.runs) ? state.runs.length : 0) / state.runsPerPage);
            if (page >= 1 && page <= totalPages) {
                state.runsPage = page;
                renderRuns();
            }
            return;
        }
    };

    const initDefaults = () => {
        // pick first project
        if (state.projects.length) {
            state.activeProjectId = state.projects[0].id;
        }
    };

    const init = async () => {
        initDefaults();
        renderProjects();
        renderModules();
        renderScenarios();
        renderCases();

        root.addEventListener('click', (ev) => {
            handleClick(ev);
        });
        root.addEventListener('change', (ev) => {
            handleClick(ev);
        });

        // Modal events
        if (elements.configModal) {
            elements.configModal.addEventListener('click', (ev) => {
                handleClick(ev);
            });
            elements.configModal.addEventListener('click', (ev) => {
                if (ev.target === elements.configModal) {
                    closeConfigModal();
                }
            });
        }
        document.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape' && elements.configModal && !elements.configModal.hidden) {
                closeConfigModal();
            }
        });

        await refreshRuns();

        // Poll runs if any is running
        state.runsPollTimer = window.setInterval(async () => {
            const anyRunning = Array.isArray(state.runs) && state.runs.some(r => r && r.status === 'running');
            if (!anyRunning) return;
            await refreshRuns();
        }, 3000);

        setStatus('Ready.', 'info');
    };

    init();
})();
