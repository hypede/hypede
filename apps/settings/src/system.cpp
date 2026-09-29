#include "system.h"

#include <kcoreaddons_version.h>

#include <QDBusArgument>
#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusObjectPath>
#include <QDBusReply>
#include <QDBusVariant>
#include <QDesktopServices>
#include <QDir>
#include <QFile>
#include <QLocale>
#include <QProcess>
#include <QDateTime>
#include <QDirIterator>
#include <QFileInfo>
#include <QFontDatabase>
#include <QProcessEnvironment>
#include <QStorageInfo>
#include <QSet>
#include <QTimeZone>
#include <QStandardPaths>
#include <QSysInfo>
#include <QUrl>

#include <functional>
#include <unistd.h>

namespace
{

const QString kProperties = QStringLiteral("org.freedesktop.DBus.Properties");

QVariant dbusGet(const QDBusConnection &bus, const QString &service, const QString &path,
                     const QString &interface, const QString &name)
{
    QDBusMessage message = QDBusMessage::createMethodCall(service, path, kProperties, QStringLiteral("Get"));
    message << interface << name;
    const QDBusMessage reply = bus.call(message, QDBus::Block, 1500);
    if (reply.type() != QDBusMessage::ReplyMessage || reply.arguments().isEmpty())
        return {};
    return reply.arguments().constFirst().value<QDBusVariant>().variant();
}

void dbusSet(const QDBusConnection &bus, const QString &service, const QString &path,
                 const QString &interface, const QString &name, const QVariant &value)
{
    QDBusMessage message = QDBusMessage::createMethodCall(service, path, kProperties, QStringLiteral("Set"));
    message << interface << name << QVariant::fromValue(QDBusVariant(value));
    // Разрешение (polkit) может спросить пароль — не блокируем интерфейс.
    message.setInteractiveAuthorizationAllowed(true);
    bus.asyncCall(message);
}

QMap<QString, QString> readOsRelease()
{
    QMap<QString, QString> result;
    for (const QString &path : {QStringLiteral("/etc/os-release"), QStringLiteral("/usr/lib/os-release")}) {
        QFile file(path);
        if (!file.open(QIODevice::ReadOnly | QIODevice::Text))
            continue;
        while (!file.atEnd()) {
            const QString line = QString::fromUtf8(file.readLine()).trimmed();
            const int eq = line.indexOf(QLatin1Char('='));
            if (eq <= 0)
                continue;
            QString value = line.mid(eq + 1);
            if (value.startsWith(QLatin1Char('"')) && value.endsWith(QLatin1Char('"')) && value.size() >= 2)
                value = value.mid(1, value.size() - 2);
            result.insert(line.left(eq), value);
        }
        break;
    }
    return result;
}

const QString kPowerIface = QStringLiteral("org.freedesktop.UPower.PowerProfiles");
const QString kPowerIfaceLegacy = QStringLiteral("net.hadess.PowerProfiles");
const QString kNm = QStringLiteral("org.freedesktop.NetworkManager");
const QString kNmPath = QStringLiteral("/org/freedesktop/NetworkManager");
const QString kTimedate = QStringLiteral("org.freedesktop.timedate1");
const QString kTimedatePath = QStringLiteral("/org/freedesktop/timedate1");

} // namespace

System::System(QObject *parent)
    : QObject(parent)
{
    readPower();
    readWifi();
    readTime();
    readShellVersion();
    readLanguage();
}

System *System::instance()
{
    static System *system = new System();
    return system;
}

System *System::create(QQmlEngine *, QJSEngine *)
{
    auto *system = instance();
    QQmlEngine::setObjectOwnership(system, QQmlEngine::CppOwnership);
    return system;
}

QString System::appVersion() const
{
    return QStringLiteral(HYPEDE_VERSION);
}

QString System::osName() const
{
    const auto release = readOsRelease();
    return release.value(QStringLiteral("PRETTY_NAME"), QSysInfo::prettyProductName());
}

QString System::osLogo() const
{
    return readOsRelease().value(QStringLiteral("LOGO"), QStringLiteral("distributor-logo"));
}

QString System::kernel() const
{
    return QSysInfo::kernelVersion();
}

QString System::hostname() const
{
    return QSysInfo::machineHostName();
}

QString System::qtVersion() const
{
    return QString::fromLatin1(qVersion());
}

QString System::kfVersion() const
{
    return QStringLiteral(KCOREADDONS_VERSION_STRING);
}

void System::readShellVersion()
{
    const QVariant version = dbusGet(QDBusConnection::sessionBus(), QStringLiteral("org.gnome.Shell"),
                                         QStringLiteral("/org/gnome/Shell"), QStringLiteral("org.gnome.Shell"),
                                         QStringLiteral("ShellVersion"));
    m_shellVersion = version.toString();
}

// ---------- питание ----------

void System::readPower()
{
    QDBusConnection bus = QDBusConnection::systemBus();
    struct Candidate {
        QString service, path, iface;
    };
    const Candidate candidates[] = {
        {kPowerIface, QStringLiteral("/org/freedesktop/UPower/PowerProfiles"), kPowerIface},
        {kPowerIfaceLegacy, QStringLiteral("/net/hadess/PowerProfiles"), kPowerIfaceLegacy},
    };
    for (const auto &candidate : candidates) {
        const QVariant active = dbusGet(bus, candidate.service, candidate.path, candidate.iface,
                                            QStringLiteral("ActiveProfile"));
        if (!active.isValid())
            continue;
        const bool first = m_powerService.isEmpty();
        m_powerService = candidate.service;
        m_powerPath = candidate.path;
        m_powerProfile = active.toString();
        m_powerProfiles.clear();
        const QVariant profiles = dbusGet(bus, candidate.service, candidate.path, candidate.iface,
                                              QStringLiteral("Profiles"));
        const QDBusArgument argument = profiles.value<QDBusArgument>();
        argument.beginArray();
        while (!argument.atEnd()) {
            QVariantMap map;
            argument >> map;
            m_powerProfiles << map.value(QStringLiteral("Profile")).toString();
        }
        argument.endArray();
        if (first) {
            QDBusConnection::systemBus().connect(m_powerService, m_powerPath, kProperties,
                                                 QStringLiteral("PropertiesChanged"), this,
                                                 SLOT(onPropertiesChanged(QString, QVariantMap, QStringList)));
        }
        break;
    }
    Q_EMIT powerChanged();
}

void System::setPowerProfile(const QString &profile)
{
    if (m_powerService.isEmpty() || profile == m_powerProfile)
        return;
    dbusSet(QDBusConnection::systemBus(), m_powerService, m_powerPath, m_powerService,
                QStringLiteral("ActiveProfile"), profile);
    m_powerProfile = profile;
    Q_EMIT powerChanged();
}

// ---------- Wi-Fi ----------

void System::readWifi()
{
    QDBusConnection bus = QDBusConnection::systemBus();
    const QVariant enabled = dbusGet(bus, kNm, kNmPath, kNm, QStringLiteral("WirelessEnabled"));
    const bool wasAvailable = m_wifiAvailable;
    m_wifiAvailable = enabled.isValid() &&
        dbusGet(bus, kNm, kNmPath, kNm, QStringLiteral("WirelessHardwareEnabled")).toBool();
    m_wifiEnabled = enabled.toBool();
    if (enabled.isValid() && !wasAvailable) {
        bus.connect(kNm, kNmPath, kProperties, QStringLiteral("PropertiesChanged"), this,
                    SLOT(onPropertiesChanged(QString, QVariantMap, QStringList)));
    }
    Q_EMIT wifiChanged();
}

void System::setWifiEnabled(bool enabled)
{
    if (!m_wifiAvailable || enabled == m_wifiEnabled)
        return;
    dbusSet(QDBusConnection::systemBus(), kNm, kNmPath, kNm, QStringLiteral("WirelessEnabled"), enabled);
    m_wifiEnabled = enabled;
    Q_EMIT wifiChanged();
}

// ---------- время ----------

void System::readTime()
{
    QDBusConnection bus = QDBusConnection::systemBus();
    const QVariant zone = dbusGet(bus, kTimedate, kTimedatePath, kTimedate, QStringLiteral("Timezone"));
    m_timezone = zone.isValid() ? zone.toString() : QString::fromUtf8(QTimeZone::systemTimeZoneId());
    const QVariant canNtp = dbusGet(bus, kTimedate, kTimedatePath, kTimedate, QStringLiteral("CanNTP"));
    m_ntpAvailable = canNtp.toBool();
    m_ntp = dbusGet(bus, kTimedate, kTimedatePath, kTimedate, QStringLiteral("NTP")).toBool();
    if (zone.isValid()) {
        bus.connect(kTimedate, kTimedatePath, kProperties, QStringLiteral("PropertiesChanged"), this,
                    SLOT(onPropertiesChanged(QString, QVariantMap, QStringList)));
    }
    Q_EMIT timeChanged();
}

void System::setNtp(bool enabled)
{
    if (!m_ntpAvailable || enabled == m_ntp)
        return;
    QDBusMessage message = QDBusMessage::createMethodCall(kTimedate, kTimedatePath, kTimedate,
                                                          QStringLiteral("SetNTP"));
    message << enabled << true;
    message.setInteractiveAuthorizationAllowed(true);
    QDBusConnection::systemBus().asyncCall(message);
    m_ntp = enabled;
    Q_EMIT timeChanged();
}

void System::onPropertiesChanged(const QString &interface, const QVariantMap &changed, const QStringList &)
{
    if (interface == kPowerIface || interface == kPowerIfaceLegacy) {
        if (changed.contains(QStringLiteral("ActiveProfile"))) {
            m_powerProfile = changed.value(QStringLiteral("ActiveProfile")).toString();
            Q_EMIT powerChanged();
        }
    } else if (interface == kNm) {
        if (changed.contains(QStringLiteral("WirelessEnabled"))) {
            m_wifiEnabled = changed.value(QStringLiteral("WirelessEnabled")).toBool();
            Q_EMIT wifiChanged();
        }
    } else if (interface == kTimedate) {
        if (changed.contains(QStringLiteral("NTP")))
            m_ntp = changed.value(QStringLiteral("NTP")).toBool();
        if (changed.contains(QStringLiteral("Timezone")))
            m_timezone = changed.value(QStringLiteral("Timezone")).toString();
        Q_EMIT timeChanged();
    }
}

// ---------- разное ----------

bool System::hasProgram(const QString &name) const
{
    return !QStandardPaths::findExecutable(name).isEmpty();
}

bool System::run(const QStringList &argv) const
{
    if (argv.isEmpty())
        return false;
    return QProcess::startDetached(argv.constFirst(), argv.mid(1));
}

bool System::openUrl(const QString &url) const
{
    return QDesktopServices::openUrl(QUrl(url));
}

QStringList System::wallpapers() const
{
    QStringList dirs;
    dirs << QStringLiteral(HYPEDE_DATADIR "/wallpapers");
    for (const QString &base : QStandardPaths::standardLocations(QStandardPaths::GenericDataLocation))
        dirs << base + QStringLiteral("/backgrounds") << base + QStringLiteral("/hypede/wallpapers");
    const QByteArray devDir = qgetenv("HYPEDE_WALLPAPER_DIR");
    if (!devDir.isEmpty())
        dirs.prepend(QString::fromLocal8Bit(devDir));

    const QStringList filters = {QStringLiteral("*.png"), QStringLiteral("*.jpg"), QStringLiteral("*.jpeg"),
                                 QStringLiteral("*.webp"), QStringLiteral("*.svg"), QStringLiteral("*.jxl")};
    QStringList result;
    QSet<QString> seen;
    auto scan = [&](const QString &path, int depth, auto &&self) -> void {
        QDir dir(path);
        if (!dir.exists())
            return;
        for (const QFileInfo &info : dir.entryInfoList(filters, QDir::Files, QDir::Name)) {
            const QString canonical = info.canonicalFilePath();
            // У обоев HypeDE есть PNG-копии SVG — показываем что-то одно.
            const QString twin = info.path() + QLatin1Char('/') + info.completeBaseName() + QStringLiteral(".svg");
            if (info.suffix() != QLatin1String("svg") && QFile::exists(twin))
                continue;
            if (!seen.contains(canonical)) {
                seen.insert(canonical);
                result << info.absoluteFilePath();
            }
        }
        if (depth > 0) {
            for (const QString &sub : dir.entryList(QDir::Dirs | QDir::NoDotAndDotDot, QDir::Name))
                self(dir.filePath(sub), depth - 1, self);
        }
    };
    for (const QString &dir : dirs)
        scan(dir, 1, scan);
    return result;
}

bool System::clearRecentFiles() const
{
    const QString path = QStandardPaths::writableLocation(QStandardPaths::GenericDataLocation)
        + QStringLiteral("/recently-used.xbel");
    QFile file(path);
    if (!file.open(QIODevice::WriteOnly | QIODevice::Truncate))
        return false;
    file.write("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
               "<xbel version=\"1.0\" xmlns:bookmark=\"http://www.freedesktop.org/standards/desktop-bookmarks\" "
               "xmlns:mime=\"http://www.freedesktop.org/standards/shared-mime-info\"></xbel>\n");
    return true;
}

QStringList System::locales() const
{
    QProcess process;
    process.start(QStringLiteral("locale"), {QStringLiteral("-a")});
    process.waitForFinished(2000);
    QStringList result;
    const QStringList lines = QString::fromLocal8Bit(process.readAllStandardOutput()).split(QLatin1Char('\n'));
    for (QString line : lines) {
        line = line.trimmed();
        if (line.isEmpty() || line == QLatin1String("C") || line == QLatin1String("POSIX") ||
            line.startsWith(QLatin1String("C.")))
            continue;
        // ru_RU.utf8 → ru_RU.UTF-8, как пишет GNOME
        const int dot = line.indexOf(QLatin1Char('.'));
        const QString base = dot > 0 ? line.left(dot) : line;
        const QString normalized = base + QStringLiteral(".UTF-8");
        if (!result.contains(normalized))
            result << normalized;
    }
    std::sort(result.begin(), result.end());
    return result;
}

QString System::localeName(const QString &code) const
{
    const QLocale locale(code.section(QLatin1Char('.'), 0, 0));
    QString language = locale.nativeLanguageName();
    if (!language.isEmpty())
        language[0] = language[0].toUpper();
    const QString territory = locale.nativeTerritoryName();
    return territory.isEmpty() ? language : QStringLiteral("%1 (%2)").arg(language, territory);
}

QString System::formatSample(const QString &code) const
{
    const QLocale locale(code.section(QLatin1Char('.'), 0, 0));
    const QDateTime now = QDateTime::currentDateTime();
    return QStringLiteral("%1 · %2 · %3").arg(locale.toString(now.date(), QLocale::ShortFormat),
                                             locale.toString(now.time(), QLocale::ShortFormat),
                                             locale.toString(1234567.89, 'f', 2));
}

// ---------- оформление ----------

namespace
{

QStringList dataDirs()
{
    QStringList dirs;
    dirs << QDir::homePath() + QStringLiteral("/.icons");
    for (const QString &base : QStandardPaths::standardLocations(QStandardPaths::GenericDataLocation))
        dirs << base;
    return dirs;
}

// Тема значков — каталог с index.theme, у которого есть не только курсоры.
QStringList scanThemes(const QString &subdir, const std::function<bool(const QDir &)> &accept)
{
    QStringList result;
    for (const QString &base : dataDirs()) {
        const QString root = base.endsWith(QLatin1String("/.icons")) ? base : base + QLatin1Char('/') + subdir;
        QDir dir(root);
        for (const QString &name : dir.entryList(QDir::Dirs | QDir::NoDotAndDotDot, QDir::Name)) {
            if (result.contains(name) || name == QLatin1String("default") || name == QLatin1String("hicolor"))
                continue;
            if (accept(QDir(dir.filePath(name))))
                result << name;
        }
    }
    std::sort(result.begin(), result.end(), [](const QString &a, const QString &b) {
        return a.compare(b, Qt::CaseInsensitive) < 0;
    });
    return result;
}

} // namespace

QStringList System::fontFamilies() const
{
    QStringList families = QFontDatabase::families();
    families.removeDuplicates();
    // Служебные шрифты с точкой в начале имени не показываем.
    families.erase(std::remove_if(families.begin(), families.end(), [](const QString &f) {
                       return f.startsWith(QLatin1Char('.'));
                   }),
                   families.end());
    return families;
}

QStringList System::iconThemes() const
{
    return scanThemes(QStringLiteral("icons"), [](const QDir &dir) {
        if (!dir.exists(QStringLiteral("index.theme")))
            return false;
        const QStringList subdirs = dir.entryList(QDir::Dirs | QDir::NoDotAndDotDot);
        return !(subdirs.size() == 1 && subdirs.constFirst() == QLatin1String("cursors"));
    });
}

QStringList System::cursorThemes() const
{
    return scanThemes(QStringLiteral("icons"), [](const QDir &dir) {
        return dir.exists(QStringLiteral("cursors"));
    });
}

QStringList System::gtkThemes() const
{
    QStringList themes = scanThemes(QStringLiteral("themes"), [](const QDir &dir) {
        return dir.exists(QStringLiteral("gtk-3.0"));
    });
    // Adwaita и HighContrast встроены в GTK 3 и каталога не имеют.
    for (const QString &builtin : {QStringLiteral("HighContrast"), QStringLiteral("Adwaita")}) {
        if (!themes.contains(builtin))
            themes.prepend(builtin);
    }
    return themes;
}

// ---------- хранилище ----------

QVariantList System::storage() const
{
    QVariantList result;
    QSet<QString> devices;
    const QStringList skipTypes = {QStringLiteral("tmpfs"), QStringLiteral("devtmpfs"), QStringLiteral("overlay"),
                                   QStringLiteral("squashfs"), QStringLiteral("efivarfs"), QStringLiteral("ramfs")};
    for (const QStorageInfo &volume : QStorageInfo::mountedVolumes()) {
        if (!volume.isValid() || !volume.isReady() || volume.bytesTotal() <= 0)
            continue;
        if (skipTypes.contains(QString::fromLatin1(volume.fileSystemType())))
            continue;
        const QString root = volume.rootPath();
        if (root.startsWith(QLatin1String("/boot")) || root.startsWith(QLatin1String("/snap")) ||
            root.startsWith(QLatin1String("/var/lib")) || root.startsWith(QLatin1String("/efi")))
            continue;
        const QString device = QString::fromLocal8Bit(volume.device());
        if (devices.contains(device))
            continue;
        devices.insert(device);
        QString name = volume.displayName();
        if (root == QLatin1String("/"))
            name = tr("System");
        else if (root == QDir::homePath() || root == QLatin1String("/home"))
            name = tr("Home");
        result << QVariantMap{
            {QStringLiteral("name"), name},
            {QStringLiteral("path"), root},
            {QStringLiteral("total"), volume.bytesTotal()},
            {QStringLiteral("free"), volume.bytesAvailable()},
        };
    }
    return result;
}

QString System::formatSize(qint64 bytes) const
{
    return QLocale().formattedDataSize(bytes, 1, QLocale::DataSizeTraditionalFormat);
}

bool System::emptyTrash() const
{
    return QProcess::execute(QStringLiteral("gio"), {QStringLiteral("trash"), QStringLiteral("--empty")}) == 0;
}

// ---------- приложения и автозапуск ----------

namespace
{

// Простейший разбор .desktop: секция [Desktop Entry], имена с учётом языка.
QHash<QString, QString> readDesktopEntry(const QString &path)
{
    QHash<QString, QString> entry;
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly | QIODevice::Text))
        return entry;
    bool inSection = false;
    while (!file.atEnd()) {
        const QString line = QString::fromUtf8(file.readLine()).trimmed();
        if (line.startsWith(QLatin1Char('['))) {
            inSection = line == QLatin1String("[Desktop Entry]");
            continue;
        }
        if (!inSection || line.startsWith(QLatin1Char('#')))
            continue;
        const int eq = line.indexOf(QLatin1Char('='));
        if (eq > 0)
            entry.insert(line.left(eq).trimmed(), line.mid(eq + 1).trimmed());
    }
    return entry;
}

QString localized(const QHash<QString, QString> &entry, const QString &key)
{
    const QLocale locale;
    const QString full = locale.name();                     // ru_RU
    const QString lang = full.section(QLatin1Char('_'), 0, 0); // ru
    for (const QString &variant : {full, lang}) {
        const QString value = entry.value(QStringLiteral("%1[%2]").arg(key, variant));
        if (!value.isEmpty())
            return value;
    }
    return entry.value(key);
}

bool shownInHypeDE(const QHash<QString, QString> &entry)
{
    const QStringList desktops = {QStringLiteral("HypeDE"), QStringLiteral("GNOME")};
    const QString only = entry.value(QStringLiteral("OnlyShowIn"));
    if (!only.isEmpty()) {
        const QStringList list = only.split(QLatin1Char(';'), Qt::SkipEmptyParts);
        if (std::none_of(desktops.begin(), desktops.end(), [&](const QString &d) { return list.contains(d); }))
            return false;
    }
    const QStringList notIn = entry.value(QStringLiteral("NotShowIn")).split(QLatin1Char(';'), Qt::SkipEmptyParts);
    return std::none_of(desktops.begin(), desktops.end(), [&](const QString &d) { return notIn.contains(d); });
}

} // namespace

QVariantList System::installedApps() const
{
    QVariantList result;
    QSet<QString> seen;
    for (const QString &base : QStandardPaths::standardLocations(QStandardPaths::ApplicationsLocation)) {
        QDirIterator it(base, {QStringLiteral("*.desktop")}, QDir::Files, QDirIterator::Subdirectories);
        while (it.hasNext()) {
            const QString path = it.next();
            // id: путь относительно каталога, «/» → «-» (как в спецификации)
            const QString id = QDir(base).relativeFilePath(path).replace(QLatin1Char('/'), QLatin1Char('-'));
            if (seen.contains(id))
                continue;
            seen.insert(id);
            const auto entry = readDesktopEntry(path);
            if (entry.value(QStringLiteral("Type")) != QLatin1String("Application") ||
                entry.value(QStringLiteral("NoDisplay")) == QLatin1String("true") ||
                entry.value(QStringLiteral("Hidden")) == QLatin1String("true") || !shownInHypeDE(entry))
                continue;
            result << QVariantMap{
                {QStringLiteral("id"), id},
                {QStringLiteral("name"), localized(entry, QStringLiteral("Name"))},
                {QStringLiteral("icon"), entry.value(QStringLiteral("Icon"))},
                {QStringLiteral("comment"), localized(entry, QStringLiteral("Comment"))},
            };
        }
    }
    std::sort(result.begin(), result.end(), [](const QVariant &a, const QVariant &b) {
        return a.toMap().value(QStringLiteral("name")).toString().compare(
                   b.toMap().value(QStringLiteral("name")).toString(), Qt::CaseInsensitive) < 0;
    });
    return result;
}

QVariantList System::autostartEntries() const
{
    // Пользовательский каталог важнее системных: одноимённый файл его
    // перекрывает (спецификация автозапуска XDG).
    QStringList dirs;
    dirs << QStandardPaths::writableLocation(QStandardPaths::GenericConfigLocation) + QStringLiteral("/autostart");
    const QString configDirs = qEnvironmentVariable("XDG_CONFIG_DIRS", QStringLiteral("/etc/xdg"));
    for (const QString &dir : configDirs.split(QLatin1Char(':'), Qt::SkipEmptyParts))
        dirs << dir + QStringLiteral("/autostart");

    QVariantList result;
    QSet<QString> seen;
    for (int i = 0; i < dirs.size(); ++i) {
        QDir dir(dirs.at(i));
        for (const QString &file : dir.entryList({QStringLiteral("*.desktop")}, QDir::Files, QDir::Name)) {
            const QString id = file.chopped(8);
            if (seen.contains(id))
                continue;
            seen.insert(id);
            const auto entry = readDesktopEntry(dir.filePath(file));
            if (entry.value(QStringLiteral("Hidden")) == QLatin1String("true") || !shownInHypeDE(entry))
                continue;
            if (entry.value(QStringLiteral("X-GNOME-Autostart-enabled")) == QLatin1String("false"))
                continue;
            // Службы, которые под systemd запускает не автозапуск, а юниты.
            if (entry.value(QStringLiteral("X-GNOME-HiddenUnderSystemd")) == QLatin1String("true"))
                continue;
            QString name = localized(entry, QStringLiteral("Name"));
            result << QVariantMap{
                {QStringLiteral("id"), id},
                {QStringLiteral("name"), name.isEmpty() ? id : name},
                {QStringLiteral("icon"), entry.value(QStringLiteral("Icon"))},
                {QStringLiteral("comment"), localized(entry, QStringLiteral("Comment"))},
                {QStringLiteral("system"), i > 0},
            };
        }
    }
    std::sort(result.begin(), result.end(), [](const QVariant &a, const QVariant &b) {
        return a.toMap().value(QStringLiteral("name")).toString().compare(
                   b.toMap().value(QStringLiteral("name")).toString(), Qt::CaseInsensitive) < 0;
    });
    return result;
}

// ---------- язык ----------

void System::readLanguage()
{
    QDBusConnection bus = QDBusConnection::systemBus();
    QDBusMessage message = QDBusMessage::createMethodCall(QStringLiteral("org.freedesktop.Accounts"),
                                                          QStringLiteral("/org/freedesktop/Accounts"),
                                                          QStringLiteral("org.freedesktop.Accounts"),
                                                          QStringLiteral("FindUserById"));
    message << qlonglong(getuid());
    const QDBusMessage reply = bus.call(message, QDBus::Block, 1500);
    if (reply.type() != QDBusMessage::ReplyMessage || reply.arguments().isEmpty())
        return;
    m_userPath = reply.arguments().constFirst().value<QDBusObjectPath>().path();
    m_language = dbusGet(bus, QStringLiteral("org.freedesktop.Accounts"), m_userPath,
                         QStringLiteral("org.freedesktop.Accounts.User"), QStringLiteral("Language"))
                     .toString();
    Q_EMIT languageChanged();
}

void System::setLanguage(const QString &language)
{
    if (m_userPath.isEmpty() || language == m_language)
        return;
    QDBusMessage message = QDBusMessage::createMethodCall(QStringLiteral("org.freedesktop.Accounts"), m_userPath,
                                                          QStringLiteral("org.freedesktop.Accounts.User"),
                                                          QStringLiteral("SetLanguage"));
    message << language;
    message.setInteractiveAuthorizationAllowed(true);
    QDBusConnection::systemBus().asyncCall(message);
    m_language = language;
    Q_EMIT languageChanged();
}

// ---------- конфигурация HypeDE ----------

namespace
{

// Запуск dconf с нужной базой: hypede или обычной базой GNOME.
bool runDconf(const QStringList &args, bool gnomeProfile, const QByteArray &input = {}, QByteArray *output = nullptr)
{
    QProcess process;
    QProcessEnvironment env = QProcessEnvironment::systemEnvironment();
    if (gnomeProfile)
        env.remove(QStringLiteral("DCONF_PROFILE"));
    else
        env.insert(QStringLiteral("DCONF_PROFILE"), QStringLiteral("hypede"));
    process.setProcessEnvironment(env);
    process.start(QStringLiteral("dconf"), args);
    if (!process.waitForStarted(2000))
        return false;
    if (!input.isEmpty())
        process.write(input);
    process.closeWriteChannel();
    process.waitForFinished(10000);
    if (output)
        *output = process.readAllStandardOutput();
    return process.exitStatus() == QProcess::NormalExit && process.exitCode() == 0;
}

} // namespace

bool System::inHypeDE() const
{
    return qEnvironmentVariable("DCONF_PROFILE") == QLatin1String("hypede");
}

bool System::importFromGnome() const
{
    // Тот же список, что переносит hypede-session при первом входе.
    const QStringList dirs = {
        QStringLiteral("/org/gnome/desktop/input-sources/"), QStringLiteral("/org/gnome/desktop/peripherals/"),
        QStringLiteral("/org/gnome/desktop/a11y/"), QStringLiteral("/org/gnome/desktop/calendar/"),
        QStringLiteral("/org/gnome/desktop/privacy/"), QStringLiteral("/org/gnome/desktop/notifications/"),
        QStringLiteral("/org/gnome/desktop/sound/"), QStringLiteral("/org/gnome/desktop/session/"),
        QStringLiteral("/org/gnome/desktop/wm/keybindings/"),
        QStringLiteral("/org/gnome/settings-daemon/plugins/media-keys/"),
        QStringLiteral("/org/gnome/settings-daemon/plugins/power/"),
        QStringLiteral("/org/gnome/settings-daemon/plugins/color/"), QStringLiteral("/org/gnome/system/locale/"),
        QStringLiteral("/org/gnome/system/location/"),
    };
    bool ok = true;
    for (const QString &dir : dirs) {
        QByteArray dump;
        if (!runDconf({QStringLiteral("dump"), dir}, true, {}, &dump))
            continue;
        if (!dump.trimmed().isEmpty())
            ok = runDconf({QStringLiteral("load"), dir}, false, dump) && ok;
    }
    return ok;
}

QString System::defaultExportPath() const
{
    const QString docs = QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation);
    return QStringLiteral("%1/hypede-settings-%2.ini")
        .arg(docs.isEmpty() ? QDir::homePath() : docs,
             QDateTime::currentDateTime().toString(QStringLiteral("yyyy-MM-dd")));
}

bool System::exportConfig(const QUrl &file) const
{
    QByteArray dump;
    if (!runDconf({QStringLiteral("dump"), QStringLiteral("/")}, false, {}, &dump))
        return false;
    QFile out(file.isLocalFile() ? file.toLocalFile() : file.toString());
    QDir().mkpath(QFileInfo(out).absolutePath());
    if (!out.open(QIODevice::WriteOnly | QIODevice::Truncate))
        return false;
    out.write("# Настройки HypeDE (dconf dump /). Загрузить: «Настройки → Система → Конфигурация HypeDE».\n");
    out.write(dump);
    return true;
}

bool System::importConfig(const QUrl &file) const
{
    QFile in(file.isLocalFile() ? file.toLocalFile() : file.toString());
    if (!in.open(QIODevice::ReadOnly))
        return false;
    return runDconf({QStringLiteral("load"), QStringLiteral("/")}, false, in.readAll());
}

bool System::resetConfig() const
{
    // Только база HypeDE: обычные настройки GNOME не трогаем.
    if (!inHypeDE())
        return false;
    return runDconf({QStringLiteral("reset"), QStringLiteral("-f"), QStringLiteral("/")}, false);
}
