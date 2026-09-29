#include "system.h"

#include <kcoreaddons_version.h>

#include <QDBusArgument>
#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusReply>
#include <QDBusVariant>
#include <QDesktopServices>
#include <QDir>
#include <QFile>
#include <QLocale>
#include <QProcess>
#include <QDateTime>
#include <QFileInfo>
#include <QSet>
#include <QTimeZone>
#include <QStandardPaths>
#include <QSysInfo>
#include <QUrl>

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
