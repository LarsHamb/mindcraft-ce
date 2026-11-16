// Protected areas: player bases where the bot must not break or place blocks.
// settings.protected_areas = [{"name": "Lars Haus", "x": 268, "z": -160, "radius": 40}]
// (a cylinder over all heights; optional "dimension": "overworld").
// Enforced at the lowest level (bot.dig, bot._genericPlace) so every skill, tool and the
// pathfinder's own digging/scaffolding respect it; the pathfinder also plans around it.
import settings from '../settings.js';

function areas() {
    const list = settings.protected_areas;
    return Array.isArray(list) ? list.filter(a => [a?.x, a?.z, a?.radius].every(Number.isFinite)) : [];
}

export function protectedAreaAt(bot, pos) {
    if (!pos) return null;
    const dim = String(bot?.game?.dimension || 'overworld').replace('minecraft:', '');
    for (const a of areas()) {
        if (a.dimension && String(a.dimension).replace('minecraft:', '') !== dim) continue;
        const dx = pos.x - a.x, dz = pos.z - a.z;
        if (dx * dx + dz * dz <= a.radius * a.radius) return a;
    }
    return null;
}

function refusal(area, what, pos) {
    const err = new Error(`${what} at ${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)} refused: protected area "${area.name || 'player base'}". Work outside it.`);
    err.code = 'protected_area';
    return err;
}

function guardMovements(bot, movements) {
    if (!movements || movements.__protected) return movements;
    const veto = block => (block?.position && protectedAreaAt(bot, block.position) ? 100000 : 0);
    movements.exclusionAreasBreak?.push(veto);
    movements.exclusionAreasPlace?.push(veto);
    movements.__protected = true;
    return movements;
}

export function installProtection(bot) {
    if (bot.__protectionInstalled) return;
    bot.__protectionInstalled = true;
    const dig = bot.dig;
    if (typeof dig === 'function') {
        bot.dig = async function (block, ...rest) {
            const area = protectedAreaAt(bot, block?.position);
            if (area) throw refusal(area, `Breaking ${block.name}`, block.position);
            return await dig.call(this, block, ...rest);
        };
    }
    const place = bot._genericPlace;
    if (typeof place === 'function') {
        bot._genericPlace = async function (referenceBlock, faceVector, ...rest) {
            const target = referenceBlock?.position && faceVector ? referenceBlock.position.plus(faceVector) : null;
            const area = protectedAreaAt(bot, target);
            if (area) throw refusal(area, 'Placing a block', target);
            return await place.call(this, referenceBlock, faceVector, ...rest);
        };
    }
    const setMovements = bot.pathfinder?.setMovements;
    if (typeof setMovements === 'function') {
        bot.pathfinder.setMovements = function (movements, ...rest) {
            return setMovements.call(this, guardMovements(bot, movements), ...rest);
        };
        if (bot.pathfinder.movements) guardMovements(bot, bot.pathfinder.movements);
    }
    if (areas().length) console.log(`Protected areas active: ${areas().map(a => `${a.name || '?'} (${a.x}, ${a.z}, r ${a.radius})`).join('; ')}`);
}
