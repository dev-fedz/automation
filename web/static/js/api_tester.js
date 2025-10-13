(function () {
    const DEFAULT_HEADERS = [
        { key: 'Content-Type', value: 'application/json', description: '' },
        { key: 'Accept', value: '*/*', description: '' },
    ];
    const DEFAULT_BODY_RAW_TYPE = 'json';
    const RAW_TYPE_CONTENT_TYPES = {
        text: 'text/plain',
        javascript: 'application/javascript',
        json: 'application/json',
        html: 'text/html',
        xml: 'application/xml',
    };
    const RAW_TYPE_MONACO_LANG = {
        text: 'plaintext',
        javascript: 'javascript',
        json: 'json',
        html: 'html',
        xml: 'xml',
    };
    const RAW_TYPE_PLACEHOLDERS = {
        text: 'Plain text payload',
        javascript: '// JavaScript snippet',
        json: '{\n  "key": "value"\n}',
        html: '<!DOCTYPE html>\n<html>\n  <head></head>\n  <body>\n  </body>\n</html>',
        xml: '<root></root>',
    };
    const SCRIPT_PLACEHOLDERS = {
        pre: '// Runs before the request',
        post: '// Runs after the response',
    };
    const BODY_MODE_CONTENT_TYPES = {
        urlencoded: 'application/x-www-form-urlencoded; charset=UTF-8',
        binary: 'application/octet-stream',
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

    const getCookie = (name) => {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) {
            return parts.pop().split(';').shift();
        }
        return null;
    };

    const prettyJson = (value) => {
        try {
            return JSON.stringify(value ?? {}, null, 2);
        } catch (error) {
            return String(value);
        }
    };

    const parseJsonField = (text, fallback) => {
        if (!text || !text.trim()) {
            return fallback;
        }
        try {
            return JSON.parse(text);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Invalid JSON payload';
            throw new Error(message);
        }
    };

    const cloneDefaultHeaders = () => DEFAULT_HEADERS.map((item) => ({ ...item }));

    const rowsToObject = (rows) => {
        const payload = {};
        rows
            .filter((row) => row.key && row.key.trim())
            .forEach((row) => {
                payload[row.key] = row.value ?? '';
            });
        return payload;
    };

    const rowsToQueryString = (rows) => {
        return rows
            .filter((row) => row.key && row.key.trim())
            .map((row) => `${encodeURIComponent(row.key)}=${encodeURIComponent(row.value ?? '')}`)
            .join('&');
    };

    const objectToRows = (obj, withDescription = false) => {
        if (!obj || typeof obj !== 'object') {
            return [];
        }
        return Object.entries(obj).map(([key, value]) => ({
            key,
            value: value === null || value === undefined ? '' : String(value),
            description: withDescription ? '' : undefined,
        }));
    };

    const mergeObjectIntoRows = (rows, obj, withDescription = false) => {
        if (!obj || typeof obj !== 'object') {
            return rows;
        }
        const lookup = new Map(rows.map((row) => [row.key, row]));
        Object.entries(obj).forEach(([key, value]) => {
            if (!key) {
                return;
            }
            const normalized = value === null || value === undefined ? '' : String(value);
            if (lookup.has(key)) {
                lookup.get(key).value = normalized;
            } else {
                rows.push({ key, value: normalized, description: withDescription ? '' : undefined });
            }
        });
        return rows;
    };

    const normalizeFormDataRows = (raw) => {
        if (!raw) {
            return [];
        }
        if (Array.isArray(raw)) {
            return raw.map((item) => ({
                key: item?.key ? String(item.key) : '',
                value: item?.type === 'file' ? '' : item?.value ? String(item.value) : '',
                type: item?.type === 'file' ? 'file' : 'text',
                fileName: item?.filename || item?.fileName || '',
                fileType: item?.content_type || item?.fileType || '',
                fileSize: item?.size || null,
                fileData: item?.data || item?.fileData || null,
            }));
        }
        return objectToRows(raw).map((row) => ({
            key: row.key || '',
            value: row.value || '',
            type: 'text',
            fileName: '',
            fileType: '',
            fileSize: null,
            fileData: null,
        }));
    };

    const getInitialBuilderState = () => ({
        params: [],
        headers: cloneDefaultHeaders(),
        bodyMode: 'none',
        bodyRawType: DEFAULT_BODY_RAW_TYPE,
        bodyRawText: '',
        bodyFormData: [],
        bodyUrlEncoded: [],
        bodyBinary: null,
        auth: { type: 'none', username: '', password: '', token: '' },
        scripts: { pre: '', post: '' },
    });

    const state = {
        collections: [],
        environments: [],
        selectedCollectionId: null,
        selectedRequestId: null,
        selectedDirectoryId: null,
        urlBase: '',
        builder: getInitialBuilderState(),
        activeTab: 'params',
        activeScriptsTab: 'pre',
        collapsedCollections: new Set(),
        collapsedDirectoryKeys: new Set(),
        knownDirectoryKeys: new Set(),
        openCollectionMenuId: null,
        openDirectoryMenuKey: null,
        openRequestMenuKey: null,
        isCollectionsActionMenuOpen: false,
        directoryMaps: new Map(),
        dragState: null,
    };

    document.addEventListener('DOMContentLoaded', () => {
        const root = document.getElementById('api-tester-app');
        if (!root) {
            return;
        }

        const elements = {
            collectionsList: root.querySelector('.api-tester__collections-list'),
            search: document.getElementById('collection-search'),
            method: document.getElementById('request-method'),
            url: document.getElementById('request-url'),
            environmentSelect: document.getElementById('environment-select'),
            runButton: document.getElementById('run-request'),
            runCollectionButton: document.getElementById('run-collection'),
            saveRequestButton: document.getElementById('save-request'),
            saveRequestModal: document.getElementById('save-request-modal'),
            saveRequestNameInput: document.getElementById('save-request-name'),
            saveRequestCancelButton: document.getElementById('save-request-cancel'),
            saveRequestConfirmButton: document.getElementById('save-request-confirm'),
            status: document.getElementById('run-status'),
            responseSummary: document.getElementById('response-summary'),
            responseHeaders: document.getElementById('response-headers'),
            responseBody: document.getElementById('response-body'),
            responseAssertions: document.getElementById('response-assertions'),
            builderMeta: document.getElementById('builder-meta'),
            form: document.getElementById('api-request-form'),
            tabButtons: Array.from(root.querySelectorAll('[data-tab]')),
            tabPanels: Array.from(root.querySelectorAll('[data-tab-panel]')),
            paramsBody: document.getElementById('params-rows'),
            addParamRow: document.getElementById('add-param-row'),
            headersBody: document.getElementById('headers-rows'),
            addHeaderRow: document.getElementById('add-header-row'),
            authType: document.getElementById('auth-type'),
            authSections: root.querySelectorAll('[data-auth-section]'),
            authBasicUsername: document.getElementById('auth-basic-username'),
            authBasicPassword: document.getElementById('auth-basic-password'),
            authBearerToken: document.getElementById('auth-bearer-token'),
            bodyModeRadios: root.querySelectorAll('input[name="body-mode"]'),
            bodyPanels: root.querySelectorAll('[data-body-panel]'),
            bodyRawType: document.getElementById('body-raw-type'),
            bodyRawContainer: document.getElementById('body-raw-editor'),
            bodyFormBody: document.getElementById('body-form-rows'),
            addBodyFormRow: document.getElementById('add-body-form-row'),
            bodyUrlencodedBody: document.getElementById('body-urlencoded-rows'),
            addBodyUrlencodedRow: document.getElementById('add-body-urlencoded-row'),
            bodyBinaryInput: document.getElementById('body-binary-input'),
            bodyBinaryInfo: document.getElementById('body-binary-info'),
            scriptsTabButtons: Array.from(root.querySelectorAll('[data-script-tab]')),
            scriptsPanels: Array.from(root.querySelectorAll('[data-script-panel]')),
            scriptEditorPre: document.getElementById('script-pre-editor'),
            scriptEditorPost: document.getElementById('script-post-editor'),
            collectionsActionsToggle: document.getElementById('collections-actions-toggle'),
            collectionsActionsMenu: document.getElementById('collections-actions-menu'),
            collectionsCreateAction: document.getElementById('collections-action-create'),
            collectionsImportAction: document.getElementById('collections-action-import'),
            importPostmanInput: document.getElementById('import-postman-input'),
            createRequestButton: document.getElementById('create-request'),
        };

        const endpoints = {
            collections: root.dataset.collectionsUrl,
            collectionsImport: root.dataset.collectionsImportUrl,
            environments: root.dataset.environmentsUrl,
            execute: root.dataset.executeUrl,
            runTemplate: root.dataset.runUrlTemplate,
            requests: root.dataset.requestsUrl,
            directories: root.dataset.directoriesUrl,
        };

        const ensureTrailingSlash = (url) => {
            if (!url) {
                return '';
            }
            return url.endsWith('/') ? url : `${url}/`;
        };

        const getDirectoriesEndpoint = () => {
            if (!endpoints.directories) {
                return null;
            }
            return ensureTrailingSlash(endpoints.directories);
        };

        const getDirectoryReorderEndpoint = () => {
            const base = getDirectoriesEndpoint();
            if (!base) {
                return null;
            }
            return `${base}reorder/`;
        };

        const getRequestsEndpointBase = () => {
            if (!endpoints.requests) {
                return null;
            }
            return ensureTrailingSlash(endpoints.requests);
        };

        const getRequestReorderEndpoint = () => {
            const base = getRequestsEndpointBase();
            if (!base) {
                return null;
            }
            return `${base}reorder/`;
        };

        const reorderDirectories = async ({ collectionId, parentId, orderedIds }) => {
            const endpoint = getDirectoryReorderEndpoint();
            if (!endpoint) {
                throw new Error('Directory endpoint unavailable.');
            }
            return postJson(endpoint, {
                collection: collectionId,
                parent: parentId,
                ordered_ids: orderedIds,
            });
        };

        const reorderRequests = async ({ collectionId, directoryId, orderedIds }) => {
            const endpoint = getRequestReorderEndpoint();
            if (!endpoint) {
                throw new Error('Request endpoint unavailable.');
            }
            return postJson(endpoint, {
                collection: collectionId,
                directory: directoryId,
                ordered_ids: orderedIds,
            });
        };

        const updateRequestDirectory = async ({ requestId, directoryId }) => {
            const base = getRequestsEndpointBase();
            if (!base) {
                throw new Error('Request endpoint unavailable.');
            }
            const detailUrl = `${base}${requestId}/`;
            return postJson(detailUrl, { directory: directoryId }, 'PATCH');
        };

        const tabButtons = elements.tabButtons;
        const tabPanels = elements.tabPanels;
    const scriptTabButtons = elements.scriptsTabButtons || [];
    const scriptPanels = elements.scriptsPanels || [];
        const scriptEditorContainers = {
            pre: elements.scriptEditorPre,
            post: elements.scriptEditorPost,
        };
        let suppressUrlSync = false;
        let rawEditor = null;
        let jsonCompletionDisposable = null;
        let monacoLoaderPromise = null;
        let hasConfiguredJsonDiagnostics = false;
        let isRequestInFlight = false;
        const scriptEditors = { pre: null, post: null };
        const scriptFallbacks = { pre: null, post: null };

        const setStatus = (message, variant = 'neutral') => {
            if (!elements.status) {
                return;
            }
            elements.status.textContent = message;
            elements.status.dataset.variant = variant;
        };

        const getTrimmedUrlValue = () => {
            if (!elements.url) {
                return '';
            }
            return (elements.url.value || '').trim();
        };

        const hasRunnableUrl = () => Boolean(getTrimmedUrlValue());

        const updateRunButtonState = () => {
            if (!elements.runButton) {
                return;
            }
            const shouldDisable = isRequestInFlight || !hasRunnableUrl();
            elements.runButton.disabled = shouldDisable;
        };

        const getRawEditorValue = () => {
            if (rawEditor) {
                return rawEditor.getValue();
            }
            if (elements.bodyRawContainer) {
                const fallback = elements.bodyRawContainer.querySelector('textarea');
                if (fallback) {
                    return fallback.value;
                }
            }
            return state.builder.bodyRawText || '';
        };

        const setRawEditorValue = (value) => {
            const normalized = value ?? '';
            if (rawEditor) {
                if (rawEditor.getValue() !== normalized) {
                    rawEditor.setValue(normalized);
                }
            }
            state.builder.bodyRawText = normalized;
            if (!rawEditor && elements.bodyRawContainer) {
                const fallback = elements.bodyRawContainer.querySelector('textarea');
                if (fallback && fallback.value !== normalized) {
                    fallback.value = normalized;
                }
            }
        };

        const setRawPlaceholder = (text) => {
            const placeholder = text || '';
            if (elements.bodyRawContainer) {
                elements.bodyRawContainer.setAttribute('data-placeholder', placeholder);
            }
            const fallback = elements.bodyRawContainer
                ? elements.bodyRawContainer.querySelector('textarea')
                : null;
            if (fallback) {
                fallback.placeholder = placeholder;
                fallback.setAttribute('spellcheck', 'false');
            }
        };

        const refreshRawEditor = () => {
            if (rawEditor) {
                if (rawEditor.layout) {
                    rawEditor.layout();
                }
            }
        };

        const normalizeList = (payload) => {
            if (Array.isArray(payload)) {
                return payload;
            }
            if (payload && Array.isArray(payload.results)) {
                return payload.results;
            }
            return [];
        };

        const fetchJson = async (url) => {
            const response = await fetch(url, {
                headers: { Accept: 'application/json' },
                credentials: 'include',
            });
            if (!response.ok) {
                throw new Error(`Request failed with status ${response.status}`);
            }
            return response.json();
        };

        const postJson = async (url, payload, method = 'POST') => {
            const response = await fetch(url, {
                method,
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'X-CSRFToken': getCookie('csrftoken') || '',
                },
                body: JSON.stringify(payload),
            });
            const data = await response.json().catch(() => null);
            if (!response.ok) {
                const message = data?.detail || data?.error || `Request failed with status ${response.status}`;
                throw new Error(message);
            }
            return data;
        };

        const postFormData = async (url, formData) => {
            const response = await fetch(url, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    Accept: 'application/json',
                    'X-CSRFToken': getCookie('csrftoken') || '',
                },
                body: formData,
            });
            const data = await response.json().catch(() => null);
            if (!response.ok) {
                const message = data?.detail || data?.error || `Request failed with status ${response.status}`;
                throw new Error(message);
            }
            return data;
        };

        const deleteResource = async (url) => {
            const response = await fetch(url, {
                method: 'DELETE',
                credentials: 'include',
                headers: {
                    Accept: 'application/json',
                    'X-CSRFToken': getCookie('csrftoken') || '',
                },
            });
            if (!response.ok) {
                let message = `Request failed with status ${response.status}`;
                try {
                    const data = await response.json();
                    message = data?.detail || data?.error || message;
                } catch (error) {
                    // ignore body parsing failure
                }
                throw new Error(message);
            }
        };

        const promptForCollectionName = async (defaultName) => {
            return window.prompt('Enter a name for the new collection:', defaultName);
        };

        const promptForDirectoryName = async (defaultName, message = 'Enter a name for the new folder:') => {
            return window.prompt(message, defaultName);
        };

        let saveModalResolver = null;
        let saveModalPreviousFocus = null;

        const handleSaveModalKeydown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                cancelSaveModal();
            } else if (event.key === 'Enter' && event.target === elements.saveRequestNameInput) {
                event.preventDefault();
                confirmSaveModal();
            }
        };

        const closeSaveModal = () => {
            if (!elements.saveRequestModal) {
                return;
            }
            elements.saveRequestModal.hidden = true;
            elements.saveRequestModal.setAttribute('aria-hidden', 'true');
            elements.saveRequestModal.removeEventListener('keydown', handleSaveModalKeydown, true);
            if (elements.saveRequestNameInput) {
                elements.saveRequestNameInput.value = '';
                elements.saveRequestNameInput.removeAttribute('aria-invalid');
            }
            if (saveModalPreviousFocus && typeof saveModalPreviousFocus.focus === 'function') {
                saveModalPreviousFocus.focus();
            }
            saveModalPreviousFocus = null;
        };

        const resolveSaveModal = (value) => {
            if (!saveModalResolver) {
                return;
            }
            const resolver = saveModalResolver;
            saveModalResolver = null;
            closeSaveModal();
            resolver(value);
        };

        const confirmSaveModal = () => {
            if (!elements.saveRequestNameInput) {
                resolveSaveModal(null);
                return;
            }
            const trimmed = elements.saveRequestNameInput.value.trim();
            if (!trimmed) {
                elements.saveRequestNameInput.setAttribute('aria-invalid', 'true');
                elements.saveRequestNameInput.focus();
                return;
            }
            elements.saveRequestNameInput.removeAttribute('aria-invalid');
            resolveSaveModal(trimmed);
        };

        const cancelSaveModal = () => {
            resolveSaveModal(null);
        };

        const openSaveModal = (defaultName) => {
            if (!elements.saveRequestModal || !elements.saveRequestNameInput) {
                return Promise.resolve(null);
            }
            saveModalPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            elements.saveRequestModal.hidden = false;
            elements.saveRequestModal.setAttribute('aria-hidden', 'false');
            elements.saveRequestModal.addEventListener('keydown', handleSaveModalKeydown, true);
            elements.saveRequestNameInput.value = defaultName || '';
            elements.saveRequestNameInput.removeAttribute('aria-invalid');
            elements.saveRequestNameInput.focus();
            return new Promise((resolve) => {
                saveModalResolver = resolve;
            });
        };

        const promptForRequestName = async (defaultName) => {
            if (elements.saveRequestModal && elements.saveRequestNameInput) {
                return openSaveModal(defaultName ?? 'New Request');
            }
            const response = window.prompt('Enter a name for the request:', defaultName ?? 'New Request');
            return response === null ? null : response.trim();
        };

        const parseUrlIntoState = (url) => {
            const [base, query = ''] = url.split('?');
            state.urlBase = base || '';
            const params = [];
            if (query) {
                query.split('&')
                    .filter(Boolean)
                    .forEach((segment) => {
                        const [rawKey, rawValue = ''] = segment.split('=');
                        const key = decodeURIComponent(rawKey || '');
                        const value = decodeURIComponent(rawValue);
                        params.push({ key, value, description: '' });
                    });
            }
            state.builder.params = params;
        };

        const applyParamsToUrl = () => {
            const base = state.urlBase || '';
            const query = rowsToQueryString(state.builder.params);
            const combined = query ? `${base}?${query}` : base;
            suppressUrlSync = true;
            elements.url.value = combined;
            suppressUrlSync = false;
            updateRunButtonState();
        };

        const ensureHeadersRendered = () => {
            if (!state.builder.headers.length) {
                state.builder.headers = cloneDefaultHeaders();
            }
        };

        const activateTab = (tabName) => {
            if (!tabButtons.length || !tabPanels.length) {
                return;
            }
            const target = tabName || 'params';
            state.activeTab = target;
            tabButtons.forEach((button) => {
                const isActive = button.dataset.tab === target;
                button.classList.toggle('is-active', isActive);
                button.setAttribute('aria-selected', isActive ? 'true' : 'false');
                button.setAttribute('tabindex', isActive ? '0' : '-1');
            });
            tabPanels.forEach((panel) => {
                const isActive = panel.dataset.tabPanel === target;
                panel.hidden = !isActive;
                panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
            });
            if (target === 'body') {
                refreshRawEditor();
            }
        };

        const getScriptPlaceholder = (key) => SCRIPT_PLACEHOLDERS[key] || '';

        const ensureScriptPlaceholder = (key) => {
            const container = scriptEditorContainers[key];
            if (container) {
                container.setAttribute('data-placeholder', getScriptPlaceholder(key));
            }
        };

        const updateScriptEmptyState = (key, value) => {
            const container = scriptEditorContainers[key];
            if (container) {
                container.classList.toggle('is-empty', !(value && value.trim()));
            }
        };

        const setScriptEditorValue = (key, value) => {
            ensureScriptPlaceholder(key);
            const normalized = value ?? '';
            state.builder.scripts[key] = normalized;
            const editor = scriptEditors[key];
            if (editor && editor.getValue() !== normalized) {
                editor.setValue(normalized);
            }
            const fallback = scriptFallbacks[key];
            if (fallback && fallback.value !== normalized) {
                fallback.value = normalized;
            }
            updateScriptEmptyState(key, normalized);
        };

        const focusScriptEditor = (key) => {
            const editor = scriptEditors[key];
            if (editor && typeof editor.focus === 'function') {
                editor.focus();
                return;
            }
            const fallback = scriptFallbacks[key];
            if (fallback && typeof fallback.focus === 'function') {
                fallback.focus();
            }
        };

        const initializeScriptEditor = (key) => {
            ensureScriptPlaceholder(key);
            const container = scriptEditorContainers[key];
            if (!container) {
                return Promise.resolve(null);
            }
            if (scriptEditors[key]) {
                updateScriptEmptyState(key, scriptEditors[key].getValue());
                return Promise.resolve(scriptEditors[key]);
            }
            return ensureMonaco()
                .then((monaco) => {
                    if (scriptEditors[key]) {
                        return scriptEditors[key];
                    }
                    const initialValue = state.builder.scripts[key] || '';
                    const editor = monaco.editor.create(container, {
                        value: initialValue,
                        language: 'javascript',
                        automaticLayout: true,
                        minimap: { enabled: false },
                        fontSize: 14,
                        fontFamily: 'ui-monospace, Consolas, Menlo, monospace',
                        lineNumbers: 'on',
                        wordWrap: 'on',
                        tabSize: 2,
                        insertSpaces: true,
                        smoothScrolling: true,
                    });
                    scriptEditors[key] = editor;

                    const togglePlaceholder = () => {
                        updateScriptEmptyState(key, editor.getValue());
                    };

                    togglePlaceholder();

                    editor.onDidChangeModelContent(() => {
                        const nextValue = editor.getValue();
                        state.builder.scripts[key] = nextValue;
                        togglePlaceholder();
                    });

                    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => {
                        const formatAction = editor.getAction('editor.action.formatDocument');
                        if (formatAction && typeof formatAction.run === 'function') {
                            formatAction.run().catch(() => {});
                        }
                    });

                    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space, () => {
                        monaco.commands.executeCommand('editor.action.triggerSuggest');
                    });

                    return editor;
                })
                .catch(() => {
                    if (scriptFallbacks[key]) {
                        return scriptFallbacks[key];
                    }
                    container.innerHTML = '';
                    const textarea = document.createElement('textarea');
                    textarea.className = 'script-textarea-fallback';
                    textarea.rows = 8;
                    textarea.placeholder = getScriptPlaceholder(key);
                    textarea.value = state.builder.scripts[key] || '';
                    textarea.addEventListener('input', (event) => {
                        const nextValue = event.target.value;
                        state.builder.scripts[key] = nextValue;
                        updateScriptEmptyState(key, nextValue);
                    });
                    container.appendChild(textarea);
                    scriptFallbacks[key] = textarea;
                    updateScriptEmptyState(key, textarea.value);
                    return textarea;
                });
        };

        const activateScriptsTab = (tabName, options = {}) => {
            if (!scriptTabButtons.length || !scriptPanels.length) {
                return;
            }
            const target = tabName || 'pre';
            const shouldFocus = Boolean(options.focus);
            state.activeScriptsTab = target;
            scriptTabButtons.forEach((button) => {
                const isActive = button.dataset.scriptTab === target;
                button.classList.toggle('is-active', isActive);
                button.setAttribute('aria-selected', isActive ? 'true' : 'false');
                button.setAttribute('tabindex', isActive ? '0' : '-1');
            });
            scriptPanels.forEach((panel) => {
                const isActive = panel.dataset.scriptPanel === target;
                panel.classList.toggle('is-active', isActive);
                panel.hidden = !isActive;
                panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
            });
            initializeScriptEditor(target).then(() => {
                if (shouldFocus) {
                    window.requestAnimationFrame(() => focusScriptEditor(target));
                }
            });
        };

        const renderKeyValueRows = (tbody, rows, options) => {
            const { showDescription = false, emptyMessage = 'No rows yet.' } = options;
            if (!rows.length) {
                tbody.innerHTML = `<tr class="empty"><td colspan="${showDescription ? 4 : 3}" class="muted">${emptyMessage}</td></tr>`;
                return;
            }
            const markup = rows
                .map((row, index) => {
                    const descriptionCell = showDescription
                        ? `<td><input type="text" class="kv-input" data-index="${index}" data-field="description" placeholder="Description" value="${escapeHtml(row.description || '')}" /></td>`
                        : '';
                    return `<tr>
                        <td><input type="text" class="kv-input" data-index="${index}" data-field="key" placeholder="Key" value="${escapeHtml(row.key || '')}" /></td>
                        <td><input type="text" class="kv-input" data-index="${index}" data-field="value" placeholder="Value" value="${escapeHtml(row.value || '')}" /></td>
                        ${descriptionCell}
                        <td class="kv-actions"><button type="button" class="kv-remove" data-index="${index}" aria-label="Remove row">×</button></td>
                    </tr>`;
                })
                .join('');
            tbody.innerHTML = markup;
        };

        const renderParams = () => {
            renderKeyValueRows(elements.paramsBody, state.builder.params, {
                showDescription: true,
                emptyMessage: 'No query parameters defined.',
            });
        };

        const renderHeaders = () => {
            ensureHeadersRendered();
            renderKeyValueRows(elements.headersBody, state.builder.headers, {
                showDescription: false,
                emptyMessage: 'No headers defined. Add one below.',
            });
        };

        const applyRawTypeSettings = (type, { ensureTemplate = false } = {}) => {
            const placeholder = RAW_TYPE_PLACEHOLDERS[type] || '';
            setRawPlaceholder(placeholder);

            if (rawEditor && window.monaco && typeof rawEditor.getModel === 'function') {
                const languageId = RAW_TYPE_MONACO_LANG[type] || 'plaintext';
                const model = rawEditor.getModel();
                if (model && window.monaco.editor && typeof window.monaco.editor.setModelLanguage === 'function') {
                    window.monaco.editor.setModelLanguage(model, languageId);
                }
                rawEditor.updateOptions({
                    wordWrap: 'on',
                    tabSize: 2,
                    insertSpaces: true,
                    autoClosingBrackets: type === 'json' || type === 'javascript' ? 'always' : 'languageDefined',
                    autoClosingQuotes: 'always',
                    quickSuggestions: type === 'json',
                });

                const jsonApi = window.monaco.languages && window.monaco.languages.json;
                if (type === 'json' && jsonApi) {
                    if (!hasConfiguredJsonDiagnostics && jsonApi.jsonDefaults && typeof jsonApi.jsonDefaults.setDiagnosticsOptions === 'function') {
                        jsonApi.jsonDefaults.setDiagnosticsOptions({
                            validate: true,
                            allowComments: true,
                            trailingCommas: 'warning',
                        });
                        hasConfiguredJsonDiagnostics = true;
                    }
                    if (!jsonCompletionDisposable && typeof window.monaco.languages.registerCompletionItemProvider === 'function') {
                        jsonCompletionDisposable = window.monaco.languages.registerCompletionItemProvider('json', {
                            triggerCharacters: ['"'],
                            provideCompletionItems(model, position) {
                                const text = model.getValue();
                                const word = model.getWordUntilPosition(position);
                                const range = new window.monaco.Range(
                                    position.lineNumber,
                                    word.startColumn,
                                    position.lineNumber,
                                    word.endColumn,
                                );
                                const suggestions = getJsonCompletions(text, word.word).map((item) => ({
                                    label: item,
                                    insertText: item,
                                    kind: window.monaco.languages.CompletionItemKind.EnumMember,
                                    range,
                                }));
                                return { suggestions };
                            },
                        });
                    }
                } else if (jsonCompletionDisposable) {
                    jsonCompletionDisposable.dispose();
                    jsonCompletionDisposable = null;
                }
            }

            if (type === 'json' && ensureTemplate) {
                const current = getRawEditorValue();
                if (!current.trim() && placeholder) {
                    setRawEditorValue(placeholder);
                    state.builder.bodyRawText = placeholder;
                }
            }

            refreshRawEditor();
        };

        const formatRawTextForType = (type) => {
            if (type !== 'json') {
                return;
            }
            const current = getRawEditorValue();
            if (!current || !current.trim()) {
                return;
            }
            let handledByEditor = false;
            if (rawEditor && typeof rawEditor.getAction === 'function') {
                const formatAction = rawEditor.getAction('editor.action.formatDocument');
                if (formatAction && typeof formatAction.run === 'function') {
                    formatAction.run().catch(() => {});
                    handledByEditor = true;
                }
            }
            if (handledByEditor) {
                return;
            }
            try {
                const formatted = JSON.stringify(JSON.parse(current), null, 2);
                setRawEditorValue(formatted);
                state.builder.bodyRawText = formatted;
                refreshRawEditor();
            } catch (error) {
                // Ignore formatting errors; user input remains untouched.
            }
        };

        const ensureMonaco = () => {
            if (window.monaco) {
                return Promise.resolve(window.monaco);
            }
            if (!window.require) {
                return Promise.reject(new Error('Monaco loader not available'));
            }
            if (!monacoLoaderPromise) {
                monacoLoaderPromise = new Promise((resolve, reject) => {
                    try {
                        window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
                    } catch (error) {
                        reject(error);
                    }
                });
            }
            return monacoLoaderPromise;
        };

        const initializeRawEditor = () => {
            if (!elements.bodyRawContainer) {
                return;
            }

            ensureMonaco()
                .then((monaco) => {
                    if (rawEditor) {
                        return;
                    }
                    const initialValue = state.builder.bodyRawText || '';
                    rawEditor = monaco.editor.create(elements.bodyRawContainer, {
                        value: initialValue,
                        language: RAW_TYPE_MONACO_LANG[state.builder.bodyRawType] || 'plaintext',
                        automaticLayout: true,
                        minimap: { enabled: false },
                        fontSize: 14,
                        fontFamily: 'ui-monospace, Consolas, Menlo, monospace',
                        lineNumbers: 'on',
                        wordWrap: 'on',
                        tabSize: 2,
                        insertSpaces: true,
                        smoothScrolling: true,
                    });

                    const togglePlaceholder = () => {
                        const content = rawEditor.getValue();
                        if (!content.trim()) {
                            elements.bodyRawContainer.classList.add('is-empty');
                        } else {
                            elements.bodyRawContainer.classList.remove('is-empty');
                        }
                    };

                    togglePlaceholder();

                    rawEditor.onDidChangeModelContent(() => {
                        state.builder.bodyRawText = rawEditor.getValue();
                        togglePlaceholder();
                    });

                    rawEditor.onDidBlurEditorWidget(() => {
                        if (state.builder.bodyRawType === 'json') {
                            formatRawTextForType('json');
                        }
                    });

                    rawEditor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => {
                        formatRawTextForType(state.builder.bodyRawType);
                    });

                    rawEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space, () => {
                        if (state.builder.bodyRawType === 'json') {
                            monaco.commands.executeCommand('editor.action.triggerSuggest');
                        }
                    });

                    applyRawTypeSettings(state.builder.bodyRawType, { ensureTemplate: true });
                    refreshRawEditor();
                })
                .catch(() => {
                    const fallbackPlaceholder = escapeHtml(RAW_TYPE_PLACEHOLDERS[state.builder.bodyRawType] || '');
                    elements.bodyRawContainer.innerHTML = `<textarea class="api-raw-fallback" rows="6" placeholder="${fallbackPlaceholder}"></textarea>`;
                    const fallback = elements.bodyRawContainer.querySelector('textarea');
                    if (fallback) {
                        fallback.value = state.builder.bodyRawText || '';
                        state.builder.bodyRawText = fallback.value;
                    }
                    applyRawTypeSettings(state.builder.bodyRawType);
                });
        };

        initializeRawEditor();

        const renderBodyFormData = () => {
            const rows = state.builder.bodyFormData;
            if (!rows.length) {
                elements.bodyFormBody.innerHTML = '<tr class="empty"><td colspan="4" class="muted">No form-data entries.</td></tr>';
                return;
            }

            const formatFileSize = (size) => {
                const value = Number(size);
                if (!Number.isFinite(value) || value <= 0) {
                    return '';
                }
                if (value < 1024) {
                    return `${value} B`;
                }
                if (value < 1048576) {
                    return `${(value / 1024).toFixed(1)} KB`;
                }
                return `${(value / 1048576).toFixed(1)} MB`;
            };

            const markup = rows
                .map((row, index) => {
                    const keyInput = `<input type="text" class="kv-input" data-index="${index}" data-field="key" placeholder="Key" value="${escapeHtml(row.key || '')}" />`;
                    const typeSelect = `<select class="kv-input form-data-type" data-index="${index}" data-field="type">
                            <option value="text"${row.type === 'text' ? ' selected' : ''}>Text</option>
                            <option value="file"${row.type === 'file' ? ' selected' : ''}>File</option>
                        </select>`;
                    const textControl = `<input type="text" class="kv-input form-data-value-input" data-index="${index}" data-field="value" placeholder="Value" value="${escapeHtml(row.value || '')}" />`;
                    const fileSizeText = formatFileSize(row.fileSize);
                    const fileSizeLabel = fileSizeText ? ` (${fileSizeText})` : '';
                    const fileControl = `<div class="form-data-file-control">
                            <label class="form-data-file-button">Choose File
                                <input type="file" class="form-data-file-input" data-index="${index}" />
                            </label>
                            <span class="form-data-file-name">${row.fileName ? `${escapeHtml(row.fileName)}${fileSizeLabel}` : 'No file selected'}</span>
                            ${row.fileData ? `<button type="button" class="form-data-file-clear" data-index="${index}">Remove</button>` : ''}
                        </div>`;
                    const valueMarkup = row.type === 'file' ? fileControl : textControl;

                    return `<tr>
                            <td>${keyInput}</td>
                            <td class="form-data-type-cell">${typeSelect}</td>
                            <td>
                                <div class="form-data-value">
                                    ${valueMarkup}
                                </div>
                            </td>
                            <td class="kv-actions"><button type="button" class="kv-remove" data-index="${index}" aria-label="Remove row">×</button></td>
                        </tr>`;
                })
                .join('');

            elements.bodyFormBody.innerHTML = markup;
        };

        const renderBodyUrlencoded = () => {
            renderKeyValueRows(elements.bodyUrlencodedBody, state.builder.bodyUrlEncoded, {
                showDescription: false,
                emptyMessage: 'No x-www-form-urlencoded entries.',
            });
        };

        const updateAuthUI = () => {
            const { type, username, password, token } = state.builder.auth;
            elements.authType.value = type;
            elements.authSections.forEach((section) => {
                const isMatch = section.dataset.authSection === type;
                section.hidden = !isMatch;
                if (isMatch) {
                    section.removeAttribute('aria-hidden');
                } else {
                    section.setAttribute('aria-hidden', 'true');
                }
            });
            elements.authBasicUsername.value = username;
            elements.authBasicPassword.value = password;
            elements.authBearerToken.value = token;
        };

        const updateBodyUI = () => {
            const { bodyMode, bodyRawType, bodyRawText, bodyBinary } = state.builder;
            elements.bodyModeRadios.forEach((radio) => {
                radio.checked = radio.value === bodyMode;
            });
            elements.bodyPanels.forEach((panel) => {
                const shouldShow = panel.dataset.bodyPanel === bodyMode;
                panel.hidden = !shouldShow;
            });
            elements.bodyRawType.value = bodyRawType;
            setRawEditorValue(bodyRawText || '');
            applyRawTypeSettings(bodyRawType);
            formatRawTextForType(bodyRawType);
            if (bodyMode === 'raw') {
                refreshRawEditor();
            }
            if (bodyBinary && bodyBinary.name) {
                const sizeKb = Math.round(bodyBinary.size / 1024);
                elements.bodyBinaryInfo.textContent = `${bodyBinary.name} (${sizeKb} KB)`;
            } else {
                elements.bodyBinaryInfo.textContent = 'No file selected.';
            }
            renderBodyFormData();
            renderBodyUrlencoded();
        };

        const updateScriptsUI = () => {
            setScriptEditorValue('pre', state.builder.scripts.pre);
            setScriptEditorValue('post', state.builder.scripts.post);
            activateScriptsTab(state.activeScriptsTab || 'pre');
        };

        const renderBuilder = () => {
            renderParams();
            renderHeaders();
            updateAuthUI();
            updateBodyUI();
            updateScriptsUI();
            activateTab(state.activeTab || 'params');
            updateRunButtonState();
        };

        const resetBuilderState = () => {
            state.builder = getInitialBuilderState();
            state.activeScriptsTab = 'pre';
        };

        const setUrlValue = (value, parseParams = true) => {
            suppressUrlSync = true;
            elements.url.value = value || '';
            suppressUrlSync = false;
            if (parseParams) {
                parseUrlIntoState(value || '');
            }
            updateRunButtonState();
        };

        const populateForm = (collection, request) => {
            resetBuilderState();
            if (!request) {
                setUrlValue('', true);
                elements.method.value = 'GET';
                if (elements.runCollectionButton) {
                    elements.runCollectionButton.disabled = !collection;
                }
                elements.builderMeta.textContent = 'Select a request to preview details.';
                state.builder.params = [];
                renderBuilder();
                return;
            }

            elements.method.value = request.method || 'GET';
            setUrlValue(request.url || '', true);
            state.builder.params = state.builder.params || [];
            mergeObjectIntoRows(state.builder.params, request.query_params || {}, true);
            state.builder.headers = objectToRows(request.headers || {});
            ensureHeadersRendered();

            const bodyType = (request.body_type || 'none').toLowerCase();
            state.builder.bodyMode = bodyType;
            if (bodyType === 'json') {
                state.builder.bodyMode = 'raw';
                state.builder.bodyRawType = 'json';
                state.builder.bodyRawText = JSON.stringify(request.body_json || {}, null, 2);
            } else if (bodyType === 'form') {
                state.builder.bodyMode = 'form-data';
                state.builder.bodyFormData = normalizeFormDataRows(request.body_form);
            } else if (bodyType === 'raw') {
                state.builder.bodyMode = 'raw';
                state.builder.bodyRawType = 'text';
                state.builder.bodyRawText = request.body_raw || '';
            } else {
                state.builder.bodyMode = 'none';
            }

            const authType = (request.auth_type || 'none').toLowerCase();
            state.builder.auth.type = authType;
            if (authType === 'basic') {
                state.builder.auth.username = request.auth_basic?.username || '';
                state.builder.auth.password = request.auth_basic?.password || '';
            } else if (authType === 'bearer') {
                state.builder.auth.token = request.auth_bearer || '';
            }

            state.builder.scripts.pre = request.pre_request_script || '';
            state.builder.scripts.post = request.tests_script || '';

            if (elements.runCollectionButton) {
                elements.runCollectionButton.disabled = false;
            }

            const requestLabel = `${request.method} ${request.name}`;
            const environmentLabels = (collection.environments || []).map((env) => env.name).join(', ') || 'No linked environments';
            elements.builderMeta.textContent = `${collection.name} · ${requestLabel} · ${environmentLabels}`;

            renderBuilder();
            applyParamsToUrl();
            updateRunButtonState();
        };

        const startNewRequestDraft = (collection, directoryId = null) => {
            if (!collection) {
                setStatus('Select a collection before creating a request.', 'error');
                return;
            }
            state.selectedCollectionId = collection.id;
            state.selectedRequestId = null;
            state.selectedDirectoryId = directoryId ?? null;
            renderEnvironmentOptions(collection);
            populateForm(collection, null);
            if (directoryId !== null) {
                const directory = collection.directories?.find((item) => item.id === directoryId) || null;
                const directoryLabel = directory ? ` · ${directory.name}` : '';
                elements.builderMeta.textContent = `${collection.name}${directoryLabel} · New request`;
            } else {
                elements.builderMeta.textContent = `${collection.name} · New request`;
            }
            highlightSelection();
            setStatus('Draft ready. Configure the request and press Save.', 'neutral');
        };

        const updateCardCollapseState = (card, collapsed) => {
            if (!card) {
                return;
            }
            card.classList.toggle('is-collapsed', collapsed);
            const body = card.querySelector('.collection-body');
            if (body) {
                body.hidden = collapsed;
                body.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
            }
            const toggle = card.querySelector('.collection-toggle');
            if (toggle) {
                toggle.setAttribute('aria-expanded', String(!collapsed));
            }
            const indicator = card.querySelector('.collection-toggle-indicator');
            if (indicator) {
                indicator.textContent = '>';
            }
        };

        const updateCollectionActionState = () => {
            if (elements.createRequestButton) {
                elements.createRequestButton.disabled = state.selectedCollectionId === null;
            }
        };

        const closeCollectionsActionMenu = () => {
            if (!state.isCollectionsActionMenuOpen) {
                return;
            }
            if (elements.collectionsActionsMenu) {
                elements.collectionsActionsMenu.hidden = true;
            }
            if (elements.collectionsActionsToggle) {
                elements.collectionsActionsToggle.setAttribute('aria-expanded', 'false');
            }
            state.isCollectionsActionMenuOpen = false;
        };

        const openCollectionsActionMenu = () => {
            if (!elements.collectionsActionsMenu || !elements.collectionsActionsToggle) {
                return;
            }
            elements.collectionsActionsMenu.hidden = false;
            elements.collectionsActionsToggle.setAttribute('aria-expanded', 'true');
            state.isCollectionsActionMenuOpen = true;
        };

        const getCurrentFilterText = () => (elements.search ? elements.search.value || '' : '');

        const hideMenuForCollection = (collectionId) => {
            if (!elements.collectionsList || collectionId === null || collectionId === undefined) {
                return;
            }
            const card = elements.collectionsList.querySelector(`.collection-card[data-collection-id="${collectionId}"]`);
            if (!card) {
                return;
            }
            const menu = card.querySelector('.collection-menu');
            const menuToggle = card.querySelector('.collection-menu-toggle');
            if (menu) {
                menu.hidden = true;
            }
            if (menuToggle) {
                menuToggle.setAttribute('aria-expanded', 'false');
            }
        };

        const buildDirectoryMenuKey = (collectionId, directoryId) => `${collectionId}:${directoryId}`;

        const hideMenuForDirectory = (collectionId, directoryId) => {
            if (!elements.collectionsList) {
                return;
            }
            if (collectionId === null || collectionId === undefined) {
                return;
            }
            if (directoryId === null || directoryId === undefined) {
                return;
            }
            const card = elements.collectionsList.querySelector(`.collection-card[data-collection-id="${collectionId}"]`);
            if (!card) {
                return;
            }
            const directoryNode = card.querySelector(`.directory-item[data-directory-id="${directoryId}"]`);
            if (!directoryNode) {
                return;
            }
            const menu = directoryNode.querySelector('.directory-menu');
            const menuToggle = directoryNode.querySelector('.directory-menu-toggle');
            if (menu) {
                menu.hidden = true;
            }
            if (menuToggle) {
                menuToggle.setAttribute('aria-expanded', 'false');
            }
        };

        const buildRequestMenuKey = (collectionId, requestId) => `${collectionId}:${requestId}`;

        const hideMenuForRequest = (collectionId, requestId) => {
            if (!elements.collectionsList) {
                return;
            }
            if (collectionId === null || collectionId === undefined) {
                return;
            }
            if (requestId === null || requestId === undefined) {
                return;
            }
            const card = elements.collectionsList.querySelector(`.collection-card[data-collection-id="${collectionId}"]`);
            if (!card) {
                return;
            }
            const requestNode = card.querySelector(`.request-item[data-request-id="${requestId}"]`);
            if (!requestNode) {
                return;
            }
            const menu = requestNode.querySelector('.request-menu');
            const menuToggle = requestNode.querySelector('.request-menu-toggle');
            if (menu) {
                menu.hidden = true;
            }
            if (menuToggle) {
                menuToggle.setAttribute('aria-expanded', 'false');
            }
        };

        const closeRequestMenu = () => {
            const key = state.openRequestMenuKey;
            if (!key) {
                return;
            }
            const parts = key.split(':');
            const collectionId = Number(parts[0]);
            const requestId = Number(parts[1]);
            if (!Number.isNaN(collectionId) && !Number.isNaN(requestId)) {
                hideMenuForRequest(collectionId, requestId);
            }
            state.openRequestMenuKey = null;
        };

        const closeDirectoryMenu = () => {
            const key = state.openDirectoryMenuKey;
            if (!key) {
                return;
            }
            const parts = key.split(':');
            const collectionId = Number(parts[0]);
            const directoryId = Number(parts[1]);
            if (!Number.isNaN(collectionId) && !Number.isNaN(directoryId)) {
                hideMenuForDirectory(collectionId, directoryId);
            }
            state.openDirectoryMenuKey = null;
        };

        const closeCollectionMenu = () => {
            closeCollectionsActionMenu();
            if (state.openCollectionMenuId === null) {
                return;
            }
            hideMenuForCollection(state.openCollectionMenuId);
            state.openCollectionMenuId = null;
            closeDirectoryMenu();
            closeRequestMenu();
        };

        const cancelDragState = () => {
            const drag = state.dragState;
            if (!drag) {
                return;
            }
            if (drag.placeholder?.parentNode) {
                drag.placeholder.parentNode.removeChild(drag.placeholder);
            }
            if (drag.sourceElement) {
                drag.sourceElement.classList.remove('is-dragging');
            }
            state.dragState = null;
        };

        const applyDirectoryCollapse = (directoryItem, toggleButton, collapsed) => {
            if (!directoryItem || !toggleButton) {
                return;
            }
            directoryItem.classList.toggle('is-collapsed', collapsed);
            toggleButton.setAttribute('aria-expanded', String(!collapsed));
            const icon = collapsed ? '>' : 'v';
            toggleButton.innerHTML = `<span aria-hidden="true">${icon}</span>`;
            const name = directoryItem.dataset.directoryName || 'folder';
            toggleButton.setAttribute('title', `${collapsed ? 'Expand' : 'Collapse'} ${name}`);
            toggleButton.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${name}`);
        };

        const createDragPlaceholder = (type) => {
            if (type === 'request') {
                const placeholder = document.createElement('li');
                placeholder.className = 'drag-placeholder drag-placeholder--request';
                placeholder.setAttribute('aria-hidden', 'true');
                return placeholder;
            }
            const placeholder = document.createElement('div');
            placeholder.className = 'drag-placeholder drag-placeholder--directory';
            placeholder.setAttribute('aria-hidden', 'true');
            return placeholder;
        };

        const positionDragPlaceholder = (container, referenceElement, before = true) => {
            const drag = state.dragState;
            if (!drag) {
                return;
            }
            if (!drag.placeholder) {
                drag.placeholder = createDragPlaceholder(drag.type);
            }
            const placeholder = drag.placeholder;
            if (!placeholder) {
                return;
            }
            if (placeholder.parentNode && placeholder.parentNode !== container) {
                placeholder.parentNode.removeChild(placeholder);
            }
            if (!placeholder.parentNode) {
                container.appendChild(placeholder);
            }
            if (referenceElement) {
                if (before) {
                    container.insertBefore(placeholder, referenceElement);
                } else if (referenceElement.nextSibling) {
                    container.insertBefore(placeholder, referenceElement.nextSibling);
                } else {
                    container.appendChild(placeholder);
                }
            } else {
                if (before) {
                    container.insertBefore(placeholder, container.firstChild);
                } else {
                    container.appendChild(placeholder);
                }
            }
            drag.targetContainer = container;
        };

        const positionPlaceholderByPoint = (container, clientY, selector) => {
            if (!container) {
                return;
            }
            const elements = Array.from(container.children).filter((node) =>
                node.nodeType === Node.ELEMENT_NODE && node.matches(selector)
            );
            if (!elements.length) {
                positionDragPlaceholder(container, null, false);
                return;
            }
            for (const element of elements) {
                const rect = element.getBoundingClientRect();
                const midpoint = rect.top + rect.height / 2;
                if (clientY < midpoint) {
                    positionDragPlaceholder(container, element, true);
                    return;
                }
            }
            positionDragPlaceholder(container, null, false);
        };

        const getRequestContainerMeta = (container) => {
            if (!container) {
                return { collectionId: null, directoryId: null };
            }
            const collectionAttr = container.dataset.collectionId;
            const directoryAttr = container.dataset.directoryId;
            const collectionId = collectionAttr ? Number(collectionAttr) : null;
            const directoryId = directoryAttr === '' ? null : Number(directoryAttr);
            return { collectionId, directoryId: Number.isNaN(directoryId) ? null : directoryId };
        };

        const getDirectoryContainerMeta = (container) => {
            if (!container) {
                return { collectionId: null, parentId: null };
            }
            const collectionAttr = container.dataset.collectionId;
            const parentAttr = container.dataset.parentId;
            const collectionId = collectionAttr ? Number(collectionAttr) : null;
            const parentId = parentAttr === '' ? null : Number(parentAttr);
            return { collectionId, parentId: Number.isNaN(parentId) ? null : parentId };
        };

        const beginRequestDrag = (event, { element, container, requestId, directoryId, collectionId }) => {
            if (!event.dataTransfer) {
                return;
            }
            closeCollectionMenu();
            closeDirectoryMenu();
            closeRequestMenu();
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', 'request');
            const initialOrder = Array.from(container.querySelectorAll('.request-item')).map((item) => Number(item.dataset.requestId));
            state.dragState = {
                type: 'request',
                sourceId: requestId,
                parentId: directoryId ?? null,
                collectionId,
                sourceElement: element,
                originContainer: container,
                targetContainer: container,
                placeholder: null,
                initialOrder,
            };
            element.classList.add('is-dragging');
        };

        const handleRequestDragOver = (event, targetElement, parentDirectoryId, collectionId) => {
            const drag = state.dragState;
            if (!drag || drag.type !== 'request') {
                return;
            }
            if (drag.collectionId !== collectionId) {
                return;
            }
            const container = targetElement.parentElement;
            if (!container) {
                return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            positionPlaceholderByPoint(container, event.clientY, '.request-item');
        };

        const handleRequestContainerDragOver = (event, container) => {
            const drag = state.dragState;
            if (!drag || drag.type !== 'request') {
                return;
            }
            const { collectionId, directoryId } = getRequestContainerMeta(container);
            if (drag.collectionId !== collectionId) {
                return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            positionPlaceholderByPoint(container, event.clientY, '.request-item');
        };

        const completeRequestDrop = async (container) => {
            const drag = state.dragState;
            if (!drag || drag.type !== 'request') {
                return;
            }
            const placeholder = drag.placeholder;
            const sourceElement = drag.sourceElement;
            const targetContainer = drag.targetContainer || container;
            const { directoryId: targetDirectoryRaw } = getRequestContainerMeta(targetContainer);
            if (placeholder && placeholder.parentNode && sourceElement) {
                placeholder.parentNode.insertBefore(sourceElement, placeholder);
            }
            if (placeholder && placeholder.parentNode) {
                placeholder.parentNode.removeChild(placeholder);
            }
            if (sourceElement) {
                sourceElement.classList.remove('is-dragging');
            }
            const targetDirectoryId = targetDirectoryRaw ?? null;
            const originContainer = drag.originContainer;
            const sameContainer = originContainer === targetContainer;
            const targetOrderedIds = Array.from(targetContainer.querySelectorAll('.request-item')).map((item) => Number(item.dataset.requestId));
            const remainingIds = !sameContainer && originContainer
                ? Array.from(originContainer.querySelectorAll('.request-item')).map((item) => Number(item.dataset.requestId))
                : null;

            targetContainer.classList.toggle('request-list--empty', targetOrderedIds.length === 0);
            const targetMeta = getRequestContainerMeta(targetContainer);
            if (targetMeta.directoryId !== null) {
                targetContainer.hidden = targetOrderedIds.length === 0;
            }
            if (!sameContainer && originContainer) {
                originContainer.classList.toggle('request-list--empty', !remainingIds || remainingIds.length === 0);
                const originMeta = getRequestContainerMeta(originContainer);
                if (originMeta.directoryId !== null) {
                    originContainer.hidden = !remainingIds || remainingIds.length === 0;
                }
            }
            const hasChanged = sameContainer
                ? (targetOrderedIds.length === drag.initialOrder.length
                    ? targetOrderedIds.some((id, index) => id !== drag.initialOrder[index])
                    : true)
                : true;
            state.dragState = null;
            if (!hasChanged) {
                return;
            }
            const movesDirectory = targetDirectoryId !== drag.parentId;
            const actionLabel = movesDirectory ? 'Moving request...' : 'Updating request order...';
            setStatus(actionLabel, 'loading');
            try {
                if (movesDirectory) {
                    await updateRequestDirectory({
                        requestId: drag.sourceId,
                        directoryId: targetDirectoryId,
                    });
                }
                await reorderRequests({
                    collectionId: drag.collectionId,
                    directoryId: targetDirectoryId,
                    orderedIds: targetOrderedIds,
                });

                if (movesDirectory && originContainer && originContainer !== targetContainer && remainingIds) {
                    if (remainingIds.length) {
                        await reorderRequests({
                            collectionId: drag.collectionId,
                            directoryId: drag.parentId,
                            orderedIds: remainingIds,
                        });
                    }
                }
                await refreshCollections({
                    preserveSelection: true,
                    focusCollectionId: drag.collectionId,
                    focusDirectoryId: targetDirectoryId,
                    focusRequestId: drag.sourceId,
                });
                setStatus(movesDirectory ? 'Request moved successfully.' : 'Request order updated.', 'success');
            } catch (error) {
                setStatus(error instanceof Error ? error.message : 'Failed to update request order.', 'error');
            }
        };

        const beginDirectoryDrag = (event, { element, parentId, collectionId, container, directoryId }) => {
            if (!event.dataTransfer) {
                return;
            }
            closeCollectionMenu();
            closeDirectoryMenu();
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', 'directory');
            const siblings = Array.from(container.children).filter((node) => node.classList && node.classList.contains('directory-item'));
            const initialOrder = siblings.map((node) => Number(node.dataset.directoryId));
            state.dragState = {
                type: 'directory',
                sourceId: directoryId,
                parentId: parentId ?? null,
                collectionId,
                sourceElement: element,
                originContainer: container,
                targetContainer: container,
                placeholder: null,
                initialOrder,
            };
            element.classList.add('is-dragging');
        };

        const handleDirectoryDragOver = (event, targetElement, collectionId) => {
            const drag = state.dragState;
            if (!drag || drag.type !== 'directory') {
                return;
            }
            if (drag.collectionId !== collectionId) {
                return;
            }
            const container = targetElement.parentElement;
            if (!container) {
                return;
            }
            const { parentId } = getDirectoryContainerMeta(container);
            const normalizedParent = parentId ?? null;
            if (drag.parentId !== normalizedParent) {
                return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            positionPlaceholderByPoint(container, event.clientY, '.directory-item');
        };

        const handleDirectoryContainerDragOver = (event, container) => {
            const drag = state.dragState;
            if (!drag || drag.type !== 'directory') {
                return;
            }
            const { collectionId, parentId } = getDirectoryContainerMeta(container);
            if (drag.collectionId !== collectionId) {
                return;
            }
            const normalizedParent = parentId ?? null;
            if (drag.parentId !== normalizedParent) {
                return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            positionPlaceholderByPoint(container, event.clientY, '.directory-item');
        };

        const completeDirectoryDrop = async (container) => {
            const drag = state.dragState;
            if (!drag || drag.type !== 'directory') {
                return;
            }
            const placeholder = drag.placeholder;
            const sourceElement = drag.sourceElement;
            const targetContainer = drag.targetContainer || container;
            const { parentId } = getDirectoryContainerMeta(targetContainer);
            if (placeholder && placeholder.parentNode && sourceElement) {
                placeholder.parentNode.insertBefore(sourceElement, placeholder);
            }
            if (placeholder && placeholder.parentNode) {
                placeholder.parentNode.removeChild(placeholder);
            }
            if (sourceElement) {
                sourceElement.classList.remove('is-dragging');
            }
            const orderedIds = Array.from(targetContainer.children)
                .filter((node) => node.classList && node.classList.contains('directory-item'))
                .map((node) => Number(node.dataset.directoryId));
            const hasChanged = orderedIds.length === drag.initialOrder.length
                ? orderedIds.some((id, index) => id !== drag.initialOrder[index])
                : true;
            state.dragState = null;
            if (!hasChanged) {
                return;
            }
            setStatus('Updating folder order...', 'loading');
            try {
                await reorderDirectories({
                    collectionId: drag.collectionId,
                    parentId: drag.parentId,
                    orderedIds,
                });
                await refreshCollections({
                    preserveSelection: true,
                    focusCollectionId: drag.collectionId,
                    focusDirectoryId: drag.sourceId,
                    focusRequestId: state.selectedRequestId,
                });
                setStatus('Folder order updated.', 'success');
            } catch (error) {
                setStatus(error instanceof Error ? error.message : 'Failed to reorder folder.', 'error');
            }
        };

        const setupRequestContainerDrag = (container, parentDirectoryId, collection) => {
            if (!container) {
                return;
            }
            container.dataset.collectionId = String(collection.id);
            container.dataset.directoryId = parentDirectoryId ?? '';
            if (container.dataset.dragBound === 'true') {
                return;
            }
            container.dataset.dragBound = 'true';
            container.addEventListener('dragover', (event) => handleRequestContainerDragOver(event, container));
            container.addEventListener('drop', (event) => {
                event.preventDefault();
                event.stopPropagation();
                completeRequestDrop(container);
            });
        };

        const setupRequestDrag = (listItem, request, parentDirectoryId, collection, container) => {
            listItem.dataset.requestId = request.id;
            listItem.dataset.collectionId = collection.id;
            listItem.dataset.directoryId = parentDirectoryId ?? '';

            const handle = document.createElement('span');
            handle.className = 'drag-handle drag-handle--request';
            handle.setAttribute('title', 'Drag to reorder requests');
            handle.textContent = '::';
            handle.draggable = true;
            handle.addEventListener('dragstart', (event) => beginRequestDrag(event, {
                element: listItem,
                container,
                requestId: request.id,
                directoryId: parentDirectoryId ?? null,
                collectionId: collection.id,
            }));
            handle.addEventListener('dragend', cancelDragState);
            handle.addEventListener('click', (event) => event.preventDefault());
            listItem.insertBefore(handle, listItem.firstChild);

            listItem.addEventListener('dragover', (event) => handleRequestDragOver(event, listItem, parentDirectoryId ?? null, collection.id));
            listItem.addEventListener('drop', (event) => {
                event.preventDefault();
                event.stopPropagation();
                completeRequestDrop(container);
            });
        };

        const setupDirectoryContainerDrag = (container, parentId, collection) => {
            if (!container) {
                return;
            }
            container.dataset.collectionId = String(collection.id);
            container.dataset.parentId = parentId ?? '';
            if (container.dataset.dragBound === 'true') {
                return;
            }
            container.dataset.dragBound = 'true';
            container.addEventListener('dragover', (event) => handleDirectoryContainerDragOver(event, container));
            container.addEventListener('drop', (event) => {
                event.preventDefault();
                event.stopPropagation();
                completeDirectoryDrop(container);
            });
        };

        const setupDirectoryDrag = (directoryItem, headerRow, directory, parentId, collection, container, toggleButton, directoryKey) => {
            directoryItem.dataset.directoryId = directory.id;
            directoryItem.dataset.collectionId = collection.id;
            directoryItem.dataset.parentId = parentId ?? '';
            directoryItem.dataset.directoryName = directory.name;

            const handle = document.createElement('span');
            handle.className = 'drag-handle drag-handle--directory';
            handle.setAttribute('title', 'Drag to reorder folders');
            handle.textContent = '::';
            handle.draggable = true;
            handle.addEventListener('dragstart', (event) => beginDirectoryDrag(event, {
                element: directoryItem,
                parentId: parentId ?? null,
                collectionId: collection.id,
                container,
                directoryId: directory.id,
            }));
            handle.addEventListener('dragend', cancelDragState);
            handle.addEventListener('click', (event) => event.preventDefault());
            headerRow.insertBefore(handle, headerRow.firstChild);

            directoryItem.addEventListener('dragover', (event) => {
                const drag = state.dragState;
                if (!drag) {
                    return;
                }
                if (drag.type === 'directory') {
                    handleDirectoryDragOver(event, directoryItem, collection.id);
                } else if (drag.type === 'request') {
                    if (directoryKey && toggleButton && state.collapsedDirectoryKeys.has(directoryKey)) {
                        state.collapsedDirectoryKeys.delete(directoryKey);
                        applyDirectoryCollapse(directoryItem, toggleButton, false);
                    }
                    const requestList = directoryItem.querySelector('.request-list');
                    if (requestList) {
                        requestList.hidden = false;
                        handleRequestContainerDragOver(event, requestList);
                    }
                }
            });
            directoryItem.addEventListener('drop', (event) => {
                const drag = state.dragState;
                if (!drag) {
                    return;
                }
                if (drag.type === 'directory') {
                    event.preventDefault();
                    event.stopPropagation();
                    completeDirectoryDrop(directoryItem.parentElement || container);
                } else if (drag.type === 'request') {
                    const requestList = directoryItem.querySelector('.request-list');
                    if (!requestList) {
                        return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    completeRequestDrop(requestList);
                }
            });
        };

        const highlightSelection = () => {
            if (!elements.collectionsList) {
                return;
            }
            const cards = elements.collectionsList.querySelectorAll('.collection-card');
            cards.forEach((card) => {
                const collectionId = Number(card.dataset.collectionId);
                const isActiveCollection = collectionId === state.selectedCollectionId;
                card.classList.toggle('active', isActiveCollection);
                if (isActiveCollection) {
                    state.collapsedCollections.delete(collectionId);
                }
                updateCardCollapseState(card, state.collapsedCollections.has(collectionId));
                const requestButtons = card.querySelectorAll('.request-item .request-select');
                requestButtons.forEach((button) => {
                    const isActiveRequest = Number(button.dataset.requestId) === state.selectedRequestId;
                    button.classList.toggle('active', isActiveRequest);
                });

                const directoryButtons = card.querySelectorAll('.directory-button');
                directoryButtons.forEach((button) => {
                    const dirAttr = button.dataset.directoryId;
                    const dirId = dirAttr === '' ? null : Number(dirAttr);
                    const isActiveDirectory =
                        isActiveCollection &&
                        ((dirId === null && state.selectedDirectoryId === null) || dirId === state.selectedDirectoryId);
                    button.classList.toggle('active', isActiveDirectory);

                    const collectionAttr = button.dataset.collectionId;
                    const directoryCollectionId = collectionAttr ? Number(collectionAttr) : null;
                    if (directoryCollectionId !== null && dirId !== null) {
                        const key = buildDirectoryMenuKey(directoryCollectionId, dirId);
                        const directoryItem = button.closest('.directory-item');
                        const toggle = directoryItem?.querySelector('.directory-toggle');
                        if (directoryItem && toggle) {
                            const collapsed = state.collapsedDirectoryKeys.has(key);
                            applyDirectoryCollapse(directoryItem, toggle, collapsed);
                        }
                    }
                });
            });
            updateCollectionActionState();
        };

        const renderEnvironmentOptions = (collection) => {
            if (!elements.environmentSelect) {
                return;
            }
            const options = ['<option value="">No environment</option>'];
            state.environments.forEach((env) => {
                const isLinked = collection?.environments?.some((item) => item.id === env.id);
                const suffix = isLinked ? ' (linked)' : '';
                options.push(`<option value="${env.id}" data-linked="${isLinked}">${escapeHtml(env.name)}${suffix}</option>`);
            });
            elements.environmentSelect.innerHTML = options.join('');
            if (collection?.environments?.length) {
                elements.environmentSelect.value = collection.environments[0].id;
            } else {
                elements.environmentSelect.value = '';
            }
        };

        const renderCollections = (filterText = '') => {
            if (!elements.collectionsList) {
                return;
            }
            closeCollectionMenu();
            closeDirectoryMenu();
            const list = elements.collectionsList;
            list.innerHTML = '';
            const normalizedFilter = filterText.trim().toLowerCase();

            const filtered = state.collections.filter((collection) => {
                if (!normalizedFilter) {
                    return true;
                }
                const description = collection.description ? collection.description.toLowerCase() : '';
                if (collection.name.toLowerCase().includes(normalizedFilter) || description.includes(normalizedFilter)) {
                    return true;
                }
                const requests = Array.isArray(collection.requests) ? collection.requests : [];
                return requests.some((request) => {
                    const label = `${request.method} ${request.name}`.toLowerCase();
                    return label.includes(normalizedFilter);
                });
            });

            if (!filtered.length) {
                list.innerHTML = '<p class="muted">No collections found.</p>';
                updateCollectionActionState();
                return;
            }

            filtered.forEach((collection) => {
                const collapsed = state.collapsedCollections.has(collection.id);
                const isMenuOpen = state.openCollectionMenuId === collection.id;
                const card = document.createElement('article');
                card.className = 'collection-card';
                card.dataset.collectionId = collection.id;

                const header = document.createElement('div');
                header.className = 'collection-card__header';

                const toggleButton = document.createElement('button');
                toggleButton.type = 'button';
                toggleButton.className = 'collection-toggle';
                toggleButton.id = `collection-toggle-${collection.id}`;
                toggleButton.setAttribute('aria-expanded', String(!collapsed));
                toggleButton.innerHTML = `
                    <span class="collection-toggle-indicator" aria-hidden="true">></span>
                    <span class="collection-name">
                        <span class="collection-name-text">${escapeHtml(collection.name)}</span>
                        <span class="request-count">${(collection.requests || []).length} requests</span>
                    </span>
                `;
                toggleButton.addEventListener('click', (event) => {
                    event.stopPropagation();
                    closeCollectionMenu();
                    closeDirectoryMenu();
                    state.openCollectionMenuId = null;
                    const nextCollapsed = !state.collapsedCollections.has(collection.id);
                    if (nextCollapsed) {
                        state.collapsedCollections.add(collection.id);
                    } else {
                        state.collapsedCollections.delete(collection.id);
                    }
                    updateCardCollapseState(card, nextCollapsed);
                    highlightSelection();
                });

                header.appendChild(toggleButton);

                const menuWrapper = document.createElement('div');
                menuWrapper.className = 'collection-menu-wrapper';

                const menuButton = document.createElement('button');
                menuButton.type = 'button';
                menuButton.className = 'collection-menu-toggle';
                menuButton.setAttribute('aria-label', `Collection actions for ${collection.name}`);
                menuButton.setAttribute('aria-expanded', String(isMenuOpen));
                menuButton.innerHTML = '<span aria-hidden="true">...</span>';

                const menu = document.createElement('div');
                menu.className = 'collection-menu';
                menu.hidden = !isMenuOpen;

                menuButton.addEventListener('click', (event) => {
                    event.stopPropagation();
                    closeCollectionsActionMenu();
                    closeDirectoryMenu();
                    const wasOpen = state.openCollectionMenuId === collection.id;
                    if (state.openCollectionMenuId !== null) {
                        hideMenuForCollection(state.openCollectionMenuId);
                        state.openCollectionMenuId = null;
                    }
                    if (!wasOpen) {
                        state.openCollectionMenuId = collection.id;
                        menu.hidden = false;
                        menuButton.setAttribute('aria-expanded', 'true');
                    } else {
                        menu.hidden = true;
                        menuButton.setAttribute('aria-expanded', 'false');
                    }
                });

                const addRequestButton = document.createElement('button');
                addRequestButton.type = 'button';
                addRequestButton.className = 'collection-menu-item';
                addRequestButton.textContent = 'Add New Request';
                addRequestButton.addEventListener('click', (event) => {
                    event.stopPropagation();
                    closeDirectoryMenu();
                    hideMenuForCollection(collection.id);
                    state.openCollectionMenuId = null;
                    startNewRequestDraft(collection);
                });

                menu.appendChild(addRequestButton);
                menuWrapper.appendChild(menuButton);
                menuWrapper.appendChild(menu);
                header.appendChild(menuWrapper);

                card.appendChild(header);

                const body = document.createElement('div');
                body.id = `collection-body-${collection.id}`;
                body.className = 'collection-body';
                body.setAttribute('role', 'region');
                body.setAttribute('aria-labelledby', toggleButton.id);
                toggleButton.setAttribute('aria-controls', body.id);

                const desc = document.createElement('div');
                desc.className = 'collection-desc';
                desc.textContent = collection.description || 'No description provided.';
                body.appendChild(desc);

                if (collection.environments?.length) {
                    const envWrap = document.createElement('div');
                    envWrap.className = 'env-pill-group';
                    collection.environments.forEach((env) => {
                        const pill = document.createElement('span');
                        pill.className = 'env-pill';
                        pill.textContent = env.name;
                        envWrap.appendChild(pill);
                    });
                    body.appendChild(envWrap);
                }

                const requests = Array.isArray(collection.requests) ? collection.requests : [];
                const directories = Array.isArray(collection.directories) ? collection.directories : [];

                const requestsByDirectory = new Map();
                requests.forEach((request) => {
                    const key = request.directory_id ?? null;
                    if (!requestsByDirectory.has(key)) {
                        requestsByDirectory.set(key, []);
                    }
                    requestsByDirectory.get(key).push(request);
                });

                const directoryChildren = new Map();
                const directoryLookup = new Map();
                directories.forEach((directory) => {
                    directoryLookup.set(directory.id, directory);
                    const parentKey = directory.parent_id ?? null;
                    if (!directoryChildren.has(parentKey)) {
                        directoryChildren.set(parentKey, []);
                    }
                    directoryChildren.get(parentKey).push(directory);
                });
                directoryChildren.forEach((children) => {
                    children.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
                });

                const requestDirectoryMap = new Map();
                requests.forEach((request) => {
                    requestDirectoryMap.set(request.id, request.directory_id ?? null);
                });

                const isRequestInDirectorySubtree = (requestId, directoryId) => {
                    if (!requestId) {
                        return false;
                    }
                    let currentDirectoryId = requestDirectoryMap.get(requestId) ?? null;
                    if (currentDirectoryId === null) {
                        return directoryId === null;
                    }
                    while (currentDirectoryId !== null) {
                        if (currentDirectoryId === directoryId) {
                            return true;
                        }
                        const parentDirectory = directoryLookup.get(currentDirectoryId);
                        if (!parentDirectory) {
                            break;
                        }
                        currentDirectoryId = parentDirectory.parent_id ?? null;
                    }
                    return false;
                };

                const findFirstRequestInDirectory = (directoryId) => {
                    const direct = requestsByDirectory.get(directoryId) || [];
                    if (direct.length) {
                        return direct[0];
                    }
                    const children = directoryChildren.get(directoryId) || [];
                    for (const child of children) {
                        const found = findFirstRequestInDirectory(child.id);
                        if (found) {
                            return found;
                        }
                    }
                    return null;
                };

                const buildRequestList = (requestItems, parentDirectoryId) => {
                    const items = Array.isArray(requestItems) ? requestItems : [];
                    const requestList = document.createElement('ul');
                    requestList.className = 'request-list';
                    const isRootList = parentDirectoryId === null;
                    if (!items.length) {
                        requestList.classList.add('request-list--empty');
                        if (!isRootList) {
                            requestList.hidden = true;
                        }
                    } else if (!isRootList) {
                        requestList.hidden = false;
                    }
                    setupRequestContainerDrag(requestList, parentDirectoryId, collection);

                    items.forEach((request) => {
                        const listItem = document.createElement('li');
                        listItem.className = 'request-item';
                        listItem.dataset.requestId = request.id;
                        listItem.dataset.directoryId = request.directory_id ?? '';
                        listItem.dataset.collectionId = collection.id;

                        const button = document.createElement('button');
                        button.type = 'button';
                        button.className = 'request-select';
                        button.dataset.collectionId = collection.id;
                        button.dataset.requestId = request.id;
                        button.dataset.directoryId = request.directory_id ?? '';
                        button.textContent = `${request.method} · ${request.name}`;
                        button.addEventListener('click', (event) => {
                            event.stopPropagation();
                            closeCollectionMenu();
                            closeDirectoryMenu();
                            closeRequestMenu();
                            state.selectedCollectionId = collection.id;
                            state.selectedDirectoryId = request.directory_id ?? null;
                            state.selectedRequestId = request.id;
                            state.collapsedCollections.delete(collection.id);
                            state.openCollectionMenuId = null;
                            renderEnvironmentOptions(collection);
                            populateForm(collection, request);
                            highlightSelection();
                        });

                        listItem.appendChild(button);

                        const menuWrapper = document.createElement('div');
                        menuWrapper.className = 'request-menu-wrapper';
                        const menuKey = buildRequestMenuKey(collection.id, request.id);
                        const isMenuOpen = state.openRequestMenuKey === menuKey;

                        const menuButton = document.createElement('button');
                        menuButton.type = 'button';
                        menuButton.className = 'request-menu-toggle';
                        menuButton.setAttribute('aria-label', `Request actions for ${request.name}`);
                        menuButton.setAttribute('aria-expanded', String(isMenuOpen));
                        menuButton.innerHTML = '<span aria-hidden="true">...</span>';

                        const menu = document.createElement('div');
                        menu.className = 'request-menu';
                        menu.hidden = !isMenuOpen;

                        menuButton.addEventListener('click', (event) => {
                            event.stopPropagation();
                            closeCollectionMenu();
                            closeDirectoryMenu();
                            const wasOpen = state.openRequestMenuKey === menuKey;
                            if (state.openRequestMenuKey && state.openRequestMenuKey !== menuKey) {
                                closeRequestMenu();
                            }
                            if (!wasOpen) {
                                state.openRequestMenuKey = menuKey;
                                menu.hidden = false;
                                menuButton.setAttribute('aria-expanded', 'true');
                            } else {
                                menu.hidden = true;
                                menuButton.setAttribute('aria-expanded', 'false');
                                state.openRequestMenuKey = null;
                            }
                        });

                        const renameButton = document.createElement('button');
                        renameButton.type = 'button';
                        renameButton.className = 'request-menu-item';
                        renameButton.textContent = 'Rename Request';
                        renameButton.addEventListener('click', async (event) => {
                            event.stopPropagation();
                            closeRequestMenu();
                            const inputName = await promptForRequestName(request.name);
                            if (inputName === null) {
                                setStatus('Request rename cancelled.', 'neutral');
                                return;
                            }
                            const sanitizedName = inputName.trim();
                            if (!sanitizedName) {
                                setStatus('Enter a request name to continue.', 'error');
                                return;
                            }
                            const requestsEndpoint = getRequestsEndpointBase();
                            if (!requestsEndpoint) {
                                setStatus('Request endpoint unavailable.', 'error');
                                return;
                            }
                            const detailUrl = `${requestsEndpoint}${request.id}/`;
                            setStatus('Renaming request...', 'loading');
                            try {
                                await postJson(detailUrl, { name: sanitizedName }, 'PATCH');
                                await refreshCollections({
                                    preserveSelection: true,
                                    focusCollectionId: collection.id,
                                    focusDirectoryId: request.directory_id ?? null,
                                    focusRequestId: request.id,
                                });
                                setStatus('Request renamed successfully.', 'success');
                            } catch (error) {
                                setStatus(error instanceof Error ? error.message : 'Failed to rename request.', 'error');
                            }
                        });

                        const deleteButton = document.createElement('button');
                        deleteButton.type = 'button';
                        deleteButton.className = 'request-menu-item';
                        deleteButton.textContent = 'Delete Request';
                        deleteButton.addEventListener('click', async (event) => {
                            event.stopPropagation();
                            closeRequestMenu();
                            const confirmed = window.confirm(`Delete request "${request.name}"?`);
                            if (!confirmed) {
                                setStatus('Request deletion cancelled.', 'neutral');
                                return;
                            }
                            const requestsEndpoint = getRequestsEndpointBase();
                            if (!requestsEndpoint) {
                                setStatus('Request endpoint unavailable.', 'error');
                                return;
                            }
                            const detailUrl = `${requestsEndpoint}${request.id}/`;
                            const wasSelected = state.selectedRequestId === request.id;
                            setStatus('Deleting request...', 'loading');
                            try {
                                await deleteResource(detailUrl);
                                await refreshCollections({
                                    preserveSelection: !wasSelected,
                                    focusCollectionId: collection.id,
                                    focusDirectoryId: request.directory_id ?? null,
                                    focusRequestId: wasSelected ? null : state.selectedRequestId,
                                });
                                setStatus('Request deleted successfully.', 'success');
                            } catch (error) {
                                setStatus(error instanceof Error ? error.message : 'Failed to delete request.', 'error');
                            }
                        });

                        menu.appendChild(renameButton);
                        menu.appendChild(deleteButton);
                        menuWrapper.appendChild(menuButton);
                        menuWrapper.appendChild(menu);
                        listItem.appendChild(menuWrapper);

                        setupRequestDrag(listItem, request, parentDirectoryId, collection, requestList);
                        requestList.appendChild(listItem);
                    });

                    return requestList;
                };

                const buildDirectoryBranch = (parentId) => {
                    const directoryRequests = requestsByDirectory.get(parentId) || [];
                    const requestList = buildRequestList(directoryRequests, parentId);
                    const children = directoryChildren.get(parentId) || [];

                    const container = document.createElement('div');
                    container.className = parentId === null ? 'request-tree' : 'request-tree nested';

                    if (requestList) {
                        container.appendChild(requestList);
                    }

                    if (children.length) {
                        const directoriesContainer = document.createElement('div');
                        directoriesContainer.className = 'directory-children';
                        setupDirectoryContainerDrag(directoriesContainer, parentId ?? null, collection);

                        children.forEach((directory) => {
                            const directoryItem = document.createElement('div');
                            directoryItem.className = 'directory-item';
                            directoryItem.dataset.directoryId = directory.id;
                            directoryItem.dataset.collectionId = collection.id;
                            directoryItem.dataset.parentId = directory.parent_id ?? '';
                            directoryItem.dataset.directoryName = directory.name;

                            const headerRow = document.createElement('div');
                            headerRow.className = 'directory-item__header';

                            const directoryKey = buildDirectoryMenuKey(collection.id, directory.id);
                            const isCollapsed = state.collapsedDirectoryKeys.has(directoryKey);

                            const toggleButton = document.createElement('button');
                            toggleButton.type = 'button';
                            toggleButton.className = 'directory-toggle';
                            toggleButton.addEventListener('click', (event) => {
                                event.stopPropagation();
                                const currentlyCollapsed = state.collapsedDirectoryKeys.has(directoryKey);
                                const nextCollapsed = !currentlyCollapsed;
                                if (nextCollapsed) {
                                    state.collapsedDirectoryKeys.add(directoryKey);
                                } else {
                                    state.collapsedDirectoryKeys.delete(directoryKey);
                                }
                                applyDirectoryCollapse(directoryItem, toggleButton, nextCollapsed);
                            });
                            headerRow.appendChild(toggleButton);

                            const button = document.createElement('button');
                            button.type = 'button';
                            button.className = 'directory-button';
                            button.dataset.collectionId = collection.id;
                            button.dataset.directoryId = directory.id;
                            button.textContent = directory.name;
                            button.addEventListener('click', (event) => {
                                event.stopPropagation();
                                closeCollectionMenu();
                                closeDirectoryMenu();
                                state.selectedCollectionId = collection.id;
                                state.selectedDirectoryId = directory.id;
                                let nextRequest = null;
                                if (isRequestInDirectorySubtree(state.selectedRequestId, directory.id)) {
                                    nextRequest = requests.find((req) => req.id === state.selectedRequestId) || null;
                                }
                                if (!nextRequest) {
                                    nextRequest = findFirstRequestInDirectory(directory.id);
                                }
                                state.selectedRequestId = nextRequest ? nextRequest.id : null;
                                state.collapsedCollections.delete(collection.id);
                                state.openCollectionMenuId = null;
                                renderEnvironmentOptions(collection);
                                populateForm(collection, nextRequest || null);
                                highlightSelection();
                            });

                            const menuWrapper = document.createElement('div');
                            menuWrapper.className = 'directory-menu-wrapper';
                            const menuKey = directoryKey;
                            const isMenuOpen = state.openDirectoryMenuKey === menuKey;

                            const menuButton = document.createElement('button');
                            menuButton.type = 'button';
                            menuButton.className = 'directory-menu-toggle';
                            menuButton.setAttribute('aria-label', `Folder actions for ${directory.name}`);
                            menuButton.setAttribute('aria-expanded', String(isMenuOpen));
                            menuButton.innerHTML = '<span aria-hidden="true">...</span>';

                            const menu = document.createElement('div');
                            menu.className = 'directory-menu';
                            menu.hidden = !isMenuOpen;

                            menuButton.addEventListener('click', (event) => {
                                event.stopPropagation();
                                closeCollectionMenu();
                                const wasOpen = state.openDirectoryMenuKey === menuKey;
                                if (state.openDirectoryMenuKey && state.openDirectoryMenuKey !== menuKey) {
                                    closeDirectoryMenu();
                                }
                                if (!wasOpen) {
                                    state.openDirectoryMenuKey = menuKey;
                                    menu.hidden = false;
                                    menuButton.setAttribute('aria-expanded', 'true');
                                } else {
                                    menu.hidden = true;
                                    menuButton.setAttribute('aria-expanded', 'false');
                                    state.openDirectoryMenuKey = null;
                                }
                            });

                            const addRequestButton = document.createElement('button');
                            addRequestButton.type = 'button';
                            addRequestButton.className = 'directory-menu-item';
                            addRequestButton.textContent = 'Add Request';
                            addRequestButton.addEventListener('click', (event) => {
                                event.stopPropagation();
                                closeDirectoryMenu();
                                startNewRequestDraft(collection, directory.id);
                            });

                            const renameButton = document.createElement('button');
                            renameButton.type = 'button';
                            renameButton.className = 'directory-menu-item';
                            renameButton.textContent = 'Rename Folder';
                            renameButton.addEventListener('click', async (event) => {
                                event.stopPropagation();
                                closeDirectoryMenu();
                                const inputName = await promptForDirectoryName(directory.name, 'Rename folder:');
                                if (inputName === null) {
                                    setStatus('Folder rename cancelled.', 'neutral');
                                    return;
                                }
                                const sanitizedName = inputName.trim();
                                if (!sanitizedName) {
                                    setStatus('Enter a folder name to continue.', 'error');
                                    return;
                                }
                                const directoriesEndpoint = getDirectoriesEndpoint();
                                if (!directoriesEndpoint) {
                                    setStatus('Directory endpoint unavailable.', 'error');
                                    return;
                                }
                                const detailUrl = `${directoriesEndpoint}${directory.id}/`;
                                setStatus('Renaming folder...', 'loading');
                                try {
                                    await postJson(detailUrl, { name: sanitizedName }, 'PATCH');
                                    await refreshCollections({
                                        preserveSelection: true,
                                        focusCollectionId: collection.id,
                                        focusDirectoryId: directory.id,
                                        focusRequestId: state.selectedRequestId,
                                    });
                                    setStatus('Folder renamed successfully.', 'success');
                                } catch (error) {
                                    setStatus(error instanceof Error ? error.message : 'Failed to rename folder.', 'error');
                                }
                            });

                            const deleteButton = document.createElement('button');
                            deleteButton.type = 'button';
                            deleteButton.className = 'directory-menu-item';
                            deleteButton.textContent = 'Delete Folder';
                            deleteButton.addEventListener('click', async (event) => {
                                event.stopPropagation();
                                closeDirectoryMenu();
                                const confirmed = window.confirm(`Delete folder "${directory.name}" and all nested items?`);
                                if (!confirmed) {
                                    setStatus('Folder deletion cancelled.', 'neutral');
                                    return;
                                }
                                const directoriesEndpoint = getDirectoriesEndpoint();
                                if (!directoriesEndpoint) {
                                    setStatus('Directory endpoint unavailable.', 'error');
                                    return;
                                }
                                const detailUrl = `${directoriesEndpoint}${directory.id}/`;
                                const requestStays = state.selectedRequestId
                                    ? !isRequestInDirectorySubtree(state.selectedRequestId, directory.id)
                                    : true;
                                const focusDirectoryId = state.selectedDirectoryId === directory.id
                                    ? directory.parent_id ?? null
                                    : state.selectedDirectoryId;
                                const focusRequestId = requestStays ? state.selectedRequestId : null;

                                setStatus('Deleting folder...', 'loading');
                                try {
                                    await deleteResource(detailUrl);
                                    await refreshCollections({
                                        preserveSelection: requestStays,
                                        focusCollectionId: collection.id,
                                        focusDirectoryId,
                                        focusRequestId,
                                    });
                                    setStatus('Folder deleted successfully.', 'success');
                                } catch (error) {
                                    setStatus(error instanceof Error ? error.message : 'Failed to delete folder.', 'error');
                                }
                            });

                            menu.appendChild(addRequestButton);
                            menu.appendChild(renameButton);
                            menu.appendChild(deleteButton);
                            menuWrapper.appendChild(menuButton);
                            menuWrapper.appendChild(menu);

                            headerRow.appendChild(button);
                            headerRow.appendChild(menuWrapper);
                            directoryItem.appendChild(headerRow);

                            const childBranch = buildDirectoryBranch(directory.id);
                            if (childBranch) {
                                directoryItem.appendChild(childBranch);
                            }

                            setupDirectoryDrag(directoryItem, headerRow, directory, directory.parent_id ?? null, collection, directoriesContainer, toggleButton, directoryKey);
                            applyDirectoryCollapse(directoryItem, toggleButton, isCollapsed);
                            directoriesContainer.appendChild(directoryItem);
                        });

                        container.appendChild(directoriesContainer);
                    }

                    return container;
                };

                const tree = buildDirectoryBranch(null);
                body.appendChild(tree);
                if (!requests.length && !directories.length) {
                    const empty = document.createElement('p');
                    empty.className = 'muted';
                    empty.textContent = 'Collection has no requests yet.';
                    body.appendChild(empty);
                }

                card.appendChild(body);
                updateCardCollapseState(card, collapsed);

                card.addEventListener('click', () => {
                    closeCollectionMenu();
                    closeDirectoryMenu();
                    state.selectedCollectionId = collection.id;
                    state.collapsedCollections.delete(collection.id);
                    state.openCollectionMenuId = null;
                    const firstRequest = requests[0] || null;
                    state.selectedDirectoryId = firstRequest ? firstRequest.directory_id ?? null : null;
                    state.selectedRequestId = firstRequest ? firstRequest.id : null;
                    renderEnvironmentOptions(collection);
                    populateForm(collection, firstRequest || null);
                    highlightSelection();
                });

                list.appendChild(card);
            });

            highlightSelection();
        };

        const refreshCollections = async ({
            preserveSelection = true,
            focusCollectionId = null,
            focusRequestId = null,
            focusDirectoryId = null,
        } = {}) => {
            const previousCollectionId = state.selectedCollectionId;
            const previousRequestId = state.selectedRequestId;
            const previousDirectoryId = state.selectedDirectoryId;

            const collections = await fetchJson(endpoints.collections);
            state.collections = normalizeList(collections).map((collection) => ({
                ...collection,
                directories: Array.isArray(collection.directories)
                    ? [...collection.directories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
                    : [],
                requests: Array.isArray(collection.requests)
                    ? [...collection.requests].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
                    : [],
            }));

            state.collections.sort((a, b) => a.name.localeCompare(b.name));

            state.directoryMaps = new Map();
            state.collections.forEach((collection) => {
                const directoryMap = new Map();
                (collection.directories || []).forEach((directory) => {
                    directoryMap.set(directory.id, directory);
                });
                state.directoryMaps.set(collection.id, directoryMap);
            });

            if (state.openRequestMenuKey) {
                const parts = state.openRequestMenuKey.split(':');
                const collectionId = Number(parts[0]);
                const requestId = Number(parts[1]);
                const collection = state.collections.find((item) => item.id === collectionId);
                const requestExists = collection?.requests?.some((item) => item.id === requestId) ?? false;
                if (!collection || !requestExists) {
                    state.openRequestMenuKey = null;
                }
            }

            const previousCollapsedKeys = state.collapsedDirectoryKeys;
            const previousKnownKeys = state.knownDirectoryKeys || new Set();
            const nextCollapsedKeys = new Set();
            const nextKnownKeys = new Set();
            state.collections.forEach((collection) => {
                (collection.directories || []).forEach((directory) => {
                    const key = buildDirectoryMenuKey(collection.id, directory.id);
                    nextKnownKeys.add(key);
                    const wasKnown = previousKnownKeys.has(key);
                    const wasCollapsed = previousCollapsedKeys.has(key);
                    if (!wasKnown || wasCollapsed) {
                        nextCollapsedKeys.add(key);
                    }
                });
            });
            state.knownDirectoryKeys = nextKnownKeys;
            state.collapsedDirectoryKeys = nextCollapsedKeys;

            const validCollapsed = new Set();
            state.collections.forEach((collection) => {
                if (state.collapsedCollections.has(collection.id)) {
                    validCollapsed.add(collection.id);
                }
            });
            state.collapsedCollections = validCollapsed;

            const currentFilter = elements.search ? elements.search.value : '';
            renderCollections(currentFilter);

            let nextCollectionId = focusCollectionId;
            if (nextCollectionId === null) {
                if (preserveSelection && previousCollectionId && state.collections.some((item) => item.id === previousCollectionId)) {
                    nextCollectionId = previousCollectionId;
                } else {
                    nextCollectionId = state.collections[0]?.id ?? null;
                }
            }

            state.selectedCollectionId = nextCollectionId;
            const collection = state.collections.find((item) => item.id === nextCollectionId) || null;

            if (!collection) {
                state.selectedCollectionId = null;
                state.selectedRequestId = null;
                state.selectedDirectoryId = null;
                renderEnvironmentOptions(null);
                populateForm(null, null);
                highlightSelection();
                return;
            }

            let nextRequestId = focusRequestId;
            if (nextRequestId === null) {
                if (
                    preserveSelection &&
                    previousRequestId &&
                    collection.requests.some((item) => item.id === previousRequestId)
                ) {
                    nextRequestId = previousRequestId;
                } else {
                    nextRequestId = collection.requests[0]?.id ?? null;
                }
            }
            state.selectedRequestId = nextRequestId;

            let nextDirectoryId = focusDirectoryId;
            if (nextDirectoryId === null) {
                if (state.selectedRequestId) {
                    const matchingRequest = collection.requests.find((item) => item.id === state.selectedRequestId);
                    nextDirectoryId = matchingRequest?.directory_id ?? null;
                } else if (
                    preserveSelection &&
                    previousDirectoryId &&
                    state.directoryMaps.get(collection.id)?.has(previousDirectoryId)
                ) {
                    nextDirectoryId = previousDirectoryId;
                } else {
                    nextDirectoryId = null;
                }
            }
            state.selectedDirectoryId = nextDirectoryId;

            if (
                focusDirectoryId !== null &&
                state.selectedDirectoryId === focusDirectoryId &&
                state.selectedRequestId !== null
            ) {
                const alignedRequest = collection.requests.find((item) => item.id === state.selectedRequestId);
                if (!alignedRequest || (alignedRequest.directory_id ?? null) !== focusDirectoryId) {
                    state.selectedRequestId = null;
                }
            }

            const request = state.selectedRequestId
                ? collection.requests.find((item) => item.id === state.selectedRequestId) || null
                : null;
            if (!request && collection.requests.length === 0) {
                state.selectedRequestId = null;
            }

            renderEnvironmentOptions(collection);
            populateForm(collection, request || null);
            highlightSelection();
        };

        const importCollectionFromPostman = async (file) => {
            if (!file) {
                return;
            }
            const importUrl = endpoints.collectionsImport ? ensureTrailingSlash(endpoints.collectionsImport) : '';
            if (!importUrl) {
                setStatus('Import endpoint unavailable.', 'error');
                return;
            }
            const formData = new FormData();
            formData.append('file', file);
            setStatus('Importing Postman collection...', 'loading');
            try {
                const response = await postFormData(importUrl, formData);
                const importedId = response?.id ?? response?.collection_id ?? null;
                await refreshCollections({
                    preserveSelection: false,
                    focusCollectionId: importedId,
                });
                setStatus('Collection imported successfully.', 'success');
            } catch (error) {
                setStatus(error instanceof Error ? error.message : 'Failed to import Postman collection.', 'error');
            } finally {
                if (elements.importPostmanInput) {
                    elements.importPostmanInput.value = '';
                }
            }
        };

        const renderResponse = (payload) => {
            if (!payload) {
                elements.responseSummary.textContent = 'No request executed yet.';
                elements.responseHeaders.textContent = '{}';
                elements.responseBody.textContent = '{}';
                elements.responseAssertions.innerHTML = '<p class="muted">No assertions evaluated.</p>';
                return;
            }

            const statusLine = [`Status ${payload.status_code}`];
            if (payload.elapsed_ms) {
                statusLine.push(`${payload.elapsed_ms.toFixed(1)} ms`);
            }
            if (payload.environment) {
                statusLine.push(`Environment: ${payload.environment}`);
            }
            elements.responseSummary.textContent = statusLine.join(' · ');
            elements.responseHeaders.textContent = prettyJson(payload.headers || {});
            if (payload.json !== null && payload.json !== undefined) {
                elements.responseBody.textContent = prettyJson(payload.json);
            } else {
                elements.responseBody.textContent = payload.body || '';
            }

            if (payload.assertions?.length) {
                const assertionItems = payload.assertions.map((item) => {
                    const statusClass = item.passed ? 'pass' : 'fail';
                    return `<div class="assertion-item ${statusClass}">
                                <div class="assertion-meta">
                                    <strong>${escapeHtml(item.type)}</strong>
                                    <span>Expected: ${escapeHtml(item.expected)}</span>
                                    <span>Actual: ${escapeHtml(item.actual)}</span>
                                </div>
                                <span>${item.passed ? '✔' : '✘'}</span>
                            </div>`;
                });
                elements.responseAssertions.innerHTML = assertionItems.join('');
            } else {
                elements.responseAssertions.innerHTML = '<p class="muted">No assertions evaluated for this request.</p>';
            }
        };

        const buildPayloadFromBuilder = (collection, request) => {
            const headersPayload = rowsToObject(state.builder.headers);
            const paramsPayload = rowsToObject(state.builder.params);

            const payload = {
                method: elements.method.value,
                url: getTrimmedUrlValue(),
                headers: headersPayload,
                environment: elements.environmentSelect.value || null,
                params: paramsPayload,
                timeout: request?.timeout_ms ? request.timeout_ms / 1000 : 30,
            };
            payload.overrides = {};

            const authType = state.builder.auth.type;
            if (authType === 'basic') {
                const username = state.builder.auth.username || '';
                const password = state.builder.auth.password || '';
                if (username || password) {
                    const token = btoa(`${username}:${password}`);
                    payload.headers.Authorization = `Basic ${token}`;
                    payload.auth = { type: 'basic', username, password };
                }
            } else if (authType === 'bearer') {
                const token = state.builder.auth.token || '';
                if (token) {
                    payload.headers.Authorization = `Bearer ${token}`;
                    payload.auth = { type: 'bearer', token };
                }
            }

            const { bodyMode, bodyRawType, bodyRawText, bodyFormData, bodyUrlEncoded, bodyBinary } = state.builder;
            if (bodyMode === 'raw') {
                if (bodyRawType === 'json') {
                    try {
                        payload.json = JSON.parse(bodyRawText || '{}');
                    } catch (error) {
                        throw new Error('Raw body must be valid JSON.');
                    }
                } else {
                    payload.body = bodyRawText || '';
                }
                const recommended = RAW_TYPE_CONTENT_TYPES[bodyRawType];
                if (recommended && !payload.headers['Content-Type']) {
                    payload.headers['Content-Type'] = recommended;
                }
            } else if (bodyMode === 'form-data') {
                const formEntries = bodyFormData
                    .filter((row) => row && row.key && row.key.trim())
                    .map((row) => {
                        const key = row.key.trim();
                        if (row.type === 'file') {
                            if (!row.fileData) {
                                return null;
                            }
                            return {
                                key,
                                type: 'file',
                                filename: row.fileName || 'upload.bin',
                                content_type: row.fileType || 'application/octet-stream',
                                size: row.fileSize || null,
                                data: row.fileData,
                            };
                        }
                        return {
                            key,
                            type: 'text',
                            value: row.value ?? '',
                        };
                    })
                    .filter(Boolean);
                if (formEntries.length) {
                    payload.form_data = formEntries;
                }
            } else if (bodyMode === 'urlencoded') {
                const query = rowsToQueryString(bodyUrlEncoded);
                payload.body = query;
                if (!payload.headers['Content-Type']) {
                    payload.headers['Content-Type'] = BODY_MODE_CONTENT_TYPES.urlencoded;
                }
            } else if (bodyMode === 'binary') {
                if (bodyBinary && bodyBinary.dataUrl) {
                    payload.body = bodyBinary.dataUrl;
                    if (!payload.headers['Content-Type']) {
                        payload.headers['Content-Type'] = BODY_MODE_CONTENT_TYPES.binary;
                    }
                }
            }

            if (state.builder.scripts.pre) {
                payload.pre_request_script = state.builder.scripts.pre;
            }
            if (state.builder.scripts.post) {
                payload.tests_script = state.builder.scripts.post;
            }

            return payload;
        };

        const submitForm = async (event) => {
            event.preventDefault();
            if (isRequestInFlight) {
                return;
            }

            const collection = state.collections.find((item) => item.id === state.selectedCollectionId) || null;
            const request = collection?.requests?.find((item) => item.id === state.selectedRequestId) || null;

            if (!hasRunnableUrl()) {
                setStatus('Enter a request URL before sending.', 'error');
                updateRunButtonState();
                if (elements.url) {
                    elements.url.focus();
                }
                return;
            }

            let payload;
            try {
                payload = buildPayloadFromBuilder(collection, request);
            } catch (error) {
                setStatus(error instanceof Error ? error.message : 'Invalid request configuration.', 'error');
                return;
            }

            setStatus('Sending request...', 'loading');
            isRequestInFlight = true;
            updateRunButtonState();

            try {
                const response = await fetch(endpoints.execute, {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json',
                        'X-CSRFToken': getCookie('csrftoken') || '',
                    },
                    body: JSON.stringify(payload),
                });

                const data = await response.json();
                if (!response.ok) {
                    const message = data?.error || 'Request failed.';
                    setStatus(message, 'error');
                    renderResponse(null);
                } else {
                    setStatus('Request completed successfully.', 'success');
                    renderResponse(data);
                }
            } catch (error) {
                setStatus(error instanceof Error ? error.message : 'Unexpected error during request.', 'error');
                renderResponse(null);
            } finally {
                isRequestInFlight = false;
                updateRunButtonState();
            }
        };

        const buildRequestDefinition = ({ name, collectionId }) => {
            const trimmedName = (name || '').trim();
            if (!trimmedName) {
                throw new Error('Request name is required.');
            }
            const urlValue = getTrimmedUrlValue();
            if (!urlValue) {
                throw new Error('Enter a request URL before saving.');
            }

            const headersPayload = rowsToObject(state.builder.headers);
            const paramsPayload = rowsToObject(state.builder.params);

            const definition = {
                collection: collectionId,
                directory: state.selectedDirectoryId,
                name: trimmedName,
                method: elements.method.value || 'GET',
                url: urlValue,
                description: '',
                timeout_ms: 30000,
                headers: headersPayload,
                query_params: paramsPayload,
                body_type: 'none',
                body_json: {},
                body_form: {},
                body_raw: '',
                auth_type: state.builder.auth.type || 'none',
                auth_basic: {},
                auth_bearer: '',
                pre_request_script: state.builder.scripts.pre || '',
                tests_script: state.builder.scripts.post || '',
                assertions: [],
            };

            if (definition.auth_type === 'basic') {
                definition.auth_basic = {
                    username: state.builder.auth.username || '',
                    password: state.builder.auth.password || '',
                };
            } else if (definition.auth_type === 'bearer') {
                definition.auth_bearer = state.builder.auth.token || '';
            }

            const { bodyMode, bodyRawType, bodyRawText, bodyFormData, bodyUrlEncoded, bodyBinary } = state.builder;
            if (bodyMode === 'raw') {
                if (bodyRawType === 'json') {
                    try {
                        definition.body_json = JSON.parse(bodyRawText || '{}');
                        definition.body_type = 'json';
                    } catch (error) {
                        throw new Error('Raw body must be valid JSON before saving.');
                    }
                } else {
                    definition.body_type = 'raw';
                    definition.body_raw = bodyRawText || '';
                }
            } else if (bodyMode === 'form-data') {
                const textFields = {};
                bodyFormData
                    .filter((row) => row && row.type !== 'file')
                    .forEach((row) => {
                        if (row.key && row.key.trim()) {
                            textFields[row.key.trim()] = row.value ?? '';
                        }
                    });
                if (Object.keys(textFields).length) {
                    definition.body_type = 'form';
                    definition.body_form = textFields;
                }
            } else if (bodyMode === 'urlencoded') {
                const textFields = rowsToObject(bodyUrlEncoded);
                if (Object.keys(textFields).length) {
                    definition.body_type = 'form';
                    definition.body_form = textFields;
                }
            } else if (bodyMode === 'binary') {
                if (bodyBinary && bodyBinary.dataUrl) {
                    definition.body_type = 'raw';
                    definition.body_raw = '';
                }
            }

            return definition;
        };

        const bootstrap = async () => {
            try {
                const environments = await fetchJson(endpoints.environments);
                state.environments = normalizeList(environments);
                await refreshCollections({ preserveSelection: false });
                if (state.selectedCollectionId && state.selectedRequestId) {
                    setStatus('Ready to send the selected request.', 'neutral');
                }
                if (elements.runCollectionButton) {
                    elements.runCollectionButton.disabled = state.collections.length === 0;
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unable to load initial data.';
                setStatus(message, 'error');
            }
        };

        elements.form.addEventListener('submit', submitForm);

        if (elements.runCollectionButton) {
            elements.runCollectionButton.addEventListener('click', async () => {
                if (elements.runCollectionButton.disabled) {
                    return;
                }

                const collection = state.collections.find((item) => item.id === state.selectedCollectionId) || null;
                if (!collection) {
                    setStatus('Select a collection to run.', 'error');
                    return;
                }

                const environmentId = elements.environmentSelect.value || null;
                const urlTemplate = endpoints.runTemplate;
                if (!urlTemplate) {
                    setStatus('Run endpoint unavailable.', 'error');
                    return;
                }

                const runUrl = urlTemplate.replace(/0(?=\/run\/?$)/, String(collection.id));

                setStatus('Starting collection run...', 'loading');
                elements.runCollectionButton.disabled = true;

                try {
                    const response = await fetch(runUrl, {
                        method: 'POST',
                        credentials: 'include',
                        headers: {
                            'Content-Type': 'application/json',
                            Accept: 'application/json',
                            'X-CSRFToken': getCookie('csrftoken') || '',
                        },
                        body: JSON.stringify({
                            environment: environmentId,
                            overrides: {},
                        }),
                    });

                    const data = await response.json();
                    if (!response.ok) {
                        const message = data?.detail || data?.error || 'Failed to run collection.';
                        setStatus(message, 'error');
                    } else {
                        const runLabel = data?.id ? `Run #${data.id}` : 'Collection run';
                        setStatus(`${runLabel} started successfully.`, 'success');
                    }
                } catch (error) {
                    setStatus(error instanceof Error ? error.message : 'Unexpected error starting run.', 'error');
                } finally {
                    elements.runCollectionButton.disabled = false;
                }
            });
        }

        tabButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const target = button.dataset.tab;
                if (!target) {
                    return;
                }
                activateTab(target);
            });
            button.addEventListener('keydown', (event) => {
                if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
                    return;
                }
                event.preventDefault();
                const currentIndex = tabButtons.findIndex((item) => item.dataset.tab === state.activeTab);
                if (currentIndex === -1) {
                    return;
                }
                const delta = event.key === 'ArrowRight' ? 1 : -1;
                const nextIndex = (currentIndex + delta + tabButtons.length) % tabButtons.length;
                const nextTab = tabButtons[nextIndex].dataset.tab;
                activateTab(nextTab);
                tabButtons[nextIndex].focus();
            });
        });

        scriptTabButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const target = button.dataset.scriptTab;
                if (!target || target === state.activeScriptsTab) {
                    return;
                }
                activateScriptsTab(target, { focus: true });
            });
            button.addEventListener('keydown', (event) => {
                if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
                    return;
                }
                event.preventDefault();
                const currentIndex = scriptTabButtons.findIndex((item) => item.dataset.scriptTab === state.activeScriptsTab);
                if (currentIndex === -1) {
                    return;
                }
                const delta = event.key === 'ArrowRight' ? 1 : -1;
                const nextIndex = (currentIndex + delta + scriptTabButtons.length) % scriptTabButtons.length;
                const nextTab = scriptTabButtons[nextIndex].dataset.scriptTab;
                activateScriptsTab(nextTab, { focus: true });
                scriptTabButtons[nextIndex].focus();
            });
        });

        elements.search.addEventListener('input', (event) => {
            renderCollections(event.target.value);
        });

        elements.url.addEventListener('input', () => {
            updateRunButtonState();
        });

        elements.url.addEventListener('change', () => {
            if (suppressUrlSync) {
                return;
            }
            parseUrlIntoState(elements.url.value || '');
            renderParams();
            updateRunButtonState();
        });

        elements.addParamRow.addEventListener('click', () => {
            state.builder.params.push({ key: '', value: '', description: '' });
            renderParams();
        });

        elements.paramsBody.addEventListener('input', (event) => {
            const target = event.target;
            if (!target.classList.contains('kv-input')) {
                return;
            }
            const index = Number(target.dataset.index);
            const field = target.dataset.field;
            if (!Number.isFinite(index) || !field || !state.builder.params[index]) {
                return;
            }
            state.builder.params[index][field] = target.value;
            if (field === 'key' || field === 'value') {
                applyParamsToUrl();
            }
        });

        elements.paramsBody.addEventListener('click', (event) => {
            const target = event.target;
            if (!target.classList.contains('kv-remove')) {
                return;
            }
            const index = Number(target.dataset.index);
            if (!Number.isFinite(index)) {
                return;
            }
            state.builder.params.splice(index, 1);
            renderParams();
            applyParamsToUrl();
        });

        elements.addHeaderRow.addEventListener('click', () => {
            state.builder.headers.push({ key: '', value: '', description: undefined });
            renderHeaders();
        });

        elements.headersBody.addEventListener('input', (event) => {
            const target = event.target;
            if (!target.classList.contains('kv-input')) {
                return;
            }
            const index = Number(target.dataset.index);
            const field = target.dataset.field;
            if (!Number.isFinite(index) || !field || !state.builder.headers[index]) {
                return;
            }
            state.builder.headers[index][field] = target.value;
        });

        elements.headersBody.addEventListener('click', (event) => {
            const target = event.target;
            if (!target.classList.contains('kv-remove')) {
                return;
            }
            const index = Number(target.dataset.index);
            if (!Number.isFinite(index)) {
                return;
            }
            state.builder.headers.splice(index, 1);
            renderHeaders();
        });

        elements.authType.addEventListener('change', (event) => {
            state.builder.auth.type = event.target.value;
            updateAuthUI();
        });

        elements.authBasicUsername.addEventListener('input', (event) => {
            state.builder.auth.username = event.target.value;
        });
        elements.authBasicPassword.addEventListener('input', (event) => {
            state.builder.auth.password = event.target.value;
        });
        elements.authBearerToken.addEventListener('input', (event) => {
            state.builder.auth.token = event.target.value;
        });

        elements.bodyModeRadios.forEach((radio) => {
            radio.addEventListener('change', () => {
                state.builder.bodyMode = radio.value;
                updateBodyUI();
            });
        });

        elements.bodyRawType.addEventListener('change', (event) => {
            const nextType = event.target.value;
            state.builder.bodyRawType = nextType;
            formatRawTextForType(nextType);
            applyRawTypeSettings(nextType, { ensureTemplate: true });
            if (rawEditor) {
                rawEditor.focus();
                refreshRawEditor();
            }
        });

        if (!rawEditor && elements.bodyRawContainer) {
            const fallback = elements.bodyRawContainer.querySelector('textarea');
            if (fallback) {
                fallback.addEventListener('input', (event) => {
                    state.builder.bodyRawText = event.target.value;
                });
                fallback.addEventListener('blur', () => {
                    if (state.builder.bodyRawType === 'json') {
                        formatRawTextForType('json');
                    }
                });
            }
        }

        elements.addBodyFormRow.addEventListener('click', () => {
            state.builder.bodyFormData.push({
                key: '',
                value: '',
                type: 'text',
                fileName: '',
                fileType: '',
                fileSize: null,
                fileData: null,
            });
            renderBodyFormData();
        });

        elements.bodyFormBody.addEventListener('input', (event) => {
            const target = event.target;
            if (!target.classList.contains('kv-input')) {
                return;
            }
            const index = Number(target.dataset.index);
            const field = target.dataset.field;
            if (!Number.isFinite(index) || !field || !state.builder.bodyFormData[index]) {
                return;
            }
            if (field === 'type') {
                return;
            }
            state.builder.bodyFormData[index][field] = target.value;
        });

        elements.bodyFormBody.addEventListener('change', (event) => {
            const target = event.target;
            const index = Number(target.dataset.index);
            if (!Number.isFinite(index) || !state.builder.bodyFormData[index]) {
                return;
            }
            const row = state.builder.bodyFormData[index];
            if (target.classList.contains('form-data-type')) {
                row.type = target.value === 'file' ? 'file' : 'text';
                if (row.type === 'file') {
                    row.value = '';
                } else {
                    row.fileName = '';
                    row.fileType = '';
                    row.fileSize = null;
                    row.fileData = null;
                }
                renderBodyFormData();
                return;
            }
            if (!target.classList.contains('form-data-file-input')) {
                return;
            }
            const file = target.files?.[0];
            if (!file) {
                row.fileName = '';
                row.fileType = '';
                row.fileSize = null;
                row.fileData = null;
                renderBodyFormData();
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                row.fileName = file.name;
                row.fileType = file.type || 'application/octet-stream';
                row.fileSize = file.size || null;
                row.fileData = typeof reader.result === 'string' ? reader.result : null;
                renderBodyFormData();
            };
            reader.readAsDataURL(file);
        });

        elements.bodyFormBody.addEventListener('click', (event) => {
            if (event.target.classList.contains('form-data-file-clear')) {
                const index = Number(event.target.dataset.index);
                if (!Number.isFinite(index) || !state.builder.bodyFormData[index]) {
                    return;
                }
                const row = state.builder.bodyFormData[index];
                row.fileName = '';
                row.fileType = '';
                row.fileSize = null;
                row.fileData = null;
                renderBodyFormData();
                return;
            }
        });

        elements.bodyFormBody.addEventListener('click', (event) => {
            if (!event.target.classList.contains('kv-remove')) {
                return;
            }
            const index = Number(event.target.dataset.index);
            if (!Number.isFinite(index)) {
                return;
            }
            state.builder.bodyFormData.splice(index, 1);
            renderBodyFormData();
        });

        elements.addBodyUrlencodedRow.addEventListener('click', () => {
            state.builder.bodyUrlEncoded.push({ key: '', value: '', description: undefined });
            renderBodyUrlencoded();
        });

        elements.bodyUrlencodedBody.addEventListener('input', (event) => {
            const target = event.target;
            if (!target.classList.contains('kv-input')) {
                return;
            }
            const index = Number(target.dataset.index);
            const field = target.dataset.field;
            if (!Number.isFinite(index) || !field || !state.builder.bodyUrlEncoded[index]) {
                return;
            }
            state.builder.bodyUrlEncoded[index][field] = target.value;
        });

        elements.bodyUrlencodedBody.addEventListener('click', (event) => {
            if (!event.target.classList.contains('kv-remove')) {
                return;
            }
            const index = Number(event.target.dataset.index);
            if (!Number.isFinite(index)) {
                return;
            }
            state.builder.bodyUrlEncoded.splice(index, 1);
            renderBodyUrlencoded();
        });

        elements.bodyBinaryInput.addEventListener('change', (event) => {
            const file = event.target.files?.[0];
            if (!file) {
                state.builder.bodyBinary = null;
                elements.bodyBinaryInfo.textContent = 'No file selected.';
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                state.builder.bodyBinary = {
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    dataUrl: reader.result,
                };
                const sizeKb = Math.round(file.size / 1024);
                elements.bodyBinaryInfo.textContent = `${file.name} (${sizeKb} KB)`;
            };
            reader.onerror = () => {
                state.builder.bodyBinary = null;
                elements.bodyBinaryInfo.textContent = 'Failed to read file.';
            };
            reader.readAsDataURL(file);
        });

        if (elements.saveRequestButton) {
            elements.saveRequestButton.addEventListener('click', async () => {
                const collection = state.collections.find((item) => item.id === state.selectedCollectionId) || null;
                if (!collection) {
                    setStatus('Select a collection before saving.', 'error');
                    return;
                }

                const existingRequest = collection.requests.find((item) => item.id === state.selectedRequestId) || null;
                const defaultName = existingRequest?.name || 'New Request';
                const inputName = await promptForRequestName(defaultName);
                if (inputName === null) {
                    setStatus('Save cancelled.', 'neutral');
                    return;
                }

                const sanitizedName = inputName.trim();
                if (!sanitizedName) {
                    setStatus('Enter a request name to save.', 'error');
                    return;
                }

                if (!hasRunnableUrl()) {
                    setStatus('Enter a request URL before saving.', 'error');
                    return;
                }

                let definition;
                try {
                    definition = buildRequestDefinition({
                        name: sanitizedName,
                        collectionId: collection.id,
                    });
                } catch (error) {
                    setStatus(error instanceof Error ? error.message : 'Unable to build request payload.', 'error');
                    return;
                }

                const baseRequestsUrl = endpoints.requests;
                if (!baseRequestsUrl) {
                    setStatus('Save endpoint unavailable.', 'error');
                    return;
                }
                const requestsEndpoint = baseRequestsUrl.endsWith('/') ? baseRequestsUrl : `${baseRequestsUrl}/`;
                const detailUrl = existingRequest ? `${requestsEndpoint}${existingRequest.id}/` : requestsEndpoint;
                const method = existingRequest ? 'PATCH' : 'POST';

                setStatus('Saving request...', 'loading');
                try {
                    const response = await postJson(detailUrl, definition, method);
                    const savedRequestId = existingRequest?.id || response?.id || null;
                    await refreshCollections({
                        preserveSelection: false,
                        focusCollectionId: collection.id,
                        focusRequestId: savedRequestId,
                    });
                    setStatus('Request saved successfully.', 'success');
                } catch (error) {
                    setStatus(error instanceof Error ? error.message : 'Failed to save request.', 'error');
                }
            });
        }

        if (elements.saveRequestCancelButton) {
            elements.saveRequestCancelButton.addEventListener('click', cancelSaveModal);
        }

        if (elements.saveRequestConfirmButton) {
            elements.saveRequestConfirmButton.addEventListener('click', confirmSaveModal);
        }

        if (elements.saveRequestModal) {
            elements.saveRequestModal.addEventListener('click', (event) => {
                if (event.target === elements.saveRequestModal) {
                    cancelSaveModal();
                }
            });
        }

        if (elements.saveRequestNameInput) {
            elements.saveRequestNameInput.addEventListener('input', () => {
                elements.saveRequestNameInput.removeAttribute('aria-invalid');
            });
        }

        if (elements.createRequestButton) {
            elements.createRequestButton.addEventListener('click', () => {
                const collection = state.collections.find((item) => item.id === state.selectedCollectionId) || null;
                if (!collection) {
                    setStatus('Select a collection before creating a request.', 'error');
                    return;
                }
                startNewRequestDraft(collection);
            });
        }

        if (elements.collectionsActionsToggle) {
            elements.collectionsActionsToggle.addEventListener('click', (event) => {
                event.stopPropagation();
                if (state.isCollectionsActionMenuOpen) {
                    closeCollectionsActionMenu();
                } else {
                    closeCollectionMenu();
                    openCollectionsActionMenu();
                }
            });
        }

        if (elements.collectionsCreateAction) {
            elements.collectionsCreateAction.addEventListener('click', async (event) => {
                event.stopPropagation();
                closeCollectionsActionMenu();
                const inputName = await promptForCollectionName('New Collection');
                if (inputName === null) {
                    setStatus('Collection creation cancelled.', 'neutral');
                    return;
                }
                const sanitizedName = inputName.trim();
                if (!sanitizedName) {
                    setStatus('Enter a collection name to continue.', 'error');
                    return;
                }
                const baseCollectionsUrl = endpoints.collections;
                if (!baseCollectionsUrl) {
                    setStatus('Collection endpoint unavailable.', 'error');
                    return;
                }
                const collectionsEndpoint = baseCollectionsUrl.endsWith('/') ? baseCollectionsUrl : `${baseCollectionsUrl}/`;

                setStatus('Creating collection...', 'loading');
                try {
                    const response = await postJson(collectionsEndpoint, {
                        name: sanitizedName,
                        description: '',
                        requests: [],
                        environment_ids: [],
                    });
                    await refreshCollections({
                        preserveSelection: false,
                        focusCollectionId: response?.id || null,
                        focusRequestId: response?.requests?.[0]?.id || null,
                    });
                    setStatus('Collection created successfully.', 'success');
                } catch (error) {
                    setStatus(error instanceof Error ? error.message : 'Failed to create collection.', 'error');
                }
            });
        }

        if (elements.collectionsImportAction) {
            elements.collectionsImportAction.addEventListener('click', (event) => {
                event.stopPropagation();
                closeCollectionsActionMenu();
                if (elements.importPostmanInput) {
                    elements.importPostmanInput.click();
                } else {
                    setStatus('Import input unavailable.', 'error');
                }
            });
        }

        if (elements.importPostmanInput) {
            elements.importPostmanInput.addEventListener('change', async (event) => {
                const target = event.target;
                const file = target instanceof HTMLInputElement && target.files ? target.files[0] : null;
                if (!file) {
                    return;
                }
                await importCollectionFromPostman(file);
            });
        }

        document.addEventListener('click', (event) => {
            if (!state.isCollectionsActionMenuOpen) {
                return;
            }
            if (
                (elements.collectionsActionsMenu && elements.collectionsActionsMenu.contains(event.target)) ||
                (elements.collectionsActionsToggle && elements.collectionsActionsToggle.contains(event.target))
            ) {
                return;
            }
            closeCollectionsActionMenu();
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && state.isCollectionsActionMenuOpen) {
                closeCollectionsActionMenu();
            }
        });

        setStatus('Select a request to begin.', 'neutral');
        renderBuilder();
        bootstrap();
        renderResponse(null);
    });
})();
