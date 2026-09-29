#include "kcmhost.h"

#include <KCModule>
#include <KCModuleLoader>
#include <KPluginMetaData>

#include <QProcess>
#include <QQuickWidget>
#include <QStandardPaths>
#include <QVBoxLayout>
#include <QWidget>

namespace
{

// Где Plasma 6 держит модули настроек. Порядок важен: сначала модули
// «Параметров системы», затем «Информации о системе».
const QStringList kNamespaces = {
    QStringLiteral("plasma/kcms/systemsettings"),
    QStringLiteral("plasma/kcms/systemsettings_qwidgets"),
    QStringLiteral("plasma/kcms"),
    QStringLiteral("plasma/kcms/kinfocenter"),
};

KPluginMetaData findModule(const QString &id)
{
    for (const QString &ns : kNamespaces) {
        KPluginMetaData data = KPluginMetaData::findPluginById(ns, id);
        if (data.isValid())
            return data;
    }
    return {};
}

} // namespace

KcmHost::KcmHost(QObject *parent)
    : QObject(parent)
{
}

KcmHost *KcmHost::instance()
{
    static KcmHost *host = new KcmHost();
    return host;
}

KcmHost *KcmHost::create(QQmlEngine *, QJSEngine *)
{
    auto *host = instance();
    QQmlEngine::setObjectOwnership(host, QQmlEngine::CppOwnership);
    return host;
}

void KcmHost::attach(QWidget *window, QQuickWidget *quickWidget)
{
    m_window = window;
    m_quickWidget = quickWidget;
    m_container = new QWidget(window);
    m_container->setObjectName(QStringLiteral("kcmContainer"));
    m_container->setAutoFillBackground(true);
    auto *layout = new QVBoxLayout(m_container);
    layout->setContentsMargins(0, 0, 0, 0);
    m_container->hide();
}

QVariantMap KcmHost::info(const QString &id) const
{
    const KPluginMetaData data = findModule(id);
    if (!data.isValid())
        return {{QStringLiteral("available"), false}};
    return {
        {QStringLiteral("available"), true},
        {QStringLiteral("name"), data.name()},
        {QStringLiteral("description"), data.description()},
        {QStringLiteral("icon"), data.iconName()},
        {QStringLiteral("widgets"), data.fileName().contains(QLatin1String("systemsettings_qwidgets"))},
    };
}

bool KcmHost::isAvailable(const QString &id) const
{
    return findModule(id).isValid();
}

bool KcmHost::open(const QString &id, const QStringList &args)
{
    if (id == m_current && m_module)
        return true;
    close();

    const KPluginMetaData data = findModule(id);
    m_current = id;
    if (!data.isValid() || !m_container) {
        m_error = tr("This module is not installed");
        m_title = id;
        Q_EMIT currentChanged();
        return false;
    }

    QVariantList variantArgs;
    for (const QString &arg : args)
        variantArgs << arg;

    m_module = KCModuleLoader::loadModule(data, m_container, variantArgs);
    m_title = data.name();
    m_ownTitle = !data.fileName().contains(QLatin1String("systemsettings_qwidgets"));
    m_error.clear();
    if (!m_module) {
        m_error = tr("The module could not be loaded");
        Q_EMIT currentChanged();
        return false;
    }

    connect(m_module, &KCModule::needsSaveChanged, this, &KcmHost::stateChanged);
    connect(m_module, &KCModule::representsDefaultsChanged, this, &KcmHost::stateChanged);
    connect(m_module, &KCModule::buttonsChanged, this, &KcmHost::stateChanged);

    QWidget *widget = m_module->widget();
    m_container->layout()->addWidget(widget);
    m_module->load();
    widget->show();
    updateGeometry();

    Q_EMIT currentChanged();
    Q_EMIT stateChanged();
    return true;
}

void KcmHost::close()
{
    if (m_module) {
        QWidget *widget = m_module->widget();
        if (widget) {
            m_container->layout()->removeWidget(widget);
            widget->hide();
            widget->deleteLater();
        }
        m_module->deleteLater();
        m_module.clear();
    }
    if (m_container)
        m_container->hide();
    const bool changed = !m_current.isEmpty();
    m_current.clear();
    m_title.clear();
    m_error.clear();
    m_ownTitle = false;
    if (changed) {
        Q_EMIT currentChanged();
        Q_EMIT stateChanged();
    }
}

bool KcmHost::needsSave() const
{
    return m_module && m_module->needsSave();
}

bool KcmHost::representsDefaults() const
{
    return m_module && m_module->representsDefaults();
}

bool KcmHost::showApply() const
{
    return m_module && (m_module->buttons() & KAbstractConfigModule::Apply);
}

bool KcmHost::showDefaults() const
{
    return m_module && (m_module->buttons() & KAbstractConfigModule::Default);
}

void KcmHost::apply()
{
    if (m_module) {
        m_module->save();
        Q_EMIT stateChanged();
    }
}

void KcmHost::reset()
{
    if (m_module) {
        m_module->load();
        Q_EMIT stateChanged();
    }
}

void KcmHost::defaults()
{
    if (m_module) {
        m_module->defaults();
        Q_EMIT stateChanged();
    }
}

bool KcmHost::launchExternal(const QString &id)
{
    const QString kcmshell = QStandardPaths::findExecutable(QStringLiteral("kcmshell6"));
    if (kcmshell.isEmpty())
        return false;
    return QProcess::startDetached(kcmshell, {id});
}

void KcmHost::setViewport(qreal x, qreal y, qreal width, qreal height)
{
    m_viewport = QRectF(x, y, width, height);
    updateGeometry();
}

void KcmHost::setShown(bool shown)
{
    m_shown = shown;
    updateGeometry();
}

void KcmHost::updateGeometry()
{
    if (!m_container || !m_quickWidget)
        return;
    const bool visible = m_shown && m_module && m_viewport.width() > 1 && m_viewport.height() > 1;
    if (!visible) {
        m_container->hide();
        return;
    }
    const QPoint origin = m_quickWidget->mapTo(m_window, m_viewport.topLeft().toPoint());
    m_container->setGeometry(QRect(origin, m_viewport.size().toSize()));
    m_container->show();
    m_container->raise();
}
