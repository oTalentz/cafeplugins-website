package com.cafeplugins.license;

import org.bukkit.configuration.MemorySection;
import org.bukkit.configuration.file.YamlConfiguration;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

/**
 * Configuração embutida no jar em {@code /cafe-license.yml}.
 *
 * Exemplo do arquivo:
 * <pre>
 * product-id: pf-001
 * api-url: https://cafeplugins.com/api
 * public-key: |
 *   -----BEGIN PUBLIC KEY-----
 *   MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...
 *   -----END PUBLIC KEY-----
 * </pre>
 */
public final class LicenseConfig {

    private final String productId;
    private final String apiUrl;
    private final String publicKey;

    public LicenseConfig(String productId, String apiUrl, String publicKey) {
        this.productId = productId;
        this.apiUrl = apiUrl;
        this.publicKey = publicKey;
    }

    public String getProductId() { return productId; }
    public String getApiUrl() { return apiUrl; }
    public String getPublicKey() { return publicKey; }

    public static LicenseConfig load(InputStream in) throws LicenseException {
        try (InputStreamReader reader = new InputStreamReader(in, StandardCharsets.UTF_8)) {
            YamlConfiguration cfg = YamlConfiguration.loadConfiguration(reader);
            String productId = cfg.getString("product-id");
            String apiUrl = cfg.getString("api-url");
            String publicKey = extractMultilineString(cfg, "public-key");

            if (productId == null || productId.isBlank())
                throw new LicenseException("product-id não definido no cafe-license.yml");
            if (apiUrl == null || apiUrl.isBlank())
                throw new LicenseException("api-url não definida no cafe-license.yml");
            if (publicKey == null || publicKey.isBlank())
                throw new LicenseException("public-key não definida no cafe-license.yml");

            return new LicenseConfig(productId.trim(), apiUrl.trim(), publicKey.trim());
        } catch (Exception e) {
            throw new LicenseException("Erro lendo cafe-license.yml: " + e.getMessage());
        }
    }

    private static String extractMultilineString(YamlConfiguration cfg, String key) {
        Object value = cfg.get(key);
        if (value == null) return null;
        if (value instanceof MemorySection) return null;
        return String.valueOf(value).trim();
    }
}
