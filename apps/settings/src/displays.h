// Мониторы: разрешение, частота обновления, масштаб, поворот, основной
// монитор, расположение нескольких мониторов, дублирование и отключение.
// Настройки берутся у Mutter (org.gnome.Mutter.DisplayConfig) и
// отправляются ему же, как это делает gnome-control-center. После
// применения GNOME Shell сам спрашивает «Сохранить эти настройки?» и
// откатывает их, если ответа нет.

#pragma once

#include <QObject>
#include <QQmlEngine>
#include <QSize>
#include <QVariantList>

struct ApplyLogical;

class Displays : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(bool available READ available NOTIFY changed)
    Q_PROPERTY(QVariantList monitors READ monitors NOTIFY changed)
    Q_PROPERTY(bool fractionalScaling READ fractionalScaling NOTIFY changed)
    Q_PROPERTY(bool mirrored READ mirrored NOTIFY changed)

public:
    static Displays *create(QQmlEngine *, QJSEngine *);

    bool available() const { return m_available; }
    QVariantList monitors() const { return m_monitors; }
    bool fractionalScaling() const { return m_fractional; }
    bool mirrored() const { return m_mirrored; }

    // Применить новые параметры одного монитора; остальные остаются как есть.
    Q_INVOKABLE bool apply(const QString &connector, const QString &modeId, double scale, int transform,
                           bool primary);
    // Расположение нескольких мониторов: items — [{connector, x, y, enabled}]
    // в логических пикселях; mirror — все включённые показывают одно и то же.
    Q_INVOKABLE bool applyLayout(const QVariantList &items, bool mirror);
    Q_INVOKABLE void refresh();

Q_SIGNALS:
    void changed();
    void failed(const QString &message);

private:
    explicit Displays(QObject *parent = nullptr);

    struct Mode {
        QString id;
        int width = 0;
        int height = 0;
        double refresh = 0;
        double preferredScale = 1;
        QList<double> scales;
        bool current = false;
        bool preferred = false;
    };
    struct Monitor {
        QString connector, vendor, product, serial;
        QString displayName;
        bool builtin = false;
        QList<Mode> modes;
    };
    struct Logical {
        int x = 0, y = 0;
        double scale = 1;
        uint transform = 0;
        bool primary = false;
        QStringList connectors;
    };

    const Mode *currentMode(const Monitor &monitor) const;
    // Режим, в котором монитор будет работать: текущий, а у выключенного —
    // рекомендуемый.
    const Mode *activeMode(const Monitor &monitor) const;
    QSize logicalSize(const Mode &mode, double scale, int transform) const;
    bool send(const QList<ApplyLogical> &config);

    bool m_available = false;
    bool m_fractional = false;
    bool m_mirrored = false;
    uint m_serial = 0;
    uint m_layoutMode = 1;
    QList<Monitor> m_state;
    QList<Logical> m_logical;
    QVariantList m_monitors;
};
