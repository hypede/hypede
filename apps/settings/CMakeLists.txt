cmake_minimum_required(VERSION 3.22)
project(hypede-settings VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

set(QT_MIN 6.6)
set(KF_MIN 6.0)

find_package(ECM ${KF_MIN} REQUIRED NO_MODULE)
list(APPEND CMAKE_MODULE_PATH ${ECM_MODULE_PATH})
include(KDEInstallDirs)

find_package(Qt6 ${QT_MIN} REQUIRED COMPONENTS Core Gui Widgets Qml Quick QuickWidgets QuickControls2 DBus LinguistTools)
find_package(KF6 ${KF_MIN} REQUIRED COMPONENTS KCMUtils ColorScheme Config CoreAddons)
find_package(PkgConfig REQUIRED)
pkg_check_modules(GIO REQUIRED IMPORTED_TARGET gio-2.0)

qt_standard_project_setup(REQUIRES ${QT_MIN})

qt_add_executable(hypede-settings
    src/main.cpp
    src/mainwindow.cpp src/mainwindow.h
    src/kcmhost.cpp src/kcmhost.h
    src/gsettingsobject.cpp src/gsettingsobject.h
    src/system.cpp src/system.h
)

set_source_files_properties(qml/Theme.qml PROPERTIES QT_QML_SINGLETON_TYPE TRUE)
set_source_files_properties(qml/Catalog.qml PROPERTIES QT_QML_SINGLETON_TYPE TRUE)

qt_add_qml_module(hypede-settings
    URI HypeSettings
    VERSION 1.0
    QML_FILES
        qml/Main.qml
        qml/Theme.qml
        qml/Catalog.qml
        qml/TitleBar.qml
        qml/SearchField.qml
        qml/NavItem.qml
        qml/Card.qml
        qml/SectionTitle.qml
        qml/SettingRow.qml
        qml/ChromeSwitch.qml
        qml/ChromeSlider.qml
        qml/ChromeCombo.qml
        qml/ChromeButton.qml
        qml/SymbolIcon.qml
        qml/PageView.qml
        qml/RowDelegate.qml
        qml/KcmView.qml
        qml/SearchResults.qml
        qml/WallpaperGrid.qml
        qml/ThemePicker.qml
        qml/AccentPicker.qml
        qml/InputSources.qml
        qml/AboutHeader.qml
    SOURCES
        src/kcmhost.h
        src/gsettingsobject.h
        src/system.h
)

# QML компилируется только в байт-код, без перевода в C++ (AOT): иначе на
# каждый .qml появляется тяжёлый C++-файл, и сборка съедает гигабайты памяти.
# Для окна настроек разница в скорости работы незаметна.
set_target_properties(hypede-settings PROPERTIES QT_QMLCACHEGEN_ARGUMENTS "--only-bytecode")

# Перевод собирается напрямую через lrelease, а не qt_add_translations():
# та ломается, если в пути к исходникам есть скобки — например, в папке
# «devHypeDE(1)», которую браузер создаёт при повторной загрузке архива.
set(HYPEDE_TS ${CMAKE_CURRENT_SOURCE_DIR}/translations/hypede-settings_ru.ts)
set(HYPEDE_QM ${CMAKE_CURRENT_BINARY_DIR}/hypede-settings_ru.qm)
add_custom_command(
    OUTPUT ${HYPEDE_QM}
    COMMAND Qt6::lrelease -silent ${HYPEDE_TS} -qm ${HYPEDE_QM}
    DEPENDS ${HYPEDE_TS}
    VERBATIM
)
set_source_files_properties(${HYPEDE_QM} PROPERTIES QT_RESOURCE_ALIAS hypede-settings_ru.qm)
qt_add_resources(hypede-settings hypede_translations PREFIX /i18n FILES ${HYPEDE_QM})

# Обновить .ts по исходникам: cmake --build <каталог> --target update_translations
add_custom_target(update_translations
    COMMAND Qt6::lupdate -no-obsolete -silent ${CMAKE_CURRENT_SOURCE_DIR}/src ${CMAKE_CURRENT_SOURCE_DIR}/qml -ts ${HYPEDE_TS}
    VERBATIM
)

target_include_directories(hypede-settings PRIVATE src)

target_compile_definitions(hypede-settings PRIVATE
    HYPEDE_VERSION="${PROJECT_VERSION}"
    HYPEDE_DATADIR="${CMAKE_INSTALL_FULL_DATADIR}/hypede"
    QT_NO_KEYWORDS
)

target_link_libraries(hypede-settings PRIVATE
    Qt6::Core Qt6::Gui Qt6::Widgets Qt6::Qml Qt6::Quick Qt6::QuickWidgets Qt6::QuickControls2 Qt6::DBus
    KF6::KCMUtils KF6::KCMUtilsCore KF6::ColorScheme KF6::ConfigCore KF6::CoreAddons
    PkgConfig::GIO
)

install(TARGETS hypede-settings RUNTIME DESTINATION ${KDE_INSTALL_BINDIR})
install(FILES colors/HypeDELight.colors colors/HypeDEDark.colors DESTINATION ${KDE_INSTALL_DATADIR}/color-schemes)
