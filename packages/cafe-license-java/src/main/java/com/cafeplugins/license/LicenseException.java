package com.cafeplugins.license;

/**
 * Exceção levantada quando a licença do plugin é inválida.
 */
public final class LicenseException extends Exception {

    public LicenseException(String message) {
        super(message);
    }

    public LicenseException(String message, Throwable cause) {
        super(message, cause);
    }
}
