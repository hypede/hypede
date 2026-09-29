#pragma once

#include <QWidget>

class QQuickWidget;

// Окно «Настроек»: один QQuickWidget с интерфейсом на весь размер и слой
// для модулей KDE поверх него (см. KcmHost). Рамку окна рисует сам QML —
// заголовок со строкой поиска, как у «Настроек» Chrome OS.
class MainWindow : public QWidget
{
    Q_OBJECT
    Q_PROPERTY(bool maximized READ isMaximizedState NOTIFY maximizedChanged)
    Q_PROPERTY(bool frameless READ frameless CONSTANT)

public:
    MainWindow(const QString &page, const QString &kcm, QWidget *parent = nullptr);

    bool isMaximizedState() const { return isMaximized(); }
    bool frameless() const { return m_frameless; }

    Q_INVOKABLE void startMove();
    Q_INVOKABLE void startResize(int edges);
    Q_INVOKABLE void minimize();
    Q_INVOKABLE void toggleMaximize();
    Q_INVOKABLE void closeWindow();

    // Вызывается из D-Bus, когда «Настройки» запускают повторно.
    void activatePage(const QString &page, const QString &kcm);

Q_SIGNALS:
    void maximizedChanged();
    void pageRequested(const QString &page, const QString &kcm);

protected:
    void changeEvent(QEvent *event) override;

private:
    QQuickWidget *m_quick = nullptr;
    bool m_frameless = true;
};

// Палитра KDE для модулей: светлая или тёмная в тон GNOME.
void applyKdeColorScheme(bool dark);
