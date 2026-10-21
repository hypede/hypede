// Звук через pactl (PulseAudio и PipeWire с pipewire-pulse): устройства
// вывода и ввода, громкость, выключение звука и громкость каждой
// программы. pactl subscribe сообщает об изменениях, после них список
// перечитывается.

#pragma once

#include <QObject>
#include <QProcess>
#include <QQmlEngine>
#include <QTimer>
#include <QVariantList>

class Sound : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(bool available READ available NOTIFY changed)
    // [{name, description, volume (1 = 100 %), muted, isDefault}]
    Q_PROPERTY(QVariantList outputs READ outputs NOTIFY changed)
    Q_PROPERTY(QVariantList inputs READ inputs NOTIFY changed)
    // Программы, которые сейчас играют: [{index, name, icon, volume, muted}]
    Q_PROPERTY(QVariantList apps READ apps NOTIFY changed)

public:
    static Sound *create(QQmlEngine *, QJSEngine *);

    bool available() const { return m_available; }
    QVariantList outputs() const { return m_outputs; }
    QVariantList inputs() const { return m_inputs; }
    QVariantList apps() const { return m_apps; }

    // kind: "output" | "input" | "app" (тогда name — номер потока).
    Q_INVOKABLE void setDefault(const QString &kind, const QString &name);
    Q_INVOKABLE void setVolume(const QString &kind, const QString &name, double volume);
    Q_INVOKABLE void setMuted(const QString &kind, const QString &name, bool muted);

Q_SIGNALS:
    void changed();

private:
    explicit Sound(QObject *parent = nullptr);
    void refresh();
    void pactl(const QStringList &args);
    void subscribe();

    bool m_available = false;
    QVariantList m_outputs, m_inputs, m_apps;
    QTimer m_timer;
    QProcess m_subscribe;
    QProcess *m_reader = nullptr;
};
