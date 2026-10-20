// Сеть через NetworkManager (D-Bus): все адаптеры Wi‑Fi и Ethernet по
// отдельности, сети каждого адаптера Wi‑Fi, сохранённые сети и VPN.
// Пароль для новой защищённой сети передаётся сразу; если его нет (или он
// неверный), NetworkManager спросит его через агент GNOME Shell.

#pragma once

#include <QHash>
#include <QObject>
#include <QQmlEngine>
#include <QTimer>
#include <QVariantList>
#include <QVariantMap>

class Network : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(bool available READ available NOTIFY changed)
    Q_PROPERTY(bool wifiEnabled READ wifiEnabled WRITE setWifiEnabled NOTIFY changed)
    Q_PROPERTY(bool wifiHardwareEnabled READ wifiHardwareEnabled NOTIFY changed)
    // [{path, kind: "wifi"|"ethernet", interface, name, state, connected,
    //   connecting, connection, address, autoconnect, available}]
    Q_PROPERTY(QVariantList devices READ devices NOTIFY changed)
    // [{path, name, type, active, activating}] — VPN и WireGuard.
    Q_PROPERTY(QVariantList vpns READ vpns NOTIFY changed)

public:
    static Network *create(QQmlEngine *, QJSEngine *);

    bool available() const { return m_available; }
    bool wifiEnabled() const { return m_wifiEnabled; }
    bool wifiHardwareEnabled() const { return m_wifiHardware; }
    void setWifiEnabled(bool enabled);
    QVariantList devices() const { return m_devices; }
    QVariantList vpns() const { return m_vpns; }

    // Сети, которые видит адаптер: [{ssid, strength, secure, enterprise,
    // known, active, frequency}], сначала подключённая, потом по силе сигнала.
    Q_INVOKABLE QVariantList networks(const QString &device) const;
    Q_INVOKABLE void scan(const QString &device);
    // Подключиться: к сохранённой сети — с её настройками, к новой — с
    // паролем password (пустой у открытых сетей). hidden — скрытая сеть,
    // которой нет в списке.
    Q_INVOKABLE void connectTo(const QString &device, const QString &ssid, const QString &password,
                               bool hidden = false);
    Q_INVOKABLE void disconnectDevice(const QString &device);
    // Адаптер включён: сам подключается к знакомым сетям. Выключенный
    // отключается и ждёт, пока его включат.
    Q_INVOKABLE void setDeviceEnabled(const QString &device, bool enabled);
    // Ethernet: подключить заново (после «Отключить»).
    Q_INVOKABLE void activateDevice(const QString &device);
    Q_INVOKABLE void forget(const QString &ssid);
    Q_INVOKABLE void setVpnActive(const QString &connection, bool active);

Q_SIGNALS:
    void changed();
    void failed(const QString &message);

private Q_SLOTS:
    void scheduleRefresh();
    void connectionsChanged();
    void refresh();

private:
    explicit Network(QObject *parent = nullptr);

    struct AccessPoint {
        QString path;
        QByteArray ssid;
        int strength = 0;
        uint frequency = 0;
        bool secure = false;
        bool enterprise = false;
    };
    struct Device {
        QString path, interface, product, vendor, driver;
        QString kind;
        uint state = 0;
        bool autoconnect = true;
        QString activeConnection;
        QString activeAccessPoint;
        QString ip4Config;
        QStringList accessPoints;
    };
    struct Saved {
        QString path, id, type, uuid;
        QByteArray ssid;
    };

    void readConnections();
    bool call(const QString &path, const QString &interface, const QString &method, const QVariantList &args,
              QVariantList *out = nullptr);
    QString savedFor(const QByteArray &ssid) const;
    QString deviceName(const Device &device) const;

    bool m_available = false;
    bool m_wifiEnabled = false;
    bool m_wifiHardware = true;
    QTimer m_timer;
    QHash<QString, Device> m_rawDevices;
    QHash<QString, AccessPoint> m_aps;
    QHash<QString, QVariantMap> m_active; // путь активного подключения → свойства
    QHash<QString, QStringList> m_ip4;     // путь Ip4Config → адреса
    QList<Saved> m_saved;
    QVariantList m_devices;
    QVariantList m_vpns;
};
