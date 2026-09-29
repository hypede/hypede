// Расширения GNOME в сеансе HypeDE.
//
// HypeDE сам собирает облик оболочки, и сторонние расширения, включённые
// для обычного GNOME, здесь только мешали бы: двигали бы панель, меняли бы
// стили, ломали бы полку. Поэтому в сеансе HypeDE оболочка включает только
// свои компоненты — а в «Настройках» это можно разрешить
// (dev.hypede.session allow-gnome-extensions).
//
// Заодно компоненты HypeDE остаются включёнными на экране блокировки: у
// режима блокировки собственный (пустой) список расширений.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

export class ExtensionGuard {
    constructor(uuid, sessionSettings) {
        this._uuid = uuid;
        this._settings = sessionSettings;
        this._injections = new InjectionManager();
        const manager = Main.extensionManager;
        this._manager = manager;
        // Расширения из режима hypede запоминаются сразу: у режима
        // блокировки свой, пустой список, а на экране блокировки они
        // должны остаться (если поддерживают его).
        this._modeExtensions = [...manager._getModeExtensions()];

        const guard = this;
        this._injections.overrideMethod(manager, '_getEnabledExtensions',
            original => function (...args) {
                const enabled = original.apply(this, args);
                const allowed = enabled.filter(uuid => guard._isAllowed(uuid));
                return [...new Set([guard._uuid, ...guard._modeExtensions, ...allowed])];
            });
        this._injections.overrideMethod(manager, '_callExtensionEnable',
            original => function (uuid, ...args) {
                if (!guard._isAllowed(uuid))
                    return Promise.resolve();
                return original.call(this, uuid, ...args);
            });

        this._settings.connectObject('changed::allow-gnome-extensions',
            () => this._sync(), this);
        this._sync();
    }

    get _allowOthers() {
        return this._settings.get_boolean('allow-gnome-extensions');
    }

    _isAllowed(uuid) {
        return this._allowOthers || uuid === this._uuid ||
            this._modeExtensions.includes(uuid) ||
            this._manager._getModeExtensions().includes(uuid);
    }

    // Выключить то, что уже успело включиться, или включить разрешённое.
    _sync() {
        this._manager._onEnabledExtensionsChanged().catch(logError);
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._injections.clear();
    }
}
