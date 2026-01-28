(function () {
    const root = document.getElementById('automation-app');
    if (!root) {
        return;
    }

    const parseJsonScript = (id) => {
        const node = document.getElementById(id);
        if (!node) {
            return null;
        }
        try {
            return JSON.parse(node.textContent);
        } catch (error) {
            console.error('[automation][projects] Failed to parse JSON from', id, error);
            return null;
        }
    };

    const getCsrfToken = () => {
        const name = 'csrftoken=';
        const cookies = document.cookie ? document.cookie.split(';') : [];
        for (let i = 0; i < cookies.length; i += 1) {
            const cookie = cookies[i].trim();
            if (cookie.startsWith(name)) {
                return decodeURIComponent(cookie.substring(name.length));
            }
        }
        const meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.getAttribute('content') || '' : '';
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

    const renderEmptyRow = () => (
        '<tr>' +
        '<td colspan="4" class="empty">No projects yet. Create one to kick off your automation cycle.</td>' +
        '</tr>'
    );

    const projectsBody = root.querySelector('[data-role="project-list"]');
    const projectsTable = root.querySelector('#projects-table');
    const projectsPagination = root.querySelector('#projects-pagination');
    const modal = root.querySelector('[data-role="project-modal"]');
    const form = modal ? modal.querySelector('#project-form') : null;
    const formAlert = modal ? modal.querySelector('[data-role="form-errors"]') : null;
    const nameInput = modal ? modal.querySelector('#project-name') : null;
    const descriptionInput = modal ? modal.querySelector('#project-description') : null;
    const submitButton = modal ? modal.querySelector('[data-role="project-submit"]') : null;
    const titleNode = modal ? modal.querySelector('#automation-project-modal-title') : null;

    if (!projectsBody || !modal || !form || !nameInput || !descriptionInput || !submitButton || !titleNode) {
        console.error('[automation][projects] Missing required DOM nodes.');
        return;
    }

    const hasPermissionMarker = (id) => !!root.querySelector(`#${id}`);
    const boolFromDataset = (value) => (String(value || '') === '1');

    // Prefer dataset if present (backwards compatible), otherwise infer via template-controlled markers.
    const canViewProject = root.dataset && Object.prototype.hasOwnProperty.call(root.dataset, 'canViewProject')
        ? boolFromDataset(root.dataset.canViewProject)
        : hasPermissionMarker('perm-can-view-project');
    const canChangeProject = root.dataset && Object.prototype.hasOwnProperty.call(root.dataset, 'canChangeProject')
        ? boolFromDataset(root.dataset.canChangeProject)
        : hasPermissionMarker('perm-can-change-project');
    const canCreateProject = root.dataset && Object.prototype.hasOwnProperty.call(root.dataset, 'canCreateProject')
        ? boolFromDataset(root.dataset.canCreateProject)
        : hasPermissionMarker('perm-can-create-project');

    // Match server-side `{% if %}` intent: don't automatically treat change as view.
    const canViewProjectEffective = canViewProject;

    let projects = parseJsonScript('automation-initial-projects');
    if (!Array.isArray(projects)) {
        projects = [];
    }
    const apiEndpoints = parseJsonScript('automation-api-endpoints') || {};
    const plansEndpoint = apiEndpoints.plans;

    const state = {
        mode: 'create',
        projectId: null,
    };

    const formatCount = (value) => {
        if (typeof value === 'number') {
            return String(value);
        }
        if (Array.isArray(value)) {
            return String(value.length);
        }
        if (value === null || value === undefined) {
            return '0';
        }
        if (typeof value === 'object' && typeof value.length === 'number') {
            return String(value.length);
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? String(parsed) : '0';
    };

    const resolveCounts = (project) => {
        const hasModulesCount = Object.prototype.hasOwnProperty.call(project, 'modules_count');
        const hasScenariosCount = Object.prototype.hasOwnProperty.call(project, 'scenarios_count');
        const modulesSource = hasModulesCount && project.modules_count !== null ? project.modules_count : project.test_modules;
        const scenariosSource = hasScenariosCount && project.scenarios_count !== null ? project.scenarios_count : project.scenarios;
        return {
            modules: formatCount(modulesSource),
            scenarios: formatCount(scenariosSource),
        };
    };

    const paginationState = {
        page: 1,
        pageSize: 10,
        rows: [],
        controls: null,
    };

    const createPaginationControls = (container, onPrev, onNext, defaultPageSize) => {
        if (!container) {
            return null;
        }
        container.innerHTML = '';
        const prev = document.createElement('button');
        prev.type = 'button';
        prev.className = 'btn btn-sm';
        prev.textContent = 'Prev';
        const info = document.createElement('span');
        info.className = 'pagination-info';
        info.style.margin = '0 0.6rem';
        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'btn btn-sm';
        next.textContent = 'Next';
        prev.addEventListener('click', onPrev);
        next.addEventListener('click', onNext);

        const select = document.createElement('select');
        select.className = 'pagination-pagesize';
        [10, 20, 30, 40, 50, 100].forEach((n) => {
            const opt = document.createElement('option');
            opt.value = n;
            opt.text = String(n);
            select.appendChild(opt);
        });
        if (defaultPageSize) {
            select.value = String(defaultPageSize);
        }
        select.style.marginLeft = '0.6rem';
        select.style.padding = '0.25rem 0.5rem';
        select.title = 'Rows per page';

        container.appendChild(prev);
        container.appendChild(info);
        container.appendChild(next);
        container.appendChild(select);
        return {
            prev,
            info,
            next,
            pagesize: select,
        };
    };

    const getProjectRows = () => {
        if (!projectsTable) {
            return [];
        }
        const tbody = projectsTable.querySelector('tbody');
        if (!tbody) {
            return [];
        }
        return Array.from(tbody.querySelectorAll('tr')).filter((row) => !row.querySelector('.empty'));
    };

    const renderPagination = () => {
        if (!projectsPagination || !projectsTable) {
            return;
        }
        if (!paginationState.controls) {
            paginationState.controls = createPaginationControls(
                projectsPagination,
                () => {
                    if (paginationState.page > 1) {
                        paginationState.page -= 1;
                        renderPagination();
                    }
                },
                () => {
                    const totalPages = Math.max(1, Math.ceil(paginationState.rows.length / paginationState.pageSize));
                    if (paginationState.page < totalPages) {
                        paginationState.page += 1;
                        renderPagination();
                    }
                },
                paginationState.pageSize,
            ) || { prev: { disabled: true }, next: { disabled: true }, info: { textContent: '' }, pagesize: null };

            if (paginationState.controls.pagesize) {
                paginationState.controls.pagesize.addEventListener('change', function () {
                    const v = parseInt(this.value, 10) || 10;
                    paginationState.pageSize = v;
                    paginationState.page = 1;
                    renderPagination();
                });
            }
        }

        const totalPages = Math.max(1, Math.ceil(paginationState.rows.length / paginationState.pageSize));
        if (paginationState.page > totalPages) {
            paginationState.page = 1;
        }
        const start = (paginationState.page - 1) * paginationState.pageSize;
        const end = start + paginationState.pageSize;
        paginationState.rows.forEach((row, index) => {
            row.style.display = (index >= start && index < end) ? '' : 'none';
        });
        paginationState.controls.info.textContent = `${paginationState.page} / ${totalPages}`;
        paginationState.controls.prev.disabled = paginationState.page <= 1;
        paginationState.controls.next.disabled = paginationState.page >= totalPages;
    };

    const refreshPagination = () => {
        paginationState.rows = getProjectRows();
        renderPagination();
    };

    const renderProjects = () => {
        if (!projectsBody) {
            return;
        }
        if (!projects.length) {
            projectsBody.innerHTML = renderEmptyRow();
            refreshPagination();
            return;
        }
        const rows = projects.map((project) => {
            const counts = resolveCounts(project);
            const description = project.description ? `<div class="table-secondary">${escapeHtml(project.description)}</div>` : '';
            const actions = [
                canViewProjectEffective
                    ? `<button type="button" class="action-button" data-action="view-project" data-project-id="${escapeHtml(project.id)}">View</button>`
                    : '',
                canChangeProject
                    ? `<button type="button" class="action-button" data-action="edit-project" data-project-id="${escapeHtml(project.id)}">Edit</button>`
                    : '',
            ].filter(Boolean).join('');
            return (
                `<tr data-project-id="${escapeHtml(project.id)}">` +
                `<td data-label="Name"><strong>${escapeHtml(project.name || 'Untitled project')}</strong>${description}</td>` +
                `<td data-label="Modules">${escapeHtml(counts.modules)}</td>` +
                `<td data-label="Scenarios">${escapeHtml(counts.scenarios)}</td>` +
                '<td data-label="Actions">' +
                '<div class="table-action-group">' +
                actions +
                '</div>' +
                '</td>' +
                '</tr>'
            );
        });
        projectsBody.innerHTML = rows.join('');
        refreshPagination();
    };

    const toggleModal = (visible) => {
        if (!modal) {
            return;
        }
        if (visible) {
            modal.removeAttribute('hidden');
            document.body.classList.add('automation-modal-open');
        } else {
            modal.setAttribute('hidden', 'hidden');
            document.body.classList.remove('automation-modal-open');
        }
    };

    const setFormReadOnly = (readOnly) => {
        [nameInput, descriptionInput].forEach((input) => {
            if (!input) {
                return;
            }
            input.readOnly = readOnly;
            input.disabled = readOnly;
        });
        if (readOnly) {
            submitButton.setAttribute('hidden', 'hidden');
        } else {
            submitButton.removeAttribute('hidden');
        }
    };

    const resetFormAlert = () => {
        if (!formAlert) {
            return;
        }
        formAlert.setAttribute('hidden', 'hidden');
        formAlert.textContent = '';
    };

    const showFormErrors = (messages) => {
        if (!formAlert) {
            return;
        }
        const list = Array.isArray(messages) ? messages : [messages];
        formAlert.textContent = list.filter(Boolean).join(' ');
        formAlert.removeAttribute('hidden');
    };

    const openModal = (mode, project) => {
        // Enforce permissions at the modal level as well (template alone can't vary per-mode).
        if (mode === 'create' && !canCreateProject) {
            showToast('You do not have permission to create projects.', 'error');
            return;
        }
        if (mode === 'edit' && !canChangeProject) {
            mode = 'view';
        }

        state.mode = mode;
        state.projectId = project && project.id ? project.id : null;
        resetFormAlert();
        if (mode === 'create') {
            titleNode.textContent = 'Create Project';
            submitButton.textContent = 'Save';
            setFormReadOnly(false);
            form.reset();
        } else if (mode === 'edit') {
            titleNode.textContent = 'Edit Project';
            submitButton.textContent = 'Save';
            setFormReadOnly(false);
            nameInput.value = project && project.name ? project.name : '';
            descriptionInput.value = project && project.description ? project.description : '';
        } else {
            titleNode.textContent = 'View Project';
            setFormReadOnly(true);
            form.reset();
            nameInput.value = project && project.name ? project.name : '';
            descriptionInput.value = project && project.description ? project.description : '';
        }

        // Ensure the submit button is only visible when the user can actually submit.
        const canSubmit = (mode === 'create' && canCreateProject) || (mode === 'edit' && canChangeProject);
        if (!canSubmit) {
            submitButton.setAttribute('hidden', 'hidden');
        } else {
            submitButton.removeAttribute('hidden');
        }
        toggleModal(true);
    };

    const closeModal = () => {
        toggleModal(false);
        window.setTimeout(() => {
            setFormReadOnly(false);
            state.mode = 'create';
            state.projectId = null;
            form.reset();
            resetFormAlert();
        }, 150);
    };

    const findProject = (id) => {
        if (!id) {
            return null;
        }
        return projects.find((project) => String(project.id) === String(id)) || null;
    };

    const refreshProject = (project) => {
        if (!project || !project.id) {
            return;
        }
        const index = projects.findIndex((item) => String(item.id) === String(project.id));
        if (index === -1) {
            projects.push(project);
        } else {
            projects[index] = project;
        }
        projects.sort((a, b) => {
            const nameA = (a.name || '').toLowerCase();
            const nameB = (b.name || '').toLowerCase();
            if (nameA < nameB) {
                return -1;
            }
            if (nameA > nameB) {
                return 1;
            }
            return String(a.id).localeCompare(String(b.id));
        });
        renderProjects();
    };

    const handleFormSubmit = (event) => {
        event.preventDefault();
        resetFormAlert();
        if (!plansEndpoint) {
            showFormErrors('Project endpoint unavailable.');
            return;
        }
        const payload = {
            name: nameInput.value.trim(),
            description: descriptionInput.value.trim(),
        };
        if (!payload.name) {
            showFormErrors('Name is required.');
            return;
        }
        const submissionMode = state.mode === 'edit' ? 'edit' : 'create';
        const projectLabel = payload.name || 'this project';
        const confirmMessage = submissionMode === 'edit'
            ? `Are you sure you want to update the project "${projectLabel}"?`
            : `Are you sure you want to create the project "${projectLabel}"?`;
        const confirmResult = typeof window.confirm === 'function' ? window.confirm(confirmMessage) : true;
        if (!confirmResult) {
            return;
        }
        const csrfToken = getCsrfToken();
        const headers = {
            'Content-Type': 'application/json',
        };
        if (csrfToken) {
            headers['X-CSRFToken'] = csrfToken;
        }
        let url = plansEndpoint;
        const options = {
            method: 'POST',
            headers,
            credentials: 'same-origin',
            body: JSON.stringify(payload),
        };
        if (state.mode === 'edit' && state.projectId) {
            url = `${plansEndpoint}${state.projectId}/`;
            options.method = 'PATCH';
        }
        submitButton.disabled = true;
        fetch(url, options)
            .then((response) => {
                if (!response.ok) {
                    return response
                        .json()
                        .catch(() => ({}))
                        .then((data) => {
                            const rawErrors = data && data.detail ? [data.detail] : Object.values(data || {});
                            if (!Array.isArray(rawErrors)) {
                                throw rawErrors;
                            }
                            const flattened = [];
                            rawErrors.forEach((item) => {
                                if (Array.isArray(item)) {
                                    item.forEach((subItem) => flattened.push(subItem));
                                } else if (item) {
                                    flattened.push(item);
                                }
                            });
                            throw flattened.length ? flattened : rawErrors;
                        });
                }
                if (response.status === 204) {
                    const previous = findProject(state.projectId);
                    return Object.assign({}, previous || { id: state.projectId }, payload);
                }
                return response.json();
            })
            .then((data) => {
                refreshProject(data);
                const displayName = data && data.name ? data.name : projectLabel;
                const successMessage = submissionMode === 'edit'
                    ? `Project "${displayName}" updated successfully.`
                    : `Project "${displayName}" created successfully.`;
                showToast(successMessage, 'success');
                closeModal();
            })
            .catch((error) => {
                console.error('[automation][projects] Failed to submit project', error);
                if (Array.isArray(error)) {
                    showFormErrors(error);
                } else if (error && typeof error === 'object') {
                    showFormErrors(Object.values(error));
                } else {
                    showFormErrors('Unable to save project. Please try again.');
                }
            })
            .finally(() => {
                submitButton.disabled = false;
            });
    };

    const handleActionClick = (event) => {
        const trigger = event.target.closest('[data-action]');
        if (!trigger) {
            return;
        }
        const action = trigger.getAttribute('data-action');
        if (action === 'open-project-modal') {
            openModal('create');
            return;
        }
        if (action === 'close-project-modal') {
            closeModal();
            return;
        }
        if (action === 'view-project' || action === 'edit-project') {
            if (action === 'view-project' && !canViewProjectEffective) {
                return;
            }
            if (action === 'edit-project' && !canChangeProject) {
                return;
            }
            const projectId = trigger.getAttribute('data-project-id');
            const project = findProject(projectId);
            if (!project) {
                console.warn('[automation][projects] Project not found for action', action, projectId);
                return;
            }
            openModal(action === 'edit-project' ? 'edit' : 'view', project);
        }
    };

    const handleBackdropClick = (event) => {
        if (event.target === modal) {
            closeModal();
        }
    };

    const handleKeydown = (event) => {
        if (event.key === 'Escape' && !modal.hasAttribute('hidden')) {
            closeModal();
        }
    };

    root.addEventListener('click', handleActionClick);
    modal.addEventListener('click', handleBackdropClick);
    form.addEventListener('submit', handleFormSubmit);
    document.addEventListener('keydown', handleKeydown);

    renderProjects();
})();
