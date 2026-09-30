// «Настройки» HypeDE: интерфейс в духе Chrome OS, внутри — модули KDE.
//
//   hypede-settings [--page network|bluetooth|devices|personalization|privacy|
//                           apps|accessibility|system|about]
//                   [--kcm kcm_pulseaudio]

#include "gsettingsobject.h"
#include "mainwindow.h"

#include <gio/gio.h>

#include <QApplication>
#include <QCommandLineParser>
#include <QDBusConnection>
#include <QDBusConnectionInterface>
#include <QDBusMessage>
#include <QDir>
#include <QFont>
#include <QFontDatabase>
#include <QIcon>
#include <QLibraryInfo>
#include <QLocale>
#include <QQuickStyle>
#include <QStyleFactory>
#include <QTimer>
#include <QTranslator>

namespace
{

const QString kService = QStringLiteral("dev.hypede.Settings");
const QString kPath = QStringLiteral("/dev/hypede/Settings");

// Приёмник вызова «открой такую-то страницу» от второго экземпляра.
class Activator : public QObject
{
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "dev.hypede.Settings")

public:
    explicit Activator(MainWindow *window)
        : m_window(window)
    {
    }

public Q_SLOTS:
    Q_SCRIPTABLE void Activate(const QString &page, const QString &kcm)
    {
        m_window->activatePage(page, kcm);
    }

private:
    MainWindow *m_window;
};

bool qmlModuleExists(const QString &uriPath)
{
    const QString importPath = QLibraryInfo::path(QLibraryInfo::QmlImportsPath);
    return QDir(importPath + QLatin1Char('/') + uriPath).exists();
}

void setupStyleAndIcons()
{
    // Модули KDE выглядят «родными» со стилем Breeze и темой значков Breeze
    // как запасной — у GNOME-тем значков нет многих имён, которые они ждут.
    if (QStyleFactory::keys().contains(QStringLiteral("Breeze"), Qt::CaseInsensitive))
        QApplication::setStyle(QStringLiteral("Breeze"));
    else
        QApplication::setStyle(QStringLiteral("Fusion"));

    if (qEnvironmentVariableIsEmpty("QT_QUICK_CONTROLS_STYLE")) {
        QQuickStyle::setStyle(qmlModuleExists(QStringLiteral("org/kde/desktop")) ? QStringLiteral("org.kde.desktop")
                                                                                  : QStringLiteral("Fusion"));
    }

    auto *iface = GSettingsHub::instance()->schema(QStringLiteral("org.gnome.desktop.interface"));
    const QString gnomeIcons = iface->valid() ? iface->value(QStringLiteral("icon-theme")).toString() : QString();
    if (!gnomeIcons.isEmpty())
        QIcon::setThemeName(gnomeIcons);
    QIcon::setFallbackThemeName(QStringLiteral("breeze"));
}

} // namespace

int main(int argc, char **argv)
{
    // В сеансе HypeDE своя база настроек (см. session/hypede-session.in).
    // Обычно переменная приходит от оболочки, но если «Настройки» запустил
    // кто-то со старым окружением, изменения ушли бы в базу обычного GNOME.
    if (qEnvironmentVariable("XDG_CURRENT_DESKTOP").split(QLatin1Char(':')).contains(QLatin1String("HypeDE")))
        qputenv("DCONF_PROFILE", "hypede");

    QApplication::setDesktopFileName(QStringLiteral("dev.hypede.Settings"));
    QApplication app(argc, argv);
    app.setApplicationName(QStringLiteral("hypede-settings"));
    app.setOrganizationDomain(QStringLiteral("hypede.dev"));
    app.setApplicationVersion(QStringLiteral(HYPEDE_VERSION));

    QTranslator translator;
    if (translator.load(QLocale(), QStringLiteral("hypede-settings"), QStringLiteral("_"), QStringLiteral(":/i18n")))
        app.installTranslator(&translator);
    app.setApplicationDisplayName(QCoreApplication::translate("MainWindow", "Settings"));

    QCommandLineParser parser;
    parser.setApplicationDescription(QStringLiteral("HypeDE Settings"));
    parser.addHelpOption();
    parser.addVersionOption();
    QCommandLineOption pageOption(QStringLiteral("page"), QStringLiteral("Page to open"), QStringLiteral("page"));
    QCommandLineOption kcmOption(QStringLiteral("kcm"), QStringLiteral("KDE settings module to open"),
                                 QStringLiteral("module"));
    parser.addOption(pageOption);
    parser.addOption(kcmOption);
    parser.process(app);
    const QString page = parser.value(pageOption);
    const QString kcm = parser.value(kcmOption);

    // Один экземпляр: если «Настройки» уже открыты — переключить их.
    QDBusConnection bus = QDBusConnection::sessionBus();
    if (bus.isConnected() && !bus.registerService(kService)) {
        QDBusMessage message = QDBusMessage::createMethodCall(kService, kPath, kService, QStringLiteral("Activate"));
        message << page << kcm;
        bus.call(message, QDBus::Block, 3000);
        return 0;
    }

    setupStyleAndIcons();

    // Шрифт интерфейса как в Chrome OS: Google Sans, если он есть, иначе
    // Roboto (зависимость пакета). Размер — из настроек GNOME.
    for (const QString family : {QStringLiteral("Google Sans Text"), QStringLiteral("Google Sans"), QStringLiteral("Roboto")}) {
        if (QFontDatabase::hasFamily(family)) {
            QFont font(family);
            font.setPointSizeF(10.5);
            QGuiApplication::setFont(font);
            break;
        }
    }
    auto *iface = GSettingsHub::instance()->schema(QStringLiteral("org.gnome.desktop.interface"));
    auto syncScheme = [iface] {
        applyKdeColorScheme(iface->valid() && iface->value(QStringLiteral("color-scheme")).toString() ==
                                                   QLatin1String("prefer-dark"));
    };
    syncScheme();
    QObject::connect(iface, &GSettingsObject::changed, &app, [syncScheme](const QString &key) {
        if (key == QLatin1String("color-scheme"))
            syncScheme();
    });

    MainWindow window(page, kcm);
    Activator activator(&window);
    if (bus.isConnected())
        bus.registerObject(kPath, &activator, QDBusConnection::ExportScriptableSlots);
    window.show();

    // Для отладки и скриншотов документации: снимок окна изнутри программы.
    const QString grabPath = qEnvironmentVariable("HYPEDE_SETTINGS_GRAB");
    if (!grabPath.isEmpty()) {
        QTimer::singleShot(qEnvironmentVariableIntValue("HYPEDE_SETTINGS_GRAB_DELAY") ?: 3000, &window,
                           [&window, grabPath] { window.grab().save(grabPath); });
    }
    // GSettings пишет в dconf асинхронно: без этого изменение, сделанное
    // перед самым закрытием окна, могло не успеть сохраниться.
    const int status = app.exec();
    g_settings_sync();
    return status;
}

#include "main.moc"
