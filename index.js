/**
 * 角色备注 / Character Notes
 * For SillyTavern / TauriTavern. Notes remain in extension_settings,
 * separate from the character card and never enter generation prompts.
 */
import { characters, getThumbnailUrl, saveSettingsDebounced, selectCharacterById } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { eventSource, event_types } from '../../../events.js';
import { getTagsList } from '../../../tags.js';

const ROOT_ID = 'character-shelf-root';
const KEY = 'characterShelf';
let query = '';
let editing = '';
let detailKey = '';
let priorFocus = null;
let floatPointer = null;
let skipFloatClick = false;

function state() {
    if (!extension_settings[KEY] || typeof extension_settings[KEY] !== 'object' || Array.isArray(extension_settings[KEY])) {
        extension_settings[KEY] = { notes: {}, view: 'list', sort: 'newest', theme: 'tavern', filter: 'all', themeVersion: 4 };
    }
    const data = extension_settings[KEY];
    if (!data.notes || typeof data.notes !== 'object' || Array.isArray(data.notes)) data.notes = {};
    if (data.view !== 'grid' && data.view !== 'list') data.view = 'list';
    if (!['newest', 'oldest', 'az', 'za'].includes(data.sort)) data.sort = 'newest';
    if (!['tavern', 'day', 'gray'].includes(data.theme)) data.theme = 'tavern';
    if (data.themeVersion !== 4) { if (data.theme === 'gray') data.theme = 'tavern'; data.themeVersion = 4; }
    if (!['all', 'noted', 'empty'].includes(data.filter)) data.filter = 'all';
    if (typeof data.showFloat !== 'boolean') data.showFloat = false;
    return data;
}
function save() { saveSettingsDebounced(); }
function node(tag, cls, value) {
    const item = document.createElement(tag);
    if (cls) item.className = cls;
    if (value !== undefined) item.textContent = value;
    return item;
}
function idFor(character) { return 'avatar:' + String(character.avatar || ''); }
function noteFor(key) {
    const notes = state().notes;
    return Object.prototype.hasOwnProperty.call(notes, key) && typeof notes[key] === 'string' ? notes[key] : '';
}
function whenAdded(character) {
    const raw = character.date_added;
    if (raw === undefined || raw === null || raw === '') return null;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n < 1e11 ? n * 1000 : n;
    const d = Date.parse(raw);
    return Number.isFinite(d) ? d : null;
}
function allCharacters() {
    return characters.map((character, index) => character && ({
        character: character, index: index, key: idFor(character), time: whenAdded(character),
    })).filter(Boolean);
}
function sortItems(a, b) {
    const order = state().sort;
    const diff = String(a.character.name || '').localeCompare(String(b.character.name || ''), 'zh-Hans-CN', { numeric: true });
    if (order === 'az') return diff || a.index - b.index;
    if (order === 'za') return -diff || a.index - b.index;
    if (a.time === null && b.time !== null) return 1;
    if (a.time !== null && b.time === null) return -1;
    if (a.time !== null && b.time !== null && a.time !== b.time) {
        return order === 'oldest' ? a.time - b.time : b.time - a.time;
    }
    return b.index - a.index;
}
function visibleTags(character) {
    return getTagsList(character.avatar).filter(tag => tag && tag.name);
}
function makeTags(character) {
    const holder = node('div', 'cs-tags');
    const items = visibleTags(character);
    for (const tag of items) {
        const chip = node('span', 'cs-tag', tag.name);
        chip.title = tag.name;
        holder.append(chip);
    }
    return holder;
}
function avatar(character) {
    if (!character.avatar || character.avatar === 'none') return '/img/ai4.png';
    return getThumbnailUrl('avatar', character.avatar);
}
function render() {
    const root = document.getElementById(ROOT_ID);
    if (!root || root.hidden) return;
    const data = state();
    const results = root.querySelector('#cs-results');
    const all = allCharacters();
    const needle = query.trim().toLocaleLowerCase();
    const matched = all.filter(entry => !needle
        || String(entry.character.name || '').toLocaleLowerCase().includes(needle)
        || noteFor(entry.key).toLocaleLowerCase().includes(needle)
        || visibleTags(entry.character).some(tag => tag.name.toLocaleLowerCase().includes(needle)));
    const noted = matched.filter(entry => Boolean(noteFor(entry.key).trim())).length;
    const unnoted = matched.length - noted;
    const shown = matched.filter(entry => data.filter === 'all' ||
        (data.filter === 'noted' ? Boolean(noteFor(entry.key).trim()) : !noteFor(entry.key).trim()));
    shown.sort(sortItems);
    results.replaceChildren();
    results.className = 'cs-results cs-' + data.view;
    root.querySelector('#cs-sort').value = data.sort;
    root.dataset.theme = data.theme;
    const palette = root.querySelector('#cs-theme-cycle');
    const themeNames = { tavern:'跟随酒馆', day:'日间模式', gray:'灰色夜间' };
    palette.title = '当前：' + themeNames[data.theme] + '（点击切换）';
    palette.setAttribute('aria-label', palette.title);
    const counts = { all:matched.length, noted:noted, empty:unnoted };
    const labels = { all:'全部', noted:'已备注', empty:'未备注' };
    for (const value of ['all', 'noted', 'empty']) {
        const button = root.querySelector('#cs-filter-' + value);
        button.textContent = labels[value] + '（' + counts[value] + '）';
        button.setAttribute('aria-pressed', String(data.filter === value));
    }
    updateFloat();
    root.querySelector('#cs-view-list').setAttribute('aria-pressed', String(data.view === 'list'));
    root.querySelector('#cs-view-grid').setAttribute('aria-pressed', String(data.view === 'grid'));
    if (!shown.length) {
        results.append(node('p', 'cs-empty', needle ? '没有匹配的角色或备注' : '还没有角色卡'));
        return;
    }
    const batch = document.createDocumentFragment();
    for (const entry of shown) {
        const card = node('div', 'cs-card cs-card-' + data.view);
        card.dataset.avatarKey = entry.key;
        const image = node('img', 'cs-avatar');
        image.src = avatar(entry.character);
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.onerror = () => { image.onerror = null; image.src = '/img/ai4.png'; };
        card.append(image);
        const info = node('div', 'cs-info');
        const name = node('div', 'cs-name', entry.character.name || '(未命名)');
        name.title = entry.character.name || '';
        info.append(name);
        const note = noteFor(entry.key);
        if (data.view === 'list') {
            const summary = node('div', 'cs-summary' + (note.trim() ? '' : ' cs-placeholder'), note.trim() || '还没有备注，点击查看并添加');
            summary.title = note;
            info.append(summary);
        } else if (note.trim()) {
            const dot = node('span', 'cs-dot');
            dot.title = '已添加备注';
            card.append(dot);
        }
        card.append(info);
        const open = node('button', 'cs-open');
        open.type = 'button';
        open.dataset.action = 'open';
        open.setAttribute('aria-label', '打开 ' + (entry.character.name || '角色'));
        card.append(open);
        batch.append(card);
    }
    results.append(batch);
}
function updateDetails() {
    const root = document.getElementById(ROOT_ID);
    const entry = allCharacters().find(item => item.key === detailKey);
    if (!root || !entry) return;
    root.querySelector('#cs-detail-name').textContent = entry.character.name || '(未命名)';
    const note = noteFor(detailKey).trim();
    const content = root.querySelector('#cs-detail-note');
    content.textContent = note || '还没有添加私人备注。可以点击下方「编辑备注」填写。';
    content.classList.toggle('cs-placeholder', !note);
    const tags = root.querySelector('#cs-detail-tags');
    tags.replaceChildren(...makeTags(entry.character).childNodes);
    tags.hidden = !tags.childElementCount;
}
function openDetails(key) {
    if (!allCharacters().some(item => item.key === key)) return;
    detailKey = key;
    updateDetails();
    const root = document.getElementById(ROOT_ID);
    root.querySelector('#cs-detail').hidden = false;
    root.querySelector('#cs-detail-close').focus();
}
function closeDetails() {
    const root = document.getElementById(ROOT_ID);
    if (root) root.querySelector('#cs-detail').hidden = true;
    detailKey = '';
}
function openEditor(key) {
    const entry = allCharacters().find(item => item.key === key);
    if (!entry) return;
    editing = key;
    const root = document.getElementById(ROOT_ID);
    root.querySelector('#cs-editor-name').textContent = entry.character.name || '(未命名)';
    const field = root.querySelector('#cs-note-input');
    field.value = noteFor(key);
    root.querySelector('#cs-length').textContent = field.value.length + ' 字';
    root.querySelector('#cs-editor').hidden = false;
    field.focus();
}
function closeEditor() {
    const root = document.getElementById(ROOT_ID);
    if (root) root.querySelector('#cs-editor').hidden = true;
    editing = '';
}
function saveEditor() {
    if (!editing) return;
    const value = document.getElementById('cs-note-input').value.trim();
    const notes = state().notes;
    if (value) notes[editing] = value;
    else delete notes[editing];
    save();
    closeEditor();
    render();
    if (detailKey) updateDetails();
}
function openPanel() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    priorFocus = document.activeElement;
    closeEditor();
    closeDetails();
    root.hidden = false;
    query = '';
    root.querySelector('#cs-search').value = '';
    render();
    root.querySelector('#cs-search').focus();
}
function closePanel() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    closeEditor();
    closeDetails();
    root.hidden = true;
    if (priorFocus && priorFocus.isConnected) priorFocus.focus();
}
function downloadNotes() {
    const data = {
        format: 'CharacterShelfBackup',
        version: 1,
        exportedAt: new Date().toISOString(),
        notes: state().notes,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
    const link = node('a');
    link.href = url;
    link.download = '角色备注-备份-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function restoreNotes(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) throw new Error('备份文件不能超过 10MB');
    const parsed = JSON.parse(await file.text());
    if (parsed?.format !== 'CharacterShelfBackup' || !parsed.notes
        || typeof parsed.notes !== 'object' || Array.isArray(parsed.notes)) {
        throw new Error('备份文件格式不正确');
    }
    const entries = Object.entries(parsed.notes);
    if (entries.length > 20000 || entries.some(([key, value]) => !key.startsWith('avatar:') || typeof value !== 'string')) {
        throw new Error('备份中有无效的备注记录');
    }
    const notes = state().notes;
    for (const [key, value] of entries) if (value) notes[key] = value;
    save();
    render();
    window.toastr?.success?.('已恢复 ' + entries.length + ' 条备注', '角色备注');
}
async function openCharacter(key) {
    const entry = allCharacters().find(item => item.key === key);
    if (!entry) return;
    try {
        await selectCharacterById(entry.index);
        closePanel();
    } catch (error) {
        console.error('[CharacterShelf] Open character failed:', error);
        window.toastr?.error?.('无法打开角色，请从原角色列表重试', '角色备注');
    }
}
function createUi() {
    if (document.getElementById(ROOT_ID)) return;
    const root = node('div', 'cs-layer');
    root.id = ROOT_ID;
    root.hidden = true;
    root.innerHTML = [
        '<div class="cs-backdrop" data-action="close"></div>',
        '<section class="cs-window" role="dialog" aria-modal="true" aria-label="角色备注">',
        '  <header class="cs-header"><h2>角色备注</h2>',
        '    <div class="cs-head-actions">',
        '      <button type="button" id="cs-theme-cycle" class="cs-icon-button" data-action="palette" title="切换配色" aria-label="切换配色"><i class="fa-solid fa-palette" aria-hidden="true"></i></button>',
        '      <button type="button" class="cs-close" data-action="close" aria-label="关闭">×</button>',
        '    </div></header>',
        '  <div class="cs-toolbar">',
        '    <input id="cs-search" type="search" placeholder="搜索角色名字或备注…" aria-label="搜索角色" />',
        '    <select id="cs-sort" aria-label="排序">',
        '      <option value="newest">导入：新→旧</option>',
        '      <option value="oldest">导入：旧→新</option>',
        '      <option value="az">名字：A→Z</option>',
        '      <option value="za">名字：Z→A</option>',
        '    </select>',
        '    <div class="cs-switch">',
        '      <button type="button" id="cs-view-list" data-action="list" title="列表视图" aria-label="列表视图"><i class="fa-solid fa-list" aria-hidden="true"></i></button>',
        '      <button type="button" id="cs-view-grid" data-action="grid" title="头像视图" aria-label="头像视图"><i class="fa-solid fa-table-cells" aria-hidden="true"></i></button>',
        '    </div>',
        '  </div>',
        '  <div class="cs-filters" role="group" aria-label="备注筛选">',
        '    <button type="button" id="cs-filter-all" data-action="filter-all">全部（0）</button>',
        '    <button type="button" id="cs-filter-noted" data-action="filter-noted">已备注（0）</button>',
        '    <button type="button" id="cs-filter-empty" data-action="filter-empty">未备注（0）</button>',
        '  </div>',
        '  <div id="cs-results" class="cs-results"></div>',
        '</section>',
        '<div class="cs-detail-layer" id="cs-detail" hidden>',
        '  <div class="cs-detail-backdrop" data-action="detail-close"></div>',
        '  <section class="cs-detail-window" role="dialog" aria-modal="true" aria-labelledby="cs-detail-name">',
        '    <header class="cs-detail-header"><h3 id="cs-detail-name"></h3>',
        '      <button type="button" id="cs-detail-close" data-action="detail-close" aria-label="关闭预览">×</button></header>',
        '    <div id="cs-detail-note" class="cs-detail-note"></div>',
        '    <div id="cs-detail-tags" class="cs-tags"></div>',
        '    <footer class="cs-detail-actions">',
        '      <button type="button" data-action="detail-edit">编辑备注</button>',
        '      <button type="button" class="cs-primary" data-action="detail-jump">跳转卡面</button>',
        '    </footer>',
        '  </section>',
        '</div>',
        '<div class="cs-editor-layer" id="cs-editor" hidden>',
        '  <div class="cs-editor-backdrop" data-action="cancel"></div>',
        '  <section class="cs-editor-window" role="dialog" aria-modal="true" aria-label="编辑私人备注">',
        '    <div class="cs-editor-title">私人备注 · <span id="cs-editor-name"></span></div>',
        '    <p>备注只用于浏览，不会写入角色卡正文或发送给 AI。</p>',
        '    <textarea id="cs-note-input" rows="7" placeholder="例如：架空古风，开局联姻，慢热权谋……"></textarea>',
        '    <div class="cs-editor-actions"><span id="cs-length">0 字</span>',
        '       <button type="button" data-action="cancel">取消</button>',
        '       <button type="button" class="cs-primary" data-action="save">保存备注</button></div>',
        '  </section>',
        '</div>',
        '<input id="cs-import-file" type="file" accept=".json,application/json" hidden />',
    ].join('\n');
    document.body.append(root);

    root.addEventListener('click', event => {
        const target = event.target.closest('[data-action]');
        if (!target || !root.contains(target)) return;
        const action = target.dataset.action;
        if (action === 'close') return closePanel();
        if (action === 'detail-close') return closeDetails();
        if (action === 'detail-edit') return openEditor(detailKey);
        if (action === 'detail-jump') return openCharacter(detailKey);
        if (action === 'cancel') return closeEditor();
        if (action === 'save') return saveEditor();
        if (action === 'palette') {
            const options = ['tavern', 'day', 'gray'];
            state().theme = options[(options.indexOf(state().theme) + 1) % options.length];
            save(); render(); return;
        }
        if (action.startsWith('filter-')) {
            state().filter = action.slice(7);
            save(); render(); return;
        }
        if (action === 'list' || action === 'grid') {
            state().view = action;
            save();
            return render();
        }
        if (action === 'backup') return downloadNotes();
        if (action === 'restore') return root.querySelector('#cs-import-file').click();
        if (action === 'open') {
            const key = target.closest('[data-avatar-key]')?.dataset.avatarKey;
            if (key) openDetails(key);
        }
    });
    root.querySelector('#cs-search').addEventListener('input', e => { query = e.target.value; render(); });
    root.querySelector('#cs-sort').addEventListener('change', e => { state().sort = e.target.value; save(); render(); });
    root.querySelector('#cs-note-input').addEventListener('input', e => {
        root.querySelector('#cs-length').textContent = e.target.value.length + ' 字';
    });
    root.querySelector('#cs-import-file').addEventListener('change', async e => {
        try { await restoreNotes(e.target.files?.[0]); }
        catch (error) { window.toastr?.error?.(error.message, '角色备注 · 恢复失败'); }
        finally { e.target.value = ''; }
    });
    document.addEventListener('keydown', event => {
        if (root.hidden) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            if (!root.querySelector('#cs-editor').hidden) closeEditor();
            else if (!root.querySelector('#cs-detail').hidden) closeDetails();
            else closePanel();
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !root.querySelector('#cs-editor').hidden) {
            event.preventDefault();
            saveEditor();
        }
    });
}
function launcher() {
    if (document.getElementById('cs-launcher')) return;
    const container = document.getElementById('rm_buttons_container')
        || document.getElementById('rm_button_bar');
    if (!container) return;
    const button = node('button', 'menu_button fa-solid fa-book-open');
    button.id = 'cs-launcher';
    button.type = 'button';
    button.title = '角色备注';
    button.setAttribute('aria-label', '打开角色备注');
    button.addEventListener('click', openPanel);
    container.append(button);
}
function buildSettings() {
    if (document.getElementById('cs-settings-panel')) return;
    const container = document.getElementById('extensions_settings2')
        || document.getElementById('extensions_settings');
    if (!container) return;
    const section = node('section', 'extension_container cs-settings');
    section.id = 'cs-settings-panel';
    const heading = node('h4', 'cs-settings-title', '角色备注');
    const description = node('p', 'cs-settings-description', '独立浏览角色卡与私人备注');
    const open = node('button', 'menu_button cs-settings-open', '打开角色备注');
    open.type = 'button';
    open.addEventListener('click', openPanel);
    const row = node('label', 'cs-settings-toggle');
    const checkbox = node('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'cs-float-toggle';
    checkbox.checked = state().showFloat;
    const label = node('span', '', '显示书本悬浮按钮');
    checkbox.addEventListener('change', () => {
        state().showFloat = checkbox.checked;
        save();
        updateFloat();
    });
    row.append(checkbox, label);
    const foot = node('p', 'cs-settings-description', '悬浮按钮可拖动，配色跟随角色备注当前主题。');
    section.append(heading, description, open, row, foot);
    container.prepend(section);
}
function buildWand() {
    if (document.getElementById('cs-wand-entry')) return;
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return;
    const item = node('div', 'list-group-item flex-container flexGap5');
    item.id = 'cs-wand-entry';
    item.role = 'button';
    item.tabIndex = 0;
    const glyph = node('i', 'fa-solid fa-book-open extensionsMenuExtensionButton');
    glyph.setAttribute('aria-hidden', 'true');
    const title = node('span', '', '角色备注');
    item.append(glyph, title);
    item.addEventListener('click', openPanel);
    item.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            item.click();
        }
    });
    menu.append(item);
}
function clampFloat(x, y, width, height) {
    const margin = 8;
    return {
        x: Math.max(margin, Math.min(x, Math.max(margin, window.innerWidth - width - margin))),
        y: Math.max(margin, Math.min(y, Math.max(margin, window.innerHeight - height - margin))),
    };
}
function updateFloat() {
    const button = document.getElementById('cs-float-button');
    if (!button) return;
    const current = state();
    button.hidden = !current.showFloat;
    button.dataset.theme = current.theme;
    const checkbox = document.getElementById('cs-float-toggle');
    if (checkbox && checkbox.checked !== current.showFloat) checkbox.checked = current.showFloat;
    if (button.hidden) return;
    const saved = current.floatPosition;
    if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) {
        button.style.left = '';
        button.style.top = '';
        button.style.right = '';
        button.style.bottom = '';
        return;
    }
    const pos = clampFloat(saved.x, saved.y, button.offsetWidth || 46, button.offsetHeight || 46);
    button.style.left = pos.x + 'px';
    button.style.top = pos.y + 'px';
    button.style.right = 'auto';
    button.style.bottom = 'auto';
}
function buildFloat() {
    if (document.getElementById('cs-float-button')) return;
    const button = node('button', 'cs-float-button');
    button.id = 'cs-float-button';
    button.type = 'button';
    button.title = '角色备注（可拖动）';
    button.setAttribute('aria-label', '打开角色备注');
    const icon = node('i', 'fa-solid fa-book-open');
    icon.setAttribute('aria-hidden', 'true');
    button.append(icon);
    button.hidden = true;
    document.body.append(button);
    button.addEventListener('pointerdown', event => {
        if (event.button !== 0 || floatPointer) return;
        skipFloatClick = false;
        const rect = button.getBoundingClientRect();
        floatPointer = {
            id: event.pointerId, x: event.clientX, y: event.clientY,
            left: rect.left, top: rect.top, moving: false,
        };
        try { button.setPointerCapture(event.pointerId); } catch (_) {}
    });
    button.addEventListener('pointermove', event => {
        const gesture = floatPointer;
        if (!gesture || gesture.id !== event.pointerId) return;
        const dx = event.clientX - gesture.x;
        const dy = event.clientY - gesture.y;
        if (!gesture.moving && Math.hypot(dx, dy) < 6) return;
        gesture.moving = true;
        const pos = clampFloat(gesture.left + dx, gesture.top + dy,
            button.offsetWidth || 46, button.offsetHeight || 46);
        button.style.left = pos.x + 'px';
        button.style.top = pos.y + 'px';
        button.style.right = 'auto';
        button.style.bottom = 'auto';
    });
    function finish(event) {
        const gesture = floatPointer;
        if (!gesture || gesture.id !== event.pointerId) return;
        floatPointer = null;
        try { if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId); } catch (_) {}
        if (!gesture.moving) return;
        skipFloatClick = event.type === 'pointerup';
        // Do not open the browser when dragging the floating control.
        const rect = button.getBoundingClientRect();
        state().floatPosition = clampFloat(rect.left, rect.top, rect.width, rect.height);
        save();
    }
    button.addEventListener('pointerup', finish);
    button.addEventListener('pointercancel', finish);
    button.addEventListener('click', event => {
        if (skipFloatClick && event.detail !== 0) {
            skipFloatClick = false;
            event.preventDefault();
            return;
        }
        skipFloatClick = false;
        openPanel();
    });
    window.addEventListener('resize', () => updateFloat(), { passive: true });
    updateFloat();
}
function init() {
    state();
    createUi();
    launcher();
    buildSettings();
    buildWand();
    buildFloat();
    const observer = new MutationObserver(() => {
        if (!document.getElementById('cs-launcher')) launcher();
        if (!document.getElementById('cs-settings-panel')) buildSettings();
        if (!document.getElementById('cs-wand-entry')) buildWand();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    for (const type of [event_types.CHARACTER_PAGE_LOADED, event_types.CHARACTER_EDITED,
        event_types.CHARACTER_DELETED, event_types.CHARACTER_DUPLICATED]) {
        eventSource.on(type, () => {
            const root = document.getElementById(ROOT_ID);
            if (root && !root.hidden) { render(); if (detailKey) updateDetails(); }
        });
    }
    eventSource.on(event_types.CHARACTER_RENAMED, (oldAvatar, newAvatar) => {
        const notes = state().notes;
        const previous = 'avatar:' + oldAvatar;
        const next = 'avatar:' + newAvatar;
        if (previous !== next && Object.prototype.hasOwnProperty.call(notes, previous)
            && !Object.prototype.hasOwnProperty.call(notes, next)) {
            notes[next] = notes[previous];
            delete notes[previous];
            save();
        }
        const root = document.getElementById(ROOT_ID);
        if (root && !root.hidden) { render(); if (detailKey) updateDetails(); }
    });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
