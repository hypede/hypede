#include "sound.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QStandardPaths>

namespace
{

// Средняя громкость по каналам, 1 — 100 %.
double volumeOf(const QJsonObject &item)
{
    const QJsonObject channels = item.value(QLatin1String("volume")).toObject();
    double sum = 0;
    for (const QJsonValue &channel : channels)
        sum += channel.toObject().value(QLatin1String("value")).toDouble();
    return channels.isEmpty() ? 0 : sum / channels.size() / 65536.0;
}

QJsonArray parse(const QByteArray &json)
{
    return QJsonDocument::fromJson(json).array();
}

} // namespace

Sound::Sound(QObject *parent)
    : QObject(parent)
{
    m_timer.setSingleShot(true);
    m_timer.setInterval(150);
    connect(&m_timer, &QTimer::timeout, this, &Sound::refresh);
    m_available = !QStandardPaths::findExecutable(QStringLiteral("pactl")).isEmpty();
    if (!m_available)
        return;
    subscribe();
    refresh();
}

Sound *Sound::create(QQmlEngine *, QJSEngine *)
{
    static Sound *sound = new Sound();
    QQmlEngine::setObjectOwnership(sound, QQmlEngine::CppOwnership);
    return sound;
}

void Sound::subscribe()
{
    // Каждая строка «Event 'change' on sink #45» — повод перечитать список.
    connect(&m_subscribe, &QProcess::readyReadStandardOutput, this, [this] {
        m_subscribe.readAllStandardOutput();
        if (!m_timer.isActive())
            m_timer.start();
    });
    // Звуковой сервер перезапустился — подписываемся заново.
    connect(&m_subscribe, &QProcess::finished, this, [this] {
        QTimer::singleShot(2000, this, [this] {
            m_subscribe.start(QStringLiteral("pactl"), {QStringLiteral("subscribe")});
            refresh();
        });
    });
    m_subscribe.start(QStringLiteral("pactl"), {QStringLiteral("subscribe")});
}

void Sound::refresh()
{
    if (m_reader)
        return;
    // Одна оболочка на все четыре запроса — разделитель между ответами.
    m_reader = new QProcess(this);
    const QString script = QStringLiteral(
        "pactl -f json info; echo @@HYPEDE@@; pactl -f json list sinks; echo @@HYPEDE@@;"
        "pactl -f json list sources; echo @@HYPEDE@@; pactl -f json list sink-inputs");
    connect(m_reader, &QProcess::finished, this, [this] {
        const QByteArray out = m_reader->readAllStandardOutput();
        m_reader->deleteLater();
        m_reader = nullptr;
        QList<QByteArray> blocks;
        for (qsizetype from = 0;;) {
            const qsizetype at = out.indexOf("@@HYPEDE@@", from);
            blocks << out.mid(from, at < 0 ? -1 : at - from);
            if (at < 0)
                break;
            from = at + 10;
        }
        if (blocks.size() < 4)
            return;
        const QJsonObject info = QJsonDocument::fromJson(blocks.at(0)).object();
        const QString defaultSink = info.value(QLatin1String("default_sink_name")).toString();
        const QString defaultSource = info.value(QLatin1String("default_source_name")).toString();

        m_outputs.clear();
        for (const QJsonValue &v : parse(blocks.at(1))) {
            const QJsonObject o = v.toObject();
            const QString name = o.value(QLatin1String("name")).toString();
            m_outputs << QVariantMap{{QStringLiteral("name"), name},
                                     {QStringLiteral("description"), o.value(QLatin1String("description")).toString()},
                                     {QStringLiteral("volume"), volumeOf(o)},
                                     {QStringLiteral("muted"), o.value(QLatin1String("mute")).toBool()},
                                     {QStringLiteral("isDefault"), name == defaultSink}};
        }
        m_inputs.clear();
        for (const QJsonValue &v : parse(blocks.at(2))) {
            const QJsonObject o = v.toObject();
            // «Монитор» выхода — не микрофон.
            if (!o.value(QLatin1String("monitor_of_sink")).toString().isEmpty()
                && o.value(QLatin1String("monitor_of_sink")).toString() != QLatin1String("n/a"))
                continue;
            const QString name = o.value(QLatin1String("name")).toString();
            if (name.endsWith(QLatin1String(".monitor")))
                continue;
            m_inputs << QVariantMap{{QStringLiteral("name"), name},
                                    {QStringLiteral("description"), o.value(QLatin1String("description")).toString()},
                                    {QStringLiteral("volume"), volumeOf(o)},
                                    {QStringLiteral("muted"), o.value(QLatin1String("mute")).toBool()},
                                    {QStringLiteral("isDefault"), name == defaultSource}};
        }
        m_apps.clear();
        for (const QJsonValue &v : parse(blocks.at(3))) {
            const QJsonObject o = v.toObject();
            const QJsonObject props = o.value(QLatin1String("properties")).toObject();
            QString name = props.value(QLatin1String("application.name")).toString();
            if (name.isEmpty())
                name = props.value(QLatin1String("media.name")).toString();
            // Звуки событий (щелчки, уведомления) — не программа.
            if (props.value(QLatin1String("media.role")).toString() == QLatin1String("event"))
                continue;
            m_apps << QVariantMap{{QStringLiteral("index"), QString::number(o.value(QLatin1String("index")).toInt())},
                                  {QStringLiteral("name"), name},
                                  {QStringLiteral("icon"), props.value(QLatin1String("application.icon_name")).toString()},
                                  {QStringLiteral("volume"), volumeOf(o)},
                                  {QStringLiteral("muted"), o.value(QLatin1String("mute")).toBool()}};
        }
        Q_EMIT changed();
    });
    m_reader->start(QStringLiteral("sh"), {QStringLiteral("-c"), script});
}

void Sound::pactl(const QStringList &args)
{
    auto *process = new QProcess(this);
    connect(process, &QProcess::finished, process, &QObject::deleteLater);
    process->start(QStringLiteral("pactl"), args);
}

static QString target(const QString &kind)
{
    return kind == QLatin1String("output") ? QStringLiteral("sink")
         : kind == QLatin1String("input")  ? QStringLiteral("source")
                                           : QStringLiteral("sink-input");
}

void Sound::setDefault(const QString &kind, const QString &name)
{
    pactl({QStringLiteral("set-default-") + target(kind), name});
}

void Sound::setVolume(const QString &kind, const QString &name, double volume)
{
    pactl({QStringLiteral("set-") + target(kind) + QStringLiteral("-volume"), name,
           QString::number(qRound(qMax(0.0, volume) * 100)) + QLatin1Char('%')});
}

void Sound::setMuted(const QString &kind, const QString &name, bool muted)
{
    pactl({QStringLiteral("set-") + target(kind) + QStringLiteral("-mute"), name,
           muted ? QStringLiteral("1") : QStringLiteral("0")});
}
