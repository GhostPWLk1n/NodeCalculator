# API создания нод — NodeCalculate

Справочник для разработчиков, которые добавляют новые типы нод в движок.
Следуйте этим правилам, и новая нода будет автоматически: перетаскиваться,
сворачиваться, растягиваться по ширине, участвовать в соединениях, сохраняться
в `.ncp`-проект и переживать переключение листов — без правок в ядре.

---

## 1. Общая архитектура

```
src/js/
├── main.js                 точка входа: регистрирует типы нод, глобальные window.*-функции
├── core/
│   ├── nodeManager.js       создание/рендер/удаление/drag/resize нод
│   ├── connectionManager.js создание/разрыв соединений между сокетами
│   ├── renderer.js          отрисовка SVG-линий, подсветка сокетов
│   └── layoutManager.js     листы (вкладки), сохранение/загрузка проекта
├── nodes/
│   ├── baseNode.js           БАЗОВЫЙ КЛАСС — от него наследуются все ноды
│   ├── numberNode.js          пример компактной ноды с одним выходом
│   ├── operationNode.js       пример ноды с динамическим числом входов
│   ├── percentageNode.js      пример ноды с визуализацией (SVG-диаграмма)
│   ├── scaleListNode.js       пример ноды LIST → LIST
│   ├── listViewerNode.js      пример ноды только для просмотра (без выхода)
│   ├── listInputNode.js       пример ноды с ручным вводом коллекции
│   ├── layoutInputNode.js     пример ноды-моста между листами (вход)
│   └── layoutOutputNode.js    пример ноды-моста между листами (выход)
└── utils/
    ├── constants.js       имена типов, цвета, дефолтные конфиги
    ├── dataTypes.js       ListData — единый формат "списка" данных
    ├── helpers.js         форматирование чисел, generateId и т.п.
    └── socketFactory.js   ЕДИНАЯ точка создания DOM-элемента сокета
```

Каждая нода — это класс, экземпляр которого хранит состояние (значения,
конфигурацию), и который умеет: (1) отрисовать свой DOM, (2) вычислить своё
значение по входящим соединениям, (3) обновить уже отрисованный DOM без
пересоздания. Остальное (drag, resize, соединения, сворачивание, сохранение)
берёт на себя ядро — эти вещи переопределять не нужно.

---

## 2. Минимальный шаблон новой ноды

```js
// src/js/nodes/myNode.js
import { BaseNode } from './baseNode.js';
import { Helpers } from '../utils/helpers.js';
import { ListData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';

export class MyNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config); // ОБЯЗАТЕЛЬНО первой строкой

        // Сколько сокетов у ноды (нужно ядру для прокси-сокетов заголовка
        // при сворачивании — см. раздел 4)
        this.inputs = 1;
        this.outputs = 1;
        this.inputSockets = [0]; // индексы входных сокетов, см. раздел 5

        // Своё состояние
        this.someOption = config.someOption ?? 'default';
        this.listData = new ListData();       // если нода умеет отдавать LIST
        this.resultListData = new ListData();  // если нода умеет отдавать число с именем
    }

    // --- ОБЯЗАТЕЛЬНО: тело ноды (без заголовка — заголовок строит BaseNode) ---
    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';

        // ... строим DOM, добавляем сокеты через SocketFactory (раздел 5) ...

        return content;
    }

    // --- ОБЯЗАТЕЛЬНО: пересчёт значения по входящим соединениям ---
    calculate(nodeManager) {
        // см. раздел 7
        return this.value;
    }

    // --- ОБЯЗАТЕЛЬНО, если в DOM есть что обновлять без пересоздания ---
    updateDisplay(element) {
        // element — корневой .node этой ноды (см. раздел 8)
    }
}
```

Регистрация в `src/js/main.js`:

```js
import { MyNode } from './nodes/myNode.js';
// ...
nodeManager.registerNodeType('myNode', MyNode);
```

И пункт в сайдбаре, `src/index.html`:

```html
<div class="node-item" data-type="myNode" onclick="window.addNode('myNode', 400, 300)">
    <span class="node-icon">🔧</span>
    <span class="node-name">Моя нода</span>
</div>
```

Больше нигде регистрировать новый тип не нужно — `nodeManager`, `layoutManager`
(сохранение) и `renderer` работают с любым зарегистрированным типом одинаково.

**Категория сайдбара "🔬 Аналитика данных"** (Раунд 89) — сюда помещаются
специфические узлы для анализа, обработки и распознавания ГОТОВЫХ данных:
статистический анализ, машинное обучение, обработка текста, распознавание
паттернов, предсказательная аналитика и другие виды интеллектуальной
обработки. Отличие от обычных "Преобразование"/"Таблицы" — эти узлы
пытаются ПОНЯТЬ/РАСПОЗНАТЬ структуру или смысл во входных данных
(например, `GanttTableProcessorNode` угадывает, где в сырой таблице
шапка, разделы и границы строк-задач), а не просто механически
преобразуют уже известную структуру.

---

## 3. Контракт BaseNode

`BaseNode` (`src/js/nodes/baseNode.js`) даёт готовыми:

| Метод/поле | Что делает | Переопределять? |
|---|---|---|
| `constructor(id, type, x, y, config)` | сохраняет `id`, `type`, `x`, `y`, `value`, `customName`, `collapsed`, `maxInputs` | вызывать через `super(...)`, не переопределять |
| `getDisplayName()` | `customName` или дефолтное имя из `Constants.TYPE_NAMES` | обычно нет |
| `render()` | собирает `.node-container` = заголовок + `createContent()` | нет |
| `createTitle()` | заголовок: иконка сворачивания, имя (двойной клик — переименование), прокси-сокеты | нет |
| `createContent()` | тело ноды | да, обязательно |
| `toggleCollapse()` | сворачивает ноду до заголовка | переопределяйте, только если у ноды нестандартный CSS-класс на `.node` (см. `numberNode.js`) |
| `calculate(nodeManager)` | пересчёт значения | да, обязательно |
| `updateDisplay(element)` | обновление DOM без пересоздания | переопределяйте, если в `createContent()` есть что показывать динамически |
| `updateValueFromInput()` | читает `.number-input` из DOM в `this.value` | переопределяйте только для нод с полем ввода числа |

Что нода НЕ должна делать сама: drag (`nodeManager.startDragNode`),
resize (`nodeManager.startResize`), позиционирование линий (`renderer.js`),
контекстное меню, глобальный подсчёт нод/соединений. Это всё уже работает
для любой ноды, унаследованной от `BaseNode`, при условии что вы не ломаете
структуру DOM ниже.

---

## 4. Обязательная DOM-структура

`nodeManager.renderNode(node)` создаёт:

```html
<div class="node" data-node-id="{id}">
  <!-- содержимое node.render(): -->
  <div class="node-container">
    <div class="node-title"> ... заголовок из BaseNode ... </div>
    <!-- ваш createContent(): -->
    <div class="node-content"> ... </div>
  </div>
  <!-- добавляется ядром автоматически: -->
  <div class="node-resize-handle"></div>
</div>
```

Требования:

- Корневой элемент `createContent()` должен иметь класс `node-content`.
- **Не ставьте `overflow: hidden`** ни на `.node`, ни на корневой элемент
  `createContent()` — сокеты выступают за границу ноды через отрицательные
  margin (`--socket-protrude`, см. раздел 5) и будут обрезаны.
- **Не задавайте фиксированную высоту** — высоту нода всегда определяет по
  контенту сама. Ширину можно/нужно позволить менять пользователю через
  `node-resize-handle` (добавляется автоматически всем нодам) — но если ваш
  layout использует `flex-wrap`/проценты, он должен адаптироваться к
  изменению `width`, а не ломаться (см. `percentageNode.js`: легенда).
- Если нода при сворачивании должна выглядеть иначе, чем просто "показать
  только заголовок" (как `NumberNode`, который остаётся компактным),
  добавляйте свой CSS-класс на `.node` и переопределяйте `toggleCollapse()`
  по образцу `numberNode.js`.

---

## 5. Сокеты — единственный правильный способ

Всегда создавайте сокеты через `SocketFactory.createSocket()`, а не руками.
Это гарантирует одинаковую форму, цвет и обработчик старта соединения у всех нод.

```js
import { SocketFactory } from '../utils/socketFactory.js';

const socket = SocketFactory.createSocket({
    nodeId: this.id,
    socketType: 'input',   // 'input' | 'output'
    index: 0,               // порядковый номер сокета среди сокетов ЭТОГО типа у ЭТОЙ ноды
    isList: false,          // true → квадратный синий LIST-сокет
    outputType: null,       // 'count' → зелёный кружок; иначе игнорируется
    title: 'Входное число'  // подсказка при наведении
});

someRow.appendChild(socket);
```

### Правила индексов

- `index` уникален в пределах `(nodeId, socketType)` — у одной ноды может
  быть `input`-сокет `index=0` и `output`-сокет `index=0` одновременно, это
  разные сокеты.
- Индексы входов должны совпадать с позициями в `this.inputSockets` — по
  этому массиву определяется, какие входы существуют.

### Форма и цвет сокета (задаются классами, не инлайн-стилями)

| Тип данных | `isList` | `outputType` | Форма | Цвет |
|---|---|---|---|---|
| Число (float) | `false` | `null`/`'result'` | круг | серый |
| Количество (int) | `false` | `'count'` | круг | зелёный (`--md-secondary`) |
| Список (LIST) | `true` | — | квадрат | голубой (`#4fc3f7`) |

Совместимость типов проверяет `connectionManager.finishConnection()`:
LIST-сокет можно соединить только с LIST-сокетом, обычный — только с обычным.

### Расположение сокета в разметке

Сокеты "торчат наружу" за счёт `margin-left/right: calc(-1 * var(--socket-protrude))`
у `.input-socket`/`.output-socket` — это чистый CSS, ничего вручную
позиционировать не нужно. Просто кладите сокет первым/последним элементом в
свою flex-строку:

```js
const row = document.createElement('div');
row.style.cssText = 'display:flex; align-items:center; gap:8px;';
row.appendChild(inputSocket);   // сокет слева
row.appendChild(label);
content.appendChild(row);
```

Обработчик клика по сокету регистрировать вручную не нужно —
`SocketFactory.createSocket()` уже вешает `mousedown` →
`connectionManager.startConnection()`.

### Прокси-сокеты заголовка (для свёрнутой ноды)

`BaseNode.createTitle()` сам добавляет `.title-input-socket` /
`.title-output-socket`, если `this.inputs > 0` / `this.outputs > 0`
соответственно. Просто выставьте `this.inputs`/`this.outputs` в конструкторе
— остальное уже работает.

---

## 6. Формат данных: ListData

Единый формат, которым ноды обмениваются между собой — `src/js/utils/dataTypes.js`:

```js
new ListData(
    [{ name: 'Зарплата', value: 1000 }, { name: 'Бонус', value: 250 }],
    { title: 'Доходы' /* любые доп. метаданные */ }
)
```

Готовые геттеры: `.total`, `.names`, `.values`, `.percentages`. Используйте
`ListData`, если ваша нода выдаёт список (LIST-выход) или умеет показать
список из входа. Для простого числового выхода `ListData` не обязателен,
но принято хранить и `resultListData` — "число с именем" для нод, которым
важна подпись.

### Три "слоя" выходных данных, которые использует движок

- `this.value` — сырое число (или `null`/строка ошибки). Читается напрямую,
  когда нужен просто числовой результат.
- `this.resultListData` — `ListData` с одним элементом
  `{ name: <имя ноды>, value: <число> }`. Читается, когда следующей ноде
  важна подпись (легенда диаграммы, таблица).
- `this.listData` — `ListData` с полным списком элементов, если нода их
  производит/хранит.

Ноды-потребители (см. `PercentageNode.calculate()`) сами решают, какой из
трёх слоёв им нужен. Если ваша нода производит данные — заполняйте минимум
`this.value` и, по возможности, `this.resultListData`, чтобы её можно было
подключить куда угодно без специальной поддержки на другой стороне.

---

## 7. Метод calculate(nodeManager)

Вызывается для каждой ноды на каждом `nodeManager.calculateAll()`. Задача —
прочитать входящие соединения, посчитать значение, сохранить его в поля
экземпляра и вернуть. DOM не трогаем — за обновление DOM отвечает `updateDisplay()`.

```js
calculate(nodeManager) {
    const connections = window.connectionManager?.getConnections() || [];
    const myInputs = connections
        .filter(c => c.targetNodeId === this.id)
        .sort((a, b) => (a.targetSocket || 0) - (b.targetSocket || 0));

    const values = myInputs.map(c => {
        const src = nodeManager.getNode(c.sourceNodeId);
        return src ? (typeof src.value === 'number' ? src.value : 0) : 0;
    });

    this.value = values.reduce((a, b) => a + b, 0);

    this.resultListData = new ListData(
        [{ name: this.customName || this.getDisplayName(), value: this.value }],
        { title: this.getDisplayName() }
    );

    return this.value;
}
```

Правила:

- Не читайте и не пишите DOM внутри `calculate()`. При N нодах
  `calculateAll()` может прогнать `calculate()` до N раз подряд для
  распространения значений по графу.
- Если входа нет/источник не найден — не бросайте исключение, подставляйте
  безопасное значение (`0`, `null`, пустой `ListData`).
- Данные какого именно "слоя" брать у источника — решает читающая нода, а
  не источник (смотрите приоритет в `PercentageNode.calculate()`).

---

## 8. Метод updateDisplay(element)

Вызывается для всех нод на экране при `renderer.updateAllDisplays()`.
`element` — корневой `.node`-div именно этой ноды. Задача — обновить
текстовые поля/диаграммы без пересоздания DOM:

```js
updateDisplay(element) {
    const display = element.querySelector('.node-value-display');
    if (display) display.textContent = Helpers.formatNumber(this.value);
}
```

Если поле ввода может быть в фокусе у пользователя в момент пересчёта — не
перезаписывайте его значение, пока в нём фокус:

```js
const input = element.querySelector('.number-input-compact');
if (input && document.activeElement !== input) {
    input.value = this.value;
}
```

---

## 9. Динамическое количество сокетов (как у OperationNode)

Если у ноды может меняться число входов в рантайме, используйте паттерн из
`operationNode.js`:

1. Храните индексы в `this.inputSockets` (массив), `this.inputs` = его длина.
2. При добавлении/удалении слота вызывайте `this.rerender()` — метод,
   который удаляет старый `.node`-элемент и просит `nodeManager.renderNode(this)`
   отрисовать заново на тех же `x`/`y`/`width`. Защищайте от рекурсии флагом
   `this._isRerendering`.
3. Автодобавление свободного слота при подключении: реализуйте метод
   `checkAndAddEmptySlot()` — `connectionManager.addConnection()` сам
   вызывает этот метод у целевой ноды после создания соединения, если он у
   неё есть. Если вашей ноде это не нужно — просто не объявляйте такой метод.
4. Проверка занятости сокета: `isSocketConnected(index)` — фильтруйте
   `window.connectionManager.getConnections()` по `targetNodeId === this.id
   && targetSocket === index`.

---

## 10. Стилизация — используйте design tokens, не хардкодьте цвета

```css
--md-surface: #121212;          --md-primary: #90caf9;
--md-surface-variant: #1e1e1e;  --md-secondary: #a5d6a7;
--md-surface-2: #2d2d2d;        --md-accent: #ffd54f;
--md-surface-3: #3d3d3d;        --md-error: #ef5350;
--md-text: #e0e0e0;             --md-warning: #ffb74d;
--md-text-secondary: #9e9e9e;   --md-info: #4fc3f7;
--md-text-disabled: #616161;    --md-divider: #2d2d2d;
--md-radius: 8px;   --md-radius-lg: 12px;
--md-elevation: 0 2px 4px rgba(0,0,0,0.5);
```

Для новой ноды: если стиль уникален для неё — инлайн через `var(--md-...)`
в `style.cssText`; если это переиспользуемый элемент (кнопка, поле ввода) —
заведите класс в `styles.css` по аналогии с `.number-btn-compact`/`.number-input-compact`.

Не задавайте цвета сокетов вручную — только через `SocketFactory`. Состояние
"подключен" отражайте через `socket.classList.add('socket-connected')`,
а не инлайн-цветом.

---

## 11. Сохранение в .ncp — что нужно для совместимости

Для каждой ноды сохраняются только явно перечисленные поля
(`layoutManager.serialize()`):

```js
{
    id, type, x, y, value, customName, width, collapsed, inputs,
    chartType, customTitle, scaleValue,      // поля конкретных нод
    sourceLayoutId, sourceNodeId,             // layoutInput
    items                                     // listInput
}
```

Если ваша нода хранит собственное состояние, которое должно переживать
сохранение/загрузку — добавьте его в этот список в `layoutManager.serialize()`
и убедитесь, что конструктор ноды читает это поле из `config`:

```js
// в конструкторе новой ноды
this.myOption = config.myOption ?? 'default';
```

При загрузке `layoutManager.loadFromData()` создаёт ноду так:
`new NodeClass(sn.id, sn.type, sn.x, sn.y, sn)` — весь сохранённый объект
передаётся как `config`, поэтому конструктору достаточно читать нужные поля
из `config`; отдельно регистрировать поле для чтения не нужно — только для
записи (список полей в `serialize()`).

---

## 12. Взаимодействие с другими листами

Если новая нода должна быть видна другим листам как источник данных —
используйте `layoutOutputNode.js` как есть. Если нужен новый вид "моста" —
см. API `layoutManager`:

- `layoutManager.getOutputsForLayout(layoutId)` → список `{id, name, value}`
  всех `layoutOutput`-нод на листе — используйте для построения `<select>`.
- `layoutManager.getOutputNode(layoutId, nodeId)` → инстанс ноды-источника
  вне зависимости от того, активен ли тот лист сейчас.

---

## 13. Чек-лист перед тем как считать ноду готовой

- [ ] `super(id, type, x, y, config)` вызван первой строкой конструктора.
- [ ] `this.inputs` / `this.outputs` выставлены.
- [ ] Все сокеты созданы через `SocketFactory.createSocket()`.
- [ ] Корневой узел `createContent()` без `overflow: hidden`, без фиксированной `height`.
- [ ] `calculate()` не трогает DOM, безопасно обрабатывает отсутствие входа.
- [ ] `updateDisplay()` не перезаписывает поле ввода, находящееся в фокусе.
- [ ] Тип зарегистрирован в `main.js` (`nodeManager.registerNodeType`).
- [ ] Пункт добавлен в сайдбар `index.html` (`onclick="window.addNode('type', x, y)"`).
- [ ] Уникальные поля состояния добавлены в `layoutManager.serialize()` и
      читаются в конструкторе из `config`.
- [ ] Цвета взяты из `var(--md-...)`, не хардкод.
- [ ] Нода проверена: создание, соединение, сворачивание/разворачивание,
      растягивание по ширине, удаление, дублирование, сохранение → загрузка.
