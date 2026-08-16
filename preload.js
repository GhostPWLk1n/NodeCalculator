/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    preload.js
 * @brief   Electron preload-скрипт: безопасный мост IPC между main-процессом и рендерером (contextBridge)
 * @author  Pavel Fomin
 * @version 1.8.72
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    // === Кнопки тулбара → main-процесс (открыть диалог) ===
    saveProject: () => ipcRenderer.send('request-save-project'),
    // Раунд 184 (по запросу Mr.D: "Сохранить как - всегда открывает
    // диалог выбора имени и папки")
    saveProjectAs: () => ipcRenderer.send('request-save-project-as'),
    loadProject: () => ipcRenderer.send('request-load-project'),
    exportImage: () => ipcRenderer.send('request-export-image'),

    // === Данные проекта ===
    // main просит данные для сохранения
    onGetProjectData: (cb) => ipcRenderer.on('get-project-data', cb),
    // рендерер отвечает сериализованным проектом
    sendProjectData: (data) => ipcRenderer.send('project-data', data),
    // Раунд 185 (по запросу Mr.D: "Автосохранение по времени") -
    // ОТДЕЛЬНАЯ пара каналов от явного сохранения (get-project-data/
    // project-data выше) - фоновое автосохранение и явное "Сохранить"
    // не должны мешать друг другу, если случатся примерно одновременно.
    onGetProjectDataAutosave: (cb) => ipcRenderer.on('get-project-data-autosave', cb),
    sendProjectDataAutosave: (data) => ipcRenderer.send('project-data-autosave', data),
    // main прислал загруженный из файла проект
    onLoadProject: (cb) => ipcRenderer.on('load-project', cb),
    // Раунд 184 - main подтверждает УСПЕШНОЕ сохранение (путь+имя) -
    // рендерер сбрасывает СВОЙ dirty-индикатор (см. src/js/main.js)
    onProjectSaved: (cb) => ipcRenderer.on('project-saved', cb),

    // === Раунд 184 (по запросу Mr.D: "Менеджер текущих проектов -
    // панель/список недавно сохранённых проектов с быстрым открытием",
    // "Контроль изменений - отслеживание dirty-флага") ===
    getRecentProjects: () => ipcRenderer.invoke('get-recent-projects'),
    openRecentProject: (filePath) => ipcRenderer.send('open-recent-project', filePath),
    markDirty: () => ipcRenderer.send('mark-dirty'),
    // Раунд 184 (по запросу Mr.D: "Новый проект") - без этого сброса
    // "Сохранить" после "Нового проекта" перезаписал бы файл ПРЕЖНЕГО
    // проекта.
    resetCurrentProject: () => ipcRenderer.send('reset-current-project'),

    // === Прочее ===
    statusUpdate: (cb) => ipcRenderer.on('status-update', cb),
    clearAll: (cb) => ipcRenderer.on('clear-all', cb),
    onExportImage: (cb) => ipcRenderer.on('export-image', cb),
    saveImage: (data, filePath) => ipcRenderer.invoke('save-image', data, filePath),

    // === Экспорт файла (1.7.0) - обобщённый канал: диалог "Сохранить
    // как" + запись на диск, используется Export-нодами (Excel/JSON) и
    // расширяемо под будущие форматы. payload:
    //   { content, encoding: 'utf8'|'base64', suggestedName, filters }
    // Возвращает { success, filePath } | { success:false, canceled:true }
    // | { success:false, error }
    exportFile: (payload) => ipcRenderer.invoke('export-file', payload),

    // === Экспорт активной Доски в PDF (1.7.0) ===
    exportBoardPdf: () => ipcRenderer.send('request-export-board-pdf'),

    // === Раунд 123 (релиз 1.8.0, "стартап-конфиги") - дефолтное
    // рабочее пространство, открывающееся автоматически при запуске
    // приложения, вместо отладочных трёх нод-примера. ХРАНИТСЯ ПОКА В
    // ПАПКЕ ПРОГРАММЫ (main.js, __dirname) - явное решение Mr.D:
    // "файл с настройками должен храниться в пользовательской
    // директории, чтобы переустановка не сбила настройки - оставим на
    // будущее, пока реализуем в папке с программой". saveDefaultWorkspace
    // не открывает диалог "Сохранить как" (в отличие от saveProject) -
    // всегда один и тот же путь, тихая перезапись.
    saveDefaultWorkspace: (data) => ipcRenderer.invoke('save-default-workspace', data),
    // main сам присылает сохранённое пространство при старте, если оно
    // есть (см. main.js, createWindow()) - события те же, что и у
    // обычной загрузки проекта (onLoadProject), рендерер не должен
    // знать разницу.
    hasDefaultWorkspace: () => ipcRenderer.invoke('has-default-workspace'),
    clearDefaultWorkspace: () => ipcRenderer.invoke('clear-default-workspace')
});
