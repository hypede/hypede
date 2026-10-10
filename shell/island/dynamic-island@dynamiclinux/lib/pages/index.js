// Реестр вкладок раскрытого острова.

import {HomePage} from './home.js';
import {LauncherPage} from './launcher.js';
import {ClipboardPage} from './clipboard.js';
import {ShelfPage} from './shelf.js';
import {AIPage} from './ai.js';
import {ToolsPage} from './tools.js';
import {TextPage} from './text.js';
import {NotesPage} from './notes.js';
import {CalcPage} from './calc.js';
import {SystemPage} from './system.js';
import {WeatherPage} from './weather.js';
import {TimerPage} from './timer.js';
import {PetPage} from './pet.js';
import {SettingsPage} from './settings.js';

export {TAB_INFO} from '../pure/tabs.js';
import {TAB_INFO} from '../pure/tabs.js';

const CLASSES = {
    home: HomePage,
    launcher: LauncherPage,
    clipboard: ClipboardPage,
    shelf: ShelfPage,
    ai: AIPage,
    tools: ToolsPage,
    text: TextPage,
    notes: NotesPage,
    calc: CalcPage,
    system: SystemPage,
    weather: WeatherPage,
    timer: TimerPage,
    pet: PetPage,
    settings: SettingsPage,
};

export const PAGES = Object.fromEntries(
    Object.entries(TAB_INFO).map(([id, info]) => [id, {...info, Page: CLASSES[id]}]));
