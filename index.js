/**
 * 角色卡册 / Character Shelf
 * For SillyTavern / TauriTavern. Notes remain in extension_settings,
 * separate from the character card and never enter generation prompts.
 */
import { characters, getThumbnailUrl, saveSettingsDebounced, selectCharacterById } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { eventSource, event_types } from '../../../events.js';

const ROOT_ID = 'character-shelf-root';
const KEY = 'characterShelf';
let query = '';
let editing = '';
let priorFocus = null;

function state() {
    if (!extension_settings[KEY] || typeof extension_settings[KEY] !== 'object' || Array.isArray(extension_settings[KEY])) {
        extension_settings[KEY] = { notes: {}, view: 'list', sort: 'newest' };
    }
    const data = extension_settings[KEY];
    if (!data.notes || typeof data.notes !== 'object' || Array.isArray(data.notes)) data.notes = {};
    if (data.view !== 'grid' && data.view !== 'list') data.view = 'list';
    if (!['newest', 'oldest', 'az', 'za'].includes(data.sort)) data.sort = 'newest';
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
    return characters.filter(Boolean).map((character, index) => ({
        character: character, index: index, key: idFor(character), time: whenAdded(character),
    }));
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
    const shown = all.filter(entry => !needle
        || String(entry.character.name || '').toLocaleLowerCase().includes(needle)
        || noteFor(entry.key).toLocaleLowerCase().includes(needle));
    shown.sort(sortItems);
    results.replaceChildren();
    results.className = 'cs-results cs-' + data.view;
    root.querySelector('#cs-sort').value = data.sort;
    root.querySelector('#cs-view-list').setAttribute('aria-pressed', String(data.view === 'list'));
    root.querySelector('#cs-view-grid').setAttribute('aria-pressed', String(data.view === 'grid'));
    root.querySelector('#cs-count').textContent = '共 ' + all.length + ' 张 · 已备注 '
        + all.filter(entry => noteFor(entry.key).trim()).length + ' 张 · 显示 ' + shown.length + ' 张';
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
            const summary = node('div', 'cs-summary' + (note.trim() ? '' : ' cs-placeholder'), note.trim() || '还没有备注，点击铅笔添加');
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
        const edit = node('button', 'cs-edit', '✎');
        edit.type = 'button';
        edit.dataset.action = 'edit';
        edit.setAttribute('aria-label', '编辑 ' + (entry.character.name || '角色') + ' 的备注');
        edit.title = '编辑私人备注';
        card.append(edit);
        batch.append(card);
    }
    results.append(batch);
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
}
function openPanel() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    priorFocus = document.activeElement;
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
    link.download = '角色卡册-备注备份-' + new Date().toISOString().slice(0, 10) + '.json';
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
    window.toastr?.success?.('已恢复 ' + entries.length + ' 条备注', '角色卡册');
}
async function openCharacter(key) {
    const entry = allCharacters().find(item => item.key === key);
    if (!entry) return;
    try {
        await selectCharacterById(entry.index);
        closePanel();
    } catch (error) {
        console.error('[CharacterShelf] Open character failed:', error);
        window.toastr?.error?.('无法打开角色，请从原角色列表重试', '角色卡册');
    }
}
function createUi() {
    if (document.getElementById(ROOT_ID)) return;
    const root = node('div', 'cs-layer');
    root.id = ROOT_ID;
    root.hidden = true;
    root.innerHTML = [
        '<div class="cs-backdrop" data-action="close"></div>',
        '<section class="cs-window" role="dialog" aria-modal="true" aria-label="角色卡册">',
        '  <header class="cs-header"><div><div class="cs-eyebrow">CHARACTER SHELF</div>',
        '    <h2>角色卡册</h2><p>每张角色卡，都有一条只属于你的备注。</p></div>',
        '    <button type="button" class="cs-close" data-action="close" aria-label="关闭">×</button></header>',
        '  <div class="cs-toolbar">',
        '    <input id="cs-search" type="search" placeholder="搜索角色名字或备注…" aria-label="搜索角色" />',
        '    <select id="cs-sort" aria-label="排序">',
        '      <option value="newest">导入时间：新 → 旧</option>',
        '      <option value="oldest">导入时间：旧 → 新</option>',
        '      <option value="az">名字：A → Z</option>',
        '      <option value="za">名字：Z → A</option>',
        '    </select>',
        '    <div class="cs-switch">',
        '      <button type="button" id="cs-view-list" data-action="list">☷ 列表</button>',
        '      <button type="button" id="cs-view-grid" data-action="grid">▦ 头像</button>',
        '    </div>',
        '  </div>',
        '  <div id="cs-count" class="cs-count"></div>',
        '  <div id="cs-results" class="cs-results"></div>',
        '  <footer class="cs-footer"><span>点角色打开 · 点铅笔编辑</span>',
        '    <div><button type="button" data-action="backup">备份备注</button>',
        '         <button type="button" data-action="restore">恢复备注</button></div></footer>',
        '</section>',
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
        if (action === 'cancel') return closeEditor();
        if (action === 'save') return saveEditor();
        if (action === 'list' || action === 'grid') {
            state().view = action;
            save();
            return render();
        }
        if (action === 'backup') return downloadNotes();
        if (action === 'restore') return root.querySelector('#cs-import-file').click();
        if (action === 'edit' || action === 'open') {
            const key = target.closest('[data-avatar-key]')?.dataset.avatarKey;
            if (!key) return;
            return action === 'edit' ? openEditor(key) : openCharacter(key);
        }
    });
    root.querySelector('#cs-search').addEventListener('input', e => { query = e.target.value; render(); });
    root.querySelector('#cs-sort').addEventListener('change', e => { state().sort = e.target.value; save(); render(); });
    root.querySelector('#cs-note-input').addEventListener('input', e => {
        root.querySelector('#cs-length').textContent = e.target.value.length + ' 字';
    });
    root.querySelector('#cs-import-file').addEventListener('change', async e => {
        try { await restoreNotes(e.target.files?.[0]); }
        catch (error) { window.toastr?.error?.(error.message, '角色卡册 · 恢复失败'); }
        finally { e.target.value = ''; }
    });
    document.addEventListener('keydown', event => {
        if (root.hidden) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            if (!root.querySelector('#cs-editor').hidden) closeEditor();
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
    button.title = '角色卡册 · 私人备注';
    button.setAttribute('aria-label', '打开角色卡册');
    button.addEventListener('click', openPanel);
    container.append(button);
}
function init() {
    state();
    createUi();
    launcher();
    const observer = new MutationObserver(() => {
        if (!document.getElementById('cs-launcher')) launcher();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    for (const type of [event_types.CHARACTER_PAGE_LOADED, event_types.CHARACTER_EDITED,
        event_types.CHARACTER_DELETED, event_types.CHARACTER_DUPLICATED]) {
        eventSource.on(type, () => {
            const root = document.getElementById(ROOT_ID);
            if (root && !root.hidden) render();
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
        if (root && !root.hidden) render();
    });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
