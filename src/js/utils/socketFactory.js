/**
 * SocketFactory - единая точка создания DOM-элементов сокетов.
 *
 * Раньше каждая нода вручную создавала div.socket, проставляла классы,
 * data-атрибуты и навешивала mousedown-обработчик - код дублировался
 * в operationNode/scaleListNode/percentageNode с мелкими расхождениями.
 * SocketFactory собирает всё это в одном месте, чтобы:
 *  - форма (круг/квадрат) и цвет всегда были согласованы с CSS-классами
 *    (socket-list / socket-count / socket-number) без ручных inline-стилей;
 *  - обработчик старта соединения был одинаковым везде.
 *
 * Фактические размеры/форму/цвет задаёт styles.css через классы -
 * здесь мы только правильно расставляем классы и data-атрибуты.
 */
export const SocketFactory = {
    /**
     * @param {Object} options
     * @param {number} options.nodeId - id ноды-владельца
     * @param {'input'|'output'} options.socketType - тип сокета
     * @param {number} [options.index=0] - индекс сокета в рамках своего типа
     * @param {boolean} [options.isList=false] - LIST-сокет (квадратный, синий)
     * @param {string|null} [options.outputType=null] - 'result' | 'count' | 'list' | null.
     *        'count' даёт зелёный кружок (socket-count), остальное - обычный
     *        серый кружок (socket-number), если isList не переопределяет форму.
     * @param {string|null} [options.title=null] - всплывающая подсказка
     * @returns {HTMLDivElement}
     */
    createSocket({ nodeId, socketType, index = 0, isList = false, outputType = null, title = null } = {}) {
        const socket = document.createElement('div');

        let classes = `socket ${socketType}-socket`;
        if (isList) {
            classes += ' socket-list';
        } else if (outputType === 'count') {
            classes += ' socket-count';
        } else {
            classes += ' socket-number';
        }
        socket.className = classes;

        socket.dataset.nodeId = nodeId;
        socket.dataset.socketType = socketType;
        socket.dataset.index = index;
        socket.dataset.isList = isList ? 'true' : 'false';
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
