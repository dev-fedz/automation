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
        try { console.info('[automation] automation.js DOMContentLoaded handler running'); } catch (e) { /* ignore */ }
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
                try { console.debug('[automation] openCaseSelectionModal invoked'); } catch (e) { }
                if (!els.caseSelectionModal) return;
                // Fetch latest plans from API before populating modal so the
                // options reflect the current server state. We do this even if
                // state.plans exists to ensure freshness.
                (async () => {
                    try { console.debug('[automation] fetching plans for modal from', apiEndpoints.plans || '/api/core/test-plans/'); } catch (e) { }
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
                    try { populateModalCaseSelects(); } catch (e) { /* ignore */ }
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
                    // reuse logic: update modal module list based on plan
                    try {
                        const moduleSelect = modalModuleEl;
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
                        modules.forEach((m) => {
                            const opt = document.createElement('option'); opt.value = m.id; opt.textContent = m.title || `Module ${m.id}`; moduleSelect.appendChild(opt);
                        });
                        moduleSelect.disabled = !modules.length;
                        // reset scenario select
                        if (modalScenarioEl) {
                            modalScenarioEl.innerHTML = '';
                            const ph = document.createElement('option'); ph.value = ''; ph.textContent = '(select scenario)'; modalScenarioEl.appendChild(ph);
                            modalScenarioEl.disabled = true;
                        }
                    } catch (e) { /* ignore */ }
                });
            }
            if (modalModuleEl) {
                modalModuleEl.addEventListener('change', (ev) => {
                    const pid = (modalPlanEl && modalPlanEl.value) ? modalPlanEl.value : null;
                    const mid = (ev.currentTarget && ev.currentTarget.value) ? ev.currentTarget.value : (modalModuleEl.value || null);
                    if (!mid) {
                        if (modalScenarioEl) modalScenarioEl.disabled = true;
                        return;
                    }
                    try {
                        const scenarios = [];
                        const planObj = state.plans.find((p) => String(p.id) === String(pid));
                        if (planObj && Array.isArray(planObj.scenarios)) {
                            planObj.scenarios.forEach((s) => {
                                if (String(s.module || s.module_id || '') === String(mid)) scenarios.push(s);
                            });
                        }
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
                        // enable form fieldset
                        if (els.caseForm) {
                            const fieldset = els.caseForm.querySelector('fieldset'); if (fieldset) fieldset.disabled = false;
                        }
                        // show the test cases panel container if hidden
                        try {
                            const panel = document.getElementById('test-cases-panel-container');
                            if (panel) panel.style.display = '';
                        } catch (ie) { /* ignore */ }
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
                            const opt = document.createElement('option'); opt.value = m.id; opt.textContent = m.title || `Module ${m.id}`;
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
                            const opt = document.createElement('option'); opt.value = m.id; opt.textContent = m.title || `Module ${m.id}`;
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
            console.debug('[automation] initialPlans length:', (state.plans || []).length, 'sample:', (state.plans || []).slice(0, 3));
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
                    option.textContent = m.title || `Module ${m.id}`;
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
                console.debug('[automation] plan changed', { selectedPlanId: state.selectedPlanId, selectedScenarioId: state.selectedScenarioId });
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

        // New Scenario button should use the same modal flow as Add Scenario in Data Management
        const openNewScenarioButton = document.getElementById('open-new-scenario');
        if (openNewScenarioButton) {
            openNewScenarioButton.addEventListener('click', (ev) => {
                // ensure a plan and module are selected
                const planId = state.selectedPlanId || (els.scenarioPlan && els.scenarioPlan.value ? Number(els.scenarioPlan.value) : null);
                const moduleFilter = document.getElementById('module-filter');
                const mid = moduleFilter && moduleFilter.value ? Number(moduleFilter.value) : null;
                // Debug: log the user click and current selection so it's visible in Console
                try { console.info('[automation] open-new-scenario clicked', { planIdCandidate: planId, moduleFilterValue: mid }); } catch (e) { /* ignore */ }
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
                    try { console.info('[automation] dispatched open-module-scenario', { detail: ev.detail }); } catch (e) { /* ignore */ }
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
                        try { console.info('[automation] fallback opened modal directly', { moduleId: mid }); } catch (er) { /* ignore */ }
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
                    console.info('[automation] test-modules-changed received', ev && ev.detail ? ev.detail : null);
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
            try {
                console.debug('[automation] openPlanEdit called', { id: plan && plan.id, hasDetails: Array.isArray(plan && plan.risk_mitigation_details) && plan.risk_mitigation_details.length });
            } catch (e) { /* ignore logging errors */ }
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
                console.debug('[automation] renderPlanRiskMatrix called', { id: plan && plan.id, hasDetails, injected: { selectedForPlan: selLen, byPlanTotal: byPlanLen, allMappings: allLen } });
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
                        try { console.debug('[automation] fetching per-plan mappings', { mappingsUrlBase, url, planId: plan.id }); } catch (e) { }
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
                    try { console.debug('[automation] mapping tbody found on page'); } catch (e) { }
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
                        try { console.debug('[automation] mapping details resolved: none'); } catch (e) { }
                        // Additional debug info to help diagnose why mappings are
                        // empty: dump page-injected mappings and plan id.
                        try {
                            const nodeAll = document.getElementById('automation-initial-risk-mitigations');
                            const allText = nodeAll ? (nodeAll.textContent || nodeAll.innerText || '') : '';
                            console.debug('[automation] fallback allMappings length', allText ? (JSON.parse(allText) || []).length : 0, 'planId', plan && plan.id);
                        } catch (err) { console.debug('[automation] error parsing fallback mappings', err); }
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
                                        console.debug('[automation] retry: found fallback mappings after delay', forPlan.length);
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
                                            console.debug('[automation] retry: mapping table already populated, skipping overwrite', { existing: existing.length });
                                        }
                                    }
                                }
                            } catch (err) {
                                /* ignore retry errors */
                            }
                        }, 250);
                    } else {
                        try { console.debug('[automation] mapping details resolved', { count: details.length }); } catch (e) { }
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
                            console.debug('[automation] mapping rows source', { source: detailsSource || 'unknown', ids: uniqueDetails.map((m) => m && m.id) });
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
            console.debug('[automation] renderScenarioList called', { selectedPlanId: state.selectedPlanId, plan: plan ? { id: plan.id, scenarios: Array.isArray(plan.scenarios) ? plan.scenarios.length : 0 } : null });
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
            console.debug('[automation] plan has scenarios count', scenarios.length);
            // Detailed per-scenario debug to surface module/plan shapes that
            // can break client-side filters when the API returns nested
            // objects instead of primitive ids.
            try {
                const details = scenarios.map((s) => ({ id: s && s.id, moduleValue: s && s.module, moduleType: s && s.module === null ? 'null' : typeof (s && s.module) }));
                console.debug('[automation] scenario module snapshot', details.slice(0, 50));
            } catch (err) {
                console.debug('[automation] error while snapshotting scenario modules', err);
            }
            // apply scenario search filter (from header)
            const q = state._scenarioSearch || '';
            const moduleFilterVal = (document.getElementById('module-filter') && document.getElementById('module-filter').value) ? String(document.getElementById('module-filter').value) : '';
            console.debug('[automation] applying filters', { search: q, moduleFilterVal });
            const filtered = scenarios.filter((s) => {
                if (q) {
                    const lower = q;
                    const match = (s.title || '').toLowerCase().includes(lower) || (s.description || '').toLowerCase().includes(lower) || (Array.isArray(s.tags) ? s.tags.join(' ').toLowerCase().includes(lower) : false);
                    if (!match) return false;
                }
                if (moduleFilterVal) {
                    // module filter expects module id match
                    // Log a per-item comparison to help debugging mismatches.
                    try { console.debug('[automation] module filter compare', { scenarioId: s && s.id, scenarioModule: s && s.module, cmpTo: moduleFilterVal, eq: String(s && s.module || '') === String(moduleFilterVal) }); } catch (e) { }
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
                    const moduleLabel = module ? (module.title || `Module ${module.id}`) : '';
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
                console.debug('[automation] module filter changed', { value: mid });
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
                        console.debug('[automation] module scenarios fetched', { count: normalized.length, sample: normalized.length ? normalized[0] : null });
                        // Extra diagnostic: log module value/types for each returned scenario
                        try {
                            const moduleSnapshot = normalized.map((s) => ({ id: s && s.id, module: s && s.module, moduleType: s && s.module === null ? 'null' : typeof (s && s.module) }));
                            console.debug('[automation] module scenarios normalized snapshot', moduleSnapshot.slice(0, 200));
                            // show what would be matched for the currently selected module
                            const moduleMatches = normalized.filter((s) => String(s.module || '') === String(mid));
                            console.debug('[automation] module filter matching preview', { requestedModule: mid, matchedCount: moduleMatches.length, sample: moduleMatches.length ? moduleMatches[0] : null });
                        } catch (err) {
                            console.debug('[automation] error while producing module snapshots', err);
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
                                        const moduleLabel = module ? (module.title || `Module ${module.id}`) : '';
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
                                    const moduleLabel = module ? (module.title || `Module ${module.id}`) : '';
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
                                        const pre = document.getElementById('module-add-scenario-preconditions'); if (pre) pre.value = normalizedScenario.preconditions || '';
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
                console.debug('[automation] attempting to load scenarios from', scenariosUrl);
                setStatus('Loading scenarios…', 'info');
                const resp = await fetch(scenariosUrl, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
                if (!resp.ok) throw new Error(`Failed to load scenarios: ${resp.status}`);
                const scenarios = await resp.json();
                // normalize fetched scenarios
                const normalized = Array.isArray(scenarios) ? scenarios.map(normalizeScenario) : [];
                console.debug('[automation] scenarios fetched', Array.isArray(normalized) ? normalized.length : typeof normalized);
                // If we don't have plans on the client, fetch them first so we
                // can attach scenarios to real plan objects and set a selected
                // plan id. This covers cases where `initial_plans` was empty.
                if (!Array.isArray(state.plans) || !state.plans.length) {
                    try {
                        console.debug('[automation] no plans present, fetching plans before attaching scenarios');
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
