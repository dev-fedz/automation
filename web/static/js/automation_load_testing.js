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

    const renderRuns = () => {
        if (!elements.runsList) return;
        const runs = Array.isArray(state.runs) ? state.runs : [];
        if (!runs.length) {
            elements.runsList.innerHTML = '<div class="empty-state">No load tests yet.</div>';
            return;
        }

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

        const html = runs.map((r) => {
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

        elements.runsList.innerHTML = html;
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
