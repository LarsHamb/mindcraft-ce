package de.cheesy.voice.mixin;

import de.cheesy.voice.NpcChat;
import net.minecraft.network.chat.ChatType;
import net.minecraft.network.chat.OutgoingChatMessage;
import net.minecraft.server.level.ServerPlayer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Per recipient: a player who said "!npc aus" does not get the NPC's chat messages (same place where vanilla skips hidden chat). */
@Mixin(ServerPlayer.class)
public abstract class ServerPlayerChatMixin {
    @Inject(method = "sendChatMessage", at = @At("HEAD"), cancellable = true)
    private void cheesy$npcMute(OutgoingChatMessage message, boolean filtered, ChatType.Bound type, CallbackInfo ci) {
        if (message instanceof OutgoingChatMessage.Player p
                && NpcChat.hidden(((ServerPlayer) (Object) this).getUUID(), p.message().sender())) ci.cancel();
    }
}
