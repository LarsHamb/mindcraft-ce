package de.cheesy.voice;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.message.v1.ServerMessageEvents;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Lars, 18.11.: "!npc aus" / "!npc an" - each player can switch off the NPC's chat messages for himself.
 * The command line is not sent to the chat; the setting is kept per player UUID in config/cheesy-npc-mute.json.
 * Messages of the NPC players (config/cheesy-voice.json "npcPlayers", default CheesyNPC) are then not sent to
 * that player (ServerPlayerChatMixin, at the per-recipient send). Everyone else sees everything; the bot still
 * reads all chat. Voice is not touched.
 */
public final class NpcChat implements ModInitializer {
    private static final Logger LOG = Logger.getLogger("cheesy_voice");
    private static final Path FILE = Path.of("config", "cheesy-npc-mute.json");
    private static final Pattern CMD = Pattern.compile("^ *!npc(?: +([^ ]+))? *$", Pattern.CASE_INSENSITIVE);
    static final Set<UUID> MUTED = ConcurrentHashMap.newKeySet();
    static final Set<UUID> BOTS = ConcurrentHashMap.newKeySet();
    static final Set<String> BOT_NAMES = ConcurrentHashMap.newKeySet();

    @Override
    public void onInitialize() {
        load();
        ServerMessageEvents.ALLOW_CHAT_MESSAGE.register((message, sender, params) -> {
            if (BOT_NAMES.contains(sender.getPlainTextName().toLowerCase(Locale.ROOT))) {
                BOTS.add(sender.getUUID());
                return true;
            }
            Matcher m = CMD.matcher(message.signedContent());
            if (!m.matches()) return true;
            command(sender, m.group(1));
            return false; // never broadcast the command line
        });
        LOG.info("NPC chat filter: bots " + BOT_NAMES + ", " + MUTED.size() + " player(s) muted");
    }

    /** Called per recipient from the mixin: drop this NPC message for a muted player. */
    public static boolean hidden(UUID recipient, UUID sender) {
        return sender != null && MUTED.contains(recipient) && BOTS.contains(sender);
    }

    private static void command(ServerPlayer player, String arg) {
        String a = arg == null ? "" : arg.toLowerCase(Locale.ROOT);
        UUID id = player.getUUID();
        if (a.matches("aus|stumm|off|mute|leise")) {
            MUTED.add(id); save();
            player.sendSystemMessage(Component.literal("§7[NPC] Du siehst die Chat-Nachrichten des NPC jetzt nicht mehr. Wieder an: §f!npc an"));
        } else if (a.matches("an|ein|on|unmute|laut")) {
            MUTED.remove(id); save();
            player.sendSystemMessage(Component.literal("§7[NPC] Du siehst die Chat-Nachrichten des NPC wieder. Aus: §f!npc aus"));
        } else {
            player.sendSystemMessage(Component.literal("§7[NPC] Chat des NPC fuer dich: " + (MUTED.contains(id) ? "§caus" : "§aan")
                    + "§7. Umschalten: §f!npc aus §7oder §f!npc an"));
        }
        LOG.info("NPC chat for " + player.getPlainTextName() + ": " + (MUTED.contains(id) ? "muted" : "on"));
    }

    private static void load() {
        BOT_NAMES.add("cheesynpc");
        try {
            Path cfg = Path.of("config", "cheesy-voice.json");
            if (Files.exists(cfg)) {
                JSONArray names = new JSONObject(Files.readString(cfg, StandardCharsets.UTF_8)).optJSONArray("npcPlayers");
                if (names != null) { BOT_NAMES.clear(); for (int i = 0; i < names.length(); i++) BOT_NAMES.add(names.getString(i).toLowerCase(Locale.ROOT)); }
            }
        } catch (Exception e) { LOG.warning("NPC chat filter: npcPlayers not readable: " + e.getMessage()); }
        try {
            if (Files.exists(FILE)) {
                JSONArray list = new JSONObject(Files.readString(FILE, StandardCharsets.UTF_8)).optJSONArray("muted");
                if (list != null) for (int i = 0; i < list.length(); i++) MUTED.add(UUID.fromString(list.getString(i)));
            }
        } catch (Exception e) { LOG.warning("NPC chat filter: " + FILE + " not readable: " + e.getMessage()); }
    }

    private static synchronized void save() {
        try {
            JSONArray list = new JSONArray();
            for (UUID id : MUTED) list.put(id.toString());
            Files.createDirectories(FILE.getParent());
            Files.writeString(FILE, new JSONObject().put("muted", list).toString(1), StandardCharsets.UTF_8);
        } catch (Exception e) { LOG.warning("NPC chat filter: could not save: " + e.getMessage()); }
    }
}
