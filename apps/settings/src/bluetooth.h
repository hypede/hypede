// Bluetooth через BlueZ (D-Bus): все адаптеры по отдельности (включение,
// имя, видимость), устройства выбранного адаптера, поиск, сопряжение,
// подключение и удаление. Пока окно открыто, «Настройки» — агент
// сопряжения: показывают код для сверки и спрашивают PIN.

#pragma once

#include <QDBusContext>
#include <QDBusMessage>
#include <QDBusObjectPath>
#include <QObject>
#include <QQmlEngine>
#include <QTimer>
#include <QVariantList>
#include <QVariantMap>

#include <functional>

class Bluetooth;

// org.bluez.Agent1. Вопросы, которые ждут человека, отвечаются позже —
// через Bluetooth::answer().
class BluetoothAgent : public QObject, protected QDBusContext
{
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "org.bluez.Agent1")

public:
    explicit BluetoothAgent(Bluetooth *owner);
    void answer(bool accept, const QString &value);

public Q_SLOTS:
    Q_NOREPLY void Release();
    QString RequestPinCode(const QDBusObjectPath &device);
    void DisplayPinCode(const QDBusObjectPath &device, const QString &pincode);
    uint RequestPasskey(const QDBusObjectPath &device);
    void DisplayPasskey(const QDBusObjectPath &device, uint passkey, ushort entered);
    void RequestConfirmation(const QDBusObjectPath &device, uint passkey);
    void RequestAuthorization(const QDBusObjectPath &device);
    void AuthorizeService(const QDBusObjectPath &device, const QString &uuid);
    Q_NOREPLY void Cancel();

private:
    void ask(const QString &kind, const QDBusObjectPath &device, const QString &code);

    Bluetooth *m_owner;
    QDBusMessage m_pending;
    QString m_kind;
};

class Bluetooth : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(bool available READ available NOTIFY changed)
    // [{path, name, address, powered, discoverable, discovering}]
    Q_PROPERTY(QVariantList adapters READ adapters NOTIFY changed)
    Q_PROPERTY(QString adapter READ adapter WRITE setAdapter NOTIFY changed)
    // Устройства выбранного адаптера: [{path, name, address, icon, paired,
    // connected, trusted, battery, rssi}].
    Q_PROPERTY(QVariantList devices READ devices NOTIFY changed)
    // Вопрос агента, на который ждут ответ: {kind: "confirm"|"pin"|
    // "passkey"|"display"|"authorize", device, code} или пусто.
    Q_PROPERTY(QVariantMap request READ request NOTIFY requestChanged)

public:
    static Bluetooth *create(QQmlEngine *, QJSEngine *);

    bool available() const { return !m_adapters.isEmpty(); }
    QVariantList adapters() const { return m_adapterList; }
    QString adapter() const { return m_adapter; }
    void setAdapter(const QString &path);
    QVariantList devices() const { return m_deviceList; }
    QVariantMap request() const { return m_request; }

    Q_INVOKABLE void setPowered(const QString &adapter, bool powered);
    Q_INVOKABLE void setDiscoverable(const QString &adapter, bool discoverable);
    Q_INVOKABLE void setAlias(const QString &adapter, const QString &alias);
    // Поиск идёт, пока страница открыта: QML включает и выключает его.
    Q_INVOKABLE void setDiscovery(bool on);
    Q_INVOKABLE void pair(const QString &device);
    Q_INVOKABLE void connectDevice(const QString &device);
    Q_INVOKABLE void disconnectDevice(const QString &device);
    Q_INVOKABLE void remove(const QString &device);
    Q_INVOKABLE void answer(bool accept, const QString &value = QString());

    // Для агента.
    QString deviceName(const QString &path) const;
    void setRequest(const QVariantMap &request);

Q_SIGNALS:
    void changed();
    void requestChanged();
    void failed(const QString &message);

private Q_SLOTS:
    void scheduleRefresh();
    void refresh();

private:
    explicit Bluetooth(QObject *parent = nullptr);
    void setBluezProperty(const QString &path, const QString &interface, const QString &name, const QVariant &value);
    void call(const QString &path, const QString &interface, const QString &method, const QVariantList &args = {},
              const std::function<void()> &done = nullptr);
    void registerAgent();
    void updateDiscovery();

    QTimer m_timer;
    QMap<QString, QVariantMap> m_adapters; // путь → свойства Adapter1
    QMap<QString, QVariantMap> m_devices;  // путь → свойства Device1 (+ Battery)
    QVariantList m_adapterList;
    QVariantList m_deviceList;
    QString m_adapter;
    QVariantMap m_request;
    BluetoothAgent *m_agent = nullptr;
    bool m_discoveryWanted = false;
    QString m_discoveringOn;
};
