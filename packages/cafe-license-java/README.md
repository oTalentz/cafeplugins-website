# cafe-license (SDK Java)

SDK de licenciamento para plugins da **cafe plugins**.

## Como funciona

1. O cliente (dono do servidor) compra o plugin e recebe uma `licenseKey` no painel ou por e-mail.
2. O plugin, no `onEnable()`, chama `CafeLicense.verify(this, licenseKey)`.
3. O SDK lê `cafe-license.yml` dentro do jar, pega `product-id` e a chave pública.
4. Envia `licenseKey`, `pluginId` e `serverId` para `https://cafeplugins.com/api/license/verify`.
5. A API retorna um JWT assinado com RS256 se o pedido estiver pago.
6. O SDK valida o JWT offline e, se tudo bater, o plugin é carregado. Caso contrário, é desabilitado.

## Integração num plugin Spigot/Paper

### 1. Adicione a dependência Maven local

No `pom.xml` do seu plugin, adicione a dependência (depois de fazer `mvn install` no SDK):

```xml
<dependency>
  <groupId>com.cafeplugins</groupId>
  <artifactId>cafe-license</artifactId>
  <version>1.0.0</version>
  <scope>compile</scope>
</dependency>
```

E use o `maven-shade-plugin` para embutir as classes do SDK no jar do seu plugin.

### 2. Crie `src/main/resources/cafe-license.yml`

```yaml
product-id: pf-001
api-url: https://cafeplugins.com/api
public-key: |
  -----BEGIN PUBLIC KEY-----
  COLE AQUI A CHAVE PÚBLICA RS256 DA SUA LOJA (variável LICENSE_PUBLIC_KEY)
  -----END PUBLIC KEY-----
```

O `product-id` deve ser exatamente o `id` do produto no painel admin da loja (ex: `pf-001`).

### 3. Crie/adicione em `src/main/resources/config.yml`

```yaml
license-key: ""
```

### 4. No `onEnable()` do plugin

```java
@Override
public void onEnable() {
    saveDefaultConfig();
    String licenseKey = getConfig().getString("license-key", "");
    CafeLicense.verify(this, licenseKey);

    // Resto do carregamento...
}
```

Para não travar o main thread, você pode usar a versão assíncrona:

```java
CafeLicense.verifyAsync(this, licenseKey);
```

Atenção: com `verifyAsync` o plugin carrega enquanto a licença é verificada; se for inválida, ele é desabilitado logo em seguida.

### 5. Teste local

Sem chaves configuradas a API não emite token. Em dev, gere um par de teste:

```bash
node -e "const { generateKeyPairSync } = require('crypto'); const k = generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}); console.log('---PRIVATE---\\n'+k.privateKey); console.log('---PUBLIC---\\n'+k.publicKey);"
```

Configure `LICENSE_PRIVATE_KEY` no `.env` da API e cole `LICENSE_PUBLIC_KEY` no `cafe-license.yml` do plugin.

## Novo: build watermarkada (anti-redistribuição)

A partir desta versão, a loja gera uma build personalizada do JAR para cada compra:

1. O backend baixa o JAR original e insere um arquivo `cafe-watermark.jwt` dentro do jar.
2. O watermark é um JWT assinado com RS256 contendo `licenseKey`, `orderId`, `buyerEmail` e `productId`.
3. O SDK valida o watermark localmente com a chave pública (`public-key` do `cafe-license.yml`).
4. Se o watermark for inválido ou não bater com o `product-id`, o plugin é desabilitado.
5. Se o `config.yml` não tiver `license-key`, o SDK usa a chave do watermark automaticamente.

Isso permite:

- rastrear de qual pedido/comprador vazou o JAR;
- usar a build sem precisar colar a `license-key` no `config.yml`;
- aumentar o custo para redistribuição casual.

## Re-verificação periódica

Para evitar que o plugin continue rodando após a revogação da licença, use:

```java
@Override
public void onEnable() {
    saveDefaultConfig();
    String licenseKey = getConfig().getString("license-key", "");
    CafeLicense.verifyAsync(this, licenseKey);
    CafeLicense.startPeriodicCheck(this, licenseKey, 30); // revalida a cada 30 min
}
```

Se a licença for revogada ou o token expirar, o plugin é desabilitado automaticamente.

## Limitações de segurança

Qualquer DRM em Java pode ser removido se alguém decompilar e editar o jar. Esse SDK aumenta bastante o custo para pirataria casual e permite:

- rastrear a ativação até o `server-id`;
- rastrear a origem do JAR pelo `cafe-watermark.jwt`;
- limitar quantos servidores rodam ao mesmo tempo (`LICENSE_ACTIVATION_LIMIT`);
- revogar ativações pelo painel admin;
- expirar tokens JWT automaticamente.

Para proteção extra, combine com ofuscadores (ProGuard, Stringer, Allatori) e cláusulas nos Termos de Uso.
