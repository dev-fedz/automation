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

    const formatStructuredValue = (value) => {
        if (!value) {
            return '';
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

    document.addEventListener('DOMContentLoaded', () => {
        const root = document.getElementById('automation-app');
        if (!root) {
            return;
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
            caseList: root.querySelector('[data-role="case-list"]'),
            maintenanceList: root.querySelector('[data-role="maintenance-list"]'),
            planName: root.querySelector('[data-role="selected-plan-name"]'),
            scenarioName: root.querySelector('[data-role="selected-scenario-name"]'),
            caseSummary: root.querySelector('[data-role="case-summary"]'),
            planForm: document.getElementById('automation-plan-form'),
            scenarioForm: document.getElementById('automation-scenario-form'),
            caseForm: document.getElementById('automation-case-form'),
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

        const inputs = {
            plan: {
                name: document.getElementById('plan-name'),
                objective: document.getElementById('plan-objective-editor'),
                description: document.getElementById('plan-description'),
                scopeIn: document.getElementById('plan-scope-in'),
                scopeOut: document.getElementById('plan-scope-out'),
                modules: document.getElementById('plan-modules'),
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
                dynamic: document.getElementById('case-dynamic'),
                priority: document.getElementById('case-priority'),
                owner: document.getElementById('case-owner'),
                request: document.getElementById('case-request'),
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
            if (Array.isArray(next.risk_mitigations)) {
                next.risk_mitigations = next.risk_mitigations.map((value) => {
                    const parsed = Number(value);
                    return Number.isNaN(parsed) ? value : parsed;
                });
            } else if (!next.risk_mitigations) {
                next.risk_mitigations = [];
            }
            if (Array.isArray(next.risk_mitigation_details)) {
                next.risk_mitigation_details = next.risk_mitigation_details.map((entry) => ({ ...entry }));
            } else if (!next.risk_mitigation_details) {
                next.risk_mitigation_details = [];
            }
            if (Array.isArray(next.modules_under_test)) {
                next.modules_under_test = [...next.modules_under_test];
            }
            if (Array.isArray(next.testers)) {
                next.testers = [...next.testers];
            }
            return next;
        };

        const normalizePlans = (plans) => (Array.isArray(plans) ? plans.map(normalizePlan) : []);

        const state = {
            plans: normalizePlans(initialPlans),
            selectedPlanId: null,
            selectedScenarioId: null,
            editingPlan: false,
        };

        const getSelectedPlan = () => state.plans.find((plan) => plan.id === state.selectedPlanId) || null;

        const getSelectedScenario = () => {
            const plan = getSelectedPlan();
            if (!plan || !Array.isArray(plan.scenarios)) {
                return null;
            }
            return plan.scenarios.find((scenario) => scenario.id === state.selectedScenarioId) || null;
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

        const openPlanEdit = (plan) => {
            if (!plan) return;
            state.editingPlan = true;
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

        const renderPlanRiskMatrix = async (plan) => {
            if (!els.planRiskMatrix) return;
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
            const linked = Array.isArray(plan.risk_mitigations) ? plan.risk_mitigations : [];
            const rows = risks.map((risk) => {
                const checked = linked.includes(risk.id) ? 'checked' : '';
                return `<label class="plan-risk-row"><input type="checkbox" data-role="plan-risk-checkbox" value="${risk.id}" ${checked}> ${escapeHtml(risk.title || '')}</label>`;
            }).join('');
            els.planRiskMatrix.innerHTML = `<div class="plan-risk-list">${rows}</div>`;
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
            if (!els.scenarioList) {
                return;
            }
            const plan = getSelectedPlan();
            if (els.planName) {
                els.planName.textContent = plan ? plan.name : '—';
            }
            els.scenarioList.innerHTML = '';
            if (!plan) {
                els.scenarioList.innerHTML = '<p class="empty">Select a plan to view scenarios.</p>';
                return;
            }
            const scenarios = Array.isArray(plan.scenarios) ? plan.scenarios : [];
            if (!scenarios.length) {
                els.scenarioList.innerHTML = '<p class="empty">No scenarios created yet for this plan.</p>';
                return;
            }
            const list = document.createElement('ul');
            list.className = 'automation-items';
            scenarios.forEach((scenario) => {
                const li = document.createElement('li');
                li.className = 'automation-item';
                if (scenario.id === state.selectedScenarioId) {
                    li.classList.add('is-active');
                }
                const caseCount = Array.isArray(scenario.cases) ? scenario.cases.length : 0;
                const tags = Array.isArray(scenario.tags) ? scenario.tags : [];
                li.innerHTML = `
                    <strong>${escapeHtml(scenario.title || 'Scenario')}</strong>
                    <span>${caseCount} test case${caseCount === 1 ? '' : 's'}</span>
                    ${tags.length ? `<div class="automation-item-tags">${tags.map((tag) => `<span class="automation-tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
                    ${scenario.description ? `<small>${escapeHtml(scenario.description)}</small>` : ''}
                `;
                li.addEventListener('click', () => {
                    if (state.selectedScenarioId !== scenario.id) {
                        state.selectedScenarioId = scenario.id;
                        renderAll();
                    }
                });
                list.appendChild(li);
            });
            els.scenarioList.appendChild(list);
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
                const expected = Array.isArray(testCase.expected_results) ? testCase.expected_results : [];
                const dynamic = testCase.dynamic_variables || {};
                const relatedRequest = testCase.related_api_request ? `Linked request: #${testCase.related_api_request}` : '';
                card.innerHTML = `
                    <header>
                        <h3>${escapeHtml(testCase.title || 'Untitled case')}</h3>
                        <div class="case-meta">Priority: ${escapeHtml(testCase.priority || '—')} · Owner: ${escapeHtml(testCase.owner || '—')}</div>
                    </header>
                    ${testCase.description ? `<p>${escapeHtml(testCase.description)}</p>` : ''}
                    ${steps.length ? `<div><strong>Steps</strong><ol class="case-detail-list">${steps.map((step, index) => `<li>Step ${index + 1}: ${escapeHtml(formatStructuredValue(step))}</li>`).join('')}</ol></div>` : ''}
                    ${expected.length ? `<div><strong>Expected</strong><ul class="case-detail-list">${expected.map((item) => `<li>${escapeHtml(formatStructuredValue(item))}</li>`).join('')}</ul></div>` : ''}
                    ${Object.keys(dynamic).length ? `<div><strong>Dynamic variables</strong><pre>${escapeHtml(JSON.stringify(dynamic, null, 2))}</pre></div>` : ''}
                    ${relatedRequest ? `<div><small>${escapeHtml(relatedRequest)}</small></div>` : ''}
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

        const handlePlanSubmit = async (event) => {
            event.preventDefault();
            if (!els.planForm) {
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
                        const selectedRisks = Array.from(
                            els.planRiskMatrix.querySelectorAll('[data-role="plan-risk-checkbox"]')
                        )
                            .filter((input) => input instanceof HTMLInputElement && input.checked && input.value !== '')
                            .map((input) => Number(input.value))
                            .filter((value) => Number.isFinite(value));
                        payload.risk_mitigations = selectedRisks;
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
            const scenario = getSelectedScenario();
            if (!scenario) {
                setStatus('Select a scenario to attach the test case.', 'error');
                return;
            }
            try {
                const steps = splitList(inputs.case.steps.value).map((value, index) => ({ order: index + 1, action: value }));
                const expected = splitList(inputs.case.expected.value).map((value) => ({ note: value }));
                const dynamic = parseJsonTextarea(inputs.case.dynamic.value, 'Dynamic variables');
                const payload = {
                    scenario: scenario.id,
                    title: (inputs.case.title.value || '').trim(),
                    description: inputs.case.description.value || '',
                    steps,
                    expected_results: expected,
                    dynamic_variables: dynamic,
                    priority: inputs.case.priority.value || '',
                    owner: inputs.case.owner.value || '',
                };
                const requestIdRaw = inputs.case.request.value;
                if (requestIdRaw) {
                    const parsedId = Number(requestIdRaw);
                    if (!Number.isNaN(parsedId) && parsedId > 0) {
                        payload.related_api_request = parsedId;
                    }
                }
                if (!payload.title) {
                    throw new Error('Test case title is required.');
                }
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
        }
        if (els.maintenanceForm) {
            els.maintenanceForm.addEventListener('submit', handleMaintenanceSubmit);
        }
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
        initialSelection();
        renderAll();
    });
})();
