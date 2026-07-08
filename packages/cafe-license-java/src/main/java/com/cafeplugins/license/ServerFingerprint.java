package com.cafeplugins.license;

import org.bukkit.Bukkit;
import org.bukkit.Server;
import org.bukkit.plugin.Plugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Properties;

/**
 * Calcula uma fingerprint estável do servidor Minecraft.
 *
 * Usa, na ordem de prioridade:
 * 1. {@code server-id} do arquivo {@code server.properties} (UUID gerado pelo Minecraft)
 * 2. IP + porta do servidor
 * 3. Caminho do diretório do servidor
 *
 * A combinação é hasheada com SHA-256, retornando uma string hex de 64 caracteres.
 */
final class ServerFingerprint {

    static String compute(Plugin plugin) {
        Server server = Bukkit.getServer();
        StringBuilder sb = new StringBuilder();

        // Prioridade 1: server-id gerado pelo Minecraft
        String serverId = readServerId();
        if (serverId != null && !serverId.isBlank()) {
            sb.append(serverId.trim());
        } else {
            // Fallback: IP + porta
            sb.append(server.getIp());
            sb.append(":");
            sb.append(server.getPort());
        }

        sb.append("@").append(plugin.getDataFolder().getParentFile().getAbsoluteFile().getParent());

        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(sb.toString().getBytes(StandardCharsets.UTF_8));
            return bytesToHex(hash);
        } catch (Exception e) {
            throw new RuntimeException("Erro computando fingerprint do servidor", e);
        }
    }

    private static String readServerId() {
        File props = new File("server.properties");
        if (!props.exists()) return null;
        try (InputStream in = new FileInputStream(props)) {
            Properties p = new Properties();
            p.load(in);
            return p.getProperty("server-id");
        } catch (Exception e) {
            return null;
        }
    }

    private static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format("%02x", b & 0xff));
        }
        return sb.toString();
    }
}
