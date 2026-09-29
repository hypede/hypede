#include "gsettingsobject.h"

// Qt определяет signals/slots как макросы, а в заголовках GLib есть поля
// с такими именами — отключаем ключевые слова Qt на время включения.
#undef signals
#include <gio/gio.h>

namespace
{

QVariant toVariant(GVariant *value)
{
    if (!value)
        return {};
    const GVariantType *type = g_variant_get_type(value);
    if (g_variant_type_equal(type, G_VARIANT_TYPE_BOOLEAN))
        return bool(g_variant_get_boolean(value));
    if (g_variant_type_equal(type, G_VARIANT_TYPE_INT32))
        return int(g_variant_get_int32(value));
    if (g_variant_type_equal(type, G_VARIANT_TYPE_UINT32))
        return uint(g_variant_get_uint32(value));
    if (g_variant_type_equal(type, G_VARIANT_TYPE_INT64))
        return qlonglong(g_variant_get_int64(value));
    if (g_variant_type_equal(type, G_VARIANT_TYPE_UINT64))
        return qulonglong(g_variant_get_uint64(value));
    if (g_variant_type_equal(type, G_VARIANT_TYPE_DOUBLE))
        return g_variant_get_double(value);
    if (g_variant_type_equal(type, G_VARIANT_TYPE_STRING))
        return QString::fromUtf8(g_variant_get_string(value, nullptr));
    if (g_variant_type_equal(type, G_VARIANT_TYPE_STRING_ARRAY)) {
        QStringList list;
        gsize n = 0;
        const gchar **strv = g_variant_get_strv(value, &n);
        for (gsize i = 0; i < n; ++i)
            list << QString::fromUtf8(strv[i]);
        g_free(strv);
        return list;
    }
    // Остальное (кортежи, словари) — строкой в формате GVariant.
    gchar *text = g_variant_print(value, FALSE);
    QString result = QString::fromUtf8(text);
    g_free(text);
    return result;
}

GVariant *fromVariant(const QVariant &value, const GVariantType *type)
{
    if (g_variant_type_equal(type, G_VARIANT_TYPE_BOOLEAN))
        return g_variant_new_boolean(value.toBool());
    if (g_variant_type_equal(type, G_VARIANT_TYPE_INT32))
        return g_variant_new_int32(value.toInt());
    if (g_variant_type_equal(type, G_VARIANT_TYPE_UINT32))
        return g_variant_new_uint32(value.toUInt());
    if (g_variant_type_equal(type, G_VARIANT_TYPE_INT64))
        return g_variant_new_int64(value.toLongLong());
    if (g_variant_type_equal(type, G_VARIANT_TYPE_UINT64))
        return g_variant_new_uint64(value.toULongLong());
    if (g_variant_type_equal(type, G_VARIANT_TYPE_DOUBLE))
        return g_variant_new_double(value.toDouble());
    if (g_variant_type_equal(type, G_VARIANT_TYPE_STRING))
        return g_variant_new_string(value.toString().toUtf8().constData());
    if (g_variant_type_equal(type, G_VARIANT_TYPE_STRING_ARRAY)) {
        const QStringList list = value.toStringList();
        QList<QByteArray> storage;
        QList<const gchar *> pointers;
        for (const QString &item : list) {
            storage << item.toUtf8();
            pointers << storage.last().constData();
        }
        return g_variant_new_strv(pointers.constData(), pointers.size());
    }
    return nullptr;
}

} // namespace

GSettingsObject::GSettingsObject(const QString &schemaId, const QString &path, QObject *parent)
    : QObject(parent)
    , m_schemaId(schemaId)
{
    GSettingsSchemaSource *source = g_settings_schema_source_get_default();
    if (!source)
        return;
    // Без схемы g_settings_new() аварийно завершает процесс — проверяем.
    m_schema = g_settings_schema_source_lookup(source, schemaId.toUtf8().constData(), TRUE);
    if (!m_schema)
        return;
    const QByteArray pathBytes = path.toUtf8();
    const char *schemaPath = g_settings_schema_get_path(m_schema);
    // У перемещаемой схемы без пути g_settings_new_full() тоже завершает процесс.
    if (!schemaPath && path.isEmpty()) {
        g_settings_schema_unref(m_schema);
        m_schema = nullptr;
        return;
    }
    m_settings = g_settings_new_full(m_schema, nullptr, path.isEmpty() ? nullptr : pathBytes.constData());
    g_signal_connect(m_settings, "changed", G_CALLBACK(&GSettingsObject::onChanged), this);
}

GSettingsObject::~GSettingsObject()
{
    if (m_settings) {
        g_signal_handlers_disconnect_by_data(m_settings, this);
        g_object_unref(m_settings);
    }
    if (m_schema)
        g_settings_schema_unref(m_schema);
}

void GSettingsObject::onChanged(GSettings *, const char *key, void *self)
{
    auto *object = static_cast<GSettingsObject *>(self);
    ++object->m_revision;
    Q_EMIT object->changed(QString::fromUtf8(key));
    Q_EMIT object->revisionChanged();
}

bool GSettingsObject::hasKey(const QString &key) const
{
    return m_schema && g_settings_schema_has_key(m_schema, key.toUtf8().constData());
}

QVariant GSettingsObject::value(const QString &key) const
{
    if (!hasKey(key))
        return {};
    GVariant *value = g_settings_get_value(m_settings, key.toUtf8().constData());
    QVariant result = toVariant(value);
    g_variant_unref(value);
    return result;
}

bool GSettingsObject::setValue(const QString &key, const QVariant &value)
{
    if (!hasKey(key))
        return false;
    const QByteArray name = key.toUtf8();
    GSettingsSchemaKey *schemaKey = g_settings_schema_get_key(m_schema, name.constData());
    GVariant *variant = fromVariant(value, g_settings_schema_key_get_value_type(schemaKey));
    bool ok = false;
    if (variant) {
        g_variant_ref_sink(variant);
        if (g_settings_schema_key_range_check(schemaKey, variant))
            ok = g_settings_set_value(m_settings, name.constData(), variant);
        g_variant_unref(variant);
    }
    g_settings_schema_key_unref(schemaKey);
    return ok;
}

void GSettingsObject::reset(const QString &key)
{
    if (hasKey(key))
        g_settings_reset(m_settings, key.toUtf8().constData());
}

QStringList GSettingsObject::choices(const QString &key) const
{
    QStringList result;
    if (!hasKey(key))
        return result;
    GSettingsSchemaKey *schemaKey = g_settings_schema_get_key(m_schema, key.toUtf8().constData());
    GVariant *range = g_settings_schema_key_get_range(schemaKey);
    const gchar *kind = nullptr;
    GVariant *values = nullptr;
    g_variant_get(range, "(&sv)", &kind, &values);
    if (g_strcmp0(kind, "enum") == 0) {
        GVariantIter iter;
        g_variant_iter_init(&iter, values);
        const gchar *item = nullptr;
        while (g_variant_iter_next(&iter, "&s", &item))
            result << QString::fromUtf8(item);
    }
    g_variant_unref(values);
    g_variant_unref(range);
    g_settings_schema_key_unref(schemaKey);
    return result;
}

QStringList GSettingsObject::tuples(const QString &key) const
{
    QStringList result;
    if (!hasKey(key))
        return result;
    GVariant *value = g_settings_get_value(m_settings, key.toUtf8().constData());
    if (g_variant_is_of_type(value, G_VARIANT_TYPE("a(ss)"))) {
        GVariantIter iter;
        g_variant_iter_init(&iter, value);
        const gchar *first = nullptr;
        const gchar *second = nullptr;
        while (g_variant_iter_next(&iter, "(&s&s)", &first, &second))
            result << QStringLiteral("%1:%2").arg(QString::fromUtf8(first), QString::fromUtf8(second));
    }
    g_variant_unref(value);
    return result;
}

bool GSettingsObject::setTuples(const QString &key, const QStringList &items)
{
    if (!hasKey(key))
        return false;
    GVariantBuilder builder;
    g_variant_builder_init(&builder, G_VARIANT_TYPE("a(ss)"));
    for (const QString &item : items) {
        const int colon = item.indexOf(QLatin1Char(':'));
        if (colon <= 0)
            continue;
        g_variant_builder_add(&builder, "(ss)", item.left(colon).toUtf8().constData(),
                              item.mid(colon + 1).toUtf8().constData());
    }
    return g_settings_set_value(m_settings, key.toUtf8().constData(), g_variant_builder_end(&builder));
}

// ---------------------------------------------------------------------------

GSettingsHub::GSettingsHub(QObject *parent)
    : QObject(parent)
{
}

GSettingsHub *GSettingsHub::instance()
{
    static GSettingsHub *hub = new GSettingsHub();
    return hub;
}

GSettingsHub *GSettingsHub::create(QQmlEngine *, QJSEngine *)
{
    auto *hub = instance();
    QQmlEngine::setObjectOwnership(hub, QQmlEngine::CppOwnership);
    return hub;
}

GSettingsObject *GSettingsHub::schema(const QString &schemaId)
{
    auto it = m_cache.constFind(schemaId);
    if (it != m_cache.constEnd())
        return it.value();
    auto *object = new GSettingsObject(schemaId, QString(), this);
    QQmlEngine::setObjectOwnership(object, QQmlEngine::CppOwnership);
    m_cache.insert(schemaId, object);
    return object;
}

GSettingsObject *GSettingsHub::schemaAt(const QString &schemaId, const QString &path)
{
    const QString cacheKey = schemaId + QLatin1Char('@') + path;
    auto it = m_cache.constFind(cacheKey);
    if (it != m_cache.constEnd())
        return it.value();
    auto *object = new GSettingsObject(schemaId, path, this);
    QQmlEngine::setObjectOwnership(object, QQmlEngine::CppOwnership);
    m_cache.insert(cacheKey, object);
    return object;
}

bool GSettingsHub::hasSchema(const QString &schemaId) const
{
    GSettingsSchemaSource *source = g_settings_schema_source_get_default();
    if (!source)
        return false;
    GSettingsSchema *schema = g_settings_schema_source_lookup(source, schemaId.toUtf8().constData(), TRUE);
    if (!schema)
        return false;
    g_settings_schema_unref(schema);
    return true;
}
