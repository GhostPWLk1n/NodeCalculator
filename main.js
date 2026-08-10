/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    main.js
 * @brief   Electron main-процесс: создание окна, меню, IPC-обработчики сохранения/загрузки .ncp и экспорта изображения
 * @author  Pavel Fomin
 * @version 1.8.46
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

    // Раунд 123 - если сохранено дефолтное рабочее пространство,
    // загружаем его АВТОМАТИЧЕСКИ при старте - тем же событием
    // 'load-project', что и обычная ручная загрузка (рендерер не
    // должен знать разницу, см. preload.js). did-finish-load (не
    // ready-to-show) - нужно, чтобы к этому моменту скрипты рендерера
    // (main.js, регистрирующий onLoadProject) уже успели выполниться.
    mainWindow.webContents.once('did-finish-load', () => {
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
    });

    // Создаем меню
    const menu = Menu.buildFromTemplate(getMenuTemplate());
    Menu.setApplicationMenu(menu);

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
async function saveProject() {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Сохранить проект',
        defaultPath: 'project.ncp',
        filters: [
            { name: 'NodeCalculate Project', extensions: ['ncp'] }
        ]
    });

    if (!result.canceled && result.filePath) {
        // Чистим "зависшие" слушатели от отменённых ранее сохранений,
        // иначе при повторном сохранении данные запишутся несколько раз
        ipcMain.removeAllListeners('project-data');
        ipcMain.once('project-data', (event, data) => {
            try {
                fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2));
                mainWindow.webContents.send('status-update', '💾 Проект сохранен');
            } catch (error) {
                dialog.showErrorBox('Ошибка', `Не удалось сохранить файл: ${error.message}`);
            }
        });
        mainWindow.webContents.send('get-project-data');
    }
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
        try {
            const data = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
            mainWindow.webContents.send('load-project', data);
            mainWindow.webContents.send('status-update', '📂 Проект загружен');
        } catch (error) {
            dialog.showErrorBox('Ошибка', `Не удалось загрузить файл: ${error.message}`);
        }
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
ipcMain.on('request-load-project', () => loadProject());
ipcMain.on('request-export-image', () => exportImage());

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
app.whenReady().then(createWindow);

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