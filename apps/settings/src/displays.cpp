#include "displays.h"

#include <QDBusArgument>
#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusMetaType>
#include <QDBusVariant>
#include <QSize>
#include <QVariantMap>

#include <algorithm>
#include <cmath>

// Структуры для ApplyMonitorsConfig: a(iiduba(ssa{sv})).
struct ApplyMonitor {
    QString connector;
    QString mode;
    QVariantMap properties;
};
struct ApplyLogical {
    int x = 0;
    int y = 0;
    double scale = 1;
    uint transform = 0;
    bool primary = false;
    QList<ApplyMonitor> monitors;
};
Q_DECLARE_METATYPE(ApplyMonitor)
Q_DECLARE_METATYPE(ApplyLogical)

QDBusArgument &operator<<(QDBusArgument &arg, const ApplyMonitor &monitor)
{
    arg.beginStructure();
    arg << monitor.connector << monitor.mode << monitor.properties;
    arg.endStructure();
    return arg;
}

const QDBusArgument &operator>>(const QDBusArgument &arg, ApplyMonitor &monitor)
{
    arg.beginStructure();
    arg >> monitor.connector >> monitor.mode >> monitor.properties;
    arg.endStructure();
    return arg;
}

QDBusArgument &operator<<(QDBusArgument &arg, const ApplyLogical &logical)
{
    arg.beginStructure();
    arg << logical.x << logical.y << logical.scale << logical.transform << logical.primary << logical.monitors;
    arg.endStructure();
    return arg;
}

const QDBusArgument &operator>>(const QDBusArgument &arg, ApplyLogical &logical)
{
    arg.beginStructure();
    arg >> logical.x >> logical.y >> logical.scale >> logical.transform >> logical.primary >> logical.monitors;
    arg.endStructure();
    return arg;
}

namespace
{

const QString kService = QStringLiteral("org.gnome.Mutter.DisplayConfig");
const QString kPath = QStringLiteral("/org/gnome/Mutter/DisplayConfig");
const QString kInterface = QStringLiteral("org.gnome.Mutter.DisplayConfig");

// Значение a{sv} из QDBusArgument.
QVariantMap readProperties(const QDBusArgument &arg)
{
    QVariantMap map;
    arg >> map;
    return map;
}

bool isLogicalLayout(uint layoutMode)
{
    return layoutMode == 1;
}

} // namespace

Displays::Displays(QObject *parent)
    : QObject(parent)
{
    qDBusRegisterMetaType<ApplyMonitor>();
    qDBusRegisterMetaType<QList<ApplyMonitor>>();
    qDBusRegisterMetaType<ApplyLogical>();
    qDBusRegisterMetaType<QList<ApplyLogical>>();
    QDBusConnection::sessionBus().connect(kService, kPath, kInterface, QStringLiteral("MonitorsChanged"), this,
                                          SLOT(refresh()));
    refresh();
}

Displays *Displays::create(QQmlEngine *, QJSEngine *)
{
    static Displays *displays = new Displays();
    QQmlEngine::setObjectOwnership(displays, QQmlEngine::CppOwnership);
    return displays;
}

const Displays::Mode *Displays::currentMode(const Monitor &monitor) const
{
    for (const Mode &mode : monitor.modes) {
        if (mode.current)
            return &mode;
    }
    return nullptr;
}

void Displays::refresh()
{
    QDBusMessage message = QDBusMessage::createMethodCall(kService, kPath, kInterface, QStringLiteral("GetCurrentState"));
    const QDBusMessage reply = QDBusConnection::sessionBus().call(message, QDBus::Block, 3000);
    m_state.clear();
    m_logical.clear();
    m_monitors.clear();
    m_available = reply.type() == QDBusMessage::ReplyMessage && reply.arguments().size() >= 4;
    if (!m_available) {
        Q_EMIT changed();
        return;
    }

    const QList<QVariant> args = reply.arguments();
    m_serial = args.at(0).toUInt();

    // monitors: a((ssss)a(siiddada{sv})a{sv})
    const QDBusArgument monitorsArg = args.at(1).value<QDBusArgument>();
    monitorsArg.beginArray();
    while (!monitorsArg.atEnd()) {
        Monitor monitor;
        monitorsArg.beginStructure();
        monitorsArg.beginStructure();
        monitorsArg >> monitor.connector >> monitor.vendor >> monitor.product >> monitor.serial;
        monitorsArg.endStructure();

        monitorsArg.beginArray();
        while (!monitorsArg.atEnd()) {
            Mode mode;
            QVariantMap props;
            monitorsArg.beginStructure();
            monitorsArg >> mode.id >> mode.width >> mode.height >> mode.refresh >> mode.preferredScale;
            monitorsArg.beginArray();
            while (!monitorsArg.atEnd()) {
                double scale = 1;
                monitorsArg >> scale;
                mode.scales << scale;
            }
            monitorsArg.endArray();
            props = readProperties(monitorsArg);
            monitorsArg.endStructure();
            mode.current = props.value(QStringLiteral("is-current")).toBool();
            mode.preferred = props.value(QStringLiteral("is-preferred")).toBool();
            monitor.modes << mode;
        }
        monitorsArg.endArray();

        const QVariantMap props = readProperties(monitorsArg);
        monitorsArg.endStructure();
        monitor.displayName = props.value(QStringLiteral("display-name")).toString();
        monitor.builtin = props.value(QStringLiteral("is-builtin")).toBool();
        m_state << monitor;
    }
    monitorsArg.endArray();

    // logical_monitors: a(iiduba(ssss)a{sv})
    const QDBusArgument logicalArg = args.at(2).value<QDBusArgument>();
    logicalArg.beginArray();
    while (!logicalArg.atEnd()) {
        Logical logical;
        logicalArg.beginStructure();
        logicalArg >> logical.x >> logical.y >> logical.scale >> logical.transform >> logical.primary;
        logicalArg.beginArray();
        while (!logicalArg.atEnd()) {
            QString connector, vendor, product, serial;
            logicalArg.beginStructure();
            logicalArg >> connector >> vendor >> product >> serial;
            logicalArg.endStructure();
            logical.connectors << connector;
        }
        logicalArg.endArray();
        readProperties(logicalArg);
        logicalArg.endStructure();
        m_logical << logical;
    }
    logicalArg.endArray();

    const QVariantMap properties = readProperties(args.at(3).value<QDBusArgument>());
    m_layoutMode = properties.value(QStringLiteral("layout-mode"), 1).toUInt();

    // Дробное масштабирование: у какого-нибудь режима есть масштаб не
    // кратный 1.
    m_fractional = false;
    for (const Monitor &monitor : std::as_const(m_state)) {
        for (const Mode &mode : monitor.modes) {
            for (double scale : mode.scales)
                m_fractional = m_fractional || std::abs(scale - std::round(scale)) > 0.01;
        }
    }

    for (const Monitor &monitor : std::as_const(m_state)) {
        QVariantMap map;
        map.insert(QStringLiteral("connector"), monitor.connector);
        map.insert(QStringLiteral("name"), monitor.displayName.isEmpty() ? monitor.connector : monitor.displayName);
        map.insert(QStringLiteral("builtin"), monitor.builtin);

        const Logical *logical = nullptr;
        for (const Logical &l : std::as_const(m_logical)) {
            if (l.connectors.contains(monitor.connector))
                logical = &l;
        }
        map.insert(QStringLiteral("enabled"), logical != nullptr);
        map.insert(QStringLiteral("scale"), logical ? logical->scale : 1.0);
        map.insert(QStringLiteral("transform"), logical ? int(logical->transform) : 0);
        map.insert(QStringLiteral("primary"), logical ? logical->primary : false);

        const Mode *current = currentMode(monitor);
        map.insert(QStringLiteral("modeId"), current ? current->id : QString());
        map.insert(QStringLiteral("resolution"),
                   current ? QStringLiteral("%1×%2").arg(current->width).arg(current->height) : QString());

        QVariantList modes;
        for (const Mode &mode : monitor.modes) {
            QVariantList scales;
            for (double scale : mode.scales)
                scales << scale;
            modes << QVariantMap{
                {QStringLiteral("id"), mode.id},
                {QStringLiteral("width"), mode.width},
                {QStringLiteral("height"), mode.height},
                {QStringLiteral("refresh"), mode.refresh},
                {QStringLiteral("current"), mode.current},
                {QStringLiteral("preferred"), mode.preferred},
                {QStringLiteral("scales"), scales},
            };
        }
        map.insert(QStringLiteral("modes"), modes);
        m_monitors << map;
    }
    Q_EMIT changed();
}

bool Displays::apply(const QString &connector, const QString &modeId, double scale, int transform, bool primary)
{
    if (!m_available)
        return false;

    // Размер логического монитора — для раскладки мониторов в ряд.
    auto logicalSize = [this](const Logical &logical, const QString &overrideConnector, const QString &overrideMode,
                              double overrideScale, int overrideTransform) {
        const QString conn = logical.connectors.value(0);
        const bool target = logical.connectors.contains(overrideConnector);
        for (const Monitor &monitor : std::as_const(m_state)) {
            if (monitor.connector != conn)
                continue;
            const QString wanted = target ? overrideMode : (currentMode(monitor) ? currentMode(monitor)->id : QString());
            for (const Mode &mode : monitor.modes) {
                if (mode.id != wanted)
                    continue;
                const double s = target ? overrideScale : logical.scale;
                const int t = target ? overrideTransform : int(logical.transform);
                int w = mode.width, h = mode.height;
                if (t % 2 == 1)
                    std::swap(w, h);
                if (isLogicalLayout(m_layoutMode))
                    return QSize(int(std::round(w / s)), int(std::round(h / s)));
                return QSize(w, h);
            }
        }
        return QSize();
    };

    // Мониторы стоят в ряд слева направо в прежнем порядке — пересчитываем
    // координаты, чтобы после смены разрешения они не наложились.
    QList<Logical> logical = m_logical;
    std::sort(logical.begin(), logical.end(), [](const Logical &a, const Logical &b) {
        return a.x < b.x;
    });
    int nextX = 0;
    for (Logical &l : logical) {
        const QSize size = logicalSize(l, connector, modeId, scale, transform);
        l.x = nextX;
        l.y = 0;
        nextX += size.width();
        if (l.connectors.contains(connector)) {
            l.scale = scale;
            l.transform = uint(transform);
        }
        if (primary)
            l.primary = l.connectors.contains(connector);
    }

    QList<ApplyLogical> config;
    for (const Logical &l : std::as_const(logical)) {
        ApplyLogical item;
        item.x = l.x;
        item.y = l.y;
        item.scale = l.scale;
        item.transform = l.transform;
        item.primary = l.primary;
        for (const QString &conn : l.connectors) {
            QString mode;
            for (const Monitor &monitor : std::as_const(m_state)) {
                if (monitor.connector == conn)
                    mode = conn == connector ? modeId : (currentMode(monitor) ? currentMode(monitor)->id : QString());
            }
            item.monitors << ApplyMonitor{conn, mode, {}};
        }
        config << item;
    }

    QDBusMessage message =
        QDBusMessage::createMethodCall(kService, kPath, kInterface, QStringLiteral("ApplyMonitorsConfig"));
    // 2 — «постоянно»: GNOME Shell покажет окно подтверждения с откатом.
    message << m_serial << uint(2) << QVariant::fromValue(config) << QVariantMap();
    const QDBusMessage reply = QDBusConnection::sessionBus().call(message, QDBus::Block, 5000);
    if (reply.type() == QDBusMessage::ErrorMessage) {
        Q_EMIT failed(reply.errorMessage());
        refresh();
        return false;
    }
    return true;
}
