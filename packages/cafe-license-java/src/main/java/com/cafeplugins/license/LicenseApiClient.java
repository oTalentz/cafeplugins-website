package com.cafeplugins.license;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * Cliente HTTP síncrono mínimo para chamar a API de licenças.
 */
final class LicenseApiClient {

    private final HttpClient client;

    LicenseApiClient(long connectTimeoutMs) {
        this.client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(connectTimeoutMs))
            .build();
    }

    HttpResponse<String> post(String url, String body, String... headers) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .header("Content-Type", "application/json")
            .header("User-Agent", "cafe-license-java/1.0.0")
            .POST(HttpRequest.BodyPublishers.ofString(body != null ? body : "{}"));

        for (int i = 0; i < headers.length; i += 2) {
            if (i + 1 < headers.length) {
                builder.header(headers[i], headers[i + 1]);
            }
        }

        return client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }
}
