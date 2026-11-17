package com.gadgetman.jarvis.voice;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * What CheesyNPC can do from a voice conversation. The work itself stays in the bot (mindcraft-ce) with all
 * its rules; a spoken request becomes a chat request of that player. Nothing here reaches server commands.
 */
public final class LiveTools {

    private LiveTools() { }

    public static JSONArray declarations() {
        JSONArray tools = new JSONArray();
        add(tools, "auftrag", "Ein Spieler will, dass du im Spiel etwas tust (holen, bauen, kommen, folgen, aufhoeren, zeigen, ernten). "
                        + "Gib den Auftrag in seinen Worten an deinen Koerper weiter.",
                prop("text", "STRING", "Der Auftrag kurz in den Worten des Spielers, zum Beispiel: komm zu mir, hol mir 16 Holz"));
        add(tools, "status", "Nachschauen, was du gerade wirklich tust, wo du bist und was du vorhast");
        add(tools, "merk_dir", "Sich etwas ueber den Spieler merken, das er dir erzaehlt (Name im Spiel, was er mag, ein Versprechen)",
                prop("text", "STRING", "Was du dir merken sollst, kurz"));
        return tools;
    }

    private static JSONObject prop(String name, String type, String description) {
        return new JSONObject().put("name", name).put("type", type).put("description", description);
    }

    private static void add(JSONArray tools, String name, String description, JSONObject... props) {
        JSONObject tool = new JSONObject().put("name", name).put("description", description);
        if (props.length > 0) {
            JSONObject properties = new JSONObject();
            for (JSONObject p : props) {
                properties.put(p.getString("name"), new JSONObject()
                        .put("type", p.getString("type")).put("description", p.getString("description")));
            }
            tool.put("parameters", new JSONObject().put("type", "OBJECT").put("properties", properties));
        }
        tools.put(tool);
    }
}
