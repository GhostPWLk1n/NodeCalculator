/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    preload.js
 * @brief   Electron preload-скрипт: безопасный мост IPC между main-процессом и рендерером (contextBridge)
 * @author  Pavel Fomin
 * @version 1.4.0
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    // === Кнопки тулбара → main-процесс (открыть диалог) ===
    saveProject: () => ipcRenderer.send('request-save-project'),
    loadProject: () => ipcRenderer.send('request-load-project'),
    exportImage: () => ipcRenderer.send('request-export-image'),

    // === Данные проекта ===
    // main просит данные для сохранения
    onGetProjectData: (cb) => ipcRenderer.on('get-project-data', cb),
    // рендерер отвечает сериализованным проектом
    sendProjectData: (data) => ipcRenderer.send('project-data', data),
    // main прислал загруженный из файла проект
    onLoadProject: (cb) => ipcRenderer.on('load-project', cb),

    // === Прочее ===
    statusUpdate: (cb) => ipcRenderer.on('status-update', cb),
    clearAll: (cb) => ipcRenderer.on('clear-all', cb),
    onExportImage: (cb) => ipcRenderer.on('export-image', cb),
    saveImage: (data, filePath) => ipcRenderer.invoke('save-image', data, filePath)
});
