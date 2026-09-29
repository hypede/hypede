// Только для разработки. Не входит в пакет.
//
// Включает небезопасный режим (скриншоты и Eval через D-Bus) и отключает
// родительский контроль: в контейнере без AccountsService GNOME иначе
// прячет все приложения из избранного.
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as ParentalControlsManager from 'resource:///org/gnome/shell/misc/parentalControlsManager.js';

export default class DevkitExtension extends Extension {
    enable() {
        global.context.unsafe_mode = true;
        const manager = ParentalControlsManager.getDefault();
        manager._disabled = true;
        manager.emit('app-filter-changed');
    }

    disable() {
        global.context.unsafe_mode = false;
    }
}
