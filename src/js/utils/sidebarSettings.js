/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    sidebarSettings.js
 * @brief   Настройки сайдбара - показ/скрытие нод, конфигурации, экспорт/импорт
 * @author  Pavel Fomin
 * @version 1.8.72
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

/**
 * sidebarSettings.js - Раунд 102 (чек-лист 1.7.21, раздел 5).
 *
 * Список нод для галочек СКАНИРУЕТСЯ из реального DOM сайдбара
 * (`.node-item[data-type]`) при каждом открытии панели - не хранится
 * отдельным жёстко зашитым списком, поэтому автоматически остаётся
 * актуальным при добавлении новых типов нод в index.html, без правки
 * этого файла.
 *
 * Хранилище - localStorage, ключ STORAGE_KEY. Формат:
 *   { activeConfig: 'all' | 'gantt' | <имя пользовательской>,
 *     customConfigs: { [имя]: { enabledTypes: string[] } } }
 *
 * Готовые конфигурации ("Все ноды"/"Графики Ганта") - НЕизменяемые
 * (checkbox'ы недоступны для правки, пока активна одна из них) - чтобы
 * изменить состав, нужно явно создать СВОЮ конфигурацию (кнопка "+ Своя",
 * копирует текущий набор как отправную точку) - те уже редактируются
 * "на лету", каждое изменение галочки сразу сохраняется.
 */

const STORAGE_KEY = 'nodecalculate_sidebar_configs';

// Раунд 102 (чек-лист, п.5.3) - точный список из чек-листа Mr.D для
// конфигурации "Графики Ганта".
const PRESET_CONFIGS = {
    all: { name: 'Все ноды', builtin: true, enabledTypes: null }, // null = показывать вообще все
    gantt: {
        name: 'Графики Ганта',
        builtin: true,
        enabledTypes: [
            'listInput', 'xlsxImport', 'jsonImport', 'exportXlsx',
            'gantt', 'calendar', 'ganttTableProcessor', 'tableViewer', 'string'
        ]
    }
};

function loadStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { activeConfig: 'all', customConfigs: {} };
        const parsed = JSON.parse(raw);
        return {
            activeConfig: parsed.activeConfig || 'all',
            customConfigs: parsed.customConfigs && typeof parsed.customConfigs === 'object' ? parsed.customConfigs : {}
        };
    } catch (e) {
        return { activeConfig: 'all', customConfigs: {} };
    }
}

function saveStorage(state) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        console.error('Не удалось сохранить настройки сайдбара:', e);
    }
}

function getAllNodeItems() {
    return [...document.querySelectorAll('.node-item[data-type]')];
}

// Собирает {type, name, icon, sectionTitle} по каждой ноде сайдбара -
// прямо из DOM, см. докстринг файла.
function scanNodeRegistry() {
    return getAllNodeItems().map(el => {
        const section = el.closest('.sidebar-section');
        const sectionTitle = section?.querySelector('.section-title')?.textContent?.trim() || 'Без категории';
        return {
            type: el.dataset.type,
            name: el.querySelector('.node-name')?.textContent?.trim() || el.dataset.type,
            icon: el.querySelector('.node-icon')?.textContent?.trim() || '',
            sectionTitle,
            el
        };
    });
}

function resolveConfig(state, configId) {
    if (PRESET_CONFIGS[configId]) return PRESET_CONFIGS[configId];
    if (state.customConfigs[configId]) return { name: configId, builtin: false, enabledTypes: state.customConfigs[configId].enabledTypes };
    return PRESET_CONFIGS.all;
}

// Применяет конфигурацию к реальному сайдбару - показывает/скрывает
// .node-item, а если ВСЯ секция опустела - скрывает и её заголовок
// целиком (не показываем пустой раздел без единой ноды внутри).
function applyConfig(enabledTypes) {
    const items = scanNodeRegistry();
    const sectionsWithVisible = new Set();

    items.forEach(item => {
        const visible = enabledTypes === null || enabledTypes.includes(item.type);
        item.el.style.display = visible ? '' : 'none';
        if (visible) sectionsWithVisible.add(item.sectionTitle);
    });

    document.querySelectorAll('.sidebar-section').forEach(section => {
        const title = section.querySelector('.section-title')?.textContent?.trim();
        const anyVisible = enabledTypes === null || sectionsWithVisible.has(title);
        section.style.display = anyVisible ? '' : 'none';
    });
}

export const SidebarSettings = {
    _state: null,

    init() {
        this._state = loadStorage();
        const cfg = resolveConfig(this._state, this._state.activeConfig);
        applyConfig(cfg.enabledTypes);
        this._wireModal();
    },

    _wireModal() {
        const btn = document.getElementById('sidebarSettingsBtn');
        const modal = document.getElementById('sidebarSettingsModal');
        const backdrop = document.getElementById('sidebarSettingsBackdrop');
        const closeBtn = document.getElementById('sidebarSettingsClose');
        if (!btn || !modal) return;

        const open = () => { this._renderPanel(); modal.style.display = 'flex'; };
        const close = () => { modal.style.display = 'none'; };

        btn.addEventListener('click', open);
        backdrop.addEventListener('click', close);
        closeBtn.addEventListener('click', close);

        document.getElementById('sidebarSettingsNewConfigBtn').addEventListener('click', () => this._createCustomConfig());
        document.getElementById('sidebarSettingsDeleteConfigBtn').addEventListener('click', () => this._deleteCurrentConfig());
        document.getElementById('sidebarSettingsExportBtn').addEventListener('click', () => this._exportConfig());
        document.getElementById('sidebarSettingsImportBtn').addEventListener('click', () => {
            document.getElementById('sidebarSettingsImportFile').click();
        });
        document.getElementById('sidebarSettingsImportFile').addEventListener('change', (e) => this._importConfig(e));
        document.getElementById('sidebarSettingsConfigSelect').addEventListener('change', (e) => {
            this._state.activeConfig = e.target.value;
            saveStorage(this._state);
            const cfg = resolveConfig(this._state, this._state.activeConfig);
            applyConfig(cfg.enabledTypes);
            this._renderPanel();
        });

        // Раунд 123 (релиз 1.8.0, "стартап-конфиги") - переключение
        // вкладок "Сайдбар"/"Запуск" - просто показывает/скрывает уже
        // готовые блоки разметки, ничего не пересоздаёт. Раунд 184 -
        // добавлена третья вкладка "Проекты" - тот же приём, список
        // просто расширен.
        const tabBtns = [
            document.getElementById('settingsTabBtnProjects'),
            document.getElementById('settingsTabBtnSidebar'),
            document.getElementById('settingsTabBtnStartup')
        ];
        const tabPanels = {
            projects: document.getElementById('settingsTabProjects'),
            sidebar: document.getElementById('settingsTabSidebar'),
            startup: document.getElementById('settingsTabStartup')
        };
        tabBtns.forEach(tabBtn => {
            tabBtn.addEventListener('click', () => {
                tabBtns.forEach(b => b.classList.remove('active'));
                tabBtn.classList.add('active');
                Object.entries(tabPanels).forEach(([key, panel]) => {
                    panel.style.display = key === tabBtn.dataset.tab ? '' : 'none';
                });
                // Раунд 184 - список недавних проектов может устареть,
                // пока модалка открыта на ДРУГОЙ вкладке (сохранили в
                // это время) - перечитываем при КАЖДОМ переключении НА
                // вкладку "Проекты", не только при открытии всей модалки.
                if (tabBtn.dataset.tab === 'projects') renderRecentProjects();
            });
        });

        // Раунд 184 (по запросу Mr.D: "Менеджер текущих проектов -
        // панель/список недавно сохранённых проектов с быстрым
        // открытием") - список читается из main-процесса (userData,
        // см. main.js) при каждом открытии - там же отсеиваются пути,
        // которых уже физически нет на диске (см.
        // pruneMissingRecentProjects()).
        async function renderRecentProjects() {
            const listEl = document.getElementById('settingsRecentProjectsList');
            const hintEl = document.getElementById('settingsProjectsHint');
            if (!listEl || !window.electron?.getRecentProjects) return;
            const recent = await window.electron.getRecentProjects();
            listEl.innerHTML = '';
            if (!recent || recent.length === 0) {
                if (hintEl) hintEl.textContent = 'Пока нет недавних проектов - сохраните текущий, чтобы он появился здесь.';
                return;
            }
            if (hintEl) hintEl.textContent = '';
            recent.forEach(entry => {
                const row = document.createElement('div');
                row.className = 'sidebar-settings-item-row';
                row.title = entry.path;

                const nameEl = document.createElement('span');
                nameEl.textContent = entry.name;
                nameEl.style.cssText = 'flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
                row.appendChild(nameEl);

                const dateEl = document.createElement('span');
                dateEl.textContent = new Date(entry.lastOpened).toLocaleDateString('ru-RU');
                dateEl.style.cssText = 'color: var(--md-text-disabled); font-size: 10px; flex-shrink: 0;';
                row.appendChild(dateEl);

                row.addEventListener('click', () => {
                    window.electron.openRecentProject(entry.path);
                    document.getElementById('sidebarSettingsModal').style.display = 'none';
                });
                listEl.appendChild(row);
            });
        }
        renderRecentProjects();

        document.getElementById('settingsNewProjectBtn')?.addEventListener('click', () => {
            if (window.clearWorkspace) window.clearWorkspace();
            window.electron?.resetCurrentProject?.();
            document.getElementById('sidebarSettingsModal').style.display = 'none';
        });
        document.getElementById('settingsOpenProjectBtn')?.addEventListener('click', () => {
            window.loadProject?.();
            document.getElementById('sidebarSettingsModal').style.display = 'none';
        });

        // Раунд 123 - "Сохранить текущее как стартовое" - собирает ТЕ ЖЕ
        // данные, что уходят при обычном "Сохранить проект" (см. main.js,
        // onGetProjectData() - layoutManager.serialize() +
        // boardManager.serialize()), но пишет их НАПРЯМУЮ (invoke с
        // данными как аргументом) - без диалога "Сохранить как" и без
        // события-round-trip get-project-data/project-data (та
        // асинхронная пара нужна ТОЛЬКО потому, что main-процесс сам не
        // может дотянуться до состояния рендерера - здесь мы уже В
        // рендерере, собираем данные сразу на месте).
        document.getElementById('settingsSaveStartupBtn')?.addEventListener('click', async () => {
            if (!window.electron?.saveDefaultWorkspace) return;
            const layoutData = window.layoutManager?.serialize() || { layouts: [] };
            const boardData = window.boardManager?.serialize() || { boards: [] };
            const result = await window.electron.saveDefaultWorkspace({ ...layoutData, ...boardData });
            const hint = document.getElementById('settingsStartupHint');
            if (hint) {
                hint.textContent = result?.success
                    ? '✅ Сохранено - откроется автоматически при следующем запуске'
                    : `❌ Не удалось сохранить: ${result?.error || 'неизвестная ошибка'}`;
            }
        });

        document.getElementById('settingsClearStartupBtn')?.addEventListener('click', async () => {
            if (!window.electron?.clearDefaultWorkspace) return;
            if (!confirm('Сбросить стартовое рабочее пространство? При следующем запуске откроется пример по умолчанию.')) return;
            const result = await window.electron.clearDefaultWorkspace();
            const hint = document.getElementById('settingsStartupHint');
            if (hint) {
                hint.textContent = result?.success ? '🗑️ Стартовое рабочее пространство сброшено' : `❌ Ошибка: ${result?.error || ''}`;
            }
        });

        // Раунд 179 (по запросу Mr.D: "добавим окно приветствия с
        // галочкой не показывать при следующем старте") - без этой
        // кнопки, поставив галочку один раз, вернуться к окну
        // приветствия можно было бы только вручную редактируя
        // localStorage. Снимает флаг И показывает модалку сразу же
        // (window.showWelcomeScreen - выставляется main.js при
        // инициализации, см. initWelcomeScreen()).
        document.getElementById('settingsShowWelcomeBtn')?.addEventListener('click', () => {
            localStorage.removeItem('nodecalculate-hide-welcome');
            window.showWelcomeScreen?.();
        });
    },

    _renderPanel() {
        const select = document.getElementById('sidebarSettingsConfigSelect');
        select.innerHTML = '';
        Object.entries(PRESET_CONFIGS).forEach(([id, cfg]) => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = cfg.name;
            select.appendChild(opt);
        });
        Object.keys(this._state.customConfigs).forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = `👤 ${name}`;
            select.appendChild(opt);
        });
        select.value = this._state.activeConfig;

        const cfg = resolveConfig(this._state, this._state.activeConfig);
        const readOnly = cfg.builtin;

        const hint = document.getElementById('sidebarSettingsHint');
        hint.textContent = readOnly
            ? 'Готовая конфигурация — только для чтения. Нажмите "+ Своя", чтобы создать редактируемую копию.'
            : 'Своя конфигурация — отметьте нужные ноды, изменения сохраняются сразу.';

        const deleteBtn = document.getElementById('sidebarSettingsDeleteConfigBtn');
        deleteBtn.disabled = readOnly;
        deleteBtn.style.opacity = readOnly ? '0.4' : '1';

        const listEl = document.getElementById('sidebarSettingsNodeList');
        listEl.innerHTML = '';
        const items = scanNodeRegistry();
        const bySection = new Map();
        items.forEach(item => {
            if (!bySection.has(item.sectionTitle)) bySection.set(item.sectionTitle, []);
            bySection.get(item.sectionTitle).push(item);
        });

        const enabledSet = cfg.enabledTypes === null ? null : new Set(cfg.enabledTypes);

        bySection.forEach((sectionItems, sectionTitle) => {
            const sectionEl = document.createElement('div');
            sectionEl.className = 'sidebar-settings-section';
            const heading = document.createElement('div');
            heading.className = 'sidebar-settings-section-title';
            heading.textContent = sectionTitle;
            sectionEl.appendChild(heading);

            sectionItems.forEach(item => {
                const row = document.createElement('label');
                row.className = 'sidebar-settings-item-row';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = enabledSet === null || enabledSet.has(item.type);
                checkbox.disabled = readOnly;
                checkbox.addEventListener('change', () => {
                    this._toggleType(item.type, checkbox.checked);
                });
                row.appendChild(checkbox);
                const label = document.createElement('span');
                label.textContent = `${item.icon} ${item.name}`;
                row.appendChild(label);
                sectionEl.appendChild(row);
            });

            listEl.appendChild(sectionEl);
        });
    },

    _toggleType(type, checked) {
        const configId = this._state.activeConfig;
        if (PRESET_CONFIGS[configId]) return; // готовые конфигурации только для чтения
        const custom = this._state.customConfigs[configId];
        if (!custom) return;
        const set = new Set(custom.enabledTypes);
        if (checked) set.add(type); else set.delete(type);
        custom.enabledTypes = [...set];
        saveStorage(this._state);
        applyConfig(custom.enabledTypes);
    },

    _createCustomConfig() {
        const baseCfg = resolveConfig(this._state, this._state.activeConfig);
        const baseTypes = baseCfg.enabledTypes === null
            ? scanNodeRegistry().map(i => i.type)
            : [...baseCfg.enabledTypes];

        let name = `Своя ${Object.keys(this._state.customConfigs).length + 1}`;
        // Правило проекта: window.prompt() не поддерживается в Electron -
        // сразу создаём конфигурацию с временным именем, инлайновое
        // переименование - прямо в select (см. _startInlineRename()
        // ниже), как и везде в проекте (например, переименование ноды).
        this._state.customConfigs[name] = { enabledTypes: baseTypes };
        this._state.activeConfig = name;
        saveStorage(this._state);
        applyConfig(baseTypes);
        this._renderPanel();
        this._startInlineRename(name);
    },

    _startInlineRename(name) {
        const select = document.getElementById('sidebarSettingsConfigSelect');
        const wrapper = select.parentElement;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'sidebar-settings-select';
        input.value = name;
        select.style.display = 'none';
        wrapper.insertBefore(input, select);
        input.focus();
        input.select();

        const commit = () => {
            const newName = input.value.trim() || name;
            if (newName !== name && !this._state.customConfigs[newName]) {
                this._state.customConfigs[newName] = this._state.customConfigs[name];
                delete this._state.customConfigs[name];
                this._state.activeConfig = newName;
                saveStorage(this._state);
            }
            input.remove();
            select.style.display = '';
            this._renderPanel();
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') input.blur();
        });
    },

    _deleteCurrentConfig() {
        const configId = this._state.activeConfig;
        if (PRESET_CONFIGS[configId]) return;
        delete this._state.customConfigs[configId];
        this._state.activeConfig = 'all';
        saveStorage(this._state);
        applyConfig(PRESET_CONFIGS.all.enabledTypes);
        this._renderPanel();
    },

    _exportConfig() {
        const cfg = resolveConfig(this._state, this._state.activeConfig);
        const payload = {
            name: cfg.name,
            enabledTypes: cfg.enabledTypes
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nodecalculate-sidebar-${cfg.name.replace(/\s+/g, '_')}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },

    async _importConfig(e) {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            if (!parsed || typeof parsed.name !== 'string' || !Array.isArray(parsed.enabledTypes)) {
                throw new Error('Неверный формат файла конфигурации');
            }
            let name = parsed.name;
            let suffix = 1;
            while (this._state.customConfigs[name] || PRESET_CONFIGS[name]) {
                name = `${parsed.name} (${++suffix})`;
            }
            this._state.customConfigs[name] = { enabledTypes: parsed.enabledTypes };
            this._state.activeConfig = name;
            saveStorage(this._state);
            applyConfig(parsed.enabledTypes);
            this._renderPanel();
        } catch (err) {
            console.error('Не удалось импортировать конфигурацию сайдбара:', err);
            alert('Не удалось прочитать файл конфигурации - проверьте формат JSON.');
        }
    }
};
