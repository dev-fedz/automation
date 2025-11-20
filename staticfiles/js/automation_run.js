(function () {
    const root = document.getElementById('automation-run');
    if (!root) {
        return;
    }

    const responseCloseButton = document.getElementById('testcase-response-close');
    if (responseCloseButton) {
        responseCloseButton.addEventListener('click', () => {
            try {
                if (window.__automationTestcaseControls && typeof window.__automationTestcaseControls.closeModal === 'function') {
                    window.__automationTestcaseControls.closeModal();
                }
            } catch (_error) {
                /* ignore close issues */
            }
        });
    }

    const getJsonScript = (id, fallback) => {
        const node = document.getElementById(id);
        if (!node) {
            return Array.isArray(fallback) ? [] : (fallback || null);
        }
        try {
            return JSON.parse(node.textContent);
        } catch (error) {
            console.error('[automation-run] Failed to parse JSON from', id, error);
            return Array.isArray(fallback) ? [] : (fallback || null);
        }
    };

    const escapeHtml = (value) => {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    const stringId = (value) => {
        if (value === null || value === undefined) {
            return null;
        }
        return String(value);
    };

    const truncate = (value, max) => {
        const text = value ? String(value) : '';
        if (text.length <= max) {
            return text;
        }
        const limit = Math.max(0, max - 3);
        return `${text.slice(0, limit)}...`;
    };

    const projects = getJsonScript('automation-run-projects', []);
    const environments = getJsonScript('automation-run-environments', []);
    const endpoints = getJsonScript('automation-api-endpoints', {});

    const state = {
        projects: Array.isArray(projects) ? projects : [],
        environments: Array.isArray(environments) ? environments : [],
        endpoints: endpoints && typeof endpoints === 'object' ? endpoints : {},
        activeProjectId: null,
        activeModuleId: null,
        activeScenarioId: null,
        selectedModules: new Set(),
        selectedScenarios: new Set(),
    };

    const elements = {
        projectList: root.querySelector('[data-role="project-list"]'),
        moduleList: root.querySelector('[data-role="module-list"]'),
        scenarioList: root.querySelector('[data-role="scenario-list"]'),
        moduleRunAll: root.querySelector('[data-role="module-run-all"]'),
        scenarioRunAll: root.querySelector('[data-role="scenario-run-all"]'),
        moduleSubtitle: root.querySelector('[data-role="module-subtitle"]'),
        scenarioSubtitle: root.querySelector('[data-role="scenario-subtitle"]'),
        caseSubtitle: root.querySelector('[data-role="case-subtitle"]'),
        caseTableContainer: root.querySelector('[data-role="case-table"]'),
        caseList: root.querySelector('[data-role="case-list"]'),
        runCasesButton: root.querySelector('#run-cases-btn'),
    };

    // Sequential run delay (ms) for fallback batch runs. Can be overridden by
    // setting `window.__automationRunOptions = { sequentialDelay: 400 }` before
    // this script runs. Also exposed via `window.__automationRunControls` below.
    let sequentialRunDelay = 600;
    try {
        if (typeof window !== 'undefined' && window.__automationRunOptions && typeof window.__automationRunOptions.sequentialDelay === 'number') {
            sequentialRunDelay = Number(window.__automationRunOptions.sequentialDelay) || sequentialRunDelay;
        }
    } catch (_e) {
        /* ignore */
    }

    const getProjectById = (projectId) => {
        if (!projectId) {
            return null;
        }
        return state.projects.find((project) => String(project.id) === String(projectId)) || null;
    };

    const getProjectModules = (project) => {
        if (!project) {
            return [];
        }
        const modules = Array.isArray(project.test_modules) ? project.test_modules.slice() : [];
        modules.sort((a, b) => {
            const nameA = String(a.title || '').toLowerCase();
            const nameB = String(b.title || '').toLowerCase();
            if (nameA < nameB) {
                return -1;
            }
            if (nameA > nameB) {
                return 1;
            }
            return String(a.id).localeCompare(String(b.id));
        });
        return modules;
    };

    const getProjectScenarios = (project) => {
        if (!project) {
            return [];
        }
        const scenarios = Array.isArray(project.scenarios) ? project.scenarios.slice() : [];
        scenarios.sort((a, b) => {
            const titleA = String(a.title || '').toLowerCase();
            const titleB = String(b.title || '').toLowerCase();
            if (titleA < titleB) {
                return -1;
            }
            if (titleA > titleB) {
                return 1;
            }
            return String(a.id).localeCompare(String(b.id));
        });
        return scenarios;
    };

    const getScenariosForModule = (project, moduleId) => {
        const scenarios = getProjectScenarios(project);
        if (!moduleId) {
            return scenarios;
        }
        return scenarios.filter((scenario) => String(scenario.module_id || scenario.module) === String(moduleId));
    };

    const getScenarioById = (project, scenarioId) => {
        if (!project || !scenarioId) {
            return null;
        }
        return getProjectScenarios(project).find((scenario) => String(scenario.id) === String(scenarioId)) || null;
    };

    const buildCaseDescriptor = (caseData, scenario) => {
        const caseId = stringId(caseData?.id);
        const descriptor = {
            caseId,
            rawCaseId: caseId,
            title: caseData?.title || caseData?.testcase_id || (caseId ? `Case ${caseId}` : 'Untitled case'),
            requestId: caseData?.related_api_request || null,
            envId: caseData?.environment_id || null,
            scenarioId: stringId(scenario?.id),
            requiresDependency: Boolean(caseData?.requires_dependency),
            dependencyCaseId: caseData?.test_case_dependency !== null && caseData?.test_case_dependency !== undefined
                ? stringId(caseData.test_case_dependency)
                : null,
            dependencyKey: caseData?.dependency_response_key || '',
            expectedResults: Array.isArray(caseData?.expected_results) ? caseData.expected_results : [],
            responseEncrypted: Boolean(caseData?.is_response_encrypted),
        };
        return descriptor;
    };

    const collectProjectCases = (project) => {
        if (!project) {
            return [];
        }
        const seen = new Set();
        const results = [];
        getProjectScenarios(project).forEach((scenario) => {
            const cases = Array.isArray(scenario.cases) ? scenario.cases : [];
            cases.forEach((caseData) => {
                const caseId = stringId(caseData?.id);
                if (caseId && seen.has(caseId)) {
                    return;
                }
                if (caseId) {
                    seen.add(caseId);
                }
                results.push(buildCaseDescriptor(caseData, scenario));
            });
        });
        return results;
    };

    const collectModuleCases = (project, moduleIds) => {
        if (!project || !Array.isArray(moduleIds) || !moduleIds.length) {
            return [];
        }
        const ids = new Set(moduleIds.map((value) => String(value)));
        const seen = new Set();
        const results = [];
        getProjectScenarios(project).forEach((scenario) => {
            const scenarioModuleId = String(scenario.module_id || scenario.module);
            if (!ids.has(scenarioModuleId)) {
                return;
            }
            const cases = Array.isArray(scenario.cases) ? scenario.cases : [];
            cases.forEach((caseData) => {
                const caseId = stringId(caseData?.id);
                if (caseId && seen.has(caseId)) {
                    return;
                }
                if (caseId) {
                    seen.add(caseId);
                }
                results.push(buildCaseDescriptor(caseData, scenario));
            });
        });
        return results;
    };

    const collectScenarioCases = (project, scenarioIds) => {
        if (!project || !Array.isArray(scenarioIds) || !scenarioIds.length) {
            return [];
        }
        const ids = new Set(scenarioIds.map((value) => String(value)));
        const results = [];
        const seen = new Set();
        getProjectScenarios(project).forEach((scenario) => {
            if (!ids.has(String(scenario.id))) {
                return;
            }
            const cases = Array.isArray(scenario.cases) ? scenario.cases : [];
            cases.forEach((caseData) => {
                const caseId = stringId(caseData?.id);
                if (caseId && seen.has(caseId)) {
                    return;
                }
                if (caseId) {
                    seen.add(caseId);
                }
                results.push(buildCaseDescriptor(caseData, scenario));
            });
        });
        return results;
    };

    const updateSubtitle = (node, text) => {
        if (!node) {
            return;
        }
        if (text) {
            node.textContent = text;
        } else {
            node.textContent = '';
        }
    };

    const syncModuleBulkAction = () => {
        const button = elements.moduleRunAll;
        if (!button) {
            return;
        }
        const count = state.selectedModules.size;
        if (count > 0) {
            button.style.display = 'inline-flex';
            button.textContent = 'Run All';
            button.disabled = false;
        } else {
            button.style.display = 'none';
        }
    };

    const syncScenarioBulkAction = () => {
        const button = elements.scenarioRunAll;
        if (!button) {
            return;
        }
        const count = state.selectedScenarios.size;
        if (count > 0) {
            button.style.display = 'inline-flex';
            button.textContent = 'Run All';
            button.disabled = false;
        } else {
            button.style.display = 'none';
        }
    };

    const hideRunCasesButton = () => {
        const button = elements.runCasesButton;
        if (!button) {
            return;
        }
        try {
            button.style.setProperty('display', 'none', 'important');
            button.setAttribute('aria-hidden', 'true');
        } catch (error) {
            button.style.display = 'none';
            button.setAttribute('aria-hidden', 'true');
        }
    };

    const showRunCasesButton = () => {
        const button = elements.runCasesButton;
        if (!button) return;
        try {
            button.style.setProperty('display', 'inline-flex', 'important');
            button.removeAttribute('aria-hidden');
            button.disabled = false;
        } catch (e) {
            button.style.display = 'inline-flex';
            button.removeAttribute('aria-hidden');
            button.disabled = false;
        }
    };

    const renderProjects = () => {
        const container = elements.projectList;
        if (!container) {
            return;
        }
        if (!state.projects.length) {
            container.innerHTML = '<p class="empty">No projects available yet.</p>';
            return;
        }
        const items = state.projects.map((project) => {
            const projectId = stringId(project.id);
            const isActive = projectId && projectId === state.activeProjectId;
            return (
                `<div class="automation-item${isActive ? ' is-active' : ''}" data-project-id="${escapeHtml(projectId || '')}">` +
                '<div class="automation-run__item-header">' +
                `<button type="button" class="automation-run__item-select" data-action="project-select" data-project-id="${escapeHtml(projectId || '')}">` +
                `<strong>${escapeHtml(project.name || 'Untitled project')}</strong>` +
                '</button>' +
                `<button type="button" class="action-button" data-action="project-play" data-project-id="${escapeHtml(projectId || '')}">Run</button>` +
                '</div>' +
                '</div>'
            );
        });
        container.innerHTML = items.join('');
    };

    const renderModules = () => {
        const project = getProjectById(state.activeProjectId);
        const container = elements.moduleList;
        if (!container) {
            return;
        }
        const modules = getProjectModules(project);
        const validIds = new Set(modules.map((module) => String(module.id)));
        Array.from(state.selectedModules).forEach((moduleId) => {
            if (!validIds.has(String(moduleId))) {
                state.selectedModules.delete(moduleId);
            }
        });
        updateSubtitle(elements.moduleSubtitle, project ? `Project: ${project.name || 'Untitled project'}` : '');
        if (!project) {
            container.innerHTML = '<p class="empty">Select a project to view modules.</p>';
            syncModuleBulkAction();
            return;
        }
        if (!modules.length) {
            container.innerHTML = '<p class="empty">This project has no modules yet.</p>';
            syncModuleBulkAction();
            return;
        }
        const items = modules.map((module) => {
            const moduleId = stringId(module.id);
            const isActive = moduleId && moduleId === state.activeModuleId;
            const isChecked = state.selectedModules.has(moduleId);
            return (
                `<div class="automation-item${isActive ? ' is-active' : ''}" data-module-id="${escapeHtml(moduleId || '')}">` +
                '<div class="automation-run__item-header">' +
                `<label class="automation-run__checkbox-group" for="automation-module-${escapeHtml(moduleId || '')}">` +
                `<input type="checkbox" id="automation-module-${escapeHtml(moduleId || '')}" data-action="module-checkbox" data-module-id="${escapeHtml(moduleId || '')}" aria-label="Select module ${escapeHtml(module.title || 'Untitled module')}" ${isChecked ? 'checked' : ''}>` +
                '</label>' +
                `<button type="button" class="automation-run__item-select" data-action="module-select" data-module-id="${escapeHtml(moduleId || '')}">` +
                `<strong>${escapeHtml(module.title || 'Untitled module')}</strong>` +
                '</button>' +
                `<button type="button" class="action-button" data-action="module-play" data-module-id="${escapeHtml(moduleId || '')}">Run</button>` +
                '</div>' +
                '</div>'
            );
        });
        container.innerHTML = items.join('');
        syncModuleBulkAction();
    };

    const renderScenarios = () => {
        const project = getProjectById(state.activeProjectId);
        const container = elements.scenarioList;
        if (!container) {
            return;
        }
        const scenarios = project ? getScenariosForModule(project, state.activeModuleId) : [];
        const validIds = new Set(scenarios.map((scenario) => String(scenario.id)));
        Array.from(state.selectedScenarios).forEach((scenarioId) => {
            if (!validIds.has(String(scenarioId))) {
                state.selectedScenarios.delete(scenarioId);
            }
        });
        const module = project && state.activeModuleId ? getProjectModules(project).find((item) => String(item.id) === String(state.activeModuleId)) : null;
        updateSubtitle(elements.scenarioSubtitle, module ? `Module: ${module.title || 'Untitled module'}` : project ? 'All modules' : '');
        if (!project) {
            container.innerHTML = '<p class="empty">Select a project to load scenarios.</p>';
            syncScenarioBulkAction();
            return;
        }
        if (!scenarios.length) {
            container.innerHTML = '<p class="empty">No scenarios found for this selection.</p>';
            syncScenarioBulkAction();
            return;
        }
        const items = scenarios.map((scenario) => {
            const scenarioId = stringId(scenario.id);
            const isActive = scenarioId && scenarioId === state.activeScenarioId;
            const isChecked = state.selectedScenarios.has(scenarioId);
            const hasCases = Array.isArray(scenario.cases) && scenario.cases.length > 0;
            const disabledAttr = hasCases ? '' : ' disabled aria-disabled="true" title="No test cases for this scenario"';
            const checkboxDisabledAttr = hasCases ? '' : ' disabled aria-disabled="true" title="No test cases for this scenario"';
            return (
                `<div class="automation-item${isActive ? ' is-active' : ''}" data-scenario-id="${escapeHtml(scenarioId || '')}">` +
                '<div class="automation-run__item-header">' +
                `<label class="automation-run__checkbox-group" for="automation-scenario-${escapeHtml(scenarioId || '')}">` +
                `<input type="checkbox" id="automation-scenario-${escapeHtml(scenarioId || '')}" data-action="scenario-checkbox" data-scenario-id="${escapeHtml(scenarioId || '')}" aria-label="Select scenario ${escapeHtml(scenario.title || 'Untitled scenario')}" ${isChecked ? 'checked' : ''}${checkboxDisabledAttr}>` +
                '</label>' +
                `<button type="button" class="automation-run__item-select" data-action="scenario-select" data-scenario-id="${escapeHtml(scenarioId || '')}">` +
                `<strong>${escapeHtml(scenario.title || 'Untitled scenario')}</strong>` +
                '</button>' +
                `<button type="button" class="action-button" data-action="scenario-play" data-scenario-id="${escapeHtml(scenarioId || '')}"${disabledAttr}>Run</button>` +
                '</div>' +
                '</div>'
            );
        });
        container.innerHTML = items.join('');
        syncScenarioBulkAction();
    };

    const buildCaseTable = (scenario, cases) => {
        const scenarioId = stringId(scenario?.id);
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
            const caseId = stringId(caseData?.id);
            if (caseId) {
                tr.dataset.caseId = caseId;
            }
            if (scenarioId) {
                tr.dataset.scenarioId = scenarioId;
            }
            tr.dataset.responseEncrypted = caseData?.is_response_encrypted ? 'true' : 'false';
            tr.dataset.requiresDependency = caseData?.requires_dependency ? 'true' : 'false';
            if (caseData?.test_case_dependency !== null && caseData?.test_case_dependency !== undefined) {
                tr.dataset.dependencyId = stringId(caseData.test_case_dependency) || '';
            }
            if (caseData?.dependency_response_key) {
                tr.dataset.dependencyKey = caseData.dependency_response_key;
            }
            if (Array.isArray(caseData?.expected_results) && caseData.expected_results.length) {
                try {
                    tr.dataset.expectedResults = JSON.stringify(caseData.expected_results);
                } catch (error) {
                    /* ignore stringify issues */
                }
            }

            const checkboxCell = document.createElement('td');
            const checkboxLabel = document.createElement('label');
            checkboxLabel.className = 'case-checkbox-label';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'case-checkbox';
            checkbox.setAttribute('data-case-id', caseId || '');
            checkbox.setAttribute('aria-label', `Select test case ${caseData?.testcase_id || caseId || ''}`);
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
            const runButton = document.createElement('button');
            runButton.type = 'button';
            runButton.className = 'action-button';
            runButton.dataset.action = 'run-case';
            runButton.dataset.caseId = caseId || '';
            runButton.dataset.scenarioId = scenarioId || '';
            runButton.dataset.requestId = caseData?.related_api_request ? String(caseData.related_api_request) : '';
            runButton.dataset.envId = caseData?.environment_id ? String(caseData.environment_id) : '';
            runButton.dataset.responseEncrypted = caseData?.is_response_encrypted ? 'true' : 'false';
            runButton.dataset.requiresDependency = caseData?.requires_dependency ? 'true' : 'false';
            if (caseData?.test_case_dependency !== null && caseData?.test_case_dependency !== undefined) {
                runButton.dataset.dependencyId = String(caseData.test_case_dependency);
            }
            if (caseData?.dependency_response_key) {
                runButton.dataset.dependencyKey = caseData.dependency_response_key;
            }
            runButton.textContent = 'Run';
            if (!caseData?.related_api_request) {
                runButton.disabled = true;
                runButton.title = 'Link this test case to an API request to enable runs.';
            }
            actionGroup.appendChild(runButton);
            actionsCell.appendChild(actionGroup);
            tr.appendChild(actionsCell);

            tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        return table;
    };

    const renderCases = () => {
        const project = getProjectById(state.activeProjectId);
        const scenario = getScenarioById(project, state.activeScenarioId);
        const container = elements.caseTableContainer;
        if (!container) {
            return;
        }
        container.innerHTML = '';
        if (!project) {
            updateSubtitle(elements.caseSubtitle, '');
            container.innerHTML = '<p class="empty">Select a project to view test cases.</p>';
            hideRunCasesButton();
            return;
        }
        if (!scenario) {
            updateSubtitle(elements.caseSubtitle, '');
            container.innerHTML = '<p class="empty">Select a scenario to see its test cases.</p>';
            hideRunCasesButton();
            return;
        }
        updateSubtitle(elements.caseSubtitle, `Scenario: ${scenario.title || 'Untitled scenario'}`);
        const normalizedCases = Array.isArray(scenario.cases) ? scenario.cases : [];
        if (!normalizedCases.length) {
            container.innerHTML = '<p class="empty">No test cases defined for this scenario.</p>';
            hideRunCasesButton();
            return;
        }
        container.appendChild(buildCaseTable(scenario, normalizedCases));
        window.setTimeout(hideRunCasesButton, 0);
    };

    // ----- Case checkbox helper functions (borrowed from Projects > Test Case page) -----
    function getRunBtn() { return elements.runCasesButton || document.getElementById('run-cases-btn'); }

    function getSelectAll() { return document.getElementById('select-all-cases'); }

    function getRowCheckboxes() {
        const container = elements.caseTableContainer;
        if (!container) return [];
        const table = container.querySelector('table');
        if (!table) return [];
        return Array.from(table.querySelectorAll('input.case-checkbox'));
    }

    function debounce(fn, wait) {
        let timer = null;
        return function debounced() {
            const ctx = this;
            const args = arguments;
            if (timer) clearTimeout(timer);
            timer = setTimeout(function () {
                timer = null;
                try { fn.apply(ctx, args); } catch (e) { /* ignore */ }
            }, wait);
        };
    }

    function ensureRunBtn() {
        let btn = getRunBtn();
        if (btn) return btn;
        const list = elements.caseList || (elements.caseTableContainer ? elements.caseTableContainer : document.body);
        if (!list) return null;
        btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'run-cases-btn';
        btn.className = 'btn-primary';
        btn.textContent = 'Run Selected Case';
        try { btn.style.setProperty('display', 'none', 'important'); btn.style.setProperty('margin-bottom', '12px', 'important'); } catch (e) { btn.style.display = 'none'; btn.style.marginBottom = '12px'; }
        const table = list.querySelector('table');
        if (table && table.parentNode) table.parentNode.insertBefore(btn, table);
        else list.insertBefore(btn, list.firstChild);
        // update elements reference
        elements.runCasesButton = btn;
        return btn;
    }

    function setRunBtnVisible(visible) {
        const btn = getRunBtn();
        if (!btn) return;
        try {
            if (visible) {
                btn.style.setProperty('display', 'inline-flex', 'important');
                btn.removeAttribute('aria-hidden');
            } else {
                btn.style.setProperty('display', 'none', 'important');
                btn.setAttribute('aria-hidden', 'true');
            }
        } catch (e) { /* ignore */ }
    }

    function updateSelectAllState() {
        try { ensureRunBtn(); } catch (e) { /* ignore */ }
        const selectAll = getSelectAll();
        const boxes = getRowCheckboxes();
        if (!selectAll && boxes.length === 0) {
            setRunBtnVisible(false);
            return;
        }
        if (boxes.length === 0) {
            if (selectAll) {
                selectAll.checked = false;
                selectAll.indeterminate = false;
                selectAll.disabled = true;
            }
            setRunBtnVisible(false);
            return;
        }
        if (selectAll) selectAll.disabled = false;
        const checked = boxes.filter(b => b.checked).length;
        if (selectAll) {
            selectAll.checked = (checked === boxes.length);
            selectAll.indeterminate = (checked > 0 && checked < boxes.length);
            try {
                const headerFake = selectAll.parentElement && selectAll.parentElement.querySelector('.fake-checkbox');
                if (headerFake) {
                    headerFake.classList.toggle('header-indeterminate', selectAll.indeterminate === true);
                    headerFake.classList.toggle('checked', selectAll.checked === true);
                }
            } catch (e) { /* ignore */ }
        }
        setRunBtnVisible(checked > 0);
    }

    const debouncedUpdateSelectAllState = debounce(updateSelectAllState, 40);

    // Initial sync
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateSelectAllState);
    } else {
        updateSelectAllState();
    }

    // Expose for other scripts
    try {
        window.syncCaseSelectionState = updateSelectAllState;
        window.scheduleCaseSelectionState = debouncedUpdateSelectAllState;
    } catch (e) { /* ignore */ }

    // Listen for clicks on fake-checkbox/labels to schedule state update
    document.addEventListener('click', function (ev) {
        const t = ev.target;
        if (!t) return;
        if (t.matches('.fake-checkbox') || t.closest('.case-checkbox-label')) {
            // If the visible fake-checkbox was clicked, ensure the underlying native
            // input toggles reliably across browsers by explicitly toggling it here.
            try {
                const label = t.closest('.case-checkbox-label');
                if (label) {
                    const input = label.querySelector('input[type="checkbox"]');
                    if (input && input instanceof HTMLInputElement) {
                        // If the input wasn't the original click target, toggle it here
                        // and dispatch a change event. Prevent double toggles by
                        // stopping propagation of the click when we handle it.
                        if (ev.target !== input) {
                            ev.preventDefault();
                            ev.stopPropagation();
                            input.checked = !input.checked;
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }
                }
            } catch (err) { /* ignore */ }
            try { debouncedUpdateSelectAllState(); } catch (e) { setTimeout(updateSelectAllState, 0); }
        }
    });

    // NOTE: header select-all is handled by the central `root.addEventListener('change', ...)`
    // above. Avoid duplicating that logic here to prevent conflicting toggles.

    // Observe changes to the case table container and re-run state update
    if (elements.caseTableContainer) {
        try {
            const mo = new MutationObserver(function () { try { debouncedUpdateSelectAllState(); } catch (e) { setTimeout(updateSelectAllState, 0); } });
            mo.observe(elements.caseTableContainer, { childList: true, subtree: true, attributes: true });
        } catch (e) { /* ignore */ }
    }

    const renderAll = () => {
        renderProjects();
        renderModules();
        renderScenarios();
        renderCases();
    };

    const initializeSelection = () => {
        const firstProject = state.projects[0] || null;
        if (firstProject) {
            state.activeProjectId = stringId(firstProject.id);
            const modules = getProjectModules(firstProject);
            state.activeModuleId = modules.length ? stringId(modules[0].id) : null;
            const scenarios = getProjectScenarios(firstProject);
            let initialScenario = null;
            if (state.activeModuleId) {
                initialScenario = scenarios.find((scenario) => String(scenario.module_id || scenario.module) === state.activeModuleId) || null;
            }
            if (!initialScenario && scenarios.length) {
                initialScenario = scenarios[0];
            }
            state.activeScenarioId = initialScenario ? stringId(initialScenario.id) : null;
        }
    };

    const ensureMultiRunner = () => new Promise((resolve, reject) => {
        const attemptResolve = () => {
            if (window.__automationMultiRunner && typeof window.__automationMultiRunner.runCaseBatch === 'function') {
                resolve(window.__automationMultiRunner);
                return true;
            }
            return false;
        };
        if (attemptResolve()) {
            return;
        }
        let attempts = 0;
        const maxAttempts = 40;
        const timer = window.setInterval(() => {
            attempts += 1;
            if (attemptResolve()) {
                window.clearInterval(timer);
                return;
            }
            if (attempts >= maxAttempts) {
                window.clearInterval(timer);
                reject(new Error('Multi-runner helpers unavailable'));
            }
        }, 100);
    });

    const runCaseBatchWithModal = (cases, options) => {
        if (!Array.isArray(cases) || !cases.length) {
            window.alert('No runnable test cases were found for this selection.');
            return Promise.resolve(null);
        }
        // Prefer the dedicated multi-runner helper if present
        try {
            if (window.__automationMultiRunner && typeof window.__automationMultiRunner.runCaseBatch === 'function') {
                return Promise.resolve(window.__automationMultiRunner.runCaseBatch(cases, options || {}));
            }
        } catch (e) {
            /* ignore and fallback */
        }

        // Fallback: if testcase controls expose a runRequest helper, run requests sequentially
        if (window.__automationTestcaseControls && typeof window.__automationTestcaseControls.runRequest === 'function') {
            // Ensure an AutomationReport exists even when the multi-runner bundle
            // didn't initialize. This helper creates a report and sets a global
            // so downstream execute calls can include `automation_report_id`.
            if (!window.__automationCreateReport) {
                window.__automationCreateReport = async function (triggeredIn) {
                    // coalesce concurrent create calls using a shared in-flight promise
                    try {
                        if (window.__automationCreateReportPromise) {
                            try { console.log('[automation] __automationCreateReport (fallback): using in-flight promise'); } catch (_e) { }
                            return await window.__automationCreateReportPromise;
                        }
                    } catch (_e) { }

                    window.__automationCreateReportPromise = (async () => {
                        try {
                            // Try server-canonical reuse first if we have a last id
                            try {
                                const lastId = window.__lastAutomationReportId || null;
                                if (lastId) {
                                    try {
                                        const detailUrl = `/api/core/automation-report/${Number(lastId)}/`;
                                        const detailResp = await fetch(detailUrl, { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } });
                                        if (detailResp && detailResp.ok) {
                                            try {
                                                const canonical = await detailResp.json();
                                                if (canonical && (canonical.finished === null || canonical.finished === undefined)) {
                                                    try { console.log('[automation] __automationCreateReport (fallback) reusing server unfinished report', lastId); } catch (_e) { }
                                                    return Number(lastId);
                                                }
                                            } catch (_e) { /* ignore parse errors */ }
                                        }
                                    } catch (_e) { /* ignore fetch errors */ }
                                }
                            } catch (_e) { /* ignore */ }

                            const name = 'csrftoken';
                            let csrftoken = null;
                            try {
                                const cparts = document.cookie.split(';').map(s => s.trim()).filter(Boolean);
                                for (const p of cparts) { if (p.startsWith(name + '=')) { csrftoken = decodeURIComponent(p.split('=')[1]); break; } }
                            } catch (e) { csrftoken = null; }
                            const url = '/api/core/automation-report/create/';
                            const resp = await fetch(url, {
                                method: 'POST',
                                credentials: 'same-origin',
                                headers: { 'Content-Type': 'application/json', ...(csrftoken ? { 'X-CSRFToken': csrftoken } : {}) },
                                body: JSON.stringify({ triggered_in: triggeredIn || 'ui-run' }),
                            });
                            if (!resp.ok) {
                                try { console.warn('[automation] create report failed, status', resp.status); } catch (_e) { }
                                return null;
                            }
                            const body = await resp.json();
                            try { window.__lastAutomationReportId = body && body.id ? Number(body.id) : null; } catch (_e) { }
                            try { window.__lastAutomationReportCreatedAt = Date.now(); } catch (_e) { }
                            try { window.__lastAutomationReportFinished = false; } catch (_e) { }
                            try { console.log('[automation] created automation report (fallback path)', body); } catch (_e) { }
                            return body && body.id ? Number(body.id) : null;
                        } catch (err) {
                            try { console.warn('[automation] failed to create automation report (fallback)', err); } catch (_e) { }
                            return null;
                        } finally {
                            try { delete window.__automationCreateReportPromise; } catch (_e) { window.__automationCreateReportPromise = null; }
                        }
                    })();

                    try { return await window.__automationCreateReportPromise; } catch (_e) { return null; }
                };
            }
            // Finalize helper: allow manual or programmatic PATCHing of totals
            if (!window.__automationFinalizeReport) {
                window.__automationFinalizeReport = async function (reportId, totals) {
                    try {
                        const id = reportId || (window.__lastAutomationReportId ? Number(window.__lastAutomationReportId) : null);
                        if (!id) {
                            try { console.warn('[automation] finalize: no report id available'); } catch (_e) { }
                            return null;
                        }
                        // collect totals fallback when not provided
                        let payloadTotals = totals || null;
                        if (!payloadTotals) {
                            try {
                                if (window.__automationMultiRunner && typeof window.__automationMultiRunner.getScenarioTotals === 'function') {
                                    const modal = document.getElementById('testcase-multi-response-modal');
                                    const res = window.__automationMultiRunner.getScenarioTotals(modal);
                                    payloadTotals = res && res.totals ? res.totals : null;
                                }
                            } catch (_e) { payloadTotals = null; }
                        }
                        if (!payloadTotals) {
                            // DOM fallback: attempt to read totals elements
                            try {
                                const passedEl = document.querySelector('[data-role="multi-total-passed"]');
                                const failedEl = document.querySelector('[data-role="multi-total-failed"]');
                                const blockedEl = document.querySelector('[data-role="multi-total-blocked"]');
                                payloadTotals = {
                                    passed: Number((passedEl && passedEl.textContent) ? Number(passedEl.textContent) : 0),
                                    failed: Number((failedEl && failedEl.textContent) ? Number(failedEl.textContent) : 0),
                                    blocked: Number((blockedEl && blockedEl.textContent) ? Number(blockedEl.textContent) : 0),
                                };
                            } catch (_e) { payloadTotals = { passed: 0, failed: 0, blocked: 0 }; }
                        }

                        const name = 'csrftoken';
                        let csrftoken = null;
                        try {
                            const cparts = document.cookie.split(';').map(s => s.trim()).filter(Boolean);
                            for (const p of cparts) { if (p.startsWith(name + '=')) { csrftoken = decodeURIComponent(p.split('=')[1]); break; } }
                        } catch (e) { csrftoken = null; }

                        const detailUrl = `/api/core/automation-report/${id}/`;
                        const patchBody = {
                            total_passed: Number(payloadTotals.passed || 0),
                            total_failed: Number(payloadTotals.failed || 0),
                            total_blocked: Number(payloadTotals.blocked || 0),
                            finished: (new Date()).toISOString(),
                        };
                        try { console.log('[automation] finalize PATCH', detailUrl, patchBody); } catch (_e) { }
                        const resp = await fetch(detailUrl, {
                            method: 'PATCH',
                            credentials: 'same-origin',
                            headers: { 'Content-Type': 'application/json', ...(csrftoken ? { 'X-CSRFToken': csrftoken } : {}) },
                            body: JSON.stringify(patchBody),
                        });
                        // Detect authentication issues early and provide actionable logs
                        if (resp.status === 401) {
                            try { console.warn('[automation] finalize PATCH returned 401 Unauthorized; session may be expired'); } catch (_e) { }
                            try { console.warn('[automation] document.cookie:', document.cookie); } catch (_e) { }
                            try { alert('Your session appears to be unauthenticated. Please sign in again and retry the run.'); } catch (_e) { }
                            return null;
                        }
                        let body = null;
                        try { body = await resp.json(); } catch (_e) { body = null; }
                        try { console.log('[automation] finalize response', resp.status, body); } catch (_e) { }
                        return body;
                    } catch (err) {
                        try { console.warn('[automation] finalize failed', err); } catch (_e) { }
                        return null;
                    }
                };
            }
            try {
                // create report proactively; ignore errors
                (async () => { try { await window.__automationCreateReport('ui-fallback-run'); } catch (_e) { } })();
            } catch (_e) { }
            const runnableRequests = cases.map((c) => c.requestId).filter((r) => r);
            if (!runnableRequests.length) {
                window.alert('Selected cases do not have linked API requests to run.');
                return Promise.resolve(null);
            }
            // Run sequentially with a small delay so modal can reuse UI
            return new Promise((resolve) => {
                let i = 0;
                const total = runnableRequests.length;
                const runButton = elements.runCasesButton;
                const originalText = runButton ? runButton.textContent : null;
                const setRunningState = (index) => {
                    if (!runButton) return;
                    runButton.disabled = true;
                    runButton.classList.add('is-running');
                    runButton.textContent = `Running (${index}/${total})`;
                };
                const clearRunningState = () => {
                    if (!runButton) return;
                    runButton.disabled = false;
                    runButton.classList.remove('is-running');
                    try {
                        runButton.textContent = originalText || 'Run Selected';
                    } catch (_e) {
                        /* ignore */
                    }
                };

                const runNext = () => {
                    if (i >= total) {
                        clearRunningState();
                        resolve(true);
                        // Try to finalize report automatically if we have an id
                        try {
                            setTimeout(async () => {
                                try {
                                    const id = window.__lastAutomationReportId || null;
                                    if (id && typeof window.__automationFinalizeReport === 'function') {
                                        await window.__automationFinalizeReport(Number(id), null);
                                    }
                                } catch (_e) { /* ignore finalize errors */ }
                            }, 800);
                        } catch (_e) { }
                        return;
                    }
                    setRunningState(i + 1);
                    try {
                        window.__automationTestcaseControls.runRequest(runnableRequests[i]);
                        // Immediately close the single-request modal so batch runner's modal
                        // (if any) remains the primary UI. Small delay lets runRequest begin.
                        setTimeout(() => {
                            try {
                                if (window.__automationTestcaseControls && typeof window.__automationTestcaseControls.closeModal === 'function') {
                                    window.__automationTestcaseControls.closeModal();
                                }
                            } catch (_err) {
                                /* ignore */
                            }
                        }, 120);
                    } catch (err) {
                        console.error('[automation-run] Error running request', runnableRequests[i], err);
                    }
                    i += 1;
                    // allow UI to update between runs
                    setTimeout(runNext, sequentialRunDelay);
                };
                runNext();
            });
        }

        // As a last resort, try to initialize the multi-runner (may be loaded asynchronously)
        return ensureMultiRunner()
            .then((runner) => runner.runCaseBatch(cases, options || {}))
            .catch((error) => {
                console.error('[automation-run] Failed to start batch run', error);
                window.alert('Unable to start the batch run. Please try again after reloading the page.');
                return null;
            });
    };

    const handleSingleCaseRun = (button) => {
        if (!button) {
            return;
        }
        const caseId = button.getAttribute('data-case-id');
        if (!caseId) {
            window.alert('Test case information is missing. Please refresh and try again.');
            return;
        }
        if (window.__automationTestcaseControls && typeof window.__automationTestcaseControls.runCaseFromElement === 'function') {
            window.__automationTestcaseControls.runCaseFromElement(button);
            return;
        }
        ensureMultiRunner()
            .then((runner) => {
                if (typeof runner.runCaseFromElement === 'function') {
                    runner.runCaseFromElement(button);
                    return;
                }
                const caseRow = button.closest('tr');
                const descriptor = caseRow ? collectCaseDescriptorFromRow(caseRow) : null;
                if (descriptor) {
                    runner.runCaseBatch([descriptor], { title: `Run Case: ${descriptor.title || caseId}` });
                }
            })
            .catch((error) => {
                console.error('[automation-run] Unable to run single case', error);
                window.alert('Unable to start this test case. Please try again after reloading the page.');
            });
    };

    const collectCaseDescriptorFromRow = (row) => {
        if (!row) {
            return null;
        }
        const caseId = row.getAttribute('data-case-id');
        if (!caseId) {
            return null;
        }
        const titleCell = row.querySelector('td:nth-child(3)');
        const title = titleCell ? titleCell.textContent.trim() : `Case ${caseId}`;
        const actionsCell = row.querySelector('td:last-child .action-button[data-action="run-case"]');
        const dataset = actionsCell ? actionsCell.dataset : {};
        const requestId = dataset && dataset.requestId ? dataset.requestId : null;
        const dependencyId = dataset && dataset.dependencyId ? dataset.dependencyId : null;
        const dependencyKey = dataset && dataset.dependencyKey ? dataset.dependencyKey : '';
        const requiresDependency = dataset && dataset.requiresDependency === 'true';
        const responseEncrypted = dataset && dataset.responseEncrypted === 'true';
        const envId = dataset && dataset.envId ? dataset.envId : null;
        let expectedResults = [];
        if (row.dataset && row.dataset.expectedResults) {
            try {
                expectedResults = JSON.parse(row.dataset.expectedResults) || [];
            } catch (error) {
                expectedResults = [];
            }
        }
        return {
            caseId,
            rawCaseId: caseId,
            title,
            requestId,
            envId,
            scenarioId: row.getAttribute('data-scenario-id'),
            requiresDependency,
            dependencyCaseId: dependencyId,
            dependencyKey,
            expectedResults,
            responseEncrypted,
        };
    };

    // Background watcher: detect when a multi-run modal has completed and
    // ensure we finalize the AutomationReport for it. This helps in cases
    // where the primary finalize path wasn't invoked due to timing or other
    // race conditions. Initialize once.
    (function automationReportAutoFinalizer() {
        try {
            const finalized = new Set();
            setInterval(async () => {
                try {
                    const modal = document.getElementById('testcase-multi-response-modal');
                    if (!modal) return;
                    // determine report id from modal dataset or global
                    const rid = modal.dataset && modal.dataset.automationReportId ? modal.dataset.automationReportId : (window.__lastAutomationReportId || null);
                    if (!rid) return;
                    if (finalized.has(String(rid))) return;
                    const items = Array.from(modal.querySelectorAll('.multi-item'));
                    if (!items.length) return;
                    // consider finished when no items are running/queued
                    const anyRunning = items.some((it) => {
                        const s = (it.dataset && it.dataset.status) ? String(it.dataset.status).toLowerCase() : 'queued';
                        return s === 'running' || s === 'queued';
                    });
                    if (anyRunning) return;
                    // not running -> attempt finalize
                    try { console.log('[automation] auto-finalizer detected finished modal, finalizing report', rid); } catch (_e) { }
                    if (typeof window.__automationFinalizeReport === 'function') {
                        try {
                            await window.__automationFinalizeReport(Number(rid), null);
                            finalized.add(String(rid));
                            try { console.log('[automation] auto-finalizer finalized report', rid); } catch (_e) { }
                        } catch (_err) {
                            try { console.warn('[automation] auto-finalizer finalize failed', _err); } catch (_e) { }
                        }
                    }
                } catch (_e) {
                    /* ignore interval errors */
                }
            }, 500);
        } catch (_e) { /* ignore */ }
    })();

    const handleProjectPlay = (projectId) => {
        const project = getProjectById(projectId);
        if (!project) {
            return;
        }
        const cases = collectProjectCases(project);
        try {
            if (window.__automationMultiRunner && typeof window.__automationMultiRunner.runProjectBatch === 'function') {
                // build project -> modules -> scenarios -> cases payload
                const modules = getProjectModules(project).map((m) => ({ id: m.id, title: m.title || m.name || m.id, scenarios: getScenariosForModule(project, m.id).map((s) => ({ id: s.id, title: s.title || s.name || s.id, cases: collectScenarioCases(project, [s.id]) })) }));
                const projectObj = { id: projectId, title: project.name || projectId, modules };
                window.__automationMultiRunner.runProjectBatch([projectObj], { title: `Run Project: ${project.name || projectId}` });
                return;
            }
        } catch (e) { /* ignore and fallback */ }
        runCaseBatchWithModal(cases, { title: `Run Project: ${project.name || projectId}` });
    };

    const handleProjectRunAll = () => {
        const project = getProjectById(state.activeProjectId);
        if (!project || !state.selectedProjects || !state.selectedProjects.size) {
            return;
        }
        const ids = Array.from(state.selectedProjects);
        try {
            if (window.__automationMultiRunner && typeof window.__automationMultiRunner.runProjectBatch === 'function') {
                const projectObjs = ids.map((id) => {
                    const proj = getProjectById(id);
                    const title = proj ? proj.name || id : id;
                    const modules = proj ? getProjectModules(proj).map((m) => ({ id: m.id, title: m.title || m.name || m.id, scenarios: getScenariosForModule(proj, m.id).map((s) => ({ id: s.id, title: s.title || s.name || s.id, cases: collectScenarioCases(proj, [s.id]) })) })) : [];
                    return { id, title, modules };
                });
                window.__automationMultiRunner.runProjectBatch(projectObjs, { title: 'Run Selected Projects' });
                return;
            }
        } catch (e) { /* ignore and fallback */ }
        // fallback: collect all cases across selected projects
        const allCases = [];
        ids.forEach((id) => {
            const proj = getProjectById(id);
            if (proj) allCases.push(...collectProjectCases(proj));
        });
        runCaseBatchWithModal(allCases, { title: 'Run Selected Projects' });
    };

    const handleModulePlay = (moduleId) => {
        const project = getProjectById(state.activeProjectId);
        if (!project || !moduleId) {
            return;
        }
        const module = getProjectModules(project).find((item) => String(item.id) === String(moduleId));
        const label = module ? module.title || moduleId : moduleId;
        const cases = collectModuleCases(project, [moduleId]);
        try {
            if (window.__automationMultiRunner && typeof window.__automationMultiRunner.runModuleBatch === 'function') {
                // build hierarchical module -> scenarios -> cases payload
                const scenarios = getScenariosForModule(project, moduleId).map((s) => ({ id: s.id, title: s.title || s.name || s.id, cases: collectScenarioCases(project, [s.id]) }));
                const moduleObj = { id: moduleId, title: label, scenarios };
                window.__automationMultiRunner.runModuleBatch([moduleObj], { title: `Run Module: ${label}` });
                return;
            }
        } catch (e) { /* ignore and fallback */ }
        runCaseBatchWithModal(cases, { title: `Run Module: ${label}` });
    };

    const handleScenarioPlay = (scenarioId) => {
        const project = getProjectById(state.activeProjectId);
        if (!project || !scenarioId) {
            return;
        }
        const scenario = getScenarioById(project, scenarioId);
        const label = scenario ? scenario.title || scenarioId : scenarioId;
        const cases = collectScenarioCases(project, [scenarioId]);
        try {
            if (window.__automationMultiRunner && typeof window.__automationMultiRunner.runScenarioBatch === 'function') {
                const scenarioObj = { id: scenarioId, title: label, cases };
                window.__automationMultiRunner.runScenarioBatch([scenarioObj], { title: `Run Scenario: ${label}` });
                return;
            }
        } catch (e) { /* ignore and fallback */ }
        runCaseBatchWithModal(cases, { title: `Run Scenario: ${label}` });
    };

    const handleModuleRunAll = () => {
        const project = getProjectById(state.activeProjectId);
        if (!project || !state.selectedModules.size) {
            return;
        }
        const ids = Array.from(state.selectedModules);
        try {
            if (window.__automationMultiRunner && typeof window.__automationMultiRunner.runModuleBatch === 'function') {
                const moduleObjs = ids.map((id) => {
                    const mod = getProjectModules(project).find((m) => String(m.id) === String(id));
                    const title = mod ? mod.title || id : id;
                    const scenarios = getScenariosForModule(project, id).map((s) => ({ id: s.id, title: s.title || s.name || s.id, cases: collectScenarioCases(project, [s.id]) }));
                    return { id, title, scenarios };
                });
                window.__automationMultiRunner.runModuleBatch(moduleObjs, { title: 'Run Selected Modules' });
                return;
            }
        } catch (e) { /* ignore and fallback */ }
        const cases = collectModuleCases(project, ids);
        runCaseBatchWithModal(cases, { title: 'Run Selected Modules' });
    };

    const handleScenarioRunAll = () => {
        const project = getProjectById(state.activeProjectId);
        if (!project || !state.selectedScenarios.size) {
            return;
        }
        const ids = Array.from(state.selectedScenarios);
        try {
            if (window.__automationMultiRunner && typeof window.__automationMultiRunner.runScenarioBatch === 'function') {
                const scenarioObjs = ids.map((id) => {
                    const scenario = getScenarioById(project, id);
                    const title = scenario ? scenario.title || id : id;
                    const cases = collectScenarioCases(project, [id]);
                    return { id, title, cases };
                });
                window.__automationMultiRunner.runScenarioBatch(scenarioObjs, { title: 'Run Selected Scenarios' });
                return;
            }
        } catch (e) { /* ignore and fallback */ }
        const cases = collectScenarioCases(project, ids);
        runCaseBatchWithModal(cases, { title: 'Run Selected Scenarios' });
    };

    const setActiveProject = (projectId) => {
        if (state.activeProjectId === projectId) {
            return;
        }
        state.activeProjectId = projectId;
        state.activeModuleId = null;
        state.activeScenarioId = null;
        state.selectedModules.clear();
        state.selectedScenarios.clear();
        const project = getProjectById(projectId);
        if (project) {
            const modules = getProjectModules(project);
            state.activeModuleId = modules.length ? stringId(modules[0].id) : null;
            const scenarios = getProjectScenarios(project);
            let scenario = null;
            if (state.activeModuleId) {
                scenario = scenarios.find((item) => String(item.module_id || item.module) === state.activeModuleId) || null;
            }
            if (!scenario && scenarios.length) {
                scenario = scenarios[0];
            }
            state.activeScenarioId = scenario ? stringId(scenario.id) : null;
        }
        renderAll();
    };

    const setActiveModule = (moduleId) => {
        if (state.activeModuleId === moduleId) {
            return;
        }
        state.activeModuleId = moduleId;
        state.selectedScenarios.clear();
        const project = getProjectById(state.activeProjectId);
        const scenarios = project ? getProjectScenarios(project) : [];
        let scenario = null;
        if (project && moduleId) {
            scenario = scenarios.find((item) => String(item.module_id || item.module) === String(moduleId)) || null;
        }
        if (!scenario && scenarios.length) {
            scenario = scenarios[0];
        }
        state.activeScenarioId = scenario ? stringId(scenario.id) : null;
        renderModules();
        renderScenarios();
        renderCases();
    };

    const setActiveScenario = (scenarioId) => {
        if (state.activeScenarioId === scenarioId) {
            return;
        }
        state.activeScenarioId = scenarioId;
        renderScenarios();
        renderCases();
    };

    root.addEventListener('click', (event) => {
        const target = event.target;
        if (!target) {
            return;
        }

        const runCaseButton = target.closest('[data-action="run-case"]');
        if (runCaseButton) {
            event.preventDefault();
            event.stopPropagation();
            handleSingleCaseRun(runCaseButton);
            return;
        }

        const projectCard = target.closest('.automation-item[data-project-id]');
        if (projectCard && !target.closest('[data-action="project-play"]')) {
            event.preventDefault();
            setActiveProject(projectCard.getAttribute('data-project-id'));
            return;
        }

        const projectSelect = target.closest('[data-action="project-select"]');
        if (projectSelect) {
            event.preventDefault();
            setActiveProject(projectSelect.getAttribute('data-project-id'));
            return;
        }

        const projectPlay = target.closest('[data-action="project-play"]');
        if (projectPlay) {
            event.preventDefault();
            handleProjectPlay(projectPlay.getAttribute('data-project-id'));
            return;
        }

        const moduleCard = target.closest('.automation-item[data-module-id]');
        if (moduleCard && !target.closest('[data-action="module-play"]') && !target.closest('.automation-run__checkbox-group')) {
            event.preventDefault();
            setActiveModule(moduleCard.getAttribute('data-module-id'));
            return;
        }

        const moduleSelect = target.closest('[data-action="module-select"]');
        if (moduleSelect) {
            event.preventDefault();
            setActiveModule(moduleSelect.getAttribute('data-module-id'));
            return;
        }

        const modulePlay = target.closest('[data-action="module-play"]');
        if (modulePlay) {
            event.preventDefault();
            handleModulePlay(modulePlay.getAttribute('data-module-id'));
            return;
        }

        const scenarioCard = target.closest('.automation-item[data-scenario-id]');
        if (scenarioCard && !target.closest('[data-action="scenario-play"]') && !target.closest('.automation-run__checkbox-group')) {
            event.preventDefault();
            setActiveScenario(scenarioCard.getAttribute('data-scenario-id'));
            return;
        }

        const scenarioSelect = target.closest('[data-action="scenario-select"]');
        if (scenarioSelect) {
            event.preventDefault();
            setActiveScenario(scenarioSelect.getAttribute('data-scenario-id'));
            return;
        }

        const scenarioPlay = target.closest('[data-action="scenario-play"]');
        if (scenarioPlay) {
            event.preventDefault();
            handleScenarioPlay(scenarioPlay.getAttribute('data-scenario-id'));
            return;
        }

        const moduleRunAll = target.closest('[data-action="module-run-all"]');
        if (moduleRunAll) {
            event.preventDefault();
            handleModuleRunAll();
            return;
        }

        const scenarioRunAll = target.closest('[data-action="scenario-run-all"]');
        if (scenarioRunAll) {
            event.preventDefault();
            handleScenarioRunAll();
            return;
        }
    });

    root.addEventListener('change', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
            return;
        }
        if (target.matches('[data-action="module-checkbox"]')) {
            const moduleId = target.getAttribute('data-module-id');
            if (target.checked) {
                if (moduleId) {
                    state.selectedModules.add(moduleId);
                }
            } else if (moduleId) {
                state.selectedModules.delete(moduleId);
            }
            syncModuleBulkAction();
            return;
        }
        if (target.matches('[data-action="scenario-checkbox"]')) {
            const scenarioId = target.getAttribute('data-scenario-id');
            if (target.checked) {
                if (scenarioId) {
                    state.selectedScenarios.add(scenarioId);
                }
            } else if (scenarioId) {
                state.selectedScenarios.delete(scenarioId);
            }
            syncScenarioBulkAction();
            return;
        }

        // Case table: header select-all
        if (target.matches('#select-all-cases')) {
            // If another script initialized case-checkbox handling on this page
            // (marked by data-case-checkbox-init), delegate to that script and
            // avoid duplicating the header toggle logic which causes race
            // conditions when both handlers run.
            try {
                if (target.dataset && target.dataset.caseCheckboxInit === '1') {
                    console.debug('[automation-run] header init detected elsewhere; skipping header handler');
                    return;
                }
            } catch (e) { /* ignore */ }
            // header toggle: intentionally silent to avoid console noise
            try {
                const table = elements.caseTableContainer ? elements.caseTableContainer.querySelector('table') : null;
                const checkboxes = table ? table.querySelectorAll('input.case-checkbox') : document.querySelectorAll('input.case-checkbox');

                // Debug probes: attach a short-lived capturing change listener and a
                // MutationObserver while we toggle rows so we can see if another
                // script reacts during our loop and mutates the DOM or checkbox state.
                const probeEvents = [];
                const changeProbe = function (ev) {
                    try {
                        probeEvents.push({ when: Date.now(), target: ev.target, checked: ev.target && ev.target.checked, type: 'change' });
                        console.warn('[automation-run][probe] change event during header loop', { target: ev.target, checked: ev.target && ev.target.checked });
                        console.trace();
                    } catch (err) { /* ignore */ }
                };

                let mo = null;
                try {
                    if (elements.caseTableContainer) {
                        mo = new MutationObserver(function () { /* intentionally silent during bulk toggle */ });
                        mo.observe(elements.caseTableContainer, { childList: true, subtree: true, attributes: true });
                    }
                } catch (err) { /* ignore */ }

                document.addEventListener('change', changeProbe, true);

                checkboxes.forEach((cb) => {
                    if (!(cb instanceof HTMLInputElement)) return;
                    cb.checked = target.checked;
                    // Avoid dispatching native change events here: other global listeners
                    // react to those and can revert state during our loop. Instead, update
                    // application state once after the loop completes.
                });

                // After we've updated DOM properties for all rows, run the debounced
                // state updater so the rest of the UI (header indeterminate, run
                // button visibility) refreshes. This avoids per-row change handlers
                // re-entering while we're mid-loop.
                try { debouncedUpdateSelectAllState(); } catch (e) { setTimeout(updateSelectAllState, 0); }

                // cleanup probes
                try { document.removeEventListener('change', changeProbe, true); } catch (e) { }
                try { if (mo) mo.disconnect(); } catch (e) { }
            } catch (e) {
                console.error('[automation-run] root handler error toggling rows', e);
            }
            return;
        }

        // Individual case checkboxes
        if (target.matches('input.case-checkbox')) {
            try {
                // Update header checkbox state
                const table = elements.caseTableContainer ? elements.caseTableContainer.querySelector('table') : null;
                if (!table) return;
                const all = Array.from(table.querySelectorAll('input.case-checkbox'));
                const checked = all.filter((n) => n.checked);
                const header = table.querySelector('#select-all-cases');
                if (header instanceof HTMLInputElement) {
                    header.checked = checked.length === all.length && all.length > 0;
                    header.indeterminate = checked.length > 0 && checked.length < all.length;
                }
                // Show or hide run selected
                if (checked.length > 0) {
                    showRunCasesButton();
                } else {
                    hideRunCasesButton();
                }
            } catch (e) {
                /* ignore */
            }
            return;
        }
    });

    // Wire Run Selected button
    if (elements.runCasesButton) {
        elements.runCasesButton.addEventListener('click', (ev) => {
            ev.preventDefault();
            try {
                // Prevent duplicate rapid clicks from invoking multiple runs
                const ds = elements.runCasesButton.dataset || {};
                if (ds.batchRunning === '1') return;
                if (ds) ds.batchRunning = '1';
            } catch (_e) { /* ignore dataset issues */ }

            const table = elements.caseTableContainer ? elements.caseTableContainer.querySelector('table') : null;
            if (!table) {
                try { if (elements.runCasesButton && elements.runCasesButton.dataset) delete elements.runCasesButton.dataset.batchRunning; } catch (_e) { }
                return;
            }
            const checked = Array.from(table.querySelectorAll('input.case-checkbox:checked'));
            if (!checked.length) {
                try { if (elements.runCasesButton && elements.runCasesButton.dataset) delete elements.runCasesButton.dataset.batchRunning; } catch (_e) { }
                window.alert('No test cases selected.');
                return;
            }
            const cases = [];
            checked.forEach((cb) => {
                try {
                    const row = cb.closest('tr');
                    const descriptor = collectCaseDescriptorFromRow(row);
                    if (descriptor) cases.push(descriptor);
                } catch (e) {
                    /* ignore individual errors */
                }
            });
            if (!cases.length) {
                try { if (elements.runCasesButton && elements.runCasesButton.dataset) delete elements.runCasesButton.dataset.batchRunning; } catch (_e) { }
                window.alert('No runnable test cases were found for this selection.');
                return;
            }

            // runCaseBatchWithModal may return a promise — clear guard when settled
            try {
                const p = runCaseBatchWithModal(cases, { title: 'Run Selected Cases' });
                if (p && typeof p.finally === 'function') {
                    p.finally(() => {
                        try { if (elements.runCasesButton && elements.runCasesButton.dataset) delete elements.runCasesButton.dataset.batchRunning; } catch (_e) { }
                    });
                } else {
                    // fallback clear after delay
                    setTimeout(() => { try { if (elements.runCasesButton && elements.runCasesButton.dataset) delete elements.runCasesButton.dataset.batchRunning; } catch (_e) { } }, 2000);
                }
            } catch (err) {
                try { if (elements.runCasesButton && elements.runCasesButton.dataset) delete elements.runCasesButton.dataset.batchRunning; } catch (_e) { }
            }
        });
    }

    initializeSelection();
    renderAll();
    // Expose control to adjust sequential run delay at runtime
    try {
        if (typeof window !== 'undefined') {
            window.__automationRunControls = window.__automationRunControls || {};
            window.__automationRunControls.setSequentialRunDelay = function (ms) {
                const n = Number(ms) || 0;
                if (n > 0) sequentialRunDelay = n;
            };
        }
    } catch (_e) {
        /* ignore exposure errors */
    }
})();
