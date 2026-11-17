package com.gadgetman.jarvis.voice;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;

/**
 * One live conversation with Gemini: microphone audio goes up as it is spoken and
 * his voice comes back as it is made, with no text step between them. Sends are
 * chained, because a WebSocket takes only one at a time.
 */
public final class GeminiLive {

    private static final String ENDPOINT = "wss://generativelanguage.googleapis.com/ws/"
            + "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
    private static final String AUDIO_TYPE = "audio/pcm;rate=16000";

    /** What the conversation produces. Called on a WebSocket thread, never the server thread. */
    public interface Listener {
        void onReady();
        void onAudio(short[] pcm24k);
        void onInterrupted();
        void onTurnComplete();
        void onToolCall(String id, String name, JSONObject args);
        void onClosed(String reason);
        /** Token counts for the turn. The prompt count includes the whole conversation so far. */
        default void onUsage(JSONObject usage) { }
    }

    /** The conversation is billed again each turn, so old audio is dropped once it has grown. */
    private static final int COMPRESS_AT_TOKENS = 8000;
    private static final int COMPRESS_TO_TOKENS = 3000;

    private final Listener listener;
    private final StringBuilder incoming = new StringBuilder();
    private CompletableFuture<WebSocket> tail;
    private volatile boolean closed;

    private GeminiLive(Listener listener) {
        this.listener = listener;
    }

    /** Opens the conversation. Failure arrives through {@link Listener#onClosed}. */
    public static GeminiLive open(String apiKey, String model, String voice, String systemPrompt,
                                  JSONArray tools, Listener listener) {
        GeminiLive live = new GeminiLive(listener);
        JSONObject setup = setupMessage(model, voice, systemPrompt, tools);
        live.tail = HttpClient.newHttpClient().newWebSocketBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .header("x-goog-api-key", apiKey)
                .buildAsync(URI.create(ENDPOINT), live.new Reader())
                .thenCompose(socket -> socket.sendText(setup.toString(), true));
        live.tail.exceptionally(e -> {
            live.closed(e.getMessage());
            return null;
        });
        return live;
    }

    static JSONObject setupMessage(String model, String voice, String systemPrompt, JSONArray tools) {
        JSONObject speech = new JSONObject().put("voiceConfig", new JSONObject()
                .put("prebuiltVoiceConfig", new JSONObject().put("voiceName", voice)));
        return new JSONObject().put("setup", new JSONObject()
                .put("model", "models/" + model)
                .put("generationConfig", new JSONObject()
                        .put("responseModalities", new JSONArray().put("AUDIO"))
                        .put("speechConfig", speech))
                .put("systemInstruction", new JSONObject().put("parts", new JSONArray()
                        .put(new JSONObject().put("text", systemPrompt))))
                // Speech boundaries come from us, so a sentence can be sent only once it is known to be for him.
                .put("realtimeInputConfig", new JSONObject().put("automaticActivityDetection",
                        new JSONObject().put("disabled", true)))
                .put("contextWindowCompression", new JSONObject()
                        .put("triggerTokens", COMPRESS_AT_TOKENS)
                        .put("slidingWindow", new JSONObject().put("targetTokens", COMPRESS_TO_TOKENS)))
                .put("tools", new JSONArray().put(new JSONObject().put("functionDeclarations", tools))));
    }

    /** 16 kHz mono samples, sent as they are spoken. */
    public void sendAudio(short[] pcm16k) {
        ByteBuffer bytes = ByteBuffer.allocate(pcm16k.length * 2).order(ByteOrder.LITTLE_ENDIAN);
        for (short sample : pcm16k) bytes.putShort(sample);
        send(new JSONObject().put("realtimeInput", new JSONObject().put("audio", new JSONObject()
                .put("data", Base64.getEncoder().encodeToString(bytes.array()))
                .put("mimeType", AUDIO_TYPE))));
    }

    /** Someone starts speaking to him. This also cuts him off if he is still talking. */
    public void startSpeech() {
        send(new JSONObject().put("realtimeInput", new JSONObject().put("activityStart", new JSONObject())));
    }

    /** They finished, so he answers now. */
    public void endSpeech() {
        send(new JSONObject().put("realtimeInput", new JSONObject().put("activityEnd", new JSONObject())));
    }

    /** A stage direction he reacts to out loud, for things he decided on his own. */
    public void sendCue(String text) {
        send(new JSONObject().put("clientContent", new JSONObject()
                .put("turns", new JSONArray().put(new JSONObject().put("role", "user")
                        .put("parts", new JSONArray().put(new JSONObject().put("text", "[" + text + "]")))))
                .put("turnComplete", true)));
    }

    /** Background for the next turn, such as who is speaking. Does not make him answer. */
    public void sendNote(String text) {
        send(new JSONObject().put("clientContent", new JSONObject()
                .put("turns", new JSONArray().put(new JSONObject().put("role", "user")
                        .put("parts", new JSONArray().put(new JSONObject().put("text", text)))))
                .put("turnComplete", false)));
    }

    public void sendToolResult(String id, String name, String result) {
        send(new JSONObject().put("toolResponse", new JSONObject().put("functionResponses", new JSONArray()
                .put(new JSONObject().put("id", id).put("name", name)
                        .put("response", new JSONObject().put("result", result))))));
    }

    public boolean isClosed() {
        return closed;
    }

    public synchronized void close() {
        closed = true;
        tail = tail.thenCompose(socket -> socket.sendClose(WebSocket.NORMAL_CLOSURE, "done"));
    }

    private synchronized void send(JSONObject message) {
        if (closed) return;
        String text = message.toString();
        tail = tail.thenCompose(socket -> socket.sendText(text, true));
        tail.exceptionally(e -> {
            closed(e.getMessage());
            return null;
        });
    }

    private void closed(String reason) {
        if (closed) return;
        closed = true;
        listener.onClosed(reason);
    }

    /** Hands one server message to the listener. */
    static void dispatch(JSONObject message, Listener listener) {
        if (message.has("setupComplete")) listener.onReady();
        JSONObject usage = message.optJSONObject("usageMetadata");
        if (usage != null) listener.onUsage(usage);

        JSONObject toolCall = message.optJSONObject("toolCall");
        if (toolCall != null) {
            JSONArray calls = toolCall.optJSONArray("functionCalls");
            for (int i = 0; calls != null && i < calls.length(); i++) {
                JSONObject call = calls.getJSONObject(i);
                JSONObject args = call.optJSONObject("args");
                listener.onToolCall(call.optString("id", ""), call.optString("name", ""),
                        args == null ? new JSONObject() : args);
            }
        }

        JSONObject content = message.optJSONObject("serverContent");
        if (content == null) return;
        if (content.optBoolean("interrupted")) listener.onInterrupted();
        JSONObject turn = content.optJSONObject("modelTurn");
        JSONArray parts = turn == null ? null : turn.optJSONArray("parts");
        for (int i = 0; parts != null && i < parts.length(); i++) {
            JSONObject data = parts.getJSONObject(i).optJSONObject("inlineData");
            if (data != null) listener.onAudio(samples(data.getString("data")));
        }
        if (content.optBoolean("turnComplete")) listener.onTurnComplete();
    }

    static short[] samples(String base64) {
        ByteBuffer bytes = ByteBuffer.wrap(Base64.getDecoder().decode(base64)).order(ByteOrder.LITTLE_ENDIAN);
        short[] out = new short[bytes.remaining() / 2];
        for (int i = 0; i < out.length; i++) out[i] = bytes.getShort();
        return out;
    }

    private final class Reader implements WebSocket.Listener {
        private java.io.ByteArrayOutputStream binary = new java.io.ByteArrayOutputStream();

        @Override
        public CompletionStage<?> onText(WebSocket socket, CharSequence data, boolean last) {
            incoming.append(data);
            if (last) {
                String text = incoming.toString();
                incoming.setLength(0);
                handle(text);
            }
            socket.request(1);
            return null;
        }

        @Override
        public CompletionStage<?> onBinary(WebSocket socket, ByteBuffer data, boolean last) {
            byte[] chunk = new byte[data.remaining()];
            data.get(chunk);
            binary.write(chunk, 0, chunk.length);
            if (last) {
                String text = binary.toString(StandardCharsets.UTF_8);
                binary = new java.io.ByteArrayOutputStream();
                handle(text);
            }
            socket.request(1);
            return null;
        }

        private void handle(String text) {
            try {
                dispatch(new JSONObject(text), listener);
            } catch (RuntimeException e) {
                closed("unreadable message: " + e.getMessage());
            }
        }

        @Override
        public CompletionStage<?> onClose(WebSocket socket, int status, String reason) {
            closed(status + " " + reason);
            return null;
        }

        @Override
        public void onError(WebSocket socket, Throwable error) {
            closed(error.getMessage());
        }
    }
}
