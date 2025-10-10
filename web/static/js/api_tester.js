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
        urlBase: '',
        builder: getInitialBuilderState(),
        activeTab: 'params',
        activeScriptsTab: 'pre',
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
        };

        const endpoints = {
            collections: root.dataset.collectionsUrl,
            environments: root.dataset.environmentsUrl,
            execute: root.dataset.executeUrl,
            runTemplate: root.dataset.runUrlTemplate,
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

        const highlightSelection = () => {
            const cards = elements.collectionsList.querySelectorAll('.collection-card');
            cards.forEach((card) => {
                card.classList.toggle('active', Number(card.dataset.collectionId) === state.selectedCollectionId);
                const requestButtons = card.querySelectorAll('.request-item button');
                requestButtons.forEach((button) => {
                    const isActive = Number(button.dataset.requestId) === state.selectedRequestId;
                    button.classList.toggle('active', isActive);
                });
            });
        };

        const renderEnvironmentOptions = (collection) => {
            const select = elements.environmentSelect;
            const options = ['<option value="">No environment</option>'];
            state.environments.forEach((env) => {
                const isLinked = collection?.environments?.some((item) => item.id === env.id);
                const suffix = isLinked ? ' (linked)' : '';
                options.push(`<option value="${env.id}" data-linked="${isLinked}">${escapeHtml(env.name)}${suffix}</option>`);
            });
            select.innerHTML = options.join('');
            if (collection?.environments?.length) {
                select.value = collection.environments[0].id;
            } else {
                select.value = '';
            }
        };

        const renderCollections = (filterText = '') => {
            const list = elements.collectionsList;
            list.innerHTML = '';
            const normalized = filterText.trim().toLowerCase();
            const filtered = !normalized
                ? state.collections
                : state.collections.filter((collection) =>
                      collection.name.toLowerCase().includes(normalized) ||
                      (collection.description || '').toLowerCase().includes(normalized),
                  );

            if (!filtered.length) {
                list.innerHTML = '<p class="muted">No collections found.</p>';
                return;
            }

            filtered.forEach((collection) => {
                const sortedRequests = Array.isArray(collection.requests)
                    ? [...collection.requests].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                    : [];
                const card = document.createElement('article');
                card.className = 'collection-card';
                card.dataset.collectionId = collection.id;
                card.innerHTML = `
                    <div class="collection-name">
                        <span>${escapeHtml(collection.name)}</span>
                        <span class="request-count">${sortedRequests.length} requests</span>
                    </div>
                    <div class="collection-desc">${escapeHtml(collection.description || 'No description provided.')}</div>
                `;

                if (collection.environments?.length) {
                    const envWrap = document.createElement('div');
                    envWrap.className = 'env-pill-group';
                    collection.environments.forEach((env) => {
                        const pill = document.createElement('span');
                        pill.className = 'env-pill';
                        pill.textContent = env.name;
                        envWrap.appendChild(pill);
                    });
                    card.appendChild(envWrap);
                }

                const requestList = document.createElement('ul');
                requestList.className = 'request-list';
                sortedRequests.forEach((request) => {
                    const listItem = document.createElement('li');
                    listItem.className = 'request-item';
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.dataset.collectionId = collection.id;
                    button.dataset.requestId = request.id;
                    button.textContent = `${request.method} · ${request.name}`;
                    button.addEventListener('click', (event) => {
                        event.stopPropagation();
                        state.selectedCollectionId = collection.id;
                        state.selectedRequestId = request.id;
                        highlightSelection();
                        renderEnvironmentOptions(collection);
                        populateForm(collection, request);
                    });
                    listItem.appendChild(button);
                    requestList.appendChild(listItem);
                });

                card.addEventListener('click', () => {
                    state.selectedCollectionId = collection.id;
                    const firstRequest = collection.requests[0];
                    state.selectedRequestId = firstRequest ? firstRequest.id : null;
                    highlightSelection();
                    renderEnvironmentOptions(collection);
                    populateForm(collection, firstRequest || null);
                });

                if (!sortedRequests.length) {
                    const empty = document.createElement('p');
                    empty.className = 'muted';
                    empty.textContent = 'Collection has no requests yet.';
                    card.appendChild(empty);
                } else {
                    card.appendChild(requestList);
                }

                list.appendChild(card);
            });

            highlightSelection();
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

        const bootstrap = async () => {
            try {
                const [collections, environments] = await Promise.all([
                    fetchJson(endpoints.collections),
                    fetchJson(endpoints.environments),
                ]);
                state.collections = normalizeList(collections).map((collection) => ({
                    ...collection,
                    requests: Array.isArray(collection.requests)
                        ? [...collection.requests].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                        : [],
                }));
                state.environments = normalizeList(environments);
                renderEnvironmentOptions(null);
                renderCollections();
                const firstCollection = state.collections.find((item) => Array.isArray(item.requests) && item.requests.length);
                if (firstCollection) {
                    state.selectedCollectionId = firstCollection.id;
                    state.selectedRequestId = firstCollection.requests[0]?.id || null;
                    renderEnvironmentOptions(firstCollection);
                    populateForm(firstCollection, firstCollection.requests[0] || null);
                    highlightSelection();
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

        setStatus('Select a request to begin.', 'neutral');
        renderBuilder();
        bootstrap();
        renderResponse(null);
    });
})();
