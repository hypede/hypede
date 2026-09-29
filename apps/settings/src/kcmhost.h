// Хост модулей настроек KDE (KCM) внутри окна «Настроек» HypeDE.
//
// Модуль загружается через KCModuleLoader — ту же функцию, что использует
// kcmshell6. Она умеет и модули на QML (они приходят обёрнутыми в
// QQuickWidget), и старые модули на виджетах (например, «Соединения» из
// plasma-nm). Готовый виджет кладётся поверх QML-интерфейса ровно в
// прямоугольник, который отвёл для него QML (setViewport), — снаружи это
// выглядит как обычная карточка страницы.

#pragma once

#include <QObject>
#include <QPointer>
#include <QQmlEngine>
#include <QRectF>
#include <QVariantMap>

class KCModule;
class QQuickWidget;
class QWidget;

class KcmHost : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(QString current READ current NOTIFY currentChanged)
    Q_PROPERTY(QString title READ title NOTIFY currentChanged)
    Q_PROPERTY(QString error READ error NOTIFY currentChanged)
    // Модули на QML сами показывают заголовок страницы, на виджетах — нет.
    Q_PROPERTY(bool ownTitle READ ownTitle NOTIFY currentChanged)
    Q_PROPERTY(bool needsSave READ needsSave NOTIFY stateChanged)
    Q_PROPERTY(bool representsDefaults READ representsDefaults NOTIFY stateChanged)
    Q_PROPERTY(bool showApply READ showApply NOTIFY stateChanged)
    Q_PROPERTY(bool showDefaults READ showDefaults NOTIFY stateChanged)

public:
    static KcmHost *create(QQmlEngine *, QJSEngine *);
    static KcmHost *instance();

    // Окно и QML-виджет, поверх которого показываются модули.
    void attach(QWidget *window, QQuickWidget *quickWidget);

    QString current() const { return m_current; }
    QString title() const { return m_title; }
    QString error() const { return m_error; }
    bool ownTitle() const { return m_ownTitle; }
    bool needsSave() const;
    bool representsDefaults() const;
    bool showApply() const;
    bool showDefaults() const;

    // {available, name, description, icon, widgets}
    Q_INVOKABLE QVariantMap info(const QString &id) const;
    Q_INVOKABLE bool isAvailable(const QString &id) const;
    Q_INVOKABLE bool open(const QString &id, const QStringList &args = {});
    Q_INVOKABLE void close();
    Q_INVOKABLE void apply();
    Q_INVOKABLE void reset();
    Q_INVOKABLE void defaults();
    Q_INVOKABLE bool launchExternal(const QString &id);

    // Прямоугольник под модуль в координатах QML-сцены.
    Q_INVOKABLE void setViewport(qreal x, qreal y, qreal width, qreal height);
    Q_INVOKABLE void setShown(bool shown);

Q_SIGNALS:
    void currentChanged();
    void stateChanged();

private:
    explicit KcmHost(QObject *parent = nullptr);
    void updateGeometry();

    QPointer<QWidget> m_window;
    QPointer<QQuickWidget> m_quickWidget;
    QPointer<QWidget> m_container;
    QPointer<KCModule> m_module;
    QString m_current;
    QString m_title;
    QString m_error;
    QRectF m_viewport;
    bool m_shown = true;
    bool m_ownTitle = false;
};
