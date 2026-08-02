/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    main.js
 * @brief   Electron main-процесс: создание окна, меню, IPC-обработчики сохранения/загрузки .ncp и экспорта изображения
 * @author  Pavel Fomin
 * @version 1.7.50
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

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