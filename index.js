// Preset Copier Extension for SillyTavern
// OpenAI Chat Completion 프리셋 프롬프트를 복사/이동 — 모달 오버레이 팝업

const extensionName = 'preset-copier';
const GLOBAL_DUMMY_ID = 100001;

// ── Imports ──────────────────────────────────────────
let getRequestHeaders, openai_setting_names, openai_settings;

async function initImports() {
    const isThirdParty = import.meta.url.includes('/third-party/');
    const base = isThirdParty ? '../../../../' : '../../../';
    const scriptsBase = isThirdParty ? '../../../' : '../../';

    const scriptModule = await import(base + 'script.js');
    getRequestHeaders = scriptModule.getRequestHeaders;

    try {
        const openaiModule = await import(scriptsBase + 'openai.js');
        openai_setting_names = openaiModule.openai_setting_names;
        openai_settings = openaiModule.openai_settings;
    } catch (e) {
        console.warn(`[${extensionName}] Could not import openai module`, e);
    }
}

// ── OpenAI helpers ───────────────────────────────────
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

async function savePresetToServer(name, preset) {
    const response = await fetch('/api/presets/save', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ apiId: 'openai', name, preset }),
    });
    if (!response.ok) throw new Error('Failed to save preset');
    return response.json();
}

function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Modal overlay popup ──────────────────────────────
let overlayEl = null;

function closeModal() {
    if (overlayEl) {
        overlayEl.remove();
        overlayEl = null;
    }
}

function openModal() {
    // already open
    if (overlayEl && document.body.contains(overlayEl)) return;

    const presets = {};
    if (openai_settings && openai_setting_names) {
        for (const [name, index] of Object.entries(openai_setting_names)) {
            if (openai_settings[index]) presets[name] = openai_settings[index];
        }
    }
    const names = Object.keys(presets);
    if (names.length === 0) {
        toastr.warning('OpenAI 프리셋이 없습니다. Chat Completion API를 사용 중인지 확인하세요.');
        return;
    }

    const opts = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');

    // Build overlay
    overlayEl = document.createElement('div');
    overlayEl.id = 'pc-overlay';
    overlayEl.innerHTML = `
      <div id="pc-modal">
        <div class="pc-titlebar">
          <span class="pc-title">Preset Copier</span>
          <button id="pc-close" title="닫기">✕</button>
        </div>

        <div class="pc-panels">
          <section class="pc-panel">
            <h2>📤 소스 프리셋 (A)</h2>
            <select id="pc-srcSelect"><option value="">-- 선택 --</option>${opts}</select>
            <div class="pc-list" id="pc-srcList"><p class="pc-empty">프리셋을 선택하세요</p></div>
          </section>

          <section class="pc-panel">
            <h2>📥 대상 프리셋 (B)</h2>
            <select id="pc-tgtSelect"><option value="">-- 선택 --</option>${opts}</select>
            <div class="pc-list" id="pc-tgtList"><p class="pc-empty">프리셋을 선택하세요</p></div>
          </section>
        </div>

        <div class="pc-actions">
          <button id="pc-btnCopy" disabled>📋 선택 항목 복사</button>
          <button id="pc-btnClose2">닫기</button>
        </div>
        <div id="pc-toast"></div>
      </div>
    `;
    document.body.appendChild(overlayEl);

    // Close on overlay background click
    overlayEl.addEventListener('click', (e) => {
        if (e.target === overlayEl) closeModal();
    });
    // Escape key
    const escHandler = (e) => {
        if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);

    initModalLogic(overlayEl, presets);
}

// ── Logic running inside the modal ───────────────────
function initModalLogic(root, presets) {
    const $ = sel => root.querySelector(sel);

    let srcName = '', tgtName = '';
    let srcPreset = null, tgtPreset = null;
    let selectedPrompts = new Set();
    let insertPos = -1;

    const srcSelect = $('#pc-srcSelect');
    const tgtSelect = $('#pc-tgtSelect');
    const srcList   = $('#pc-srcList');
    const tgtList   = $('#pc-tgtList');
    const btnCopy   = $('#pc-btnCopy');

    // close buttons
    $('#pc-close').addEventListener('click', closeModal);
    $('#pc-btnClose2').addEventListener('click', closeModal);

    // toast inside modal
    function toast(msg, ok = true) {
        const t = $('#pc-toast');
        t.textContent = msg;
        t.className = ok ? 'show ok' : 'show err';
        clearTimeout(t._tid);
        t._tid = setTimeout(() => t.className = '', 2500);
    }

    // ── Render source ────────────────────────────
    function renderSource() {
        if (!srcPreset) { srcList.innerHTML = '<p class="pc-empty">프리셋을 선택하세요</p>'; return; }

        const ordered = getOrderedPrompts(srcPreset);
        let h = '';

        if (ordered.length) {
            ordered.forEach((e, i) => {
                const nm = e.prompt.name || e.identifier || 'Unnamed';
                const mk = e.prompt.marker ? '📍 ' : '';
                const sel = selectedPrompts.has(i) ? ' pc-selected' : '';
                h += `<div class="pc-item pc-selectable${sel}" data-i="${i}">
                  <span class="pc-key">${mk}${esc(nm)}</span>
                  <span class="pc-val pc-pid">[${esc(e.identifier)}]</span>
                  <span class="pc-val">${e.enabled ? '✅' : '❌'}</span>
                </div>`;
            });
        }
        srcList.innerHTML = h || '<p class="pc-empty">프롬프트 없음</p>';

        srcList.querySelectorAll('.pc-selectable').forEach(el => {
            el.addEventListener('click', () => {
                const idx = parseInt(el.dataset.i);
                if (selectedPrompts.has(idx)) {
                    selectedPrompts.delete(idx);
                    el.classList.remove('pc-selected');
                } else {
                    selectedPrompts.add(idx);
                    el.classList.add('pc-selected');
                }
                updateBtns();
            });
        });
    }

    // ── Render target ────────────────────────────
    function renderTarget() {
        if (!tgtPreset) { tgtList.innerHTML = '<p class="pc-empty">프리셋을 선택하세요</p>'; return; }

        const ordered = getOrderedPrompts(tgtPreset);
        let h = '';

        if (ordered.length) {
            h += '<div class="pc-group">💬 프롬프트 (삽입 위치 선택)</div>';
            h += slotHtml(0);
            ordered.forEach((e, i) => {
                const nm = e.prompt.name || e.identifier || 'Unnamed';
                const mk = e.prompt.marker ? '📍 ' : '';
                h += `<div class="pc-item pc-target-item">
                  <span class="pc-idx">#${i+1}</span>
                  <span class="pc-key">${mk}${esc(nm)}</span>
                  <span class="pc-val pc-pid">[${esc(e.identifier)}]</span>
                  <span class="pc-val">${e.enabled ? '✅' : '❌'}</span>
                </div>`;
                h += slotHtml(i + 1);
            });
        } else {
            h += slotHtml(0);
        }

        tgtList.innerHTML = h || '<p class="pc-empty">항목 없음</p>';

        tgtList.querySelectorAll('.pc-slot').forEach(s => {
            s.addEventListener('click', () => {
                insertPos = parseInt(s.dataset.s);
                tgtList.querySelectorAll('.pc-slot').forEach(x => x.classList.toggle('selected', x === s));
                updateBtns();
            });
        });
    }

    function slotHtml(idx) {
        return `<div class="pc-slot ${insertPos === idx ? 'selected' : ''}" data-s="${idx}">➕ 여기에 삽입</div>`;
    }

    // ── Button state ─────────────────────────────
    function updateBtns() {
        const hasSel = selectedPrompts.size > 0;
        const both = !!srcName && !!tgtName;
        const diff = srcName !== tgtName;
        const hasSlot = insertPos >= 0;
        const ok = hasSel && both && diff && hasSlot;
        btnCopy.disabled = !ok;
    }

    // ── Copy / Move ──────────────────────────────
    async function execute(remove) {
        if (!srcPreset || !tgtPreset) return;
        try {
            const target = JSON.parse(JSON.stringify(tgtPreset));
            const source = JSON.parse(JSON.stringify(srcPreset));

            if (selectedPrompts.size > 0) {
                const ordered = getOrderedPrompts(srcPreset);
                const sorted = Array.from(selectedPrompts).sort((a,b) => a - b);
                target.prompts = target.prompts || [];
                target.prompt_order = target.prompt_order || [];

                let tgtOrderEntry = target.prompt_order.find(o => String(o.character_id) === String(GLOBAL_DUMMY_ID));
                if (!tgtOrderEntry) {
                    tgtOrderEntry = { character_id: GLOBAL_DUMMY_ID, order: [] };
                    target.prompt_order.push(tgtOrderEntry);
                }

                const existIds = new Set(target.prompts.map(p => p.identifier));
                let ins = insertPos >= 0 ? insertPos : tgtOrderEntry.order.length;

                for (const si of sorted) {
                    const e = ordered[si]; if (!e) continue;
                    const def = JSON.parse(JSON.stringify(e.prompt));
                    let newId = def.identifier;
                    if (existIds.has(newId)) {
                        let c = 1; const base = newId.replace(/_\d+$/, '');
                        while (existIds.has(`${base}_${c}`)) c++;
                        newId = `${base}_${c}`;
                        def.identifier = newId;
                        def.name = `${def.name || e.identifier} (${c})`;
                    }
                    target.prompts.push(def);
                    existIds.add(newId);
                    tgtOrderEntry.order.splice(ins++, 0, { identifier: newId, enabled: e.enabled });
                    for (const oe of target.prompt_order) {
                        if (String(oe.character_id) !== String(GLOBAL_DUMMY_ID) && oe.order)
                            oe.order.push({ identifier: newId, enabled: e.enabled });
                    }
                }

                if (remove) {
                    for (const si of sorted.reverse()) {
                        const e = ordered[si]; if (!e) continue;
                        const rid = e.identifier;
                        const pi = source.prompts?.findIndex(p => p.identifier === rid);
                        if (pi >= 0) source.prompts.splice(pi, 1);
                        if (source.prompt_order) {
                            for (const o of source.prompt_order)
                                if (o.order) o.order = o.order.filter(x => x.identifier !== rid);
                        }
                    }
                }
            }

            await savePresetToServer(tgtName, target);
            syncMemory(tgtName, target);
            tgtPreset = target;

            if (remove) {
                await savePresetToServer(srcName, source);
                syncMemory(srcName, source);
                srcPreset = source;
            }

            selectedPrompts.clear(); insertPos = -1;
            renderSource(); renderTarget(); updateBtns();
            toast(remove ? '이동 완료!' : '복사 완료!');
        } catch (err) {
            console.error(err);
            toast('작업 실패: ' + err.message, false);
        }
    }

    function syncMemory(name, preset) {
        if (openai_settings && openai_setting_names) {
            const idx = openai_setting_names[name];
            if (idx !== undefined) openai_settings[idx] = JSON.parse(JSON.stringify(preset));
        }
    }

    // ── Event binding ────────────────────────────
    srcSelect.addEventListener('change', () => {
        srcName = srcSelect.value;
        srcPreset = srcName ? JSON.parse(JSON.stringify(presets[srcName])) : null;
        selectedPrompts.clear();
        renderSource(); updateBtns();
    });
    tgtSelect.addEventListener('change', () => {
        tgtName = tgtSelect.value;
        tgtPreset = tgtName ? JSON.parse(JSON.stringify(presets[tgtName])) : null;
        insertPos = -1;
        renderTarget(); updateBtns();
    });
    btnCopy.addEventListener('click', () => execute(false));
}

// ── Extension panel in SillyTavern settings ──────────
function addExtensionPanel() {
    const tryAdd = () => {
        if (document.getElementById('preset_copier_container')) return true;
        const panel = document.getElementById('extensions_settings2');
        if (!panel) return false;

        const el = document.createElement('div');
        el.id = 'preset_copier_container';
        el.className = 'extension_container';
        el.innerHTML = `
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Preset Copier</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <p style="margin-bottom:8px;">OpenAI Chat Completion 프리셋의 프롬프트를 복사/이동합니다.</p>
                    <div id="pc-open-btn" class="menu_button menu_button_icon">
                        <i class="fa-solid fa-copy"></i>
                        <span>Preset Copier 열기</span>
                    </div>
                </div>
            </div>`;
        el.querySelector('#pc-open-btn').addEventListener('click', openModal);
        panel.appendChild(el);
        return true;
    };
    if (tryAdd()) return;
    let n = 0;
    const t = setInterval(() => { if (tryAdd() || ++n > 50) clearInterval(t); }, 200);
}

// ── Init ─────────────────────────────────────────────
jQuery(async () => {
    console.log(`[${extensionName}] Loading...`);
    try {
        await initImports();
        addExtensionPanel();
        console.log(`[${extensionName}] Loaded successfully`);
    } catch (err) {
        console.error(`[${extensionName}] Failed to load:`, err);
    }
});
