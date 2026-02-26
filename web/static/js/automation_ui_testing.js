// automation_ui_testing.js - Dynamic UI Testing Module

let currentRecord = null;
let records = [];
let currentStep = null;
let canvasSteps = [];
let draggedStep = null;
let isDragging = false;
let offsetX = 0;
let offsetY = 0;

// Canvas variables
let canvas, ctx;
let selectedStep = null;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function () {
    canvas = document.getElementById('flowchart-canvas');
    if (canvas) {
        ctx = canvas.getContext('2d');
        setupCanvas();
    }
    loadRecords();
    loadProjects();
    // Ensure modals are closed on initial load
    try { closeRecordModal(); } catch (e) { /* ignore if not ready */ }
    try { closeStepModal(); } catch (e) { /* ignore if not ready */ }
});

// Record Management
function loadRecords(page = 1) {
    // Server enforces a page size of 3; request by offset only.
    const serverPageSize = 3;
    const offset = (page - 1) * serverPageSize;

    fetch(`/api/core/ui-testing-records/?offset=${offset}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        credentials: 'same-origin'
    })
        .then(response => {
            if (!response.ok) {
                return response.text().then(text => {
                    console.error('Error loading records: HTTP', response.status, text);
                    throw new Error(`Failed to load records: ${response.status}`);
                });
            }
            return response.json().catch(err => {
                console.error('Failed to parse records JSON:', err);
                return {};
            });
        })
        .then(data => {
            // Support both paginated responses {results: [], count: N}
            // and legacy plain array responses []. Use server page size
            // (3) to compute pagination so buttons reflect server behavior.
            let results = [];
            let totalCount = 0;
            if (Array.isArray(data)) {
                results = data;
                totalCount = data.length;
                // For legacy plain arrays treat page size as full length
                const clientPageSize = results.length || serverPageSize;
                records = results;
                displayRecords(records);
                displayPagination(page, Math.ceil((totalCount || 0) / clientPageSize));
            } else {
                results = data.results || [];
                totalCount = data.count || results.length;
                records = results;
                displayRecords(records);
                displayPagination(page, Math.ceil((totalCount || 0) / serverPageSize));
            }
        })
        .catch(error => {
            console.error('Error loading records:', error);
            const container = document.getElementById('ui-testing-records-list');
            if (container) container.innerHTML = '<p>Error loading UI testing records. See console for details.</p>';
            // Fallback to empty records
            records = [];
            displayRecords([]);
            displayPagination(1, 1);
        });
}

function displayRecords(recordsList) {
    const container = document.getElementById('ui-testing-records-list');
    container.innerHTML = '';

    if (recordsList.length === 0) {
        container.innerHTML = '<p>No UI testing records found. Create your first record!</p>';
        return;
    }

    recordsList.forEach(record => {
        const recordDiv = document.createElement('div');
        recordDiv.className = 'record-item';
        recordDiv.innerHTML = `
            <div class="record-info">
                <h3>${record.name}</h3>
                <p>Project: ${record.project_name}</p>
                <p>Module: ${record.module_name || 'N/A'}</p>
                <p>Scenario: ${record.scenario_name}</p>
                <p>Steps: ${record.steps ? record.steps.length : 0}</p>
            </div>
            <div class="record-actions">
                <button onclick="editRecord(${record.id})">Edit</button>
                <button onclick="deleteRecord(${record.id})">Delete</button>
                <button onclick="runRecord(${record.id})">Run</button>
            </div>
        `;
        container.appendChild(recordDiv);
    });
}

function displayPagination(currentPage, totalPages) {
    const container = document.getElementById('pagination-controls');
    if (!container) return;
    container.innerHTML = '';

    if (totalPages <= 1) return;

    // Build pagination similar to Recent Load Tests: Prev, numeric (with ellipses), Next
    let html = '<div class="pagination" style="display:flex; justify-content:center; align-items:center; gap:10px; margin-top:12px;">';

    // Previous
    if (currentPage > 1) {
        html += `<button type="button" class="btn-secondary" onclick="loadRecords(${currentPage - 1})">Previous</button>`;
    }

    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, currentPage + 2);

    if (startPage > 1) {
        html += `<button type="button" class="btn-secondary" onclick="loadRecords(1)">1</button>`;
        if (startPage > 2) html += '<span style="padding:5px 8px;">...</span>';
    }

    for (let i = startPage; i <= endPage; i++) {
        const isActive = i === currentPage;
        const cls = isActive ? 'btn-primary' : 'btn-secondary';
        html += `<button type="button" class="${cls}" onclick="loadRecords(${i})">${i}</button>`;
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) html += '<span style="padding:5px 8px;">...</span>';
        html += `<button type="button" class="btn-secondary" onclick="loadRecords(${totalPages})">${totalPages}</button>`;
    }

    // Next
    if (currentPage < totalPages) {
        html += `<button type="button" class="btn-secondary" onclick="loadRecords(${currentPage + 1})">Next</button>`;
    }

    html += '</div>';
    container.innerHTML = html;
}

function showCreateRecordForm() {
    document.getElementById('ui-testing-list-section').style.display = 'none';
    document.getElementById('create-record-section').style.display = 'block';
    document.getElementById('record-form-title').textContent = 'Create UI Testing Record';
    document.getElementById('record-form').reset();

    // Reset selects and disable dependent ones
    document.getElementById('test-module').disabled = true;
    document.getElementById('test-scenario').disabled = true;
    document.getElementById('test-case').disabled = true;
    document.getElementById('test-module').innerHTML = '<option value="">Select Module</option>';
    document.getElementById('test-scenario').innerHTML = '<option value="">Select Scenario</option>';
    document.getElementById('test-case').innerHTML = '<option value="">Select Test Case</option>';

    currentRecord = null;
}

function editRecord(recordId) {
    const record = records.find(r => r.id === recordId);
    if (!record) return;

    currentRecord = record;
    document.getElementById('record-modal-title').textContent = 'Edit UI Testing Record';
    document.getElementById('record-name').value = record.name;

    // Set project first
    document.getElementById('test-project').value = record.project;

    // Load modules for the project, then set module
    loadModules(record.project, record.module);

    // Load scenarios for the project and module, then set scenario
    loadScenarios(record.project, record.module, record.scenario);

    // Show modal
    const recordModal = document.getElementById('record-modal');
    if (recordModal) recordModal.classList.add('is-open');
    document.body.classList.add('modal-open');
}

function saveRecord() {
    const form = document.getElementById('record-form');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const recordData = {
        name: document.getElementById('record-name').value,
        project: document.getElementById('test-project').value,
        module: document.getElementById('test-module').value || null,
        scenario: document.getElementById('test-scenario').value,
        steps: currentRecord ? currentRecord.steps : [],
        description: '',
        is_active: true
    };

    const url = currentRecord
        ? `/api/core/ui-testing-records/${currentRecord.id}/`
        : '/api/core/ui-testing-records/';

    const method = currentRecord ? 'PUT' : 'POST';

    fetch(url, {
        method: method,
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        credentials: 'same-origin',
        body: JSON.stringify(recordData)
    })
        .then(response => {
            if (!response.ok) {
                // Attempt to parse error JSON, otherwise throw generic
                return response.json().then(err => { throw err; }).catch(() => { throw new Error('Server returned an error'); });
            }
            // Some endpoints may return empty body
            if (response.status === 204 || response.headers.get('Content-Length') === '0') return null;
            return response.json().catch(() => null);
        })
        .then(data => {
            closeRecordModal();
            loadRecords();
        })
        .catch(error => {
            console.error('Error saving record:', error);
            alert('Error saving record. Please try again.');
        });
}

function deleteRecord(recordId) {
    if (!confirm('Are you sure you want to delete this record?')) return;

    fetch(`/api/core/ui-testing-records/${recordId}/`, {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        credentials: 'same-origin'
    })
        .then(response => {
            if (response.ok) {
                loadRecords();
            } else {
                alert('Error deleting record. Please try again.');
            }
        })
        .catch(error => {
            console.error('Error deleting record:', error);
            alert('Error deleting record. Please try again.');
        });
}

function runRecord(recordId) {
    const record = records.find(r => r.id === recordId);
    if (!record) return;

    // In a real implementation, this would execute the test
    alert(`Running UI test: ${record.name}`);
}

// Modal functions
function showCreateRecordModal() {
    // Reset form
    document.getElementById('record-form').reset();
    document.getElementById('record-modal-title').textContent = 'Create UI Testing Record';

    // Reset selects and disable dependent ones
    document.getElementById('test-module').disabled = true;
    document.getElementById('test-scenario').disabled = true;
    document.getElementById('test-module').innerHTML = '<option value="">Select Module</option>';
    document.getElementById('test-scenario').innerHTML = '<option value="">Select Scenario</option>';

    // Load projects
    loadProjects();

    // Show modal
    const recordModal = document.getElementById('record-modal');
    if (recordModal) recordModal.classList.add('is-open');
    document.body.classList.add('modal-open');

    currentRecord = null;
}

function closeRecordModal() {
    const modal = document.getElementById('record-modal');
    if (modal) {
        modal.classList.remove('is-open');
    }
    document.body.classList.remove('modal-open');
    currentRecord = null;

    // Reset form and dependent selects so the modal is pristine when opened next
    const form = document.getElementById('record-form');
    if (form) form.reset();
    const moduleSelect = document.getElementById('test-module');
    const scenarioSelect = document.getElementById('test-scenario');
    if (moduleSelect) {
        moduleSelect.disabled = true;
        moduleSelect.innerHTML = '<option value="">Select Module</option>';
    }
    if (scenarioSelect) {
        scenarioSelect.disabled = true;
        scenarioSelect.innerHTML = '<option value="">Select Scenario</option>';
    }
}

function closeStepModal() {
    const stepModal = document.getElementById('step-modal');
    if (stepModal) stepModal.classList.remove('is-open');
    document.body.classList.remove('modal-open');
    currentStep = null;
}

// Metrics function
// Scenario and Test Case Loading
function loadProjects() {
    fetch('/api/core/test-plans/', {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        credentials: 'same-origin'
    })
        .then(response => response.json())
        .then(data => {
            const select = document.getElementById('test-project');
            select.innerHTML = '<option value="">Select Project</option>';

            data.forEach(project => {
                const option = document.createElement('option');
                option.value = project.id;
                option.textContent = project.name;
                select.appendChild(option);
            });
        })
        .catch(error => {
            console.error('Error loading projects:', error);
            // Fallback to mock data if API fails
            loadProjectsMock();
        });
}

function loadModules(projectId = null, selectedModuleId = null) {
    if (!projectId) {
        document.getElementById('test-module').disabled = true;
        document.getElementById('test-module').innerHTML = '<option value="">Select Module</option>';
        document.getElementById('test-scenario').disabled = true;
        document.getElementById('test-scenario').innerHTML = '<option value="">Select Scenario</option>';
        document.getElementById('test-case').disabled = true;
        document.getElementById('test-case').innerHTML = '<option value="">Select Test Case</option>';
        return;
    }

    fetch(`/api/core/test-modules/?project=${projectId}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        credentials: 'same-origin'
    })
        .then(response => response.json())
        .then(data => {
            const select = document.getElementById('test-module');
            select.innerHTML = '<option value="">Select Module</option>';
            select.disabled = false;

            // Add an option for "No Module" (scenarios without a module)
            const noModuleOption = document.createElement('option');
            noModuleOption.value = '';
            noModuleOption.textContent = 'No Module';
            select.appendChild(noModuleOption);

            data.forEach(module => {
                const option = document.createElement('option');
                option.value = module.id;
                option.textContent = module.title;
                if (selectedModuleId && selectedModuleId == module.id) {
                    option.selected = true;
                }
                select.appendChild(option);
            });

            // Reset dependent selections
            document.getElementById('test-scenario').disabled = true;
            document.getElementById('test-scenario').innerHTML = '<option value="">Select Scenario</option>';
        })
        .catch(error => {
            console.error('Error loading modules:', error);
            // Fallback to mock data
            loadModulesMock(projectId, selectedModuleId);
        });
}

function loadScenarios(projectId = null, moduleId = null, selectedScenarioId = null) {
    if (!projectId) {
        document.getElementById('test-scenario').disabled = true;
        document.getElementById('test-scenario').innerHTML = '<option value="">Select Scenario</option>';
        return;
    }

    let url = `/api/core/test-scenarios/?project=${projectId}`;
    if (moduleId !== null && moduleId !== '') {
        url += `&module=${moduleId}`;
    }

    fetch(url, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        credentials: 'same-origin'
    })
        .then(response => response.json())
        .then(data => {
            const select = document.getElementById('test-scenario');
            select.innerHTML = '<option value="">Select Scenario</option>';
            select.disabled = false;

            data.forEach(scenario => {
                const option = document.createElement('option');
                option.value = scenario.id;
                option.textContent = scenario.title;
                if (selectedScenarioId && selectedScenarioId == scenario.id) {
                    option.selected = true;
                }
                select.appendChild(option);
            });
        })
        .catch(error => {
            console.error('Error loading scenarios:', error);
            // Fallback to mock data
            loadScenariosMock(projectId, moduleId, selectedScenarioId);
        });
}

function loadScenariosMock(projectId, moduleId = null, selectedScenarioId = null) {
    // Fallback mock data
    const scenarios = {
        1: [
            { id: 1, title: 'User Login Scenarios' },
            { id: 2, title: 'Product Search' },
            { id: 3, title: 'Shopping Cart' }
        ],
        2: [
            { id: 4, title: 'Admin Login' },
            { id: 5, title: 'User Management' },
            { id: 6, title: 'Reports Dashboard' }
        ],
        3: [
            { id: 7, title: 'User Registration' },
            { id: 8, title: 'Profile Management' },
            { id: 9, title: 'Password Reset' }
        ]
    };

    const select = document.getElementById('test-scenario');
    select.innerHTML = '<option value="">Select Scenario</option>';
    select.disabled = false;

    const projectScenarios = scenarios[projectId] || [];
    projectScenarios.forEach(scenario => {
        const option = document.createElement('option');
        option.value = scenario.id;
        option.textContent = scenario.title;
        if (selectedScenarioId && selectedScenarioId == scenario.id) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

// Utility function to get CSRF token
function getCsrfToken() {
    const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]');
    return csrfToken ? csrfToken.value : '';
}

// Step Management
function addStep() {
    document.getElementById('step-modal-title').textContent = 'Add Step';
    document.getElementById('add-step-form').reset();
    const stepModal = document.getElementById('step-modal');
    if (stepModal) stepModal.classList.add('is-open');
    document.body.classList.add('modal-open');
    currentStep = null;
}

function cancelStepForm() {
    closeStepModal();
}

function toggleComponentInput() {
    const selection = document.getElementById('component-selection').value;
    document.getElementById('component-inputs').style.display = selection === 'component' ? 'block' : 'none';
    document.getElementById('image-inputs').style.display = selection === 'image' ? 'block' : 'none';
}

function saveStep() {
    const form = document.getElementById('add-step-form');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const stepData = {
        id: currentStep ? currentStep.id : Date.now(),
        name: document.getElementById('step-name').value,
        componentSelection: document.getElementById('component-selection').value,
        componentName: document.getElementById('component-name').value,
        componentType: document.getElementById('component-type').value,
        componentValue: document.getElementById('component-value').value,
        uiElementType: document.getElementById('ui-element-type').value,
        action: document.getElementById('step-action').value,
        value: document.getElementById('step-value').value,
        x: currentStep ? currentStep.x : Math.random() * 600 + 100,
        y: currentStep ? currentStep.y : Math.random() * 400 + 100
    };

    if (currentStep) {
        const index = canvasSteps.findIndex(s => s.id === currentStep.id);
        canvasSteps[index] = stepData;
    } else {
        canvasSteps.push(stepData);
    }

    cancelStepForm();
    drawCanvas();
    generateScript();
}

function captureScreenshot() {
    // In a real implementation, this would capture screenshot
    document.getElementById('image-preview').innerHTML = '<p>Screenshot captured (simulated)</p>';
}

// Canvas/Flowchart Management
function setupCanvas() {
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('dblclick', handleDoubleClick);

    drawCanvas();
}

function handleMouseDown(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check if clicking on a step
    for (let step of canvasSteps) {
        if (x >= step.x && x <= step.x + 150 && y >= step.y && y <= step.y + 80) {
            selectedStep = step;
            isDragging = true;
            offsetX = x - step.x;
            offsetY = y - step.y;
            break;
        }
    }
}

function handleMouseMove(e) {
    if (!isDragging || !selectedStep) return;

    const rect = canvas.getBoundingClientRect();
    selectedStep.x = e.clientX - rect.left - offsetX;
    selectedStep.y = e.clientY - rect.top - offsetY;

    drawCanvas();
}

function handleMouseUp() {
    isDragging = false;
    selectedStep = null;
}

function handleDoubleClick(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check if double-clicking on a step
    for (let step of canvasSteps) {
        if (x >= step.x && x <= step.x + 150 && y >= step.y && y <= step.y + 80) {
            editStepOnCanvas(step);
            break;
        }
    }
}

function editStepOnCanvas(step) {
    currentStep = step;
    document.getElementById('step-name').value = step.name;
    document.getElementById('component-selection').value = step.componentSelection;
    toggleComponentInput();
    document.getElementById('component-name').value = step.componentName || '';
    document.getElementById('component-type').value = step.componentType || '';
    document.getElementById('component-value').value = step.componentValue || '';
    document.getElementById('ui-element-type').value = step.uiElementType || '';
    document.getElementById('step-action').value = step.action || '';
    document.getElementById('step-value').value = step.value || '';

    document.getElementById('step-form').style.display = 'block';
}

function drawCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw connections first
    drawConnections();

    // Draw steps
    canvasSteps.forEach(step => {
        drawStep(step);
    });
}

function drawStep(step) {
    // Step box
    ctx.fillStyle = selectedStep === step ? '#e3f2fd' : '#f5f5f5';
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.fillRect(step.x, step.y, 150, 80);
    ctx.strokeRect(step.x, step.y, 150, 80);

    // Step content
    ctx.fillStyle = '#333';
    ctx.font = '12px Arial';
    ctx.fillText(step.name, step.x + 10, step.y + 20);
    ctx.fillText(`${step.action} ${step.uiElementType}`, step.x + 10, step.y + 40);
    ctx.fillText(`Value: ${step.value || 'N/A'}`, step.x + 10, step.y + 60);
}

function drawConnections() {
    // Simple connection drawing - connect steps in order
    for (let i = 0; i < canvasSteps.length - 1; i++) {
        const step1 = canvasSteps[i];
        const step2 = canvasSteps[i + 1];

        ctx.strokeStyle = '#666';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(step1.x + 150, step1.y + 40);
        ctx.lineTo(step2.x, step2.y + 40);
        ctx.stroke();

        // Arrow head
        const angle = Math.atan2(step2.y + 40 - step1.y - 40, step2.x - step1.x - 150);
        ctx.beginPath();
        ctx.moveTo(step2.x, step2.y + 40);
        ctx.lineTo(step2.x - 10 * Math.cos(angle - Math.PI / 6), step2.y + 40 - 10 * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(step2.x, step2.y + 40);
        ctx.lineTo(step2.x - 10 * Math.cos(angle + Math.PI / 6), step2.y + 40 - 10 * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
    }
}

function clearCanvas() {
    canvasSteps = [];
    drawCanvas();
    generateScript();
}

function exportFlowchart() {
    // In a real implementation, export as image or JSON
    const dataStr = JSON.stringify(canvasSteps, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

    const exportFileDefaultName = 'flowchart.json';

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
}

// Script Generation
function generateScript() {
    let script = `import { test, expect } from '@playwright/test';\n\n`;
    script += `test('${currentRecord ? currentRecord.name : 'Generated UI Test'}', async ({ page }) => {\n`;

    canvasSteps.forEach((step, index) => {
        script += `  // Step ${index + 1}: ${step.name}\n`;

        let locator;
        if (step.componentSelection === 'component') {
            switch (step.componentType) {
                case 'id':
                    locator = `page.locator('#${step.componentValue}')`;
                    break;
                case 'class':
                    locator = `page.locator('.${step.componentValue}')`;
                    break;
                case 'name':
                    locator = `page.locator('[name="${step.componentValue}"]')`;
                    break;
                case 'xpath':
                    locator = `page.locator('xpath=${step.componentValue}')`;
                    break;
                case 'css':
                    locator = `page.locator('${step.componentValue}')`;
                    break;
            }
        } else {
            // Image recognition placeholder
            locator = `page.locator('img').first() // Image recognition: ${step.componentName}`;
        }

        switch (step.action) {
            case 'click':
                script += `  await ${locator}.click();\n`;
                break;
            case 'type':
                script += `  await ${locator}.fill('${step.value}');\n`;
                break;
            case 'select':
                script += `  await ${locator}.selectOption('${step.value}');\n`;
                break;
            case 'wait':
                script += `  await page.waitForTimeout(${step.value || 1000});\n`;
                break;
            case 'assert':
                script += `  await expect(${locator}).toBeVisible();\n`;
                break;
            case 'navigate':
                script += `  await page.goto('${step.value}');\n`;
                break;
        }
        script += `\n`;
    });

    script += `});\n`;

    document.getElementById('generated-script').textContent = script;
}

function runTest() {
    if (canvasSteps.length === 0) {
        alert('No steps to run. Add some steps first.');
        return;
    }

    // In a real implementation, this would execute the generated script
    alert('Test execution would be implemented here. Check the generated script below.');
}

// Navigation
function backToList() {
    document.getElementById('record-details-section').style.display = 'none';
    document.getElementById('ui-testing-list-section').style.display = 'block';
    currentRecord = null;
    canvasSteps = [];
    drawCanvas();
}