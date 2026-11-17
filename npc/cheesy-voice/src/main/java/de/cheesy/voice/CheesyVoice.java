package de.cheesy.voice;

import com.gadgetman.jarvis.voice.GeminiLive;
import com.gadgetman.jarvis.voice.LiveTools;
import de.maxhenkel.voicechat.api.Position;
import de.maxhenkel.voicechat.api.ServerLevel;
import de.maxhenkel.voicechat.api.VoicechatApi;
import de.maxhenkel.voicechat.api.VoicechatConnection;
import de.maxhenkel.voicechat.api.VoicechatPlugin;
import de.maxhenkel.voicechat.api.VoicechatServerApi;
import de.maxhenkel.voicechat.api.audiochannel.AudioPlayer;
import de.maxhenkel.voicechat.api.audiochannel.LocationalAudioChannel;
import de.maxhenkel.voicechat.api.events.EventRegistration;
import de.maxhenkel.voicechat.api.events.MicrophonePacketEvent;
import de.maxhenkel.voicechat.api.events.PlayerConnectedEvent;
import de.maxhenkel.voicechat.api.events.PlayerDisconnectedEvent;
import de.maxhenkel.voicechat.api.events.VoicechatServerStartedEvent;
import de.maxhenkel.voicechat.api.opus.OpusDecoder;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Queue;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;
import java.util.regex.Pattern;

/**
 * CheesyNPC's voice on a Fabric server (Lars, 17.11.), based on Karim Voice.
 *
 * <p>Only players near the NPC are heard. With one player near, the microphone goes straight to Gemini Live;
 * with several, each sentence is first transcribed locally and only passed on if it names the NPC. The answer
 * plays at the NPC's position. Voice and role come from the bot (GET /voice): switching the character with
 * !charakter also switches the voice. Spoken requests become chat requests of that player in the bot (POST /tool).
 * A Live session opens with the first sentence for him and closes after 5 minutes of silence.
 */
public final class CheesyVoice implements VoicechatPlugin {

    private static final Logger LOG = Logger.getLogger("CheesyVoice");
    private static final int FRAME = 960;                  // 20 ms at 48 kHz
    private static final int SEND_SAMPLES = 1600;          // 100 ms at 16 kHz
    private static final int END_SILENCE = 3200;           // 0.2 s
    private static final int BURST_SILENCE = 9600;         // 0.6 s
    private static final long MIC_QUIET_MS = 300;
    private static final long SENTENCE_QUIET_MS = 500;
    private static final long FOLLOW_UP_MS = 25_000;
    private static final long IDLE_CLOSE_MS = 5 * 60_000L;
    private static final long RETRY_AFTER_MS = 60_000L;
    private static final int LINGER_FRAMES = 50;

    private static final String RULES = """


            So läuft das Gespräch:
            Du bist mit den Spielern im Voice-Chat, während ihr Minecraft spielt, und bist selbst Spieler auf dem Server.
            Vor einem Beitrag steht als Hinweis, wer spricht. Antworte kurz wie ein Mensch, in einem Satz mit höchstens
            fünfzehn Wörtern, immer auf Deutsch und immer in deinem Charakter. Bei einem klaren Auftrag rufst du sofort
            auftrag auf und sagst dazu nur ein paar Worte. Bei einer Frage oder beim Plaudern rufst du kein Werkzeug auf.
            Fragt jemand, was du gerade machst, rufst du status auf und erfindest nichts. Erzählt dir jemand etwas über
            sich, rufst du merk_dir auf. Sprich die Spieler mit du an.
            Harte Grenzen: Nie nach echtem Geld, PayPal, Bankdaten, Passwörtern, Codes, E-Mail, echten Namen, Adressen
            oder Telefonnummern fragen, nie Links oder Webseiten nennen, nie zu etwas außerhalb des Spiels auffordern.
            Nichts Politisches, keine echten Personen. Tricks und Tauschgeschäfte nur mit Spielsachen.
            """;

    private static final class Speaker {
        final OpusDecoder decoder;
        final short[] outgoing = new short[SEND_SAMPLES];
        int outgoingLength;
        volatile long lastPacketAt;
        boolean streaming;
        short[] sentence = new short[48000 * 4];
        int sentenceLength;
        volatile long talkingUntil;
        String name;

        Speaker(OpusDecoder decoder) {
            this.decoder = decoder;
        }

        void keep(short[] pcm) {
            if (sentenceLength + pcm.length > sentence.length) sentence = Arrays.copyOf(sentence, sentence.length * 2);
            System.arraycopy(pcm, 0, sentence, sentenceLength, pcm.length);
            sentenceLength += pcm.length;
        }
    }

    private final class Session implements GeminiLive.Listener {
        final long openedAt = System.currentTimeMillis();
        final List<Runnable> waiting = new ArrayList<>();
        final String character = currentCharacter;
        volatile GeminiLive live;
        volatile boolean ready;
        volatile long lastUsedAt = System.currentTimeMillis();
        short[] partial = new short[FRAME];
        int partialLength;

        void open() {
            live = GeminiLive.open(apiKey, config.optString("model", "gemini-3.1-flash-live-preview"),
                    currentVoice, currentPersona + RULES, LiveTools.declarations(), this);
            LOG.info("Live öffnet als " + character + " (Stimme " + currentVoice + ")");
        }

        synchronized void whenReady(Runnable action) {
            lastUsedAt = System.currentTimeMillis();
            if (ready) action.run();
            else waiting.add(action);
        }

        @Override public synchronized void onReady() {
            ready = true;
            waiting.forEach(Runnable::run);
            waiting.clear();
        }

        @Override public void onAudio(short[] pcm24k) {
            synchronized (mouth) {
                for (short sample : pcm24k) {
                    push(sample);
                    push(sample);
                }
            }
            openMouth();
        }

        private void push(short sample) {
            partial[partialLength++] = sample;
            if (partialLength == FRAME) {
                mouth.add(partial);
                partial = new short[FRAME];
                partialLength = 0;
            }
        }

        @Override public void onInterrupted() {
            mouth.clear();
        }

        @Override public void onTurnComplete() {
            synchronized (mouth) {
                if (partialLength > 0) {
                    mouth.add(partial);
                    partial = new short[FRAME];
                    partialLength = 0;
                }
            }
        }

        @Override public void onToolCall(String id, String name, JSONObject args) {
            LOG.info("Werkzeug " + name + " " + args);
            String body = new JSONObject().put("name", name).put("args", args).put("speaker", lastSpeaker).toString();
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(config.getString("botUrl") + "/tool"))
                    .timeout(Duration.ofSeconds(5))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
            http.sendAsync(request, HttpResponse.BodyHandlers.ofString()).handle((response, error) -> {
                String result = error != null || response.statusCode() != 200
                        ? "Mein Körper reagiert gerade nicht."
                        : new JSONObject(response.body()).optString("result", "ok");
                GeminiLive current = live;
                if (current != null) current.sendToolResult(id, name, result);
                return null;
            });
        }

        @Override public void onUsage(JSONObject usage) {
            long audioIn = 0;
            long textIn = 0;
            JSONArray details = usage.optJSONArray("promptTokensDetails");
            for (int i = 0; details != null && i < details.length(); i++) {
                JSONObject row = details.getJSONObject(i);
                if ("AUDIO".equals(row.optString("modality"))) audioIn += row.optLong("tokenCount");
                else textIn += row.optLong("tokenCount");
            }
            double turn = audioIn * 3e-6 + textIn * 0.75e-6 + usage.optLong("responseTokenCount") * 12e-6;
            spentDollars += turn;
            LOG.info(String.format(Locale.ROOT, "Kosten: Antwort $%.4f, gesamt seit Start $%.3f", turn, spentDollars));
        }

        @Override public void onClosed(String reason) {
            LOG.warning("Live getrennt: " + reason);
            ready = false;
            if (session == this) session = null;
            if (System.currentTimeMillis() - openedAt < 10_000) blockedUntil = System.currentTimeMillis() + RETRY_AFTER_MS;
        }
    }

    private final Queue<short[]> mouth = new ConcurrentLinkedQueue<>();
    private final Map<UUID, Speaker> speakers = new ConcurrentHashMap<>();
    private final Map<UUID, VoicechatConnection> connected = new ConcurrentHashMap<>();
    private final HttpClient http = HttpClient.newHttpClient();
    private final ScheduledExecutorService clock = Executors.newSingleThreadScheduledExecutor();
    private final Set<String> players = new HashSet<>();

    private JSONObject config;
    private String apiKey;
    private Pattern called;
    private double near;
    private VoicechatServerApi api;
    private volatile Session session;
    private volatile long blockedUntil;
    private volatile String lastSpeaker = "";
    private volatile double spentDollars;
    private volatile double[] botPos;
    private volatile String currentCharacter = "";
    private volatile String currentVoice = "Charon";
    private volatile String currentPersona = "Du bist CheesyNPC, ein Mitspieler auf diesem Minecraft-Server.";
    private volatile AudioPlayer player;
    private volatile LocationalAudioChannel channel;
    private int quietFrames;

    @Override public String getPluginId() {
        return "cheesy_voice";
    }

    @Override public void initialize(VoicechatApi voicechat) {
        try {
            config = new JSONObject(Files.readString(Path.of("config", "cheesy-voice.json"), StandardCharsets.UTF_8));
            apiKey = config.optString("apiKey", "");
            if (apiKey.isBlank() && config.has("apiKeyFile"))
                apiKey = new JSONObject(Files.readString(Path.of(config.getString("apiKeyFile")), StandardCharsets.UTF_8)).optString("apiKey", "");
            JSONArray list = config.optJSONArray("players");
            for (int i = 0; list != null && i < list.length(); i++) players.add(list.getString(i).toLowerCase(Locale.ROOT));
            called = Pattern.compile("(?s).*\\b(" + config.optString("names",
                    "cheesy|chesy|chessy|cheezy|tschisi|tschiesi|cheese|minister|kriegsminister|hmmbert|humbert|anja|momberger|npc") + ")\\b.*");
            near = config.optDouble("nearBlocks", 32);
            LOG.info("CheesyNPC Voice bereit" + (players.isEmpty() ? ", alle Spieler" : ", Spieler: " + players)
                    + (apiKey.isBlank() ? ", ABER kein API-Key" : ""));
        } catch (Exception e) {
            LOG.severe("config/cheesy-voice.json fehlt oder ist kaputt: " + e.getMessage());
        }
    }

    @Override public void registerEvents(EventRegistration registration) {
        registration.registerEvent(VoicechatServerStartedEvent.class, this::onStarted);
        registration.registerEvent(PlayerConnectedEvent.class, event -> {
            VoicechatConnection connection = event.getConnection();
            connected.put(connection.getPlayer().getUuid(), connection);
        });
        registration.registerEvent(PlayerDisconnectedEvent.class, event -> {
            connected.remove(event.getPlayerUuid());
            speakers.remove(event.getPlayerUuid());
        });
        registration.registerEvent(MicrophonePacketEvent.class, this::onMicrophone);
    }

    private void onStarted(VoicechatServerStartedEvent event) {
        api = event.getVoicechat();
        api.registerVolumeCategory(api.volumeCategoryBuilder().setId("cheesynpc").setName("CheesyNPC")
                .setDescription("Lautstärke von CheesyNPC").build());
        clock.scheduleAtFixedRate(() -> {
            try {
                sweep();
            } catch (RuntimeException e) {
                LOG.warning("Sweep: " + e.getMessage());
            }
        }, 100, 100, TimeUnit.MILLISECONDS);
        clock.scheduleAtFixedRate(this::pollBot, 2, 3, TimeUnit.SECONDS);
    }

    /** Where the NPC is, which character it plays and with which voice. Only while someone is in voice chat. */
    private void pollBot() {
        if (config == null || connected.isEmpty() || !config.has("botUrl")) return;
        HttpRequest request = HttpRequest.newBuilder().uri(URI.create(config.getString("botUrl") + "/voice"))
                .timeout(Duration.ofSeconds(2)).GET().build();
        http.sendAsync(request, HttpResponse.BodyHandlers.ofString()).thenAccept(response -> {
            if (response.statusCode() != 200) return;
            JSONObject answer = new JSONObject(response.body());
            JSONArray pos = answer.optJSONArray("pos");
            botPos = pos == null ? null : new double[]{pos.getDouble(0), pos.getDouble(1), pos.getDouble(2)};
            String character = answer.optString("character", "");
            currentVoice = answer.optString("voice", currentVoice);
            currentPersona = answer.optString("persona", currentPersona);
            if (!character.equals(currentCharacter)) {
                currentCharacter = character;
                Session current = session;
                if (current != null && !character.equals(current.character)) {
                    LOG.info("Charakter gewechselt: " + character + ", neue Stimme " + currentVoice);
                    session = null;
                    current.ready = false;
                    current.live.close();
                }
            }
            String cue = answer.optString("cue", "");
            if (!cue.isBlank() && usable() && nearCount() > 0) {
                Session current = session();
                current.whenReady(() -> current.live.sendCue(cue));
            }
        }).exceptionally(e -> null);
    }

    private double distanceToBot(VoicechatConnection connection) {
        double[] b = botPos;
        if (b == null) return Double.MAX_VALUE;
        Position p = connection.getPlayer().getPosition();
        double dx = p.getX() - b[0], dy = p.getY() - b[1], dz = p.getZ() - b[2];
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    private long nearCount() {
        return connected.values().stream().filter(c -> distanceToBot(c) <= near).count();
    }

    /** The name is in the Minecraft player; the voice API only knows the UUID. */
    private String nameOf(VoicechatConnection connection) {
        try {
            Object p = connection.getPlayer().getPlayer();
            return (String) p.getClass().getMethod("getScoreboardName").invoke(p);
        } catch (ReflectiveOperationException | RuntimeException e) {
            return "";
        }
    }

    private boolean usable() {
        return config != null && api != null && !apiKey.isBlank() && System.currentTimeMillis() >= blockedUntil;
    }

    private synchronized Session session() {
        Session current = session;
        if (current == null) {
            current = new Session();
            session = current;
            current.open();
        }
        return current;
    }

    private void onMicrophone(MicrophonePacketEvent event) {
        VoicechatConnection sender = event.getSenderConnection();
        if (sender == null || !usable()) return;
        // only players near the NPC: nobody pays for voices far away
        if (distanceToBot(sender) > near) return;
        byte[] opus = event.getPacket().getOpusEncodedData();
        if (opus == null || opus.length == 0) return;
        UUID id = sender.getPlayer().getUuid();
        Speaker speaker = speakers.computeIfAbsent(id, key -> new Speaker(api.createDecoder()));
        if (speaker.name == null || speaker.name.isEmpty()) speaker.name = nameOf(sender);
        if (!players.isEmpty() && !players.contains(speaker.name.toLowerCase(Locale.ROOT))) return;
        short[] pcm = speaker.decoder.decode(opus);
        if (pcm == null || pcm.length == 0) return;
        if (channel == null) level = sender.getPlayer().getServerLevel();
        synchronized (speaker) {
            speaker.lastPacketAt = System.currentTimeMillis();
            if (nearCount() > 1) speaker.keep(pcm);
            else stream(speaker, pcm);
        }
    }

    private volatile ServerLevel level;

    private void stream(Speaker speaker, short[] pcm) {
        Session current = session();
        if (!speaker.streaming) {
            speaker.streaming = true;
            current.whenReady(() -> {
                announce(current, speaker.name);
                current.live.startSpeech();
            });
        }
        for (int i = 0; i + 2 < pcm.length; i += 3) {
            speaker.outgoing[speaker.outgoingLength++] = (short) ((pcm[i] + pcm[i + 1] + pcm[i + 2]) / 3);
            if (speaker.outgoingLength == SEND_SAMPLES) flush(current, speaker);
        }
    }

    private void flush(Session current, Speaker speaker) {
        if (speaker.outgoingLength == 0) return;
        short[] chunk = Arrays.copyOf(speaker.outgoing, speaker.outgoingLength);
        speaker.outgoingLength = 0;
        current.whenReady(() -> current.live.sendAudio(chunk));
    }

    private void announce(Session current, String name) {
        if (!name.equals(lastSpeaker)) current.live.sendNote("[Jetzt spricht " + name + "]");
        lastSpeaker = name;
    }

    private void sweep() {
        long now = System.currentTimeMillis();
        for (Speaker speaker : speakers.values()) {
            synchronized (speaker) {
                if (speaker.streaming && now - speaker.lastPacketAt >= MIC_QUIET_MS) {
                    speaker.streaming = false;
                    Session current = session();
                    flush(current, speaker);
                    current.whenReady(() -> {
                        current.live.sendAudio(new short[END_SILENCE]);
                        current.live.endSpeech();
                    });
                }
                if (speaker.sentenceLength > 0 && now - speaker.lastPacketAt >= SENTENCE_QUIET_MS) {
                    short[] sentence = Arrays.copyOf(speaker.sentence, speaker.sentenceLength);
                    speaker.sentenceLength = 0;
                    Thread.startVirtualThread(() -> judge(speaker, sentence));
                }
            }
        }
        Session current = session;
        if (current != null && now - current.lastUsedAt > IDLE_CLOSE_MS) {
            session = null;
            current.ready = false;
            current.live.close();
        }
        LocationalAudioChannel c = channel;
        double[] b = botPos;
        if (c != null && b != null) c.updateLocation(api.createPosition(b[0], b[1] + 1.6, b[2]));
    }

    /** Several players near: transcribe locally and pass on only sentences meant for him. */
    private void judge(Speaker speaker, short[] pcm48k) {
        if (pcm48k.length < 48000 * 0.4) return;
        short[] pcm = new short[pcm48k.length / 3];
        for (int i = 0; i < pcm.length; i++) {
            int j = i * 3;
            pcm[i] = (short) ((pcm48k[j] + pcm48k[j + 1] + pcm48k[j + 2]) / 3);
        }
        long now = System.currentTimeMillis();
        if (now >= speaker.talkingUntil) {
            String text = transcribe(pcm);
            if (text == null || text.isBlank() || !called.matcher(text.toLowerCase(Locale.ROOT)).matches()) return;
        }
        speaker.talkingUntil = now + FOLLOW_UP_MS;
        short[] padded = Arrays.copyOf(pcm, pcm.length + BURST_SILENCE);
        Session current = session();
        current.whenReady(() -> {
            announce(current, speaker.name);
            current.live.startSpeech();
            for (int at = 0; at < padded.length; at += 16000) {
                current.live.sendAudio(Arrays.copyOfRange(padded, at, Math.min(padded.length, at + 16000)));
            }
            current.live.endSpeech();
        });
    }

    private String transcribe(short[] pcm16k) {
        try {
            byte[] wav = wav(pcm16k);
            String boundary = "cheesy" + System.nanoTime();
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            String head = "--" + boundary + "\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n"
                    + config.optString("sttModel", "Systran/faster-whisper-base") + "\r\n--" + boundary
                    + "\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\nde\r\n--" + boundary
                    + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"s.wav\"\r\nContent-Type: audio/wav\r\n\r\n";
            body.write(head.getBytes(StandardCharsets.UTF_8));
            body.write(wav);
            body.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(config.optString("sttUrl", "http://127.0.0.1:8000") + "/v1/audio/transcriptions"))
                    .timeout(Duration.ofSeconds(15))
                    .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                    .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray()))
                    .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            return response.statusCode() == 200 ? new JSONObject(response.body()).optString("text", "") : null;
        } catch (Exception e) {
            LOG.warning("Spracherkennung: " + e.getMessage());
            return null;
        }
    }

    private static byte[] wav(short[] pcm) {
        ByteBuffer out = ByteBuffer.allocate(44 + pcm.length * 2).order(ByteOrder.LITTLE_ENDIAN);
        out.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36 + pcm.length * 2);
        out.put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short) 1).putShort((short) 1);
        out.putInt(16000).putInt(32000).putShort((short) 2).putShort((short) 16);
        out.put("data".getBytes(StandardCharsets.US_ASCII)).putInt(pcm.length * 2);
        for (short sample : pcm) out.putShort(sample);
        return out.array();
    }

    private short[] nextFrame() {
        short[] frame = mouth.poll();
        if (frame != null) {
            quietFrames = 0;
            return frame;
        }
        return ++quietFrames > LINGER_FRAMES ? null : new short[FRAME];
    }

    /** His voice comes from where he stands: everyone near hears it there. */
    private synchronized void openMouth() {
        if (player != null) return;
        double[] b = botPos;
        ServerLevel l = level;
        if (b == null || l == null) return;
        if (channel == null) {
            channel = api.createLocationalAudioChannel(UUID.randomUUID(), l, api.createPosition(b[0], b[1] + 1.6, b[2]));
            if (channel == null) return;
            channel.setCategory("cheesynpc");
            channel.setDistance((float) Math.max(16, near));
        }
        quietFrames = 0;
        AudioPlayer p = api.createAudioPlayer(channel, api.createEncoder(), this::nextFrame);
        p.setOnStopped(() -> player = null);
        player = p;
        p.startPlaying();
    }
}
