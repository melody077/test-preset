// Preset Copier Extension for SillyTavern
// A프리셋 항목을 선택해서 B프리셋으로 복사/이동하는 확장 프로그램

const extensionName = 'preset-copier';
const GLOBAL_DUMMY_ID = 100001;

// Dynamic imports
let getRequestHeaders, callGenericPopup, POPUP_TYPE, POPUP_RESULT;
let openai_setting_names, openai_settings;

async function initImports() {
    const scriptPath = import.meta.url;
    const isThirdParty = scriptPath.includes('/third-party/');
    const base = isThirdParty ? '../../../../' : '../../../';
    const scriptsBase = isThirdParty ? '../../../' : '../../';

    const scriptModule = await import(base + 'script.js');
    getRequestHeaders = scriptModule.getRequestHeaders;

    const popupModule = await import(scriptsBase + 'popup.js');
    callGenericPopup = popupModule.callGenericPopup;
    POPUP_TYPE = popupModule.POPUP_TYPE;
    POPUP_RESULT = popupModule.POPUP_RESULT;

    try {
        const openaiModule = await import(scriptsBase + 'openai.js');
        openai_setting_names = openaiModule.openai_setting_names;
        openai_settings = openaiModule.openai_settings;
    } catch (e) {
        console.warn(`[${extensionName}] Could not import openai module:`, e);
    }
}

// ─────────────────────────────────────────────
// Preset type definitions
// ─────────────────────────────────────────────
const PRESET_TYPES = {
    openai: { label: 'OpenAI (Chat Completion)', apiId: 'openai', dir: 'OpenAI Settings' },
    textgenerationwebui: { label: 'Text Generation', apiId: 'textgenerationwebui', dir: 'TextGen Settings' },
    kobold: { label: 'KoboldAI', apiId: 'kobold', dir: 'KoboldAI Settings' },
    novel: { label: 'NovelAI', apiId: 'novel', dir: 'NovelAI Settings' },
    instruct: { label: 'Instruct', apiId: 'instruct', dir: 'instruct' },
    context: { label: 'Context', apiId: 'context', dir: 'context' },
    sysprompt: { label: 'System Prompt', apiId: 'sysprompt', dir: 'sysprompt' },
    reasoning: { label: 'Reasoning', apiId: 'reasoning', dir: 'reasoning' },
};

// Fields to skip when displaying (internal/meta fields)
const SKIP_FIELDS = new Set(['preset', 'api_url_scale']);

// ─────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────

/**
 * Fetch all preset names for a given type via the PresetManager select element.
 */
function getPresetNamesFromDOM(apiId) {
    const selectors = {
        openai: '#settings_preset_openai',
        textgenerationwebui: '#settings_preset',
        kobold: '#settings_preset',
        novel: '#settings_preset',
        instruct: '#instruct_presets',
        context: '#context_presets',
        sysprompt: '#sysprompt_presets',
        reasoning: '#reasoning_presets',
    };
    const sel = selectors[apiId];
    if (!sel) return [];
    const el = document.querySelector(sel);
    if (!el) return [];
    return Array.from(el.options)
        .filter(o => o.value && o.value !== 'default')
        .map(o => ({ value: o.value, text: o.text || o.value }));
}

/**
 * Load preset files from the server for a given preset type.
 */
async function loadPresetFile(apiId, name) {
    // For OpenAI, use the in-memory objects
    if (apiId === 'openai' && openai_settings && openai_setting_names) {
        const idx = openai_setting_names[name];
        if (idx !== undefined && openai_settings[idx]) {
            return JSON.parse(JSON.stringify(openai_settings[idx]));
        }
    }

    // For other types: fetch from /api/presets endpoint
    try {
        const response = await fetch('/api/presets/restore', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ apiId, name }),
        });
        if (response.ok) {
            return await response.json();
        }
    } catch (e) {
        // fall through
    }

    // Try loading via settings API - use PresetManager if available
    try {
        const { getPresetManager } = await import(
            (import.meta.url.includes('/third-party/') ? '../../../' : '../../') + 'preset-manager.js'
        );
        const manager = getPresetManager(apiId);
        if (manager) {
            const preset = manager.getCompletionPresetByName(name);
            if (preset) return JSON.parse(JSON.stringify(preset));
        }
    } catch (e) {
        console.warn(`[${extensionName}] Could not use PresetManager for ${apiId}:`, e);
    }

    return null;
}

/**
 * Save a preset via the API.
 */
async function savePresetToServer(apiId, name, preset) {
    const response = await fetch('/api/presets/save', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ apiId, name, preset }),
    });
    if (!response.ok) {
        throw new Error(`Failed to save preset: ${response.statusText}`);
    }

    // Sync in-memory for OpenAI
    if (apiId === 'openai' && openai_settings && openai_setting_names) {
        const idx = openai_setting_names[name];
        if (idx !== undefined) {
            openai_settings[idx] = JSON.parse(JSON.stringify(preset));
        }
    }

    return await response.json();
}

// ─────────────────────────────────────────────
// Field rendering helpers
// ─────────────────────────────────────────────

/**
 * Generate a human-readable preview of a value.
 */
function formatValue(val) {
    if (val === null || val === undefined) return '<em>null</em>';
    if (typeof val === 'boolean') return val ? '✅ true' : '❌ false';
    if (typeof val === 'number') return String(val);
    if (typeof val === 'string') {
        const escaped = val.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        if (val.length > 80) return `"${escaped.substring(0, 80)}…"`;
        return `"${escaped}"`;
    }
    if (Array.isArray(val)) {
        if (val.length === 0) return '[ ]';
        return `[${val.length} items]`;
    }
    if (typeof val === 'object') {
        const keys = Object.keys(val);
        return `{${keys.length} keys}`;
    }
    return String(val);
}

/**
 * Determine a display label for a preset field key.
 */
function fieldLabel(key) {
    const labels = {
        temperature: '🌡️ Temperature',
        temp: '🌡️ Temperature',
        top_p: '🎯 Top P',
        top_k: '🔢 Top K',
        min_p: '📉 Min P',
        frequency_penalty: '🔁 Frequency Penalty',
        presence_penalty: '👤 Presence Penalty',
        repetition_penalty: '🔁 Repetition Penalty',
        rep_pen: '🔁 Repetition Penalty',
        max_tokens: '📏 Max Tokens',
        openai_max_tokens: '📏 Max Tokens',
        max_length: '📏 Max Length',
        prompts: '💬 Prompts',
        prompt_order: '📋 Prompt Order',
        name: '📛 Name',
        content: '📝 Content',
        input_sequence: '▶️ Input Sequence',
        output_sequence: '◀️ Output Sequence',
        system_sequence: '⚙️ System Sequence',
        stop_sequence: '🛑 Stop Sequence',
        story_string: '📖 Story String',
        chat_start: '💬 Chat Start',
        example_separator: '📎 Example Separator',
    };
    return labels[key] || key;
}

// ─────────────────────────────────────────────
// OpenAI specific: prompt-level operations
// ─────────────────────────────────────────────

function getPromptOrder(preset) {
    if (!preset?.prompt_order) return [];
    const entry = preset.prompt_order.find(o => String(o.character_id) === String(GLOBAL_DUMMY_ID));
    return entry?.order || [];
}

function getOrderedPrompts(preset) {
    const order = getPromptOrder(preset);
    const prompts = preset?.prompts || [];
    return order.map(entry => {
        const def = prompts.find(p => p.identifier === entry.identifier);
        return {
            identifier: entry.identifier,
            enabled: entry.enabled,
            prompt: def || { identifier: entry.identifier, name: entry.identifier },
        };
    });
}

// ─────────────────────────────────────────────
// Main popup
// ─────────────────────────────────────────────

let state = {
    presetType: '',
    sourcePresetName: '',
    targetPresetName: '',
    sourcePreset: null,
    targetPreset: null,
    selectedFields: new Set(),
    // OpenAI prompts specific
    selectedPromptIndices: new Set(),
    targetInsertPosition: -1,
};

function resetState() {
    state = {
        presetType: '',
        sourcePresetName: '',
        targetPresetName: '',
        sourcePreset: null,
        targetPreset: null,
        selectedFields: new Set(),
        selectedPromptIndices: new Set(),
        targetInsertPosition: -1,
    };
}

function createPopupHtml() {
    const typeOptions = Object.entries(PRESET_TYPES)
        .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
        .join('');

    return `
        <div id="pc-container">
            <div class="pc-header">
                <div class="pc-row">
                    <label>프리셋 타입</label>
                    <select id="pc-preset-type">
                        <option value="">-- 선택 --</option>
                        ${typeOptions}
                    </select>
                </div>
            </div>
            
            <div class="pc-panels">
                <div class="pc-panel pc-panel-source">
                    <div class="pc-panel-title">📤 소스 프리셋 (A)</div>
                    <select id="pc-source-select">
                        <option value="">-- 먼저 타입을 선택 --</option>
                    </select>
                    <div class="pc-field-list" id="pc-source-fields">
                        <div class="pc-placeholder">프리셋을 선택하세요</div>
                    </div>
                    <div class="pc-select-actions" id="pc-select-actions" style="display:none;">
                        <button id="pc-select-all" class="menu_button menu_button_icon" title="전체 선택">
                            <i class="fa-solid fa-check-double"></i> 전체 선택
                        </button>
                        <button id="pc-select-none" class="menu_button menu_button_icon" title="선택 해제">
                            <i class="fa-solid fa-xmark"></i> 선택 해제
                        </button>
                    </div>
                </div>
                
                <div class="pc-panel pc-panel-target">
                    <div class="pc-panel-title">📥 대상 프리셋 (B)</div>
                    <select id="pc-target-select">
                        <option value="">-- 먼저 타입을 선택 --</option>
                    </select>
                    <div class="pc-field-list" id="pc-target-fields">
                        <div class="pc-placeholder">프리셋을 선택하세요</div>
                    </div>
                </div>
            </div>

            <div class="pc-actions">
                <button id="pc-btn-copy" class="menu_button menu_button_icon" disabled>
                    <i class="fa-solid fa-copy"></i> 선택 항목 복사
                </button>
                <button id="pc-btn-move" class="menu_button menu_button_icon" disabled>
                    <i class="fa-solid fa-arrow-right"></i> 선택 항목 이동
                </button>
            </div>
        </div>
    `;
}

function renderPresetOptions(selectEl, apiId) {
    // Clear existing options
    selectEl.innerHTML = '<option value="">-- 선택 --</option>';

    if (apiId === 'openai' && openai_settings && openai_setting_names) {
        // For OpenAI, use in-memory preset names
        for (const name of Object.keys(openai_setting_names)) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            selectEl.appendChild(opt);
        }
    } else {
        const options = getPresetNamesFromDOM(apiId);
        for (const o of options) {
            const opt = document.createElement('option');
            opt.value = o.text;
            opt.textContent = o.text;
            selectEl.appendChild(opt);
        }
    }
}

function renderSourceFields(container) {
    const fieldsEl = container.querySelector('#pc-source-fields');
    const actionsEl = container.querySelector('#pc-select-actions');
    if (!fieldsEl) return;

    if (!state.sourcePreset) {
        fieldsEl.innerHTML = '<div class="pc-placeholder">프리셋을 선택하세요</div>';
        if (actionsEl) actionsEl.style.display = 'none';
        return;
    }

    const preset = state.sourcePreset;
    const apiId = state.presetType;

    // For OpenAI: show individual prompts as copyable items
    if (apiId === 'openai') {
        renderOpenAISourceFields(fieldsEl, preset);
    } else {
        renderGenericSourceFields(fieldsEl, preset);
    }

    if (actionsEl) actionsEl.style.display = 'flex';
}

function renderOpenAISourceFields(fieldsEl, preset) {
    const orderedPrompts = getOrderedPrompts(preset);
    const otherKeys = Object.keys(preset).filter(k =>
        k !== 'prompts' && k !== 'prompt_order' && !SKIP_FIELDS.has(k),
    );

    let html = '';

    // Show setting fields first
    if (otherKeys.length > 0) {
        html += '<div class="pc-group-title">⚙️ 설정값</div>';
        for (const key of otherKeys) {
            const checked = state.selectedFields.has(key) ? 'checked' : '';
            html += `
                <div class="pc-field-item" data-field="${key}">
                    <input type="checkbox" class="pc-field-check" data-field="${key}" ${checked}>
                    <span class="pc-field-key">${fieldLabel(key)}</span>
                    <span class="pc-field-value">${formatValue(preset[key])}</span>
                </div>
            `;
        }
    }

    // Show prompts
    if (orderedPrompts.length > 0) {
        html += '<div class="pc-group-title">💬 프롬프트</div>';
        orderedPrompts.forEach((entry, index) => {
            const prompt = entry.prompt;
            const name = prompt.name || prompt.identifier || 'Unnamed';
            const markerIcon = prompt.marker ? '📍 ' : '';
            const checked = state.selectedPromptIndices.has(index) ? 'checked' : '';
            html += `
                <div class="pc-field-item pc-prompt-item" data-prompt-index="${index}">
                    <input type="checkbox" class="pc-prompt-check" data-prompt-index="${index}" ${checked}>
                    <span class="pc-field-key">${markerIcon}${name}</span>
                    <span class="pc-field-value pc-prompt-id">[${entry.identifier}]</span>
                    <span class="pc-field-value">${entry.enabled ? '✅' : '❌'}</span>
                </div>
            `;
        });
    }

    fieldsEl.innerHTML = html || '<div class="pc-placeholder">항목 없음</div>';

    // Attach checkbox events
    fieldsEl.querySelectorAll('.pc-field-check').forEach(cb => {
        cb.addEventListener('change', () => {
            const field = cb.dataset.field;
            if (cb.checked) state.selectedFields.add(field);
            else state.selectedFields.delete(field);
            updateButtons(fieldsEl.closest('#pc-container'));
        });
    });

    fieldsEl.querySelectorAll('.pc-prompt-check').forEach(cb => {
        cb.addEventListener('change', () => {
            const idx = parseInt(cb.dataset.promptIndex);
            if (cb.checked) state.selectedPromptIndices.add(idx);
            else state.selectedPromptIndices.delete(idx);
            updateButtons(fieldsEl.closest('#pc-container'));
        });
    });
}

function renderGenericSourceFields(fieldsEl, preset) {
    const keys = Object.keys(preset).filter(k => !SKIP_FIELDS.has(k));

    if (keys.length === 0) {
        fieldsEl.innerHTML = '<div class="pc-placeholder">항목 없음</div>';
        return;
    }

    let html = '';
    for (const key of keys) {
        const checked = state.selectedFields.has(key) ? 'checked' : '';
        html += `
            <div class="pc-field-item" data-field="${key}">
                <input type="checkbox" class="pc-field-check" data-field="${key}" ${checked}>
                <span class="pc-field-key">${fieldLabel(key)}</span>
                <span class="pc-field-value">${formatValue(preset[key])}</span>
            </div>
        `;
    }

    fieldsEl.innerHTML = html;

    fieldsEl.querySelectorAll('.pc-field-check').forEach(cb => {
        cb.addEventListener('change', () => {
            const field = cb.dataset.field;
            if (cb.checked) state.selectedFields.add(field);
            else state.selectedFields.delete(field);
            updateButtons(fieldsEl.closest('#pc-container'));
        });
    });
}

function renderTargetFields(container) {
    const fieldsEl = container.querySelector('#pc-target-fields');
    if (!fieldsEl) return;

    if (!state.targetPreset) {
        fieldsEl.innerHTML = '<div class="pc-placeholder">프리셋을 선택하세요</div>';
        return;
    }

    const preset = state.targetPreset;
    const apiId = state.presetType;

    if (apiId === 'openai') {
        renderOpenAITargetFields(fieldsEl, preset);
    } else {
        renderGenericTargetFields(fieldsEl, preset);
    }
}

function renderOpenAITargetFields(fieldsEl, preset) {
    const orderedPrompts = getOrderedPrompts(preset);
    const otherKeys = Object.keys(preset).filter(k =>
        k !== 'prompts' && k !== 'prompt_order' && !SKIP_FIELDS.has(k),
    );

    let html = '';

    if (otherKeys.length > 0) {
        html += '<div class="pc-group-title">⚙️ 설정값</div>';
        for (const key of otherKeys) {
            html += `
                <div class="pc-field-item pc-target-item" data-field="${key}">
                    <span class="pc-field-key">${fieldLabel(key)}</span>
                    <span class="pc-field-value">${formatValue(preset[key])}</span>
                </div>
            `;
        }
    }

    if (orderedPrompts.length > 0) {
        html += '<div class="pc-group-title">💬 프롬프트 (삽입 위치 선택)</div>';

        // Insert slot before first
        html += `<div class="pc-insert-slot ${state.targetInsertPosition === 0 ? 'selected' : ''}" data-slot="0">
            <span class="pc-slot-icon">➕</span> 맨 위에 삽입
        </div>`;

        orderedPrompts.forEach((entry, index) => {
            const prompt = entry.prompt;
            const name = prompt.name || prompt.identifier || 'Unnamed';
            const markerIcon = prompt.marker ? '📍 ' : '';
            html += `
                <div class="pc-field-item pc-target-item" data-index="${index}">
                    <span class="pc-prompt-idx">#${index + 1}</span>
                    <span class="pc-field-key">${markerIcon}${name}</span>
                    <span class="pc-field-value pc-prompt-id">[${entry.identifier}]</span>
                    <span class="pc-field-value">${entry.enabled ? '✅' : '❌'}</span>
                </div>
            `;

            const slotIdx = index + 1;
            html += `<div class="pc-insert-slot ${state.targetInsertPosition === slotIdx ? 'selected' : ''}" data-slot="${slotIdx}">
                <span class="pc-slot-icon">➕</span> 여기에 삽입
            </div>`;
        });
    } else {
        html += `<div class="pc-insert-slot ${state.targetInsertPosition === 0 ? 'selected' : ''}" data-slot="0">
            <span class="pc-slot-icon">➕</span> 여기에 삽입
        </div>`;
    }

    fieldsEl.innerHTML = html || '<div class="pc-placeholder">항목 없음</div>';

    // Insert slot click handlers
    const pcContainer = fieldsEl.closest('#pc-container');
    fieldsEl.querySelectorAll('.pc-insert-slot').forEach(slot => {
        slot.addEventListener('click', () => {
            state.targetInsertPosition = parseInt(slot.dataset.slot);
            renderTargetFields(pcContainer);
            updateButtons(pcContainer);
        });
    });
}

function renderGenericTargetFields(fieldsEl, preset) {
    const keys = Object.keys(preset).filter(k => !SKIP_FIELDS.has(k));

    if (keys.length === 0) {
        fieldsEl.innerHTML = '<div class="pc-placeholder">항목 없음</div>';
        return;
    }

    let html = '';
    for (const key of keys) {
        html += `
            <div class="pc-field-item pc-target-item" data-field="${key}">
                <span class="pc-field-key">${fieldLabel(key)}</span>
                <span class="pc-field-value">${formatValue(preset[key])}</span>
            </div>
        `;
    }

    fieldsEl.innerHTML = html;
}

function updateButtons(container) {
    const copyBtn = container.querySelector('#pc-btn-copy');
    const moveBtn = container.querySelector('#pc-btn-move');

    const hasSelection = state.selectedFields.size > 0 || state.selectedPromptIndices.size > 0;
    const hasBothPresets = state.sourcePresetName && state.targetPresetName;
    const isDifferent = state.sourcePresetName !== state.targetPresetName;

    // For OpenAI prompt copies, we need an insert position
    const needsInsertPos = state.presetType === 'openai' && state.selectedPromptIndices.size > 0;
    const hasInsertPos = state.targetInsertPosition >= 0;
    const canAct = hasSelection && hasBothPresets && isDifferent &&
                   (!needsInsertPos || hasInsertPos);

    if (copyBtn) copyBtn.disabled = !canAct;
    if (moveBtn) moveBtn.disabled = !canAct;
}

// ─────────────────────────────────────────────
// Copy / Move operations
// ─────────────────────────────────────────────

async function performCopyMove(container, removeFromSource) {
    const apiId = state.presetType;

    if (!state.sourcePreset || !state.targetPreset) {
        toastr.error('소스와 대상 프리셋을 모두 선택하세요');
        return;
    }

    try {
        const targetPreset = JSON.parse(JSON.stringify(state.targetPreset));
        const sourcePreset = JSON.parse(JSON.stringify(state.sourcePreset));

        // Copy selected fields (non-prompt fields)
        for (const field of state.selectedFields) {
            targetPreset[field] = JSON.parse(JSON.stringify(state.sourcePreset[field]));
            if (removeFromSource && field !== 'name') {
                delete sourcePreset[field];
            }
        }

        // OpenAI: copy selected prompts
        if (apiId === 'openai' && state.selectedPromptIndices.size > 0) {
            const orderedPrompts = getOrderedPrompts(state.sourcePreset);
            const selectedIndices = Array.from(state.selectedPromptIndices).sort((a, b) => a - b);

            targetPreset.prompts = targetPreset.prompts || [];
            targetPreset.prompt_order = targetPreset.prompt_order || [];

            let targetOrderEntry = targetPreset.prompt_order.find(
                o => String(o.character_id) === String(GLOBAL_DUMMY_ID),
            );
            if (!targetOrderEntry) {
                targetOrderEntry = { character_id: GLOBAL_DUMMY_ID, order: [] };
                targetPreset.prompt_order.push(targetOrderEntry);
            }

            const existingIds = new Set(targetPreset.prompts.map(p => p.identifier));
            let insertIdx = state.targetInsertPosition >= 0 ? state.targetInsertPosition : targetOrderEntry.order.length;

            for (const srcIdx of selectedIndices) {
                const entry = orderedPrompts[srcIdx];
                if (!entry) continue;

                const promptDef = JSON.parse(JSON.stringify(entry.prompt));

                // Handle duplicate identifiers
                let newIdentifier = promptDef.identifier;
                if (existingIds.has(newIdentifier)) {
                    let counter = 1;
                    const baseName = newIdentifier.replace(/_\d+$/, '');
                    while (existingIds.has(`${baseName}_${counter}`)) counter++;
                    newIdentifier = `${baseName}_${counter}`;
                    promptDef.identifier = newIdentifier;
                    promptDef.name = `${promptDef.name || entry.identifier} (${counter})`;
                }

                targetPreset.prompts.push(promptDef);
                existingIds.add(newIdentifier);

                targetOrderEntry.order.splice(insertIdx, 0, {
                    identifier: newIdentifier,
                    enabled: entry.enabled,
                });
                insertIdx++;

                // Also add to character-specific orders
                for (const orderEntry of targetPreset.prompt_order) {
                    if (String(orderEntry.character_id) !== String(GLOBAL_DUMMY_ID) && orderEntry.order) {
                        orderEntry.order.push({ identifier: newIdentifier, enabled: entry.enabled });
                    }
                }
            }

            // Remove from source if moving
            if (removeFromSource) {
                for (const srcIdx of selectedIndices.reverse()) {
                    const entry = orderedPrompts[srcIdx];
                    if (!entry) continue;

                    const removedId = entry.identifier;
                    const promptIdx = sourcePreset.prompts?.findIndex(p => p.identifier === removedId);
                    if (promptIdx >= 0) {
                        sourcePreset.prompts.splice(promptIdx, 1);
                    }
                    if (sourcePreset.prompt_order) {
                        for (const order of sourcePreset.prompt_order) {
                            if (order.order) {
                                order.order = order.order.filter(o => o.identifier !== removedId);
                            }
                        }
                    }
                }
            }
        }

        // Save target
        await savePresetToServer(apiId, state.targetPresetName, targetPreset);
        state.targetPreset = targetPreset;

        // Save source if moving
        if (removeFromSource) {
            await savePresetToServer(apiId, state.sourcePresetName, sourcePreset);
            state.sourcePreset = sourcePreset;
        }

        toastr.success(removeFromSource ? '이동 완료!' : '복사 완료!');

        // Reset selections and refresh
        state.selectedFields.clear();
        state.selectedPromptIndices.clear();
        state.targetInsertPosition = -1;

        renderSourceFields(container);
        renderTargetFields(container);
        updateButtons(container);

    } catch (error) {
        console.error(`[${extensionName}] Operation error:`, error);
        toastr.error('작업 실패: ' + error.message);
    }
}

// ─────────────────────────────────────────────
// Main popup open
// ─────────────────────────────────────────────

async function openPresetCopierPopup() {
    try {
        resetState();

        const container = document.createElement('div');
        container.innerHTML = createPopupHtml();

        const pcContainer = container.querySelector('#pc-container');

        // Preset type change
        container.querySelector('#pc-preset-type')?.addEventListener('change', async (e) => {
            state.presetType = e.target.value;
            state.sourcePresetName = '';
            state.targetPresetName = '';
            state.sourcePreset = null;
            state.targetPreset = null;
            state.selectedFields.clear();
            state.selectedPromptIndices.clear();
            state.targetInsertPosition = -1;

            const srcSelect = container.querySelector('#pc-source-select');
            const tgtSelect = container.querySelector('#pc-target-select');

            if (state.presetType) {
                renderPresetOptions(srcSelect, state.presetType);
                renderPresetOptions(tgtSelect, state.presetType);
            } else {
                srcSelect.innerHTML = '<option value="">-- 먼저 타입을 선택 --</option>';
                tgtSelect.innerHTML = '<option value="">-- 먼저 타입을 선택 --</option>';
            }

            renderSourceFields(pcContainer);
            renderTargetFields(pcContainer);
            updateButtons(pcContainer);
        });

        // Source preset change
        container.querySelector('#pc-source-select')?.addEventListener('change', async (e) => {
            state.sourcePresetName = e.target.value;
            state.sourcePreset = null;
            state.selectedFields.clear();
            state.selectedPromptIndices.clear();

            if (state.sourcePresetName && state.presetType) {
                state.sourcePreset = await loadPresetFile(state.presetType, state.sourcePresetName);
            }

            renderSourceFields(pcContainer);
            updateButtons(pcContainer);
        });

        // Target preset change
        container.querySelector('#pc-target-select')?.addEventListener('change', async (e) => {
            state.targetPresetName = e.target.value;
            state.targetPreset = null;
            state.targetInsertPosition = -1;

            if (state.targetPresetName && state.presetType) {
                state.targetPreset = await loadPresetFile(state.presetType, state.targetPresetName);
            }

            renderTargetFields(pcContainer);
            updateButtons(pcContainer);
        });

        // Select all / none
        container.querySelector('#pc-select-all')?.addEventListener('click', () => {
            if (!state.sourcePreset) return;
            const keys = Object.keys(state.sourcePreset).filter(k => !SKIP_FIELDS.has(k));
            if (state.presetType === 'openai') {
                // Select non-prompt fields
                for (const k of keys.filter(k => k !== 'prompts' && k !== 'prompt_order')) {
                    state.selectedFields.add(k);
                }
                // Select all prompts
                const orderedPrompts = getOrderedPrompts(state.sourcePreset);
                for (let i = 0; i < orderedPrompts.length; i++) {
                    state.selectedPromptIndices.add(i);
                }
            } else {
                for (const k of keys) {
                    state.selectedFields.add(k);
                }
            }
            renderSourceFields(pcContainer);
            updateButtons(pcContainer);
        });

        container.querySelector('#pc-select-none')?.addEventListener('click', () => {
            state.selectedFields.clear();
            state.selectedPromptIndices.clear();
            renderSourceFields(pcContainer);
            updateButtons(pcContainer);
        });

        // Copy / Move buttons
        container.querySelector('#pc-btn-copy')?.addEventListener('click', () => {
            performCopyMove(pcContainer, false);
        });

        container.querySelector('#pc-btn-move')?.addEventListener('click', () => {
            performCopyMove(pcContainer, true);
        });

        await callGenericPopup(container, POPUP_TYPE.TEXT, '', {
            okButton: '닫기',
            cancelButton: false,
            wide: true,
            large: true,
        });

    } catch (error) {
        console.error(`[${extensionName}] Popup error:`, error);
        toastr.error('Preset Copier를 열 수 없습니다');
    }
}

// ─────────────────────────────────────────────
// Extension panel in settings
// ─────────────────────────────────────────────

function addExtensionPanel() {
    const tryAdd = () => {
        if (document.getElementById('preset_copier_container')) return true;

        const settingsPanel = document.getElementById('extensions_settings2');
        if (!settingsPanel) return false;

        const container = document.createElement('div');
        container.id = 'preset_copier_container';
        container.className = 'extension_container';
        container.innerHTML = `
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Preset Copier</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <p style="margin-bottom: 8px;">프리셋 항목를 다른 프리셋으로 복사/이동합니다.</p>
                    <div id="pc-open-btn" class="menu_button menu_button_icon">
                        <i class="fa-solid fa-copy"></i>
                        <span>Preset Copier 열기</span>
                    </div>
                </div>
            </div>
        `;
        container.querySelector('#pc-open-btn').addEventListener('click', openPresetCopierPopup);
        settingsPanel.appendChild(container);
        return true;
    };

    if (tryAdd()) return;

    let count = 0;
    const timer = setInterval(() => {
        if (tryAdd() || ++count > 50) clearInterval(timer);
    }, 200);
}

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────

jQuery(async () => {
    console.log(`[${extensionName}] Loading...`);
    try {
        await initImports();
        addExtensionPanel();
        console.log(`[${extensionName}] Loaded successfully`);
    } catch (error) {
        console.error(`[${extensionName}] Failed to load:`, error);
    }
});
