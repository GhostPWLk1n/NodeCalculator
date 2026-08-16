/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    main.js
 * @brief   Electron main-процесс: создание окна, меню, IPC-обработчики сохранения/загрузки .ncp и экспорта изображения
 * @author  Pavel Fomin
 * @version 1.8.72
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Раунд 128 (багфикс, по жалобе Mr.D: ошибки "Unable to move the
// cache"/"Gpu Cache Creation failed" при каждом запуске на Windows) -
// известная особенность Chromium на Windows: внутренний дисковый кэш
// (сетевой + GPU shader) не может создаться/переместиться, обычно
// из-за прав доступа к папке userData или блокировки файлов другим
// (в т.ч. уже запущенным) процессом - antivirus тоже нередкая причина.
// НЕ связано с default-workspace.ncp (Раунд 127) - это ВНУТРЕННИЙ кэш
// самого Chromium, инициализируется ДО того, как выполняется хоть
// какой-то код main.js. Приложение при этом продолжало РАБОТАТЬ (кэш
// просто не создавался, не блокирующая ошибка) - но эти строки
// засоряли консоль при каждом запуске. Стандартное решение - отключить
// сам дисковый кэш явно, ДО app.whenReady() (переключатели командной
// строки Chromium должны быть выставлены раньше готовности приложения,
// иначе не подхватятся).
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

let mainWindow;
// Раунд 184 (по запросу Mr.D: "Сохранить - работает только если у
// проекта есть имя. Сохраняет поверх текущего файла. Сохранить как -
// всегда открывает диалог") - путь ТЕКУЩЕГО проекта - null, пока
// проект НИ РАЗУ не был сохранён/загружен из конкретного файла (только
// что открытое пустое рабочее пространство, или дефолтное стартовое -
// то физически ДРУГОЙ путь, см. getAppDataWorkspacePath(), не считается
// "именованным проектом" для целей этой логики).
let currentProjectPath = null;
// Раунд 184 - dirty-флаг синхронизируется ИЗ рендерера (там происходят
// реальные правки проекта - main.js/nodeManager.js шлют 'mark-dirty' на
// каждое содержательное изменение, см. src/js/main.js) - здесь только
// ХРАНИТСЯ, чтобы диалог закрытия (следующий раунд) и заголовок окна
// могли его читать без лишнего IPC-обмена туда-обратно.
let isProjectDirty = false;

// Раунд 129 (по подтверждению Mr.D: ошибки disk_cache из Раунда 128
// были вызваны именно повторным запуском - второй процесс пытался
// использовать ТЕ ЖЕ файлы кэша, что уже держал открытыми первый) -
// requestSingleInstanceLock() - штатный механизм Electron: получает
// "замок" на уровне ОС при первом запуске - если он уже занят (второй
// запуск, пока первый ещё открыт), возвращает false. ДОЛЖЕН вызываться
// ДО app.whenReady() (и вообще максимально рано) - иначе второй
// процесс успеет создать СВОЁ окно/начать инициализацию до того, как
// поймёт, что он лишний.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
    // Это - ВТОРОЙ (лишний) процесс. quit() + return здесь безопасны -
    // до этого момента окно/что-либо ещё не создавалось (проверка -
    // самое начало файла, выше только commandLine.appendSwitch()).
    // Верхнеуровневый return допустим - CommonJS-модуль Node.js целиком
    // оборачивается в функцию самой системой модулей.
    app.quit();
    return;
}

// Это - ПЕРВЫЙ (основной) процесс. second-instance - срабатывает
// именно НА НЁМ, когда кто-то попытался запустить приложение ПОВТОРНО,
// пока оно уже открыто - вместо создания второго окна (или вместо
// непонятной ошибки disk_cache, как было раньше) - возвращаем фокус на
// уже существующее окно, разворачиваем, если было свёрнуто.
app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
});

// Раунд 127 (багфикс, по жалобе Mr.D: ENOENT при сохранении - путь
// вёл внутрь app.asar) - __dirname в УПАКОВАННОМ приложении указывает
// внутрь app.asar (сжатый архив, доступен ТОЛЬКО для чтения - запись
// туда физически невозможна, отсюда ENOENT) - в режиме разработки
// (npm start, без упаковки) __dirname указывает на обычную папку с
// исходниками, поэтому баг не проявлялся при разработке.
//
// По решению Mr.D: приоритет - AppData (`app.getPath('userData')`,
// переживает переустановку программы), а если туда почему-то не
// получилось записать (права доступа и т.п.) - рядом с exe самой
// программы (`path.dirname(process.execPath)` - и в упакованном виде,
// и в режиме разработки корректно указывает на исполняемый файл, не
// внутрь asar). Чтение при старте - симметрично, тот же приоритет.
function getAppDataWorkspacePath() {
    return path.join(app.getPath('userData'), 'default-workspace.ncp');
}
function getExeDirWorkspacePath() {
    return path.join(path.dirname(process.execPath), 'default-workspace.ncp');
}
// Находит СУЩЕСТВУЮЩИЙ файл по приоритету AppData -> рядом с exe, или
// null, если нет ни там, ни там (в частности - самый первый запуск,
// когда стартовое рабочее пространство ещё ни разу не сохранялось).
function findDefaultWorkspacePath() {
    if (fs.existsSync(getAppDataWorkspacePath())) return getAppDataWorkspacePath();
    if (fs.existsSync(getExeDirWorkspacePath())) return getExeDirWorkspacePath();
    return null;
}

// Раунд 184 (по запросу Mr.D: "Менеджер текущих проектов - панель/
// список недавно сохранённых проектов с быстрым открытием") - JSON-файл
// в userData (переживает переустановку, тот же принцип, что уже
// применён к getAppDataWorkspacePath() выше) - массив {path, name,
// lastOpened} - по одной записи на файл (не на каждое открытие -
// повторное открытие того же файла ОБНОВЛЯЕТ его lastOpened и
// поднимает наверх списка, не дублирует запись), максимум 10 штук.
const RECENT_PROJECTS_LIMIT = 10;
function getRecentProjectsPath() {
    return path.join(app.getPath('userData'), 'recent-projects.json');
}
function readRecentProjects() {
    try {
        const raw = fs.readFileSync(getRecentProjectsPath(), 'utf8');
        const list = JSON.parse(raw);
        return Array.isArray(list) ? list : [];
    } catch {
        return []; // файла ещё нет (первый запуск) или он повреждён - пустой список, не падаем
    }
}
function writeRecentProjects(list) {
    try {
        fs.writeFileSync(getRecentProjectsPath(), JSON.stringify(list, null, 2));
    } catch (error) {
        console.error('Не удалось сохранить список недавних проектов:', error.message);
    }
}
// Добавляет/поднимает filePath в начало списка - вызывается ПОСЛЕ
// КАЖДОГО успешного сохранения/загрузки конкретного файла (не
// дефолтного рабочего пространства - у того своя, отдельная механика).
function touchRecentProject(filePath) {
    const list = readRecentProjects().filter(entry => entry.path !== filePath);
    list.unshift({ path: filePath, name: path.basename(filePath, '.ncp'), lastOpened: Date.now() });
    writeRecentProjects(list.slice(0, RECENT_PROJECTS_LIMIT));
}
// Убирает запись, если сам файл на диске больше не существует (был
// удалён/перемещён ВНЕ программы) - вызывается перед КАЖДОЙ отдачей
// списка в рендерер, чтобы панель никогда не показывала "мёртвые" пути.
function pruneMissingRecentProjects() {
    const list = readRecentProjects().filter(entry => fs.existsSync(entry.path));
    writeRecentProjects(list);
    return list;
}

// Раунд 184 (по запросу Mr.D: dirty-флаг в заголовке - стандартная
// практика "звёздочка/точка у названия файла, пока не сохранено") -
// заголовок окна ВСЕГДА отражает currentProjectPath/isProjectDirty,
// обновляется при любом изменении любого из них (см. вызовы ниже).
function updateWindowTitle() {
    if (!mainWindow) return;
    const name = currentProjectPath ? path.basename(currentProjectPath, '.ncp') : 'Без названия';
    const dirtyMark = isProjectDirty ? ' •' : '';
    mainWindow.setTitle(`${name}${dirtyMark} — NodeCalculate`);
}

// Раунд 185 (по запросу Mr.D: "Автосохранение по времени - полная
// сериализация проекта в папку AutoSave/ с временной меткой") -
// применяется ТОЛЬКО к БЕЗЫМЯННЫМ проектам (у именованных - своя схема,
// .ncptemp РЯДОМ с реальным файлом, см. performAutosave() ниже) -
// снимки со штампом времени в имени, старые излишки подчищаются
// (AUTOSAVE_SNAPSHOTS_LIMIT), чтобы папка не росла бесконечно за много
// сессий работы с безымянными проектами.
const AUTOSAVE_INTERVAL_MS = 2 * 60 * 1000; // 2 минуты
const AUTOSAVE_SNAPSHOTS_LIMIT = 5;
function getAutoSaveDir() {
    return path.join(app.getPath('userData'), 'AutoSave');
}
function ensureAutoSaveDir() {
    const dir = getAutoSaveDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}
function pruneOldAutosaveSnapshots(dir) {
    try {
        const files = fs.readdirSync(dir)
            .filter(f => f.endsWith('.ncp'))
            .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime); // новые первыми
        files.slice(AUTOSAVE_SNAPSHOTS_LIMIT).forEach(f => fs.unlinkSync(path.join(dir, f.name)));
    } catch (error) {
        console.error('Не удалось подчистить старые автосохранения:', error.message);
    }
}

// Раунд 185 (по запросу Mr.D: "Восстановление после сбоя - при запуске
// проверять наличие AutoSave и предлагать восстановить последнюю
// версию") - currentProjectPath живёт ТОЛЬКО в памяти текущего
// процесса - при аварийном завершении (не через штатный close/forceQuit)
// эта информация терялась бы безвозвратно, и при следующем запуске
// программа не знала бы, у КАКОГО именно именованного проекта
// проверять .ncptemp рядом с ним. Небольшой файл в userData - "какой
// путь был открыт последним" - переживает даже аварийное завершение
// (пишется СРАЗУ при открытии/сохранении, не при выходе).
function getLastSessionPath() {
    return path.join(app.getPath('userData'), 'last-session.json');
}
function readLastSessionProjectPath() {
    try {
        const data = JSON.parse(fs.readFileSync(getLastSessionPath(), 'utf8'));
        return data?.path || null;
    } catch {
        return null;
    }
}
function writeLastSessionProjectPath(filePath) {
    try {
        fs.writeFileSync(getLastSessionPath(), JSON.stringify({ path: filePath }));
    } catch (error) {
        console.error('Не удалось запомнить путь текущей сессии:', error.message);
    }
}

// Раунд 185 (по запросу Mr.D: "Восстановление после сбоя - при
// запуске проверять наличие AutoSave и предлагать восстановить
// последнюю версию") - ДВА независимых источника кандидатов:
// 1) .ncptemp РЯДОМ с последним известным ИМЕНОВАННЫМ проектом
//    (readLastSessionProjectPath() - переживает даже аварийное
//    завершение, пишется СРАЗУ при открытии/сохранении) - в приоритете,
//    раз он привязан к КОНКРЕТНОМУ, узнаваемому пользователем файлу;
// 2) самый свежий снимок в общей AutoSave/ - для БЕЗЫМЯННЫХ проектов
//    (у тех попросту нет своего .ncptemp - не рядом с чем его класть).
// Возвращает true, если пользователь согласился и восстановление
// прошло успешно (тогда дефолтное рабочее пространство подгружать не
// нужно - см. вызов в createWindow()).
async function checkForRecovery() {
    const lastPath = readLastSessionProjectPath();
    let candidatePath = null;
    let candidateLabel = null;
    let candidateForNamed = null; // если кандидат - .ncptemp именованного проекта, запоминаем ЕГО путь отдельно

    if (lastPath && fs.existsSync(`${lastPath}.ncptemp`)) {
        candidatePath = `${lastPath}.ncptemp`;
        candidateLabel = path.basename(lastPath, '.ncp');
        candidateForNamed = lastPath;
    } else {
        const dir = getAutoSaveDir();
        if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir)
                .filter(f => f.endsWith('.ncp'))
                .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
                .sort((a, b) => b.mtime - a.mtime);
            if (files.length > 0) {
                candidatePath = path.join(dir, files[0].name);
                candidateLabel = 'безымянный проект';
            }
        }
    }

    if (!candidatePath) return false;

    const result = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Восстановить', 'Не восстанавливать'],
        defaultId: 0,
        cancelId: 1,
        title: 'Обнаружено автосохранение',
        message: `Похоже, программа завершилась некорректно в прошлый раз. Найдена несохранённая версия "${candidateLabel}" - восстановить её?`
    });
    if (result.response !== 0) return false;

    try {
        const data = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
        mainWindow.webContents.send('load-project', data);
        // Восстановленные данные ИЗ БЭКАПА, не из самого .ncp на диске
        // (если это был .ncptemp именованного проекта) - помечаем
        // изменённым, чтобы пользователь не забыл сохранить поверх РЕАЛЬНОГО
        // файла явно, а не просто продолжил работу как ни в чём не бывало.
        if (candidateForNamed) currentProjectPath = candidateForNamed;
        isProjectDirty = true;
        updateWindowTitle();
        return true;
    } catch (error) {
        dialog.showErrorBox('Ошибка восстановления', error.message);
        return false;
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, 'icon.png'),
        backgroundColor: '#1a1a2e',
        show: false
    });

    mainWindow.loadFile(path.join(__dirname, 'src/index.html'));

    // Раунд 185 (по запросу Mr.D: "Восстановление после сбоя - при
    // запуске проверять наличие AutoSave и предлагать восстановить
    // последнюю версию") - проверяется ПЕРВЫМ, ДО дефолтного рабочего
    // пространства (Раунд 123, ниже) - если пользователь согласился
    // восстановиться, дефолтное пространство загружать уже не нужно.
    // did-finish-load (не ready-to-show) - нужно, чтобы к этому
    // моменту скрипты рендерера (main.js, регистрирующий onLoadProject)
    // уже успели выполниться - тем же событием 'load-project', что и
    // обычная ручная загрузка (рендерер не должен знать разницу, см.
    // preload.js).
    mainWindow.webContents.once('did-finish-load', async () => {
        const recovered = await checkForRecovery();
        if (recovered) return;

        const foundPath = findDefaultWorkspacePath();
        if (foundPath) {
            try {
                const data = JSON.parse(fs.readFileSync(foundPath, 'utf8'));
                mainWindow.webContents.send('load-project', data);
            } catch (error) {
                console.error('Не удалось загрузить дефолтное рабочее пространство:', error.message);
            }
        }
    });

    // Показываем окно после загрузки
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        // Раунд 184 - изначальный заголовок ("Без названия") -
        // дефолтное рабочее пространство (см. did-finish-load выше)
        // сознательно НЕ считается "именованным проектом" - у него свой
        // отдельный путь (default-workspace.ncp), не currentProjectPath.
        updateWindowTitle();
    });

    // Создаем меню
    const menu = Menu.buildFromTemplate(getMenuTemplate());
    Menu.setApplicationMenu(menu);

    // Раунд 185 (по запросу Mr.D: "Диалог закрытия программы - при
    // нажатии на крестик появляется окно с выбором действия") - 'close'
    // (не 'closed' - тот срабатывает УЖЕ ПОСЛЕ того, как окно закрыто,
    // отменить нечего) - event.preventDefault() останавливает закрытие,
    // пока пользователь не ответит на диалог. isQuitting - обходной
    // флаг: forceQuit() (см. ниже) сам вызывает mainWindow.close(),
    // что СНОВА порождает это же событие - без флага получилась бы
    // бесконечная петля "закрыть -> диалог -> Сохранить и выйти ->
    // close() -> закрыть -> диалог -> ...".
    mainWindow.on('close', (event) => {
        if (isQuitting) return; // уже решили действительно закрыться - пропускаем без вопросов
        if (!isProjectDirty) return; // нечего сохранять - закрываем как обычно, без диалога
        event.preventDefault();
        handleCloseRequest();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function getMenuTemplate() {
    return [
        {
            label: 'Файл',
            submenu: [
                {
                    label: 'Сохранить проект',
                    accelerator: 'CmdOrCtrl+S',
                    click: () => saveProject()
                },
                {
                    // Раунд 184 (по запросу Mr.D: "Сохранить как - всегда
                    // открывает диалог") - без своего accelerator -
                    // Ctrl+Shift+S уже занят "Экспорт как изображение"
                    // (ниже), менять устоявшуюся комбинацию рискованно.
                    label: 'Сохранить проект как...',
                    click: () => saveProjectAs()
                },
                {
                    label: 'Загрузить проект',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => loadProject()
                },
                {
                    label: 'Экспорт как изображение',
                    accelerator: 'CmdOrCtrl+Shift+S',
                    click: () => exportImage()
                },
                { type: 'separator' },
                {
                    label: 'Очистить всё',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.webContents.send('clear-all');
                        }
                    }
                },
                { type: 'separator' },
                {
                    // Раунд 185 - app.quit() САМ пытается закрыть окно
                    // (документированное поведение Electron - "Try to
                    // close all windows"), что штатно порождает событие
                    // 'close' у mainWindow - уже перехватывается в
                    // createWindow() выше (handleCloseRequest()) - этому
                    // пункту меню НЕ нужна собственная copy-paste логика
                    // проверки несохранённых изменений.
                    label: 'Выйти',
                    accelerator: 'CmdOrCtrl+Q',
                    click: () => app.quit()
                }
            ]
        },
        {
            label: 'Правка',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' }
            ]
        },
        {
            label: 'Вид',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Помощь',
            submenu: [
                {
                    label: 'О программе',
                    click: () => showAbout()
                }
            ]
        }
    ];
}

// --- Сохранение проекта ---

// Раунд 184 - общая точка ЗАПИСИ (без диалога) - переиспользуется и
// "Сохранить" (путь уже известен), и "Сохранить как" (путь только что
// выбран в диалоге) - единая логика записи+статус+recent-list+заголовок,
// не дублируется в двух местах.
function writeProjectToPath(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        currentProjectPath = filePath;
        isProjectDirty = false;
        touchRecentProject(filePath);
        writeLastSessionProjectPath(filePath);
        // Раунд 185 (по запросу Mr.D: "Схема бэкапов - если файл
        // сохранён, при автосохранении создаётся бэкап с расширением
        // .ncptemp") - явное сохранение только что записало САМЫЙ
        // свежий вариант в РЕАЛЬНЫЙ файл - любой оставшийся .ncptemp
        // рядом с ним теперь устарел и только сбивал бы с толку при
        // следующей проверке восстановления после сбоя.
        const backupPath = `${filePath}.ncptemp`;
        if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
        updateWindowTitle();
        mainWindow.webContents.send('project-saved', { filePath, name: path.basename(filePath, '.ncp') });
        mainWindow.webContents.send('status-update', '💾 Проект сохранён');
        return true;
    } catch (error) {
        dialog.showErrorBox('Ошибка', `Не удалось сохранить файл: ${error.message}`);
        return false;
    }
}

// Раунд 184 (по запросу Mr.D: "Сохранить - работает только если у
// проекта есть имя. Сохраняет поверх текущего файла") - если
// currentProjectPath уже известен - тихая перезапись, БЕЗ диалога.
// Если проект ещё безымянный (новый/только в AutoSave) - равносильно
// "Сохранить как" (диалог всё равно нужен - записывать физически
// некуда, пути ещё нет).
async function saveProject() {
    if (currentProjectPath) {
        ipcMain.removeAllListeners('project-data');
        ipcMain.once('project-data', (event, data) => {
            writeProjectToPath(currentProjectPath, data);
        });
        mainWindow.webContents.send('get-project-data');
        return;
    }
    await saveProjectAs();
}

// Раунд 184 (по запросу Mr.D: "Сохранить как - всегда открывает диалог
// выбора имени и папки") - вне зависимости от того, именован ли уже
// проект.
async function saveProjectAs() {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Сохранить проект как',
        defaultPath: currentProjectPath || 'project.ncp',
        filters: [
            { name: 'NodeCalculate Project', extensions: ['ncp'] }
        ]
    });

    if (!result.canceled && result.filePath) {
        // Чистим "зависшие" слушатели от отменённых ранее сохранений,
        // иначе при повторном сохранении данные запишутся несколько раз
        ipcMain.removeAllListeners('project-data');
        ipcMain.once('project-data', (event, data) => {
            writeProjectToPath(result.filePath, data);
        });
        mainWindow.webContents.send('get-project-data');
    }
}

// Раунд 185 (по запросу Mr.D: "Диалог закрытия программы... Всегда
// есть варианты: Сохранить и выйти, Сохранить как, Выйти без
// сохранения, Отмена") - isQuitting - см. докстринг у
// mainWindow.on('close', ...) в createWindow() - предотвращает
// бесконечную петлю, когда forceQuit() сам инициирует повторное
// закрытие окна.
let isQuitting = false;
function forceQuit() {
    isQuitting = true;
    mainWindow.close();
}

// Раунд 185 - общая точка запроса данных проекта + записи, С
// колбэком "что делать после" - используется ОБОИМИ путями диалога
// закрытия (у каждого своя целевая ситуация: путь уже известен -
// просто перезаписать; путь ещё не выбран - сперва спросить его).
function requestProjectDataAndWrite(filePath, onDone) {
    ipcMain.removeAllListeners('project-data');
    ipcMain.once('project-data', (event, data) => {
        const ok = writeProjectToPath(filePath, data);
        if (onDone) onDone(ok);
    });
    mainWindow.webContents.send('get-project-data');
}

// "Сохранить и выйти" - если проект уже именован, тихая перезапись (та
// же логика, что у обычного saveProject()) + выход СРАЗУ после
// успешной записи. Если НЕ именован - физически некуда писать без
// диалога, поэтому равносильно "Сохранить как".
function saveThenQuit() {
    if (!currentProjectPath) { saveAsThenQuit(); return; }
    requestProjectDataAndWrite(currentProjectPath, (ok) => {
        // ok===false - writeProjectToPath() уже показал dialog.showErrorBox
        // сам - НЕ выходим молча при неудачной записи, иначе пользователь
        // потерял бы несохранённые изменения, даже не поняв этого.
        if (ok) forceQuit();
    });
}

// "Сохранить как" (из диалога закрытия) - ВСЕГДА диалог выбора пути,
// затем выход после успешной записи. Отмена диалога "Сохранить как" -
// НЕ закрывает окно (пользователь мог передумать посреди выбора имени,
// не обязательно "не хочу сохранять вообще").
async function saveAsThenQuit() {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Сохранить проект как',
        defaultPath: currentProjectPath || 'project.ncp',
        filters: [{ name: 'NodeCalculate Project', extensions: ['ncp'] }]
    });
    if (result.canceled || !result.filePath) return;
    requestProjectDataAndWrite(result.filePath, (ok) => {
        if (ok) forceQuit();
    });
}

async function handleCloseRequest() {
    const result = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Сохранить и выйти', 'Сохранить как', 'Выйти без сохранения', 'Отмена'],
        defaultId: 0,
        cancelId: 3,
        title: 'Несохранённые изменения',
        message: 'В проекте есть несохранённые изменения. Что сделать перед выходом?'
    });
    switch (result.response) {
        case 0: saveThenQuit(); break;
        case 1: saveAsThenQuit(); break;
        case 2: forceQuit(); break;
        // case 3 (Отмена) и любой другой способ закрыть сам диалог
        // (Esc, крестик) - ничего не делаем, окно остаётся открытым.
    }
}

// Раунд 185 (по запросу Mr.D: "Автосохранение по времени - полная
// сериализация проекта в папку AutoSave/ с временной меткой", "Схема
// бэкапов - если файл сохранён, при автосохранении создаётся бэкап с
// расширением .ncptemp по стандартной схеме") - отдельный IPC-канал
// (НЕ 'project-data'/'get-project-data' - те заняты явным
// сохранением, см. saveProject()/saveProjectAs() выше - случайное
// пересечение removeAllListeners() между автосохранением и явным
// "Сохранить", происходящими примерно одновременно, испортило бы
// ОБА). НЕ трогает isProjectDirty/currentProjectPath/recent-projects/
// заголовок окна - это НЕ "настоящее" сохранение с точки зрения
// пользователя, а фоновая страховка на случай сбоя.
function performAutosave() {
    if (!mainWindow || !isProjectDirty) return; // нечего страховать - изменений с прошлого сохранения нет
    ipcMain.removeAllListeners('project-data-autosave');
    ipcMain.once('project-data-autosave', (event, data) => {
        try {
            const json = JSON.stringify(data, null, 2);
            if (currentProjectPath) {
                // Именованный проект - бэкап РЯДОМ с реальным файлом
                // (не в общей AutoSave/) - .ncptemp того же имени,
                // прямая привязка к конкретному проекту, не нужно
                // искать "какой из снимков чей".
                fs.writeFileSync(`${currentProjectPath}.ncptemp`, json);
            } else {
                // Безымянный проект - общая папка AutoSave/, снимок со
                // штампом времени в имени (см. checkForRecovery() -
                // самый свежий и предлагается для восстановления).
                const dir = ensureAutoSaveDir();
                fs.writeFileSync(path.join(dir, `autosave-${Date.now()}.ncp`), json);
                pruneOldAutosaveSnapshots(dir);
            }
        } catch (error) {
            console.error('Автосохранение не удалось:', error.message);
        }
    });
    mainWindow.webContents.send('get-project-data-autosave');
}

// --- Загрузка проекта ---
async function loadProject() {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Загрузить проект',
        filters: [
            { name: 'NodeCalculate Project', extensions: ['ncp'] }
        ],
        properties: ['openFile']
    });

    if (!result.canceled && result.filePaths.length > 0) {
        openProjectFromPath(result.filePaths[0]);
    }
}

// Раунд 184 (по запросу Mr.D: "Менеджер текущих проектов - панель
// недавно сохранённых проектов с быстрым открытием") - общая точка
// ОТКРЫТИЯ конкретного пути - переиспользуется и обычной загрузкой
// (диалог выбора файла, выше), и открытием из панели недавних проектов
// (там путь уже известен, диалог не нужен).
function openProjectFromPath(filePath) {
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        currentProjectPath = filePath;
        isProjectDirty = false;
        touchRecentProject(filePath);
        writeLastSessionProjectPath(filePath);
        updateWindowTitle();
        mainWindow.webContents.send('load-project', data);
        mainWindow.webContents.send('status-update', '📂 Проект загружен');
    } catch (error) {
        dialog.showErrorBox('Ошибка', `Не удалось загрузить файл: ${error.message}`);
    }
}

// --- Экспорт изображения ---
async function exportImage() {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Экспорт как изображение',
        defaultPath: 'project.png',
        filters: [
            { name: 'PNG', extensions: ['png'] },
            { name: 'JPEG', extensions: ['jpg', 'jpeg'] }
        ]
    });

    if (!result.canceled && result.filePath) {
        mainWindow.webContents.send('export-image', result.filePath);
    }
}

// --- О программе ---
function showAbout() {
    dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'О программе',
        message: 'Нодовый калькулятор v1.0.0',
        detail: 'Визуальный калькулятор с нодовой системой\n\n' +
                'Особенности:\n' +
                '• Визуальное программирование\n' +
                '• Поддержка множества входов\n' +
                '• Переименование узлов\n' +
                '• Сохранение и загрузка проектов\n' +
                '• Экспорт в изображение\n\n' +
                'Сделано с ❤️',
        buttons: ['OK']
    });
}

// --- Обработчики IPC ---

// Запросы от кнопок в рендерере (тулбар): без этих обработчиков
// кнопки "Сохранить"/"Загрузить" не работали - диалоги открывались
// только из меню приложения
ipcMain.on('request-save-project', () => saveProject());
ipcMain.on('request-save-project-as', () => saveProjectAs());
ipcMain.on('request-load-project', () => loadProject());
ipcMain.on('request-export-image', () => exportImage());

// Раунд 184 (по запросу Mr.D: "Менеджер текущих проектов - панель/
// список недавно сохранённых проектов с быстрым открытием") - список
// отдаётся ПОСЛЕ pruneMissingRecentProjects() (см. выше) - панель в
// рендерере никогда не увидит путь к файлу, которого уже физически нет
// на диске. Открытие - тот же openProjectFromPath(), что и у обычного
// диалога "Загрузить проект", просто путь уже известен заранее.
ipcMain.handle('get-recent-projects', () => pruneMissingRecentProjects());
ipcMain.on('open-recent-project', (event, filePath) => openProjectFromPath(filePath));

// Раунд 184 - рендерер сам решает, КОГДА считать проект "изменённым"
// (см. src/js/main.js, markProjectDirty()) - main только хранит флаг
// (для заголовка окна/будущего диалога закрытия) и держит его в
// синхронизации с currentProjectPath (свежезагруженный/только что
// сохранённый проект - всегда "чистый", это уже сбрасывается в
// openProjectFromPath()/writeProjectToPath() выше - здесь только
// ВХОДЯЩИЕ сигналы "стало грязно" от рендерера).
ipcMain.on('mark-dirty', () => {
    if (isProjectDirty) return; // уже грязный - незачем трогать заголовок повторно
    isProjectDirty = true;
    updateWindowTitle();
});

// Раунд 184 (по запросу Mr.D: "Новый проект") - БЕЗ этого сброса
// последующее "Сохранить" перезаписало бы файл ПРЕДЫДУЩЕГО проекта
// новым (пустым/другим) содержимым - currentProjectPath иначе остался
// бы указывать на СТАРЫЙ файл, хотя пользователь уже начал работать
// "с чистого листа".
ipcMain.on('reset-current-project', () => {
    currentProjectPath = null;
    isProjectDirty = false;
    // Раунд 185 - иначе восстановление после сбоя (см. checkForRecovery())
    // при СЛЕДУЮЩЕМ запуске ошибочно предложило бы .ncptemp СТАРОГО
    // именованного проекта, хотя пользователь уже сознательно ушёл от
    // него в текущей сессии.
    writeLastSessionProjectPath(null);
    updateWindowTitle();
});

ipcMain.handle('save-image', (event, data, filePath) => {
    try {
        const base64Data = data.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(filePath, base64Data, 'base64');
        mainWindow.webContents.send('status-update', '🖼️ Изображение сохранено');
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// --- Экспорт файла (1.7.0) - обобщённый канал: диалог "Сохранить как"
// + запись на диск. Используется Export-нодами (Excel/JSON, см.
// exportXlsxNode.js/exportJsonNode.js) - payload формируется целиком в
// рендерере (уже готовое содержимое файла), main только спрашивает путь
// и пишет байты. encoding='base64' для бинарных форматов (.xlsx),
// 'utf8' для текстовых (.json) - тот же приём, что уже применён у
// save-image выше, просто обобщённый под произвольные фильтры/имена.
ipcMain.handle('export-file', async (event, payload) => {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Экспорт',
        defaultPath: payload?.suggestedName || 'export',
        filters: payload?.filters || [{ name: 'Все файлы', extensions: ['*'] }]
    });

    if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
    }

    try {
        const encoding = payload?.encoding === 'base64' ? 'base64' : 'utf8';
        fs.writeFileSync(result.filePath, payload.content, encoding);
        mainWindow.webContents.send('status-update', '💾 Файл сохранён');
        return { success: true, filePath: result.filePath };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// --- Экспорт активной Доски в PDF (1.7.0) - через встроенный Electron
// webContents.printToPDF(), а НЕ через ручную склейку canvas (тот
// подход уже используется у "Экспорт изображения" выше и, как
// выяснилось, там не рисует реальное содержимое нод - см. обсуждение с
// Mr.D). printToPDF эмулирует @media print так же, как обычная печать -
// CSS-правило в конце styles.css/day_styles.css прячет весь "хром"
// интерфейса (сайдбар/топбар/вкладки), оставляя только #boardCanvasWrap.
// Кнопка в рендерере видна только когда Доска реально на экране (см.
// boardManager.renderTabs()), так что здесь дополнительно проверять
// "а что сейчас показано" не нужно - печатается то, что видно.
ipcMain.on('request-export-board-pdf', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Экспорт Доски в PDF',
        defaultPath: 'board.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });

    if (result.canceled || !result.filePath) return;

    try {
        const pdfBuffer = await mainWindow.webContents.printToPDF({
            pageSize: 'A4',
            printBackground: true,
            preferCSSPageSize: false
        });
        fs.writeFileSync(result.filePath, pdfBuffer);
        mainWindow.webContents.send('status-update', '📄 Доска экспортирована в PDF');
    } catch (error) {
        dialog.showErrorBox('Ошибка экспорта PDF', error.message);
    }
});

// Раунд 123 (релиз 1.8.0, "стартап-конфиги") - дефолтное рабочее
// пространство: тихое сохранение (без диалога "Сохранить как" - всегда
// один и тот же путь, DEFAULT_WORKSPACE_PATH), проверка наличия и
// удаление (сброс к отладочному примеру/пустому листу).
// Раунд 123 (релиз 1.8.0, "стартап-конфиги") - дефолтное рабочее
// пространство: тихое сохранение (без диалога "Сохранить как"),
// проверка наличия и удаление (сброс к отладочному примеру/пустому
// листу). Раунд 127 (багфикс ENOENT - __dirname в упакованном
// приложении указывает внутрь app.asar, только для чтения) - приоритет
// AppData -> рядом с exe (см. getAppDataWorkspacePath()/
// getExeDirWorkspacePath()/findDefaultWorkspacePath() выше).
ipcMain.handle('save-default-workspace', (event, data) => {
    const json = JSON.stringify(data, null, 2);
    try {
        fs.writeFileSync(getAppDataWorkspacePath(), json);
        mainWindow.webContents.send('status-update', '⭐ Сохранено как стартовое рабочее пространство');
        return { success: true };
    } catch (errAppData) {
        // AppData не получилось (права доступа и т.п.) - пробуем рядом
        // с exe программы, как и просил Mr.D.
        try {
            fs.writeFileSync(getExeDirWorkspacePath(), json);
            mainWindow.webContents.send('status-update', '⭐ Сохранено как стартовое рабочее пространство (рядом с программой)');
            return { success: true };
        } catch (errExeDir) {
            return { success: false, error: `AppData: ${errAppData.message}; рядом с программой: ${errExeDir.message}` };
        }
    }
});

ipcMain.handle('has-default-workspace', () => {
    return findDefaultWorkspacePath() !== null;
});

ipcMain.handle('clear-default-workspace', () => {
    try {
        // Раунд 127 - файл мог осесть в ЛЮБОМ из двух мест (в зависимости
        // от того, какая попытка сохранения в тот раз сработала) -
        // удаляем ОБА, если существуют, не только "найденный первым".
        [getAppDataWorkspacePath(), getExeDirWorkspacePath()].forEach(p => {
            if (fs.existsSync(p)) fs.unlinkSync(p);
        });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// --- Запуск приложения ---
app.whenReady().then(() => {
    createWindow();
    // Раунд 185 - таймер автосохранения запускается ОДИН раз на весь
    // процесс (не пересоздаётся при повторных createWindow() -
    // macOS-паттерн "activate" ниже - performAutosave() сама проверяет
    // mainWindow на существование, безопасно, если окна вдруг нет).
    setInterval(performAutosave, AUTOSAVE_INTERVAL_MS);
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});