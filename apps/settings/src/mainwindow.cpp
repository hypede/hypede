#include "mainwindow.h"
#include "kcmhost.h"

#include <KColorScheme>
#include <KSharedConfig>

#include <QApplication>
#include <QEvent>
#include <QFile>
#include <QLibraryInfo>
#include <QQmlContext>
#include <QQmlEngine>
#include <QQuickWidget>
#include <QStandardPaths>
#include <QVBoxLayout>
#include <QWindow>

namespace
{

// Декорации Adwaita для Qt (пакет qadwaitadecorations) рисуют заголовок как у
// GTK-окон, с тенью. Если их нет — рисуем заголовок сами.
bool haveAdwaitaDecorations()
{
    const QString dir = QLibraryInfo::path(QLibraryInfo::PluginsPath) + QStringLiteral("/wayland-decoration-client/");
    return QFile::exists(dir + QStringLiteral("libqadwaitadecorations.so")) ||
        QFile::exists(dir + QStringLiteral("libadwaita.so"));
}

QString colorSchemePath(bool dark)
{
    const QString name = dark ? QStringLiteral("HypeDEDark.colors") : QStringLiteral("HypeDELight.colors");
    const QByteArray devDir = qgetenv("HYPEDE_COLORS_DIR");
    if (!devDir.isEmpty() && QFile::exists(QString::fromLocal8Bit(devDir) + QLatin1Char('/') + name))
        return QString::fromLocal8Bit(devDir) + QLatin1Char('/') + name;
    return QStandardPaths::locate(QStandardPaths::GenericDataLocation, QStringLiteral("color-schemes/") + name);
}

} // namespace

void applyKdeColorScheme(bool dark)
{
    const QString path = colorSchemePath(dark);
    if (path.isEmpty())
        return;
    // Так же делает KColorSchemeManager: модули на QML (Kirigami) читают
    // схему из этого свойства, модули на виджетах — из палитры.
    qApp->setProperty("KDE_COLOR_SCHEME_PATH", path);
    qApp->setPalette(KColorScheme::createApplicationPalette(KSharedConfig::openConfig(path)));
}

MainWindow::MainWindow(const QString &page, const QString &kcm, QWidget *parent)
    : QWidget(parent)
{
    m_frameless = !haveAdwaitaDecorations() && qEnvironmentVariableIsEmpty("HYPEDE_SETTINGS_DECORATED");
    if (m_frameless)
        setWindowFlag(Qt::FramelessWindowHint);
    setWindowTitle(tr("Settings"));
    setWindowIcon(QIcon::fromTheme(QStringLiteral("dev.hypede.Settings")));
    setMinimumSize(560, 480);
    resize(1080, 760);

    auto *layout = new QVBoxLayout(this);
    layout->setContentsMargins(0, 0, 0, 0);
    m_quick = new QQuickWidget(this);
    m_quick->setResizeMode(QQuickWidget::SizeRootObjectToView);
    m_quick->rootContext()->setContextProperty(QStringLiteral("appWindow"), this);
    m_quick->setInitialProperties({
        {QStringLiteral("initialPage"), page},
        {QStringLiteral("initialKcm"), kcm},
    });
    layout->addWidget(m_quick);

    KcmHost::instance()->attach(this, m_quick);
    m_quick->loadFromModule(QStringLiteral("HypeSettings"), QStringLiteral("Main"));
    if (m_quick->status() != QQuickWidget::Ready) {
        qWarning() << "hypede-settings: интерфейс не загрузился, статус" << m_quick->status();
        for (const QQmlError &error : m_quick->errors())
            qWarning().noquote() << error.toString();
    }
}

void MainWindow::startMove()
{
    if (QWindow *window = windowHandle())
        window->startSystemMove();
}

void MainWindow::startResize(int edges)
{
    if (QWindow *window = windowHandle())
        window->startSystemResize(Qt::Edges(edges));
}

void MainWindow::minimize()
{
    showMinimized();
}

void MainWindow::toggleMaximize()
{
    if (isMaximized())
        showNormal();
    else
        showMaximized();
}

void MainWindow::closeWindow()
{
    close();
}

void MainWindow::activatePage(const QString &page, const QString &kcm)
{
    Q_EMIT pageRequested(page, kcm);
    show();
    raise();
    activateWindow();
}

void MainWindow::changeEvent(QEvent *event)
{
    if (event->type() == QEvent::WindowStateChange)
        Q_EMIT maximizedChanged();
    QWidget::changeEvent(event);
}
