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
            return (
                `<div class="automation-item${isActive ? ' is-active' : ''}" data-scenario-id="${escapeHtml(scenarioId || '')}">` +
                '<div class="automation-run__item-header">' +
                `<label class="automation-run__checkbox-group" for="automation-scenario-${escapeHtml(scenarioId || '')}">` +
                `<input type="checkbox" id="automation-scenario-${escapeHtml(scenarioId || '')}" data-action="scenario-checkbox" data-scenario-id="${escapeHtml(scenarioId || '')}" aria-label="Select scenario ${escapeHtml(scenario.title || 'Untitled scenario')}" ${isChecked ? 'checked' : ''}>` +
                '</label>' +
                `<button type="button" class="automation-run__item-select" data-action="scenario-select" data-scenario-id="${escapeHtml(scenarioId || '')}">` +
                `<strong>${escapeHtml(scenario.title || 'Untitled scenario')}</strong>` +
                '</button>' +
                `<button type="button" class="action-button" data-action="scenario-play" data-scenario-id="${escapeHtml(scenarioId || '')}">Run</button>` +
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

    const handleProjectPlay = (projectId) => {
        const project = getProjectById(projectId);
        if (!project) {
            return;
        }
        const cases = collectProjectCases(project);
        runCaseBatchWithModal(cases, { title: `Run Project: ${project.name || projectId}` });
    };

    const handleModulePlay = (moduleId) => {
        const project = getProjectById(state.activeProjectId);
        if (!project || !moduleId) {
            return;
        }
        const module = getProjectModules(project).find((item) => String(item.id) === String(moduleId));
        const label = module ? module.title || moduleId : moduleId;
        const cases = collectModuleCases(project, [moduleId]);
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
        runCaseBatchWithModal(cases, { title: `Run Scenario: ${label}` });
    };

    const handleModuleRunAll = () => {
        const project = getProjectById(state.activeProjectId);
        if (!project || !state.selectedModules.size) {
            return;
        }
        const ids = Array.from(state.selectedModules);
        const cases = collectModuleCases(project, ids);
        runCaseBatchWithModal(cases, { title: 'Run Selected Modules' });
    };

    const handleScenarioRunAll = () => {
        const project = getProjectById(state.activeProjectId);
        if (!project || !state.selectedScenarios.size) {
            return;
        }
        const ids = Array.from(state.selectedScenarios);
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
        }
    });

    initializeSelection();
    renderAll();
})();
