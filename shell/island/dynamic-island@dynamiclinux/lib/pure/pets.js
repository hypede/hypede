// Каталог питомцев (используется и в prefs.js, поэтому без импортов gi).
// facesLeft — эмодзи смотрит влево (нужно для отражения при ходьбе).

export const PETS = {
    // Clawd — маскот Claude (рисуется пиксель-артом, эмодзи — только для текста)
    clawd: {emoji: '🦀', name: 'Clawd', food: '🍪', toy: '⌨️', facesLeft: false, sprite: 'clawd'},
    cat: {emoji: '🐈', name: 'Кот', food: '🐟', toy: '🧶', facesLeft: true},
    blackcat: {emoji: '🐈‍⬛', name: 'Чёрный кот', food: '🐟', toy: '🧶', facesLeft: true},
    dog: {emoji: '🐕', name: 'Собака', food: '🦴', toy: '🎾', facesLeft: true},
    poodle: {emoji: '🐩', name: 'Пудель', food: '🦴', toy: '🎾', facesLeft: true},
    fox: {emoji: '🦊', name: 'Лиса', food: '🍗', toy: '🍂', facesLeft: false},
    rabbit: {emoji: '🐇', name: 'Кролик', food: '🥕', toy: '🌼', facesLeft: true},
    hamster: {emoji: '🐹', name: 'Хомяк', food: '🌰', toy: '🎡', facesLeft: false},
    hedgehog: {emoji: '🦔', name: 'Ёжик', food: '🍎', toy: '🍄', facesLeft: true},
    penguin: {emoji: '🐧', name: 'Пингвин', food: '🐟', toy: '❄️', facesLeft: false},
    duck: {emoji: '🦆', name: 'Утка', food: '🍞', toy: '🫧', facesLeft: true},
    turtle: {emoji: '🐢', name: 'Черепаха', food: '🥬', toy: '🐚', facesLeft: true},
    dragon: {emoji: '🐉', name: 'Дракон', food: '🔥', toy: '💎', facesLeft: true},
    unicorn: {emoji: '🦄', name: 'Единорог', food: '🍭', toy: '🌈', facesLeft: true},
    dino: {emoji: '🦖', name: 'Динозавр', food: '🍖', toy: '🥚', facesLeft: true},
    snail: {emoji: '🐌', name: 'Улитка', food: '🥬', toy: '🍄', facesLeft: true},
    ghost: {emoji: '👻', name: 'Призрак', food: '🍬', toy: '🎃', facesLeft: false},
    robot: {emoji: '🤖', name: 'Робот', food: '🔋', toy: '⚙️', facesLeft: false},
    tux: {emoji: '🐧', name: 'Tux (Linux)', food: '🐟', toy: '💾', facesLeft: false},
};
