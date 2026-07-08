package com.cafeplugins.license;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.exceptions.JWTVerificationException;
import com.auth0.jwt.interfaces.DecodedJWT;
import org.bukkit.Bukkit;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginManager;
import org.json.JSONObject;

import java.io.InputStream;
import java.net.http.HttpResponse;
import java.security.KeyFactory;
import java.security.NoSuchAlgorithmException;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.InvalidKeySpecException;
import java.security.spec.X509EncodedKeySpec;
import java.time.Instant;
import java.util.Base64;
import java.util.logging.Level;

/**
 * Ponto de entrada do SDK de licenciamento da cafe plugins.
 *
 * Uso no onEnable() do plugin:
 *
 * <pre>
 *   @Override
 *   public void onEnable() {
 *     saveDefaultConfig();
 *     String licenseKey = getConfig().getString("license-key", "");
 *     CafeLicense.verify(this, licenseKey);
 *   }
 * </pre>
 *
 * O SDK carrega product-id, api-url e public-key do arquivo
 * {@code /cafe-license.yml} que o desenvolvedor coloca dentro do jar.
 * Ele consulta a API, recebe um JWT assinado e valida com a chave pública.
 * Se for inválido, o plugin é desabilitado.
 */
public final class CafeLicense {

    private static final long CONNECT_TIMEOUT_MS = 10_000;

    public static void verify(Plugin plugin, String licenseKey) {
        if (licenseKey == null || licenseKey.isBlank()) {
            disableAndThrow(plugin, "license-key não configurado no config.yml");
        }

        LicenseConfig config = loadConfig(plugin);
        String serverId = ServerFingerprint.compute(plugin);

        JSONObject body = new JSONObject();
        body.put("licenseKey", licenseKey.trim().toUpperCase());
        body.put("pluginId", config.getProductId());
        body.put("serverId", serverId);

        String apiUrl = config.getApiUrl();
        if (!apiUrl.endsWith("/")) apiUrl += "/";
        String endpoint = apiUrl + "license/verify";

        try {
            LicenseApiClient client = new LicenseApiClient(CONNECT_TIMEOUT_MS);
            HttpResponse<String> response = client.post(endpoint, body.toString(),
                "Content-Type", "application/json");

            int status = response.statusCode();
            String raw = response.body();
            if (status >= 400) {
                String msg = parseError(raw);
                disableAndThrow(plugin, msg);
            }

            JSONObject json = new JSONObject(raw);
            if (!json.optBoolean("valid", false)) {
                disableAndThrow(plugin, parseError(raw));
            }

            String token = json.optString("token", null);
            if (token == null || token.isBlank()) {
                disableAndThrow(plugin, "API não retornou token de licença");
            }

            validateToken(token, config.getPublicKey(), config.getProductId(), licenseKey, serverId);

            plugin.getLogger().info("Licença ativada para servidor " + serverId);

        } catch (Exception e) {
            disableAndThrow(plugin, "Falha na verificação de licença: " + e.getMessage());
        }
    }

    private static LicenseConfig loadConfig(Plugin plugin) {
        InputStream in = plugin.getResource("cafe-license.yml");
        if (in == null) {
            disableAndThrow(plugin, "cafe-license.yml não encontrado no jar");
        }
        try {
            return LicenseConfig.load(in);
        } catch (Exception e) {
            disableAndThrow(plugin, "Erro lendo cafe-license.yml: " + e.getMessage());
        }
        return null;
    }

    private static void validateToken(String token, String publicKeyPem, String productId,
                                      String licenseKey, String serverId)
            throws LicenseException {

        RSAPublicKey publicKey = parsePublicKey(publicKeyPem);
        Algorithm algo = Algorithm.RSA256(publicKey, null);

        try {
            DecodedJWT jwt = JWT.require(algo)
                .withIssuer("cafe-plugins")
                .withAudience(productId)
                .build()
                .verify(token);

            String lic = jwt.getClaim("licenseKey").asString();
            String plug = jwt.getClaim("pluginId").asString();
            String srv = jwt.getClaim("serverId").asString();

            if (lic == null || !lic.equalsIgnoreCase(licenseKey.trim()))
                throw new LicenseException("Token não pertence a esta licença");
            if (plug == null || !plug.equals(productId))
                throw new LicenseException("Token não pertence a este plugin");
            if (srv == null || !srv.equals(serverId))
                throw new LicenseException("Token não pertence a este servidor");

            Instant expires = jwt.getExpiresAt() != null ? jwt.getExpiresAt().toInstant() : null;
            if (expires == null || expires.isBefore(Instant.now()))
                throw new LicenseException("Token expirado");

        } catch (JWTVerificationException e) {
            throw new LicenseException("Assinatura do token inválida: " + e.getMessage());
        }
    }

    private static RSAPublicKey parsePublicKey(String pem) throws LicenseException {
        if (pem == null || pem.isBlank())
            throw new LicenseException("Chave pública não configurada");

        String b64 = pem
            .replace("-----BEGIN PUBLIC KEY-----", "")
            .replace("-----END PUBLIC KEY-----", "")
            .replaceAll("\\s", "");

        try {
            byte[] bytes = Base64.getDecoder().decode(b64);
            X509EncodedKeySpec spec = new X509EncodedKeySpec(bytes);
            KeyFactory kf = KeyFactory.getInstance("RSA");
            return (RSAPublicKey) kf.generatePublic(spec);
        } catch (NoSuchAlgorithmException | InvalidKeySpecException e) {
            throw new LicenseException("Formato de chave pública inválido: " + e.getMessage());
        }
    }

    private static String parseError(String raw) {
        try {
            JSONObject j = new JSONObject(raw);
            return j.optString("error", "Licença inválida");
        } catch (Exception e) {
            return "Licença inválida: " + raw;
        }
    }

    private static void disable(Plugin plugin, String reason) {
        PluginManager pm = Bukkit.getPluginManager();
        plugin.getLogger().log(Level.SEVERE, reason);
        pm.disablePlugin(plugin);
    }

    private static void disableAndThrow(Plugin plugin, String reason) throws LicenseException {
        disable(plugin, reason);
        throw new LicenseException(reason);
    }

    // Não instanciar
    private CafeLicense() {}
}
