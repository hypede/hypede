// Системные сведения и переключатели, которым не нужен целый модуль KDE:
// профили питания, Wi-Fi, синхронизация времени, версии компонентов,
// список обоев. Всё — через стандартные службы D-Bus freedesktop, поэтому
// работает в любом сеансе.

#pragma once

#include <QObject>
#include <QQmlEngine>
#include <QStringList>
#include <QUrl>
#include <QVariantMap>

class System : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(QString appVersion READ appVersion CONSTANT)
    Q_PROPERTY(QString osName READ osName CONSTANT)
    Q_PROPERTY(QString osLogo READ osLogo CONSTANT)
    Q_PROPERTY(QString kernel READ kernel CONSTANT)
    Q_PROPERTY(QString hostname READ hostname CONSTANT)
    Q_PROPERTY(QString qtVersion READ qtVersion CONSTANT)
    Q_PROPERTY(QString kfVersion READ kfVersion CONSTANT)
    Q_PROPERTY(QString shellVersion READ shellVersion NOTIFY shellVersionChanged)

    Q_PROPERTY(bool powerProfilesAvailable READ powerProfilesAvailable NOTIFY powerChanged)
    Q_PROPERTY(QStringList powerProfiles READ powerProfiles NOTIFY powerChanged)
    Q_PROPERTY(QString powerProfile READ powerProfile WRITE setPowerProfile NOTIFY powerChanged)

    Q_PROPERTY(bool wifiAvailable READ wifiAvailable NOTIFY wifiChanged)
    Q_PROPERTY(bool wifiEnabled READ wifiEnabled WRITE setWifiEnabled NOTIFY wifiChanged)

    Q_PROPERTY(bool inHypeDE READ inHypeDE CONSTANT)
    Q_PROPERTY(QString language READ language WRITE setLanguage NOTIFY languageChanged)

    Q_PROPERTY(QString timezone READ timezone NOTIFY timeChanged)
    Q_PROPERTY(bool ntpAvailable READ ntpAvailable NOTIFY timeChanged)
    Q_PROPERTY(bool ntp READ ntp WRITE setNtp NOTIFY timeChanged)

public:
    static System *create(QQmlEngine *, QJSEngine *);
    static System *instance();

    // Символьный значок из темы HypeDE (Material Symbols) — файл, если он
    // есть, иначе имя для обычной темы значков.
    Q_INVOKABLE QString iconSource(const QString &name) const;

    QString appVersion() const;
    QString osName() const;
    QString osLogo() const;
    QString kernel() const;
    QString hostname() const;
    QString qtVersion() const;
    QString kfVersion() const;
    QString shellVersion() const { return m_shellVersion; }

    bool powerProfilesAvailable() const { return !m_powerService.isEmpty(); }
    QStringList powerProfiles() const { return m_powerProfiles; }
    QString powerProfile() const { return m_powerProfile; }
    void setPowerProfile(const QString &profile);

    bool wifiAvailable() const { return m_wifiAvailable; }
    bool wifiEnabled() const { return m_wifiEnabled; }
    void setWifiEnabled(bool enabled);

    QString timezone() const { return m_timezone; }
    bool ntpAvailable() const { return m_ntpAvailable; }
    bool ntp() const { return m_ntp; }
    void setNtp(bool enabled);

    Q_INVOKABLE bool hasProgram(const QString &name) const;
    Q_INVOKABLE bool run(const QStringList &argv) const;
    // Запустить и дождаться: {ok, out, err}. Для коротких команд (hypede-theme).
    Q_INVOKABLE QVariantMap runSync(const QStringList &argv) const;
    // Без ожидания: результат придёт сигналом processFinished с тем же tag.
    Q_INVOKABLE void runAsync(const QStringList &argv, const QString &tag);
    Q_INVOKABLE bool openUrl(const QString &url) const;
    Q_INVOKABLE QStringList wallpapers() const;
    // Файл из данных HypeDE (/usr/share/hypede/…) как адрес file://, если есть.
    Q_INVOKABLE QString dataUrl(const QString &relative) const;
    Q_INVOKABLE bool clearRecentFiles() const;
    Q_INVOKABLE QStringList locales() const;
    Q_INVOKABLE QString localeName(const QString &code) const;
    Q_INVOKABLE QString formatSample(const QString &code) const;

    // Оформление: что установлено в системе.
    Q_INVOKABLE QStringList fontFamilies() const;
    Q_INVOKABLE QStringList iconThemes() const;
    Q_INVOKABLE QStringList cursorThemes() const;
    Q_INVOKABLE QStringList soundThemes() const;
    Q_INVOKABLE QStringList plymouthThemes() const;
    Q_INVOKABLE QString plymouthTheme() const;
    Q_INVOKABLE QString displayManager() const;
    Q_INVOKABLE QString autologinUser() const;
    Q_INVOKABLE QString userName() const;
    Q_INVOKABLE void admin(const QStringList &args);
    Q_INVOKABLE QStringList gtkThemes() const;

    // Хранилище: [{name, path, total, free}]
    Q_INVOKABLE QVariantList storage() const;
    Q_INVOKABLE QString formatSize(qint64 bytes) const;
    Q_INVOKABLE bool emptyTrash() const;

    // Приложения и автозапуск: [{id, name, icon, comment, system}]
    Q_INVOKABLE QVariantList installedApps() const;
    Q_INVOKABLE QVariantList autostartEntries() const;

    // Язык интерфейса (AccountsService) — применяется при следующем входе.
    QString language() const { return m_language; }
    void setLanguage(const QString &language);

    // Конфигурация HypeDE: своя база dconf (~/.config/dconf/hypede).
    bool inHypeDE() const;
    Q_INVOKABLE bool importFromGnome() const;
    Q_INVOKABLE bool exportConfig(const QUrl &file) const;
    Q_INVOKABLE bool importConfig(const QUrl &file) const;
    Q_INVOKABLE bool resetConfig() const;
    Q_INVOKABLE QString defaultExportPath() const;

Q_SIGNALS:
    void shellVersionChanged();
    void adminFinished(const QString &action, bool ok);
    void processFinished(const QString &tag, bool ok, const QString &out, const QString &err);
    void powerChanged();
    void wifiChanged();
    void timeChanged();
    void languageChanged();

private Q_SLOTS:
    void onPropertiesChanged(const QString &interface, const QVariantMap &changed, const QStringList &invalidated);

private:
    explicit System(QObject *parent = nullptr);
    void readPower();
    void readWifi();
    void readTime();
    void readShellVersion();
    void readLanguage();

    QString m_shellVersion;
    QString m_powerService;
    QString m_powerPath;
    QStringList m_powerProfiles;
    QString m_powerProfile;
    bool m_wifiAvailable = false;
    bool m_wifiEnabled = false;
    QString m_timezone;
    bool m_ntpAvailable = false;
    bool m_ntp = false;
    QString m_userPath;
    QString m_language;
};
