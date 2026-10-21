#include "network.h"

#include <QDBusArgument>
#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusMetaType>
#include <QDBusObjectPath>
#include <QDBusPendingCallWatcher>
#include <QDBusServiceWatcher>
#include <QDBusVariant>
#include <QProcess>

#include <algorithm>

using InterfaceMap = QMap<QString, QVariantMap>;
using ManagedObjects = QMap<QDBusObjectPath, InterfaceMap>;
using ConnectionSettings = QMap<QString, QVariantMap>;
Q_DECLARE_METATYPE(InterfaceMap)
Q_DECLARE_METATYPE(ManagedObjects)

namespace
{

const QString kService = QStringLiteral("org.freedesktop.NetworkManager");
const QString kPath = QStringLiteral("/org/freedesktop/NetworkManager");
const QString kSettingsPath = QStringLiteral("/org/freedesktop/NetworkManager/Settings");
const QString kManager = QStringLiteral("org.freedesktop.NetworkManager");
const QString kDevice = QStringLiteral("org.freedesktop.NetworkManager.Device");
const QString kWireless = QStringLiteral("org.freedesktop.NetworkManager.Device.Wireless");
const QString kAccessPoint = QStringLiteral("org.freedesktop.NetworkManager.AccessPoint");
const QString kActive = QStringLiteral("org.freedesktop.NetworkManager.Connection.Active");
const QString kIp4 = QStringLiteral("org.freedesktop.NetworkManager.IP4Config");
const QString kSettings = QStringLiteral("org.freedesktop.NetworkManager.Settings");
const QString kConnection = QStringLiteral("org.freedesktop.NetworkManager.Settings.Connection");
const QString kProperties = QStringLiteral("org.freedesktop.DBus.Properties");

// Состояния NMDeviceState и NMActiveConnectionState.
constexpr uint kDeviceUnavailable = 20;
constexpr uint kDeviceDisconnected = 30;
constexpr uint kDeviceActivated = 100;
constexpr uint kActiveActivating = 1;
constexpr uint kActiveActivated = 2;

// Флаги точки доступа: NM_802_11_AP_FLAGS_PRIVACY и NM_802_11_AP_SEC_KEY_MGMT_*.
constexpr uint kApPrivacy = 0x1;
constexpr uint kKeyMgmt8021x = 0x200;
constexpr uint kKeyMgmtSae = 0x400;
constexpr uint kKeyMgmtOwe = 0x800;
constexpr uint kKeyMgmtPsk = 0x100;

QString pathOf(const QVariant &value)
{
    return value.value<QDBusObjectPath>().path();
}

QStringList pathsOf(const QVariant &value)
{
    QStringList result;
    const auto list = qdbus_cast<QList<QDBusObjectPath>>(value);
    for (const QDBusObjectPath &path : list)
        result << path.path();
    return result;
}

// Имя адаптера из базы udev: «Wi-Fi 6 AX201», «RTL8111/8168 PCI Express…».
QString udevModel(const QString &interface)
{
    static QHash<QString, QString> cache;
    if (cache.contains(interface))
        return cache.value(interface);
    QProcess udevadm;
    udevadm.start(QStringLiteral("udevadm"),
                  {QStringLiteral("info"), QStringLiteral("-q"), QStringLiteral("property"),
                   QStringLiteral("/sys/class/net/") + interface});
    QString model;
    if (udevadm.waitForFinished(1500)) {
        const QStringList lines = QString::fromUtf8(udevadm.readAllStandardOutput()).split(QLatin1Char('\n'));
        for (const QString &key : {QStringLiteral("ID_MODEL_FROM_DATABASE="), QStringLiteral("ID_MODEL_ENC="),
                                   QStringLiteral("ID_MODEL=")}) {
            for (const QString &line : lines) {
                if (model.isEmpty() && line.startsWith(key))
                    model = line.mid(key.size()).replace(QLatin1String("\\x20"), QLatin1String(" ")).trimmed();
            }
        }
    }
    cache.insert(interface, model);
    return model;
}

} // namespace

Network::Network(QObject *parent)
    : QObject(parent)
{
    qDBusRegisterMetaType<InterfaceMap>();
    qDBusRegisterMetaType<ManagedObjects>();
    qDBusRegisterMetaType<QList<QDBusObjectPath>>();
    qDBusRegisterMetaType<QList<QVariantMap>>();

    m_timer.setSingleShot(true);
    m_timer.setInterval(250);
    connect(&m_timer, &QTimer::timeout, this, &Network::refresh);

    QDBusConnection bus = QDBusConnection::systemBus();
    // Любое изменение свойств у NetworkManager — перечитать всё (раз в
    // четверть секунды, сила сигнала меняется часто).
    bus.connect(kService, QString(), kProperties, QStringLiteral("PropertiesChanged"), this,
                SLOT(scheduleRefresh()));
    bus.connect(kService, QStringLiteral("/org/freedesktop"), QStringLiteral("org.freedesktop.DBus.ObjectManager"),
                QStringLiteral("InterfacesAdded"), this, SLOT(scheduleRefresh()));
    bus.connect(kService, QStringLiteral("/org/freedesktop"), QStringLiteral("org.freedesktop.DBus.ObjectManager"),
                QStringLiteral("InterfacesRemoved"), this, SLOT(scheduleRefresh()));
    bus.connect(kService, kSettingsPath, kSettings, QStringLiteral("NewConnection"), this,
                SLOT(connectionsChanged()));
    bus.connect(kService, kSettingsPath, kSettings, QStringLiteral("ConnectionRemoved"), this,
                SLOT(connectionsChanged()));
    bus.connect(kService, QString(), kConnection, QStringLiteral("Updated"), this, SLOT(connectionsChanged()));

    auto *watcher = new QDBusServiceWatcher(kService, bus, QDBusServiceWatcher::WatchForOwnerChange, this);
    connect(watcher, &QDBusServiceWatcher::serviceOwnerChanged, this, &Network::connectionsChanged);

    connectionsChanged();
}

Network *Network::create(QQmlEngine *, QJSEngine *)
{
    static Network *network = new Network();
    QQmlEngine::setObjectOwnership(network, QQmlEngine::CppOwnership);
    return network;
}

void Network::scheduleRefresh()
{
    if (!m_timer.isActive())
        m_timer.start();
}

void Network::connectionsChanged()
{
    readConnections();
    scheduleRefresh();
}

void Network::readConnections()
{
    m_saved.clear();
    QDBusMessage list = QDBusMessage::createMethodCall(kService, kSettingsPath, kSettings,
                                                       QStringLiteral("ListConnections"));
    const QDBusMessage reply = QDBusConnection::systemBus().call(list, QDBus::Block, 3000);
    if (reply.type() != QDBusMessage::ReplyMessage || reply.arguments().isEmpty())
        return;
    for (const QString &path : pathsOf(reply.arguments().constFirst())) {
        QDBusMessage get = QDBusMessage::createMethodCall(kService, path, kConnection, QStringLiteral("GetSettings"));
        const QDBusMessage settingsReply = QDBusConnection::systemBus().call(get, QDBus::Block, 3000);
        if (settingsReply.type() != QDBusMessage::ReplyMessage || settingsReply.arguments().isEmpty())
            continue;
        const auto settings = qdbus_cast<ConnectionSettings>(settingsReply.arguments().constFirst());
        const QVariantMap connection = settings.value(QStringLiteral("connection"));
        Saved saved;
        saved.path = path;
        saved.id = connection.value(QStringLiteral("id")).toString();
        saved.type = connection.value(QStringLiteral("type")).toString();
        saved.uuid = connection.value(QStringLiteral("uuid")).toString();
        saved.ssid = settings.value(QStringLiteral("802-11-wireless")).value(QStringLiteral("ssid")).toByteArray();
        m_saved << saved;
    }
}

void Network::refresh()
{
    QDBusMessage message = QDBusMessage::createMethodCall(kService, QStringLiteral("/org/freedesktop"),
                                                          QStringLiteral("org.freedesktop.DBus.ObjectManager"),
                                                          QStringLiteral("GetManagedObjects"));
    const QDBusMessage reply = QDBusConnection::systemBus().call(message, QDBus::Block, 3000);
    m_available = reply.type() == QDBusMessage::ReplyMessage && !reply.arguments().isEmpty();
    m_rawDevices.clear();
    m_aps.clear();
    m_active.clear();
    m_ip4.clear();
    m_devices.clear();
    m_vpns.clear();
    if (!m_available) {
        Q_EMIT changed();
        return;
    }

    const auto objects = qdbus_cast<ManagedObjects>(reply.arguments().constFirst());
    for (auto it = objects.cbegin(); it != objects.cend(); ++it) {
        const QString path = it.key().path();
        const InterfaceMap &ifaces = it.value();
        if (ifaces.contains(kManager)) {
            const QVariantMap props = ifaces.value(kManager);
            m_wifiEnabled = props.value(QStringLiteral("WirelessEnabled")).toBool();
            m_wifiHardware = props.value(QStringLiteral("WirelessHardwareEnabled"), true).toBool();
        }
        if (ifaces.contains(kDevice)) {
            const QVariantMap props = ifaces.value(kDevice);
            const uint type = props.value(QStringLiteral("DeviceType")).toUInt();
            if (type != 1 && type != 2) // только Ethernet и Wi‑Fi
                continue;
            if (!props.value(QStringLiteral("Managed"), true).toBool())
                continue;
            Device device;
            device.path = path;
            device.kind = type == 2 ? QStringLiteral("wifi") : QStringLiteral("ethernet");
            device.interface = props.value(QStringLiteral("Interface")).toString();
            device.driver = props.value(QStringLiteral("Driver")).toString();
            device.state = props.value(QStringLiteral("State")).toUInt();
            device.autoconnect = props.value(QStringLiteral("Autoconnect"), true).toBool();
            device.activeConnection = pathOf(props.value(QStringLiteral("ActiveConnection")));
            device.ip4Config = pathOf(props.value(QStringLiteral("Ip4Config")));
            if (ifaces.contains(kWireless)) {
                const QVariantMap wireless = ifaces.value(kWireless);
                device.accessPoints = pathsOf(wireless.value(QStringLiteral("AccessPoints")));
                device.activeAccessPoint = pathOf(wireless.value(QStringLiteral("ActiveAccessPoint")));
            }
            m_rawDevices.insert(path, device);
        }
        if (ifaces.contains(kAccessPoint)) {
            const QVariantMap props = ifaces.value(kAccessPoint);
            AccessPoint ap;
            ap.path = path;
            ap.ssid = props.value(QStringLiteral("Ssid")).toByteArray();
            ap.strength = props.value(QStringLiteral("Strength")).toInt();
            ap.frequency = props.value(QStringLiteral("Frequency")).toUInt();
            const uint flags = props.value(QStringLiteral("Flags")).toUInt();
            const uint security = props.value(QStringLiteral("WpaFlags")).toUInt()
                                  | props.value(QStringLiteral("RsnFlags")).toUInt();
            ap.enterprise = security & kKeyMgmt8021x;
            // OWE — шифрование без пароля, для человека это открытая сеть.
            ap.secure = ((flags & kApPrivacy) || security) && security != kKeyMgmtOwe;
            m_aps.insert(path, ap);
        }
        if (ifaces.contains(kActive))
            m_active.insert(path, ifaces.value(kActive));
        if (ifaces.contains(kIp4)) {
            QStringList addresses;
            const auto data = qdbus_cast<QList<QVariantMap>>(ifaces.value(kIp4).value(QStringLiteral("AddressData")));
            for (const QVariantMap &address : data)
                addresses << address.value(QStringLiteral("address")).toString();
            m_ip4.insert(path, addresses);
        }
    }

    QList<Device> sorted = m_rawDevices.values();
    std::sort(sorted.begin(), sorted.end(), [](const Device &a, const Device &b) {
        return a.kind != b.kind ? a.kind == QLatin1String("wifi") : a.interface < b.interface;
    });
    for (const Device &device : std::as_const(sorted)) {
        const QVariantMap active = m_active.value(device.activeConnection);
        const uint activeState = active.value(QStringLiteral("State")).toUInt();
        m_devices << QVariantMap{
            {QStringLiteral("path"), device.path},
            {QStringLiteral("kind"), device.kind},
            {QStringLiteral("interface"), device.interface},
            {QStringLiteral("name"), deviceName(device)},
            {QStringLiteral("state"), device.state},
            {QStringLiteral("available"), device.state > kDeviceUnavailable},
            {QStringLiteral("connected"), device.state == kDeviceActivated},
            {QStringLiteral("connecting"), device.state > kDeviceDisconnected && device.state < kDeviceActivated},
            {QStringLiteral("connection"), active.value(QStringLiteral("Id")).toString()},
            {QStringLiteral("activating"), activeState == kActiveActivating},
            {QStringLiteral("address"), m_ip4.value(device.ip4Config).value(0)},
            {QStringLiteral("autoconnect"), device.autoconnect},
        };
    }

    // VPN и WireGuard — по сохранённым подключениям, активность — по
    // активным подключениям.
    for (const Saved &saved : std::as_const(m_saved)) {
        if (saved.type != QLatin1String("vpn") && saved.type != QLatin1String("wireguard"))
            continue;
        uint state = 0;
        for (const QVariantMap &active : std::as_const(m_active)) {
            if (pathOf(active.value(QStringLiteral("Connection"))) == saved.path)
                state = active.value(QStringLiteral("State")).toUInt();
        }
        m_vpns << QVariantMap{
            {QStringLiteral("path"), saved.path},
            {QStringLiteral("name"), saved.id},
            {QStringLiteral("type"), saved.type},
            {QStringLiteral("active"), state == kActiveActivated},
            {QStringLiteral("activating"), state == kActiveActivating},
        };
    }
    Q_EMIT changed();
}

QString Network::deviceName(const Device &device) const
{
    const QString model = udevModel(device.interface);
    if (!model.isEmpty())
        return model;
    return device.kind == QLatin1String("wifi") ? tr("Wi‑Fi adapter") : tr("Ethernet adapter");
}

QString Network::savedFor(const QByteArray &ssid) const
{
    for (const Saved &saved : m_saved) {
        if (saved.type == QLatin1String("802-11-wireless") && saved.ssid == ssid)
            return saved.path;
    }
    return QString();
}

QVariantList Network::networks(const QString &devicePath) const
{
    const Device device = m_rawDevices.value(devicePath);
    // У одной сети бывает много точек доступа (2,4 и 5 ГГц, роуминг) —
    // показываем сеть один раз, с самым сильным сигналом.
    QHash<QByteArray, AccessPoint> best;
    for (const QString &path : device.accessPoints) {
        const AccessPoint ap = m_aps.value(path);
        if (ap.ssid.isEmpty())
            continue;
        if (!best.contains(ap.ssid) || best.value(ap.ssid).strength < ap.strength || path == device.activeAccessPoint)
            best.insert(ap.ssid, ap);
    }
    const QByteArray activeSsid = m_aps.value(device.activeAccessPoint).ssid;
    QList<AccessPoint> list = best.values();
    std::sort(list.begin(), list.end(), [&](const AccessPoint &a, const AccessPoint &b) {
        if ((a.ssid == activeSsid) != (b.ssid == activeSsid))
            return a.ssid == activeSsid;
        return a.strength > b.strength;
    });
    QVariantList result;
    for (const AccessPoint &ap : std::as_const(list)) {
        result << QVariantMap{
            {QStringLiteral("ssid"), QString::fromUtf8(ap.ssid)},
            {QStringLiteral("strength"), ap.strength},
            {QStringLiteral("secure"), ap.secure},
            {QStringLiteral("enterprise"), ap.enterprise},
            {QStringLiteral("known"), !savedFor(ap.ssid).isEmpty()},
            {QStringLiteral("active"), !activeSsid.isEmpty() && ap.ssid == activeSsid},
            {QStringLiteral("frequency"), ap.frequency},
        };
    }
    return result;
}

bool Network::call(const QString &path, const QString &interface, const QString &method, const QVariantList &args,
                   QVariantList *out)
{
    QDBusMessage message = QDBusMessage::createMethodCall(kService, path, interface, method);
    message.setArguments(args);
    if (out) {
        const QDBusMessage reply = QDBusConnection::systemBus().call(message, QDBus::Block, 5000);
        if (reply.type() == QDBusMessage::ErrorMessage) {
            Q_EMIT failed(reply.errorMessage());
            return false;
        }
        *out = reply.arguments();
        return true;
    }
    // Подключение может идти долго — ошибку ждём не блокируя окно.
    auto *watcher = new QDBusPendingCallWatcher(QDBusConnection::systemBus().asyncCall(message, 30000), this);
    connect(watcher, &QDBusPendingCallWatcher::finished, this, [this](QDBusPendingCallWatcher *w) {
        if (w->isError() && w->error().type() != QDBusError::NoReply)
            Q_EMIT failed(w->error().message());
        w->deleteLater();
        scheduleRefresh();
    });
    return true;
}

void Network::setWifiEnabled(bool enabled)
{
    if (!m_available || enabled == m_wifiEnabled)
        return;
    m_wifiEnabled = enabled;
    call(kPath, kProperties, QStringLiteral("Set"),
         {kManager, QStringLiteral("WirelessEnabled"), QVariant::fromValue(QDBusVariant(enabled))});
    Q_EMIT changed();
}

void Network::scan(const QString &device)
{
    if (m_rawDevices.value(device).kind == QLatin1String("wifi"))
        call(device, kWireless, QStringLiteral("RequestScan"), {QVariantMap()});
}

void Network::connectTo(const QString &devicePath, const QString &ssid, const QString &password, bool hidden)
{
    const QByteArray raw = ssid.toUtf8();
    const QString saved = savedFor(raw);
    if (!saved.isEmpty() && password.isEmpty()) {
        call(kPath, kManager, QStringLiteral("ActivateConnection"),
             {QVariant::fromValue(QDBusObjectPath(saved)), QVariant::fromValue(QDBusObjectPath(devicePath)),
              QVariant::fromValue(QDBusObjectPath(QStringLiteral("/")))});
        return;
    }
    // Новый пароль к сохранённой сети — старое подключение заменяется новым.
    if (!saved.isEmpty())
        call(saved, kConnection, QStringLiteral("Delete"), {});

    const Device device = m_rawDevices.value(devicePath);
    AccessPoint ap;
    for (const QString &path : device.accessPoints) {
        const AccessPoint candidate = m_aps.value(path);
        if (candidate.ssid == raw && (ap.path.isEmpty() || candidate.strength > ap.strength))
            ap = candidate;
    }

    ConnectionSettings settings;
    settings.insert(QStringLiteral("connection"), {{QStringLiteral("id"), ssid},
                                                   {QStringLiteral("type"), QStringLiteral("802-11-wireless")}});
    QVariantMap wireless{{QStringLiteral("ssid"), raw}};
    if (hidden)
        wireless.insert(QStringLiteral("hidden"), true);
    settings.insert(QStringLiteral("802-11-wireless"), wireless);

    uint security = 0;
    bool wep = false;
    if (!ap.path.isEmpty()) {
        QDBusMessage get = QDBusMessage::createMethodCall(kService, ap.path, kProperties, QStringLiteral("GetAll"));
        get << kAccessPoint;
        const QDBusMessage reply = QDBusConnection::systemBus().call(get, QDBus::Block, 3000);
        if (reply.type() == QDBusMessage::ReplyMessage && !reply.arguments().isEmpty()) {
            const auto props = qdbus_cast<QVariantMap>(reply.arguments().constFirst());
            security = props.value(QStringLiteral("WpaFlags")).toUInt() | props.value(QStringLiteral("RsnFlags")).toUInt();
            wep = !security && (props.value(QStringLiteral("Flags")).toUInt() & kApPrivacy);
        }
    } else if (!password.isEmpty()) {
        security = kKeyMgmtPsk; // скрытая сеть с паролем — скорее всего WPA2
    }

    if (security & kKeyMgmt8021x) {
        Q_EMIT failed(tr("Enterprise networks are set up in the advanced connection settings"));
        return;
    }
    QVariantMap secrets;
    if (wep) {
        secrets.insert(QStringLiteral("key-mgmt"), QStringLiteral("none"));
        if (!password.isEmpty()) {
            secrets.insert(QStringLiteral("wep-key0"), password);
            // 5 или 13 символов, 10 или 26 hex — ключ; иначе парольная фраза.
            const int n = password.size();
            secrets.insert(QStringLiteral("wep-key-type"), uint(n == 5 || n == 13 || n == 10 || n == 26 ? 1 : 2));
        }
    } else if (security == kKeyMgmtOwe) {
        secrets.insert(QStringLiteral("key-mgmt"), QStringLiteral("owe"));
    } else if (security) {
        // Только WPA3 — SAE, в остальных случаях WPA2 (смешанные сети тоже).
        const bool sae = (security & kKeyMgmtSae) && !(security & kKeyMgmtPsk);
        secrets.insert(QStringLiteral("key-mgmt"), sae ? QStringLiteral("sae") : QStringLiteral("wpa-psk"));
        if (!password.isEmpty())
            secrets.insert(QStringLiteral("psk"), password);
    }
    if (!secrets.isEmpty())
        settings.insert(QStringLiteral("802-11-wireless-security"), secrets);

    call(kPath, kManager, QStringLiteral("AddAndActivateConnection"),
         {QVariant::fromValue(settings), QVariant::fromValue(QDBusObjectPath(devicePath)),
          QVariant::fromValue(QDBusObjectPath(ap.path.isEmpty() ? QStringLiteral("/") : ap.path))});
}

void Network::disconnectDevice(const QString &device)
{
    call(device, kDevice, QStringLiteral("Disconnect"), {});
}

void Network::setDeviceEnabled(const QString &device, bool enabled)
{
    if (!enabled) {
        // Disconnect заодно запрещает адаптеру подключаться самому.
        disconnectDevice(device);
        return;
    }
    call(device, kProperties, QStringLiteral("Set"),
         {kDevice, QStringLiteral("Autoconnect"), QVariant::fromValue(QDBusVariant(true))});
}

void Network::activateDevice(const QString &device)
{
    // «/» вместо подключения — NetworkManager выберет подходящее сам.
    call(kPath, kManager, QStringLiteral("ActivateConnection"),
         {QVariant::fromValue(QDBusObjectPath(QStringLiteral("/"))), QVariant::fromValue(QDBusObjectPath(device)),
          QVariant::fromValue(QDBusObjectPath(QStringLiteral("/")))});
}

void Network::forget(const QString &ssid)
{
    const QByteArray raw = ssid.toUtf8();
    for (const Saved &saved : std::as_const(m_saved)) {
        if (saved.type == QLatin1String("802-11-wireless") && saved.ssid == raw)
            call(saved.path, kConnection, QStringLiteral("Delete"), {});
    }
}

void Network::setVpnActive(const QString &connection, bool active)
{
    if (active) {
        call(kPath, kManager, QStringLiteral("ActivateConnection"),
             {QVariant::fromValue(QDBusObjectPath(connection)), QVariant::fromValue(QDBusObjectPath(QStringLiteral("/"))),
              QVariant::fromValue(QDBusObjectPath(QStringLiteral("/")))});
        return;
    }
    for (auto it = m_active.cbegin(); it != m_active.cend(); ++it) {
        if (pathOf(it.value().value(QStringLiteral("Connection"))) == connection)
            call(kPath, kManager, QStringLiteral("DeactivateConnection"), {QVariant::fromValue(QDBusObjectPath(it.key()))});
    }
}
