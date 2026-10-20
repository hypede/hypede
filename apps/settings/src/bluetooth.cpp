#include "bluetooth.h"

#include <QDBusArgument>
#include <QDBusConnection>
#include <QDBusMetaType>
#include <QDBusPendingCallWatcher>
#include <QDBusServiceWatcher>
#include <QDBusVariant>

#include <algorithm>

using InterfaceMap = QMap<QString, QVariantMap>;
using ManagedObjects = QMap<QDBusObjectPath, InterfaceMap>;
Q_DECLARE_METATYPE(InterfaceMap)
Q_DECLARE_METATYPE(ManagedObjects)

namespace
{

const QString kService = QStringLiteral("org.bluez");
const QString kAdapter = QStringLiteral("org.bluez.Adapter1");
const QString kDevice = QStringLiteral("org.bluez.Device1");
const QString kBattery = QStringLiteral("org.bluez.Battery1");
const QString kProperties = QStringLiteral("org.freedesktop.DBus.Properties");
const QString kObjectManager = QStringLiteral("org.freedesktop.DBus.ObjectManager");
const QString kAgentPath = QStringLiteral("/dev/hypede/Settings/BluetoothAgent");

QString pathOf(const QVariant &value)
{
    return value.value<QDBusObjectPath>().path();
}

} // namespace

// --- агент -------------------------------------------------------------

BluetoothAgent::BluetoothAgent(Bluetooth *owner)
    : QObject(owner)
    , m_owner(owner)
{
}

void BluetoothAgent::ask(const QString &kind, const QDBusObjectPath &device, const QString &code)
{
    // Новый вопрос отменяет старый, если на тот ещё не ответили.
    if (m_pending.type() == QDBusMessage::MethodCallMessage)
        QDBusConnection::systemBus().send(m_pending.createErrorReply(QStringLiteral("org.bluez.Error.Canceled"),
                                                                     QStringLiteral("Canceled")));
    m_pending = QDBusMessage();
    if (calledFromDBus() && kind != QLatin1String("display")) {
        setDelayedReply(true);
        m_pending = message();
    }
    m_kind = kind;
    m_owner->setRequest({{QStringLiteral("kind"), kind},
                         {QStringLiteral("device"), m_owner->deviceName(device.path())},
                         {QStringLiteral("code"), code}});
}

void BluetoothAgent::answer(bool accept, const QString &value)
{
    if (m_pending.type() == QDBusMessage::MethodCallMessage) {
        QDBusMessage reply;
        if (!accept)
            reply = m_pending.createErrorReply(QStringLiteral("org.bluez.Error.Rejected"), QStringLiteral("Rejected"));
        else if (m_kind == QLatin1String("pin"))
            reply = m_pending.createReply(value);
        else if (m_kind == QLatin1String("passkey"))
            reply = m_pending.createReply(value.toUInt());
        else
            reply = m_pending.createReply();
        QDBusConnection::systemBus().send(reply);
    }
    m_pending = QDBusMessage();
    m_owner->setRequest({});
}

void BluetoothAgent::Release()
{
    Cancel();
}

QString BluetoothAgent::RequestPinCode(const QDBusObjectPath &device)
{
    ask(QStringLiteral("pin"), device, QString());
    return QString();
}

void BluetoothAgent::DisplayPinCode(const QDBusObjectPath &device, const QString &pincode)
{
    ask(QStringLiteral("display"), device, pincode);
}

uint BluetoothAgent::RequestPasskey(const QDBusObjectPath &device)
{
    ask(QStringLiteral("passkey"), device, QString());
    return 0;
}

void BluetoothAgent::DisplayPasskey(const QDBusObjectPath &device, uint passkey, ushort)
{
    ask(QStringLiteral("display"), device, QStringLiteral("%1").arg(passkey, 6, 10, QLatin1Char('0')));
}

void BluetoothAgent::RequestConfirmation(const QDBusObjectPath &device, uint passkey)
{
    ask(QStringLiteral("confirm"), device, QStringLiteral("%1").arg(passkey, 6, 10, QLatin1Char('0')));
}

void BluetoothAgent::RequestAuthorization(const QDBusObjectPath &device)
{
    ask(QStringLiteral("authorize"), device, QString());
}

void BluetoothAgent::AuthorizeService(const QDBusObjectPath &device, const QString &)
{
    // Сопряжённому и доверенному устройству службы разрешаются без вопросов.
    for (const QVariant &value : m_owner->devices()) {
        const QVariantMap item = value.toMap();
        if (item.value(QStringLiteral("path")).toString() == device.path() && item.value(QStringLiteral("paired")).toBool()
            && item.value(QStringLiteral("trusted")).toBool())
            return;
    }
    ask(QStringLiteral("authorize"), device, QString());
}

void BluetoothAgent::Cancel()
{
    m_pending = QDBusMessage();
    m_owner->setRequest({});
}

// --- Bluetooth -----------------------------------------------------------

Bluetooth::Bluetooth(QObject *parent)
    : QObject(parent)
{
    qDBusRegisterMetaType<InterfaceMap>();
    qDBusRegisterMetaType<ManagedObjects>();

    m_timer.setSingleShot(true);
    m_timer.setInterval(200);
    connect(&m_timer, &QTimer::timeout, this, &Bluetooth::refresh);

    QDBusConnection bus = QDBusConnection::systemBus();
    bus.connect(kService, QString(), kProperties, QStringLiteral("PropertiesChanged"), this, SLOT(scheduleRefresh()));
    bus.connect(kService, QStringLiteral("/"), kObjectManager, QStringLiteral("InterfacesAdded"), this,
                SLOT(scheduleRefresh()));
    bus.connect(kService, QStringLiteral("/"), kObjectManager, QStringLiteral("InterfacesRemoved"), this,
                SLOT(scheduleRefresh()));
    auto *watcher = new QDBusServiceWatcher(kService, bus, QDBusServiceWatcher::WatchForOwnerChange, this);
    connect(watcher, &QDBusServiceWatcher::serviceOwnerChanged, this, [this](const QString &, const QString &,
                                                                             const QString &owner) {
        m_discoveringOn.clear();
        if (!owner.isEmpty())
            registerAgent();
        scheduleRefresh();
    });

    m_agent = new BluetoothAgent(this);
    bus.registerObject(kAgentPath, m_agent, QDBusConnection::ExportAllSlots);
    registerAgent();
    refresh();
}

Bluetooth *Bluetooth::create(QQmlEngine *, QJSEngine *)
{
    static Bluetooth *bluetooth = new Bluetooth();
    QQmlEngine::setObjectOwnership(bluetooth, QQmlEngine::CppOwnership);
    return bluetooth;
}

void Bluetooth::registerAgent()
{
    const QVariant path = QVariant::fromValue(QDBusObjectPath(kAgentPath));
    call(QStringLiteral("/org/bluez"), QStringLiteral("org.bluez.AgentManager1"), QStringLiteral("RegisterAgent"),
         {path, QStringLiteral("KeyboardDisplay")}, [this, path] {
             call(QStringLiteral("/org/bluez"), QStringLiteral("org.bluez.AgentManager1"),
                  QStringLiteral("RequestDefaultAgent"), {path});
         });
}

void Bluetooth::scheduleRefresh()
{
    if (!m_timer.isActive())
        m_timer.start();
}

void Bluetooth::refresh()
{
    m_adapters.clear();
    m_devices.clear();
    QDBusMessage message = QDBusMessage::createMethodCall(kService, QStringLiteral("/"), kObjectManager,
                                                          QStringLiteral("GetManagedObjects"));
    const QDBusMessage reply = QDBusConnection::systemBus().call(message, QDBus::Block, 3000);
    if (reply.type() == QDBusMessage::ReplyMessage && !reply.arguments().isEmpty()) {
        const auto objects = qdbus_cast<ManagedObjects>(reply.arguments().constFirst());
        for (auto it = objects.cbegin(); it != objects.cend(); ++it) {
            if (it.value().contains(kAdapter))
                m_adapters.insert(it.key().path(), it.value().value(kAdapter));
            if (it.value().contains(kDevice)) {
                QVariantMap props = it.value().value(kDevice);
                if (it.value().contains(kBattery))
                    props.insert(QStringLiteral("Battery"), it.value().value(kBattery).value(QStringLiteral("Percentage")));
                m_devices.insert(it.key().path(), props);
            }
        }
    }

    if (!m_adapters.contains(m_adapter))
        m_adapter = m_adapters.isEmpty() ? QString() : m_adapters.firstKey();

    m_adapterList.clear();
    for (auto it = m_adapters.cbegin(); it != m_adapters.cend(); ++it) {
        const QVariantMap &p = it.value();
        m_adapterList << QVariantMap{
            {QStringLiteral("path"), it.key()},
            {QStringLiteral("name"), p.value(QStringLiteral("Alias")).toString()},
            {QStringLiteral("address"), p.value(QStringLiteral("Address")).toString()},
            {QStringLiteral("interface"), it.key().section(QLatin1Char('/'), -1)},
            {QStringLiteral("powered"), p.value(QStringLiteral("Powered")).toBool()},
            {QStringLiteral("discoverable"), p.value(QStringLiteral("Discoverable")).toBool()},
            {QStringLiteral("discovering"), p.value(QStringLiteral("Discovering")).toBool()},
        };
    }

    QList<QVariantMap> list;
    for (auto it = m_devices.cbegin(); it != m_devices.cend(); ++it) {
        const QVariantMap &p = it.value();
        if (pathOf(p.value(QStringLiteral("Adapter"))) != m_adapter)
            continue;
        const bool paired = p.value(QStringLiteral("Paired")).toBool() || p.value(QStringLiteral("Bonded")).toBool();
        // Безымянные чужие устройства (маячки, часы соседей) не показываем.
        if (!paired && !p.contains(QStringLiteral("Name")))
            continue;
        list << QVariantMap{
            {QStringLiteral("path"), it.key()},
            {QStringLiteral("name"), p.value(QStringLiteral("Alias")).toString()},
            {QStringLiteral("address"), p.value(QStringLiteral("Address")).toString()},
            {QStringLiteral("icon"), p.value(QStringLiteral("Icon")).toString()},
            {QStringLiteral("paired"), paired},
            {QStringLiteral("connected"), p.value(QStringLiteral("Connected")).toBool()},
            {QStringLiteral("trusted"), p.value(QStringLiteral("Trusted")).toBool()},
            {QStringLiteral("battery"), p.contains(QStringLiteral("Battery")) ? p.value(QStringLiteral("Battery")).toInt() : -1},
            {QStringLiteral("rssi"), p.value(QStringLiteral("RSSI"), -1000).toInt()},
        };
    }
    std::sort(list.begin(), list.end(), [](const QVariantMap &a, const QVariantMap &b) {
        const auto rank = [](const QVariantMap &m) {
            return m.value(QStringLiteral("connected")).toBool() ? 0 : m.value(QStringLiteral("paired")).toBool() ? 1 : 2;
        };
        if (rank(a) != rank(b))
            return rank(a) < rank(b);
        if (rank(a) == 2 && a.value(QStringLiteral("rssi")) != b.value(QStringLiteral("rssi")))
            return a.value(QStringLiteral("rssi")).toInt() > b.value(QStringLiteral("rssi")).toInt();
        return a.value(QStringLiteral("name")).toString().localeAwareCompare(b.value(QStringLiteral("name")).toString()) < 0;
    });
    m_deviceList.clear();
    for (const QVariantMap &item : std::as_const(list))
        m_deviceList << item;

    updateDiscovery();
    Q_EMIT changed();
}

void Bluetooth::setAdapter(const QString &path)
{
    if (path == m_adapter || !m_adapters.contains(path))
        return;
    m_adapter = path;
    refresh();
}

QString Bluetooth::deviceName(const QString &path) const
{
    const QVariantMap props = m_devices.value(path);
    return props.value(QStringLiteral("Alias"), props.value(QStringLiteral("Address"))).toString();
}

void Bluetooth::setRequest(const QVariantMap &request)
{
    m_request = request;
    Q_EMIT requestChanged();
}

void Bluetooth::call(const QString &path, const QString &interface, const QString &method, const QVariantList &args,
                     const std::function<void()> &done)
{
    QDBusMessage message = QDBusMessage::createMethodCall(kService, path, interface, method);
    message.setArguments(args);
    auto *watcher = new QDBusPendingCallWatcher(QDBusConnection::systemBus().asyncCall(message, 60000), this);
    connect(watcher, &QDBusPendingCallWatcher::finished, this, [this, done, method](QDBusPendingCallWatcher *w) {
        if (w->isError()) {
            const QString name = w->error().name();
            // Отменённое сопряжение и повторная регистрация агента — не ошибки.
            if (name != QLatin1String("org.bluez.Error.AuthenticationCanceled")
                && name != QLatin1String("org.bluez.Error.AlreadyExists") && method != QLatin1String("StopDiscovery"))
                Q_EMIT failed(w->error().message());
        } else if (done) {
            done();
        }
        w->deleteLater();
        scheduleRefresh();
    });
}

void Bluetooth::setBluezProperty(const QString &path, const QString &interface, const QString &name,
                                 const QVariant &value)
{
    call(path, kProperties, QStringLiteral("Set"), {interface, name, QVariant::fromValue(QDBusVariant(value))});
}

void Bluetooth::setPowered(const QString &adapter, bool powered)
{
    if (powered) {
        // Bluetooth, выключенный «режимом полёта» GNOME, включается там же,
        // иначе BlueZ не включит адаптер (rfkill).
        QDBusMessage set = QDBusMessage::createMethodCall(
            QStringLiteral("org.gnome.SettingsDaemon.Rfkill"), QStringLiteral("/org/gnome/SettingsDaemon/Rfkill"),
            kProperties, QStringLiteral("Set"));
        set << QStringLiteral("org.gnome.SettingsDaemon.Rfkill") << QStringLiteral("BluetoothAirplaneMode")
            << QVariant::fromValue(QDBusVariant(false));
        QDBusConnection::sessionBus().call(set, QDBus::Block, 2000);
    }
    setBluezProperty(adapter, kAdapter, QStringLiteral("Powered"), powered);
}

void Bluetooth::setDiscoverable(const QString &adapter, bool discoverable)
{
    setBluezProperty(adapter, kAdapter, QStringLiteral("Discoverable"), discoverable);
}

void Bluetooth::setAlias(const QString &adapter, const QString &alias)
{
    if (!alias.trimmed().isEmpty())
        setBluezProperty(adapter, kAdapter, QStringLiteral("Alias"), alias.trimmed());
}

void Bluetooth::setDiscovery(bool on)
{
    m_discoveryWanted = on;
    updateDiscovery();
}

void Bluetooth::updateDiscovery()
{
    const bool powered = m_adapters.value(m_adapter).value(QStringLiteral("Powered")).toBool();
    const QString wanted = m_discoveryWanted && powered ? m_adapter : QString();
    if (wanted == m_discoveringOn)
        return;
    if (!m_discoveringOn.isEmpty() && m_adapters.contains(m_discoveringOn))
        call(m_discoveringOn, kAdapter, QStringLiteral("StopDiscovery"));
    m_discoveringOn = wanted;
    if (!wanted.isEmpty())
        call(wanted, kAdapter, QStringLiteral("StartDiscovery"));
}

void Bluetooth::pair(const QString &device)
{
    // После сопряжения устройство становится доверенным и подключается.
    call(device, kDevice, QStringLiteral("Pair"), {}, [this, device] {
        if (m_request.value(QStringLiteral("kind")) == QLatin1String("display"))
            setRequest({});
        setBluezProperty(device, kDevice, QStringLiteral("Trusted"), true);
        connectDevice(device);
    });
}

void Bluetooth::connectDevice(const QString &device)
{
    call(device, kDevice, QStringLiteral("Connect"));
}

void Bluetooth::disconnectDevice(const QString &device)
{
    call(device, kDevice, QStringLiteral("Disconnect"));
}

void Bluetooth::remove(const QString &device)
{
    const QString adapter = pathOf(m_devices.value(device).value(QStringLiteral("Adapter")));
    call(adapter.isEmpty() ? m_adapter : adapter, kAdapter, QStringLiteral("RemoveDevice"),
         {QVariant::fromValue(QDBusObjectPath(device))});
}

void Bluetooth::answer(bool accept, const QString &value)
{
    m_agent->answer(accept, value);
}
