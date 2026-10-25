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
let floatPeekSide = null;
let floatPeekTimer = null;
let panelPointer = null;
let panelLastFocus = null;
let panelRendered = false;
let panelNeedsRefresh = false;
let cachedView = '';
const cardCache = new Map();
let searchTimer = null;
let layoutViewport = null;
let inputFocus = false;
let resizeFrame = 0;
let editorAnchor = null;

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
    if (typeof data.fullscreen !== 'boolean') data.fullscreen = false;
    if (!['left', 'right'].includes(data.floatDock)) data.floatDock = null;
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
function matchesSearch(entry, note = noteFor(entry.key)) {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return true;
    return String(entry.character.name || '').toLocaleLowerCase().includes(needle)
        || note.toLocaleLowerCase().includes(needle)
        || visibleTags(entry.character).some(tag => tag.name.toLocaleLowerCase().includes(needle));
}
function passesFilter(note) {
    const filter = state().filter;
    return filter === 'all' || (filter === 'noted' ? Boolean(note.trim()) : !note.trim());
}
function updateCounts(matched) {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    const noted = matched.reduce((sum, entry) => sum + Number(Boolean(noteFor(entry.key).trim())), 0);
    const counts = { all: matched.length, noted, empty: matched.length - noted };
    const labels = { all: '全部', noted: '已备注', empty: '未备注' };
    for (const value of ['all', 'noted', 'empty']) {
        const button = root.querySelector('#cs-filter-' + value);
        button.textContent = labels[value] + '（' + counts[value] + '）';
        button.setAttribute('aria-pressed', String(state().filter === value));
    }
}
function updateCardNote(card, note, view) {
    if (view === 'list') {
        const info = card.querySelector('.cs-info');
        const existing = info.querySelector('.cs-summary');
        if (!note.trim()) { existing?.remove(); return; }
        const summary = existing || node('div', 'cs-summary');
        summary.textContent = note.trim();
        summary.title = note;
        if (!existing) info.append(summary);
        return;
    }
    const old = card.querySelector('.cs-dot');
    if (!note.trim()) { old?.remove(); return; }
    if (!old) {
        const dot = node('span', 'cs-dot');
        dot.title = '已添加备注';
        card.append(dot);
    }
}
function makeCard(entry, view) {
    const card = node('div', 'cs-card cs-card-' + view);
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
    card.append(info);
    updateCardNote(card, noteFor(entry.key), view);
    const open = node('button', 'cs-open');
    open.type = 'button';
    open.dataset.action = 'open';
    open.setAttribute('aria-label', '打开 ' + (entry.character.name || '角色'));
    card.append(open);
    return card;
}
function cardByKey(results, key) {
    return Array.from(results.children).find(card => card.dataset.avatarKey === key) || null;
}
function listAnchor(results, preferredKey = null) {
    const bounds = results.getBoundingClientRect();
    const cards = Array.from(results.children).filter(card => card.dataset.avatarKey);
    const selected = (preferredKey && cards.find(card => card.dataset.avatarKey === preferredKey))
        || cards.find(card => card.getBoundingClientRect().bottom > bounds.top + 1)
        || cards[0];
    if (!selected) return null;
    const next = selected.nextElementSibling;
    const previous = selected.previousElementSibling;
    const sibling = (next?.dataset.avatarKey && next) || (previous?.dataset.avatarKey && previous);
    return {
        key: selected.dataset.avatarKey,
        offset: selected.getBoundingClientRect().top - bounds.top,
        fallback: sibling?.dataset.avatarKey || '',
        fallbackOffset: sibling ? sibling.getBoundingClientRect().top - bounds.top : 0,
    };
}
function restoreAnchor(results, anchor) {
    if (!anchor) return;
    const card = cardByKey(results, anchor.key) || cardByKey(results, anchor.fallback);
    if (!card) return;
    const expected = card.dataset.avatarKey === anchor.key ? anchor.offset : anchor.fallbackOffset;
    results.scrollTop += card.getBoundingClientRect().top - results.getBoundingClientRect().top - expected;
}
function render(anchor = null) {
    const root = document.getElementById(ROOT_ID);
    if (!root || root.hidden) return;
    const data = state();
    const results = root.querySelector('#cs-results');
    const all = allCharacters();
    const matched = all.filter(entry => matchesSearch(entry));
    const shown = matched.filter(entry => passesFilter(noteFor(entry.key)));
    shown.sort(sortItems);
    const scroll = results.scrollTop;
    if (cachedView !== data.view) {
        cachedView = data.view;
        cardCache.clear();
    }
    results.className = 'cs-results cs-' + data.view;
    root.querySelector('#cs-sort').value = data.sort;
    root.dataset.theme = data.theme;
    const palette = root.querySelector('#cs-theme-cycle');
    const themes = { tavern: '跟随酒馆', day: '日间模式', gray: '灰色夜间' };
    palette.title = '当前：' + themes[data.theme] + '（点击切换）';
    palette.setAttribute('aria-label', palette.title);
    updateCounts(matched);
    updateFloat();
    root.querySelector('#cs-view-list').setAttribute('aria-pressed', String(data.view === 'list'));
    root.querySelector('#cs-view-grid').setAttribute('aria-pressed', String(data.view === 'grid'));
    if (!shown.length) {
        results.replaceChildren(node('p', 'cs-empty', query.trim() ? '没有匹配的角色或备注' : '当前筛选没有角色卡'));
        panelRendered = true;
        return;
    }
    const fragment = document.createDocumentFragment();
    for (const entry of shown) {
        let card = cardCache.get(entry.key);
        if (!card) {
            card = makeCard(entry, data.view);
            cardCache.set(entry.key, card);
        }
        fragment.append(card);
    }
    results.replaceChildren(fragment);
    results.scrollTop = scroll;
    restoreAnchor(results, anchor);
    panelRendered = true;
}
function refreshEditedCard(key, previous, next, fixedAnchor = null) {
    const root = document.getElementById(ROOT_ID);
    if (!root || root.hidden) { panelNeedsRefresh = true; return; }
    const results = root.querySelector('#cs-results');
    const entry = allCharacters().find(item => item.key === key);
    if (!entry) { cardCache.clear(); render(); return; }
    const before = matchesSearch(entry, previous) && passesFilter(previous);
    const after = matchesSearch(entry, next) && passesFilter(next);
    const cached = cardCache.get(key);
    const anchor = fixedAnchor || listAnchor(results, key);
    if (cached) updateCardNote(cached, next, state().view);
    if (before !== after || (after && !cached)) {
        render(anchor);
        return;
    }
    updateCounts(allCharacters().filter(item => matchesSearch(item)));
    restoreAnchor(results, anchor);
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
    editorAnchor = listAnchor(root.querySelector('#cs-results'), key);
    root.querySelector('#cs-detail').classList.add('cs-under-editor');
    root.querySelector('#cs-editor-name').textContent = entry.character.name || '(未命名)';
    const field = root.querySelector('#cs-note-input');
    field.value = noteFor(key);
    root.querySelector('#cs-length').textContent = field.value.length + ' 字';
    root.querySelector('#cs-editor').hidden = false;
    field.focus();
}
function closeEditor() {
    const root = document.getElementById(ROOT_ID);
    if (root) {
        root.querySelector('#cs-editor').hidden = true;
        root.querySelector('#cs-detail').classList.remove('cs-under-editor');
    }
    editing = '';
    editorAnchor = null;
}
function saveEditor() {
    if (!editing) return;
    const key = editing;
    const value = document.getElementById('cs-note-input').value.trim();
    const notes = state().notes;
    const previous = noteFor(key);
    if (value) notes[editing] = value;
    else delete notes[editing];
    save();
    const anchor = editorAnchor;
    closeEditor();
    closeDetails();
    if (panelNeedsRefresh) {
        cardCache.clear();
        render(anchor);
        panelNeedsRefresh = false;
    } else refreshEditedCard(key, previous, value, anchor);
    const results = document.getElementById('cs-results');
    const restoredCard = cardByKey(results, key);
    restoredCard?.querySelector('.cs-open')?.focus({ preventScroll: true });
}
function viewportBounds() {
    const bounds = layoutViewport || { width: window.innerWidth, height: window.innerHeight };
    return { width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) };
}
function setPanelBaseHeight(root) {
    const height = viewportBounds().height;
    const size = Math.max(155, Math.min(545, height * 0.68, height - 16));
    const value = Math.round(size) + 'px';
    if (root.style.getPropertyValue('--cs-panel-height') !== value) {
        root.style.setProperty('--cs-panel-height', value);
    }
}
function keyboardRaised() {
    const visibleHeight = window.visualViewport?.height ?? window.innerHeight;
    return Boolean(layoutViewport && visibleHeight < layoutViewport.height - 115);
}
function clampWindow(left, top, width, height) {
    const viewport = viewportBounds();
    const margin = 8;
    // Temporarily allow upward movement during typing; never save it as the resting position.
    const minimumTop = keyboardRaised() ? Math.min(margin, Math.round(78 - height * 0.48)) : margin;
    return {
        x: Math.max(margin, Math.min(left, Math.max(margin, viewport.width - width - margin))),
        y: Math.max(minimumTop, Math.min(top, Math.max(minimumTop, viewport.height - height - margin))),
    };
}
function positionPanel() {
    const root = document.getElementById(ROOT_ID);
    if (!root || root.hidden) return;
    const win = root.querySelector('.cs-window');
    if (state().fullscreen) {
        win.style.left = '';
        win.style.top = '';
        win.style.transform = '';
        return;
    }
    const size = viewportBounds();
    const rect = win.getBoundingClientRect();
    const saved = state().panelPosition;
    const x = saved && Number.isFinite(saved.x) ? saved.x : (size.width - rect.width) / 2;
    const y = saved && Number.isFinite(saved.y) ? saved.y : size.height * 0.09;
    const point = clampWindow(x, y, rect.width, rect.height);
    const nextLeft = point.x + 'px', nextTop = point.y + 'px';
    if (win.style.left !== nextLeft) win.style.left = nextLeft;
    if (win.style.top !== nextTop) win.style.top = nextTop;
    if (win.style.transform !== 'none') win.style.transform = 'none';
}
function queueViewportUpdate() {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        const current = { width: window.innerWidth, height: window.innerHeight };
        if (!layoutViewport) layoutViewport = current;
        const rotated = Math.abs(layoutViewport.width - current.width) > 24;
        if (rotated || (!inputFocus && current.height > layoutViewport.height + 30)) {
            layoutViewport = current;
            const root = document.getElementById(ROOT_ID);
            if (root) setPanelBaseHeight(root);
        }
        // The keyboard owns its own viewport; never move or resize this window while typing.
        if (keyboardRaised()) return;
        updateFloat();
        positionPanel();
    });
}
function updatePanelMode() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    const fullscreen = state().fullscreen;
    root.dataset.fullscreen = String(fullscreen);
    const button = root.querySelector('#cs-fullscreen');
    button.title = fullscreen ? '恢复悬浮窗口' : '切换全屏';
    button.setAttribute('aria-label', button.title);
    button.querySelector('i').className = fullscreen ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
    positionPanel();
}
function openPanel() {
    const root = document.getElementById(ROOT_ID);
    if (!root || !root.hidden) return;
    priorFocus = document.activeElement;
    root.hidden = false;
    if (!layoutViewport) layoutViewport = { width: window.innerWidth, height: window.innerHeight };
    setPanelBaseHeight(root);
    updatePanelMode();
    if (!panelRendered || panelNeedsRefresh) {
        render();
        panelNeedsRefresh = false;
    }
    if (panelLastFocus?.isConnected && root.contains(panelLastFocus)) {
        panelLastFocus.focus({ preventScroll: true });
    }
}
function closePanel() {
    const root = document.getElementById(ROOT_ID);
    if (!root || root.hidden) return;
    if (root.contains(document.activeElement)) panelLastFocus = document.activeElement;
    root.hidden = true;
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; panelNeedsRefresh = true; }
    if (priorFocus?.isConnected && !root.contains(priorFocus)) priorFocus.focus({ preventScroll: true });
}
function toggleFloatPanel() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    if (root.hidden) openPanel();
    else closePanel();
}
function enablePanelDrag(root) {
    const win = root.querySelector('.cs-window');
    root.addEventListener('pointerdown', event => {
        if (state().fullscreen || event.button !== 0 || panelPointer) return;
        const handle = event.target.closest('.cs-header, .cs-detail-header, .cs-editor-title');
        if (!handle || event.target.closest('button, input, select, textarea, a')) return;
        const rect = win.getBoundingClientRect();
        panelPointer = { id: event.pointerId, handle,
            x: event.clientX, y: event.clientY, left: rect.left, top: rect.top,
            width: rect.width, height: rect.height, moving: false };
        try { handle.setPointerCapture(event.pointerId); } catch (_) {}
    });
    root.addEventListener('pointermove', event => {
        const g = panelPointer;
        if (!g || g.id !== event.pointerId) return;
        const dx = event.clientX - g.x, dy = event.clientY - g.y;
        if (!g.moving && Math.hypot(dx, dy) < 5) return;
        g.moving = true;
        const pos = clampWindow(g.left + dx, g.top + dy, g.width, g.height);
        win.style.left = pos.x + 'px';
        win.style.top = pos.y + 'px';
        win.style.transform = 'none';
    });
    const finish = event => {
        const g = panelPointer;
        if (!g || g.id !== event.pointerId) return;
        panelPointer = null;
        try { if (g.handle.hasPointerCapture(event.pointerId)) g.handle.releasePointerCapture(event.pointerId); } catch (_) {}
        if (!g.moving || event.type !== 'pointerup') return;
        const rect = win.getBoundingClientRect();
        if (!keyboardRaised()) {
            state().panelPosition = clampWindow(rect.left, rect.top, rect.width, rect.height);
            save();
        }
    };
    root.addEventListener('pointerup', finish);
    root.addEventListener('pointercancel', finish);
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
    const root = document.getElementById(ROOT_ID);
    if (root && !root.hidden) render();
    else panelNeedsRefresh = true;
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
        '<section class="cs-window" role="dialog" aria-modal="false" aria-label="角色备注">',
        '  <header class="cs-header"><div class="cs-heading"><h2>角色备注</h2><small class="cs-header-hint">点击悬浮按钮开启/关闭窗口</small></div>',
        '    <div class="cs-head-actions">',
        '      <button type="button" id="cs-theme-cycle" class="cs-icon-button" data-action="palette" title="切换配色" aria-label="切换配色"><i class="fa-solid fa-palette" aria-hidden="true"></i></button>',
        '      <button type="button" id="cs-fullscreen" class="cs-icon-button" data-action="fullscreen" title="切换全屏" aria-label="切换全屏"><i class="fa-solid fa-expand" aria-hidden="true"></i></button>',
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
        '</section>',
        '<input id="cs-import-file" type="file" accept=".json,application/json" hidden />',
    ].join('\n');
    document.body.append(root);
    enablePanelDrag(root);
    root.addEventListener('focusin', event => { panelLastFocus = event.target; });

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
        if (action === 'fullscreen') {
            state().fullscreen = !state().fullscreen;
            save();
            updatePanelMode();
            return;
        }
        if (action === 'palette') {
            const options = ['tavern', 'day', 'gray'];
            state().theme = options[(options.indexOf(state().theme) + 1) % options.length];
            save();
            root.dataset.theme = state().theme;
            const names = { tavern: '跟随酒馆', day: '日间模式', gray: '灰色夜间' };
            const palette = root.querySelector('#cs-theme-cycle');
            palette.title = '当前：' + names[state().theme] + '（点击切换）';
            palette.setAttribute('aria-label', palette.title);
            updateFloat();
            return;
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
        if (action === 'restore') return document.getElementById('cs-import-file')?.click();
        if (action === 'open') {
            const key = target.closest('[data-avatar-key]')?.dataset.avatarKey;
            if (key) openDetails(key);
        }
    });
    root.querySelector('#cs-search').addEventListener('input', e => {
        query = e.target.value;
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { searchTimer = null; render(); }, 135);
    });
    root.querySelector('#cs-sort').addEventListener('change', e => { state().sort = e.target.value; save(); render(); });
    root.querySelector('#cs-note-input').addEventListener('input', e => {
        root.querySelector('#cs-length').textContent = e.target.value.length + ' 字';
    });
    const editorInput = root.querySelector('#cs-note-input');
    editorInput.addEventListener('focus', () => { inputFocus = true; queueViewportUpdate(); });
    editorInput.addEventListener('blur', () => { inputFocus = false; queueViewportUpdate(); });
    const importInput = root.querySelector('#cs-import-file');
    importInput.addEventListener('change', async e => {
        try { await restoreNotes(e.target.files?.[0]); }
        catch (error) { window.toastr?.error?.(error.message, '角色备注 · 恢复失败'); }
        finally { e.target.value = ''; }
    });
    // The hidden file picker must also be usable while the role-browser modal is closed.
    document.body.append(importInput);
    document.addEventListener('keydown', event => {
        if (root.hidden) return;
        if (!state().fullscreen && !root.contains(event.target)) return;
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
    const section = node('section', 'cs-settings');
    section.id = 'cs-settings-panel';
    const drawer = node('div', 'inline-drawer');
    const header = node('div', 'inline-drawer-toggle inline-drawer-header');
    header.tabIndex = 0;
    header.setAttribute('role', 'button');
    header.setAttribute('aria-label', '展开或收起角色备注设置');
    const heading = node('b', '', '角色备注');
    const chevron = node('div', 'inline-drawer-icon fa-solid fa-circle-chevron-down down');
    chevron.setAttribute('aria-hidden', 'true');
    header.append(heading, chevron);
    header.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            header.click();
        }
    });
    const content = node('div', 'inline-drawer-content cs-settings-content');
    const open = node('button', 'menu_button menu_button_icon cs-settings-open', '打开角色备注');
    open.type = 'button';
    open.addEventListener('click', openPanel);
    const row = node('label', 'cs-settings-toggle');
    const checkbox = node('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'cs-float-toggle';
    checkbox.checked = state().showFloat;
    checkbox.addEventListener('change', () => {
        state().showFloat = checkbox.checked;
        save();
        updateFloat();
    });
    row.append(checkbox, node('span', '', '显示书本悬浮按钮'));
    const actions = node('div', 'cs-settings-actions');
    const backup = node('button', 'menu_button menu_button_icon', '备份备注');
    backup.type = 'button';
    backup.addEventListener('click', downloadNotes);
    const restore = node('button', 'menu_button menu_button_icon', '恢复备注');
    restore.type = 'button';
    restore.addEventListener('click', () => document.getElementById('cs-import-file')?.click());
    actions.append(backup, restore);
    content.append(open, row, actions);
    drawer.append(header, content);
    section.append(drawer);
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
    const bounds = viewportBounds();
    const margin = 8;
    return {
        x: Math.max(margin, Math.min(x, Math.max(margin, bounds.width - width - margin))),
        y: Math.max(margin, Math.min(y, Math.max(margin, bounds.height - height - margin))),
    };
}
function floatLocation(saved, dock, width, height) {
    const bounds = viewportBounds();
    const initialY = Number.isFinite(saved?.y) ? saved.y : bounds.height * 0.55;
    const y = clampFloat(0, initialY, width, height).y;
    if (dock === 'left') return { x: -Math.round(width / 2), y };
    if (dock === 'right') return { x: Math.round(bounds.width - width / 2), y };
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        return clampFloat(saved.x, saved.y, width, height);
    }
    return null;
}
function cancelFloatPeekTimer() {
    if (floatPeekTimer !== null) {
        clearTimeout(floatPeekTimer);
        floatPeekTimer = null;
    }
}
function startFloatPeekTimer() {
    cancelFloatPeekTimer();
    if (!floatPeekSide) return;
    floatPeekTimer = setTimeout(() => {
        floatPeekTimer = null;
        // Peeking is temporary; saved docking remains untouched.
        if (floatPointer || !floatPeekSide) return;
        floatPeekSide = null;
        document.getElementById('cs-float-button')?.classList.add('cs-snapping');
        updateFloat();
    }, 3000);
}
function updateFloat() {
    const button = document.getElementById('cs-float-button');
    if (!button) return;
    const data = state();
    button.hidden = !data.showFloat;
    if (button.hidden) {
        cancelFloatPeekTimer();
        floatPeekSide = null;
    }
    button.dataset.theme = data.theme;
    const peeking = Boolean(data.floatDock && floatPeekSide === data.floatDock);
    button.dataset.dock = peeking ? '' : (data.floatDock || '');
    button.title = peeking ? '点击开启/关闭角色备注（3秒无操作后自动收起）'
        : data.floatDock ? '点击展开书本' : '点击开启/关闭角色备注（可拖动）';
    button.setAttribute('aria-label', peeking ? '开启或关闭角色备注'
        : data.floatDock ? '展开悬浮书本' : '开启或关闭角色备注');
    const checkbox = document.getElementById('cs-float-toggle');
    if (checkbox && checkbox.checked !== data.showFloat) checkbox.checked = data.showFloat;
    if (button.hidden) return;
    const width = button.offsetWidth || 46;
    const height = button.offsetHeight || 46;
    const pos = peeking ? clampFloat(
        floatPeekSide === 'left' ? 8 : viewportBounds().width - width - 8,
        Number.isFinite(data.floatPosition?.y) ? data.floatPosition.y : viewportBounds().height * 0.55,
        width, height
    ) : floatLocation(data.floatPosition, data.floatDock, width, height);
    if (!pos) {
        button.style.left = '';
        button.style.top = '';
        button.style.right = '';
        button.style.bottom = '';
        return;
    }
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
        cancelFloatPeekTimer();
        button.classList.remove('cs-snapping');
        const rect = button.getBoundingClientRect();
        floatPointer = {
            id: event.pointerId, x: event.clientX, y: event.clientY,
            left: rect.left, top: rect.top, width: rect.width, height: rect.height, moving: false,
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
            gesture.width, gesture.height);
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
        if (!gesture.moving) {
            if (event.type === 'pointercancel') {
                updateFloat();
                startFloatPeekTimer();
            }
            return;
        }
        floatPeekSide = null;
        skipFloatClick = event.type === 'pointerup';
        if (event.type === 'pointercancel') {
            updateFloat();
            return;
        }
        // On release near either edge, tuck half the book off-screen.
        const rect = button.getBoundingClientRect();
        const bounds = viewportBounds();
        const threshold = 64;
        const dock = rect.left <= threshold ? 'left'
            : rect.right >= bounds.width - threshold ? 'right' : null;
        const pos = floatLocation({ x: rect.left, y: rect.top }, dock, rect.width, rect.height);
        state().floatDock = dock;
        state().floatPosition = pos;
        button.classList.add('cs-snapping');
        updateFloat();
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
        const data = state();
        if (data.floatDock && floatPeekSide !== data.floatDock) {
            // First tap: reveal temporarily, keeping the persisted dock location.
            floatPeekSide = data.floatDock;
            button.classList.add('cs-snapping');
            updateFloat();
            startFloatPeekTimer();
            return;
        }
        toggleFloatPanel();
        // A second tap is an action, so give the visible book another 3 seconds.
        startFloatPeekTimer();
    });
    window.addEventListener('resize', queueViewportUpdate, { passive: true });
    window.visualViewport?.addEventListener('resize', queueViewportUpdate, { passive: true });
    updateFloat();
}
function init() {
    const previousPaletteVersion = extension_settings[KEY]?.themeVersion;
    state();
    if (previousPaletteVersion !== 4) save();
    createUi();
    launcher();
    buildSettings();
    buildWand();
    buildFloat();
    // Only watch the three host controls, never the entire streaming chat.
    const refreshEntrances = () => { launcher(); buildSettings(); buildWand(); };
    const scopedObserver = new MutationObserver(() => refreshEntrances());
    const watched = new WeakSet();
    const watch = element => {
        if (!element || watched.has(element)) return;
        watched.add(element);
        scopedObserver.observe(element, { childList: true });
    };
    const watchHosts = () => {
        for (const id of ['rm_buttons_container', 'rm_button_bar',
            'extensions_settings2', 'extensions_settings', 'extensionsMenu']) {
            const host = document.getElementById(id);
            watch(host);
            watch(host?.parentElement);
        }
    };
    refreshEntrances();
    watchHosts();
    // Initial UI may mount asynchronously; a short-lived observer finds it and disconnects.
    const startupObserver = new MutationObserver(() => {
        refreshEntrances();
        watchHosts();
        if (document.getElementById('cs-launcher')
            && document.getElementById('cs-settings-panel')
            && document.getElementById('cs-wand-entry')) startupObserver.disconnect();
    });
    if (!(document.getElementById('cs-launcher') && document.getElementById('cs-settings-panel')
        && document.getElementById('cs-wand-entry'))) {
        startupObserver.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => startupObserver.disconnect(), 7000);
    }
    const onUiReady = () => { refreshEntrances(); watchHosts(); };
    eventSource.on(event_types.APP_READY, onUiReady);
    eventSource.on(event_types.EXTENSION_SETTINGS_LOADED, onUiReady);
    for (const type of [event_types.CHARACTER_PAGE_LOADED, event_types.CHARACTER_EDITED,
        event_types.CHARACTER_DELETED, event_types.CHARACTER_DUPLICATED]) {
        eventSource.on(type, () => {
            const root = document.getElementById(ROOT_ID);
            cardCache.clear();
            if (root && !root.hidden && root.querySelector('#cs-editor').hidden) {
                render(listAnchor(root.querySelector('#cs-results')));
                if (detailKey) updateDetails();
            } else panelNeedsRefresh = true;
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
        cardCache.clear();
        if (root && !root.hidden && root.querySelector('#cs-editor').hidden) {
            render(listAnchor(root.querySelector('#cs-results')));
            if (detailKey) updateDetails();
        } else panelNeedsRefresh = true;
    });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
