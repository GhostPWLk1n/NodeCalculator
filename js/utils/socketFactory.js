/**
 * SocketFactory - единая точка создания DOM-элементов сокетов.
 *
 * Раньше каждая нода вручную создавала div.socket, проставляла классы,
 * data-атрибуты и навешивала mousedown-обработчик - код дублировался
 * в operationNode/scaleListNode/percentageNode с мелкими расхождениями.
 * SocketFactory собирает всё это в одном месте, чтобы:
 *  - форма (круг/квадрат/ромб) и цвет всегда были согласованы с CSS-классами
 *    (socket-list / socket-count / socket-number / socket-string / socket-data)
 *    без ручных inline-стилей;
 *  - обработчик старта соединения был одинаковым везде.
 *
 * Фактические размеры/форму/цвет задаёт styles.css через классы -
 * здесь мы только правильно расставляем классы и data-атрибуты.
 *
 * Помимо классов, каждый сокет получает единый data-kind
 * ('list' | 'string' | 'data' | 'count' | 'plain') - именно по нему
 * connectionManager проверяет совместимость типов при соединении,
 * а renderer выбирает цвет линии. Это не ломает старые ноды, которые
 * создают сокеты вручную (percentageNode и т.п.) - для них Helpers.getSocketKind()
 * при отсутствии data-kind сам определит тип по classList/data-isList.
 */
export const SocketFactory = {
    /**
     * @param {Object} options
     * @param {number} options.nodeId - id ноды-владельца
     * @param {'input'|'output'} options.socketType - тип сокета
     * @param {number} [options.index=0] - индекс сокета в рамках своего типа
     * @param {boolean} [options.isList=false] - LIST-сокет (квадратный, синий)
     * @param {boolean} [options.isString=false] - String-сокет (круглый, синий #64b5f6)
     * @param {boolean} [options.isData=false] - Data-сокет / таблица (ромб, оранжевый)
     * @param {string|null} [options.outputType=null] - 'result' | 'count' | 'list' | null.
     *        'count' даёт зелёный кружок (socket-count), остальное - обычный
     *        серый кружок (socket-number), если isList/isString/isData не переопределяют форму.
     * @param {string|null} [options.title=null] - всплывающая подсказка
     * @returns {HTMLDivElement}
     */
    createSocket({ nodeId, socketType, index = 0, isList = false, isString = false, isData = false, outputType = null, title = null } = {}) {
        const socket = document.createElement('div');

        // Единый "род" сокета - определяет и класс/цвет, и совместимость
        // при соединении (см. Helpers.getSocketKind)
        let kind = 'plain';
        let classes = `socket ${socketType}-socket`;
        if (isList) {
            kind = 'list';
            classes += ' socket-list';
        } else if (isString) {
            kind = 'string';
            classes += ' socket-string';
        } else if (isData) {
            kind = 'data';
            classes += ' socket-data';
        } else if (outputType === 'count') {
            kind = 'count';
            classes += ' socket-count';
        } else {
            classes += ' socket-number';
        }
        socket.className = classes;

        socket.dataset.nodeId = nodeId;
        socket.dataset.socketType = socketType;
        socket.dataset.index = index;
        socket.dataset.isList = isList ? 'true' : 'false';
        socket.dataset.kind = kind;
        if (outputType) {
            socket.dataset.outputType = outputType;
        }
        if (title) {
            socket.title = title;
        }

        socket.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (window.connectionManager) {
                window.connectionManager.startConnection(e, nodeId, socketType);
            }
        });

        return socket;
    }
};
