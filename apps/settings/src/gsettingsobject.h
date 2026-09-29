// Мост между QML и GSettings.
//
// Настройки GNOME (тема, обои, мышь, блокировка…) меняются напрямую через
// GSettings — так же, как это делает gnome-control-center, поэтому
// оболочка и приложения подхватывают изменения мгновенно.
//
//   const s = GSettingsHub.schema("org.gnome.desktop.interface")
//   s.valid, s.value("color-scheme"), s.setValue("color-scheme", "prefer-dark")
//   s.revision — растёт при каждом изменении, на него удобно ставить привязки.

#pragma once

#include <QHash>
#include <QObject>
#include <QQmlEngine>
#include <QVariant>

typedef struct _GSettings GSettings;
typedef struct _GSettingsSchema GSettingsSchema;

class GSettingsObject : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_UNCREATABLE("Use GSettingsHub.schema()")
    Q_PROPERTY(bool valid READ valid CONSTANT)
    Q_PROPERTY(QString schemaId READ schemaId CONSTANT)
    Q_PROPERTY(int revision READ revision NOTIFY revisionChanged)

public:
    // path — для перемещаемых схем (например, настройки уведомлений
    // отдельного приложения), для обычных схем пусто.
    explicit GSettingsObject(const QString &schemaId, const QString &path = QString(), QObject *parent = nullptr);
    ~GSettingsObject() override;

    bool valid() const { return m_settings != nullptr; }
    QString schemaId() const { return m_schemaId; }
    int revision() const { return m_revision; }

    Q_INVOKABLE bool hasKey(const QString &key) const;
    Q_INVOKABLE QVariant value(const QString &key) const;
    Q_INVOKABLE bool setValue(const QString &key, const QVariant &value);
    Q_INVOKABLE void reset(const QString &key);
    // Для ключей-перечислений: допустимые значения.
    Q_INVOKABLE QStringList choices(const QString &key) const;
    // Раскладки клавиатуры (a(ss)) в виде «xkb:us», «ibus:anthy».
    Q_INVOKABLE QStringList tuples(const QString &key) const;
    Q_INVOKABLE bool setTuples(const QString &key, const QStringList &items);

Q_SIGNALS:
    void revisionChanged();
    void changed(const QString &key);

private:
    static void onChanged(GSettings *settings, const char *key, void *self);

    QString m_schemaId;
    GSettings *m_settings = nullptr;
    GSettingsSchema *m_schema = nullptr;
    int m_revision = 0;
};

class GSettingsHub : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

public:
    static GSettingsHub *create(QQmlEngine *, QJSEngine *);
    static GSettingsHub *instance();

    Q_INVOKABLE GSettingsObject *schema(const QString &schemaId);
    Q_INVOKABLE GSettingsObject *schemaAt(const QString &schemaId, const QString &path);
    Q_INVOKABLE bool hasSchema(const QString &schemaId) const;

private:
    explicit GSettingsHub(QObject *parent = nullptr);
    QHash<QString, GSettingsObject *> m_cache;
};
